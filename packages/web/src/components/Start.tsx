import { useEffect, useState, type ReactNode } from "react";
import { createApp, createConcept, downloadPlugin, getOnboarding, resendVerification } from "../api";
import type { Onboarding } from "../types";
import type { Route } from "../router";

const panel = "rounded-xl border border-[#1b5540] bg-[#0a3a28]/50";
const input = "min-w-0 flex-1 rounded-lg border border-[#1f6b4a] bg-[#06281c] px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500";
const primary = "rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40";
const secondary = "rounded-lg border border-[#1f6b4a] px-3 py-2 text-sm text-slate-200 hover:border-[#7cb342]";
const code = "rounded bg-black/30 px-1";

interface Step {
  key: string;
  /** "1", "2", "3" for the main steps; letters for setup */
  badge: string;
  title: string;
  why: string;
  done: boolean;
  /** shown when not done but started (e.g. plugin downloaded, not yet connected) */
  partial?: string;
  optional?: boolean;
  how: ReactNode[];
  action?: ReactNode;
}

/**
 * "Start here": the whole path from sign-up to a shipped playable.
 *
 *   Before you start — verify your email, verify your company domain (automatic for a company email)
 *   1. Install the plugin   2. Build your playable in Unity   3. Export from the dashboard
 *
 * plus an HTML5 path for teams not on Unity and a few optional extras. Status comes live from the
 * server (GET /api/onboarding); the next unfinished step opens by itself.
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
  const company = ob.companyDomain;
  const openConcept = concept ? () => go({ page: "app", appId: concept.appId, conceptId: concept.id }) : null;

  // ── before you start ──
  const setup: Step[] = [
    {
      key: "email",
      badge: "A",
      title: "Verify your email",
      why: company
        ? `You signed up with a ${company} address: verifying it also verifies your company domain, so the next step does itself.`
        : "We use it for password resets, invites and support replies.",
      done: ob.emailVerified,
      optional: !company,
      how: ["Open the email from Factorial AdLab and click the link.", "Nothing arrived? Check spam, then press Resend."],
      action: (
        <button className={secondary} disabled={busy} onClick={() => void act(() => resendVerification(), "Verification email sent. Check your inbox and spam.")}>
          Resend email
        </button>
      ),
    },
    {
      key: "domain",
      badge: "B",
      title: "Verify your company domain",
      why: "Ad networks only accept playables from a verified publisher, so exports unlock once your domain is verified.",
      done: ob.domain.verified,
      how: !isAdmin
        ? [`A workspace admin does this. Ask the owner of “${ob.workspace.name}”.`]
        : company && !ob.emailVerified
          ? [`Fastest: verify your ${company} email (step A) — the domain verifies itself.`, "Or prove it on the Domain page with a line in app-ads.txt."]
          : [
              "Open the Domain page and enter your company domain (for example yourstudio.com).",
              "Add the token it shows to the app-ads.txt file on that domain, or upload the small verify file it offers.",
              "Press Check now. It turns green as soon as we find it.",
            ],
      action: isAdmin ? (
        <button className={company && !ob.emailVerified ? secondary : primary} onClick={() => go({ page: "domain" })}>
          Open the Domain page
        </button>
      ) : undefined,
    },
  ];

  // ── the three steps ──
  const main: Step[] = [
    {
      key: "plugin",
      badge: "1",
      title: "Install the plugin",
      why: `Add the Factorial AdLab plugin (v${ob.plugin.version}) to your existing Unity project (Unity 6000.0 or newer). Your scenes, prefabs and C# stay as they are.`,
      done: ob.plugin.downloaded && !!ob.plugin.connectedAt,
      partial: ob.plugin.downloaded && !ob.plugin.connectedAt ? "Downloaded — now import it and sign in" : undefined,
      how: [
        <>
          Press <b>Download</b> to get the <b>.unitypackage</b> (licensed to your account — please don't share it).
        </>,
        <>
          In Unity: <b>Assets ▸ Import Package ▸ Custom Package…</b>, pick the file, press <b>Import</b>.
        </>,
        <>
          Open <b>Factorial AdLab ▸ Playable Builder</b>, check the API is <code className={code}>{origin}</code>, and sign in with this account (plus your 2FA code if it's on).
        </>,
      ],
      action: (
        <button className={primary} disabled={busy} onClick={() => void act(async () => downloadPlugin(), "Downloaded. Import it into Unity and sign in from the Playable Builder.")}>
          {ob.plugin.downloaded ? "Download again" : "Download the plugin"}
        </button>
      ),
    },
    {
      key: "build",
      badge: "2",
      title: "Build your playable in Unity",
      why: "Set up what the ad shows and where its install button goes, then send it here straight from the editor. The plugin creates the app and concept for you.",
      done: ob.counts.creatives > 0,
      how: [
        <>
          Hook up your install / download button: <code className={code}>using FactorialAdLab;</code> then <code className={code}>Playable.InstallFullGame();</code> when it's tapped.
        </>,
        <>
          Open the scene you want to show. Optional: mark tunable fields with <code className={code}>[AdLabField]</code> and report{" "}
          <code className={code}>LifeCycle.GameStarted()</code> / <code className={code}>GameEnded()</code>.
        </>,
        <>
          In the Playable Builder press <b>Build, compile &amp; upload playable</b> (needs the WebGL module), or press Play and use{" "}
          <b>Capture &amp; upload playable</b> — the capture fits every network's size limit.
        </>,
      ],
      action: openConcept ? (
        <button className={secondary} onClick={openConcept}>
          Open your concept
        </button>
      ) : undefined,
    },
    {
      key: "export",
      badge: "3",
      title: "Export from the dashboard",
      why: "Pick the networks and get one file per network, already wrapped, sized and named the way that network's review expects.",
      done: ob.counts.exports > 0,
      how: [
        "Open the concept and select the playable.",
        <>
          Tick the networks and press <b>Export</b>.
          {freeOnly && <> Your {ob.plan.name} plan exports to Unity Ads; the other networks come with a paid plan.</>}
        </>,
        <>
          Press <b>Preview</b>, play it in the phone frame and tap install: the panel under the phone should say <b>CTA fired</b> (use Chrome for previews).
        </>,
        "Download each file (or all of them) and upload it to the network.",
      ],
      action: (
        <span className="flex flex-wrap gap-2">
          {openConcept && (
            <button className={secondary} onClick={openConcept}>
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

  const required = [setup[1]!, ...main];
  const doneCount = required.filter((s) => s.done).length;
  const ordered = [...setup, ...main];
  const next = ordered.find((s) => !s.done && !s.optional && !(s.key === "domain" && !isAdmin)) ?? ordered.find((s) => !s.done && !s.optional);
  const shown = open ?? next?.key ?? null;

  const card = (s: Step) => {
    const expanded = shown === s.key;
    const isNext = next?.key === s.key;
    const state = s.done ? "Done" : s.partial ? "In progress" : isNext ? "Next" : "To do";
    return (
      <li key={s.key} className={`${panel} ${isNext && !s.done ? "border-amber-500/70" : ""}`}>
        <button onClick={() => setOpen(expanded ? "" : s.key)} className="flex w-full items-center gap-3 px-4 py-3 text-left" aria-expanded={expanded}>
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${s.done ? "bg-emerald-500 text-black" : isNext ? "bg-amber-500 text-black" : "bg-[#123f2d] text-slate-300"}`}
          >
            {s.done ? "✓" : s.badge}
          </span>
          <span className="min-w-0 flex-1">
            <span className={`block font-medium ${s.done ? "text-slate-400" : "text-slate-100"}`}>
              {s.title}
              {s.optional && <span className="ml-2 text-xs font-normal text-slate-500">optional</span>}
            </span>
            {s.partial && !s.done && <span className="block text-xs text-amber-300">{s.partial}</span>}
          </span>
          <span
            className={`shrink-0 rounded px-2 py-0.5 text-[11px] font-semibold ${s.done ? "bg-emerald-500/15 text-emerald-300" : state === "Next" ? "bg-amber-500/20 text-amber-200" : state === "In progress" ? "bg-amber-500/10 text-amber-300" : "bg-[#123f2d] text-slate-400"}`}
          >
            {state}
          </span>
        </button>
        {expanded && (
          <div className="border-t border-[#1b5540] px-4 py-3 text-sm sm:pl-15">
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
  };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-semibold text-slate-100">Start here</h1>
      <p className="mb-4 text-sm text-slate-400">From your Unity project to a playable on every network: a quick setup, then three steps. Each one turns green by itself.</p>

      <div className="mb-6">
        <div className="mb-1 flex flex-wrap justify-between gap-2 text-xs text-slate-400">
          <span>
            {doneCount} of {required.length} done
          </span>
          {next ? <span>Next: {next.title}</span> : <span className="text-emerald-400">All set — you're shipping playables.</span>}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-[#0a3a28]">
          <div className="h-full rounded-full bg-amber-500 transition-[width]" style={{ width: `${(doneCount / required.length) * 100}%` }} />
        </div>
      </div>
      {msg && (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${msg.ok ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border border-red-500/40 bg-red-500/10 text-red-300"}`}>{msg.text}</div>
      )}

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Before you start</h2>
      <ol className="mb-6 grid gap-2">{setup.map(card)}</ol>

      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Three steps to your first playable</h2>
      <ol className="mb-6 grid gap-2">{main.map(card)}</ol>

      <details className={`${panel} mb-3 px-4 py-3`}>
        <summary className="cursor-pointer text-sm font-medium text-slate-200">Not using Unity? Upload an HTML5 build instead</summary>
        <div className="mt-3 grid gap-3 text-sm text-slate-300">
          <p>Make an app (your game) and a concept (one ad idea), then upload a .zip or .html of your build in the concept and continue with step 3.</p>
          {ob.counts.apps === 0 ? (
            canEdit && (
              <form
                className="flex max-w-md gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (appName.trim()) void act(async () => createApp(appName.trim()), "App created.");
                }}
              >
                <input className={input} placeholder="Game name" value={appName} onChange={(e) => setAppName(e.target.value)} />
                <button className={primary} disabled={busy || !appName.trim()}>
                  Create app
                </button>
              </form>
            )
          ) : ob.counts.concepts === 0 && ob.firstAppId ? (
            canEdit && (
              <form
                className="flex max-w-md gap-2"
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
            )
          ) : (
            openConcept && (
              <span>
                <button className={secondary} onClick={openConcept}>
                  Open your concept to upload
                </button>
              </span>
            )
          )}
          <p className="text-xs text-slate-400">
            In your HTML5 code call <code className={code}>window.PF.install()</code> on the install button. Nothing else to add.
          </p>
        </div>
      </details>

      <details className={`${panel} px-4 py-3`}>
        <summary className="cursor-pointer text-sm font-medium text-slate-200">Optional extras</summary>
        <ul className="mt-3 grid gap-2 text-sm text-slate-300">
          <li>
            <button className="text-amber-400 hover:underline" onClick={() => go({ page: "preloader" })}>
              Brand your loading screen
            </button>{" "}
            — your logo and colours while the playable loads.
          </li>
          <li>Tune values without rebuilding — fields marked <code className={code}>[AdLabField]</code> get an editor on each creative.</li>
          <li>
            <button className="text-amber-400 hover:underline" onClick={() => go({ page: "settings" })}>
              Invite your team
            </button>{" "}
            — share the workspace with roles from viewer to admin.
          </li>
          <li>
            <button className="text-amber-400 hover:underline" onClick={() => go({ page: "analytics" })}>
              Watch how your ads play
            </button>{" "}
            — impressions, engagement and install taps per network.
          </li>
        </ul>
      </details>

      <p className="mt-6 text-xs text-slate-500">
        Stuck?{" "}
        <button className="text-amber-400 hover:underline" onClick={() => go({ page: "support" })}>
          Ask support
        </button>{" "}
        and we'll help.
      </p>
    </div>
  );
}
