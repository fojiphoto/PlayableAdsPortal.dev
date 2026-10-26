import type { NetworkSpec } from "./types.js";

const MB = 1024 * 1024;

/**
 * Supported ad networks.
 *
 * ⚠️ Size caps and click macros are sensible engine defaults for the MVP. The exact, current
 * numbers/macros MUST be verified against each network's live playable docs (blueprint §5 /
 * risk #3). The engine is config-driven, so refining any spec is a one-line change.
 */
export const NETWORKS: Record<string, NetworkSpec> = {
  // ── priority set (biggest spend, simplest specs) ──────────────────────────────
  applovin: {
    id: "applovin", name: "AppLovin", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
    notes: "Single self-contained HTML, MRAID. Also wants CHALLENGE_* events for playables.",
  },
  unityads: {
    id: "unityads", name: "Unity Ads", format: "single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "window-open", usesMraid: false, ext: "html",
    notes: "Single index.html; click via window.open (Unity rewrites to its install flow).",
  },
  mintegral: {
    id: "mintegral", name: "Mintegral", format: "mraid-single-html", maxSizeBytes: 2 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
    notes: "Tight 2MB cap; single HTML, MRAID.",
  },
  meta: {
    id: "meta", name: "Meta", format: "zip", maxSizeBytes: 2 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "zip",
    notes: "Meta Audience Network: a .zip whose entry is index.html; MRAID.",
  },
  ironsource: {
    id: "ironsource", name: "ironSource", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
    notes: "Single self-contained HTML, MRAID.",
  },
  google: {
    id: "google", name: "Google Ads", format: "single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "window-open", usesMraid: false, ext: "html",
    notes: "AdMob HTML5: single HTML. NOTE: Google really uses ExitApi.exit() — wire later.",
  },

  // ── extended set ──────────────────────────────────────────────────────────────
  tiktok: {
    id: "tiktok", name: "TikTok / Pangle", format: "mraid-single-html", maxSizeBytes: 2 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
    notes: "Pangle playable: single HTML, tight cap (~2.2MB), MRAID.",
  },
  vungle: {
    id: "vungle", name: "Vungle", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
  },
  liftoff: {
    id: "liftoff", name: "Liftoff", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
    notes: "Liftoff/Vungle family; single HTML, MRAID.",
  },
  snapchat: {
    id: "snapchat", name: "Snapchat", format: "single-html", maxSizeBytes: 5 * MB,
    orientation: "portrait", clickMode: "window-open", usesMraid: false, ext: "html",
    notes: "Snap Ads: portrait-first; single HTML.",
  },
  moloco: {
    id: "moloco", name: "Moloco", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
  },
  chartboost: {
    id: "chartboost", name: "Chartboost", format: "mraid-single-html", maxSizeBytes: 2 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
  },
  dv360: {
    id: "dv360", name: "DV360", format: "single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "window-open", usesMraid: false, ext: "html",
    notes: "Google DV360; single HTML.",
  },
  adcolony: {
    id: "adcolony", name: "AdColony", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
  },
  inmobi: {
    id: "inmobi", name: "InMobi", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
  },
  tapjoy: {
    id: "tapjoy", name: "Tapjoy", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
  },
  fyber: {
    id: "fyber", name: "Fyber (Digital Turbine)", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
  },
  smadex: {
    id: "smadex", name: "Smadex", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
  },
  bigabid: {
    id: "bigabid", name: "BigaBid", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
  },
  kayzen: {
    id: "kayzen", name: "Kayzen", format: "mraid-single-html", maxSizeBytes: 5 * MB,
    orientation: "both", clickMode: "mraid", usesMraid: true, ext: "html",
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
