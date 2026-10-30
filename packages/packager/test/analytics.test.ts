import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { pack, getNetwork } from "../src/index.js";
import type { PlayableSource } from "../src/index.js";

const src: PlayableSource = {
  entry: "index.html",
  files: { "index.html": new TextEncoder().encode(`<!doctype html><html><head></head><body><button onclick="window.PF.install()">Play</button></body></html>`) },
};
const analytics = { endpoint: "https://app.factorialstudio.dev/api/t/", creativeId: "11111111-2222-4333-8444-555555555555" };

async function pageOf(r: { format: string; bytes: Uint8Array }): Promise<string> {
  if (r.format === "zip") {
    const z = await JSZip.loadAsync(r.bytes);
    return (await z.file("index.html")!.async("string")) ?? "";
  }
  return new TextDecoder().decode(r.bytes);
}

describe("in-playable analytics beacons", () => {
  it("embeds the collector config (trailing slash trimmed, network id added) and funnel hooks on a permissive network", async () => {
    const r = await pack(src, getNetwork("applovin"), { ctaUrl: "https://x.test", analytics });
    const html = await pageOf(r);
    expect(html).toContain(`"analytics":{"endpoint":"https://app.factorialstudio.dev/api/t","creativeId":"${analytics.creativeId}","network":"applovin"}`);
    for (const ev of ['track("impression")', 'track("engage")', 'track("start")', 'track("complete")', 'track("cta")']) expect(html).toContain(ev);
    expect(html).toContain("navigator.sendBeacon"); // primary transport
    expect(html).toContain("new Image(1, 1)"); // pixel fallback
    expect(html).toContain("/preview/"); // device-preview plays are flagged
    expect(html).toContain("logEvent: function(name, value)");
    // the collector URL is not a src/href, so the self-containment validator must not flag it
    expect(r.validation.filter((v) => v.code === "external-ref")).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("leaves beacons out entirely on networks whose spec forbids outbound requests", async () => {
    for (const id of ["meta", "google", "dv360", "mintegral", "tiktok"]) {
      const spec = getNetwork(id);
      expect(spec.allowsNetworkRequests, id).toBe(false);
      const html = await pageOf(await pack(src, spec, { ctaUrl: "https://x.test", analytics }));
      expect(html, id).toContain('"analytics":null');
      expect(html, id).not.toContain(analytics.endpoint.replace(/\/$/, ""));
    }
  });

  it("custom variables are injected into the shim config", async () => {
    const html = await pageOf(await pack(src, getNetwork("applovin"), { ctaUrl: "https://x.test", variables: { speed: 2.5, title: "Go!", hard: false } }));
    expect(html).toContain('"vars":{"speed":2.5,"title":"Go!","hard":false}');
    const plain = await pageOf(await pack(src, getNetwork("applovin"), { ctaUrl: "https://x.test" }));
    expect(plain).toContain('"vars":{}');
  });

  it("without an analytics option nothing is configured (opt-in)", async () => {
    const html = await pageOf(await pack(src, getNetwork("applovin"), { ctaUrl: "https://x.test" }));
    expect(html).toContain('"analytics":null');
  });
});
