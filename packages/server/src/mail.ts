/**
 * Transactional mail — dependency-free, like the rest of the server.
 *
 * With RESEND_API_KEY set, mail goes out through Resend's REST API via `fetch`. Without it
 * (local dev, tests, a fresh deploy) nothing leaves the box: messages are kept in an in-memory
 * `outbox` so the flows stay fully testable and a developer can read the link from the console.
 */
import { config } from "./config.js";

export interface Mail {
  to: string;
  subject: string;
  html: string;
  text?: string;
}
export interface SentMail extends Mail {
  at: string;
}

const OUTBOX_MAX = 100;
/** Dev transport: the most recent messages that would have been sent. */
export const outbox: SentMail[] = [];
export function clearOutbox(): void {
  outbox.length = 0;
}

export function mailEnabled(): boolean {
  return !!process.env.RESEND_API_KEY;
}

function fromAddress(): string {
  return process.env.MAIL_FROM || "Factorial AdLab <noreply@factorialstudio.dev>";
}

export async function sendMail(m: Mail): Promise<void> {
  if (!mailEnabled()) {
    outbox.push({ ...m, at: new Date().toISOString() });
    if (outbox.length > OUTBOX_MAX) outbox.splice(0, outbox.length - OUTBOX_MAX);
    if (!config.isProduction) console.log(`[mail:dev] to=${m.to} subject="${m.subject}"`);
    else console.warn(`[mail] RESEND_API_KEY not set — "${m.subject}" to ${m.to} was NOT delivered`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: fromAddress(), to: [m.to], subject: m.subject, html: m.html, text: m.text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`mail send failed (${res.status}) ${body.slice(0, 200)}`);
  }
}

/** A small branded template (dark green / gold, matching the product). */
export function template(title: string, intro: string, ctaLabel: string, ctaUrl: string, footer: string): Mail["html"] {
  return `<!doctype html><html><body style="margin:0;background:#06281c;font-family:Fredoka,Segoe UI,Arial,sans-serif;color:#eaf5ee">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#06281c;padding:32px 0"><tr><td align="center">
<table width="520" cellpadding="0" cellspacing="0" style="background:#0a3a28;border:2px solid #1f6b4a;border-radius:18px;padding:32px">
<tr><td style="font-weight:800;font-size:20px;color:#fbbf24;padding-bottom:8px">Factorial AdLab</td></tr>
<tr><td style="font-size:22px;font-weight:700;padding-bottom:10px">${title}</td></tr>
<tr><td style="font-size:15px;line-height:1.6;color:#a9c6b5;padding-bottom:22px">${intro}</td></tr>
<tr><td><a href="${ctaUrl}" style="display:inline-block;background:#fbbf24;color:#3a2a06;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px">${ctaLabel}</a></td></tr>
<tr><td style="font-size:12px;color:#a9c6b5;padding-top:22px;line-height:1.5">${footer}<br><span style="word-break:break-all">${ctaUrl}</span></td></tr>
</table></td></tr></table></body></html>`;
}
