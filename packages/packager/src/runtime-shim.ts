import type { ClickMode } from "./types.js";

/**
 * The "forge" runtime shim injected into every packaged playable.
 *
 * It mirrors the original plugin's dev-facing Runtime API surface (see blueprint §2.5) so a
 * playable can call one stable API and we route the CTA to the right per-network mechanism at
 * pack time:
 *   - MRAID networks  -> window.mraid.open(url)
 *   - others          -> window.open(url)
 *
 * The playable triggers the CTA with `window.PF.install()` (alias: installFullGame / openStore).
 */
export interface ShimConfig {
  clickMode: ClickMode;
  usesMraid: boolean;
  ctaUrl: string;
  iosUrl: string;
  androidUrl: string;
}

export function buildRuntimeShim(cfg: ShimConfig): string {
  // Config is serialised to JSON and read by the IIFE. Everything stays inline (single-file safe).
  const json = JSON.stringify(cfg);
  return `<script>(function(){
  var CFG = ${json};
  function storeUrl(){
    var ua = (navigator && navigator.userAgent) || "";
    if (/iPhone|iPad|iPod/i.test(ua) && CFG.iosUrl) return CFG.iosUrl;
    if (/Android/i.test(ua) && CFG.androidUrl) return CFG.androidUrl;
    return CFG.ctaUrl || CFG.iosUrl || CFG.androidUrl || "";
  }
  function openStore(){
    var url = storeUrl();
    if (!url) { return; }
    if (window.mraid && typeof window.mraid.open === "function") {
      try { window.mraid.open(url); return; } catch (e) {}
    }
    try { window.open(url, "_blank"); return; } catch (e) {}
    try { location.href = url; } catch (e) {}
  }
  var listeners = { pause: [], resume: [] };
  function on(evt, cb){ if (listeners[evt]) listeners[evt].push(cb); }
  function emit(evt){ (listeners[evt] || []).forEach(function(cb){ try { cb(); } catch (e) {} }); }
  var PF = {
    version: "0.1.0",
    install: openStore,
    installFullGame: openStore,
    openStore: openStore,
    ready: function(){},
    setLoadingProgress: function(){},
    getPlatform: function(){ return "web"; },
    on: on,
    lifecycle: {
      gameLoaded: function(){}, gameStarted: function(){},
      gamePaused: function(){ emit("pause"); }, gameResumed: function(){ emit("resume"); },
      gameEnded: function(){}, levelChanged: function(){}
    },
    analytics: { logEvent: function(){} }
  };
  window.PF = window.PlayableForge = PF;
  // MRAID readiness: hold the CTA until the SDK is ready; harmless when no mraid present.
  if (CFG.usesMraid && window.mraid && typeof window.mraid.getState === "function") {
    if (window.mraid.getState() === "loading" && typeof window.mraid.addEventListener === "function") {
      window.mraid.addEventListener("ready", function(){});
    }
  }
})();</script>`;
}
