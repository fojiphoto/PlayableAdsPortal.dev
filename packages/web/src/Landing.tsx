import { useEffect, useRef, useState, type FormEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { ChatBubble } from "./components/ChatBubble";
import "./landing.css";

/* ── data ─────────────────────────────────────────────── */

const NAV: { id: string; label: string }[] = [
  { id: "how", label: "How it works" },
  { id: "networks", label: "Networks" },
  { id: "compare", label: "Why AdLab" },
  { id: "pricing", label: "Pricing" },
  { id: "faq", label: "FAQ" },
  { id: "contact", label: "Contact" },
];

/** Every network the exporter supports (mirrors GET /api/networks). */
const NETWORKS: { name: string; abbr: string; color: string }[] = [
  { name: "AppLovin", abbr: "AL", color: "#1a73e8" },
  { name: "Unity Ads", abbr: "U", color: "#222c37" },
  { name: "Google Ads", abbr: "G", color: "#34a853" },
  { name: "Meta", abbr: "M", color: "#0866ff" },
  { name: "TikTok / Pangle", abbr: "TT", color: "#111111" },
  { name: "Mintegral", abbr: "MT", color: "#00a6a6" },
  { name: "ironSource", abbr: "iS", color: "#5d2de6" },
  { name: "Vungle", abbr: "V", color: "#7a3cff" },
  { name: "Liftoff", abbr: "LO", color: "#e2335c" },
  { name: "DV360", abbr: "DV", color: "#1e8e3e" },
  { name: "Snapchat", abbr: "SC", color: "#e6c200" },
  { name: "Moloco", abbr: "MO", color: "#2741d6" },
  { name: "Chartboost", abbr: "CB", color: "#1a9e5c" },
  { name: "AdColony", abbr: "AC", color: "#f4511e" },
  { name: "InMobi", abbr: "IM", color: "#2f6fe4" },
  { name: "Tapjoy", abbr: "TJ", color: "#8e44ad" },
  { name: "Fyber", abbr: "FY", color: "#0f9d8a" },
  { name: "Smadex", abbr: "SX", color: "#ff6b35" },
  { name: "BigaBid", abbr: "BB", color: "#3949ab" },
  { name: "Kayzen", abbr: "KZ", color: "#d81b60" },
  { name: "Remerge", abbr: "RM", color: "#00897b" },
  { name: "Tencent Ads", abbr: "TC", color: "#1677ff" },
  { name: "Aarki", abbr: "AK", color: "#c2185b" },
  { name: "LINE Ads", abbr: "LN", color: "#06c755" },
  { name: "Appreciate", abbr: "AP", color: "#6d4cff" },
  { name: "RevX", abbr: "RX", color: "#ef6c00" },
  { name: "Adikteev", abbr: "AD", color: "#5e35b1" },
  { name: "YouAppi", abbr: "YA", color: "#0097a7" },
  { name: "MRAID (generic)", abbr: "MR", color: "#546e7a" },
];
const NET_COUNT = NETWORKS.length;
const ROW_1 = NETWORKS.slice(0, 15);
const ROW_2 = NETWORKS.slice(15);
const FAN = ["AppLovin", "Meta", "Mintegral", "Google", "TikTok", "Unity"];

/** Factorial Studio's own live games (public/art/gamezone). */
const GAMES: { file: string; name: string }[] = [
  { file: "fortress-merge", name: "Fortress Merge" },
  { file: "golf-orbit", name: "Golf Orbit" },
  { file: "zombie-invasion", name: "Zombie Invasion" },
  { file: "turbo-race", name: "Turbo Race" },
  { file: "hero-adventure", name: "Hero Adventure" },
  { file: "letter-quest", name: "Letter Quest" },
  { file: "kitchen-life", name: "Kitchen Life" },
  { file: "thief-puzzle", name: "Thief Puzzle" },
  { file: "block-blast-color-puzzle-game", name: "Block Blast" },
  { file: "super-sucker", name: "Super Sucker" },
  { file: "nest-align", name: "Nest Align" },
  { file: "chicken-orbit", name: "Chicken Orbit" },
];

/** Studios Factorial Studio (the company behind AdLab) has worked with: not AdLab customers. */
const CLIENTS: { file: string; name: string }[] = [
  { file: "tapnation", name: "TapNation" },
  { file: "feral", name: "Feral Interactive" },
  { file: "torliga", name: "Torliga Champions" },
  { file: "megacat", name: "Mega Cat Studios" },
  { file: "meicon", name: "MEICON" },
  { file: "youngwilliams", name: "YoungWilliams" },
  { file: "turtlejuice", name: "Turtle Juice" },
  { file: "easternleather", name: "Eastern Leather Company" },
  { file: "genesis", name: "Genesis" },
];

type PaidPlan = "starter" | "studio";
interface PlanCard {
  id: "free" | PaidPlan | "enterprise";
  name: string;
  amount: string;
  cadence?: string;
  blurb: string;
  cta: string;
  features: string[];
  featured?: boolean;
}
/** Mirrors packages/server/src/plans.ts (monthly billing only). */
const PLANS: PlanCard[] = [
  {
    id: "free",
    name: "Free",
    amount: "$0",
    blurb: "Try the tool and export your first playable in a few minutes.",
    cta: "Start free",
    features: ["Unlimited Unity Ads exports", "Unity Ads only", "Device-frame preview", "No card required"],
  },
  {
    id: "starter",
    name: "Starter",
    amount: "$49",
    cadence: "/mo",
    blurb: "For a solo developer shipping playables on a regular basis.",
    cta: "Choose Starter",
    features: ["30 exports / 30 days", `All ${NET_COUNT} ad networks`, "Custom CTA & store links", "Device-frame preview"],
  },
  {
    id: "studio",
    name: "Studio",
    amount: "$199",
    cadence: "/mo",
    blurb: "For a UA team shipping across all the major networks.",
    cta: "Choose Studio",
    features: ["150 exports / 30 days", `All ${NET_COUNT} ad networks`, "Team workspace", "Priority support"],
    featured: true,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    amount: "Custom",
    blurb: "Unlimited volume, custom network ordering and an SLA.",
    cta: "Contact sales",
    features: ["Unlimited exports", "All networks", "Custom network ordering", "Dedicated support"],
  },
];

const COMPARE: { feat: string; us: string; them: string; bad: boolean; hl?: boolean }[] = [
  { feat: "Workflow", us: "Unity plugin or HTML5 upload", them: "Generic WebGL or third-party tools", bad: false },
  { feat: "Typical monthly cost", us: "$0 – $199 / mo", them: "Agency or per-creative fees", bad: true, hl: true },
  { feat: "Supported ad networks", us: `${NET_COUNT}, each packaged to spec`, them: "A standard set of networks", bad: false },
  { feat: "Per-network size checks", us: "Every file checked against its cap", them: "Checked by hand", bad: true },
  { feat: "Custom preloader", us: "Your own logo and loading screen", them: "No preloader branding", bad: true },
  { feat: "Setup", us: "Upload once, export everywhere", them: "Re-export for each network", bad: true },
  { feat: "Team access", us: "Shared workspaces with roles", them: "Files passed around by email", bad: true },
];

/** Illustrative only: about an hour of work (~$60) to hand-package and test one network export. */
const MANUAL_COST_PER_EXPORT = 60;
const SAVINGS: Record<PaidPlan, { name: string; price: number; exports: number }> = {
  starter: { name: "Starter", price: 49, exports: 30 },
  studio: { name: "Studio", price: 199, exports: 150 },
};

const FAQ: { q: string; a: string }[] = [
  {
    q: "What does the Unity plugin do?",
    a: "Import the .unitypackage from your dashboard into the project you already have. From the editor you pick the scene, wire the install button, then build and upload in one step. It's included on every plan, Free too.",
  },
  {
    q: "Which ad networks can I export to?",
    a: `${NET_COUNT} today, including AppLovin, Unity Ads, Google Ads, Meta, TikTok/Pangle, Mintegral, ironSource, Vungle, Liftoff and Moloco. Each export uses that network's own CTA hook and file format: single HTML, zip or MRAID.`,
  },
  {
    q: "How are file size caps handled?",
    a: "Every export is measured against the cap of the network it's for (for example 5 MB for AppLovin, 2 MB for Meta) before you download it. If a file is over, you see it straight away instead of after a rejection.",
  },
  {
    q: "Can I upload an HTML5 playable instead of a Unity build?",
    a: "Yes. Upload a single .html file or a .zip of your playable in the dashboard and export it the same way. A zipped Unity WebGL build works too, if you'd rather not use the plugin.",
  },
  {
    q: "What do I get on the Free plan?",
    a: "Unlimited Unity Ads exports with the full device-frame preview, and no card is needed. Upgrade to Starter or Studio when you want the other networks.",
  },
  {
    q: "Can my team share one account?",
    a: "Yes. Create a workspace and invite teammates. Apps, concepts and exports are shared, and roles decide who can upload and export and who can only view. You can belong to several workspaces and switch between them.",
  },
];

/* ── helpers ─────────────────────────────────────────── */

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
}

