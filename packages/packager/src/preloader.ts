import type { PreloaderConfig, PreloaderTemplateId } from "./types.js";

/**
 * Preloader kit templates — the loading screens shown over a playable while it loads.
 *
 * Every template is pure inline HTML + CSS + one small script (no fetches, no fonts), so it is safe on
 * every network including the no-network ones. All templates share one contract with the runtime shim:
 *   - `window.__pfPreloaderProgress(n)` (0–1) draws real progress; once called, the timed auto-hide is
 *     suspended so a slow Unity/WebGL load isn't uncovered half-way (a 20 s cap still applies);
 *   - `window.__pfHidePreloader()` fades it out (the shim's `PF.hidePreloader` / `setLoadingProgress(1)`).
 * Without progress calls the bar creeps toward 90 % and the screen hides shortly after `load`.
 */
export interface PreloaderTemplate {
  id: PreloaderTemplateId;
  name: string;
  description: string;
  /** how the kit image is used: a centred logo, or a full-bleed splash background */
  imageRole: "logo" | "background";
}

export const PRELOADER_TEMPLATES: readonly PreloaderTemplate[] = [
  { id: "classic", name: "Classic", description: "Logo, spinner and a progress bar.", imageRole: "logo" },
  { id: "minimal", name: "Minimal", description: "Logo with a hairline bar along the bottom edge.", imageRole: "logo" },
  { id: "pulse", name: "Pulse", description: "Breathing logo with a large percentage.", imageRole: "logo" },
  { id: "ring", name: "Ring", description: "Circular progress ring around the logo.", imageRole: "logo" },
  { id: "dots", name: "Dots", description: "Logo above three bouncing dots.", imageRole: "logo" },
  { id: "splash", name: "Splash", description: "Full-screen splash art with the bar over a bottom fade.", imageRole: "background" },
] as const;

export const PRELOADER_TEMPLATE_IDS = PRELOADER_TEMPLATES.map((t) => t.id);
export const DEFAULT_PRELOADER_BG = "#0b1220";
export const MAX_PRELOADER_TEXT = 60;

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const DATA_IMG = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i;

export const isHexColor = (s: unknown): s is string => typeof s === "string" && HEX.test(s);
export const isTemplateId = (s: unknown): s is PreloaderTemplateId =>
  typeof s === "string" && (PRELOADER_TEMPLATE_IDS as string[]).includes(s);

