import type { FastifyInstance } from "fastify";
import { authed } from "../auth.js";
import {
  addMessage,
  createBug,
  createContact,
  createThread,
  currentOrgFor,
  getThread,
  getUserById,
  listMessages,
  listThreadsForOrg,
  markThreadRead,
  setThreadStatus,
  unreadForOrg,
} from "../repo.js";
import { config } from "../config.js";
import { sendMail, template } from "../mail.js";
import { rateLimit } from "../rate-limit.js";
import { siteUrl } from "../site.js";
import { requireHuman } from "../turnstile.js";

const MAX_BODY = 5000;
const clean = (s: unknown, max: number) => String(s ?? "").trim().slice(0, max);

export const threadView = (t: { id: string; subject: string; status: string; created_at: string; updated_at: string; user_unread: number; admin_unread: number }, forAdmin = false) => ({
  id: t.id,
  subject: t.subject,
  status: t.status,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
  unread: forAdmin ? t.admin_unread : t.user_unread,
});
export const messageView = (m: { id: string; author_user_id: string; is_admin: number; body: string; created_at: string }, authorEmail?: string | null) => ({
  id: m.id,
  authorId: m.author_user_id,
  authorEmail: authorEmail ?? null,
  fromSupport: m.is_admin === 1,
  body: m.body,
  createdAt: m.created_at,
});

/** Notify the support inbox; never throws (ops mail must not fail a user action). */
export async function notifySupport(subject: string, intro: string, ctaUrl: string): Promise<void> {
  try {
    await sendMail({ to: config.supportEmail, subject, html: template(subject, intro, "Open admin console", ctaUrl, "Factorial AdLab ops notification.") });
  } catch {
    /* ignore */
  }
}

/**
 * Support threads (workspace-scoped), bug reports and the public contact form — the competitor's
 * `/support/*`, `/feedback/*`, `/contact*`. Admin-side views live in routes/admin.ts; admins reply
 * through the same thread endpoints (their messages are flagged `fromSupport`).
 */
/**
 * Is the caller acting as SUPPORT on this thread? Only a platform admin, and only when they say so
 * (`?as=support`, sent by the admin console) or the thread belongs to a workspace they are not
 * currently in. An admin reading their own workspace's ticket from the Support page is a customer.
 */
function actingAsSupport(isAdmin: boolean, as: string | undefined, threadOrg: string, myOrg: string): boolean {
  return isAdmin && (as === "support" || threadOrg !== myOrg);
}

/** A thread's messages with each author's email (one lookup per distinct author). */
async function messagesView(threadId: string) {
  const msgs = await listMessages(threadId);
  const emails = new Map<string, string | null>();
  for (const id of new Set(msgs.map((m) => m.author_user_id))) emails.set(id, (await getUserById(id))?.email ?? null);
  return msgs.map((m) => messageView(m, emails.get(m.author_user_id)));
}

