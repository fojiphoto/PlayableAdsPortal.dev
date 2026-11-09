import { useEffect, useState, type ReactNode } from "react";
import { createApp, createConcept, downloadPlugin, getOnboarding, resendVerification } from "../api";
import type { Onboarding } from "../types";
import type { Route } from "../router";
import { Icon } from "./icons";
import { Loading, Msg, PageHead } from "./pageKit";
import { rememberDocsPage, type DocsPageId } from "./Docs";

interface Check {
  key: string;
  title: string;
  why: string;
  done: boolean;
  optional?: boolean;
  how?: ReactNode;
  action?: ReactNode;
}

interface Step {
  key: string;
  title: string;
  body: ReactNode;
  /** live status from GET /api/onboarding (undefined: nothing to track) */
  done?: boolean;
  partial?: string;
  action?: ReactNode;
  shot: ReactNode;
}

/**
 * Setup: from sign-up to a shipped playable. The account checks (email, company domain) sit on top,
 * then the plugin download and the numbered Unity steps, each with a drawn editor-window illustration.
 * Status comes live from the server (GET /api/onboarding), so finished steps tick themselves.
 */
export function Start({ go, onDataChanged, canEdit }: { go: (r: Route) => void; onDataChanged: () => void; canEdit: boolean }) {
  const [ob, setOb] = useState<Onboarding | null>(null);
  const [appName, setAppName] = useState("");
  const [conceptName, setConceptName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [copied, setCopied] = useState("");

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
      onDataChanged();
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  const toDocs = (page: DocsPageId) => {
    rememberDocsPage(page);
    go({ page: "docs" });
  };
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch {
      /* clipboard blocked */
    }
  }

  const head = <PageHead title="Set up the Unity plugin" sub="Build playables straight from the Unity editor and send them here in one click. Each step ticks itself when it's done." />;
  if (!ob)
    return (
      <div className="pg-setup">
        {head}
        {msg ? <Msg kind="err">{msg.text}</Msg> : <Loading>Loading your checklist…</Loading>}
      </div>
    );

  const origin = window.location.origin;
  const freeOnly = ob.plan.networks !== "all";
  const concept = ob.firstConcept;
  const isAdmin = ob.workspace.role === "owner" || ob.workspace.role === "admin";
  const company = ob.companyDomain;
  const openConcept = concept ? () => go({ page: "app", appId: concept.appId, conceptId: concept.id }) : null;
  const download = () => void act(async () => downloadPlugin(), "Downloaded. Import it into Unity and sign in from the Playable Builder.");

  // ── account checks ──
  const checks: Check[] = [
    {
      key: "email",
      title: "Verify your email",
      why: company
        ? `You signed up with a ${company} address: verifying it also verifies your company domain.`
        : "We use it for password resets, invites and support replies. Open the email from Factorial AdLab and click the link.",
      done: ob.emailVerified,
      optional: !company,
      action: (
        <button className="pg-btn pg-btn-ghost pg-btn-sm" disabled={busy} onClick={() => void act(() => resendVerification(), "Verification email sent. Check your inbox and spam.")}>
          Resend email
        </button>
      ),
    },
    {
      key: "domain",
      title: "Verify your company domain",
      why: "Ad networks only accept playables from a verified publisher, so exports unlock once your domain is verified.",
      done: ob.domain.verified,
      how: !isAdmin ? (
        <>A workspace admin does this. Ask the owner of “{ob.workspace.name}”.</>
      ) : company && !ob.emailVerified ? (
        <>Fastest: verify your {company} email above and the domain verifies itself. Or add a line to app-ads.txt on the Domain page.</>
      ) : (
        <>On the Domain page, enter your domain and add the token it shows to app-ads.txt (or upload the small verify file). Press Check now.</>
      ),
      action: isAdmin ? (
        <button className={`pg-btn pg-btn-sm ${company && !ob.emailVerified ? "pg-btn-ghost" : "pg-btn-primary"}`} onClick={() => go({ page: "domain" })}>
          Open the Domain page
        </button>
      ) : undefined,
    },
  ];

  // ── the numbered Unity steps ──
  const steps: Step[] = [
    {
      key: "import",
      title: "Download and import",
      done: ob.plugin.downloaded,
      body: (
        <>
          Press <b>Download plugin</b> above. In Unity choose <b>Assets ▸ Import Package ▸ Custom Package…</b>, pick the file and press <b>Import</b>. It installs
          under <code>Assets/FactorialAdLab</code>; your scenes and scripts stay as they are.
        </>
      ),
      shot: <ShotImport version={ob.plugin.version} />,
    },
    {
      key: "compile",
      title: "Let the first compile finish",
      body: <>Unity compiles the plugin's scripts once, right after the import. Wait for the spinner in the bottom-right corner of the editor to stop.</>,
      shot: <ShotCompile />,
    },
    {
      key: "open",
      title: "Open the Playable Builder",
      body: (
        <>
          From the menu bar choose <b>Factorial AdLab ▸ Playable Builder</b>. Dock the window wherever you like; it remembers your settings per project.
        </>
      ),
      shot: <ShotMenu />,
    },
    {
      key: "signin",
      title: "Sign in",
      done: !!ob.plugin.connectedAt,
      partial: ob.plugin.downloaded && !ob.plugin.connectedAt ? "Downloaded; sign in to finish" : undefined,
      body: (
        <>
          Check that <b>API</b> is <code>{origin}</code>, then sign in with this account (plus your 2FA code if it's on).
        </>
      ),
      shot: <ShotSignIn origin={origin} />,
    },
    {
      key: "cta",
      title: "Hook up the install button",
      body: (
        <>
          Add <code>using FactorialAdLab;</code> and call <code>Playable.InstallFullGame()</code> when the install button is tapped. Call{" "}
          <code>LifeCycle.GameEnded()</code> when a round ends.{" "}
          <button className="pg-link" onClick={() => toDocs("cta")}>
            More in Docs
          </button>
        </>
      ),
      shot: <ShotCta />,
    },
    {
      key: "build",
      title: "Build & upload",
      done: ob.counts.creatives > 0,
      body: (
        <>
          Exit Play mode and press <b>Build, compile &amp; upload playable</b> (needs the WebGL module), or press Play and use <b>Capture &amp; upload playable</b>,
          which always fits every network's size limit. The plugin creates the app and concept for you.
        </>
      ),
      action: openConcept ? (
        <button className="pg-btn pg-btn-ghost pg-btn-sm" onClick={openConcept}>
          Open your concept
        </button>
      ) : undefined,
      shot: <ShotBuild />,
    },
    {
      key: "export",
      title: "Preview and export",
      done: ob.counts.exports > 0,
      body: (
        <>
          Open the concept, select the playable, tick the networks and press <b>Export</b>. Press <b>Preview</b> and tap install: the panel under the phone should say{" "}
          <b>CTA fired</b>. Then download each file and upload it to the network.
          {freeOnly && <> Your {ob.plan.name} plan exports to Unity Ads; the other networks come with a paid plan.</>}
        </>
      ),
      action:
        openConcept || freeOnly ? (
          <span className="flex flex-wrap gap-2">
            {openConcept && (
              <button className="pg-btn pg-btn-ghost pg-btn-sm" onClick={openConcept}>
                Open your concept
              </button>
            )}
            {freeOnly && (
              <button className="pg-btn pg-btn-ghost pg-btn-sm" onClick={() => go({ page: "plans" })}>
                See plans
              </button>
            )}
          </span>
        ) : undefined,
      shot: <ShotExport />,
    },
    {
      key: "update",
      title: "Stay up to date",
      body: (
        <>
          The plugin checks for a new version once per editor session. Press <b>Update to x.y.z</b> in the window and it imports over the old one in place.
        </>
      ),
      shot: <ShotUpdate version={ob.plugin.version} />,
    },
  ];

  const tracked = [checks[1]!, ...steps.filter((s) => s.done !== undefined)];
  const doneCount = tracked.filter((s) => s.done).length;
  const nextKey = [...checks.filter((c) => !c.optional && !(c.key === "domain" && !isAdmin)), ...steps].find((s) => s.done === false)?.key;
  const nextTitle = [...checks, ...steps].find((s) => s.key === nextKey)?.title;

  return (
    <div className="pg-setup">
      {head}

      <div className="setup-progress" aria-label="Setup progress">
        <div className="setup-progress-row">
          <span>
            {doneCount} of {tracked.length} done
          </span>
          {nextTitle ? <span>Next: {nextTitle}</span> : <span style={{ color: "var(--brand)" }}>All set. You're shipping playables.</span>}
        </div>
        <div className="pg-bar" role="progressbar" aria-valuenow={doneCount} aria-valuemin={0} aria-valuemax={tracked.length}>
          <i style={{ width: `${(doneCount / tracked.length) * 100}%` }} />
        </div>
      </div>

      {msg && <Msg kind={msg.ok ? "success" : "err"}>{msg.text}</Msg>}

      {/* account checks */}
      <section className="setup-card block">
        <div className="setup-section">Before you start</div>
        <ul className="setup-status">
          {checks.map((c) => (
            <li key={c.key}>
              <span className={`setup-step-n${c.done ? " done" : ""}`} aria-hidden="true">
                {c.done ? <Icon.Check /> : c.key === "email" ? <Icon.Mail width={14} height={14} /> : <Icon.Globe width={14} height={14} />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="setup-step-t">
                  {c.title}
                  {c.optional && !c.done && <span className="pg-tag">Optional</span>}
                </div>
                <p className="setup-step-d">{c.why}</p>
                {!c.done && c.how && <p className="setup-step-d">{c.how}</p>}
                {!c.done && c.action && <div className="mt-2.5">{c.action}</div>}
              </div>
              <StatePill done={c.done} next={nextKey === c.key} />
            </li>
          ))}
        </ul>
      </section>

      {/* plugin download */}
      <section className="setup-card">
        <div className="min-w-0">
          <div className="setup-dl-name">Factorial AdLab for Unity</div>
          <div className="setup-dl-ver">Version {ob.plugin.version} · .unitypackage · Unity 6 (6000.0) or newer</div>
          {ob.plugin.downloaded && (
            <div className="mt-2">
              <span className={`pg-tag ${ob.plugin.connectedAt ? "ok" : "brand"}`}>{ob.plugin.connectedAt ? "Connected" : "Downloaded"}</span>
            </div>
          )}
        </div>
        <button className="pg-btn pg-btn-primary" disabled={busy} onClick={download}>
          <Icon.Download />
          {busy ? "Preparing your copy…" : ob.plugin.downloaded ? "Download again" : "Download plugin"}
        </button>
      </section>

      {/* the numbered steps */}
      <ol className="setup-steps">
        {steps.map((s, i) => (
          <li key={s.key} className="setup-step">
            <span className={`setup-step-n${s.done ? " done" : ""}`} aria-label={s.done ? `Step ${i + 1}, done` : `Step ${i + 1}`}>
              {s.done ? <Icon.Check /> : i + 1}
            </span>
            <div className="min-w-0">
              <div className="setup-step-t">
                {s.title}
                {s.done === undefined ? null : s.done ? (
                  <span className="pg-tag ok">Done</span>
                ) : s.partial ? (
                  <span className="pg-tag warn">{s.partial}</span>
                ) : nextKey === s.key ? (
                  <span className="pg-tag gold">Next</span>
                ) : null}
              </div>
              <p className="setup-step-d">{s.body}</p>
              {s.action && <div className="mt-2.5">{s.action}</div>}
            </div>
            <figure className="setup-shot" aria-label={`Step ${i + 1}: ${s.title}`}>
              {s.shot}
            </figure>
          </li>
        ))}
      </ol>

      {/* quick guide */}
      <section className="setup-card block setup-cta">
        <div className="setup-cta-t">Quick guide: the install button and the game end</div>
        <ol className="setup-cta-steps">
          <li>On the install / download button, call the store opener. We route it to each network's own mechanism when you export.</li>
          <li>When a round is won or lost, report the game end so networks that need it (Vungle, Pangle) get their signal.</li>
        </ol>
        {[
          { k: "install", code: "Playable.InstallFullGame();" },
          { k: "end", code: "LifeCycle.GameEnded();" },
        ].map((c) => (
          <div key={c.k} className="docs-code">
            <button type="button" className="docs-code-copy" onClick={() => void copy(c.k, c.code)}>
              {copied === c.k ? "Copied" : "Copy"}
            </button>
            <span className="docs-code-lang">C#</span>
            <pre>
              <code>{c.code}</code>
            </pre>
          </div>
        ))}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <button className="pg-link" onClick={() => toDocs("cta")}>
            CTA &amp; game end in Docs →
          </button>
          <button className="pg-link" onClick={() => toDocs("variables")}>
            Variables in Docs →
          </button>
        </div>
      </section>

      {/* not on Unity */}
      <section className="setup-card block">
        <div className="setup-next-t">Not using Unity? Upload an HTML5 build</div>
        <p className="setup-next-d" style={{ marginBottom: 12 }}>
          Make an app (your game) and a concept (one ad idea), then upload a .zip or .html of your build in the concept and export as above. In your code call{" "}
          <code className="pg-code">window.PF.install()</code> on the install button.
        </p>
        {ob.counts.apps === 0 ? (
          canEdit && (
            <form
              className="flex max-w-md flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (appName.trim()) void act(async () => createApp(appName.trim()), "App created.");
              }}
            >
              <input className="pg-input min-w-[180px] flex-1" placeholder="Game name" value={appName} onChange={(e) => setAppName(e.target.value)} aria-label="Game name" />
              <button className="pg-btn pg-btn-primary" disabled={busy || !appName.trim()}>
                Create app
              </button>
            </form>
          )
        ) : ob.counts.concepts === 0 && ob.firstAppId ? (
          canEdit && (
            <form
              className="flex max-w-md flex-wrap gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (conceptName.trim() && ob.firstAppId) void act(async () => createConcept(ob.firstAppId!, conceptName.trim()), "Concept created.");
              }}
            >
              <input
                className="pg-input min-w-[180px] flex-1"
                placeholder="Ad idea, e.g. Tutorial level"
                value={conceptName}
                onChange={(e) => setConceptName(e.target.value)}
                aria-label="Concept name"
              />
              <button className="pg-btn pg-btn-primary" disabled={busy || !conceptName.trim()}>
                Create concept
              </button>
            </form>
          )
        ) : (
          openConcept && (
            <button className="pg-btn pg-btn-ghost pg-btn-sm" onClick={openConcept}>
              Open your concept to upload
            </button>
          )
        )}
      </section>

      {/* extras */}
      <section className="setup-card block">
        <div className="setup-next-t" style={{ marginBottom: 10 }}>
          Optional extras
        </div>
        <ul className="setup-extras">
          <li>
            <Icon.Image />
            <span>
              <button className="pg-link" onClick={() => go({ page: "preloader" })}>
                Brand your loading screen
              </button>{" "}
              with your logo and colours while the playable loads.
            </span>
          </li>
          <li>
            <Icon.Pencil />
            <span>
              Tune values without rebuilding: fields marked <code className="pg-code">[AdLabField]</code> get an editor on each playable.
            </span>
          </li>
          <li>
            <Icon.Users />
            <span>
              <button className="pg-link" onClick={() => go({ page: "settings" })}>
                Invite your team
              </button>{" "}
              and share the workspace with roles from viewer to admin.
            </span>
          </li>
          <li>
            <Icon.Chart />
            <span>
              <button className="pg-link" onClick={() => go({ page: "analytics" })}>
                Watch how your ads play
              </button>
              : impressions, engagement and install taps per network.
            </span>
          </li>
          <li>
            <Icon.Chat />
            <span>
              Stuck?{" "}
              <button className="pg-link" onClick={() => go({ page: "support" })}>
                Ask support
              </button>{" "}
              and we'll help.
            </span>
          </li>
        </ul>
      </section>

      <section className="setup-card">
        <div>
          <div className="setup-next-t">Already uploaded a build?</div>
          <p className="setup-next-d">Open your library to preview it and export to every network.</p>
        </div>
        <button className="pg-btn pg-btn-ghost" onClick={() => go({ page: "app" })}>
          Go to Playable Ads
        </button>
      </section>
    </div>
  );
}

