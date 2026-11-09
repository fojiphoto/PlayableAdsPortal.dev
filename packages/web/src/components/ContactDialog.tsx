import { useState, type FormEvent } from "react";
import { sendContact } from "../api";
import { Turnstile, useCaptchaSiteKey } from "./Turnstile";

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
  const siteKey = useCaptchaSiteKey();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaRun, setCaptchaRun] = useState(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await sendContact({ name, email, company, message, website, turnstileToken: captcha ?? undefined });
      setDone(true);
    } catch (er) {
      setErr((er as Error).message);
      if (siteKey) setCaptchaRun((n) => n + 1); // the token is single-use
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Contact us">
      <div className="w-full max-w-md rounded-[22px] border border-ink-500 bg-ink-800 p-6 text-left shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg uppercase text-text-inv">Talk to us</h2>
          <button onClick={onClose} className="text-text-inv-2 hover:text-text-inv" aria-label="Close">
            ✕
          </button>
        </div>
        {done ? (
          <div className="text-sm text-text-inv-2">
            <p className="text-brand-300">Thanks — your message is in. We usually reply within one business day.</p>
            <button onClick={onClose} className="mt-4 rounded-full bg-gold px-5 py-2 text-sm font-semibold text-gold-ink shadow-[0_6px_16px_rgba(245,158,11,0.28)] hover:bg-gold-600">
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
            {siteKey && <Turnstile siteKey={siteKey} action="contact" onToken={setCaptcha} resetSignal={captchaRun} />}
            {err && <div className="text-sm text-red-400">{err}</div>}
            <button type="submit" disabled={busy || (!!siteKey && !captcha)} className="rounded-full bg-gold px-5 py-2.5 font-semibold text-gold-ink shadow-[0_6px_16px_rgba(245,158,11,0.28)] hover:bg-gold-600 disabled:opacity-40">
              {busy ? "Sending…" : "Send message"}
            </button>
            <p className="text-xs text-text-inv-2">Or email contact@factorialstudio.com</p>
          </form>
        )}
      </div>
    </div>
  );
}

const input = "w-full rounded-xl border border-ink-500 bg-ink-900 px-3 py-2 text-sm text-text-inv outline-none placeholder:text-text-inv-2/70 focus:border-gold";