export async function supportRoutes(app: FastifyInstance): Promise<void> {
  // ── threads ──
  app.get("/api/support/threads", authed, async (req) => {
    const ws = await currentOrgFor(req.user!.id);
    return (await listThreadsForOrg(ws.org.id)).map((t) => threadView(t));
  });

  app.get("/api/support/unread", authed, async (req) => ({ count: await unreadForOrg((await currentOrgFor(req.user!.id)).org.id) }));

  app.post<{ Body: { subject?: string; message?: string } }>("/api/support/thread", authed, async (req, reply) => {
    const subject = clean(req.body?.subject, 160);
    const message = clean(req.body?.message, MAX_BODY);
    if (!subject || !message) return reply.code(400).send({ error: "subject and message are required" });
    if (!await rateLimit(`support:new:${req.user!.id}`, 10, 60 * 60_000)) return reply.code(429).send({ error: "Too many tickets this hour." });
    const ws = await currentOrgFor(req.user!.id);
    const t = await createThread(ws.org.id, req.user!.id, subject);
    await addMessage(t.id, req.user!.id, false, message);
    void notifySupport(`[Support] ${subject}`, `${req.user!.email} (${ws.org.name}) opened a ticket:<br><br>${escapeHtml(message).replace(/\n/g, "<br>")}`, `${siteUrl(req)}/admin/support/${t.id}`);
    return reply.code(201).send({ ...threadView((await getThread(t.id))!), messages: (await listMessages(t.id)).map((m) => messageView(m, req.user!.email)) });
  });

  /** Read a thread (marks it read for the viewer's side). Members of the workspace, or admins. */
  app.get<{ Params: { id: string }; Querystring: { as?: string } }>("/api/support/threads/:id", authed, async (req, reply) => {
    const t = await getThread(req.params.id);
    const me = await getUserById(req.user!.id);
    const ws = await currentOrgFor(req.user!.id);
    const isAdmin = !!me?.is_admin;
    if (!t || (!isAdmin && t.org_id !== ws.org.id)) return reply.code(404).send({ error: "This ticket isn't in your current workspace." });
    const asSupport = actingAsSupport(isAdmin, req.query?.as, t.org_id, ws.org.id);
    await markThreadRead(t.id, asSupport);
    const author = await getUserById(t.user_id);
    return {
      ...threadView((await getThread(t.id))!, asSupport),
      user: { id: t.user_id, email: author?.email ?? null },
      orgId: t.org_id,
      messages: await messagesView(t.id),
    };
  });

  app.post<{ Params: { id: string }; Querystring: { as?: string }; Body: { message?: string } }>("/api/support/threads/:id/reply", authed, async (req, reply) => {
    const t = await getThread(req.params.id);
    const me = await getUserById(req.user!.id);
    const ws = await currentOrgFor(req.user!.id);
    if (!t || (!me?.is_admin && t.org_id !== ws.org.id)) return reply.code(404).send({ error: "This ticket isn't in your current workspace." });
    // "isAdmin" below means: this message is FROM SUPPORT (flagged, emailed to the user)
    const isAdmin = actingAsSupport(!!me?.is_admin, req.query?.as, t.org_id, ws.org.id);
    const message = clean(req.body?.message, MAX_BODY);
    if (!message) return reply.code(400).send({ error: "message required" });
    if (!await rateLimit(`support:reply:${req.user!.id}`, 60, 60 * 60_000)) return reply.code(429).send({ error: "Slow down." });
    await addMessage(t.id, req.user!.id, isAdmin, message);
    if (t.status === "closed") await setThreadStatus(t.id, "open");
    if (isAdmin) {
      const user = await getUserById(t.user_id);
      if (user) {
        try {
          await sendMail({
            to: user.email,
            subject: `Re: ${t.subject} — Factorial AdLab support`,
            html: template("Support replied", escapeHtml(message).replace(/\n/g, "<br>"), "Open the conversation", `${siteUrl(req)}/support/${t.id}`, "Reply from the Support page in your dashboard."),
          });
        } catch {
          /* ignore */
        }
      }
    } else {
      void notifySupport(`[Support] Re: ${t.subject}`, `${req.user!.email} replied:<br><br>${escapeHtml(message).replace(/\n/g, "<br>")}`, `${siteUrl(req)}/admin/support/${t.id}`);
    }
    return { ...threadView((await getThread(t.id))!, isAdmin), messages: await messagesView(t.id) };
  });

  app.post<{ Params: { id: string }; Querystring: { as?: string }; Body: { status?: string } }>("/api/support/threads/:id/close", authed, async (req, reply) => {
    const t = await getThread(req.params.id);
    const me = await getUserById(req.user!.id);
    const ws = await currentOrgFor(req.user!.id);
    if (!t || (!me?.is_admin && t.org_id !== ws.org.id)) return reply.code(404).send({ error: "This ticket isn't in your current workspace." });
    const status = req.body?.status === "open" ? "open" : "closed";
    await setThreadStatus(t.id, status);
    return threadView((await getThread(t.id))!, actingAsSupport(!!me?.is_admin, req.query?.as, t.org_id, ws.org.id));
  });

  // ── bug reports ──
  app.post<{ Body: { title?: string; body?: string; page?: string } }>("/api/feedback/bug", authed, async (req, reply) => {
    const title = clean(req.body?.title, 160);
    const body = clean(req.body?.body, MAX_BODY);
    if (!title || !body) return reply.code(400).send({ error: "title and body are required" });
    if (!await rateLimit(`bug:${req.user!.id}`, 20, 60 * 60_000)) return reply.code(429).send({ error: "Too many reports this hour." });
    const ws = await currentOrgFor(req.user!.id);
    const b = await createBug(ws.org.id, req.user!.id, title, body, clean(req.body?.page, 200) || null);
    void notifySupport(`[Bug] ${title}`, `${req.user!.email} (${ws.org.name})${b.page ? ` on ${escapeHtml(b.page)}` : ""}:<br><br>${escapeHtml(body).replace(/\n/g, "<br>")}`, `${siteUrl(req)}/admin/bugs`);
    return reply.code(201).send({ id: b.id, title: b.title, createdAt: b.created_at });
  });

  // ── public contact form (landing "Contact sales", Enterprise) ──
  app.post<{ Body: { name?: string; email?: string; company?: string; message?: string; website?: string; turnstileToken?: string } }>("/api/contact", async (req, reply) => {
    // honeypot: real forms leave `website` empty; bots fill it → pretend success
    if (req.body?.website) return { ok: true };
    const name = clean(req.body?.name, 120);
    const email = clean(req.body?.email, 200).toLowerCase();
    const company = clean(req.body?.company, 160) || null;
    const message = clean(req.body?.message, MAX_BODY);
    if (!name || !message || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply.code(400).send({ error: "name, a valid email and a message are required" });
    if (!await rateLimit(`contact:${req.ip}`, 5, 60 * 60_000)) return reply.code(429).send({ error: "Too many messages — try again later." });
    if (!(await requireHuman(req, reply, "contact"))) return reply;
    const c = await createContact(name, email, company, message);
    void notifySupport(`[Contact] ${name}${company ? ` · ${company}` : ""}`, `${escapeHtml(name)} &lt;${escapeHtml(email)}&gt;${company ? ` (${escapeHtml(company)})` : ""}:<br><br>${escapeHtml(message).replace(/\n/g, "<br>")}`, `${siteUrl(req)}/admin/contact`);
    return reply.code(201).send({ ok: true, id: c.id });
  });
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
