import type { FastifyInstance, FastifyRequest } from "fastify";
import { authed } from "../auth.js";
import { config } from "../config.js";
import {
  setUserPlan,
  setStripeCustomer,
  setUserBilling,
  getUserById,
  getUserByStripeCustomer,
  type UserRow,
} from "../repo.js";
import { allPlans, isPlanId } from "../plans.js";
import { planStatus } from "../plan-status.js";
import {
  stripeEnabled,
  priceForPlan,
  planForPrice,
  createCustomer,
  createCheckoutSession,
  createPortalSession,
  verifyWebhook,
  getSubscription,
  setCancelAtPeriodEnd,
  subscriptionSummary,
  type StripeSubscription,
} from "../stripe.js";

/** The SPA origin to send Checkout/Portal returns back to (request Origin, else PUBLIC_URL). */
function baseUrl(req: FastifyRequest): string {
  const origin = (req.headers.origin as string) || "";
  if (origin) return origin.replace(/\/$/, "");
  const ref = (req.headers.referer as string) || "";
  if (ref) {
    try {
      return new URL(ref).origin;
    } catch {
      /* ignore */
    }
  }
  return (config.publicUrl || "").replace(/\/$/, "");
}

/**
 * Reconcile a user's local plan state from a Stripe subscription (webhook payload or API read).
 * Active/trialing → the plan for its price (fall back to the current plan if the price is
 * unknown); anything else (canceled, unpaid, past_due…) → free. Period end + cancel flag are
 * stored so the UI can say "renews on" / "cancels on".
 */
