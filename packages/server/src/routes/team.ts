import type { FastifyInstance } from "fastify";
import { authed } from "../auth.js";
import { addMember, getUserByEmail, listMembers, removeMember } from "../repo.js";

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  // members I've added to my team (who can access my apps)
  app.get("/api/team", authed, async (req) => listMembers(req.user!.id));

  // invite an existing user by email
  app.post<{ Body: { email?: string; role?: string } }>("/api/team/invite", authed, async (req, reply) => {
    const email = req.body?.email?.trim().toLowerCase();
    if (!email) return reply.code(400).send({ error: "email required" });
    const u = getUserByEmail(email);
    if (!u) return reply.code(404).send({ error: "No account with that email — they need to sign up first." });
    if (u.id === req.user!.id) return reply.code(400).send({ error: "You can't add yourself." });
    addMember(req.user!.id, u.id, req.body?.role === "admin" ? "admin" : "member");
    return reply.code(201).send(listMembers(req.user!.id));
  });

  // remove a member
  app.delete<{ Params: { memberId: string } }>("/api/team/:memberId", authed, async (req) => {
    removeMember(req.user!.id, req.params.memberId);
    return listMembers(req.user!.id);
  });
}
