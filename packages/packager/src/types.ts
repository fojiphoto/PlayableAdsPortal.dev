/**
 * Core types for the packager engine.
 *
 * The whole per-network behaviour is data (a `NetworkSpec`), not bespoke code — adding a
 * network is writing one spec object, which is how the original scales to 27 networks.
 */

/** How the final package is shaped for a given network. */
export type NetworkFormat =
  | "mraid-single-html" // one self-contained .html; click via mraid.open(); network injects mraid.js
  | "single-html" // one self-contained .html; click via window.open()
  | "zip"; // a .zip whose entry is index.html (assets may be inlined inside it)

export type Orientation = "portrait" | "landscape" | "both";

/** Coarse click-through family (kept for compatibility; `ctaHook` is the precise mechanism). */
export type ClickMode = "mraid" | "window-open";

/**
 * The exact, network-specific mechanism the injected runtime uses to fire the CTA and report
 * lifecycle. Each network injects its own SDK global at serve time; emitting the wrong call is
 * the #1 reason a playable is rejected or ships with a dead install button.
 */
export type CtaHook =
  | "mraid" // window.mraid.open(url), gated on mraid "ready"; viewableChange → pause/resume
  | "window-open" // window.open(url)
  | "google-exitapi" // Google Ads / DV360: ExitApi.exit() (requires their exitapi.js)
  | "meta-fb" // Meta Audience Network: FbPlayableAd.onCTAClick()
  | "mintegral" // Mintegral: window.gameReady() on load, window.install() on CTA
  | "pangle" // TikTok / Pangle: window.openAppStore(); window.gameEnd() on finish
  | "ironsource-dapi" // ironSource / LevelPlay: dapi.openStoreUrl(), gated on dapi ready + viewable
  | "vungle"; // Vungle / Liftoff legacy: parent.postMessage("download"|"complete", "*")

/** A declarative description of one ad network's playable requirements. */
export interface NetworkSpec {
  /** stable id, e.g. "applovin" */
  id: string;
  /** display name, e.g. "AppLovin" */
  name: string;
  format: NetworkFormat;
  /** hard size cap in bytes; exceeding it is an error (would be rejected at review) */
  maxSizeBytes: number;
  orientation: Orientation;
  /** coarse click family (see `ctaHook` for the precise call) */
  clickMode: ClickMode;
  /** the precise CTA / lifecycle mechanism the runtime shim emits for this network */
  ctaHook: CtaHook;
  /**
   * MRAID networks inject `mraid.js` themselves at serve time, so we must NOT bundle it —
   * we only reference `window.mraid`. When false, the playable is standalone.
   */
  usesMraid: boolean;
  /** output file extension */
  ext: "html" | "zip";
  /**
   * External hosts this network REQUIRES the playable to load (e.g. Google's exitapi.js).
   * These are exempt from the self-containment check; everything else external is an error.
   */
  allowedExternalHosts?: string[];
  /**
   * Caveats about this spec (e.g. "cap per public docs", "Google uses ExitApi, not window.open").
   * The engine is correct; the exact numbers/macros are data to keep current (blueprint risk #3).
   */
  notes?: string;
}

/** A loaded HTML5 playable: an entry html plus every referenced file, keyed by relative path. */
export interface PlayableSource {
  /** entry html path, e.g. "index.html" */
  entry: string;
  /** relative path -> file bytes (includes the entry html itself) */
  files: Record<string, Uint8Array>;
}

/** A custom loading screen shown over the playable while it loads. */
export interface PreloaderConfig {
  /** logo/splash image as a data: URI (inlined) */
  logoDataUri?: string;
  /** background color, e.g. "#0b1220" */
  bg?: string;
}

/** Click-through configuration for the CTA / store-open. */
export interface PackOptions {
  /** output filename stem (before extension); defaults to "playable" */
  name?: string;
  /** generic fallback store/landing URL */
  ctaUrl?: string;
  /** iOS App Store URL (used when the device looks like iOS) */
  iosUrl?: string;
  /** Google Play URL (used when the device looks like Android) */
  androidUrl?: string;
  /** optional custom preloader / splash screen */
  preloader?: PreloaderConfig;
}

export type IssueLevel = "error" | "warning";

export interface ValidationIssue {
  level: IssueLevel;
  code: string;
  message: string;
}

/** The result of packaging a playable for one network. */
export interface PackResult {
  network: string;
  networkName: string;
  filename: string;
  format: NetworkFormat;
  bytes: Uint8Array;
  sizeBytes: number;
  /** maxSizeBytes for context in UIs */
  maxSizeBytes: number;
  validation: ValidationIssue[];
  /** true when there are no `error`-level issues */
  ok: boolean;
}
