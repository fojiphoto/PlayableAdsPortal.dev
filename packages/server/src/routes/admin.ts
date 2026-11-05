import type { FastifyInstance, RouteShorthandOptions, preHandlerHookHandler } from "fastify";
import { authed } from "../auth.js";
import {
  adminStats,
  deleteUserAdmin,
  getUserById,
  listBugs,
  listContacts,
  listJobsAdmin,
  listThreadsAdmin,
  listUsersAdmin,
  markBugHandled,
  markContactHandled,
  recentLogins,
  setAdmin,
  setUserPlan,
} from "../repo.js";
import { getPlan, allPlans } from "../plans.js";
import { threadView } from "./support.js";
import { reminderCandidates, runReminders, sendReminder, REMINDER_KINDS, type ReminderKind } from "../reminders.js";
import { siteUrl } from "../site.js";

/** Route options: authenticated AND a platform admin (`users.is_admin`), else 403 `admin-only`. */
export function adminOnly(): RouteShorthandOptions {
  const base = authed as RouteShorthandOptions;
  const ph = base.preHandler;
  const prior: preHandlerHookHandler[] = ph ? (Array.isArray(ph) ? ph : [ph]) : [];
  const gate: preHandlerHookHandler = async (req, reply) => {
    if (!(await getUserById(req.user!.id))?.is_admin) return reply.code(403).send({ error: "Admin only.", code: "admin-only" });
  };
  return { ...base, preHandler: [...prior, gate] };
}

/**
 * Platform admin console API (the competitor's ops endpoints: users/role, users/remove, support
 * threads, feedback bugs, contact, reminders). Admins are bootstrapped from ADMIN_EMAILS and can
 * promote others.
 */
export async function adminRoutes(app: FastifyInstance): Promise<void> {
  const admin = adminOnly();

  app.get("/api/admin/overview", admin, async () => await adminStats());

  // ── users ──
  app.get<{ Querystring: { q?: string; limit?: string } }>("/api/admin/users", admin, async (req) =>
    (await listUsersAdmin(String(req.query?.q ?? "").trim(), Math.min(200, Number(req.query?.limit ?? 50) || 50))).map((u) => ({
      id: u.id,
      email: u.email,
      plan: u.plan,
      planName: getPlan(u.plan).name,
      isAdmin: u.is_admin === 1,
      emailVerified: u.email_verified === 1,
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
      workspace: u.org_name,
      exports30d: u.exports_30d,
      creatives: u.creatives,
    })),
  );

  app.patch<{ Params: { id: string }; Body: { admin?: boolean; plan?: string } }>("/api/admin/users/:id", admin, async (req, reply) => {
    const u = await getUserById(req.params.id);
    if (!u) return reply.code(404).send({ error: "not found" });
    if (typeof req.body?.admin === "boolean") {
      if (u.id === req.user!.id && !req.body.admin) return reply.code(400).send({ error: "You cannot remove your own admin role." });
      await setAdmin(u.id, req.body.admin);
    }
    if (req.body?.plan !== undefined) {
      if (!allPlans().some((p) => p.id === req.body!.plan)) return reply.code(400).send({ error: "unknown plan" });
      await setUserPlan(u.id, req.body.plan); // manual override (enterprise deals, comps); Stripe webhooks still win later
    }
    const fresh = (await getUserById(u.id))!;
    return { id: fresh.id, email: fresh.email, plan: fresh.plan, isAdmin: fresh.is_admin === 1 };
  });

  app.delete<{ Params: { id: string } }>("/api/admin/users/:id", admin, async (req, reply) => {
    if (req.params.id === req.user!.id) return reply.code(400).send({ error: "You cannot delete yourself." });
    return await deleteUserAdmin(req.params.id) ? { deleted: true } : reply.code(404).send({ error: "not found" });
  });

  // ── support / feedback / contact (admin views; replies go through /api/support/threads/:id/reply) ──
  app.get<{ Querystring: { status?: string } }>("/api/admin/support/threads", admin, async (req) =>
    (await listThreadsAdmin(req.query?.status === "closed" ? "closed" : req.query?.status === "all" ? undefined : "open")).map((t) => ({
      ...threadView(t, true),
      userEmail: t.user_email,
      workspace: t.org_name,
      plan: t.plan,
    })),
  );

  app.get<{ Querystring: { handled?: string } }>("/api/feedback/bugs", admin, async (req) =>
    (await listBugs(req.query?.handled === "1")).map((b) => ({
      id: b.id,
      title: b.title,
      body: b.body,
      page: b.page,
      userEmail: b.user_email,
      workspace: b.org_name,
      handledAt: b.handled_at,
      createdAt: b.created_at,
    })),
  );
  app.post<{ Params: { id: string } }>("/api/feedback/bugs/:id/handled", admin, async (req, reply) => (await markBugHandled(req.params.id) ? { handled: true } : reply.code(404).send({ error: "not found" })));

  app.get<{ Querystring: { handled?: string } }>("/api/admin/contact", admin, async (req) =>
    (await listContacts(req.query?.handled === "1")).map((c) => ({ id: c.id, name: c.name, email: c.email, company: c.company, message: c.message, handledAt: c.handled_at, createdAt: c.created_at })),
  );
  app.post<{ Params: { id: string } }>("/api/contact/:id/handled", admin, async (req, reply) => (await markContactHandled(req.params.id) ? { handled: true } : reply.code(404).send({ error: "not found" })));

  // ── jobs ──
  app.get<{ Querystring: { status?: string; limit?: string } }>("/api/admin/jobs", admin, async (req) =>
    (await listJobsAdmin(req.query?.status || undefined, Math.min(200, Number(req.query?.limit ?? 50) || 50))).map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      error: j.error,
      attempts: j.attempts,
      userEmail: j.user_email,
      createdAt: j.created_at,
      finishedAt: j.finished_at,
    })),
  );

  // ── reminders (nudges to dormant / never-exported accounts) ──
  app.get("/api/admin/reminders", admin, async () => {
    const out: Record<string, unknown> = {};
    for (const kind of REMINDER_KINDS) out[kind] = (await reminderCandidates(kind)).map((u) => ({ id: u.id, email: u.email, createdAt: u.created_at, lastLoginAt: u.last_login_at }));
    return { kinds: REMINDER_KINDS, candidates: out };
  });
  app.get("/api/admin/reminders/logins", admin, async () => (await recentLogins(50)).map((u) => ({ id: u.id, email: u.email, lastLoginAt: u.last_login_at })));
  app.post<{ Body: { dryRun?: boolean; kind?: string } }>("/api/admin/reminders/run", admin, async (req) =>
    runReminders({ dryRun: !!req.body?.dryRun, kind: REMINDER_KINDS.includes(req.body?.kind as ReminderKind) ? (req.body!.kind as ReminderKind) : undefined, site: siteUrl(req) }),
  );
  app.post<{ Body: { userId?: string; kind?: string } }>("/api/admin/reminders/send", admin, async (req, reply) => {
    const u = req.body?.userId ? await getUserById(req.body.userId) : undefined;
    const kind = req.body?.kind as ReminderKind;
    if (!u || !REMINDER_KINDS.includes(kind)) return reply.code(400).send({ error: "userId and a known kind are required" });
    await sendReminder(u, kind, siteUrl(req));
    return { sent: true };
  });
}
