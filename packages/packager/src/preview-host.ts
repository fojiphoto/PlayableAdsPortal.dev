import type { NetworkSpec } from "./types.js";

/**
 * Preview host — what an ad network's container provides, simulated for our device preview.
 *
 * Exports never contain this: the server injects it only into `/preview/` responses. It defines the
 * globals the export's runtime shim talks to, so the exact CTA and lifecycle path a network would
 * exercise runs in the preview — and every call is reported instead of navigating away:
 *
 *   MRAID networks   → a full MRAID 2.0 `window.mraid` (loading → default + ready, viewableChange,
 *                      sizeChange, open/close/expand/resize/useCustomClose/…)
 *   google-exitapi   → `ExitApi.exit()`          meta-fb    → `FbPlayableAd.onCTAClick()`
 *   mintegral        → `install()` / `gameReady()`   pangle → `openAppStore()` / `gameEnd()`
 *   ironsource-dapi  → `dapi` (ready, isViewable, viewableChange, openStoreUrl)
 *   vungle           → the shim's `parent.postMessage("download" | "complete")` (seen by the host page)
 *   every network    → `window.open` is recorded instead of opening a tab
 *
 * Calls are posted to the embedding page as `{ __adlab: "preview", call, detail }` and shown as a
 * small toast inside the frame (so a preview opened on its own still shows what the CTA did). The page
 * can post `{ __adlab: "preview-control", action: "viewable", value }` to hide/show the creative.
 */
