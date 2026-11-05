import { useEffect, useState, type FormEvent } from "react";
import { listThreads, openThread, getThreadDetail, replyThread, closeThread, reportBug } from "../api";
import type { SupportThread, SupportThreadDetail } from "../types";

/** Support page: the workspace's tickets with replies from the team, plus a bug-report form. */
export function Support({
  initialThreadId,
  onUnreadChange,
  onOpenThread,
}: {
  initialThreadId?: string | null;
  onUnreadChange?: () => void;
  /** a ticket was opened (or null: the list / a form) — the page puts it in the URL */
  onOpenThread?: (id: string | null) => void;
}) {
  const [threads, setThreads] = useState<SupportThread[]>([]);
  const [active, setActive] = useState<SupportThreadDetail | null>(null);
  const [mode, setMode] = useState<"list" | "new" | "bug">("list");
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      setThreads(await listThreads());
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function open(id: string) {
    setErr(null);
    try {
      setActive(await getThreadDetail(id));
      setMode("list");
      onOpenThread?.(id);
      void refresh();
      onUnreadChange?.();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
    if (initialThreadId) void open(initialThreadId);
    else setActive(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialThreadId]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-slate-100">Support</h1>
        <div className="flex gap-2 text-sm">
          <button onClick={() => { setMode("new"); setActive(null); onOpenThread?.(null); }} className="rounded-lg bg-amber-600 px-3 py-1.5 font-medium text-white hover:bg-amber-500">
            New ticket
          </button>
          <button onClick={() => { setMode("bug"); setActive(null); onOpenThread?.(null); }} className="rounded-lg border border-[#1f6b4a] px-3 py-1.5 text-slate-200 hover:border-[#7cb342]">
            Report a bug
          </button>
        </div>
      </div>
      {err && <div className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2 text-sm text-red-300">{err}</div>}

      <div className="grid gap-6 md:grid-cols-[280px_1fr]">
        <aside className="grid content-start gap-1.5">
          {threads.length === 0 && <div className="text-sm text-slate-400">No tickets yet.</div>}
          {threads.map((t) => (
            <button
              key={t.id}
              onClick={() => void open(t.id)}
              className={`rounded-lg border px-3 py-2 text-left text-sm ${active?.id === t.id ? "border-amber-500 bg-amber-500/10" : "border-[#1b5540] hover:border-[#7cb342]"}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-slate-100">{t.subject}</span>
                {t.unread > 0 && <span className="shrink-0 rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-black">{t.unread}</span>}
              </div>
              <div className="text-[11px] text-slate-500">
                {t.status} · {new Date(t.updatedAt).toLocaleDateString()}
              </div>
            </button>
          ))}
        </aside>

        <section>
          {mode === "new" ? (
            <NewTicket
              onCreated={(t) => {
                setActive(t);
                setMode("list");
                onOpenThread?.(t.id);
                void refresh();
              }}
            />
          ) : mode === "bug" ? (
            <BugForm onDone={() => setMode("list")} />
          ) : active ? (
            <ThreadView
              thread={active}
              onChanged={(t) => {
                setActive(t);
                void refresh();
              }}
            />
          ) : (
            <div className="rounded-xl border border-dashed border-[#1f6b4a] p-8 text-center text-sm text-slate-400">
              Pick a ticket, or open a new one — we reply by email and here.
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function NewTicket({ onCreated }: { onCreated: (t: SupportThreadDetail) => void }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      onCreated(await openThread(subject, message));
    } catch (er) {
      setErr((er as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className={`${panel} grid gap-3`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-400">New ticket</h2>
      <input className={input} placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={160} />
      <textarea className={`${input} min-h-[160px]`} placeholder="What's going on? Creative/network names and what you expected help a lot." value={message} onChange={(e) => setMessage(e.target.value)} required />
      {err && <div className="text-sm text-red-400">{err}</div>}
      <button disabled={busy} className="justify-self-start rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40">
        {busy ? "Sending…" : "Open ticket"}
      </button>
    </form>
  );
}

export function ThreadView({ thread, onChanged, asSupport = false }: { thread: SupportThreadDetail; onChanged: (t: SupportThreadDetail) => void; asSupport?: boolean }) {
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await replyThread(thread.id, reply.trim(), asSupport);
      onChanged(await getThreadDetail(thread.id, asSupport));
      setReply("");
    } catch (er) {
      setErr((er as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function toggle() {
    setBusy(true);
    try {
      await closeThread(thread.id, thread.status === "closed" ? "open" : "closed", asSupport);
      onChanged(await getThreadDetail(thread.id, asSupport));
    } catch (er) {
      setErr((er as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={panel}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-slate-100">{thread.subject}</h2>
          <div className="text-xs text-slate-500">
            {thread.status}
            {asSupport && thread.user?.email && <> · {thread.user.email}</>}
          </div>
        </div>
        <button onClick={() => void toggle()} disabled={busy} className="text-xs text-slate-400 hover:text-amber-300 hover:underline disabled:opacity-40">
          {thread.status === "closed" ? "Reopen" : "Close ticket"}
        </button>
      </div>
      <div className="mb-4 grid gap-2">
        {thread.messages.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.fromSupport ? "justify-self-start border border-amber-500/30 bg-amber-500/5" : "justify-self-end bg-[#123f2d]"}`}
          >
            <div className="mb-1 text-[11px] text-slate-400">
              {m.fromSupport ? "Factorial support" : m.authorEmail ?? "you"} · {new Date(m.createdAt).toLocaleString()}
            </div>
            <div className="whitespace-pre-wrap text-slate-100">{m.body}</div>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="grid gap-2">
        <textarea className={`${input} min-h-[90px]`} placeholder={asSupport ? "Reply as support (emailed to the user)…" : "Reply…"} value={reply} onChange={(e) => setReply(e.target.value)} />
        {err && <div className="text-sm text-red-400">{err}</div>}
        <button disabled={busy || !reply.trim()} className="justify-self-end rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40">
          {busy ? "…" : "Send"}
        </button>
      </form>
    </div>
  );
}

function BugForm({ onDone }: { onDone: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await reportBug(title, body, window.location.pathname);
      setSent(true);
    } catch (er) {
      setErr((er as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (sent)
    return (
      <div className={panel}>
        <p className="text-sm text-[#a3d977]">Thanks — the bug report reached the team.</p>
        <button onClick={onDone} className="mt-3 text-sm text-amber-400 hover:underline">
          Back to tickets
        </button>
      </div>
    );
  return (
    <form onSubmit={submit} className={`${panel} grid gap-3`}>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-amber-400">Report a bug</h2>
      <input className={input} placeholder="Short title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={160} />
      <textarea className={`${input} min-h-[160px]`} placeholder="Steps to reproduce, what happened, what you expected, network/browser." value={body} onChange={(e) => setBody(e.target.value)} required />
      {err && <div className="text-sm text-red-400">{err}</div>}
      <button disabled={busy} className="justify-self-start rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40">
        {busy ? "Sending…" : "Send report"}
      </button>
    </form>
  );
}

const panel = "rounded-xl border border-[#1b5540] bg-[#0a3a28]/50 p-5";
const input = "w-full rounded-lg border border-[#1f6b4a] bg-[#06281c] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500";