function StatePill({ done, next }: { done: boolean; next: boolean }) {
  return <span className={`pg-tag ${done ? "ok" : next ? "brand" : ""} shrink-0`}>{done ? "Done" : next ? "Next" : "To do"}</span>;
}

/* ── drawn editor-window illustrations (not screenshots) ── */

function Win({ title, light, children }: { title: string; light?: boolean; children: ReactNode }) {
  return (
    <div className={`shot-win${light ? " light" : ""}`}>
      <div className="shot-bar">
        <span className="shot-dots">
          <i />
          <i />
          <i />
        </span>
        <span className="shot-title">{title}</span>
      </div>
      <div className="shot-body">{children}</div>
    </div>
  );
}

const BUILDER = "Factorial AdLab — Playable Builder";

function ShotImport({ version }: { version: string }) {
  return (
    <Win title="Import Unity Package">
      <div className="shot-tree">
        <div>
          <b>☑</b> Assets
        </div>
        <div className="in1">
          <b>☑</b> FactorialAdLab
        </div>
        <div className="in2">
          <b>☑</b> Editor <span className="dim">Playable Builder</span>
        </div>
        <div className="in2">
          <b>☑</b> Runtime <span className="dim">Playable.cs</span>
        </div>
        <div className="in2">
          <b>☑</b> Plugins/WebGL <span className="dim">.jslib</span>
        </div>
      </div>
      <div className="shot-row end">
        <span className="shot-btn">Cancel</span>
        <span className="shot-btn hot">Import</span>
      </div>
      <div className="shot-note">FactorialAdLab-{version}.unitypackage</div>
    </Win>
  );
}

