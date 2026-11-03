import { useState, type FormEvent } from "react";
import { sendContact } from "../api";

/** Public contact form (landing "Contact sales", Plans ▸ Enterprise). Lands in the admin console's Contact inbox. */
export function ContactDialog({ onClose, defaultEmail = "", topic = "" }: { onClose: () => void; defaultEmail?: string; topic?: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(defaultEmail);
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState(topic ? `${topic}\n\n` : "");
  const [website, setWebsite] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await sendContact({ name, email, company, message, website });
      setDone(true);
    } catch (er) {
      setErr((er as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Contact us">
      <div className="w-full max-w-md rounded-2xl border border-[#1f6b4a] bg-[#0a3a28] p-6 text-left shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">Talk to us</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white" aria-label="Close">
            ✕
          </button>
        </div>
        {done ? (
          <div className="text-sm text-slate-300">
            <p className="text-[#a3d977]">Thanks — your message is in. We usually reply within one business day.</p>
            <button onClick={onClose} className="mt-4 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500">
              Close
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-3">
            <input className={input} placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
            <input className={input} type="email" placeholder="Work email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <input className={input} placeholder="Company (optional)" value={company} onChange={(e) => setCompany(e.target.value)} />
            <textarea className={`${input} min-h-[120px]`} placeholder="What do you need? Volume, networks, timeline…" value={message} onChange={(e) => setMessage(e.target.value)} required />
            {/* honeypot — hidden from people, filled by bots */}
            <input tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1 }} value={website} onChange={(e) => setWebsite(e.target.value)} />
            {err && <div className="text-sm text-red-400">{err}</div>}
            <button type="submit" disabled={busy} className="rounded-lg bg-amber-600 px-4 py-2.5 font-medium text-white hover:bg-amber-500 disabled:opacity-40">
              {busy ? "Sending…" : "Send message"}
            </button>
            <p className="text-xs text-slate-500">Or email contact@factorialstudio.com</p>
          </form>
        )}
      </div>
    </div>
  );
}

const input = "w-full rounded-lg border border-[#1f6b4a] bg-[#06281c] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500";
