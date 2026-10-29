import { describe, it, expect } from "vitest";
import { pack, getNetwork, validate, allNetworks } from "../src/index.js";
import type { PlayableSource } from "../src/index.js";

/** A minimal playable that fires its CTA through the stable runtime API. */
function playable(body = `<button onclick="window.PF.install()">Play</button>`, head = ""): PlayableSource {
  return {
    entry: "index.html",
    files: {
      "index.html": new TextEncoder().encode(
        `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width">${head}</head><body>${body}</body></html>`,
      ),
    },
  };
}
const text = (r: { bytes: Uint8Array }) => new TextDecoder().decode(r.bytes);
/** The index.html of a result, unzipping for zip-format networks. */
async function pageOf(r: { bytes: Uint8Array; format: string }): Promise<string> {
  if (r.format !== "zip") return text(r);
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(r.bytes);
  return zip.file("index.html")!.async("string");
}
const urls = { iosUrl: "https://apps.apple.com/app/id1", androidUrl: "https://play.google.com/store/apps/details?id=x" };

describe("per-network CTA hooks (the thing that gets a playable accepted)", () => {
  it("Google Ads / DV360: injects exitapi.js and fires ExitApi.exit(), with the script allowlisted", async () => {
    for (const id of ["google", "dv360"]) {
      const r = await pack(playable(), getNetwork(id), urls);
      const html = text(r);
      expect(html).toContain("tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js");
      expect(html).toContain("ExitApi.exit()");
      expect(html).toContain('"ctaHook":"google-exitapi"');
      // Google's own script must NOT count as an un-inlined external reference
      expect(r.validation.some((v) => v.code === "external-reference")).toBe(false);
      expect(r.ok).toBe(true);
    }
  });

  it("Meta Audience Network: zip + FbPlayableAd.onCTAClick()", async () => {
    const r = await pack(playable(), getNetwork("meta"), urls);
    expect(r.format).toBe("zip");
    const JSZip = (await import("jszip")).default;
    const zip = await JSZip.loadAsync(r.bytes);
    const html = await zip.file("index.html")!.async("string");
    expect(html).toContain("FbPlayableAd.onCTAClick()");
    expect(html).toContain('"ctaHook":"meta-fb"');
  });

  it("Mintegral: window.gameReady() on load and window.install() on CTA", async () => {
    const html = text(await pack(playable(), getNetwork("mintegral"), urls));
    expect(html).toContain("window.gameReady()");
    expect(html).toContain("window.install()");
    expect(html).toContain('addEventListener("load", onLoaded)');
  });

  it("TikTok / Pangle: window.openAppStore() and window.gameEnd() on finish", async () => {
    const html = text(await pack(playable(), getNetwork("tiktok"), urls));
    expect(html).toContain("window.openAppStore()");
    expect(html).toContain("window.gameEnd()");
  });

  it("ironSource: dapi.openStoreUrl(), gated on dapi ready + viewableChange", async () => {
    const html = text(await pack(playable(), getNetwork("ironsource"), urls));
    expect(html).toContain("dapi.openStoreUrl()");
    expect(html).toContain('d.addEventListener("ready", dapiReady)');
    expect(html).toContain('"viewableChange"');
  });

  it("Vungle: postMessage download for CTA and complete on game end", async () => {
    const html = text(await pack(playable(), getNetwork("vungle"), urls));
    expect(html).toContain('parent.postMessage("download", "*")');
    expect(html).toContain('parent.postMessage("complete", "*")');
  });

  it("MRAID networks: mraid.open() held until the SDK is ready; viewableChange → pause/resume", async () => {
    for (const id of ["applovin", "unityads", "liftoff", "moloco"]) {
      const html = text(await pack(playable(), getNetwork(id), urls));
      expect(html).toContain('"ctaHook":"mraid"');
      expect(html).toContain("m.getState() === \"loading\"");
      expect(html).toContain('addEventListener("ready"');
      expect(html).toContain('"viewableChange"');
      expect(html).toContain("https://apps.apple.com/app/id1");
    }
  });

  it("every hook keeps a plain-browser fallback (window.open) so the device preview still works", async () => {
    for (const n of allNetworks()) {
      const html = await pageOf(await pack(playable(), n, urls));
      expect(html, n.id).toContain('window.open(url, "_blank")');
      expect(html, n.id).toContain("window.PF");
    }
  });
});

describe("validator — mirrors the networks' review tools", () => {
  it("errors when the playable bundles its own mraid.js (networks inject the SDK)", async () => {
    const src = playable(`<button onclick="mraid.open('x')">Go</button>`, `<script src="js/mraid.js"></script>`);
    src.files["js/mraid.js"] = new TextEncoder().encode("window.mraid={open:function(){}};"); // a real bundled copy
    const r = await pack(src, getNetwork("applovin"), urls);
    expect(r.validation.some((v) => v.code === "bundled-sdk" && v.level === "error")).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("warns when the playable never fires a click-through", async () => {
    const r = await pack(playable(`<p>no button</p>`), getNetwork("applovin"), urls);
    expect(r.validation.some((v) => v.code === "no-cta-call")).toBe(true);
    // the author's PF.install() call satisfies it — our injected shim must not fool the check
    const ok = await pack(playable(), getNetwork("applovin"), urls);
    expect(ok.validation.some((v) => v.code === "no-cta-call")).toBe(false);
  });

  it("warns on a portrait-only network when the playable has no orientation handling", async () => {
    const none = await pack(playable(), getNetwork("snapchat"), urls);
    expect(none.validation.some((v) => v.code === "no-orientation-handling")).toBe(true);
    const handled = await pack(
      playable(`<button onclick="window.PF.install()">Play</button>`, `<style>@media (orientation: landscape){body{display:none}}</style>`),
      getNetwork("snapchat"),
      urls,
    );
    expect(handled.validation.some((v) => v.code === "no-orientation-handling")).toBe(false);
  });

  it("validate() applies the external-host allowlist only to that network's hosts", () => {
    const html = `<html><head><script src="https://tpc.googlesyndication.com/pagead/gadgets/html5/api/exitapi.js"></script><script src="https://evil.example.com/x.js"></script></head><body></body></html>`;
    const issues = validate(new TextEncoder().encode(html), html, getNetwork("google"), html);
    const ext = issues.find((v) => v.code === "external-reference");
    expect(ext).toBeTruthy();
    expect(ext!.message).toContain("evil.example.com");
    expect(ext!.message).not.toContain("googlesyndication");
  });
});
