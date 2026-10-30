import type { FastifyInstance } from "fastify";
import { authed, createOpaqueToken, hashOpaqueToken } from "../auth.js";
import {
  createOrg,
  createOrgInvite,
  currentOrgFor,
  deleteInvite,
  findInviteByHash,
  getOrg,
  getRole,
  getUserById,
  listOrgInvites,
  listOrgMembers,
  listUserOrgs,
  markInviteAccepted,
  removeOrgMember,
  renameOrg,
  setCurrentOrg,
  transferOrgOwnership,
  upsertOrgMember,
  type OrgRole,
} from "../repo.js";
import { atLeast, isRole, needs, requireRole, workspaceView } from "../orgs.js";
import { sendMail, template } from "../mail.js";
import { siteUrl } from "../site.js";
import { rateLimit } from "../rate-limit.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function orgDetail(orgId: string, viewerRole: OrgRole) {
  const org = getOrg(orgId)!;
  const owner = getUserById(org.owner_user_id);
  return {
    id: org.id,
    name: org.name,
    role: viewerRole,
    owner: { id: org.owner_user_id, email: owner?.email ?? null },
    members: listOrgMembers(org.id),
    // pending invites are admin-only information
    invites: atLeast(viewerRole, "admin") ? listOrgInvites(org.id).map(inviteView) : [],
    createdAt: org.created_at,
  };
}
const inviteView = (i: { id: string; email: string; role: string; expires_at: string; created_at: string }) => ({
  id: i.id,
  email: i.email,
  role: i.role,
  expiresAt: i.expires_at,
  createdAt: i.created_at,
});

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  // ── workspaces: list + switch + create ──
  app.get("/api/workspaces", authed, async (req) => {
    const cur = currentOrgFor(req.user!.id);
    return listUserOrgs(req.user!.id).map((o) => ({
      id: o.id,
      name: o.name,
      role: o.role,
      ownerEmail: o.owner_email,
      memberCount: o.member_count,
      isCurrent: o.id === cur.org.id,
    }));
  });

  app.post<{ Body: { orgId?: string } }>("/api/workspaces/switch", authed, async (req, reply) => {
    const orgId = req.body?.orgId;
    if (!orgId || !setCurrentOrg(req.user!.id, orgId)) return reply.code(404).send({ error: "You are not a member of that workspace." });
    const ws = currentOrgFor(req.user!.id);
    return workspaceView(ws, getUserById(ws.org.owner_user_id)?.email);
  });

  app.post<{ Body: { name?: string } }>("/api/orgs", authed, async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    if (!rateLimit(`orgs:create:${req.user!.id}`, 10, 24 * 60 * 60_000)) return reply.code(429).send({ error: "Too many workspaces created today." });
    const org = createOrg(req.user!.id, name.slice(0, 80));
    setCurrentOrg(req.user!.id, org.id);
    return reply.code(201).send(workspaceView({ org, role: "owner" }, req.user!.email));
  });

  // ── the current org ──
  app.get("/api/orgs/current", authed, async (req) => {
    const ws = currentOrgFor(req.user!.id);
    return orgDetail(ws.org.id, ws.role);
  });

  app.patch<{ Body: { name?: string } }>("/api/orgs/current", needs("admin"), async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name cannot be empty" });
    renameOrg(req.workspace!.org.id, name.slice(0, 80));
    return orgDetail(req.workspace!.org.id, req.workspace!.role);
  });

  // ── members ──
  app.patch<{ Params: { userId: string }; Body: { role?: string } }>("/api/orgs/current/members/:userId", needs("admin"), async (req, reply) => {
    const { org, role: myRole } = req.workspace!;
    const role = req.body?.role;
    if (!isRole(role) || role === "owner") return reply.code(400).send({ error: "role must be viewer, member or admin (ownership is transferred, not assigned)" });
    if (req.params.userId === org.owner_user_id) return reply.code(400).send({ error: "The owner's role cannot be changed — transfer ownership instead." });
    const current = getRole(org.id, req.params.userId);
    if (!current) return reply.code(404).send({ error: "not a member" });
    // admins cannot touch other admins; only the owner can
    if (myRole !== "owner" && (current === "admin" || role === "admin")) return reply.code(403).send({ error: "Only the owner can promote to or demote from admin.", code: "role-insufficient" });
    upsertOrgMember(org.id, req.params.userId, role);
    return orgDetail(org.id, myRole);
  });

  app.delete<{ Params: { userId: string } }>("/api/orgs/current/members/:userId", authed, async (req, reply) => {
    const ws = currentOrgFor(req.user!.id);
    const target = req.params.userId === "me" ? req.user!.id : req.params.userId;
    if (target === ws.org.owner_user_id) return reply.code(400).send({ error: "The owner cannot leave or be removed — transfer ownership first." });
    const self = target === req.user!.id;
    if (!self) {
      if (!requireRole(req, reply, "admin")) return reply;
      const targetRole = getRole(ws.org.id, target);
      if (!targetRole) return reply.code(404).send({ error: "not a member" });
      if (targetRole === "admin" && ws.role !== "owner") return reply.code(403).send({ error: "Only the owner can remove an admin.", code: "role-insufficient" });
    }
    removeOrgMember(ws.org.id, target);
    if (self) {
      const next = currentOrgFor(req.user!.id); // falls back to another workspace (or a fresh personal one)
      return { left: true, workspace: workspaceView(next, getUserById(next.org.owner_user_id)?.email) };
    }
    return orgDetail(ws.org.id, ws.role);
  });

  app.post<{ Body: { userId?: string } }>("/api/orgs/current/transfer", needs("owner"), async (req, reply) => {
    const { org } = req.workspace!;
    const to = req.body?.userId;
    if (!to || !getRole(org.id, to)) return reply.code(404).send({ error: "The new owner must already be a member." });
    if (to === org.owner_user_id) return reply.code(400).send({ error: "That user already owns the workspace." });
    transferOrgOwnership(org.id, to);
    return orgDetail(org.id, "admin");
  });

  // ── invites (by email; the invitee needs no account yet) ──
  app.post<{ Body: { email?: string; role?: string } }>("/api/orgs/current/invites", needs("admin"), async (req, reply) => {
    const { org, role: myRole } = req.workspace!;
    const email = req.body?.email?.trim().toLowerCase();
    const role = req.body?.role ?? "member";
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply.code(400).send({ error: "a valid email is required" });
    if (!isRole(role) || role === "owner") return reply.code(400).send({ error: "role must be viewer, member or admin" });
    if (role === "admin" && myRole !== "owner") return reply.code(403).send({ error: "Only the owner can invite admins.", code: "role-insufficient" });
    if (email === req.user!.email.toLowerCase()) return reply.code(400).send({ error: "You are already in this workspace." });
    if (listOrgMembers(org.id).some((m) => m.email.toLowerCase() === email)) return reply.code(409).send({ error: "That person is already a member." });
    if (!rateLimit(`orgs:invite:${org.id}`, 30, 60 * 60_000)) return reply.code(429).send({ error: "Too many invites this hour." });

    const { raw, hash } = createOpaqueToken();
    createOrgInvite(org.id, email, role, hash, req.user!.id, new Date(Date.now() + INVITE_TTL_MS).toISOString());
    const url = `${siteUrl(req)}/?invite=${raw}`;
    try {
      await sendMail({
        to: email,
        subject: `${req.user!.email} invited you to ${org.name} — Factorial AdLab`,
        html: template(
          `Join ${org.name}`,
          `${req.user!.email} invited you to the <b>${org.name}</b> workspace on Factorial AdLab as <b>${role}</b>. Sign in (or create an account) with this email address to accept.`,
          "Accept invitation",
          url,
          "The invitation is valid for 7 days. If you weren't expecting it, you can ignore this email.",
        ),
      });
    } catch {
      /* mail failures must not break the invite; the admin can resend */
    }
    return reply.code(201).send(orgDetail(org.id, myRole));
  });

  app.delete<{ Params: { id: string } }>("/api/orgs/current/invites/:id", needs("admin"), async (req, reply) => {
    if (!deleteInvite(req.params.id, req.workspace!.org.id)) return reply.code(404).send({ error: "not found" });
    return orgDetail(req.workspace!.org.id, req.workspace!.role);
  });

  /** Public: what an invite link is for (so the auth screen can say "sign in as x@y to join Z"). */
  app.get<{ Params: { token: string } }>("/api/invites/:token", async (req, reply) => {
    const inv = findInviteByHash(hashOpaqueToken(req.params.token));
    if (!inv) return reply.code(404).send({ error: "This invitation link is not valid." });
    const expired = inv.expires_at <= new Date().toISOString();
    return { org: inv.org_name, email: inv.email, role: inv.role, expired, accepted: !!inv.accepted_at };
  });

  app.post<{ Body: { token?: string } }>("/api/invites/accept", authed, async (req, reply) => {
    const raw = req.body?.token?.trim();
    if (!raw) return reply.code(400).send({ error: "token required" });
    const inv = findInviteByHash(hashOpaqueToken(raw));
    if (!inv) return reply.code(404).send({ error: "This invitation link is not valid." });
    if (inv.accepted_at) return reply.code(410).send({ error: "This invitation was already used." });
    if (inv.expires_at <= new Date().toISOString()) return reply.code(410).send({ error: "This invitation has expired — ask for a new one." });
    if (inv.email.toLowerCase() !== req.user!.email.toLowerCase()) {
      return reply.code(403).send({ error: `This invitation is for ${inv.email}. Sign in with that account to accept it.`, code: "invite-email-mismatch" });
    }
    upsertOrgMember(inv.org_id, req.user!.id, inv.role as OrgRole);
    markInviteAccepted(inv.id);
    setCurrentOrg(req.user!.id, inv.org_id);
    const ws = currentOrgFor(req.user!.id);
    return { joined: true, workspace: workspaceView(ws, getUserById(ws.org.owner_user_id)?.email) };
  });
}
