import { describe, it, expect } from "vitest";
import { buildCapturePlayable, fitFrameBudget, pack, packAll, getNetwork } from "../src/index.js";

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
    expect(html).toContain("&lt;script&gt;x");
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

describe("Phase 2.2 — interaction authoring", () => {
  it("renders an authored tap zone with an indicator and required taps", () => {
    const html = new TextDecoder().decode(
      buildCapturePlayable(frames(6), {
        tapZone: { x: 0.3, y: 0.4, w: 0.2, h: 0.15, label: "Hit the ball!" },
        requiredTaps: 3,
      }).files["index.html"],
    );
    expect(html).toContain("pf_hot"); // the hotspot indicator
    expect(html).toContain("Hit the ball!");
    expect(html).toContain('"taps":3');
    expect(html).toContain('"x":0.3');
    expect(html).toContain("inZone"); // the zone hit-test is wired
    expect(html).toContain("LOOP=true"); // interactive playables loop until completed
  });

  it("keeps tap-anywhere-to-skip when no zone is authored", () => {
    const html = new TextDecoder().decode(buildCapturePlayable(frames(4)).files["index.html"]);
    expect(html).toContain("ZONE=null");
    expect(html).toContain("LOOP=false");
    expect(html).toContain("Tap to play");
  });
});

describe("Phase 2.2 — end-card editor", () => {
  it("renders a rich end-card: logo, title, subtitle, and themed CTA", () => {
    const html = new TextDecoder().decode(
      buildCapturePlayable(frames(4), {
        endCard: {
          title: "Hop Ball 3D",
          subtitle: "1M+ players",
          cta: "Install free",
          bg: "rgba(10,20,40,.8)",
          ctaBg: "#15803d",
          ctaColor: "#ffffff",
          logoDataUri: "data:image/png;base64,AAAA",
        },
      }).files["index.html"],
    );
    expect(html).toContain("Hop Ball 3D");
    expect(html).toContain("1M+ players");
    expect(html).toContain("Install free");
    expect(html).toContain("#15803d");
    expect(html).toContain("data:image/png;base64,AAAA");
    expect(html).toContain("window.PF.install()");
  });

  it("still honours the deprecated endCardTitle/endCardCta", () => {
    const html = new TextDecoder().decode(
      buildCapturePlayable(frames(2), { endCardTitle: "Old Title", endCardCta: "Old CTA" }).files["index.html"],
    );
    expect(html).toContain("Old Title");
    expect(html).toContain("Old CTA");
  });
});

describe("Phase 2.2 — size tuning", () => {
  it("drops frames evenly to fit a raw byte budget, keeping first and last", () => {
    const fs = frames(20);
    const total = fs.reduce((n, f) => n + f.length, 0);
    const kept = fitFrameBudget(fs, Math.floor(total / 2));
    expect(kept.length).toBeLessThan(20);
    expect(kept.length).toBeGreaterThanOrEqual(2);
    expect(kept[0]).toBe(fs[0]);
    expect(kept[kept.length - 1]).toBe(fs[fs.length - 1]);
  });

  it("builds a smaller playable under a frame budget than without one", () => {
    const fs = frames(40);
    const big = new TextDecoder().decode(buildCapturePlayable(fs).files["index.html"]).length;
    const total = fs.reduce((n, f) => n + f.length, 0);
    const small = new TextDecoder().decode(
      buildCapturePlayable(fs, { frameBudgetBytes: Math.floor(total / 4) }).files["index.html"],
    ).length;
    expect(small).toBeLessThan(big);
  });
});
