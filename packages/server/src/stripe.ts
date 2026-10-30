/**
 * Minimal Stripe client — raw `fetch` against the Stripe REST API, no SDK (matches this codebase's
 * dependency-light, hand-rolled-crypto style: scrypt auth, HMAC JWTs, TOTP). When no secret key is
 * configured, {@link stripeEnabled} is false and billing routes fall back to an instant dev switch.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { PlanId } from "./plans.js";

const API = "https://api.stripe.com/v1";

// Read Stripe config from the environment at call-time (not cached), so keys set after module load
// — in tests, or by the host before boot — take effect without a rebuild.
const secretKey = () => process.env.STRIPE_SECRET_KEY ?? "";
export const webhookSecret = () => process.env.STRIPE_WEBHOOK_SECRET ?? "";
/** The paid plans that map to a Stripe Price ID (env: STRIPE_PRICE_STARTER, STRIPE_PRICE_STUDIO). */
const PAID_PLANS: PlanId[] = ["starter", "studio"];

export function stripeEnabled(): boolean {
  return !!secretKey();
}

/** Stripe Price ID for a paid plan, or "" if that plan has no price (free/enterprise/unknown). */
export function priceForPlan(plan: string): string {
  return process.env[`STRIPE_PRICE_${plan.toUpperCase()}`] ?? "";
}

/** Reverse map: which plan a Stripe Price ID belongs to. */
export function planForPrice(priceId: string): PlanId | undefined {
  return PAID_PLANS.find((p) => priceForPlan(p) && priceForPlan(p) === priceId);
}

/** Encode a possibly-nested object as application/x-www-form-urlencoded (Stripe's bracket syntax). */
export function toForm(obj: Record<string, unknown>, prefix = ""): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) {
      parts.push(toForm(v as Record<string, unknown>, key));
    } else if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (typeof item === "object") parts.push(toForm(item as Record<string, unknown>, `${key}[${i}]`));
        else parts.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return parts.filter(Boolean).join("&");
}

async function stripeGet<T>(path: string): Promise<T> {
  const res = await fetch(`${API}/${path}`, { headers: { authorization: `Bearer ${secretKey()}` } });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${path} failed (${res.status})`);
  return json;
}

async function stripePost<T>(path: string, params: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${API}/${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secretKey()}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: toForm(params),
  });
  const json = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(json?.error?.message || `Stripe ${path} failed (${res.status})`);
  return json;
}

export async function createCustomer(email: string, userId: string): Promise<string> {
  const c = await stripePost<{ id: string }>("customers", { email, "metadata[userId]": userId });
  return c.id;
}

export async function createCheckoutSession(args: {
  customerId: string;
  priceId: string;
  userId: string;
  successUrl: string;
  cancelUrl: string;
}): Promise<string> {
  const s = await stripePost<{ url: string }>("checkout/sessions", {
    mode: "subscription",
    customer: args.customerId,
    client_reference_id: args.userId,
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
    line_items: [{ price: args.priceId, quantity: 1 }],
    allow_promotion_codes: "true",
  });
  return s.url;
}

export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const s = await stripePost<{ url: string }>("billing_portal/sessions", {
    customer: customerId,
    return_url: returnUrl,
  });
  return s.url;
}

/**
 * Verify a Stripe webhook signature (the `Stripe-Signature` header) against the raw request body,
 * exactly as Stripe's SDK does: HMAC-SHA256 of `${timestamp}.${payload}` keyed by the webhook
 * secret, compared timing-safely to a `v1` signature, within a 5-minute tolerance.
 */
export function verifyWebhook(rawBody: Buffer | string, header: string | undefined, secret: string = webhookSecret()): boolean {
  if (!header || !secret) return false;
  let t = "";
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const [k, val] = part.split("=");
    if (k === "t") t = val ?? "";
    else if (k === "v1" && val) v1.push(val);
  }
  if (!t || v1.length === 0) return false;
  // reject stale timestamps (replay protection), 5-minute window
  const age = Math.abs(Date.now() / 1000 - Number(t));
  if (!Number.isFinite(age) || age > 300) return false;

  const payload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const exp = Buffer.from(expected);
  return v1.some((sig) => {
    const got = Buffer.from(sig);
    return got.length === exp.length && timingSafeEqual(got, exp);
  });
}

// ── subscriptions: read / update / summarise ─────────────────────────────────

/** The parts of a Stripe Subscription object we act on. */
export interface StripeSubscription {
  id: string;
  customer?: string;
  status?: string;
  cancel_at_period_end?: boolean;
  /** API versions before 2025 carried the period on the subscription… */
  current_period_end?: number;
  /** …newer versions carry it on each item. */
  items?: { data?: { price?: { id?: string }; current_period_end?: number }[] };
}

export interface SubscriptionSummary {
  status: string | null;
  priceId: string | null;
  /** ISO timestamp of the end of the current billing period (renewal or cancellation date) */
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
}

/** Normalise a subscription (webhook payload or API read) across API versions. */
export function subscriptionSummary(sub: StripeSubscription | Record<string, unknown>): SubscriptionSummary {
  const o = sub as StripeSubscription;
  const item = o.items?.data?.[0];
  const end = typeof o.current_period_end === "number" ? o.current_period_end : item?.current_period_end;
  return {
    status: o.status ?? null,
    priceId: item?.price?.id ?? null,
    renewsAt: typeof end === "number" ? new Date(end * 1000).toISOString() : null,
    cancelAtPeriodEnd: !!o.cancel_at_period_end,
  };
}

export function getSubscription(id: string): Promise<StripeSubscription> {
  return stripeGet<StripeSubscription>(`subscriptions/${encodeURIComponent(id)}`);
}

/** Flip cancel-at-period-end (cancel keeps access until the period ends; resume undoes it). */
export function setCancelAtPeriodEnd(id: string, cancel: boolean): Promise<StripeSubscription> {
  return stripePost<StripeSubscription>(`subscriptions/${encodeURIComponent(id)}`, {
    cancel_at_period_end: cancel ? "true" : "false",
  });
}