function anchor(id: string, after?: () => void) {
  return (e: ReactMouseEvent) => {
    e.preventDefault();
    after?.();
    scrollToId(id);
  };
}

/** Adds `.in` once the element scrolls into view (threshold .12). */
function useReveal<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, shown] as const;
}

/** Counts from 0 to `target` over 900 ms (ease-out cubic) whenever `run` turns true or the target changes. */
function useCountUp(target: number, run: boolean) {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!run) return;
    if (reducedMotion()) {
      setValue(target);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 900);
      setValue(Math.round(target * (1 - Math.pow(1 - t, 3))));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, run]);
  return value;
}

const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/* ── icons (lucide style) ────────────────────────────── */

function Icon({ children, width = 1.7 }: { children: ReactNode; width?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const CheckIcon = ({ width = 3 }: { width?: number }) => (
  <Icon width={width}>
    <path d="M20 6 9 17l-5-5" />
  </Icon>
);
const XIcon = ({ width = 2.4 }: { width?: number }) => (
  <Icon width={width}>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);
const MenuIcon = () => (
  <Icon width={2}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </Icon>
);
const Tick = ({ sm }: { sm?: boolean }) => (
  <span className={`lp-check${sm ? " sm" : ""}`} aria-hidden="true">
    <CheckIcon />
  </span>
);

/** A neutral isometric cube: "your Unity build". */
function CubeMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <path d="M24 4 42 14v20L24 44 6 34V14Z" fill="#222c37" />
      <path d="M24 4 42 14 24 24 6 14Z" fill="#4b5563" />
      <path d="M24 24v20L6 34V14Z" fill="#111827" />
      <path d="M24 13.5 33 18.6v10.3L24 34l-9-5.1V18.6Z" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M24 24v10M24 24l9-5.4M24 24l-9-5.4" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function NetMark({ net }: { net: (typeof NETWORKS)[number] }) {
  return (
    <span className="lp-mark" style={{ background: net.color }} aria-hidden="true">
      {net.abbr}
    </span>
  );
}

function Brand() {
  return (
    <>
      <span className="lp-brand-mark">
        <img src="/art/logo.webp" alt="" />
      </span>
      <span className="lp-brand-name">
        Factorial <b>AdLab</b>
      </span>
    </>
  );
}

/* ── page ─────────────────────────────────────────────── */

export function Landing({ onGetStarted, onSignIn }: { onGetStarted: () => void; onSignIn: () => void }) {
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    const onResize = () => window.innerWidth > 1100 && setMenu(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
    };
  }, [menu]);

  function choosePlan(id: PlanCard["id"]) {
    if (id === "enterprise") {
      scrollToId("contact");
      return;
    }
    if (id === "starter" || id === "studio") {
      try {
        sessionStorage.setItem("adlab.pendingPlan", id);
      } catch {
        /* storage blocked: the plan can still be picked on the Plans page */
      }
    }
    onGetStarted();
  }

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-nav-inner">
          <a className="lp-brand" href="#top" onClick={anchor("top")} aria-label="Factorial AdLab, back to top">
            <Brand />
          </a>
          <nav className="lp-links" aria-label="Sections">
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} onClick={anchor(n.id)}>
                {n.label}
              </a>
            ))}
          </nav>
          <div className="lp-nav-cta">
            <button className="lp-btn lp-btn-ghost" onClick={onSignIn}>
              Sign in
            </button>
            <button className="lp-btn lp-btn-solid" onClick={onGetStarted}>
              Get started
            </button>
            <button
              className="lp-burger"
              aria-label={menu ? "Close menu" : "Open menu"}
              aria-expanded={menu}
              aria-controls="lp-sheet"
              onClick={() => setMenu((m) => !m)}
            >
              {menu ? <XIcon width={2} /> : <MenuIcon />}
            </button>
          </div>
        </div>
        <div className="lp-sheet" id="lp-sheet" hidden={!menu}>
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`} onClick={anchor(n.id, () => setMenu(false))}>
              {n.label}
            </a>
          ))}
          <div className="lp-sheet-cta">
            <button className="lp-btn lp-btn-outline lp-btn-lg" onClick={onSignIn}>
              Sign in
            </button>
            <button className="lp-btn lp-btn-solid lp-btn-lg" onClick={onGetStarted}>
              Get started
            </button>
          </div>
        </div>
      </header>

      <main>
        <Hero onGetStarted={onGetStarted} />
        <Games />
        <Clients />
        <How />
        <Networks />
        <Pricing onChoose={choosePlan} />
        <Compare />
        <Savings onGetStarted={onGetStarted} />
        <Faq />
        <Contact />
        <section className="lp-cta-band">
          <h2 className="lp-h2">
            Ship your next playable to <em>every network</em> today
          </h2>
          <p className="lp-sub">Start on the free plan. No card needed to try the whole tool.</p>
          <button className="lp-btn lp-btn-white lp-btn-lg" onClick={onGetStarted}>
            Get started free
          </button>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-inner">
          <a className="lp-brand" href="#top" onClick={anchor("top")}>
            <Brand />
          </a>
          <nav className="lp-footer-links" aria-label="Footer">
            {NAV.filter((n) => n.id !== "compare").map((n) => (
              <a key={n.id} href={`#${n.id}`} onClick={anchor(n.id)}>
                {n.label}
              </a>
            ))}
            <button className="lp-linklike" onClick={onSignIn}>
              Sign in
            </button>
          </nav>
        </div>
        <div className="lp-footer-legal">
          © {new Date().getFullYear()} Factorial AdLab
          <span className="lp-footer-disclaimer">
            Network names are trademarks of their respective owners and are used only to describe export compatibility. Factorial AdLab
            isn't affiliated with or endorsed by any of them.
          </span>
        </div>
      </footer>

      <ChatBubble />
    </div>
  );
}

