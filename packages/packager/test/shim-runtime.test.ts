import { describe, it, expect } from "vitest";
import vm from "node:vm";
import { buildRuntimeShim } from "../src/runtime-shim.js";
import type { ShimConfig } from "../src/runtime-shim.js";

/**
 * The shim is JavaScript we generate as a string — a lost backslash turns into a SyntaxError that
 * silently kills the CTA in every exported playable. So: actually EXECUTE it in a sandboxed window.
 */
function runShim(cfg: Partial<ShimConfig> & { href?: string; ua?: string; mraid?: unknown }) {
  const html = buildRuntimeShim({
    clickMode: "mraid",
    ctaHook: "mraid",
    usesMraid: true,
    ctaUrl: "https://example.com/store",
    iosUrl: "https://apps.apple.com/app/id1",
    androidUrl: "https://play.google.com/store/apps/details?id=x",
    analytics: null,
    ...cfg,
  });
  const code = html.replace(/^<script>/, "").replace(/<\/script>$/, "");
  const beacons: string[] = [];
  const opened: string[] = [];
  const vibrations: unknown[] = [];
  const listeners: Record<string, ((...a: unknown[]) => void)[]> = {};
  const bar = { style: { width: "" } };
  let preloaderHidden = 0;
  const sandbox: Record<string, unknown> = {
    console,
    setTimeout,
    navigator: {
      userAgent: cfg.ua ?? "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
      language: "de-DE",
      languages: ["de-DE", "en-US"],
      sendBeacon: (u: string) => (beacons.push(u), true),
      vibrate: (p: unknown) => (vibrations.push(p), true),
    },
    location: { href: cfg.href ?? "https://cdn.network.example/creative/index.html" },
    __pfHidePreloader: () => preloaderHidden++,
    document: {
      readyState: "complete",
      addEventListener: (t: string, fn: (...a: unknown[]) => void) => (listeners[t] ??= []).push(fn),
      removeEventListener: () => {},
      getElementById: (id: string) => (id === "__pf_plbar" ? bar : null),
    },
    parent: { postMessage: () => {} },
    Image: class { set src(v: string) { beacons.push("img:" + v); } },
    open: (u: string) => (opened.push(u), {}),
    addEventListener: () => {},
  };
  if (cfg.mraid) sandbox.mraid = cfg.mraid;
  sandbox.window = sandbox;
  vm.runInNewContext(code, sandbox, { filename: "shim.js" });
  type PF = Record<string, unknown> & {
    install: () => void;
    analytics: { logEvent: (n: string, v?: number) => void; applovin: Record<string, () => void> };
    lifecycle: Record<string, (...a: unknown[]) => void>;
    vars: Record<string, unknown>;
    getVar: (k: string, d?: unknown) => unknown;
    setLoadingProgress: (p: number) => void;
    getPreferredLanguage: () => string;
    getPreferredLanguages: () => string[];
    haptic: (t: string) => void;
  };
  return { win: sandbox as unknown as { PF: PF }, beacons, opened, listeners, vibrations, bar, hidden: () => preloaderHidden };
}

describe("runtime shim executes", () => {
  it("defines window.PF and routes install() to the store URL for the platform", () => {
    const { win, opened } = runShim({});
    expect(typeof win.PF.install).toBe("function");
    win.PF.install();
    expect(opened).toEqual(["https://apps.apple.com/app/id1"]); // iPhone UA → iOS URL, no mraid → window.open fallback
  });

  it("with analytics: beacons impression on load, funnel steps once, custom events, and flags device-preview plays", () => {
    const { win, beacons, listeners } = runShim({
      analytics: { endpoint: "https://app.factorialstudio.dev/api/t", creativeId: "c-1", network: "applovin" },
      href: "https://app.factorialstudio.dev/api/creatives/c-1/preview/applovin",
    });
    expect(beacons).toHaveLength(1);
    expect(beacons[0]).toMatch(/^https:\/\/app\.factorialstudio\.dev\/api\/t\/c-1\/applovin\?e=impression&s=[a-z0-9]+&t=\d+&p=1$/);
    // first touch → engage (once)
    listeners.pointerdown![0]!();
    listeners.pointerdown![0]!();
    expect(beacons.filter((b) => b.includes("e=engage"))).toHaveLength(1);
    win.PF.lifecycle.gameStarted!();
    win.PF.lifecycle.gameEnded!();
    win.PF.analytics.logEvent("level_3");
    win.PF.install();
    const kinds = beacons.map((b) => b.match(/[?&]e=([a-z]+)/)![1]);
    expect(kinds).toEqual(["impression", "engage", "start", "complete", "custom", "cta"]);
    expect(beacons.find((b) => b.includes("e=custom"))).toContain("n=level_3");
  });

  it("outside our preview the p flag is absent; without analytics nothing is sent", () => {
    const a = runShim({ analytics: { endpoint: "https://x.test/api/t", creativeId: "c", network: "unityads" } });
    expect(a.beacons[0]).not.toContain("p=1");
    const b = runShim({});
    b.win.PF.install();
    expect(b.beacons).toEqual([]);
  });

  it("runtime API completeness: vars, loading progress, languages, haptics, valued + AppLovin events", () => {
    const { win, beacons, vibrations, bar, hidden } = runShim({
      vars: { "TapCubeGame.tapsToWin": 5, "theme": "dark", "hard": true },
      analytics: { endpoint: "https://x.test/api/t", creativeId: "c", network: "applovin" },
    });
    // custom variables
    expect(win.PF.vars).toEqual({ "TapCubeGame.tapsToWin": 5, theme: "dark", hard: true });
    expect(win.PF.getVar("TapCubeGame.tapsToWin", 3)).toBe(5);
    expect(win.PF.getVar("missing", 3)).toBe(3);
    // loading progress drives the preloader bar; 1 hides it through the global hook
    win.PF.setLoadingProgress(0.42);
    expect(bar.style.width).toBe("42%");
    expect(hidden()).toBe(0);
    win.PF.setLoadingProgress(1);
    expect(hidden()).toBe(1);
    // languages + haptics
    expect(win.PF.getPreferredLanguage()).toBe("de-DE");
    expect(win.PF.getPreferredLanguages()).toEqual(["de-DE", "en-US"]);
    win.PF.haptic("success");
    win.PF.lifecycle.hapticTriggered!("heavy");
    expect(vibrations).toEqual([[10, 40, 10], 35]);
    // valued custom events + AppLovin challenge events
    win.PF.analytics.logEvent("coins", 12);
    win.PF.analytics.applovin.logChallengeSolved!();
    const custom = beacons.filter((b) => b.includes("e=custom"));
    expect(custom[0]).toContain("n=coins");
    expect(custom[0]).toContain("v=12");
    expect(custom[1]).toContain("n=CHALLENGE_SOLVED");
    expect(custom[1]).not.toContain("v=");
  });

  it("MRAID host: install() is queued until the SDK is ready", () => {
    const calls: string[] = [];
    let readyCb: (() => void) | undefined;
    const mraid = {
      getState: () => "loading",
      addEventListener: (ev: string, cb: () => void) => { if (ev === "ready") readyCb = cb; },
      removeEventListener: () => {},
      open: (u: string) => calls.push(u),
    };
    const { win } = runShim({ mraid });
    win.PF.install();
    expect(calls).toEqual([]);
    readyCb!();
    expect(calls).toEqual(["https://apps.apple.com/app/id1"]);
  });
});
