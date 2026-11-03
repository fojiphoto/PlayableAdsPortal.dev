import { describe, it, expect } from "vitest";
import vm from "node:vm";
import {
  PRELOADER_TEMPLATES,
  buildPreloader,
  buildPreloaderPreview,
  normalizePreloader,
  hasPreloaderContent,
} from "../src/preloader.js";
import { buildRuntimeShim } from "../src/runtime-shim.js";
import type { PreloaderConfig } from "../src/types.js";

const LOGO = "data:image/png;base64,iVBORw0KGgo=";

describe("preloader templates render", () => {
  it.each(PRELOADER_TEMPLATES.map((t) => t.id))("%s: overlay, progress element and shared script", (id) => {
    const html = buildPreloader({ template: id, bg: "#123456", logoDataUri: LOGO, showPercent: true, text: "Hi" });
    expect(html).toContain(`id="__pf_pl" data-template="${id}"`);
    expect(html).toContain("#123456");
    expect(html).toContain(LOGO);
    expect(html).toContain("window.__pfPreloaderProgress=");
    expect(html).toContain("window.__pfHidePreloader=hide");
    // each template exposes something the progress hook can draw on
    expect(/id="__pf_plbar"|id="__pf_plring"|id="__pf_plpct"/.test(html)).toBe(true);
  });

  it("splash uses the image as a full-bleed background, not an <img>", () => {
    const html = buildPreloader({ template: "splash", logoDataUri: LOGO });
    expect(html).toContain(`url("${LOGO}") center/cover`);
    expect(html).not.toContain("<img");
  });

  it("sanitises everything that reaches the markup", () => {
    const n = normalizePreloader({
      template: "nope" as PreloaderConfig["template"],
      bg: "red;background:url(//evil)",
      accent: "#zzz",
      logoDataUri: 'data:image/png;base64,AAA" onerror="alert(1)',
      text: "x".repeat(100),
    });
    expect(n.template).toBe("classic");
    expect(n.bg).toBe("#0b1220");
    expect(n.accent).toBe("#ffffff");
    expect(n.logoDataUri).toBeNull();
    expect(n.text).toHaveLength(60);
    const html = buildPreloader({ text: '</div><script>alert("x")</script>' });
    expect(html).not.toContain('<script>alert("x")');
    expect(html).toContain("&lt;/div&gt;&lt;script&gt;");
  });

  it("picks a readable foreground for light backgrounds", () => {
    expect(normalizePreloader({ bg: "#ffffff" }).fg).toBe("#111827");
    expect(normalizePreloader({ bg: "#000000" }).fg).toBe("#ffffff");
    expect(normalizePreloader({ bg: "#fff", accent: "#ff0000" }).accent).toBe("#ff0000");
  });

  it("an empty config is not injected; any styling is", () => {
    expect(hasPreloaderContent(undefined)).toBe(false);
    expect(hasPreloaderContent({})).toBe(false);
    expect(hasPreloaderContent({ template: "ring" })).toBe(true);
  });

  it("the preview page keeps the overlay on screen and drives progress", () => {
    const loop = buildPreloaderPreview({ template: "ring" });
    expect(loop).toMatch(/^<!doctype html>/);
    expect(loop).toContain("window.__pfPreloaderStay=true");
    expect(loop).toContain("setInterval");
    const frozen = buildPreloaderPreview({ template: "ring" }, { progress: 0.62 });
    expect(frozen).toContain("__pfPreloaderProgress(0.62)");
  });
});

