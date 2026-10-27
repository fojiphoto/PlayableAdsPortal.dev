import type { FastifyInstance } from "fastify";
import { authed, hashPassword, verifyPassword } from "../auth.js";
import { getUserById, setTotp, updatePassword } from "../repo.js";
import { generateSecret, otpauthURL, verifyTotp } from "../totp.js";

export async function accountRoutes(app: FastifyInstance): Promise<void> {
  // change password
  app.post<{ Body: { currentPassword?: string; newPassword?: string } }>(
    "/api/users/password",
    authed,
    async (req, reply) => {
      const { currentPassword, newPassword } = req.body ?? {};
      if (!currentPassword || !newPassword) return reply.code(400).send({ error: "current and new password required" });
      if (newPassword.length < 6) return reply.code(400).send({ error: "new password must be at least 6 characters" });
      const u = getUserById(req.user!.id);
      if (!u || !verifyPassword(currentPassword, u.password_hash)) {
        return reply.code(401).send({ error: "current password is incorrect" });
      }
      updatePassword(u.id, hashPassword(newPassword));
      return { ok: true };
    },
  );

  // ── 2FA (TOTP) ──
  app.get("/api/2fa/status", authed, async (req) => {
    const u = getUserById(req.user!.id);
    return { enabled: !!u?.totp_enabled };
  });

  app.post("/api/2fa/begin", authed, async (req, reply) => {
    const u = getUserById(req.user!.id);
    if (!u) return reply.code(404).send({ error: "not found" });
    if (u.totp_enabled) return reply.code(409).send({ error: "2FA already enabled" });
    const secret = generateSecret();
    setTotp(u.id, secret, 0); // pending, not yet enabled
    return { secret, otpauth: otpauthURL(secret, u.email) };
  });

  app.post<{ Body: { code?: string } }>("/api/2fa/confirm", authed, async (req, reply) => {
    const u = getUserById(req.user!.id);
    if (!u || !u.totp_secret) return reply.code(400).send({ error: "start 2FA setup first" });
    if (!req.body?.code || !verifyTotp(u.totp_secret, req.body.code)) {
      return reply.code(400).send({ error: "invalid code" });
    }
    setTotp(u.id, u.totp_secret, 1);
    return { enabled: true };
  });

  app.post<{ Body: { code?: string } }>("/api/2fa/disable", authed, async (req, reply) => {
    const u = getUserById(req.user!.id);
    if (!u || !u.totp_enabled || !u.totp_secret) return reply.code(400).send({ error: "2FA not enabled" });
    if (!req.body?.code || !verifyTotp(u.totp_secret, req.body.code)) {
      return reply.code(400).send({ error: "invalid code" });
    }
    setTotp(u.id, null, 0);
    return { enabled: false };
  });
}