function applySubscription(u: UserRow, sub: StripeSubscription | Record<string, unknown>): void {
  const s = subscriptionSummary(sub);
  const active = s.status === "active" || s.status === "trialing";
  const plan = active ? ((s.priceId && planForPrice(s.priceId)) || u.plan) : "free";
  setUserBilling(u.id, plan, (sub as StripeSubscription).id ?? u.stripe_subscription_id, s.status, {
    renewsAt: s.renewsAt,
    cancelAtPeriodEnd: s.cancelAtPeriodEnd,
  });
}

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // the plan catalog (public)
  app.get("/api/billing/plans", async () => allPlans());

  // current user's plan + usage + subscription state
  app.get("/api/billing/status", authed, async (req) => planStatus(req.user!.id));

  // Start an upgrade. With Stripe configured → a Checkout Session URL; without it → an instant
  // dev switch (so local/staging work with no keys). Enterprise → "contact us".
  app.post<{ Body: { plan?: string } }>("/api/billing/checkout", authed, async (req, reply) => {
    const plan = req.body?.plan;
    if (!plan || !isPlanId(plan)) return reply.code(400).send({ error: "unknown plan" });
    if (plan === "enterprise") return { contact: true };

    const user = getUserById(req.user!.id);
    if (!user) return reply.code(404).send({ error: "user not found" });

    if (!stripeEnabled()) {
      // No Stripe keys. In production that must NOT hand out paid plans for free.
      if (config.isProduction) {
        return reply.code(503).send({ error: "billing is not configured" });
      }
      // dev/local/staging: switch instantly so the flow is testable without keys
      setUserPlan(user.id, plan);
      return { dev: true, status: planStatus(user.id) };
    }

    if (plan === "free") {
      // downgrade: manage/cancel in the Stripe portal if they have a subscription
      if (user.stripe_customer_id) return { url: await createPortalSession(user.stripe_customer_id, baseUrl(req)) };
      setUserPlan(user.id, "free");
      return { dev: true, status: planStatus(user.id) };
    }

    const price = priceForPlan(plan);
    if (!price) return reply.code(400).send({ error: `no Stripe price configured for "${plan}"` });

    const b = baseUrl(req);
    const mkSession = (customerId: string) =>
      createCheckoutSession({
        customerId,
        priceId: price,
        userId: user.id,
        successUrl: `${b}/?billing=success`,
        cancelUrl: `${b}/?billing=cancel`,
      });

    try {
      let customerId = user.stripe_customer_id;
      if (!customerId) {
        customerId = await createCustomer(user.email, user.id);
        setStripeCustomer(user.id, customerId);
      }
      try {
        return { url: await mkSession(customerId) };
      } catch (e) {
        // A stored customer from a different mode/account (e.g. after a test→live switch)
        // no longer exists here — create a fresh one and retry once.
        if (/no such customer/i.test((e as Error).message)) {
          const fresh = await createCustomer(user.email, user.id);
          setStripeCustomer(user.id, fresh);
          return { url: await mkSession(fresh) };
        }
        throw e;
      }
    } catch (e) {
      return reply.code(502).send({ error: `Stripe checkout failed: ${(e as Error).message}` });
    }
  });

  // Open the Stripe billing portal (payment method, invoices, full management).
  app.post("/api/billing/portal", authed, async (req, reply) => {
    if (!stripeEnabled()) return reply.code(400).send({ error: "billing portal is not configured" });
    const user = getUserById(req.user!.id);
    if (!user?.stripe_customer_id) return reply.code(400).send({ error: "no billing account yet" });
    try {
      return { url: await createPortalSession(user.stripe_customer_id, baseUrl(req)) };
    } catch (e) {
      return reply.code(502).send({ error: `Stripe portal failed: ${(e as Error).message}` });
    }
  });

  // ── in-app subscription control ──

  // Cancel at the end of the current period (access continues until then).
  app.post("/api/billing/cancel", authed, async (req, reply) => {
    const user = getUserById(req.user!.id);
    if (!user) return reply.code(404).send({ error: "user not found" });
    if (!user.stripe_subscription_id) {
      if (!stripeEnabled() && user.plan !== "free") {
        // dev mode: no real period to run out — drop to free now
        setUserBilling(user.id, "free", null, "canceled", { renewsAt: null, cancelAtPeriodEnd: false });
        return planStatus(user.id);
      }
      return reply.code(400).send({ error: "no active subscription to cancel" });
    }
    if (!stripeEnabled()) return reply.code(400).send({ error: "billing is not configured" });
    try {
      applySubscription(user, await setCancelAtPeriodEnd(user.stripe_subscription_id, true));
      return planStatus(user.id);
    } catch (e) {
      return reply.code(502).send({ error: `Stripe cancel failed: ${(e as Error).message}` });
    }
  });

  // Undo a pending cancellation.
  app.post("/api/billing/resume", authed, async (req, reply) => {
    const user = getUserById(req.user!.id);
    if (!user) return reply.code(404).send({ error: "user not found" });
    if (!user.stripe_subscription_id || !stripeEnabled()) {
      return reply.code(400).send({ error: "nothing to resume" });
    }
    try {
      applySubscription(user, await setCancelAtPeriodEnd(user.stripe_subscription_id, false));
      return planStatus(user.id);
    } catch (e) {
      return reply.code(502).send({ error: `Stripe resume failed: ${(e as Error).message}` });
    }
  });

  // Re-read the subscription from Stripe and reconcile local state (covers a missed webhook).
  app.post("/api/billing/sync", authed, async (req, reply) => {
    const user = getUserById(req.user!.id);
    if (!user) return reply.code(404).send({ error: "user not found" });
    if (!stripeEnabled()) return reply.code(400).send({ error: "billing is not configured" });
    if (!user.stripe_subscription_id) return planStatus(user.id); // nothing to sync — report as-is
    try {
      applySubscription(user, await getSubscription(user.stripe_subscription_id));
    } catch (e) {
      // the subscription is gone on Stripe's side → we're on free
      if (/no such subscription/i.test((e as Error).message)) {
        setUserBilling(user.id, "free", null, "canceled", { renewsAt: null, cancelAtPeriodEnd: false });
      } else {
        return reply.code(502).send({ error: `Stripe sync failed: ${(e as Error).message}` });
      }
    }
    return planStatus(user.id);
  });

  // Dev-only direct switch (used by tests and keyless local/staging). Blocked in production
  // once Stripe is configured — real plan changes must flow through Checkout + the webhook.
  app.post<{ Body: { plan?: string } }>("/api/billing/plan", authed, async (req, reply) => {
    if (stripeEnabled() && config.isProduction) {
      return reply.code(403).send({ error: "use /api/billing/checkout" });
    }
    const plan = req.body?.plan;
    if (!plan || !isPlanId(plan)) return reply.code(400).send({ error: "unknown plan" });
    setUserPlan(req.user!.id, plan);
    return planStatus(req.user!.id);
  });

  // Stripe webhook — registered in its own scope so the raw body (needed for signature
  // verification) is preserved only here, not for the rest of the JSON API.
  await app.register(async (wh) => {
    wh.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body));
    wh.post("/api/billing/webhook", async (req, reply) => {
      const raw = req.body as Buffer;
      if (!verifyWebhook(raw, req.headers["stripe-signature"] as string | undefined)) {
        return reply.code(400).send({ error: "invalid signature" });
      }
      let event: StripeEvent;
      try {
        event = JSON.parse(raw.toString("utf8"));
      } catch {
        return reply.code(400).send({ error: "invalid payload" });
      }
      handleStripeEvent(event);
      return { received: true };
    });
  });
}

interface StripeEvent {
  type?: string;
  data?: { object?: Record<string, unknown> };
}

/** Apply a verified Stripe event to the user's plan. */
function handleStripeEvent(event: StripeEvent): void {
  const obj = (event.data?.object ?? {}) as Record<string, unknown>;
  switch (event.type) {
    case "checkout.session.completed": {
      const userId = obj.client_reference_id as string | undefined;
      const customer = obj.customer as string | undefined;
      if (userId && customer) {
        const u = getUserById(userId);
        if (u && !u.stripe_customer_id) setStripeCustomer(userId, customer);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const customer = obj.customer as string | undefined;
      const u = customer ? getUserByStripeCustomer(customer) : undefined;
      if (u) applySubscription(u, obj);
      break;
    }
    case "customer.subscription.deleted": {
      const customer = obj.customer as string | undefined;
      const u = customer ? getUserByStripeCustomer(customer) : undefined;
      if (u) setUserBilling(u.id, "free", null, "canceled", { renewsAt: null, cancelAtPeriodEnd: false });
      break;
    }
  }
}
