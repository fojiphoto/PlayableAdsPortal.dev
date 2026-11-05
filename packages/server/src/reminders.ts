/**
 * Reminder emails (the competitor's `/reminders/*`): nudge accounts that signed up but never
 * exported, and accounts that went quiet. Candidates are computed from the database, every send is
 * logged so nobody is nudged twice for the same thing, and the worker runs it daily when
 * REMINDERS_AUTO=1 (admins can also run / dry-run it from the console).
 */
import { config } from "./config.js";
import { sendMail, template } from "./mail.js";
import { logReminder, reminderCandidatesNoExport, reminderCandidatesDormant, takeLease, type UserRow } from "./repo.js";

export const REMINDER_KINDS = ["no-export", "dormant"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export async function reminderCandidates(kind: ReminderKind): Promise<UserRow[]> {
  return kind === "no-export" ? await reminderCandidatesNoExport(3) : await reminderCandidatesDormant(14, 30);
}

export async function sendReminder(u: UserRow, kind: ReminderKind, site: string): Promise<void> {
  const base = site || config.publicUrl || "https://app.factorialstudio.dev";
  const mail =
    kind === "no-export"
      ? {
          subject: "Your first playable is one upload away — Factorial AdLab",
          html: template(
            "Ship your first playable",
            "You created a Factorial AdLab account but haven't exported a playable yet. Upload an HTML5 build (or capture one from Unity with the plugin) and we'll package it for every ad network in one click. Unity Ads exports are free, forever.",
            "Open the dashboard",
            base,
            "Need a hand? Reply to this email or open a ticket from the Support page.",
          ),
        }
      : {
          subject: "Anything new to ship? — Factorial AdLab",
          html: template(
            "We kept building while you were away",
            "It's been a while since your last visit. Since then: 29 ad networks, in-playable analytics (impressions → engagement → CTR), a Unity compile path and dashboard-tunable variables. Your exports and creatives are right where you left them.",
            "Open the dashboard",
            base,
            "Reply to this email if you'd like a walkthrough.",
          ),
        };
  await sendMail({ to: u.email, ...mail });
  await logReminder(u.id, kind);
}

export interface ReminderRun {
  dryRun: boolean;
  sent: Record<ReminderKind, number>;
  candidates: Record<ReminderKind, string[]>;
}

export async function runReminders(opts: { dryRun?: boolean; kind?: ReminderKind; site?: string } = {}): Promise<ReminderRun> {
  const kinds = opts.kind ? [opts.kind] : [...REMINDER_KINDS];
  const out: ReminderRun = { dryRun: !!opts.dryRun, sent: { "no-export": 0, dormant: 0 }, candidates: { "no-export": [], dormant: [] } };
  for (const kind of kinds) {
    const users = await reminderCandidates(kind);
    out.candidates[kind] = users.map((u) => u.email);
    if (opts.dryRun) continue;
    for (const u of users) {
      try {
        await sendReminder(u, kind, opts.site ?? "");
        out.sent[kind]++;
      } catch {
        /* keep going; the next run retries */
      }
    }
  }
  return out;
}

let lastAuto = 0;
/**
 * Called from the job worker's tick: once a day when REMINDERS_AUTO=1. The day's run is claimed through a
 * lease in the database, so with several instances only one of them sends.
 */
export async function autoRemindersTick(nowMs = Date.now()): Promise<void> {
  if (!config.remindersAuto) return;
  if (nowMs - lastAuto < 60 * 60_000) return; // check the shared lease at most hourly
  lastAuto = nowMs;
  if (!(await takeLease("reminders", 24 * 60 * 60_000, nowMs))) return;
  const r = await runReminders({});
  const total = r.sent["no-export"] + r.sent.dormant;
  if (total) console.log(`[reminders] sent ${r.sent["no-export"]} no-export + ${r.sent.dormant} dormant`);
}
