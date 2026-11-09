import { useEffect, useState, type ReactNode } from "react";
import { getNetworks } from "../api";
import type { Network } from "../types";
import { linkClick, routePath, type Route } from "../router";
import { Icon } from "./icons";
import { PageHead } from "./pageKit";

/**
 * Docs: a left nav of pages, the article, and an "On this page" list. The open page lives in component
 * state; another page (Setup) can ask for a specific one with rememberDocsPage() before navigating here.
 */

export type DocsPageId = "overview" | "get-started" | "build" | "cta" | "variables" | "export" | "preloader" | "analytics" | "help";
const HINT_KEY = "adlab.docsPage";

/** Open the Docs page at `id` next time it mounts (used by Setup's "More in Docs" links). */
export function rememberDocsPage(id: DocsPageId) {
  try {
    sessionStorage.setItem(HINT_KEY, id);
  } catch {
    /* storage blocked: Docs opens on Overview */
  }
}
function readDocsHint(): DocsPageId | null {
  try {
    const v = sessionStorage.getItem(HINT_KEY);
    return PAGES.some((p) => p.id === v) ? (v as DocsPageId) : null;
  } catch {
    return null;
  }
}
function clearDocsHint() {
  try {
    sessionStorage.removeItem(HINT_KEY);
  } catch {
    /* storage blocked */
  }
}

type Block =
  | { h: string }
  | { p: ReactNode }
  | { note: ReactNode }
  | { tip: ReactNode }
  | { code: string; lang: string }
  | { steps: ReactNode[] }
  | { list: ReactNode[] }
  | { table: { head: string[]; rows: ReactNode[][] } }
  | { networks: true }
  | { go: { label: string; to: Route } };

interface DocPage {
  id: DocsPageId;
  group: "Introduction" | "Guides" | "Reference" | "Support";
  title: string;
  lead?: ReactNode;
  body: Block[];
}

const GROUPS: DocPage["group"][] = ["Introduction", "Guides", "Reference", "Support"];

