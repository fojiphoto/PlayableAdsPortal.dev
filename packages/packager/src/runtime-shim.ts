import type { ClickMode, CtaHook } from "./types.js";

/**
 * The "forge" runtime shim injected into every packaged playable.
 *
 * It mirrors the original plugin's dev-facing Runtime API (blueprint §2.5) so a playable calls one
 * stable API — `window.PF.install()` — and we route the CTA to the exact per-network mechanism at
 * pack time (`ctaHook`). Wrong hook = dead install button or review rejection, so this is the
 * heart of "one build in, every network out":
 *
 *   mraid           → mraid.open(url), held until mraid is "ready"; viewableChange → pause/resume
 *   google-exitapi  → ExitApi.exit()                     (Google Ads / DV360)
 *   meta-fb         → FbPlayableAd.onCTAClick()          (Meta Audience Network)
 *   mintegral       → window.install(); window.gameReady() once loaded
 *   pangle          → window.openAppStore(); window.gameEnd() when the game ends
 *   ironsource-dapi → dapi.openStoreUrl(), held until dapi ready + viewable
 *   vungle          → parent.postMessage("download"); postMessage("complete") when the game ends
 *   window-open     → window.open(url)
 *
 * Every hook falls back to mraid.open / window.open when the network SDK global is absent, so the
 * same file also works in our device preview and in a plain browser.
 *
 * Analytics (optional, `cfg.analytics`): one tiny beacon per funnel step — impression, engage
 * (first touch), start, complete, cta — each at most once per session, plus `PF.analytics.logEvent`
 * for custom events. Sent with navigator.sendBeacon (survives the CTA navigation) or a 1×1 pixel.
 * Plays opened through our own device preview are flagged `p=1` and excluded from the dashboards.
 */
export interface ShimConfig {
  clickMode: ClickMode;
  ctaHook: CtaHook;
  usesMraid: boolean;
  ctaUrl: string;
  iosUrl: string;
  androidUrl: string;
  /** in-playable analytics collector; null = no beacons in this package */
  analytics: { endpoint: string; creativeId: string; network: string } | null;
}

