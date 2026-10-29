import type { FastifyInstance, FastifyRequest } from "fastify";
import { authed } from "../auth.js";
import { config } from "../config.js";
import {
  setUserPlan,
  setStripeCustomer,
  setUserBilling,
  getUserById,
  getUserByStripeCustomer,
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

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // the plan catalog (public)
  app.get("/api/billing/plans", async () => allPlans());

  // current user's plan + usage
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

    let customerId = user.stripe_customer_id;
    if (!customerId) {
      customerId = await createCustomer(user.email, user.id);
      setStripeCustomer(user.id, customerId);
    }
    const b = baseUrl(req);
    const url = await createCheckoutSession({
      customerId,
      priceId: price,
      userId: user.id,
      successUrl: `${b}/?billing=success`,
      cancelUrl: `${b}/?billing=cancel`,
    });
    return { url };
  });

  // Open the Stripe billing portal to manage/cancel a subscription.
  app.post("/api/billing/portal", authed, async (req, reply) => {
    if (!stripeEnabled()) return reply.code(400).send({ error: "billing portal is not configured" });
    const user = getUserById(req.user!.id);
    if (!user?.stripe_customer_id) return reply.code(400).send({ error: "no billing account yet" });
    return { url: await createPortalSession(user.stripe_customer_id, baseUrl(req)) };
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
      if (!u) break;
      const status = obj.status as string | undefined;
      const items = obj.items as { data?: { price?: { id?: string } }[] } | undefined;
      const priceId = items?.data?.[0]?.price?.id;
      const plan = priceId ? planForPrice(priceId) : undefined;
      const active = status === "active" || status === "trialing";
      if (plan && active) setUserBilling(u.id, plan, (obj.id as string) ?? null, status ?? null);
      else if (!active) setUserBilling(u.id, "free", (obj.id as string) ?? null, status ?? null);
      break;
    }
    case "customer.subscription.deleted": {
      const customer = obj.customer as string | undefined;
      const u = customer ? getUserByStripeCustomer(customer) : undefined;
      if (u) setUserBilling(u.id, "free", null, "canceled");
      break;
    }
  }
}
