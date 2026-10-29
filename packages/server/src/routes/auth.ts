import type { FastifyInstance } from "fastify";
import { createUser, getUserByEmail, setTotpLastStep } from "../repo.js";
import { authed, hashPassword, signToken, verifyPassword } from "../auth.js";
import { planStatus } from "../plan-status.js";
import { matchTotpStep } from "../totp.js";
import { rateLimit, clearRateLimit } from "../rate-limit.js";

const WINDOW = 15 * 60 * 1000; // 15 min

interface Credentials {
  email?: string;
  password?: string;
  code?: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: Credentials }>("/api/signup", async (req, reply) => {
    const email = req.body?.email?.trim().toLowerCase();
    const password = req.body?.password;
    if (!email || !password) return reply.code(400).send({ error: "email and password required" });
    if (password.length < 6) return reply.code(400).send({ error: "password must be at least 6 characters" });
    if (getUserByEmail(email)) return reply.code(409).send({ error: "email already registered" });
    const u = createUser(email, hashPassword(password));
    return reply.code(201).send({ token: signToken(u), user: { id: u.id, email: u.email } });
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
    return { token: signToken(u), user: { id: u.id, email: u.email } };
  });

  app.get("/api/me", authed, async (req) => ({ user: req.user, ...planStatus(req.user!.id) }));
}