const PAGES: DocPage[] = [
  {
    id: "overview",
    group: "Introduction",
    title: "Overview",
    lead: "Factorial AdLab turns one build of your game into a playable ad for every network. Build in Unity (or bring an HTML5 build), upload it here, and export one ready file per network.",
    body: [
      { h: "How it works" },
      {
        steps: [
          <>The Unity plugin builds or records your game and uploads it from the editor.</>,
          <>The upload lands in Playable Ads, under its app and concept.</>,
          <>You preview it in a phone frame, pick networks and export. Each file is wrapped, sized and named the way that network's review expects.</>,
        ],
      },
      { h: "Words we use" },
      {
        list: [
          <>
            <b className="docs-lead-in">App</b> is your game, with its App Store and Google Play links.
          </>,
          <>
            <b className="docs-lead-in">Concept</b> is one ad idea for that app, such as "Tutorial level".
          </>,
          <>
            <b className="docs-lead-in">Playable</b> is one build uploaded to a concept. You can keep several and compare them.
          </>,
          <>
            <b className="docs-lead-in">Export</b> is the file a network receives. One playable exports to many networks.
          </>,
          <>
            <b className="docs-lead-in">Workspace</b> is your team. Apps, the plan, the verified domain and the export quota belong to it.
          </>,
        ],
      },
      { h: "What you need" },
      {
        list: [
          "Unity 6 (6000.0) or newer. The compile path also needs the WebGL Build Support module.",
          "A verified company domain. Ad networks only accept playables from a verified publisher.",
          "A plan for the networks you use. Free exports to Unity Ads; paid plans export everywhere.",
        ],
      },
    ],
  },
  {
    id: "get-started",
    group: "Guides",
    title: "Get started",
    lead: "From a new account to your first exported playable, in order.",
    body: [
      { h: "Steps" },
      {
        steps: [
          <>
            <b className="docs-lead-in">Create your account</b> and confirm the code we email you.
          </>,
          <>
            <b className="docs-lead-in">Verify your email.</b> If you signed up with a company address, this also verifies your company domain.
          </>,
          <>
            <b className="docs-lead-in">Verify your domain</b> on the Domain page: add the token it shows to <code>app-ads.txt</code>, or upload the small verify
            file, then press Check now.
          </>,
          <>
            <b className="docs-lead-in">Install the Unity plugin</b> from the Setup page and import the <code>.unitypackage</code> into your project.
          </>,
          <>
            <b className="docs-lead-in">Sign in inside Unity:</b> open <b>Factorial AdLab ▸ Playable Builder</b> and sign in with the same account (and your 2FA
            code if it's on).
          </>,
          <>
            <b className="docs-lead-in">Build and upload</b> with one button in the Playable Builder.
          </>,
          <>
            <b className="docs-lead-in">Export:</b> open the concept, tick the networks, press Export and download the files.
          </>,
        ],
      },
      { note: "Exports unlock once your company domain is verified. Everything else works before that, so you can build and preview first." },
      { go: { label: "Open Setup", to: { page: "start" } } },
    ],
  },
  {
    id: "build",
    group: "Guides",
    title: "Build & upload",
    lead: "The Playable Builder window offers two ways to turn your game into a playable. Both upload straight to your library.",
    body: [
      { h: "Two ways to make a playable" },
      {
        table: {
          head: ["", "Compile the game", "Capture gameplay"],
          rows: [
            ["What ships", "Your real game: a size-optimised Unity WebGL build folded into one HTML file", "A short recorded clip replayed as a playable, with a tap zone and an end card"],
            ["Button", "Build, compile & upload playable (outside Play mode)", "Capture & upload playable (in Play mode)"],
            ["Fits", "Light and hyper-casual games", "Any game, including heavy 3D"],
            ["You get", "A size breakdown and the networks it fits", "A playable under every network's size cap"],
          ],
        },
      },
      { h: "Compile the game" },
      {
        p: "The plugin switches Player Settings to playable-friendly values for the build only (no compression, high stripping, size-optimised IL2CPP, minimal template) and restores yours afterwards. It needs the WebGL Build Support module.",
      },
      {
        tip: "Network caps are 2 to 5 MB, and the Unity 6 player alone is far above that. Use compile to measure and for web demos; use capture to ship to networks.",
      },
      { h: "Capture gameplay" },
      {
        p: "Press Play, start playing, then press Capture & upload playable. Set the game name, clip length, capture width, CTA label and store links first. You can add a tap zone the player must hit and an end-card subtitle.",
      },
      { h: "HTML5 builds" },
      {
        p: (
          <>
            Not on Unity? Create an app and a concept in Playable Ads, then upload a <code>.zip</code> or <code>.html</code> of your build into the concept. Call{" "}
            <code>window.PF.install()</code> on your install button.
          </>
        ),
      },
      { h: "Headless builds (CI)" },
      {
        lang: "shell",
        code: "Unity -batchmode -nographics -quit -projectPath <project> -buildTarget WebGL \\\n  -executeMethod FactorialAdLab.Editor.WebGLCompileUploader.BuildFromCommandLine \\\n  -adlabOut <dir>",
      },
    ],
  },
  {
    id: "cta",
    group: "Guides",
    title: "CTA & game end",
    lead: "One call opens the store. When you export, we route it to each network's own mechanism, so you never write network code.",
    body: [
      { h: "In Unity" },
      {
        lang: "C#",
        code: "using FactorialAdLab;\nusing UnityEngine;\n\npublic class EndScreen : MonoBehaviour\n{\n    // the install / download button\n    public void OnInstallTapped() => Playable.InstallFullGame();\n\n    // a round was won or lost\n    public void OnRoundOver() => LifeCycle.GameEnded();\n}",
      },
      { h: "In HTML5" },
      { lang: "JavaScript", code: "installButton.addEventListener(\"click\", () => window.PF.install());\n\n// when the round ends\nwindow.PF.lifecycle.gameEnded();" },
      { h: "What each network gets" },
      {
        table: {
          head: ["Networks", "The install call becomes"],
          rows: [
            ["AppLovin, Unity Ads, Liftoff, Moloco and other MRAID networks", <code key="m">mraid.open(url)</code>],
            ["Google Ads, DV360", <code key="g">ExitApi.exit()</code>],
            ["Meta", <code key="f">FbPlayableAd.onCTAClick()</code>],
            ["Mintegral", <code key="i">window.install()</code>],
            ["TikTok / Pangle", <code key="p">window.openAppStore()</code>],
            ["ironSource", <code key="d">dapi.openStoreUrl()</code>],
            ["Vungle", <code key="v">postMessage("download")</code>],
          ],
        },
      },
      {
        note: "Game end matters too: Vungle gets a \"complete\" message and Pangle gets gameEnd(). Every call falls back to a plain store link when the network SDK is missing, so the same file works in our preview.",
      },
      { h: "Lifecycle and helpers" },
      {
        table: {
          head: ["Unity", "Does"],
          rows: [
            [<code key="1">LifeCycle.GameLoaded() / GameStarted()</code>, "Signals load and the start of play (start feeds the analytics funnel)"],
            [<code key="2">LifeCycle.GamePaused() / GameResumed()</code>, "Tells the network the game paused or resumed"],
            [<code key="3">LifeCycle.OnPause / OnResume</code>, "Raised when the ad container hides or shows your game"],
            [<code key="4">LifeCycle.LevelChanged(n)</code>, "Logs a level change"],
            [<code key="5">Playable.SetLoadingProgress(0–1)</code>, "Drives the preloader bar; 1 hides it"],
            [<code key="6">Playable.GetPlatform()</code>, "ios, android or web"],
            [<code key="7">Playable.GetPreferredLanguage()</code>, "The device language, for localised text"],
            [<code key="8">LifeCycle.HapticTriggered(type)</code>, "A vibration where the device supports it"],
          ],
        },
      },
      { tip: "Networks reject ads that keep running off-screen. Pause your game on LifeCycle.OnPause (PF.on(\"pause\", …) in HTML5) and continue on OnResume." },
    ],
  },
  {
    id: "variables",
    group: "Guides",
    title: "Variables",
    lead: "Mark fields in your scripts and tune them from the dashboard. Change a value, re-export, done. No rebuild.",
    body: [
      { h: "Mark a field" },
      {
        lang: "C#",
        code: 'using FactorialAdLab;\nusing UnityEngine;\n\npublic class Level : MonoBehaviour\n{\n    [AdLabField("Taps to win", order: 1, section: "Gameplay", Min = 1, Max = 10)]\n    [AdLabFieldStep(1)]\n    public int tapsToWin = 3;\n}',
      },
      {
        p: "The plugin uploads the list of marked fields with your build. Each playable then shows an editor for them in the dashboard. Exports carry your values, and the plugin applies them to the fields when the scene loads.",
      },
      { h: "Read a value anywhere" },
      { lang: "C#", code: 'float speed = Variables.Get("speed", 1.5f);' },
      { lang: "JavaScript", code: 'const speed = window.PF.getVar("speed", 1.5);' },
      { note: "Values are baked in at export time. Files you exported earlier keep their old values; export again to pick up a change." },
    ],
  },
  {
    id: "export",
    group: "Guides",
    title: "Export to networks",
    lead: "Pick the networks and get one file per network, already in the format, size and naming that network expects.",
    body: [
      { h: "Export" },
      {
        steps: [
          "Open the concept in Playable Ads and select the playable.",
          "Tick the networks you need and press Export.",
          <>
            Press Preview, play it in the phone frame and tap install. The panel under the phone should say <b>CTA fired</b>.
          </>,
          "Download each file, or all of them at once, and upload them to the networks.",
        ],
      },
      { tip: "Use Chrome for previews. The preview runs the exact file the network gets." },
      { h: "Networks" },
      { networks: true },
      { note: "The Free plan exports to Unity Ads. Starter and above export to every network." },
    ],
  },
  {
    id: "preloader",
    group: "Guides",
    title: "Preloader kits",
    lead: "A branded loading screen shown over your playable while it loads.",
    body: [
      { h: "Make a kit" },
      {
        list: [
          "Pick a template: Classic, Minimal, Pulse, Ring, Dots, or Splash (a full-screen image).",
          "Add your logo or splash image (PNG, JPG, GIF, WebP or SVG, up to 512 KB; it is inlined into every export).",
          "Set the background and accent colours, an optional tagline, and whether to show a percentage.",
        ],
      },
      { h: "Where a kit applies" },
      { p: "A concept uses its own kit if it has one, otherwise its app's, otherwise the workspace default. Re-export to pick up a change." },
      { h: "Drive the bar from your game" },
      { lang: "C#", code: "Playable.SetLoadingProgress(0.5f); // half way\nPlayable.SetLoadingProgress(1f);   // done: hides the preloader" },
      { lang: "JavaScript", code: "window.PF.setLoadingProgress(0.5);\nwindow.PF.hidePreloader();" },
      { go: { label: "Customize Preloader", to: { page: "preloader" } } },
    ],
  },
  {
    id: "analytics",
    group: "Reference",
    title: "Analytics events",
    lead: "With analytics on, exported playables send one tiny beacon per step of the funnel. The Analytics page counts them per network and per playable.",
    body: [
      { h: "Standard events" },
      {
        table: {
          head: ["Event", "Sent when", "Shown as"],
          rows: [
            [<code key="i">impression</code>, "The playable loads", "Impressions"],
            [<code key="e">engage</code>, "The first touch, click or key press", "Engaged"],
            [<code key="s">start</code>, <>LifeCycle.GameStarted()</>, "Started"],
            [<code key="c">complete</code>, <>LifeCycle.GameEnded()</>, "Completed"],
            [<code key="t">cta</code>, "The install call", "Install taps"],
            [<code key="x">custom</code>, "Your own events", "Custom events"],
          ],
        },
      },
      {
        p: "Standard events count at most once per play, so the rates are per play: engagement, completion and CTR are each divided by impressions. Custom events count every time, and their values are summed.",
      },
      { h: "Custom events" },
      { lang: "C#", code: 'Analytics.LogEvent("tutorial_done", 1);\nAnalytics.Applovin.LogChallengeSolved(); // AppLovin\'s standard challenge events' },
      { lang: "JavaScript", code: 'window.PF.analytics.logEvent("tutorial_done", 1);' },
      { h: "Good to know" },
      {
        list: [
          "Plays from our own device preview are left out unless you tick “Include device-preview plays”.",
          "The beacon is left out of Meta, Google Ads, DV360, Mintegral and TikTok/Pangle files, whose rules forbid outbound requests.",
          "Turning analytics on or off applies to future exports.",
        ],
      },
    ],
  },
  {
    id: "help",
    group: "Support",
    title: "Help",
    lead: "Stuck? Most problems have a quick fix. If not, we answer every ticket.",
    body: [
      { h: "Common fixes" },
      {
        list: [
          <>
            <b className="docs-lead-in">The plugin can't sign in.</b> Check that the API field in the Playable Builder is this site's address, and enter your 2FA code
            if you use one.
          </>,
          <>
            <b className="docs-lead-in">Compile fails.</b> Install the WebGL Build Support module in Unity Hub, or use Capture instead.
          </>,
          <>
            <b className="docs-lead-in">The install button does nothing in preview.</b> Make sure the button calls <code>Playable.InstallFullGame()</code>, and preview
            in Chrome.
          </>,
          <>
            <b className="docs-lead-in">Export is locked.</b> Verify your company domain, and check that your plan covers the network.
          </>,
        ],
      },
      { h: "Contact us" },
      { p: "Open a ticket from the Support page. We reply there and by email. Found a bug? Use Report a bug on the same page." },
      { go: { label: "Open Support", to: { page: "support" } } },
    ],
  },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const prefersReduced = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  }
  return (
    <div className="docs-code">
      <span className="docs-code-lang">{lang}</span>
      <button type="button" className="docs-code-copy" onClick={() => void copy()}>
        {copied ? "Copied" : "Copy"}
      </button>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}

const FORMAT: Record<string, string> = { "mraid-single-html": "MRAID HTML", "single-html": "HTML", zip: "ZIP" };

function NetworksTable() {
  const [nets, setNets] = useState<Network[] | null>(null);
  useEffect(() => {
    getNetworks()
      .then(setNets)
      .catch(() => setNets([]));
  }, []);
  if (!nets) return <p className="docs-p">Loading networks…</p>;
  if (!nets.length) return <p className="docs-p">The network list couldn't load. It's also on the export panel of every playable.</p>;
  return (
    <div className="docs-table pg-tablewrap">
      <table className="pg-table">
        <thead>
          <tr>
            <th>Network · {nets.length}</th>
            <th>File</th>
            <th className="r">Max size</th>
          </tr>
        </thead>
        <tbody>
          {nets.map((n) => (
            <tr key={n.id}>
              <td>{n.name}</td>
              <td>{FORMAT[n.format] ?? n.format}</td>
              <td className="r">{Math.round(n.maxSizeBytes / (1024 * 1024))} MB</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Docs({ go }: { go?: (r: Route) => void } = {}) {
  const [pageId, setPageId] = useState<DocsPageId>(() => readDocsHint() ?? "overview");
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(clearDocsHint, []); // the hint is one-shot

  const idx = Math.max(
    0,
    PAGES.findIndex((p) => p.id === pageId),
  );
  const page = PAGES[idx]!;
  const prev = PAGES[idx - 1];
  const next = PAGES[idx + 1];
  const headings = page.body.flatMap((b) => ("h" in b ? [b.h] : []));

  function open(id: DocsPageId) {
    setPageId(id);
    setMenuOpen(false);
    try {
      window.scrollTo({ top: 0 });
    } catch {
      /* old browsers */
    }
  }
  function jump(h: string) {
    document.getElementById(`${page.id}-${slug(h)}`)?.scrollIntoView({ behavior: prefersReduced() ? "auto" : "smooth", block: "start" });
  }
  const link = (to: Route) => ({ href: routePath(to), onClick: go ? linkClick(() => go(to)) : undefined });

  const render = (b: Block, i: number): ReactNode => {
    if ("h" in b)
      return (
        <h3 key={i} className="docs-h2" id={`${page.id}-${slug(b.h)}`}>
          {b.h}
        </h3>
      );
    if ("p" in b)
      return (
        <p key={i} className="docs-p">
          {b.p}
        </p>
      );
    if ("note" in b)
      return (
        <div key={i} className="docs-callout note">
          <b>Note</b>
          <span>{b.note}</span>
        </div>
      );
    if ("tip" in b)
      return (
        <div key={i} className="docs-callout tip">
          <b>Tip</b>
          <span>{b.tip}</span>
        </div>
      );
    if ("code" in b) return <CodeBlock key={i} code={b.code} lang={b.lang} />;
    if ("steps" in b)
      return (
        <ol key={i} className="docs-steps">
          {b.steps.map((s, j) => (
            <li key={j}>{s}</li>
          ))}
        </ol>
      );
    if ("list" in b)
      return (
        <ul key={i} className="docs-list">
          {b.list.map((s, j) => (
            <li key={j}>
              <span className="docs-bullet">
                <Icon.Check />
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ul>
      );
    if ("table" in b)
      return (
        <div key={i} className="docs-table pg-tablewrap">
          <table className="pg-table">
            <thead>
              <tr>
                {b.table.head.map((h, j) => (
                  <th key={j}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.table.rows.map((r, j) => (
                <tr key={j}>
                  {r.map((c, k) => (
                    <td key={k}>{c}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    if ("networks" in b) return <NetworksTable key={i} />;
    return (
      <p key={i} className="docs-p">
        <a className="docs-link" {...link(b.go.to)}>
          {b.go.label} →
        </a>
      </p>
    );
  };

  return (
    <div>
      <PageHead icon={<Icon.File />} title="Documentation" sub="An overview, short guides and the runtime API: from installing the plugin to files for every network." />

      <div className="docs-layout">
        <div className="docs-side">
          <button type="button" className="docs-menu-btn" aria-expanded={menuOpen} aria-controls="docs-nav" onClick={() => setMenuOpen((o) => !o)}>
            <span>
              Pages <span className="docs-menu-cur">· {page.title}</span>
            </span>
            <span className={`docs-menu-chev${menuOpen ? " open" : ""}`} aria-hidden="true">
              ›
            </span>
          </button>
          <nav id="docs-nav" className={`docs-nav${menuOpen ? " open" : ""}`} aria-label="Documentation pages">
            {GROUPS.map((g) => (
              <div key={g} className="docs-nav-group">
                <div className="docs-nav-label">{g}</div>
                {PAGES.filter((p) => p.group === g).map((p) => (
                  <button key={p.id} className={`docs-nav-item${p.id === page.id ? " on" : ""}`} aria-current={p.id === page.id ? "page" : undefined} onClick={() => open(p.id)}>
                    {p.title}
                  </button>
                ))}
              </div>
            ))}
          </nav>
        </div>

        <article className="docs-article">
          <div className="docs-crumbs">
            <span>Docs</span>
            <span aria-hidden="true">›</span>
            <span>{page.group}</span>
          </div>
          <h2 className="docs-h1">{page.title}</h2>
          {page.lead && <p className="docs-lead">{page.lead}</p>}
          {page.body.map(render)}

          <div className="docs-pager">
            {prev ? (
              <button className="docs-prev" onClick={() => open(prev.id)}>
                ← {prev.title}
              </button>
            ) : (
              <span />
            )}
            {next && (
              <button className="docs-next" onClick={() => open(next.id)}>
                <span className="docs-next-k">Next</span>
                <span className="docs-next-t">{next.title} ›</span>
              </button>
            )}
          </div>
        </article>

        {headings.length > 1 && (
          <aside className="docs-toc" aria-label="On this page">
            <div className="docs-nav-label">On this page</div>
            {headings.map((h) => (
              <button key={h} type="button" className="docs-toc-item" onClick={() => jump(h)}>
                {h}
              </button>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}
