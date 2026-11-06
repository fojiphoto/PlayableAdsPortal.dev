import { useEffect, useState, type ReactNode } from "react";
import { createApp, createConcept, downloadPlugin, getOnboarding, resendVerification } from "../api";
import type { Onboarding } from "../types";
import type { Route } from "../router";

const panel = "rounded-xl border border-[#1b5540] bg-[#0a3a28]/50";
const input = "min-w-0 flex-1 rounded-lg border border-[#1f6b4a] bg-[#06281c] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500";
const primary = "rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40";
const secondary = "rounded-lg border border-[#1f6b4a] px-3 py-2 text-sm text-slate-200 hover:border-[#7cb342]";

interface Step {
  key: string;
  title: string;
  why: string;
  done: boolean;
  optional?: boolean;
  /** shown under "How" as numbered lines */
  how: ReactNode[];
  action?: ReactNode;
}

/**
 * "Start here": every step from sign-up to a tested playable, in order, with live status from the
 * server (GET /api/onboarding). The first unfinished step opens by itself; done steps fold away.
 */
export function Start({ go, onDataChanged, canEdit }: { go: (r: Route) => void; onDataChanged: () => void; canEdit: boolean }) {
  const [ob, setOb] = useState<Onboarding | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [appName, setAppName] = useState("");
  const [conceptName, setConceptName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () =>
    getOnboarding()
      .then(setOb)
      .catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  useEffect(() => {
    void load();
  }, []);

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      if (ok) setMsg({ ok: true, text: ok });
      setOpen(null); // jump to whatever is next
      onDataChanged();
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  if (!ob) return <div className="mx-auto max-w-3xl py-10 text-sm text-slate-400">{msg?.text ?? "Loading your checklist…"}</div>;

  const origin = window.location.origin;
  const freeOnly = ob.plan.networks !== "all";
  const concept = ob.firstConcept;
  const isAdmin = ob.workspace.role === "owner" || ob.workspace.role === "admin";

  const steps: Step[] = [
    {
      key: "email",
      title: "Verify your email",
      why: "So we can reach you about your account (password resets, invites, support replies). It doesn't block anything else.",
      done: ob.emailVerified,
      optional: true,
      how: ["Open the email from Factorial AdLab and click the link.", "No email? Check spam, then press Resend."],
      action: (
        <button className={secondary} disabled={busy} onClick={() => void act(() => resendVerification(), "Verification email sent. Check your inbox and spam.")}>
          Resend email
        </button>
      ),
    },
    {
      key: "domain",
      title: "Verify your company domain",
      why: "Required before any export: ad networks expect playables from a verified publisher.",
      done: ob.domain.verified,
      how: isAdmin
        ? [
            "Open the Domain page and enter your company domain (for example yourstudio.com).",
            "Copy the token it shows into the app-ads.txt file on that domain (or upload the verify file it offers).",
            "Press Check now. The status turns green when we find the token.",
          ]
        : [`Only a workspace admin can do this. Ask the owner of “${ob.workspace.name}” to verify the domain.`],
      action: isAdmin ? (
        <button className={primary} onClick={() => go({ page: "domain" })}>
          Open the Domain page
        </button>
      ) : undefined,
    },
    {
      key: "app",
      title: "Create an app",
      why: "An app is your game. Everything you make for it lives inside it.",
      done: ob.counts.apps > 0,
      how: ["Type your game's name and press Create app. You can rename it later."],
      action:
        ob.counts.apps > 0 ? (
          <button className={secondary} onClick={() => ob.firstAppId && go({ page: "app", appId: ob.firstAppId })}>
            Open your app
          </button>
        ) : canEdit ? (
          <form
            className="flex w-full max-w-md gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (appName.trim()) void act(async () => createApp(appName.trim()), "App created.");
            }}
          >
            <input className={input} placeholder="Game name, e.g. Merge Kingdom" value={appName} onChange={(e) => setAppName(e.target.value)} />
            <button className={primary} disabled={busy || !appName.trim()}>
              Create app
            </button>
          </form>
        ) : undefined,
    },
    {
      key: "concept",
      title: "Create a concept",
      why: "A concept is one ad idea for the app (for example “Level 1 tutorial”). Your playables go inside it.",
      done: ob.counts.concepts > 0,
      how: ["Name the ad idea and press Create concept."],
      action:
        ob.counts.concepts > 0 && concept ? (
          <button className={secondary} onClick={() => go({ page: "app", appId: concept.appId, conceptId: concept.id })}>
            Open your concept
          </button>
        ) : ob.firstAppId && canEdit ? (
          <form
            className="flex w-full max-w-md gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (conceptName.trim() && ob.firstAppId) void act(async () => createConcept(ob.firstAppId!, conceptName.trim()), "Concept created.");
            }}
          >
            <input className={input} placeholder="Ad idea, e.g. Tutorial level" value={conceptName} onChange={(e) => setConceptName(e.target.value)} />
            <button className={primary} disabled={busy || !conceptName.trim()}>
              Create concept
            </button>
          </form>
        ) : (
          <span className="text-xs text-slate-400">Create an app first (step 3).</span>
        ),
    },
    {
      key: "sdk",
      title: "Download the Unity SDK",
      why: `The Factorial AdLab plugin (v${ob.plugin.version}, Unity 6000.0 or newer) builds or captures your game and uploads it here. Each download is licensed to you.`,
      done: ob.plugin.downloaded,
      how: ["Press Download. You get a .unitypackage file.", "Don't share it: every copy is tied to your account."],
      action: (
        <button className={primary} disabled={busy} onClick={() => void act(async () => downloadPlugin(), "Downloaded. Next: import it into Unity (step 6).")}>
          Download .unitypackage
        </button>
      ),
    },
    {
      key: "install",
      title: "Install it in Unity and sign in",
      why: "Connects the Unity editor to your account.",
      done: !!ob.plugin.connectedAt,
      how: [
        "Open your game in Unity 6000.0 or newer.",
        <>
          Menu <b>Assets ▸ Import Package ▸ Custom Package…</b>, pick the downloaded file, press <b>Import</b>.
        </>,
        <>
          Menu <b>Factorial AdLab ▸ Playable Builder</b>.
        </>,
        <>
          Check that <b>API</b> is <code className="rounded bg-black/30 px-1">{origin}</code>, then sign in with this account's email and password (and your 2FA code if it's on).
        </>,
      ],
    },
    {
      key: "code",
      title: "Call the install button in your game",
      why: "When the player taps your install / download button, the ad must open the store the way each network requires. One line does it.",
      done: ob.counts.creatives > 0,
      optional: true,
      how: [
        <>
          In the C# script of your install button: <code className="rounded bg-black/30 px-1">using FactorialAdLab;</code> and on tap{" "}
          <code className="rounded bg-black/30 px-1">Playable.InstallFullGame();</code>
        </>,
        <>
          Optional: <code className="rounded bg-black/30 px-1">LifeCycle.GameStarted()</code> / <code className="rounded bg-black/30 px-1">GameEnded()</code> for
          analytics, and <code className="rounded bg-black/30 px-1">[AdLabField]</code> on fields you want to tune from the dashboard.
        </>,
        <>
          HTML5 game instead of Unity? Call <code className="rounded bg-black/30 px-1">window.PF.install()</code>. Nothing to install.
        </>,
      ],
    },
    {
      key: "upload",
      title: "Make your first playable",
      why: "Turn the game into a playable ad and upload it to your concept.",
      done: ob.counts.creatives > 0,
      how: [
        <>
          <b>Capture (fits every network):</b> press Play in Unity, play the moment you want to show, then <b>Capture &amp; upload playable</b>.
        </>,
        <>
          <b>Compile (the real game, large):</b> stop Play mode, then <b>Build, compile &amp; upload playable</b>. Needs the WebGL module in Unity Hub.
        </>,
        <>
          <b>HTML5 game:</b> open your concept here and upload a .zip of the build.
        </>,
      ],
      action: concept ? (
        <button className={secondary} onClick={() => go({ page: "app", appId: concept.appId, conceptId: concept.id })}>
          Open your concept
        </button>
      ) : undefined,
    },
    {
      key: "export",
      title: "Export, preview and download",
      why: "Get one correct file per ad network, checked against each network's size limit.",
      done: ob.counts.exports > 0,
      how: [
        "Open the concept and pick the playable.",
        freeOnly ? (
          <>
            Tick the networks and press <b>Export</b>. Your {ob.plan.name} plan exports to Unity Ads; other networks need a paid plan.
          </>
        ) : (
          <>
            Tick the networks and press <b>Export</b>.
          </>
        ),
        <>
          Press <b>Preview</b>: play it in the phone frame and tap install. The box under the phone should say <b>CTA fired</b>. Use Chrome for the preview.
        </>,
        "Press Download (or Download all) and upload the file to the ad network.",
      ],
      action: (
        <span className="flex flex-wrap gap-2">
          {concept && (
            <button className={secondary} onClick={() => go({ page: "app", appId: concept.appId, conceptId: concept.id })}>
              Open your concept
            </button>
          )}
          {freeOnly && (
            <button className={secondary} onClick={() => go({ page: "plans" })}>
              See plans
            </button>
          )}
        </span>
      ),
    },
  ];

  const required = steps.filter((s) => !s.optional);
  const doneCount = required.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done && !s.optional) ?? steps.find((s) => !s.done);
  const shown = open ?? next?.key ?? null;

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold text-slate-100">Start here</h1>
      <p className="mb-4 text-sm text-slate-400">
        Everything from sign-up to a tested playable ad, in order. Each step turns green by itself when it's done.
      </p>
      <div className="mb-5">
        <div className="mb-1 flex justify-between text-xs text-slate-400">
          <span>
            {doneCount} of {required.length} steps done
          </span>
          {next ? <span>Next: {next.title}</span> : <span className="text-emerald-400">All done — you're shipping playables.</span>}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#0a3a28]">
          <div className="h-full rounded-full bg-amber-500 transition-[width]" style={{ width: `${(doneCount / required.length) * 100}%` }} />
        </div>
      </div>
      {msg && <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${msg.ok ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border border-red-500/40 bg-red-500/10 text-red-300"}`}>{msg.text}</div>}

      <ol className="grid gap-2">
        {steps.map((s, i) => {
          const expanded = shown === s.key;
          const isNext = next?.key === s.key;
          return (
            <li key={s.key} className={`${panel} ${isNext ? "border-amber-500/70" : ""}`}>
              <button onClick={() => setOpen(expanded ? "" : s.key)} className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={expanded}>
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${s.done ? "bg-emerald-500 text-black" : isNext ? "bg-amber-500 text-black" : "bg-[#123f2d] text-slate-300"}`}
                >
                  {s.done ? "✓" : i + 1}
                </span>
                <span className={`flex-1 font-medium ${s.done ? "text-slate-400" : "text-slate-100"}`}>
                  {s.title}
                  {s.optional && <span className="ml-2 text-xs font-normal text-slate-500">optional</span>}
                </span>
                <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${s.done ? "bg-emerald-500/15 text-emerald-300" : isNext ? "bg-amber-500/20 text-amber-200" : "bg-[#123f2d] text-slate-400"}`}>
                  {s.done ? "Done" : isNext ? "Next" : "To do"}
                </span>
              </button>
              {expanded && (
                <div className="border-t border-[#1b5540] px-4 py-3 pl-14 text-sm">
                  <p className="mb-2 text-slate-300">{s.why}</p>
                  <ol className="mb-3 list-decimal space-y-1 pl-5 text-slate-300">
                    {s.how.map((h, j) => (
                      <li key={j}>{h}</li>
                    ))}
                  </ol>
                  {s.action && <div className="flex flex-wrap items-center gap-2">{s.action}</div>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-6 text-xs text-slate-500">
        Stuck on a step? Open <button className="text-amber-400 hover:underline" onClick={() => go({ page: "support" })}>Support</button> and we'll help.
      </p>
    </div>
  );
}