export function buildRuntimeShim(cfg: ShimConfig): string {
  // Config is serialised to JSON and read by the IIFE. Everything stays inline (single-file safe).
  const json = JSON.stringify(cfg);
  return `<script>(function(){
  var CFG = ${json};
  var HOOK = CFG.ctaHook || (CFG.usesMraid ? "mraid" : "window-open");
  function storeUrl(){
    var ua = (navigator && navigator.userAgent) || "";
    if (/iPhone|iPad|iPod/i.test(ua) && CFG.iosUrl) return CFG.iosUrl;
    if (/Android/i.test(ua) && CFG.androidUrl) return CFG.androidUrl;
    return CFG.ctaUrl || CFG.iosUrl || CFG.androidUrl || "";
  }
  // ── in-playable analytics ──
  var AN = CFG.analytics || null;
  var SID = Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
  var PREVIEW = /\/api\/creatives\/[^/]+\/preview\//.test(location.href) ? 1 : 0;
  var sentOnce = {};
  function track(ev, name){
    if (!AN || !AN.endpoint) return;
    if (ev !== "custom") { if (sentOnce[ev]) return; sentOnce[ev] = 1; }
    var q = "e=" + encodeURIComponent(ev) + "&s=" + SID + "&t=" + Date.now()
      + (name ? "&n=" + encodeURIComponent(String(name).slice(0, 64)) : "")
      + (PREVIEW ? "&p=1" : "");
    var url = AN.endpoint + "/" + encodeURIComponent(AN.creativeId) + "/" + encodeURIComponent(AN.network) + "?" + q;
    try { if (navigator.sendBeacon && navigator.sendBeacon(url, "")) return; } catch (e) {}
    try { var img = new Image(1, 1); img.src = url; } catch (e) {}
  }
  function trackEngageOnce(){
    if (sentOnce.engage) return;
    track("engage");
    ["pointerdown", "touchstart", "mousedown", "keydown"].forEach(function(t){ try { document.removeEventListener(t, trackEngageOnce, true); } catch (e) {} });
  }
  if (AN) {
    ["pointerdown", "touchstart", "mousedown", "keydown"].forEach(function(t){ try { document.addEventListener(t, trackEngageOnce, true); } catch (e) {} });
    track("impression");
  }

  var listeners = { pause: [], resume: [], ready: [] };
  function on(evt, cb){ if (listeners[evt]) listeners[evt].push(cb); }
  function emit(evt){ (listeners[evt] || []).forEach(function(cb){ try { cb(); } catch (e) {} }); }

  // ── generic fallbacks (preview / plain browser / unknown host) ──
  function fallbackOpen(url){
    if (window.mraid && typeof window.mraid.open === "function") {
      try { window.mraid.open(url); return true; } catch (e) {}
    }
    if (!url) return false;
    try { window.open(url, "_blank"); return true; } catch (e) {}
    try { location.href = url; return true; } catch (e) {}
    return false;
  }
  // MRAID: never call open() while the SDK is still "loading" — queue it for "ready".
  function mraidOpen(url){
    var m = window.mraid;
    if (!m || typeof m.open !== "function") return false;
    if (typeof m.getState === "function" && m.getState() === "loading" && typeof m.addEventListener === "function") {
      m.addEventListener("ready", function onReady(){ try { m.removeEventListener("ready", onReady); } catch (e) {} try { m.open(url); } catch (e) {} });
      return true;
    }
    try { m.open(url); return true; } catch (e) { return false; }
  }

  // ── the per-network CTA ──
  function openStore(){
    track("cta");
    var url = storeUrl();
    switch (HOOK) {
      case "google-exitapi":
        if (window.ExitApi && typeof window.ExitApi.exit === "function") { try { window.ExitApi.exit(); return; } catch (e) {} }
        break;
      case "meta-fb":
        if (window.FbPlayableAd && typeof window.FbPlayableAd.onCTAClick === "function") { try { window.FbPlayableAd.onCTAClick(); return; } catch (e) {} }
        break;
      case "mintegral":
        if (typeof window.install === "function") { try { window.install(); return; } catch (e) {} }
        break;
      case "pangle":
        if (typeof window.openAppStore === "function") { try { window.openAppStore(); return; } catch (e) {} }
        break;
      case "ironsource-dapi":
        if (window.dapi && typeof window.dapi.openStoreUrl === "function") { try { window.dapi.openStoreUrl(); return; } catch (e) {} }
        break;
      case "vungle":
        try { parent.postMessage("download", "*"); return; } catch (e) {}
        break;
      case "mraid":
        if (mraidOpen(url)) return;
        break;
    }
    fallbackOpen(url);
  }

  // ── lifecycle → network signals ──
  function onGameEnded(){
    track("complete");
    if (HOOK === "vungle") { try { parent.postMessage("complete", "*"); } catch (e) {} }
    if (HOOK === "pangle" && typeof window.gameEnd === "function") { try { window.gameEnd(); } catch (e) {} }
  }
  function onLoaded(){
    if (HOOK === "mintegral" && typeof window.gameReady === "function") { try { window.gameReady(); } catch (e) {} }
  }

  var PF = {
    version: "0.3.0",
    network: HOOK,
    install: openStore,
    installFullGame: openStore,
    openStore: openStore,
    ready: function(){ onLoaded(); emit("ready"); },
    setLoadingProgress: function(){},
    getPlatform: function(){ var ua = navigator.userAgent || ""; return /iPhone|iPad|iPod/i.test(ua) ? "ios" : /Android/i.test(ua) ? "android" : "web"; },
    on: on,
    lifecycle: {
      gameLoaded: function(){ onLoaded(); emit("ready"); },
      gameStarted: function(){ track("start"); },
      gamePaused: function(){ emit("pause"); },
      gameResumed: function(){ emit("resume"); },
      gameEnded: onGameEnded,
      levelChanged: function(level){ track("custom", "level_" + (level === undefined ? "changed" : level)); }
    },
    analytics: {
      enabled: !!AN,
      sessionId: SID,
      /** PF.analytics.logEvent("tutorial_done") — a custom event, counted per name on the Analytics page. */
      logEvent: function(name){ if (name) track("custom", name); }
    }
  };
  window.PF = window.PlayableForge = PF;

  // Mintegral requires gameReady() once the creative has loaded — fire it on load as a safety net.
  if (HOOK === "mintegral") {
    if (document.readyState === "complete") onLoaded();
    else window.addEventListener("load", onLoaded);
  }

  // MRAID: viewableChange drives pause/resume (networks reject creatives that keep running off-screen).
  if (window.mraid && typeof window.mraid.addEventListener === "function") {
    try {
      window.mraid.addEventListener("viewableChange", function(v){ if (v) emit("resume"); else emit("pause"); });
    } catch (e) {}
  }

  // ironSource DAPI: honour ready + viewable before the creative is considered live.
  if (HOOK === "ironsource-dapi" && window.dapi) {
    var d = window.dapi;
    function dapiReady(){
      try { if (typeof d.isViewable === "function" && !d.isViewable()) emit("pause"); } catch (e) {}
      emit("ready");
    }
    try {
      if (typeof d.isReady === "function" && d.isReady()) dapiReady();
      else if (typeof d.addEventListener === "function") d.addEventListener("ready", dapiReady);
      if (typeof d.addEventListener === "function") {
        d.addEventListener("viewableChange", function(e){ var vis = e && (e.isViewable !== undefined ? e.isViewable : e); if (vis) emit("resume"); else emit("pause"); });
      }
    } catch (e) {}
  }
})();</script>`;
}
