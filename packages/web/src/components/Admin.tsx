import { useEffect, useState } from "react";
import {
  adminOverview,
  adminUsers,
  adminSetUser,
  adminDeleteUser,
  adminThreads,
  adminBugs,
  adminBugHandled,
  adminContacts,
  adminContactHandled,
  adminJobs,
  adminReminders,
  adminRunReminders,
  getThreadDetail,
  listPlans,
} from "../api";
import type { AdminOverview, AdminUser, AdminThread, AdminBug, AdminContact, AdminJob, Plan, SupportThreadDetail } from "../types";
import { ThreadView } from "./Support";
import { AdminPlugin } from "./AdminPlugin";
import { Icon } from "./icons";
import { Loading, Msg, PageHead } from "./pageKit";

export type Tab = "overview" | "users" | "support" | "bugs" | "contact" | "jobs" | "reminders" | "plugin";
const TABS: Tab[] = ["overview", "users", "support", "bugs", "contact", "jobs", "reminders", "plugin"];

/** Platform admin console (users, support inbox, bug reports, contact form, jobs, reminders). */
export function Admin({
  tab: tabParam,
  threadId,
  onNavigate,
  me,
}: {
  /** the tab from the URL (/admin/:tab) */
  tab?: string | null;
  /** the support thread from the URL (/admin/support/:threadId) */
  threadId?: string | null;
  onNavigate: (tab: Tab, threadId?: string | null) => void;
  me: string;
}) {
  const tab: Tab = TABS.includes(tabParam as Tab) ? (tabParam as Tab) : "overview";
  const setTab = (t: Tab) => onNavigate(t);
  const [ov, setOv] = useState<AdminOverview | null>(null);
  useEffect(() => {
    adminOverview().then(setOv).catch(() => {});
  }, [tab]);
  const badge: Partial<Record<Tab, number>> = ov ? { support: ov.unreadThreads, bugs: ov.openBugs, contact: ov.openContacts } : {};
  return (
    <div>
      <PageHead icon={<Icon.Shield />} title="Admin" sub="The platform console: users, the support inbox, reports, background jobs, reminders and the Unity plugin." />
      <div className="pg-tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`pg-tab${tab === t ? " on" : ""}`}>
            {t}
            {badge[t] ? <span className="pg-badge">{badge[t]}</span> : null}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview ov={ov} />}
      {tab === "users" && <Users me={me} />}
      {tab === "support" && <Inbox initialThreadId={threadId} onOpen={(id) => onNavigate("support", id)} />}
      {tab === "bugs" && <Bugs />}
      {tab === "contact" && <Contacts />}
      {tab === "jobs" && <Jobs />}
      {tab === "reminders" && <Reminders />}
      {tab === "plugin" && <AdminPlugin />}
    </div>
  );
}

function Overview({ ov }: { ov: AdminOverview | null }) {
  if (!ov) return <Loading />;
  const tiles: [string, number, string?][] = [
    ["Users", ov.users, `+${ov.usersThisWeek} this week`],
    ["Paid users", ov.paidUsers],
    ["Workspaces", ov.workspaces],
    ["Creatives", ov.creatives, `${ov.apps} apps`],
    ["Exports · 30d", ov.exports30d],
    ["Plays · 24h", ov.playsToday],
    ["Jobs queued", ov.jobsQueued, `${ov.jobsFailed7d} failed · 7d`],
    ["Open tickets", ov.openThreads, `${ov.unreadThreads} unread`],
    ["Open bugs", ov.openBugs],
    ["New contacts", ov.openContacts],
    ["Plugin downloads · 30d", ov.pluginDownloads30d, `${ov.pluginBans} active bans`],
  ];
  return (
    <div className="pg-stats">
      {tiles.map(([label, n, hint]) => (
        <div key={label} className="pg-stat">
          <div className="pg-stat-n" style={{ fontSize: 24 }}>
            {n.toLocaleString()}
          </div>
          <div className="pg-stat-l">{label}</div>
          {hint && <div className="pg-stat-h">{hint}</div>}
        </div>
      ))}
    </div>
  );
}

