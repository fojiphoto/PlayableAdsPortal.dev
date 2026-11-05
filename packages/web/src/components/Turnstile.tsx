import { useEffect, useRef, useState } from "react";
import { getPublicConfig } from "../api";

/**
 * Cloudflare Turnstile (bot check) for the public forms. The site key comes from the server at runtime
 * (GET /api/config/public); when none is configured the widget renders nothing and forms work as before.
 * Tokens are single-use: bump `resetSignal` after every submit so the next attempt gets a fresh one.
 */
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
  }
}

const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let scriptLoad: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (!scriptLoad) {
    scriptLoad = new Promise<void>((resolve, reject) => {
      const s = document.createElement("script");
      s.src = SCRIPT;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptLoad = null; // allow a retry on the next mount
        reject(new Error("turnstile script failed to load"));
      };
      document.head.appendChild(s);
    });
  }
  return scriptLoad;
}

let siteKeyLoad: Promise<string | null> | null = null;
/** The Turnstile site key: `undefined` while loading, `null` when the bot check is off. */
export function useCaptchaSiteKey(): string | null | undefined {
  const [key, setKey] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    siteKeyLoad ??= getPublicConfig()
      .then((c) => c.turnstileSiteKey)
      .catch(() => null);
    let live = true;
    void siteKeyLoad.then((k) => live && setKey(k));
    return () => {
      live = false;
    };
  }, []);
  return key;
}

export function Turnstile({
  siteKey,
  action,
  onToken,
  resetSignal = 0,
}: {
  siteKey: string;
  /** which form this is for; the server rejects a token solved for another form */
  action: "signup" | "forgot" | "contact";
  onToken: (token: string | null) => void;
  resetSignal?: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const cb = useRef(onToken);
  cb.current = onToken;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    loadScript()
      .then(() => {
        if (!live || !box.current || !window.turnstile) return;
        widget.current = window.turnstile.render(box.current, {
          sitekey: siteKey,
          action,
          theme: "dark",
          callback: (t: string) => cb.current(t),
          "expired-callback": () => cb.current(null),
          "error-callback": () => {
            cb.current(null);
          },
        });
      })
      .catch(() => {
        if (live) setFailed(true);
        cb.current(null);
      });
    return () => {
      live = false;
      if (widget.current && window.turnstile) {
        try {
          window.turnstile.remove(widget.current);
        } catch {
          /* already gone */
        }
      }
      widget.current = null;
    };
  }, [siteKey, action]);

  // a submit spent the token: get a fresh one
  useEffect(() => {
    if (!resetSignal || !widget.current || !window.turnstile) return;
    cb.current(null);
    window.turnstile.reset(widget.current);
  }, [resetSignal]);

  return (
    <div className="mb-3">
      <div ref={box} className="min-h-[65px]" />
      {failed && <p className="text-xs text-red-400">The security check couldn't load. Allow challenges.cloudflare.com (ad/script blockers) and reload.</p>}
    </div>
  );
}
