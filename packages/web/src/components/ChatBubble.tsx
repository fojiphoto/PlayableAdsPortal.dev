import { useEffect, useRef, useState, type FormEvent } from "react";
import { sendContact } from "../api";
import { Turnstile, useCaptchaSiteKey } from "./Turnstile";
import "./ChatBubble.css";

const GREET_KEY = "adlab.chatGreetDay";
const GREET_DELAY_MS = 12_000;

const today = () => new Date().toISOString().slice(0, 10);

function greetedToday(): boolean {
  try {
    return localStorage.getItem(GREET_KEY) === today();
  } catch {
    return true; // storage blocked: don't nag on every visit
  }
}
function markGreeted() {
  try {
    localStorage.setItem(GREET_KEY, today());
  } catch {
    /* ignore */
  }
}

const ChatIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12Z" />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
const CheckIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

/**
 * Floating "chat with us" button for every page. Guests get a short contact form (POST /api/contact);
 * signed-in users are pointed at their support threads via `onOpenSupport`. A greeting pops up once a day.
 */
export function ChatBubble({ signedIn, onOpenSupport }: { signedIn?: boolean; onOpenSupport?: () => void }) {
  const [open, setOpen] = useState(false);
  const [greet, setGreet] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);

  // greeting: once per day, after a short delay, unless the panel is already open
  useEffect(() => {
    if (greetedToday()) return;
    const t = window.setTimeout(() => {
      if (greetedToday()) return;
      markGreeted();
      setGreet(true);
    }, GREET_DELAY_MS);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        fabRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function openPanel() {
    markGreeted();
    setGreet(false);
    setOpen(true);
  }

  return (
    <div className="cb">
      {greet && !open && (
        <div className="cb-greet" role="dialog" aria-label="Chat greeting">
          <button className="cb-x" aria-label="Dismiss" onClick={() => setGreet(false)}>
            <CloseIcon />
          </button>
          <b>Hi! How can we help?</b>
          <p>Questions about exports, networks or plans? Send us a message and we'll get back to you.</p>
          <button className="cb-btn" onClick={openPanel}>
            Chat with us
          </button>
        </div>
      )}

      {open && (
        <div className="cb-panel" role="dialog" aria-label="Chat with us">
          <div className="cb-head">
            <b>Chat with us</b>
            <button
              className="cb-x"
              aria-label="Close chat"
              onClick={() => {
                setOpen(false);
                fabRef.current?.focus();
              }}
            >
              <CloseIcon />
            </button>
            <span className="cb-status">
              <span className="cb-dot" aria-hidden="true" />
              We usually reply within one business day.
            </span>
          </div>
          <div className="cb-body">
            {signedIn ? (
              <>
                <p className="cb-msg">
                  Hi! For anything about your account, exports or billing, open a support thread. Your whole conversation with the team stays in
                  one place.
                </p>
                <button
                  className="cb-btn"
                  style={{ alignSelf: "flex-start" }}
                  onClick={() => {
                    setOpen(false);
                    onOpenSupport?.();
                  }}
                >
                  Open support
                </button>
              </>
            ) : (
              <GuestForm />
            )}
          </div>
        </div>
      )}

      <button ref={fabRef} className="cb-fab" aria-label={open ? "Close chat" : "Chat with us"} aria-expanded={open} onClick={() => (open ? setOpen(false) : openPanel())}>
        {open ? <CloseIcon /> : <ChatIcon />}
        {greet && !open && <span className="cb-badge">1</span>}
      </button>
    </div>
  );
}

function GuestForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const siteKey = useCaptchaSiteKey();
  const [captcha, setCaptcha] = useState<string | null>(null);
  const [captchaRun, setCaptchaRun] = useState(0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (siteKey && !captcha) {
      setErr("Please complete the security check.");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await sendContact({ name: name.trim(), email: email.trim(), message: `[Chat] ${message.trim()}`, website, turnstileToken: captcha ?? undefined });
      setSent(true);
    } catch (er) {
      setErr((er as Error).message);
      if (siteKey) setCaptchaRun((n) => n + 1);
    } finally {
      setBusy(false);
    }
  }

  if (sent)
    return (
      <div className="cb-done" role="status">
        <span className="cb-done-ico">
          <CheckIcon />
        </span>
        <b>Thanks, message sent.</b>
        <span>We'll reply to {email.trim()} by email.</span>
      </div>
    );

  return (
    <form className="cb-form" onSubmit={submit}>
      <p className="cb-intro">Ask us anything: a question, a bug or an idea. We'll answer by email.</p>
      <input placeholder="Your name" autoComplete="name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
      <input type="email" placeholder="Your email" autoComplete="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Your email" />
      <textarea placeholder="Write a message…" required rows={3} value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Message" />
      <input className="cb-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={website} onChange={(e) => setWebsite(e.target.value)} />
      {siteKey && <Turnstile siteKey={siteKey} action="contact" onToken={setCaptcha} resetSignal={captchaRun} />}
      {err && <p className="cb-err">{err}</p>}
      <button type="submit" className="cb-btn" disabled={busy || !message.trim()}>
        {busy ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
