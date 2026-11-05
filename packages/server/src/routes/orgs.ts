import type { FastifyInstance, FastifyRequest } from "fastify";
import { authed, createOpaqueToken, hashOpaqueToken } from "../auth.js";
import {
  setOrgRequire2fa,
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
import { escapeHtml } from "./support.js";
import { rateLimit } from "../rate-limit.js";

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

async function orgDetail(orgId: string, viewerRole: OrgRole) {
  const org = (await getOrg(orgId))!;
  const owner = await getUserById(org.owner_user_id);
  return {
    id: org.id,
    name: org.name,
    role: viewerRole,
    require2fa: !!org.require_2fa,
    owner: { id: org.owner_user_id, email: owner?.email ?? null },
    members: (await listOrgMembers(org.id)).map((m) => ({ ...m, twoFactor: !!m.twoFactor })),
    // pending invites are admin-only information
    invites: atLeast(viewerRole, "admin") ? (await listOrgInvites(org.id)).map(inviteView) : [],
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

/** Tell members without 2FA that the workspace now requires it (best effort). */
async function notify2faRequired(req: FastifyRequest, orgId: string, orgName: string, byEmail: string): Promise<void> {
  for (const m of await listOrgMembers(orgId)) {
    if (m.twoFactor) continue;
    try {
      await sendMail({
        to: m.email,
        subject: `${orgName} now requires two-factor authentication — Factorial AdLab`,
        html: template(
          "Turn on two-factor authentication",
          `${escapeHtml(byEmail)} made two-factor authentication required in the ${escapeHtml(orgName)} workspace. Until you turn it on, you can still sign in, but the workspace stays locked.`,
          "Set it up now",
          `${siteUrl(req)}/settings`,
          "It takes a minute with any authenticator app (Google Authenticator, 1Password, Authy…).",
        ),
      });
    } catch {
      /* mail is best effort */
    }
  }
}

export async function orgRoutes(app: FastifyInstance): Promise<void> {
  // ── workspaces: list + switch + create ──
  app.get("/api/workspaces", authed, async (req) => {
    const cur = await currentOrgFor(req.user!.id);
    return (await listUserOrgs(req.user!.id)).map((o) => ({
      id: o.id,
      name: o.name,
      role: o.role,
      ownerEmail: o.owner_email,
      memberCount: o.member_count,
      require2fa: !!o.require_2fa,
      isCurrent: o.id === cur.org.id,
    }));
  });

  app.post<{ Body: { orgId?: string } }>("/api/workspaces/switch", authed, async (req, reply) => {
    const orgId = req.body?.orgId;
    if (!orgId || !await setCurrentOrg(req.user!.id, orgId)) return reply.code(404).send({ error: "You are not a member of that workspace." });
    const ws = await currentOrgFor(req.user!.id);
    return workspaceView(ws, (await getUserById(ws.org.owner_user_id))?.email);
  });

  app.post<{ Body: { name?: string } }>("/api/orgs", authed, async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    if (!await rateLimit(`orgs:create:${req.user!.id}`, 10, 24 * 60 * 60_000)) return reply.code(429).send({ error: "Too many workspaces created today." });
    const org = await createOrg(req.user!.id, name.slice(0, 80));
    await setCurrentOrg(req.user!.id, org.id);
    return reply.code(201).send(workspaceView({ org, role: "owner" }, req.user!.email));
  });

  // ── the current org ──
  app.get("/api/orgs/current", authed, async (req) => {
    const ws = await currentOrgFor(req.user!.id);
    return await orgDetail(ws.org.id, ws.role);
  });

  /** Rename, and/or set the two-factor policy (`require2fa`) — admins. */
  app.patch<{ Body: { name?: string; require2fa?: boolean } }>("/api/orgs/current", needs("admin"), async (req, reply) => {
    const { org, role } = req.workspace!;
    if (req.body?.name !== undefined) {
      const name = req.body.name?.trim();
      if (!name) return reply.code(400).send({ error: "name cannot be empty" });
      await renameOrg(org.id, name.slice(0, 80));
    }
    if (req.body?.require2fa !== undefined) {
      const on = req.body.require2fa === true;
      // whoever changes the policy must already comply, so turning it on can never lock out the admin
      if (!(await getUserById(req.user!.id))?.totp_enabled)
        return reply.code(400).send({ error: "Turn on two-factor authentication for your own account first (Settings ▸ Security).", code: "2fa-self-required" });
      if (on !== !!org.require_2fa) {
        await setOrgRequire2fa(org.id, on);
        if (on) await notify2faRequired(req, org.id, org.name, req.user!.email);
      }
    }
    return await orgDetail(org.id, role);
  });

  // ── members ──
  app.patch<{ Params: { userId: string }; Body: { role?: string } }>("/api/orgs/current/members/:userId", needs("admin"), async (req, reply) => {
    const { org, role: myRole } = req.workspace!;
    const role = req.body?.role;
    if (!isRole(role) || role === "owner") return reply.code(400).send({ error: "role must be viewer, member or admin (ownership is transferred, not assigned)" });
    if (req.params.userId === org.owner_user_id) return reply.code(400).send({ error: "The owner's role cannot be changed — transfer ownership instead." });
    const current = await getRole(org.id, req.params.userId);
    if (!current) return reply.code(404).send({ error: "not a member" });
    // admins cannot touch other admins; only the owner can
    if (myRole !== "owner" && (current === "admin" || role === "admin")) return reply.code(403).send({ error: "Only the owner can promote to or demote from admin.", code: "role-insufficient" });
    await upsertOrgMember(org.id, req.params.userId, role);
    return await orgDetail(org.id, myRole);
  });

  app.delete<{ Params: { userId: string } }>("/api/orgs/current/members/:userId", authed, async (req, reply) => {
    const ws = await currentOrgFor(req.user!.id);
    const target = req.params.userId === "me" ? req.user!.id : req.params.userId;
    if (target === ws.org.owner_user_id) return reply.code(400).send({ error: "The owner cannot leave or be removed — transfer ownership first." });
    const self = target === req.user!.id;
    if (!self) {
      if (!await requireRole(req, reply, "admin")) return reply;
      const targetRole = await getRole(ws.org.id, target);
      if (!targetRole) return reply.code(404).send({ error: "not a member" });
      if (targetRole === "admin" && ws.role !== "owner") return reply.code(403).send({ error: "Only the owner can remove an admin.", code: "role-insufficient" });
    }
    await removeOrgMember(ws.org.id, target);
    if (self) {
      const next = await currentOrgFor(req.user!.id); // falls back to another workspace (or a fresh personal one)
      return { left: true, workspace: workspaceView(next, (await getUserById(next.org.owner_user_id))?.email) };
    }
    return await orgDetail(ws.org.id, ws.role);
  });

  app.post<{ Body: { userId?: string } }>("/api/orgs/current/transfer", needs("owner"), async (req, reply) => {
    const { org } = req.workspace!;
    const to = req.body?.userId;
    if (!to || !await getRole(org.id, to)) return reply.code(404).send({ error: "The new owner must already be a member." });
    if (to === org.owner_user_id) return reply.code(400).send({ error: "That user already owns the workspace." });
    await transferOrgOwnership(org.id, to);
    return await orgDetail(org.id, "admin");
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
    if ((await listOrgMembers(org.id)).some((m) => m.email.toLowerCase() === email)) return reply.code(409).send({ error: "That person is already a member." });
    if (!await rateLimit(`orgs:invite:${org.id}`, 30, 60 * 60_000)) return reply.code(429).send({ error: "Too many invites this hour." });

    const { raw, hash } = createOpaqueToken();
    await createOrgInvite(org.id, email, role, hash, req.user!.id, new Date(Date.now() + INVITE_TTL_MS).toISOString());
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
    return reply.code(201).send(await orgDetail(org.id, myRole));
  });

  app.delete<{ Params: { id: string } }>("/api/orgs/current/invites/:id", needs("admin"), async (req, reply) => {
    if (!await deleteInvite(req.params.id, req.workspace!.org.id)) return reply.code(404).send({ error: "not found" });
    return await orgDetail(req.workspace!.org.id, req.workspace!.role);
  });

  /** Public: what an invite link is for (so the auth screen can say "sign in as x@y to join Z"). */
  app.get<{ Params: { token: string } }>("/api/invites/:token", async (req, reply) => {
    const inv = await findInviteByHash(hashOpaqueToken(req.params.token));
    if (!inv) return reply.code(404).send({ error: "This invitation link is not valid." });
    const expired = inv.expires_at <= new Date().toISOString();
    return { org: inv.org_name, email: inv.email, role: inv.role, expired, accepted: !!inv.accepted_at };
  });

  app.post<{ Body: { token?: string } }>("/api/invites/accept", authed, async (req, reply) => {
    const raw = req.body?.token?.trim();
    if (!raw) return reply.code(400).send({ error: "token required" });
    const inv = await findInviteByHash(hashOpaqueToken(raw));
    if (!inv) return reply.code(404).send({ error: "This invitation link is not valid." });
    if (inv.accepted_at) return reply.code(410).send({ error: "This invitation was already used." });
    if (inv.expires_at <= new Date().toISOString()) return reply.code(410).send({ error: "This invitation has expired — ask for a new one." });
    if (inv.email.toLowerCase() !== req.user!.email.toLowerCase()) {
      return reply.code(403).send({ error: `This invitation is for ${inv.email}. Sign in with that account to accept it.`, code: "invite-email-mismatch" });
    }
    await upsertOrgMember(inv.org_id, req.user!.id, inv.role as OrgRole);
    await markInviteAccepted(inv.id);
    await setCurrentOrg(req.user!.id, inv.org_id);
    const ws = await currentOrgFor(req.user!.id);
    return { joined: true, workspace: workspaceView(ws, (await getUserById(ws.org.owner_user_id))?.email) };
  });
}