/** Run the preloader overlay + the runtime shim in one fake window with a virtual clock. */
function runPage(cfg: PreloaderConfig, opts: { stay?: boolean } = {}) {
  const els: Record<string, { style: Record<string, string>; textContent: string; parentNode?: { removeChild: () => void } }> = {};
  let removed = false;
  for (const id of ["__pf_pl", "__pf_plbar", "__pf_plring", "__pf_plpct"]) els[id] = { style: {}, textContent: "" };
  els.__pf_pl!.parentNode = { removeChild: () => (removed = true) };

  // virtual timers
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void; every?: number }>();
  const setT = (fn: () => void, ms: number) => (timers.set(++seq, { at: now + ms, fn }), seq);
  const setI = (fn: () => void, ms: number) => (timers.set(++seq, { at: now + ms, fn, every: ms }), seq);
  const clear = (id: number) => void timers.delete(id);
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [id, t] = next;
      now = t.at;
      if (t.every) t.at += t.every;
      else timers.delete(id);
      t.fn();
    }
    now = end;
  };

  const winListeners: Record<string, (() => void)[]> = {};
  const sandbox: Record<string, unknown> = {
    console,
    setTimeout: setT,
    setInterval: setI,
    clearInterval: clear,
    clearTimeout: clear,
    navigator: { userAgent: "Mozilla/5.0 (iPhone)", language: "en", languages: ["en"], sendBeacon: () => true },
    location: { href: "https://cdn.example/creative/index.html" },
    document: {
      readyState: "loading",
      addEventListener: () => {},
      removeEventListener: () => {},
      getElementById: (id: string) => (cfg.template === "ring" || id !== "__pf_plring" ? (els[id] ?? null) : null),
    },
    parent: { postMessage: () => {} },
    Image: class {},
    open: () => ({}),
    addEventListener: (t: string, fn: () => void) => (winListeners[t] ??= []).push(fn),
  };
  if (opts.stay) sandbox.__pfPreloaderStay = true;
  sandbox.window = sandbox;
  const overlayScript = buildPreloader(cfg).match(/<script>([\s\S]*)<\/script>$/)![1]!;
  vm.runInNewContext(overlayScript, sandbox, { filename: "preloader.js" });
  const shim = buildRuntimeShim({ clickMode: "window-open", ctaHook: "none", usesMraid: false, ctaUrl: "", iosUrl: "", androidUrl: "", analytics: null });
  vm.runInNewContext(shim.replace(/^<script>/, "").replace(/<\/script>$/, ""), sandbox, { filename: "shim.js" });
  const PF = (sandbox as { PF: { setLoadingProgress: (n: number) => void; hidePreloader: () => void } }).PF;
  return {
    PF,
    els,
    advance,
    fireLoad: () => (winListeners.load ?? []).forEach((f) => f()),
    hidden: () => els.__pf_pl!.style.opacity === "0",
    removed: () => removed,
  };
}

describe("preloader behaviour (overlay + shim together)", () => {
  it("without progress calls: the bar creeps, and the overlay hides shortly after load", () => {
    const p = runPage({ template: "classic", showPercent: true });
    p.advance(1200);
    const w = parseFloat(p.els.__pf_plbar!.style.width!);
    expect(w).toBeGreaterThan(20);
    expect(w).toBeLessThan(90);
    p.fireLoad();
    p.advance(700);
    expect(p.hidden()).toBe(true);
    expect(p.els.__pf_plpct!.textContent).toBe("100%");
    p.advance(600);
    expect(p.removed()).toBe(true);
  });

  it("game-reported progress suspends the timed hide until it reaches 1 (a slow Unity load stays covered)", () => {
    const p = runPage({ template: "ring", showPercent: true });
    p.PF.setLoadingProgress(0.3);
    expect(p.els.__pf_plring!.style.strokeDashoffset).toBe(String(339.29 * 0.7));
    expect(p.els.__pf_plpct!.textContent).toBe("30%");
    p.fireLoad();
    p.advance(5000); // past both the load+700 ms and 3.5 s auto-hides
    expect(p.hidden()).toBe(false);
    p.PF.setLoadingProgress(0.2); // never goes backwards
    expect(p.els.__pf_plpct!.textContent).toBe("30%");
    p.PF.setLoadingProgress(1);
    p.advance(250);
    expect(p.hidden()).toBe(true);
  });

  it("a stalled game is uncovered after 20 s at the latest; PF.hidePreloader hides at once", () => {
    const stalled = runPage({ template: "minimal" });
    stalled.PF.setLoadingProgress(0.5);
    stalled.advance(19_000);
    expect(stalled.hidden()).toBe(false);
    stalled.advance(1_000);
    expect(stalled.hidden()).toBe(true);

    const direct = runPage({ template: "dots" });
    direct.PF.hidePreloader();
    expect(direct.hidden()).toBe(true);
  });

  it("preview mode never hides and lets the loop restart from 0", () => {
    const p = runPage({ template: "pulse" }, { stay: true });
    p.PF.setLoadingProgress(1);
    p.advance(25_000);
    expect(p.hidden()).toBe(false);
    p.PF.setLoadingProgress(0.1);
    expect(p.els.__pf_plpct!.textContent).toBe("10%");
  });
});
