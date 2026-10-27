import type { FastifyInstance } from "fastify";
import { createUser, getUserByEmail } from "../repo.js";
import { authed, hashPassword, signToken, verifyPassword } from "../auth.js";
import { planStatus } from "../plan-status.js";

interface Credentials {
  email?: string;
  password?: string;
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
    const u = getUserByEmail(email);
    if (!u || !verifyPassword(password, u.password_hash)) {
      return reply.code(401).send({ error: "invalid credentials" });
    }
    return { token: signToken(u), user: { id: u.id, email: u.email } };
  });

  app.get("/api/me", authed, async (req) => ({ user: req.user, ...planStatus(req.user!.id) }));
}