export function buildPreviewHost(spec: Pick<NetworkSpec, "id" | "name" | "ctaHook" | "usesMraid">): string {
  const cfg = JSON.stringify({ network: spec.id, name: spec.name, hook: spec.ctaHook, mraid: spec.usesMraid || spec.ctaHook === "mraid" });
  return `<script>(function(){
  var H = ${cfg};
  var MRAID = H.mraid || H.hook === "mraid";
  var label = MRAID ? "MRAID 2.0" : ({ "google-exitapi": "Google ExitApi", "meta-fb": "Meta FbPlayableAd", "mintegral": "Mintegral", "pangle": "Pangle", "ironsource-dapi": "ironSource DAPI", "vungle": "Vungle", "window-open": "window.open" })[H.hook] || H.hook;

  // ── reporting: to the dashboard (if embedded) and a toast in the frame ──
  var toastEl = null, toastTimer = 0;
  function toast(text){
    try {
      if (!document.body) return;
      if (!toastEl) {
        toastEl = document.createElement("div");
        toastEl.setAttribute("data-adlab-preview", "toast");
        toastEl.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;padding:8px 10px;border-radius:10px;background:rgba(10,58,40,.94);color:#fff;font:600 12px/1.35 system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.35);pointer-events:none;word-break:break-all;transition:opacity .25s";
        document.body.appendChild(toastEl);
      }
      toastEl.textContent = "Preview · " + text;
      toastEl.style.opacity = "1";
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function(){ if (toastEl) toastEl.style.opacity = "0"; }, 3500);
    } catch (e) {}
  }
  function report(call, detail, quiet){
    try { parent.postMessage({ __adlab: "preview", call: call, detail: detail === undefined ? null : detail, network: H.network }, "*"); } catch (e) {}
    if (!quiet) toast(call + (detail ? " → " + detail : ""));
  }
  window.__adlabPreviewHost = { network: H.network, host: label, report: report };

  // never leave the preview: record window.open instead
  window.open = function(url){ report("window.open", url ? String(url) : ""); return null; };

  // ── MRAID 2.0 ──
  function size(){ return { width: window.innerWidth || 320, height: window.innerHeight || 480 }; }
  if (MRAID) {
    var state = "loading", viewable = false, ls = {}, expandProps = { width: 0, height: 0, useCustomClose: false, isModal: true };
    var orientationProps = { allowOrientationChange: true, forceOrientation: "none" };
    var resizeProps = { width: 0, height: 0, offsetX: 0, offsetY: 0, customClosePosition: "top-right", allowOffscreen: false };
    function fire(ev){ var args = [].slice.call(arguments, 1); (ls[ev] || []).slice().forEach(function(cb){ try { cb.apply(null, args); } catch (e) {} }); }
    function setState(s){ if (state !== s) { state = s; report("stateChange", s, true); fire("stateChange", s); } }
    function setViewable(v){ if (viewable !== v) { viewable = v; report("viewableChange", String(v), true); fire("viewableChange", v); } }
    window.mraid = {
      getVersion: function(){ return "2.0"; },
      getState: function(){ return state; },
      getPlacementType: function(){ return "interstitial"; },
      isViewable: function(){ return viewable; },
      addEventListener: function(ev, cb){ if (typeof cb === "function") (ls[ev] = ls[ev] || []).push(cb); },
      removeEventListener: function(ev, cb){ if (!ls[ev]) return; ls[ev] = cb ? ls[ev].filter(function(f){ return f !== cb; }) : []; },
      open: function(url){ report("mraid.open", url ? String(url) : "(no url)"); },
      close: function(){ report("mraid.close"); setViewable(false); setState("hidden"); },
      unload: function(){ report("mraid.unload"); },
      expand: function(url){ report("mraid.expand", url || null); setState("expanded"); },
      resize: function(){ report("mraid.resize"); setState("resized"); },
      useCustomClose: function(v){ expandProps.useCustomClose = !!v; report("mraid.useCustomClose", String(!!v), true); },
      getExpandProperties: function(){ var s = size(); return { width: expandProps.width || s.width, height: expandProps.height || s.height, useCustomClose: expandProps.useCustomClose, isModal: true }; },
      setExpandProperties: function(p){ for (var k in p) expandProps[k] = p[k]; },
      getOrientationProperties: function(){ return { allowOrientationChange: orientationProps.allowOrientationChange, forceOrientation: orientationProps.forceOrientation }; },
      setOrientationProperties: function(p){ for (var k in p) orientationProps[k] = p[k]; report("mraid.setOrientationProperties", JSON.stringify(orientationProps), true); },
      getResizeProperties: function(){ return resizeProps; },
      setResizeProperties: function(p){ for (var k in p) resizeProps[k] = p[k]; },
      getCurrentPosition: function(){ var s = size(); return { x: 0, y: 0, width: s.width, height: s.height }; },
      getDefaultPosition: function(){ var s = size(); return { x: 0, y: 0, width: s.width, height: s.height }; },
      getMaxSize: function(){ return size(); },
      getScreenSize: function(){ return size(); },
      supports: function(f){ return f === "inlineVideo"; },
      playVideo: function(url){ report("mraid.playVideo", url || null); },
      storePicture: function(){ fire("error", "storePicture not supported in preview", "storePicture"); },
      createCalendarEvent: function(){ fire("error", "createCalendarEvent not supported in preview", "createCalendarEvent"); }
    };
    // like a real SDK: ready shortly after the document loads, then the creative becomes viewable
    function boot(){ setTimeout(function(){ setState("default"); report("ready", null, true); fire("ready"); setTimeout(function(){ setViewable(true); }, 50); }, 60); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
    window.addEventListener("resize", function(){ var s = size(); fire("sizeChange", s.width, s.height); });
  }

  // ── network SDK globals the shim calls ──
  if (H.hook === "google-exitapi") window.ExitApi = { exit: function(){ report("ExitApi.exit"); } };
  if (H.hook === "meta-fb") window.FbPlayableAd = { onCTAClick: function(){ report("FbPlayableAd.onCTAClick"); } };
  if (H.hook === "mintegral") {
    window.install = function(){ report("install"); };
    window.gameReady = function(){ report("gameReady", null, true); };
    window.gameEnd = function(){ report("gameEnd"); };
  }
  if (H.hook === "pangle") {
    window.openAppStore = function(){ report("openAppStore"); };
    window.gameEnd = function(){ report("gameEnd"); };
  }
  var dapiViewable = true, dapiLs = {};
  if (H.hook === "ironsource-dapi") {
    window.dapi = {
      isReady: function(){ return true; },
      isViewable: function(){ return dapiViewable; },
      addEventListener: function(ev, cb){ if (typeof cb === "function") (dapiLs[ev] = dapiLs[ev] || []).push(cb); },
      removeEventListener: function(ev, cb){ if (dapiLs[ev]) dapiLs[ev] = dapiLs[ev].filter(function(f){ return f !== cb; }); },
      openStoreUrl: function(){ report("dapi.openStoreUrl"); },
      getScreenSize: function(){ return size(); },
      getAudioVolume: function(){ return 1; }
    };
  }

  // ── controls from the dashboard: hide / show the creative ──
  window.addEventListener("message", function(e){
    var d = e && e.data;
    if (!d || d.__adlab !== "preview-control") return;
    if (d.action === "viewable") {
      var v = !!d.value;
      if (MRAID && window.mraid) { if (window.mraid.getState() !== "hidden") { viewable = !v; setViewable(v); } }
      if (H.hook === "ironsource-dapi") { dapiViewable = v; (dapiLs.viewableChange || []).forEach(function(cb){ try { cb({ isViewable: v }); } catch (er) {} }); report("viewableChange", String(v), true); }
    }
  });

  report("host", label, true);
})();</script>`;
}

/**
 * Put the preview host at the very top of <head> — before the export's own scripts, since the
 * runtime shim looks for `window.mraid` / SDK globals when it starts — and drop network SDK script
 * tags (Google's exitapi.js) so the recording stubs aren't replaced by the real library.
 */
export function injectPreviewHost(html: string, spec: Pick<NetworkSpec, "id" | "name" | "ctaHook" | "usesMraid">): string {
  const host = buildPreviewHost(spec);
  let out = html.replace(/<script[^>]+src=["'][^"']*exitapi\.js["'][^>]*>\s*<\/script>/gi, "<!-- exitapi.js: simulated by the preview host -->");
  if (/<head[^>]*>/i.test(out)) return out.replace(/<head[^>]*>/i, (m) => `${m}\n${host}`);
  if (/<html[^>]*>/i.test(out)) return out.replace(/<html[^>]*>/i, (m) => `${m}\n<head>${host}</head>`);
  return host + out;
}
