import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  consumeReset,
  createPasswordReset,
  createUser,
  findActiveReset,
  getUserByEmail,
  getUserById,
  setEmailVerifyToken,
  setTotpLastStep,
  updatePassword,
  verifyEmailByHash,
} from "../repo.js";
import { authed, createOpaqueToken, hashOpaqueToken, hashPassword, signToken, verifyPassword } from "../auth.js";
import { planStatus } from "../plan-status.js";
import { matchTotpStep } from "../totp.js";
import { rateLimit, clearRateLimit } from "../rate-limit.js";
import { sendMail, template } from "../mail.js";
import { config } from "../config.js";

interface Credentials {
  email?: string;
  password?: string;
  code?: string;
}

const WINDOW = 15 * 60 * 1000; // 15 min
const RESET_TTL_MS = 60 * 60 * 1000; // 1 h
const VERIFY_TTL_MS = 48 * 60 * 60 * 1000; // 48 h

/** The SPA origin to build email links against (request Origin, else PUBLIC_URL). */
function siteUrl(req: FastifyRequest): string {
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
  return (config.publicUrl || "https://app.factorialstudio.dev").replace(/\/$/, "");
}

function userView(u: { id: string; email: string; email_verified?: number }) {
  return { id: u.id, email: u.email, emailVerified: !!u.email_verified };
}

/** Issue a fresh verification token and email the link. Never throws (signup must not fail on mail). */
async function sendVerification(req: FastifyRequest, userId: string, email: string): Promise<void> {
  const { raw, hash } = createOpaqueToken();
  setEmailVerifyToken(userId, hash, new Date(Date.now() + VERIFY_TTL_MS).toISOString());
  const url = `${siteUrl(req)}/?verify=${raw}`;
  try {
    await sendMail({
      to: email,
      subject: "Verify your email — Factorial AdLab",
      text: `Verify your email for Factorial AdLab: ${url}`,
      html: template(
        "Verify your email",
        "Confirm this address to secure your account and get export notifications.",
        "Verify email",
        url,
        "This link is valid for 48 hours. If you didn't create an account, you can ignore this email.",
      ),
    });
  } catch (e) {
    console.warn("verification mail failed:", (e as Error).message);
  }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: Credentials }>("/api/signup", async (req, reply) => {
    const email = req.body?.email?.trim().toLowerCase();
    const password = req.body?.password;
    if (!email || !password) return reply.code(400).send({ error: "email and password required" });
    if (password.length < 6) return reply.code(400).send({ error: "password must be at least 6 characters" });
    if (getUserByEmail(email)) return reply.code(409).send({ error: "email already registered" });
    const u = createUser(email, hashPassword(password));
    await sendVerification(req, u.id, u.email);
    return reply.code(201).send({ token: signToken(u), user: userView(u) });
  });

  app.post<{ Body: Credentials }>("/api/login", async (req, reply) => {
    const email = req.body?.email?.trim().toLowerCase();
    const password = req.body?.password;
    if (!email || !password) return reply.code(400).send({ error: "email and password required" });

    // brute-force guard: tight per ip+email, looser per ip (catches email-spraying)
    const okPair = rateLimit(`login:${req.ip}:${email}`, 8, WINDOW);
    const okIp = rateLimit(`login:${req.ip}`, 60, WINDOW);
    if (!okPair || !okIp) {
      return reply.code(429).send({ error: "too many attempts — try again later" });
    }

    const u = getUserByEmail(email);
    if (!u || !verifyPassword(password, u.password_hash)) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    if (u.totp_enabled && u.totp_secret) {
      const code = req.body?.code;
      if (!code) return reply.code(401).send({ error: "2FA code required", code: "2fa-required" });
      const step = matchTotpStep(u.totp_secret, code);
      if (step < 0) return reply.code(401).send({ error: "invalid 2FA code", code: "2fa-invalid" });
      // replay guard: a time-step can't be reused
      if (u.totp_last_step != null && step <= u.totp_last_step) {
        return reply.code(401).send({ error: "code already used", code: "2fa-replay" });
      }
      setTotpLastStep(u.id, step);
    }
    clearRateLimit(`login:${req.ip}:${email}`); // success resets the pair bucket
    return { token: signToken(u), user: userView(u) };
  });

  app.get("/api/me", authed, async (req) => {
    const u = getUserById(req.user!.id);
    return { user: u ? userView(u) : req.user, ...planStatus(req.user!.id) };
  });

  // ── email verification ──
  app.post<{ Body: { token?: string } }>("/api/signup/verify", async (req, reply) => {
    const raw = req.body?.token?.trim();
    if (!raw) return reply.code(400).send({ error: "token required" });
    const u = verifyEmailByHash(hashOpaqueToken(raw));
    if (!u) return reply.code(400).send({ error: "This verification link is invalid or has expired." });
    return { verified: true, email: u.email };
  });

  app.post("/api/signup/resend", authed, async (req, reply) => {
    const u = getUserById(req.user!.id);
    if (!u) return reply.code(404).send({ error: "not found" });
    if (u.email_verified) return { verified: true };
    if (!rateLimit(`verify:${u.id}`, 3, WINDOW)) {
      return reply.code(429).send({ error: "too many verification emails — try again later" });
    }
    await sendVerification(req, u.id, u.email);
    return { sent: true };
  });

  // ── password reset ──
  // Always 200 so the endpoint can't be used to probe which emails exist.
  app.post<{ Body: { email?: string } }>("/api/password/forgot", async (req, reply) => {
    const email = req.body?.email?.trim().toLowerCase();
    if (!email) return reply.code(400).send({ error: "email required" });
    const okPair = rateLimit(`forgot:${req.ip}:${email}`, 5, WINDOW);
    const okIp = rateLimit(`forgot:${req.ip}`, 30, WINDOW);
    if (!okPair || !okIp) return reply.code(429).send({ error: "too many requests — try again later" });

    const u = getUserByEmail(email);
    if (u) {
      const { raw, hash } = createOpaqueToken();
      createPasswordReset(u.id, hash, new Date(Date.now() + RESET_TTL_MS).toISOString());
      const url = `${siteUrl(req)}/?reset=${raw}`;
      try {
        await sendMail({
          to: u.email,
          subject: "Reset your password — Factorial AdLab",
          text: `Reset your Factorial AdLab password: ${url} (valid for 1 hour)`,
          html: template(
            "Reset your password",
            "We received a request to reset the password for this account. Click below to choose a new one.",
            "Choose a new password",
            url,
            "This link is valid for 1 hour and can be used once. If you didn't request a reset, you can safely ignore this email — your password won't change.",
          ),
        });
      } catch (e) {
        console.warn("reset mail failed:", (e as Error).message);
      }
    }
    return { ok: true };
  });

  app.post<{ Body: { token?: string } }>("/api/password/reset/check", async (req) => {
    const raw = req.body?.token?.trim();
    return { valid: !!(raw && findActiveReset(hashOpaqueToken(raw))) };
  });

  app.post<{ Body: { token?: string; newPassword?: string } }>("/api/password/reset", async (req, reply) => {
    const raw = req.body?.token?.trim();
    const pw = req.body?.newPassword;
    if (!raw || !pw) return reply.code(400).send({ error: "token and newPassword required" });
    if (pw.length < 6) return reply.code(400).send({ error: "password must be at least 6 characters" });
    const r = findActiveReset(hashOpaqueToken(raw));
    if (!r) return reply.code(400).send({ error: "This reset link is invalid, expired, or already used." });
    updatePassword(r.user_id, hashPassword(pw));
    consumeReset(r.id);
    return { ok: true };
  });
}
