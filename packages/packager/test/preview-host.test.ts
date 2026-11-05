import { describe, it, expect } from "vitest";
import vm from "node:vm";
import { buildPreviewHost, injectPreviewHost } from "../src/preview-host.js";
import { buildRuntimeShim } from "../src/runtime-shim.js";
import { getNetwork } from "../src/networks.js";

const strip = (s: string) => s.replace(/^<script>/, "").replace(/<\/script>$/, "");

/** Run the preview host, then the export's runtime shim, in one fake window (as the server serves it). */
function runPreview(networkId: string, opts: { readyState?: string } = {}) {
  const spec = getNetwork(networkId);
  const posted: { call: string; detail: unknown }[] = [];
  const rawPosted: unknown[] = [];
  const winListeners: Record<string, ((e: unknown) => void)[]> = {};
  const docListeners: Record<string, (() => void)[]> = {};
  const opened: string[] = [];
  const sandbox: Record<string, unknown> = {
    console,
    setTimeout,
    clearTimeout,
    innerWidth: 300,
    innerHeight: 600,
    navigator: { userAgent: "Mozilla/5.0 (iPhone)", language: "en", languages: ["en"], sendBeacon: () => true },
    location: { href: "https://app.example/api/creatives/c1/preview/" + networkId },
    document: {
      readyState: opts.readyState ?? "loading",
      body: null,
      addEventListener: (t: string, fn: () => void) => (docListeners[t] ??= []).push(fn),
      removeEventListener: () => {},
      getElementById: () => null,
      createElement: () => ({ style: {}, setAttribute() {} }),
    },
    parent: {
      postMessage: (m: unknown) => {
        rawPosted.push(m);
        if (m && typeof m === "object" && (m as { __adlab?: string }).__adlab === "preview") posted.push(m as { call: string; detail: unknown });
      },
    },
    Image: class {},
    addEventListener: (t: string, fn: (e: unknown) => void) => (winListeners[t] ??= []).push(fn),
  };
  sandbox.window = sandbox;
  vm.runInNewContext(strip(buildPreviewHost(spec)), sandbox, { filename: "preview-host.js" });
  // the real window.open is replaced by the host; keep a trap to prove nothing opens for real
  const hostOpen = sandbox.open as (u: string) => unknown;
  sandbox.open = (u: string) => (opened.push(u), hostOpen(u));
  vm.runInNewContext(
    strip(
      buildRuntimeShim({
        clickMode: spec.clickMode,
        ctaHook: spec.ctaHook,
        usesMraid: spec.usesMraid,
        ctaUrl: "https://example.com/store",
        iosUrl: "https://apps.apple.com/app/id1",
        androidUrl: "",
        analytics: null,
      }),
    ),
    sandbox,
    { filename: "shim.js" },
  );
  type PF = { install: () => void; on: (e: string, cb: () => void) => void; lifecycle: { gameEnded: () => void } };
  return {
    PF: (sandbox as { PF: PF }).PF,
    win: sandbox as Record<string, unknown> & { mraid?: Record<string, (...a: unknown[]) => unknown> },
    calls: () => posted.map((p) => p.call),
    posted,
    rawPosted,
    domReady: () => (docListeners.DOMContentLoaded ?? []).forEach((f) => f()),
    control: (data: unknown) => (winListeners.message ?? []).forEach((f) => f({ data })),
    wait: (ms: number) => new Promise((r) => setTimeout(r, ms)),
  };
}

describe("preview host (simulated network containers)", () => {
  it("MRAID 2.0: loading → ready → viewable; a CTA tapped while loading is held until ready, then reported", async () => {
    const p = runPreview("applovin");
    const m = p.win.mraid!;
    expect(m.getVersion!()).toBe("2.0");
    expect(m.getState!()).toBe("loading");
    expect(m.getPlacementType!()).toBe("interstitial");
    expect(m.getMaxSize!()).toEqual({ width: 300, height: 600 });
    expect(p.calls()).toEqual(["host"]);

    p.PF.install(); // too early: the shim must queue it for "ready"
    expect(p.calls()).not.toContain("mraid.open");
    p.domReady();
    await p.wait(150);
    expect(m.getState!()).toBe("default");
    expect(m.isViewable!()).toBe(true);
    expect(p.calls()).toEqual(["host", "stateChange", "ready", "mraid.open", "viewableChange"]);
    expect(p.posted.find((x) => x.call === "mraid.open")!.detail).toBe("https://apps.apple.com/app/id1");
  });

  it("MRAID: the dashboard's Hide/Show fires viewableChange, which the shim turns into pause/resume", async () => {
    const p = runPreview("unityads", { readyState: "complete" });
    await p.wait(150);
    const seen: string[] = [];
    p.PF.on("pause", () => seen.push("pause"));
    p.PF.on("resume", () => seen.push("resume"));
    p.control({ __adlab: "preview-control", action: "viewable", value: false });
    p.control({ __adlab: "preview-control", action: "viewable", value: true });
    p.control({ something: "else" }); // ignored
    expect(seen).toEqual(["pause", "resume"]);
    expect(p.calls().filter((c) => c === "viewableChange")).toHaveLength(3); // initial show + hide + show
  });

  it.each([
    ["google", "ExitApi.exit"],
    ["meta", "FbPlayableAd.onCTAClick"],
    ["mintegral", "install"],
    ["tiktok", "openAppStore"],
    ["ironsource", "dapi.openStoreUrl"],
  ])("%s: the network's own CTA call runs and is reported (no fallback, no tab opened)", (network, call) => {
    const p = runPreview(network, { readyState: "complete" });
    p.PF.install();
    expect(p.calls()).toContain(call);
    expect(p.calls()).not.toContain("window.open");
  });

  it("vungle: the shim's postMessage('download'/'complete') reaches the host page", () => {
    const p = runPreview("vungle", { readyState: "complete" });
    p.PF.install();
    p.PF.lifecycle.gameEnded();
    expect(p.rawPosted).toContain("download");
    expect(p.rawPosted).toContain("complete");
  });

  it("window.open is recorded, never opened", () => {
    const p = runPreview("snapchat", { readyState: "complete" });
    p.PF.install();
    expect(p.posted).toContainEqual(expect.objectContaining({ call: "window.open", detail: "https://apps.apple.com/app/id1" }));
  });

  it("injection: at the top of <head> (before the shim), and Google's exitapi.js is replaced by the stub", () => {
    const html =
      '<!doctype html><html><head><meta charset="utf-8"><script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script></head><body><script>/*shim*/</script></body></html>';
    const out = injectPreviewHost(html, getNetwork("google"));
    expect(out.indexOf("__adlabPreviewHost")).toBeLessThan(out.indexOf("/*shim*/"));
    expect(out.indexOf("__adlabPreviewHost")).toBeLessThan(out.indexOf('<meta charset="utf-8">'));
    expect(out).not.toContain("exitapi.js\"></script>");
    expect(injectPreviewHost("<p>bare</p>", getNetwork("applovin"))).toMatch(/^<script>/);
  });
});