/** Relative luminance (0–1) of a hex colour; alpha ignored. */
function luminance(hex: string): number {
  let h = hex.slice(1);
  if (h.length <= 4) h = [...h.slice(0, 3)].map((c) => c + c).join("");
  const ch = (i: number) => {
    const v = parseInt(h.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(0) + 0.7152 * ch(2) + 0.0722 * ch(4);
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A config with every field validated and defaulted — anything unsafe falls back rather than reaching the HTML. */
export interface NormalizedPreloader {
  template: PreloaderTemplateId;
  bg: string;
  /** text / icon colour picked for contrast against bg */
  fg: string;
  accent: string;
  /** unfilled bar / ring colour */
  track: string;
  logoDataUri: string | null;
  text: string;
  showPercent: boolean;
}

export function normalizePreloader(p: PreloaderConfig): NormalizedPreloader {
  const bg = isHexColor(p.bg) ? p.bg : DEFAULT_PRELOADER_BG;
  const light = luminance(bg) > 0.45;
  const fg = light ? "#111827" : "#ffffff";
  return {
    template: isTemplateId(p.template) ? p.template : "classic",
    bg,
    fg,
    accent: isHexColor(p.accent) ? p.accent : fg,
    track: light ? "rgba(0,0,0,.14)" : "rgba(255,255,255,.2)",
    logoDataUri: typeof p.logoDataUri === "string" && DATA_IMG.test(p.logoDataUri) ? p.logoDataUri : null,
    text: typeof p.text === "string" ? p.text.trim().slice(0, MAX_PRELOADER_TEXT) : "",
    showPercent: !!p.showPercent,
  };
}

/** True when the config would draw anything at all (an empty, default kit is not injected). */
export function hasPreloaderContent(p: PreloaderConfig | undefined): p is PreloaderConfig {
  return !!p && !!(p.logoDataUri || p.bg || p.template || p.text || p.accent);
}

const RING_C = 339.29; // 2πr for r = 54

function body(n: NormalizedPreloader): string {
  const logo = n.logoDataUri ? `<img class="pf-logo" src="${n.logoDataUri}" alt="">` : "";
  const pct = n.showPercent ? `<div class="pf-pct" id="__pf_plpct">0%</div>` : "";
  const text = n.text ? `<div class="pf-text">${escapeHtml(n.text)}</div>` : "";
  const track = `<div class="pf-track"><i id="__pf_plbar"></i></div>`;
  switch (n.template) {
    case "minimal":
      return `${logo}${pct}${text}<div class="pf-edge"><i id="__pf_plbar"></i></div>`;
    case "pulse":
      return `${n.logoDataUri ? `<img class="pf-logo pf-breathe" src="${n.logoDataUri}" alt="">` : `<div class="pf-orb pf-breathe"></div>`}<div class="pf-pct pf-big" id="__pf_plpct">0%</div>${text}`;
    case "ring":
      return `<div class="pf-ring"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="54" fill="none" stroke="${n.track}" stroke-width="5"/><circle id="__pf_plring" cx="60" cy="60" r="54" fill="none" stroke="${n.accent}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${RING_C}" stroke-dashoffset="${RING_C}" transform="rotate(-90 60 60)"/></svg>${n.logoDataUri ? `<img src="${n.logoDataUri}" alt="">` : ""}</div>${pct}${text}`;
    case "dots":
      return `${logo}<div class="pf-dots"><i></i><i></i><i></i></div>${pct}${text}`;
    case "splash":
      return `<div class="pf-foot">${track}${pct}${text}</div>`;
    case "classic":
    default:
      return `${logo}<div class="pf-spin"></div>${track}${pct}${text}`;
  }
}

function css(n: NormalizedPreloader): string {
  const root =
    n.template === "splash" && n.logoDataUri
      ? `background:${n.bg} url("${n.logoDataUri}") center/cover no-repeat`
      : `background:${n.bg}`;
  return (
    `#__pf_pl{position:fixed;inset:0;z-index:2147483646;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;${root};color:${n.fg};font:600 13px/1.35 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;letter-spacing:.02em;transition:opacity .45s ease;overflow:hidden}` +
    `#__pf_pl .pf-logo{max-width:42%;max-height:34%;object-fit:contain}` +
    `#__pf_pl .pf-track{width:46%;max-width:220px;height:4px;border-radius:999px;background:${n.track};overflow:hidden}` +
    `#__pf_pl #__pf_plbar{display:block;height:100%;width:0;background:${n.accent};border-radius:999px;transition:width .2s}` +
    `#__pf_pl .pf-pct{font-variant-numeric:tabular-nums;opacity:.85}` +
    `#__pf_pl .pf-big{font-size:26px;font-weight:700;opacity:1}` +
    `#__pf_pl .pf-text{max-width:80%;text-align:center;opacity:.8;font-weight:500}` +
    `#__pf_pl .pf-spin{width:34px;height:34px;border:3px solid ${n.track};border-top-color:${n.accent};border-radius:50%;animation:__pfspin .8s linear infinite}` +
    `#__pf_pl .pf-edge{position:absolute;left:0;right:0;bottom:0;height:3px;background:${n.track}}` +
    `#__pf_pl .pf-edge #__pf_plbar{border-radius:0}` +
    `#__pf_pl .pf-breathe{animation:__pfpulse 1.6s ease-in-out infinite}` +
    `#__pf_pl .pf-orb{width:64px;height:64px;border-radius:50%;background:${n.accent}}` +
    `#__pf_pl .pf-ring{position:relative;width:132px;height:132px}` +
    `#__pf_pl .pf-ring svg{width:100%;height:100%}` +
    `#__pf_pl #__pf_plring{transition:stroke-dashoffset .2s}` +
    `#__pf_pl .pf-ring img{position:absolute;left:50%;top:50%;max-width:62%;max-height:62%;transform:translate(-50%,-50%);object-fit:contain}` +
    `#__pf_pl .pf-dots{display:flex;gap:8px}` +
    `#__pf_pl .pf-dots i{width:9px;height:9px;border-radius:50%;background:${n.accent};animation:__pfdot 1.2s infinite ease-in-out}` +
    `#__pf_pl .pf-dots i:nth-child(2){animation-delay:.15s}#__pf_pl .pf-dots i:nth-child(3){animation-delay:.3s}` +
    `#__pf_pl .pf-foot{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;gap:10px;padding:56px 0 34px;background:linear-gradient(to top,rgba(0,0,0,.7),rgba(0,0,0,0));color:#fff}` +
    `#__pf_pl .pf-foot .pf-track{background:rgba(255,255,255,.25)}` +
    `@keyframes __pfspin{to{transform:rotate(360deg)}}` +
    `@keyframes __pfpulse{0%,100%{transform:scale(1)}50%{transform:scale(1.07)}}` +
    `@keyframes __pfdot{0%,80%,100%{transform:translateY(0);opacity:.35}40%{transform:translateY(-8px);opacity:1}}`
  );
}

// Shared behaviour (see the contract above). `window.__pfPreloaderStay` (preview pages) keeps it on screen.
const SCRIPT =
  `(function(){var p=document.getElementById("__pf_pl");if(!p)return;` +
  `var bar=document.getElementById("__pf_plbar"),ring=document.getElementById("__pf_plring"),pct=document.getElementById("__pf_plpct");` +
  `var C=${RING_C},done=false,driven=false,shown=0,stay=!!window.__pfPreloaderStay;` +
  `function draw(n){shown=n;if(bar)bar.style.width=(n*100)+"%";if(ring)ring.style.strokeDashoffset=String(C*(1-n));if(pct)pct.textContent=Math.round(n*100)+"%";}` +
  `function hide(){if(done||stay)return;done=true;draw(1);p.style.opacity="0";setTimeout(function(){if(p.parentNode)p.parentNode.removeChild(p);},600);}` +
  `window.__pfHidePreloader=hide;` +
  `window.__pfPreloaderProgress=function(n){n=Math.max(0,Math.min(1,Number(n)||0));driven=true;if(stay||n>shown)draw(n);if(n>=1)setTimeout(hide,250);};` +
  `var t=setInterval(function(){if(done||driven){clearInterval(t);return;}draw(shown+(0.9-shown)*0.08);},120);` +
  `window.addEventListener("load",function(){setTimeout(function(){if(!driven)hide();},700);});` +
  `setTimeout(function(){if(!driven)hide();},3500);setTimeout(hide,20000);}());`;

/** The overlay markup injected at the top of <body> on export. */
export function buildPreloader(p: PreloaderConfig): string {
  const n = normalizePreloader(p);
  return `<div id="__pf_pl" data-template="${n.template}"><style>${css(n)}</style>${body(n)}</div><script>${SCRIPT}</script>`;
}

/**
 * A standalone page showing the preloader exactly as exports render it, for the dashboard's kit
 * editor (server-rendered). It never hides; progress loops 0→100 %, or stays at `progress` if given.
 */
export function buildPreloaderPreview(p: PreloaderConfig, opts: { progress?: number } = {}): string {
  const fixed = typeof opts.progress === "number" && isFinite(opts.progress) ? Math.max(0, Math.min(1, opts.progress)) : null;
  const driver =
    fixed !== null
      ? `window.__pfPreloaderProgress&&window.__pfPreloaderProgress(${fixed});`
      : `var n=0;setInterval(function(){n+=0.015;if(n>1.3)n=0;window.__pfPreloaderProgress&&window.__pfPreloaderProgress(Math.min(1,n));},50);`;
  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Preloader preview</title><style>html,body{margin:0;height:100%;background:#000}</style>` +
    `<script>window.__pfPreloaderStay=true;</script></head><body>${buildPreloader(p)}<script>(function(){${driver}}());</script></body></html>`
  );
}