/** A small pill switcher (status filters). */
function Seg<T extends string | boolean>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="pg-seg mb-3.5">
      {options.map((o) => (
        <button key={String(o.v)} onClick={() => onChange(o.v)} className={value === o.v ? "on" : ""} aria-pressed={value === o.v}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Users({ me }: { me: string }) {
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [err, setErr] = useState<string | null>(null);
  async function load(query = q) {
    try {
      setRows(await adminUsers(query));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  useEffect(() => {
    void load("");
    listPlans().then(setPlans).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function act(fn: () => Promise<unknown>) {
    setErr(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  return (
    <div>
      <div className="mb-3.5 flex flex-wrap gap-2">
        <input className="pg-input min-w-[200px] flex-1" placeholder="Search email…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void load()} aria-label="Search users" />
        <button onClick={() => void load()} className="pg-btn pg-btn-ghost">
          <Icon.Search />
          Search
        </button>
      </div>
      {err && <Msg kind="err">{err}</Msg>}
      <div className="pg-tablewrap">
        <table className="pg-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Plan</th>
              <th className="r">Exports 30d</th>
              <th className="r">Creatives</th>
              <th>Last login</th>
              <th>Admin</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="font-medium">{u.email}</div>
                  <div className="text-[11.5px] text-text-3">
                    {u.workspace ?? "—"} · joined {new Date(u.createdAt).toLocaleDateString()}
                    {!u.emailVerified && " · unverified"}
                  </div>
                </td>
                <td>
                  <select
                    value={u.plan}
                    onChange={(e) => void act(() => adminSetUser(u.id, { plan: e.target.value }))}
                    className="pg-input sm w-auto"
                    title="Manual override — a later Stripe webhook wins"
                    aria-label={`Plan for ${u.email}`}
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="r">{u.exports30d}</td>
                <td className="r">{u.creatives}</td>
                <td className="dim">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "never"}</td>
                <td>
                  <input
                    type="checkbox"
                    className="pg-check"
                    checked={u.isAdmin}
                    disabled={u.email === me}
                    onChange={(e) => void act(() => adminSetUser(u.id, { admin: e.target.checked }))}
                    aria-label={`Platform admin: ${u.email}`}
                  />
                </td>
                <td className="r">
                  {u.email !== me && (
                    <button
                      onClick={() => window.confirm(`Delete ${u.email} and every workspace they own? This cannot be undone.`) && void act(() => adminDeleteUser(u.id))}
                      className="pg-link danger text-[13px]"
                    >
                      Delete
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Inbox({ initialThreadId, onOpen }: { initialThreadId?: string | null; onOpen?: (id: string) => void }) {
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [rows, setRows] = useState<AdminThread[]>([]);
  const [active, setActive] = useState<SupportThreadDetail | null>(null);
  async function load() {
    setRows(await adminThreads(status).catch(() => []));
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
  useEffect(() => {
    if (initialThreadId) getThreadDetail(initialThreadId, true).then(setActive).catch(() => {});
    else setActive(null);
  }, [initialThreadId]);
  async function open(id: string) {
    onOpen?.(id);
    setActive(await getThreadDetail(id, true));
    void load();
  }
  return (
    <div className="grid gap-[18px] md:grid-cols-[320px_minmax(0,1fr)]">
      <aside className="min-w-0">
        <Seg
          value={status}
          onChange={setStatus}
          options={[
            { v: "open", label: "Open" },
            { v: "closed", label: "Closed" },
            { v: "all", label: "All" },
          ]}
        />
        <div className="grid gap-1.5">
          {rows.length === 0 && <p className="pg-p">Nothing here.</p>}
          {rows.map((t) => (
            <button key={t.id} onClick={() => void open(t.id)} className={`pg-item${active?.id === t.id ? " on" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="pg-item-t">{t.subject}</span>
                {t.unread > 0 && <span className="pg-badge shrink-0">{t.unread}</span>}
              </div>
              <div className="pg-item-s">
                {t.userEmail} · {t.workspace} · {t.plan ?? "free"} · {new Date(t.updatedAt).toLocaleDateString()}
              </div>
            </button>
          ))}
        </div>
      </aside>
      <section className="min-w-0">
        {active ? (
          <ThreadView
            thread={active}
            asSupport
            onChanged={(t) => {
              setActive(t);
              void load();
            }}
          />
        ) : (
          <div className="pg-empty">Pick a ticket.</div>
        )}
      </section>
    </div>
  );
}

function Bugs() {
  const [handled, setHandled] = useState(false);
  const [rows, setRows] = useState<AdminBug[]>([]);
  const load = () => adminBugs(handled).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handled]);
  return (
    <List
      handled={handled}
      setHandled={setHandled}
      empty="No bug reports."
      items={rows.map((b) => ({
        id: b.id,
        title: b.title,
        meta: `${b.userEmail ?? "?"} · ${b.workspace ?? "?"}${b.page ? ` · ${b.page}` : ""} · ${new Date(b.createdAt).toLocaleString()}`,
        body: b.body,
        done: !!b.handledAt,
        onDone: () => adminBugHandled(b.id).then(load),
      }))}
    />
  );
}

function Contacts() {
  const [handled, setHandled] = useState(false);
  const [rows, setRows] = useState<AdminContact[]>([]);
  const load = () => adminContacts(handled).then(setRows).catch(() => setRows([]));
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handled]);
  return (
    <List
      handled={handled}
      setHandled={setHandled}
      empty="No contact messages."
      items={rows.map((c) => ({
        id: c.id,
        title: `${c.name}${c.company ? ` · ${c.company}` : ""}`,
        meta: `${c.email} · ${new Date(c.createdAt).toLocaleString()}`,
        body: c.message,
        done: !!c.handledAt,
        href: `mailto:${c.email}?subject=${encodeURIComponent("Re: Factorial AdLab")}`,
        onDone: () => adminContactHandled(c.id).then(load),
      }))}
    />
  );
}

function List({
  handled,
  setHandled,
  items,
  empty,
}: {
  handled: boolean;
  setHandled: (v: boolean) => void;
  empty: string;
  items: { id: string; title: string; meta: string; body: string; done: boolean; href?: string; onDone: () => Promise<unknown> }[];
}) {
  return (
    <div>
      <Seg
        value={handled}
        onChange={setHandled}
        options={[
          { v: false, label: "New" },
          { v: true, label: "Handled" },
        ]}
      />
      <div className="grid gap-2.5">
        {items.length === 0 && <div className="pg-empty">{empty}</div>}
        {items.map((i) => (
          <div key={i.id} className="pg-card" style={{ padding: "16px 18px" }}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-semibold text-text" style={{ overflowWrap: "anywhere" }}>
                  {i.title}
                </div>
                <div className="text-[12px] text-text-3" style={{ overflowWrap: "anywhere" }}>
                  {i.meta}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {i.href && (
                  <a href={i.href} className="pg-btn pg-btn-ghost pg-btn-sm">
                    <Icon.Mail />
                    Reply by email
                  </a>
                )}
                {!i.done ? (
                  <button onClick={() => void i.onDone()} className="pg-btn pg-btn-ghost pg-btn-sm">
                    <Icon.Check />
                    Mark handled
                  </button>
                ) : (
                  <span className="pg-tag ok">Handled</span>
                )}
              </div>
            </div>
            <div className="mt-2.5 whitespace-pre-wrap text-[14px] leading-relaxed text-text-2" style={{ overflowWrap: "anywhere" }}>
              {i.body}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Jobs() {
  const [status, setStatus] = useState<string>("");
  const [rows, setRows] = useState<AdminJob[]>([]);
  useEffect(() => {
    adminJobs(status || undefined)
      .then(setRows)
      .catch(() => setRows([]));
  }, [status]);
  return (
    <div>
      <Seg value={status} onChange={setStatus} options={["", "queued", "running", "failed", "done"].map((s) => ({ v: s, label: s ? s[0]!.toUpperCase() + s.slice(1) : "All" }))} />
      <div className="pg-tablewrap">
        <table className="pg-table">
          <thead>
            <tr>
              <th>Kind</th>
              <th>Status</th>
              <th>User</th>
              <th>Created</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="dim">
                  No jobs.
                </td>
              </tr>
            )}
            {rows.map((j) => (
              <tr key={j.id}>
                <td className="l">{j.kind}</td>
                <td>
                  <span className={`pg-tag ${j.status === "failed" ? "err" : j.status === "done" ? "ok" : j.status === "running" ? "brand" : ""}`}>{j.status}</span>
                  {j.attempts > 1 && <span className="dim"> ×{j.attempts}</span>}
                </td>
                <td className="dim">{j.userEmail}</td>
                <td className="dim">{new Date(j.createdAt).toLocaleString()}</td>
                <td className="max-w-[360px] truncate text-[#b91c1c]" title={j.error ?? ""}>
                  {j.error}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Reminders() {
  const [data, setData] = useState<{ kinds: string[]; candidates: Record<string, { id: string; email: string }[]> } | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => adminReminders().then(setData).catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  async function run(dryRun: boolean) {
    if (!dryRun && !window.confirm("Send reminder emails to every candidate now?")) return;
    setBusy(true);
    try {
      const r = await adminRunReminders(dryRun);
      const n = (k: string) => r.candidates[k]?.length ?? 0;
      setResult(dryRun ? `Dry run: would email ${n("no-export")} never-exported + ${n("dormant")} dormant.` : `Sent ${r.sent["no-export"] ?? 0} + ${r.sent.dormant ?? 0}.`);
      await load();
    } finally {
      setBusy(false);
    }
  }
  if (!data) return <Loading />;
  const label: Record<string, string> = { "no-export": "Signed up ≥3 days ago, never exported", dormant: "Exported before, no login for 14 days" };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button onClick={() => void run(true)} disabled={busy} className="pg-btn pg-btn-ghost">
          Dry run
        </button>
        <button onClick={() => void run(false)} disabled={busy} className="pg-btn pg-btn-primary">
          <Icon.Mail />
          Send now
        </button>
        {result && <span className="pg-tag brand">{result}</span>}
      </div>
      <p className="pg-hint" style={{ margin: "0 0 16px" }}>
        Each person gets each nudge once (dormant: at most every 30 days). Daily automatic run when REMINDERS_AUTO=1.
      </p>
      <div className="grid gap-[18px] md:grid-cols-2">
        {data.kinds.map((k) => (
          <section key={k} className="pg-card">
            <div className="pg-card-head">
              <h3 className="pg-h" style={{ fontSize: 15 }}>
                {label[k] ?? k}
              </h3>
              <span className="pg-count">{data.candidates[k]?.length ?? 0}</span>
            </div>
            <div className="grid max-h-64 gap-1 overflow-auto text-[13px] text-text-2">
              {(data.candidates[k] ?? []).map((u) => (
                <div key={u.id}>{u.email}</div>
              ))}
              {(data.candidates[k] ?? []).length === 0 && <div className="text-text-3">Nobody right now.</div>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
