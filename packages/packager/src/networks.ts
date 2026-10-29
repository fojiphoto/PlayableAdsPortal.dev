import type { NetworkSpec } from "./types.js";

const MB = 1024 * 1024;
const GOOGLE_HOSTS = ["tpc.googlesyndication.com"];

/**
 * Supported ad networks.
 *
 * Each spec names the EXACT CTA/lifecycle mechanism (`ctaHook`) the runtime shim must emit —
 * that, not the size cap, is what gets a playable accepted or rejected. Caps follow each
 * network's public playable docs where they are stated plainly; the ones marked "conservative"
 * use the lower bound seen across their docs. Every spec is data: refining one is a one-line change.
 */
export const NETWORKS: Record<string, NetworkSpec> = {
  // ── priority set (biggest spend) ───────────────────────────────────────────
  applovin: {
    id: "applovin", name: "AppLovin", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID 2.0 single HTML; CTA via mraid.open(), gated on mraid ready. Cap 5 MB per public spec.",
  },
  unityads: {
    id: "unityads", name: "Unity Ads", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID-compliant single HTML; CTA via mraid.open(). Cap 5 MB per public spec.",
  },
  mintegral: {
    id: "mintegral", name: "Mintegral", format: "single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "window-open", ctaHook: "mintegral", usesMraid: false, ext: "html",
    notes: "Must call window.gameReady() once loaded and window.install() for the CTA (Mintegral injects both). Cap 5 MB per public spec.",
  },
  meta: {
    id: "meta", name: "Meta", format: "zip", maxSizeBytes: 2 * MB,
    orientation: "both", clickMode: "window-open", ctaHook: "meta-fb", usesMraid: false, ext: "zip",
    notes: "Audience Network: .zip with index.html; CTA via FbPlayableAd.onCTAClick(). Cap 2 MB per public spec.",
  },
  ironsource: {
    id: "ironsource", name: "ironSource", format: "single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "window-open", ctaHook: "ironsource-dapi", usesMraid: false, ext: "html",
    notes: "LevelPlay DAPI: wait for dapi ready + viewable, CTA via dapi.openStoreUrl(); MRAID accepted as fallback. Cap 5 MB.",
  },
  google: {
    id: "google", name: "Google Ads", format: "single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "window-open", ctaHook: "google-exitapi", usesMraid: false, ext: "html",
    allowedExternalHosts: GOOGLE_HOSTS,
    notes: "HTML5 playable: CTA via ExitApi.exit() from Google's exitapi.js (the one allowed external script). Cap 5 MB.",
  },

  // ── extended set ───────────────────────────────────────────────────────────
  tiktok: {
    id: "tiktok", name: "TikTok / Pangle", format: "single-html", maxSizeBytes: 2 * MB,
    orientation: "both", clickMode: "window-open", ctaHook: "pangle", usesMraid: false, ext: "html",
    notes: "Pangle playable: CTA via window.openAppStore(), window.gameEnd() on finish. Cap conservative (2 MB; docs cite 2.2–5 MB).",
  },
  vungle: {
    id: "vungle", name: "Vungle", format: "single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "window-open", ctaHook: "vungle", usesMraid: false, ext: "html",
    notes: "CTA via parent.postMessage('download','*'); parent.postMessage('complete','*') on finish; MRAID accepted as fallback. Cap 5 MB.",
  },
  liftoff: {
    id: "liftoff", name: "Liftoff", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID single HTML (Liftoff/Vungle family). Cap 5 MB.",
  },
  snapchat: {
    id: "snapchat", name: "Snapchat", format: "single-html", maxSizeBytes: 5 * MB,
    orientation: "portrait", clickMode: "window-open", ctaHook: "window-open", usesMraid: false, ext: "html",
    notes: "Snap Ads: portrait-only single HTML; standard click-through. Cap 5 MB.",
  },
  moloco: {
    id: "moloco", name: "Moloco", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID single HTML. Cap 5 MB.",
  },
  chartboost: {
    id: "chartboost", name: "Chartboost", format: "mraid-single-html", maxSizeBytes: 2 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID single HTML. Cap conservative (2 MB).",
  },
  dv360: {
    id: "dv360", name: "DV360", format: "single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "window-open", ctaHook: "google-exitapi", usesMraid: false, ext: "html",
    allowedExternalHosts: GOOGLE_HOSTS,
    notes: "Google Display & Video 360: CTA via ExitApi.exit() (exitapi.js). Cap 5 MB.",
  },
  adcolony: {
    id: "adcolony", name: "AdColony", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID single HTML. Cap 5 MB.",
  },
  inmobi: {
    id: "inmobi", name: "InMobi", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID single HTML. Cap 5 MB.",
  },
  tapjoy: {
    id: "tapjoy", name: "Tapjoy", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID single HTML. Cap 5 MB.",
  },
  fyber: {
    id: "fyber", name: "Fyber (Digital Turbine)", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID single HTML. Cap 5 MB.",
  },
  smadex: {
    id: "smadex", name: "Smadex", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID generic. Cap 5 MB.",
  },
  bigabid: {
    id: "bigabid", name: "BigaBid", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID generic. Cap 5 MB.",
  },
  kayzen: {
    id: "kayzen", name: "Kayzen", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID generic. Cap 5 MB.",
  },
  // ── DSPs & remaining networks (all accept MRAID 2.0 single-HTML playables) ─
  remerge: {
    id: "remerge", name: "Remerge", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "Retargeting DSP; MRAID single HTML. Cap 5 MB.",
  },
  tencent: {
    id: "tencent", name: "Tencent Ads", format: "mraid-single-html", maxSizeBytes: 2 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID single HTML. Cap conservative (2 MB) — CN specs run tighter; verify per campaign.",
  },
  aarki: {
    id: "aarki", name: "Aarki", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID single HTML. Cap 5 MB.",
  },
  line: {
    id: "line", name: "LINE Ads", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID single HTML. Cap 5 MB.",
  },
  appreciate: {
    id: "appreciate", name: "Appreciate", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID single HTML. Cap 5 MB.",
  },
  revx: {
    id: "revx", name: "RevX", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID single HTML. Cap 5 MB.",
  },
  adikteev: {
    id: "adikteev", name: "Adikteev", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID single HTML. Cap 5 MB.",
  },
  youappi: {
    id: "youappi", name: "YouAppi", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "MRAID single HTML. Cap 5 MB.",
  },
  mraid: {
    id: "mraid", name: "MRAID (generic)", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", ctaHook: "mraid", usesMraid: true, ext: "html",
    notes: "Plain MRAID 2.0 single HTML for any network not listed here. Cap 5 MB (check the network's own limit).",
  },
};

/** The default/priority networks used when none are specified (packAll, UI defaults). */
export const PRIORITY_NETWORK_IDS = [
  "applovin",
  "unityads",
  "mintegral",
  "meta",
  "ironsource",
  "google",
] as const;

export function getNetwork(id: string): NetworkSpec {
  const spec = NETWORKS[id];
  if (!spec) {
    throw new Error(`Unknown network "${id}". Known: ${Object.keys(NETWORKS).join(", ")}`);
  }
  return spec;
}

export function allNetworks(): NetworkSpec[] {
  return Object.values(NETWORKS);
}
