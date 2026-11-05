import { randomUUID } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

/**
 * Cloudflare Turnstile (bot check) for the public, unauthenticated forms: sign-up, forgot-password and
 * the contact form. Off until TURNSTILE_SECRET_KEY + TURNSTILE_SITE_KEY are set, so local dev, tests and
 * the Unity plugin (which never uses these forms) are unaffected.
 *
 * Tokens are single-use, valid 5 minutes, at most 2048 chars, and verified server-side against
 * https://challenges.cloudflare.com/turnstile/v0/siteverify. If Cloudflare can't be reached the check
 * fails OPEN (logged) — the forms keep their rate limits, and an outage at Cloudflare doesn't stop
 * people signing up.
 */
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export const turnstileEnabled = () => !!(config.turnstileSecret && config.turnstileSiteKey);

export type CaptchaResult = { ok: true; degraded?: boolean } | { ok: false; code: "captcha-required" | "captcha-failed"; detail?: string[] };

export async function verifyTurnstile(token: unknown, ip: string | undefined, action: string): Promise<CaptchaResult> {
  if (!turnstileEnabled()) return { ok: true };
  if (typeof token !== "string" || !token) return { ok: false, code: "captcha-required" };
  if (token.length > 2048) return { ok: false, code: "captcha-failed", detail: ["invalid-input-response"] };
  let res: { success?: boolean; "error-codes"?: string[]; action?: string };
  try {
    const r = await fetch(SITEVERIFY, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: config.turnstileSecret, response: token, remoteip: ip, idempotency_key: randomUUID() }),
      signal: AbortSignal.timeout(5000),
    });
    res = (await r.json()) as typeof res;
  } catch (e) {
    console.warn(`[turnstile] siteverify unreachable, allowing ${action}: ${(e as Error).message}`);
    return { ok: true, degraded: true };
  }
  if (!res.success) return { ok: false, code: "captcha-failed", detail: res["error-codes"] ?? [] };
  // the widget declares which form it was solved for; a token from another form doesn't count
  if (res.action && res.action !== action) return { ok: false, code: "captcha-failed", detail: ["action-mismatch"] };
  return { ok: true };
}

/** Route helper: verify `body.turnstileToken` for `action`; on failure sends 400 and returns false. */
export async function requireHuman(req: FastifyRequest, reply: FastifyReply, action: string): Promise<boolean> {
  const token = (req.body as { turnstileToken?: unknown } | undefined)?.turnstileToken;
  const r = await verifyTurnstile(token, req.ip, action);
  if (r.ok) return true;
  await reply.code(400).send({
    error: r.code === "captcha-required" ? "Please complete the security check." : "The security check failed or expired — please try it again.",
    code: r.code,
  });
  return false;
}