function ShotCompile() {
  return (
    <Win title="Unity — your project">
      <div className="shot-empty" />
      <div className="shot-status">
        <span className="shot-spin" /> Compiling scripts… <span className="dim">(once, after the import)</span>
      </div>
    </Win>
  );
}

function ShotMenu() {
  return (
    <Win title="Unity">
      <div className="shot-menubar">
        <span>File</span>
        <span>Edit</span>
        <span>Assets</span>
        <span>GameObject</span>
        <span className="on">Factorial AdLab</span>
        <span>Window</span>
      </div>
      <div className="shot-menu">
        <div className="hot">
          <span>Playable Builder</span>
        </div>
      </div>
      <div className="shot-empty" />
    </Win>
  );
}

function ShotSignIn({ origin }: { origin: string }) {
  return (
    <Win title={BUILDER}>
      <div className="shot-card">
        <div className="shot-h">SIGN IN</div>
        <div className="shot-field">
          API <span>{origin.replace(/^https?:\/\//, "")}</span>
        </div>
        <div className="shot-field">
          Email <span>you@studio.com</span>
        </div>
        <div className="shot-field">
          Password <span>••••••••••</span>
        </div>
        <div className="shot-row end">
          <span className="shot-btn hot">Sign in</span>
        </div>
      </div>
    </Win>
  );
}

function ShotCta() {
  return (
    <Win title="EndScreen.cs">
      <div className="shot-split">
        <div className="shot-card" style={{ fontFamily: "var(--font-mono)", fontSize: 10, gap: 3 }}>
          <div className="shot-li dim">using FactorialAdLab;</div>
          <div className="shot-li">void OnInstallTapped() {"{"}</div>
          <div className="shot-li ok">&nbsp;&nbsp;Playable.InstallFullGame();</div>
          <div className="shot-li">{"}"}</div>
          <div className="shot-li">void OnRoundOver() {"{"}</div>
          <div className="shot-li ok">&nbsp;&nbsp;LifeCycle.GameEnded();</div>
          <div className="shot-li">{"}"}</div>
        </div>
        <div className="shot-phone">
          <div className="shot-phone-screen">
            <span className="shot-cta">INSTALL</span>
          </div>
        </div>
      </div>
    </Win>
  );
}

function ShotBuild() {
  return (
    <Win title={BUILDER}>
      <div className="shot-card">
        <div className="shot-h">COMPILE THE GAME (UNITY WEBGL → PLAYABLE)</div>
        <div className="shot-row">
          <span className="shot-btn hot">Build, compile &amp; upload playable</span>
        </div>
        <div className="shot-progress">
          <i style={{ width: "68%" }} />
        </div>
        <div className="shot-li dim">Uploading… 68%</div>
      </div>
      <div className="shot-card">
        <div className="shot-h">CAPTURE GAMEPLAY</div>
        <div className="shot-row">
          <span className="shot-btn">Capture &amp; upload playable</span>
        </div>
      </div>
    </Win>
  );
}

function ShotExport() {
  return (
    <Win title="Factorial AdLab — your concept" light>
      <div className="shot-split">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="shot-li dim">Puzzle Quest › Tutorial level</div>
          <div className="shot-nets">
            {["AppLovin", "Unity Ads", "Meta", "ironSource", "Google Ads", "TikTok", "Mintegral", "Moloco"].map((n, i) => (
              <span key={n} className={`shot-chip${i < 4 ? " on" : ""}`}>
                {n}
              </span>
            ))}
          </div>
          <div className="shot-row">
            <span className="shot-btn hot">Export</span>
            <span className="shot-btn" style={{ borderColor: "var(--line-strong)" }}>
              Preview
            </span>
          </div>
        </div>
        <div className="shot-phone">
          <div className="shot-phone-screen">
            <span className="shot-cta">INSTALL</span>
          </div>
        </div>
      </div>
    </Win>
  );
}

function ShotUpdate({ version }: { version: string }) {
  return (
    <Win title={BUILDER}>
      <div className="shot-card">
        <div className="shot-h">PLUGIN {version}</div>
        <div className="shot-li ok">A new version is available.</div>
        <div className="shot-row">
          <span className="shot-btn hot">Update to the latest</span>
          <span className="shot-btn">Check for updates</span>
        </div>
      </div>
      <div className="shot-note">Imports over the old copy; your settings stay.</div>
    </Win>
  );
}
