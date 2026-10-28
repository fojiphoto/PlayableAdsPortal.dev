import { describe, it, expect } from "vitest";
import { buildCapturePlayable, pack, packAll, getNetwork } from "../src/index.js";

// A 1x1 red JPEG — tiny, real image bytes so the canvas player has something to decode.
const RED_1x1_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////" +
    "////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAA" +
    "AAAAAAAAAAP/aAAgBAQABPxA=",
  "base64",
);

function frames(n: number): Uint8Array[] {
  return Array.from({ length: n }, () => new Uint8Array(RED_1x1_JPEG));
}

describe("buildCapturePlayable", () => {
  it("assembles a self-contained flipbook playable from a frame sequence", () => {
    const src = buildCapturePlayable(frames(8), { fps: 20, endCardTitle: "Hop Ball 3D", endCardCta: "Install" });
    const html = new TextDecoder().decode(src.files[src.entry]);

    expect(src.entry).toBe("index.html");
    // frames embedded as inline data URIs (no external refs to break size/offline)
    expect(html).toMatch(/data:image\/jpeg;base64,/);
    expect((html.match(/data:image\/jpeg;base64,/g) || []).length).toBe(8);
    // player + interaction + end-card wired to the shim's CTA
    expect(html).toContain("<canvas");
    expect(html).toContain("pointerdown");
    expect(html).toContain("window.PF.install()");
    expect(html).toContain("FPS=20");
    expect(html).toContain("Hop Ball 3D");
    expect(html).toContain("Install");
  });

  it("escapes end-card copy and defaults fps/labels", () => {
    const html = new TextDecoder().decode(
      buildCapturePlayable(frames(2), { endCardTitle: "<script>x" }).files["index.html"],
    );
    expect(html).not.toContain("<script>x");
    expect(html).toContain("&lt;script>x");
    expect(html).toContain("FPS=24");
    expect(html).toContain("Play Now");
  });

  it("throws on an empty capture", () => {
    expect(() => buildCapturePlayable([])).toThrow(/no frames/);
  });

  it("feeds the normal pipeline: packs a capture to AppLovin within the cap", async () => {
    const src = buildCapturePlayable(frames(12), { fps: 24 });
    const r = await pack(src, getNetwork("applovin"), { iosUrl: "https://apps.apple.com/app/id1" });
    expect(r.ok, JSON.stringify(r.validation)).toBe(true);
    expect(r.sizeBytes).toBeLessThanOrEqual(r.maxSizeBytes);
    const html = new TextDecoder().decode(r.bytes);
    // the shim implements PF.install -> mraid.open; the end-card button calls it
    expect(html).toContain("window.PF");
    expect(html).toContain("mraid.open");
  });

  it("packs a capture to every priority network within caps", async () => {
    const src = buildCapturePlayable(frames(16));
    const results = await packAll(src, { androidUrl: "https://play.google.com/store/apps/details?id=x" });
    for (const r of results) {
      expect(r.ok, `${r.network}: ${JSON.stringify(r.validation)}`).toBe(true);
      expect(r.sizeBytes).toBeLessThanOrEqual(r.maxSizeBytes);
    }
  });
});