/* ── sections ─────────────────────────────────────────── */

function Hero({ onGetStarted }: { onGetStarted: () => void }) {
  return (
    <section id="top" className="lp-hero">
      <div className="lp-hero-copy">
        <span className="lp-eyebrow">Playable ads · one build, every network</span>
        <h1 className="lp-h1">
          One Unity build.
          <br />
          <span className="lp-grad">Every ad network,</span> exported clean.
        </h1>
        <p className="lp-lead">
          Factorial AdLab turns a single Unity build into a size-checked, correctly wrapped playable for each network you ship to, with the
          CTA, store links and MRAID calls already in place.
        </p>
        <div className="lp-hero-cta">
          <button className="lp-btn lp-btn-solid lp-btn-lg" onClick={onGetStarted}>
            Get started free
          </button>
          <a className="lp-btn lp-btn-outline lp-btn-lg" href="#how" onClick={anchor("how")}>
            See how it works
          </a>
        </div>
        <ul className="lp-hero-points">
          <li>
            <Tick /> Unity plugin included on every plan
          </li>
          <li>
            <Tick /> Every file checked against its network's cap
          </li>
          <li>
            <Tick /> Packaged the way each network's review expects
          </li>
        </ul>
      </div>

      <div className="lp-hero-art">
        <div className="fan">
          <div className="fan-source" aria-hidden="true">
            <CubeMark />
            <span className="fan-source-label">Your Unity build</span>
          </div>
          <div className="fan-out" aria-hidden="true">
            {FAN.map((n, i) => (
              <span key={n} className="fan-chip" style={{ ["--i" as string]: i }}>
                {n}
              </span>
            ))}
          </div>
          <div className="fan-phone">
            <span className="fan-phone-notch" aria-hidden="true" />
            <div className="fan-phone-screen">
              <iframe src="/adlab-demo.html" title="Demo playable" loading="lazy" sandbox="allow-scripts" tabIndex={-1} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** A wall of the studio's own game art, right under the hero (as in Factorial's GameZone). */
function Games() {
  return (
    <section className="lp-games" aria-label="Games by Factorial Studio">
      <p className="lp-games-lab">
        Built by the studio behind <b>26+ live games</b>
      </p>
      <ul className="lp-games-wall">
        {GAMES.map((g, i) => (
          <li key={g.file} className="lp-games-tile" style={{ ["--d" as string]: `${(i * 0.14).toFixed(2)}s` }}>
            <img src={`/art/gamezone/${g.file}.jpg`} alt={g.name} loading="lazy" width={160} height={160} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Logo marquee of teams Factorial Studio has worked with (never presented as AdLab customers). */
function Clients() {
  return (
    <section className="lp-clients" aria-label="Teams Factorial Studio has worked with">
      <p className="lp-clients-lab">Teams Factorial Studio has worked with</p>
      <div className="lp-clients-vp">
        <ul className="lp-clients-track">
          {[...CLIENTS, ...CLIENTS].map((c, i) => (
            <li key={i} className={`lp-clients-tile${i >= CLIENTS.length ? " dup" : ""}`} aria-hidden={i >= CLIENTS.length || undefined}>
              <img src={`/art/clients/${c.file}.webp`} alt={i >= CLIENTS.length ? "" : c.name} loading="lazy" />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SectionHead({ title, sub, left }: { title: ReactNode; sub: ReactNode; left?: boolean }) {
  return (
    <div className={`lp-section-head${left ? " left" : ""}`}>
      <h2 className="lp-h2">{title}</h2>
      <p className="lp-sub">{sub}</p>
    </div>
  );
}

function How() {
  const [ref, shown] = useReveal<HTMLElement>();
  return (
    <section id="how" ref={ref} className={`lp-section lp-reveal${shown ? " in" : ""}`}>
      <SectionHead
        title={
          <>
            From Unity build to a shippable ad <em>in three steps</em>
          </>
        }
        sub="No re-exporting by hand and no guessing what each network wants." />
      <ol className="lp-steps">
        <li className="lp-step">
          <img className="lp-step-art" src="/art/stages/build.webp" alt="" loading="lazy" />
          <div className="lp-step-n">1</div>
          <h3>Add the plugin</h3>
          <p>Import the AdLab package into the Unity project you already have. Nothing in your game needs rewriting.</p>
        </li>
        <li className="lp-step">
          <img className="lp-step-art" src="/art/stages/concept.webp" alt="" loading="lazy" />
          <div className="lp-step-n">2</div>
          <h3>Mark the playable</h3>
          <p>Choose the scene, the install button and the end card, check it in a phone frame, then build and upload from the editor.</p>
        </li>
        <li className="lp-step">
          <img className="lp-step-art" src="/art/stages/port.webp" alt="" loading="lazy" />
          <div className="lp-step-n">3</div>
          <h3>Export from the dashboard</h3>
          <p>Tick the networks you want and download one correctly wrapped, size-checked and named file for each.</p>
        </li>
      </ol>
      <div className="lp-who">
        <div className="lp-who-card">
          <h3>The plugin</h3>
          <p>Sits inside the Unity editor and builds a lean playable runtime, rather than shipping a full general-purpose WebGL player.</p>
        </div>
        <div className="lp-who-card">
          <h3>The dashboard</h3>
          <p>Apps, concepts and creatives in one place, with per-network checks, size warnings, analytics and shared team workspaces.</p>
        </div>
        <div className="lp-who-card">
          <h3>Who it's for</h3>
          <p>User-acquisition teams, playable ad studios and indie developers who want their game in front of more players.</p>
        </div>
      </div>
    </section>
  );
}

function MarqueeRow({ nets, reverse }: { nets: typeof NETWORKS; reverse?: boolean }) {
  return (
    <div className="lp-marquee-row">
      <ul className={`lp-marquee-track${reverse ? " reverse" : ""}`} style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {[...nets, ...nets].map((n, i) => (
          <li key={i} className={`lp-marquee-chip${i >= nets.length ? " dup" : ""}`} aria-hidden={i >= nets.length || undefined}>
            <NetMark net={n} />
            {n.name}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Networks() {
  const [ref, shown] = useReveal<HTMLElement>();
  return (
    <section id="networks" ref={ref} className={`lp-section lp-reveal${shown ? " in" : ""}`}>
      <SectionHead
        title={
          <>
            One export button. <em>{NET_COUNT} destinations.</em>
          </>
        }
        sub="Every major playable ad network, packaged the way each one expects." />
      <div className="lp-marquee">
        <MarqueeRow nets={ROW_1} />
        <MarqueeRow nets={ROW_2} reverse />
      </div>
    </section>
  );
}

function Pricing({ onChoose }: { onChoose: (id: PlanCard["id"]) => void }) {
  const [ref, shown] = useReveal<HTMLElement>();
  return (
    <section id="pricing" ref={ref} className={`lp-section lp-reveal${shown ? " in" : ""}`}>
      <SectionHead
        title={
          <>
            Plans that scale with <em>your export volume</em>
          </>
        }
        sub="Each export counts one network. Free includes unlimited Unity Ads exports, and paid quotas reset every 30 days. Billed monthly."
      />
      <div className="lp-plan-grid">
        {PLANS.map((p) => (
          <div key={p.id} className={`lp-plan${p.featured ? " featured" : ""}`}>
            {p.featured && <span className="lp-plan-tag">Most popular</span>}
            <h3 className="lp-plan-name">{p.name}</h3>
            <div className="lp-plan-price">
              <span className="lp-plan-amt">{p.amount}</span>
              {p.cadence && <span className="lp-plan-cad">{p.cadence}</span>}
            </div>
            <p className="lp-plan-blurb">{p.blurb}</p>
            <button className={`lp-btn lp-btn-lg lp-plan-cta ${p.featured ? "lp-btn-solid" : "lp-btn-outline"}`} onClick={() => onChoose(p.id)}>
              {p.cta}
            </button>
            <ul className="lp-plan-feats">
              {p.features.map((f) => (
                <li key={f}>
                  <Tick sm /> {f}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Compare() {
  const [ref, shown] = useReveal<HTMLElement>();
  return (
    <section id="compare" ref={ref} className={`lp-section lp-reveal${shown ? " in" : ""}`}>
      <SectionHead
        title={
          <>
            Why choose <em>Factorial AdLab</em>
          </>
        }
        sub="A side-by-side look at AdLab and the usual export routes." />
      <div className="lp-cmp-table" role="table" aria-label="Feature comparison">
        <div className="lp-cmp-head" role="row">
          <div className="lp-cmp-feat" role="columnheader">
            Features
          </div>
          <div className="lp-cmp-col lp-cmp-us" role="columnheader">
            <span className="lp-cmp-brand">
              <img src="/art/logo.webp" alt="" />
              <span>
                Factorial <b>AdLab</b>
              </span>
            </span>
            <span className="lp-cmp-reco">Recommended</span>
          </div>
          <div className="lp-cmp-col lp-cmp-them" role="columnheader">
            Other playable solutions
          </div>
        </div>
        {COMPARE.map((r) => (
          <div key={r.feat} className={`lp-cmp-row${r.hl ? " hl" : ""}`} role="row">
            <div className="lp-cmp-feat" role="rowheader">
              {r.feat}
            </div>
            <div className="lp-cmp-col lp-cmp-us" role="cell">
              <span className="lp-cmp-yes">
                <CheckIcon width={2.4} />
              </span>
              <span>
                <span className="lp-cmp-tag">AdLab: </span>
                {r.us}
              </span>
            </div>
            <div className="lp-cmp-col lp-cmp-them" role="cell">
              <span className={r.bad ? "lp-cmp-no" : "lp-cmp-yes"}>{r.bad ? <XIcon /> : <CheckIcon width={2.4} />}</span>
              <span>
                <span className="lp-cmp-tag">Others: </span>
                {r.them}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function Savings({ onGetStarted }: { onGetStarted: () => void }) {
  const [ref, shown] = useReveal<HTMLElement>();
  const [plan, setPlan] = useState<PaidPlan>("studio");
  const s = SAVINGS[plan];
  const yearly = (s.exports * MANUAL_COST_PER_EXPORT - s.price) * 12;
  const counted = useCountUp(yearly, shown);
  return (
    <section id="savings" ref={ref} className={`lp-section lp-reveal${shown ? " in" : ""}`}>
      <SectionHead
        title={
          <>
            Cut costs. <em>Do more with less.</em>
          </>
        }
        sub={`Illustrative: about an hour ($${MANUAL_COST_PER_EXPORT}) to package and test each export by hand.`}
      />
      <div className="lp-cost-wrap">
        <div className="lp-cost-left">
          <div className="lp-cost-tabs" role="tablist" aria-label="Plan">
            {(Object.keys(SAVINGS) as PaidPlan[]).map((id) => (
              <button key={id} role="tab" aria-selected={plan === id} className={`lp-cost-tab${plan === id ? " on" : ""}`} onClick={() => setPlan(id)}>
                {SAVINGS[id].name}
              </button>
            ))}
          </div>
          <p className="lp-cost-netlabel">Networks you can use:</p>
          <ul className="lp-cost-nets">
            {NETWORKS.slice(0, 20).map((n) => (
              <li key={n.name} className="lp-cost-net">
                <span className="lp-cost-net-tick" aria-hidden="true">
                  <CheckIcon />
                </span>
                <NetMark net={n} />
                <span className="lp-cost-net-name">{n.name}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="lp-cost-card" key={plan} role="tabpanel">
          <span className="lp-cost-card-mark" aria-hidden="true">
            <img src="/art/logo.webp" alt="" />
          </span>
          <div className="lp-cost-headline">{NET_COUNT} Networks</div>
          <div className="lp-cost-builds">
            {s.exports} exports / 30 days <span>(about {(s.exports * 12).toLocaleString("en-US")} a year)</span>
          </div>
          <p className="lp-cost-note">
            Every one of those exports is wrapped, size-checked and named for its network automatically, so nobody spends the afternoon
            re-packaging the same build.
          </p>
          <div className="lp-cost-save" aria-live="polite">
            Save {usd(counted)} / year
          </div>
          <p className="lp-cost-sub">
            On the {s.name} plan ({usd(s.price)}/mo), compared with packaging every export by hand.
          </p>
          <button className="lp-btn lp-btn-solid lp-btn-lg lp-cost-cta" onClick={onGetStarted}>
            Start saving with Factorial AdLab today
          </button>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const [ref, shown] = useReveal<HTMLElement>();
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" ref={ref} className={`lp-section lp-faq lp-reveal${shown ? " in" : ""}`}>
      <SectionHead
        title={
          <>
            Questions &amp; <em>Answers</em>
          </>
        }
        sub="Everything you need to know before you start." />
      <div className="lp-faq-list">
        {FAQ.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q} className={`lp-faq-item${isOpen ? " open" : ""}`}>
              <button className="lp-faq-q" aria-expanded={isOpen} aria-controls={`lp-faq-${i}`} onClick={() => setOpen(isOpen ? null : i)}>
                <span>{f.q}</span>
                <span className="lp-faq-ico" aria-hidden="true">
                  {isOpen ? "–" : "+"}
                </span>
              </button>
              <div className="lp-faq-a" id={`lp-faq-${i}`} role="region" aria-hidden={!isOpen}>
                <p>{f.a}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * "Start your project": the same contact block as factorialstudio.com (info column + cream form),
 * posting to the same FormSubmit inbox, so every enquiry lands with the studio's other leads.
 */
const FORMSUBMIT_ENDPOINT = "https://formsubmit.co/ajax/ed1d5b72ba86e31cb741a2f58d48cd92";
const SERVICES = [
  "Playable Ads (Factorial AdLab)",
  "QA & Testing",
  "Game Development",
  "Mobile Publishing",
  "Art & Animation",
  "Console Porting",
  "Live Operations",
  "WebGL / Distribution",
  "Other",
];

const ContactIcon = ({ children }: { children: ReactNode }) => (
  <div className="lp-ci-ico">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {children}
    </svg>
  </div>
);

function Contact() {
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setStatus("sending");
    try {
      const r = await fetch(FORMSUBMIT_ENDPOINT, { method: "POST", headers: { Accept: "application/json" }, body: new FormData(form) });
      const d = (await r.json().catch(() => null)) as { success?: unknown; message?: string } | null;
      // a 200 doesn't mean sent: FormSubmit reports a rejection in the body
      if (!d || String(d.success) !== "true") throw new Error(d?.message || "rejected");
      form.reset();
      setStatus("sent");
      window.setTimeout(() => setStatus((s) => (s === "sent" ? "idle" : s)), 6000);
    } catch (err) {
      console.error("contact form:", (err as Error).message);
      setStatus("error");
    }
  }

  return (
    <section id="contact" className="lp-cozy">
      <div className="lp-cozy-inner">
        <div className="lp-eyebrow lp-cozy-eyebrow">Get in touch</div>
        <h2 className="lp-h2 lp-cozy-h2">
          Start your <em>project</em>
        </h2>
        <p className="lp-cozy-lead">Tell us about your game, we'll respond within 24 hours.</p>
        <div className="lp-cozy-grid">
          <div className="lp-cozy-info">
            <div className="lp-ci">
              <ContactIcon>
                <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                <circle cx="12" cy="10" r="3" />
              </ContactIcon>
              <div>
                <b>Headquarters</b>
                <span>
                  Factorial Studio Private Limited
                  <br />
                  306 Tariq Business Center, Lahore, Pakistan
                </span>
              </div>
            </div>
            <div className="lp-ci">
              <ContactIcon>
                <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.7a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.9.4 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z" />
              </ContactIcon>
              <div>
                <b>Call or WhatsApp</b>
                <span>
                  <a href="tel:+923224695140">+92 322 469 5140</a>
                </span>
              </div>
            </div>
            <div className="lp-ci">
              <ContactIcon>
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <path d="m3 7 9 6 9-6" />
              </ContactIcon>
              <div>
                <b>General inquiries</b>
                <span>
                  <a href="mailto:contact@factorialstudio.com">contact@factorialstudio.com</a>
                </span>
              </div>
            </div>
            <div className="lp-ci">
              <ContactIcon>
                <rect x="7" y="3" width="10" height="18" rx="3" />
                <path d="M11 18h2" />
              </ContactIcon>
              <div>
                <b>Playable ads &amp; AdLab</b>
                <span>
                  <a href="mailto:contact@factorialstudio.com">contact@factorialstudio.com</a>
                </span>
              </div>
            </div>
            <div className="lp-ci lp-ci-last">
              <ContactIcon>
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </ContactIcon>
              <div>
                <b>Response time</b>
                <span>Within 24 hours</span>
              </div>
            </div>
          </div>

          <form className="lp-cform" onSubmit={(e) => void submit(e)}>
            <div className="lp-cform-row">
              <div>
                <label htmlFor="cf-first">First name</label>
                <input id="cf-first" name="First Name" type="text" placeholder="First" autoComplete="given-name" required />
              </div>
              <div>
                <label htmlFor="cf-last">Last name</label>
                <input id="cf-last" name="Last Name" type="text" placeholder="Last" autoComplete="family-name" required />
              </div>
            </div>
            <label htmlFor="cf-email">Email</label>
            <input id="cf-email" name="Email" type="email" placeholder="you@studio.com" autoComplete="email" required />
            <label htmlFor="cf-svc">Service needed</label>
            <select id="cf-svc" name="Service Needed" defaultValue={SERVICES[0]}>
              <option value="">Select a service…</option>
              {SERVICES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
            <label htmlFor="cf-msg">Project details</label>
            <textarea id="cf-msg" name="Project Details" placeholder="Tell us about your project, timeline, platforms, and budget…" required />
            <input type="hidden" name="_subject" value="New project inquiry — Factorial AdLab (app.factorialstudio.dev)" />
            <input type="hidden" name="_template" value="table" />
            <input type="hidden" name="_captcha" value="false" />
            <input type="text" name="_honey" className="lp-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" />
            <button type="submit" className="lp-btn lp-btn-solid lp-btn-lg lp-btn-block lp-cform-btn" disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : status === "sent" ? "✓ Message sent!" : "Send message →"}
            </button>
            <div className={`lp-form-msg${status === "sent" ? " ok" : status === "error" ? " err" : ""}`} role="status">
              {status === "sent" && "Thanks, we'll reply within 24 hours."}
              {status === "error" && (
                <>
                  Sorry, that did not send. Please email <a href="mailto:contact@factorialstudio.com">contact@factorialstudio.com</a> and we
                  will reply the same day.
                </>
              )}
            </div>
          </form>
        </div>
      </div>
    </section>
  );
}
