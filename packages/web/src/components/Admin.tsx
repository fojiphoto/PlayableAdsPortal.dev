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

type Tab = "overview" | "users" | "support" | "bugs" | "contact" | "jobs" | "reminders";
const TABS: Tab[] = ["overview", "users", "support", "bugs", "contact", "jobs", "reminders"];

/** Platform admin console (users, support inbox, bug reports, contact form, jobs, reminders). */
export function Admin({ initialTab, initialThreadId, me }: { initialTab?: string | null; initialThreadId?: string | null; me: string }) {
  const [tab, setTab] = useState<Tab>(TABS.includes(initialTab as Tab) ? (initialTab as Tab) : "overview");
  const [ov, setOv] = useState<AdminOverview | null>(null);
  useEffect(() => {
    adminOverview().then(setOv).catch(() => {});
  }, [tab]);
  const badge: Partial<Record<Tab, number>> = ov ? { support: ov.unreadThreads, bugs: ov.openBugs, contact: ov.openContacts } : {};
  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="mb-4 text-2xl font-semibold text-slate-100">Admin</h1>
      <div className="mb-6 flex flex-wrap gap-1.5 text-sm">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-lg border px-3 py-1.5 capitalize ${tab === t ? "border-amber-500 bg-amber-500/10 text-amber-200" : "border-[#1b5540] text-slate-300 hover:border-[#7cb342]"}`}
          >
            {t}
            {badge[t] ? <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-black">{badge[t]}</span> : null}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview ov={ov} />}
      {tab === "users" && <Users me={me} />}
      {tab === "support" && <Inbox initialThreadId={initialThreadId} />}
      {tab === "bugs" && <Bugs />}
      {tab === "contact" && <Contacts />}
      {tab === "jobs" && <Jobs />}
      {tab === "reminders" && <Reminders />}
    </div>
  );
}

function Overview({ ov }: { ov: AdminOverview | null }) {
  if (!ov) return <div className="text-sm text-slate-400">Loading…</div>;
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
  ];
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
      {tiles.map(([label, n, hint]) => (
        <div key={label} className={panel}>
          <div className="text-2xl text-amber-400" style={{ fontFamily: "Bungee, sans-serif" }}>
            {n.toLocaleString()}
          </div>
          <div className="text-xs text-slate-400">{label}</div>
          {hint && <div className="text-[11px] text-slate-500">{hint}</div>}
        </div>
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
      <div className="mb-3 flex gap-2">
        <input className={input} placeholder="Search email…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void load()} />
        <button onClick={() => void load()} className="rounded-lg border border-[#1f6b4a] px-3 text-sm text-slate-200 hover:border-[#7cb342]">
          Search
        </button>
      </div>
      {err && <div className="mb-2 text-sm text-red-400">{err}</div>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="pb-2 pr-3">Email</th>
              <th className="pb-2 pr-3">Plan</th>
              <th className="pb-2 pr-3 text-right">Exports 30d</th>
              <th className="pb-2 pr-3 text-right">Creatives</th>
              <th className="pb-2 pr-3">Last login</th>
              <th className="pb-2 pr-3">Admin</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id} className="border-t border-[#1b5540]/60">
                <td className="py-2 pr-3">
                  <div className="text-slate-100">{u.email}</div>
                  <div className="text-[11px] text-slate-500">
                    {u.workspace ?? "—"} · joined {new Date(u.createdAt).toLocaleDateString()}
                    {!u.emailVerified && " · unverified"}
                  </div>
                </td>
                <td className="py-2 pr-3">
                  <select
                    value={u.plan}
                    onChange={(e) => void act(() => adminSetUser(u.id, { plan: e.target.value }))}
                    className="rounded border border-[#1f6b4a] bg-[#0a3a28] px-1.5 py-0.5 text-slate-200"
                    title="Manual override — a later Stripe webhook wins"
                  >
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{u.exports30d}</td>
                <td className="py-2 pr-3 text-right tabular-nums text-slate-300">{u.creatives}</td>
                <td className="py-2 pr-3 text-xs text-slate-400">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "never"}</td>
                <td className="py-2 pr-3">
                  <input
                    type="checkbox"
                    className="accent-amber-500"
                    checked={u.isAdmin}
                    disabled={u.email === me}
                    onChange={(e) => void act(() => adminSetUser(u.id, { admin: e.target.checked }))}
                  />
                </td>
                <td className="py-2 text-right">
                  {u.email !== me && (
                    <button
                      onClick={() => window.confirm(`Delete ${u.email} and every workspace they own? This cannot be undone.`) && void act(() => adminDeleteUser(u.id))}
                      className="text-xs text-red-400 hover:underline"
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

function Inbox({ initialThreadId }: { initialThreadId?: string | null }) {
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
  }, [initialThreadId]);
  async function open(id: string) {
    setActive(await getThreadDetail(id, true));
    void load();
  }
  return (
    <div className="grid gap-6 md:grid-cols-[320px_1fr]">
      <aside>
        <div className="mb-2 flex gap-1 text-xs">
          {(["open", "closed", "all"] as const).map((s) => (
            <button key={s} onClick={() => setStatus(s)} className={`rounded px-2 py-1 ${status === s ? "bg-amber-500/20 text-amber-200" : "text-slate-400"}`}>
              {s}
            </button>
          ))}
        </div>
        <div className="grid gap-1.5">
          {rows.length === 0 && <div className="text-sm text-slate-400">Nothing here.</div>}
          {rows.map((t) => (
            <button key={t.id} onClick={() => void open(t.id)} className={`rounded-lg border px-3 py-2 text-left text-sm ${active?.id === t.id ? "border-amber-500 bg-amber-500/10" : "border-[#1b5540] hover:border-[#7cb342]"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-slate-100">{t.subject}</span>
                {t.unread > 0 && <span className="shrink-0 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-black">{t.unread}</span>}
              </div>
              <div className="truncate text-[11px] text-slate-500">
                {t.userEmail} · {t.workspace} · {t.plan ?? "free"} · {new Date(t.updatedAt).toLocaleDateString()}
              </div>
            </button>
          ))}
        </div>
      </aside>
      <section>{active ? <ThreadView thread={active} asSupport onChanged={(t) => { setActive(t); void load(); }} /> : <div className="text-sm text-slate-400">Pick a ticket.</div>}</section>
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
      <div className="mb-3 flex gap-1 text-xs">
        {[false, true].map((h) => (
          <button key={String(h)} onClick={() => setHandled(h)} className={`rounded px-2 py-1 ${handled === h ? "bg-amber-500/20 text-amber-200" : "text-slate-400"}`}>
            {h ? "handled" : "new"}
          </button>
        ))}
      </div>
      <div className="grid gap-2">
        {items.length === 0 && <div className="text-sm text-slate-400">{empty}</div>}
        {items.map((i) => (
          <div key={i.id} className={panel}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-medium text-slate-100">{i.title}</div>
                <div className="text-[11px] text-slate-500">{i.meta}</div>
              </div>
              <div className="flex gap-3 text-xs">
                {i.href && (
                  <a href={i.href} className="text-amber-400 hover:underline">
                    Reply by email
                  </a>
                )}
                {!i.done && (
                  <button onClick={() => void i.onDone()} className="text-[#a3d977] hover:underline">
                    Mark handled
                  </button>
                )}
              </div>
            </div>
            <div className="mt-2 whitespace-pre-wrap text-sm text-slate-300">{i.body}</div>
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
    adminJobs(status || undefined).then(setRows).catch(() => setRows([]));
  }, [status]);
  return (
    <div>
      <div className="mb-3 flex gap-1 text-xs">
        {["", "queued", "running", "failed", "done"].map((s) => (
          <button key={s || "all"} onClick={() => setStatus(s)} className={`rounded px-2 py-1 ${status === s ? "bg-amber-500/20 text-amber-200" : "text-slate-400"}`}>
            {s || "all"}
          </button>
        ))}
      </div>
      <table className="w-full text-left text-sm">
        <thead className="text-[11px] uppercase tracking-wide text-slate-400">
          <tr>
            <th className="pb-2 pr-3">Kind</th>
            <th className="pb-2 pr-3">Status</th>
            <th className="pb-2 pr-3">User</th>
            <th className="pb-2 pr-3">Created</th>
            <th className="pb-2">Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((j) => (
            <tr key={j.id} className="border-t border-[#1b5540]/60">
              <td className="py-1.5 pr-3 text-slate-200">{j.kind}</td>
              <td className={`py-1.5 pr-3 ${j.status === "failed" ? "text-red-300" : "text-slate-300"}`}>
                {j.status}
                {j.attempts > 1 && <span className="text-slate-500"> ×{j.attempts}</span>}
              </td>
              <td className="py-1.5 pr-3 text-slate-400">{j.userEmail}</td>
              <td className="py-1.5 pr-3 text-xs text-slate-400">{new Date(j.createdAt).toLocaleString()}</td>
              <td className="max-w-[360px] truncate py-1.5 text-xs text-red-300" title={j.error ?? ""}>
                {j.error}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
  if (!data) return <div className="text-sm text-slate-400">Loading…</div>;
  const label: Record<string, string> = { "no-export": "Signed up ≥3 days ago, never exported", dormant: "Exported before, no login for 14 days" };
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <button onClick={() => void run(true)} disabled={busy} className="rounded-lg border border-[#1f6b4a] px-3 py-1.5 text-slate-200 hover:border-[#7cb342] disabled:opacity-40">
          Dry run
        </button>
        <button onClick={() => void run(false)} disabled={busy} className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-500 disabled:opacity-40">
          Send now
        </button>
        {result && <span className="text-xs text-slate-300">{result}</span>}
        <span className="text-xs text-slate-500">Each person gets each nudge once (dormant: at most every 30 days). Daily automatic run when REMINDERS_AUTO=1.</span>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {data.kinds.map((k) => (
          <div key={k} className={panel}>
            <div className="mb-2 text-sm font-medium text-slate-100">
              {label[k] ?? k} <span className="text-slate-500">· {data.candidates[k]?.length ?? 0}</span>
            </div>
            <div className="grid max-h-64 gap-0.5 overflow-auto text-xs text-slate-400">
              {(data.candidates[k] ?? []).map((u) => (
                <div key={u.id}>{u.email}</div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const panel = "rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-4";
const input = "w-full rounded-lg border border-[#1f6b4a] bg-[#06281c] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500";
