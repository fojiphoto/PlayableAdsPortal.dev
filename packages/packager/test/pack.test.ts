import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import JSZip from "jszip";
import {
  loadFromDir,
  packAll,
  pack,
  getNetwork,
  inlineToSingleHtml,
  findExternalRefs,
} from "../src/index.js";
import type { PlayableSource } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = join(here, "fixtures", "sample-playable");

describe("inliner", () => {
  it("inlines every local asset into one self-contained HTML", async () => {
    const src = await loadFromDir(fixture);
    const html = inlineToSingleHtml(src);

    expect(findExternalRefs(html)).toEqual([]);
    expect(html).not.toMatch(/src=["']logo\.png/);
    expect(html).not.toMatch(/href=["']style\.css/);
    expect(html).not.toMatch(/src=["']app\.js/);
    // assets became data URIs / inline content
    expect(html).toMatch(/data:image\/png;base64,/);
    expect(html).toContain('console.log("sample playable loaded")');
    expect(html).toContain("background: #0b1220");
    // css url() was inlined too
    expect(html).not.toMatch(/url\(["']?logo\.png/);
  });
});

describe("packAll", () => {
  it("packs to all 6 priority networks within their size caps", async () => {
    const src = await loadFromDir(fixture);
    const results = await packAll(src, {
      name: "lumber",
      iosUrl: "https://apps.apple.com/app/id123",
      androidUrl: "https://play.google.com/store/apps/details?id=x",
    });

    expect(results.map((r) => r.network).sort()).toEqual(
      ["applovin", "google", "ironsource", "meta", "mintegral", "unityads"].sort(),
    );
    for (const r of results) {
      expect(r.ok, `${r.network} errors: ${JSON.stringify(r.validation)}`).toBe(true);
      expect(r.sizeBytes).toBeLessThanOrEqual(r.maxSizeBytes);
      expect(r.filename).toContain("lumber");
      expect(r.validation.some((v) => v.level === "error")).toBe(false);
    }
  });
});

describe("runtime shim", () => {
  it("injects window.PF and routes AppLovin clicks through mraid.open with the CTA url", async () => {
    const src = await loadFromDir(fixture);
    const r = await pack(src, getNetwork("applovin"), { iosUrl: "https://apps.apple.com/app/id999" });
    const html = new TextDecoder().decode(r.bytes);
    expect(html).toContain("window.PF");
    expect(html).toContain("mraid.open");
    expect(html).toContain("https://apps.apple.com/app/id999");
  });
});

describe("zip format (Meta)", () => {
  it("produces a valid zip whose index.html carries the runtime", async () => {
    const src = await loadFromDir(fixture);
    const r = await pack(src, getNetwork("meta"), { name: "lumber" });
    expect(r.format).toBe("zip");
    expect(r.filename).toBe("lumber_meta.zip");
    const zip = await JSZip.loadAsync(r.bytes);
    const idx = zip.file("index.html");
    expect(idx).toBeTruthy();
    expect(await idx!.async("string")).toContain("window.PF");
  });
});

describe("validation", () => {
  it("flags an oversize playable as a size error", async () => {
    const big = "x".repeat(3 * 1024 * 1024);
    const src: PlayableSource = {
      entry: "index.html",
      files: {
        "index.html": new TextEncoder().encode(
          `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width"></head><body><script>/*${big}*/</script></body></html>`,
        ),
      },
    };
    const r = await pack(src, getNetwork("tiktok"), {});
    expect(r.ok).toBe(false);
    expect(r.validation.some((v) => v.code === "size-exceeded")).toBe(true);
  });
});

describe("preloader", () => {
  it("injects a custom preloader overlay when configured", async () => {
    const src = await loadFromDir(fixture);
    const r = await pack(src, getNetwork("applovin"), {
      preloader: { bg: "#123456", logoDataUri: "data:image/png;base64,AAAA" },
    });
    const html = new TextDecoder().decode(r.bytes);
    expect(html).toContain("__pf_pl");
    expect(html).toContain("#123456");
    expect(html).toContain("data:image/png;base64,AAAA");
  });

  it("omits the preloader when not configured", async () => {
    const src = await loadFromDir(fixture);
    const r = await pack(src, getNetwork("applovin"), {});
    expect(new TextDecoder().decode(r.bytes)).not.toContain('id="__pf_pl"'); // the shim references the bar id; the element itself must be absent
  });
});
