import { useEffect, useState, type FormEvent } from "react";
import { listThreads, openThread, getThreadDetail, replyThread, closeThread, reportBug } from "../api";
import type { SupportThread, SupportThreadDetail } from "../types";
import { Icon } from "./icons";
import { Msg, PageHead } from "./pageKit";

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
    <div>
      <PageHead
        title="Support"
        sub="Your workspace's tickets and our replies. We answer here and by email."
        actions={
          <>
            <button
              onClick={() => {
                setMode("new");
                setActive(null);
                onOpenThread?.(null);
              }}
              className="pg-btn pg-btn-primary"
            >
              <Icon.Plus />
              New ticket
            </button>
            <button
              onClick={() => {
                setMode("bug");
                setActive(null);
                onOpenThread?.(null);
              }}
              className="pg-btn pg-btn-ghost"
            >
              <Icon.Alert />
              Report a bug
            </button>
          </>
        }
      />
      {err && <Msg kind="err">{err}</Msg>}

      <div className="grid gap-[18px] md:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="grid content-start gap-1.5">
          <div className="setup-section">Tickets{threads.length ? ` · ${threads.length}` : ""}</div>
          {threads.length === 0 && <p className="pg-p">No tickets yet.</p>}
          {threads.map((t) => (
            <button key={t.id} onClick={() => void open(t.id)} className={`pg-item${active?.id === t.id ? " on" : ""}`} aria-current={active?.id === t.id ? "true" : undefined}>
              <div className="flex items-center justify-between gap-2">
                <span className="pg-item-t">{t.subject}</span>
                {t.unread > 0 && <span className="pg-badge shrink-0">{t.unread}</span>}
              </div>
              <div className="pg-item-s">
                {t.status} · {new Date(t.updatedAt).toLocaleDateString()}
              </div>
            </button>
          ))}
        </aside>

        <section className="min-w-0">
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
            <div className="pg-empty">Pick a ticket, or open a new one. We reply here and by email.</div>
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
    <form onSubmit={submit} className="pg-card grid gap-3.5">
      <h2 className="pg-h" style={{ margin: 0 }}>
        New ticket
      </h2>
      <label className="pg-field">
        <span className="pg-label">Subject</span>
        <input className="pg-input" value={subject} onChange={(e) => setSubject(e.target.value)} required maxLength={160} />
      </label>
      <label className="pg-field">
        <span className="pg-label">Message</span>
        <textarea
          className="pg-input min-h-[160px]"
          placeholder="What's going on? Playable and network names, and what you expected, help a lot."
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          required
        />
      </label>
      {err && <Msg kind="err">{err}</Msg>}
      <div>
        <button disabled={busy} className="pg-btn pg-btn-primary">
          {busy ? "Sending…" : "Open ticket"}
        </button>
      </div>
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
    <div className="pg-card">
      <div className="pg-card-head" style={{ alignItems: "flex-start" }}>
        <div className="min-w-0">
          <h2 className="pg-h" style={{ margin: 0, overflowWrap: "anywhere" }}>
            {thread.subject}
          </h2>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-text-3">
            <span className={`pg-tag ${thread.status === "closed" ? "" : "brand"}`}>{thread.status}</span>
            {asSupport && thread.user?.email && <span>{thread.user.email}</span>}
          </div>
        </div>
        <button onClick={() => void toggle()} disabled={busy} className="pg-btn pg-btn-ghost pg-btn-sm">
          {thread.status === "closed" ? "Reopen" : "Close ticket"}
        </button>
      </div>
      <div className="mb-4 grid gap-2.5">
        {thread.messages.map((m) => (
          <div key={m.id} className={`pg-bubble ${m.fromSupport ? "them" : "me"}`}>
            <div className="pg-bubble-meta">
              {m.fromSupport ? "Factorial support" : (m.authorEmail ?? "you")} · {new Date(m.createdAt).toLocaleString()}
            </div>
            <div className="whitespace-pre-wrap text-text" style={{ overflowWrap: "anywhere" }}>
              {m.body}
            </div>
          </div>
        ))}
      </div>
      <form onSubmit={send} className="grid gap-2.5 border-t border-line pt-4">
        <textarea
          className="pg-input min-h-[90px]"
          placeholder={asSupport ? "Reply as support (emailed to the user)…" : "Reply…"}
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          aria-label="Reply"
        />
        {err && <Msg kind="err">{err}</Msg>}
        <button disabled={busy || !reply.trim()} className="pg-btn pg-btn-primary justify-self-end">
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
      <div className="pg-card">
        <Msg kind="success">Thanks, the bug report reached the team.</Msg>
        <button onClick={onDone} className="pg-link mt-3">
          Back to tickets
        </button>
      </div>
    );
  return (
    <form onSubmit={submit} className="pg-card grid gap-3.5">
      <h2 className="pg-h" style={{ margin: 0 }}>
        Report a bug
      </h2>
      <label className="pg-field">
        <span className="pg-label">Title</span>
        <input className="pg-input" placeholder="Short title" value={title} onChange={(e) => setTitle(e.target.value)} required maxLength={160} />
      </label>
      <label className="pg-field">
        <span className="pg-label">What happened</span>
        <textarea
          className="pg-input min-h-[160px]"
          placeholder="Steps to reproduce, what happened, what you expected, network and browser."
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
        />
      </label>
      {err && <Msg kind="err">{err}</Msg>}
      <div>
        <button disabled={busy} className="pg-btn pg-btn-primary">
          {busy ? "Sending…" : "Send report"}
        </button>
      </div>
    </form>
  );
}
