import { describe, it, expect } from "vitest";
import { gzipSync, brotliCompressSync } from "node:zlib";
import { compileUnityWebGL, CompileError, pack, getNetwork, formatBytes } from "../src/index.js";
import type { PlayableSource } from "../src/index.js";

const enc = (s: string) => new TextEncoder().encode(s);
const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, ...new Array(200).fill(0x11)]);
const DATA = new Uint8Array([...enc("UnityWebData1.0\0"), ...new Array(500).fill(0x22)]);
const LOADER = `// Unity WebGL loader 6000.0.23f1\nfunction createUnityInstance(canvas, config, onProgress){ unityShowBanner('See <a href="https://bugzilla.mozilla.org/show_bug.cgi?id=1670675">bug</a>'); return Promise.resolve({ Module: {} }); }`;
const FRAMEWORK = `var unityFramework = function(Module){ /* framework */ PF_Install: function(){ try { if (window.PF) window.PF.install(); } catch (e) {} }; return Module; };`;
const INDEX = `<!DOCTYPE html><html><body><script>var config = { dataUrl: "Build/game.data", frameworkUrl: "Build/game.framework.js", codeUrl: "Build/game.wasm", companyName: "Factorial Studio", productName: "Hop Ball", productVersion: "0.9" };</script></body></html>`;

function build(extra: Record<string, Uint8Array> = {}, variant: "plain" | "gz" | "br" = "plain"): PlayableSource {
  const sfx = variant === "plain" ? "" : `.${variant}`;
  const z = (b: Uint8Array) => (variant === "gz" ? new Uint8Array(gzipSync(b)) : variant === "br" ? new Uint8Array(brotliCompressSync(b)) : b);
  return {
    entry: "index.html",
    files: {
      "index.html": enc(INDEX),
      "Build/game.loader.js": enc(LOADER),
      [`Build/game.framework.js${sfx}`]: z(enc(FRAMEWORK)),
      [`Build/game.wasm${sfx}`]: z(WASM),
      [`Build/game.data${sfx}`]: z(DATA),
      "TemplateData/style.css": enc("body{}"),
      ...extra,
    },
  };
}

describe("Unity WebGL → single-file compiler", () => {
  it("folds loader + framework + wasm + data into one self-contained HTML with a size breakdown", async () => {
    const r = await compileUnityWebGL(build());
    expect(r.html).toContain("function createUnityInstance"); // loader inlined
    expect(r.html).toContain(`var FW="${Buffer.from(FRAMEWORK).toString("base64")}"`);
    expect(r.html).toContain(`var WASM="${Buffer.from(WASM).toString("base64")}"`);
    expect(r.html).toContain(`var DATA="${Buffer.from(DATA).toString("base64")}"`);
    expect(r.html).toContain('codeUrl:blobUrl(WASM,"application/wasm")');
    // metadata picked up from Unity's index.html
    expect(r.html).toContain('productName:"Hop Ball"');
    expect(r.html).toContain('companyName:"Factorial Studio"');
    expect(r.html).toContain("<title>Hop Ball</title>");
    expect(r.unityVersion).toBe("6000.0.23f1");
    expect(r.compression).toBe("none");
    // breakdown
    expect(r.breakdown).toMatchObject({ loader: LOADER.length, framework: FRAMEWORK.length, wasm: WASM.length, data: DATA.length, streamingAssets: 0 });
    expect(r.breakdown.other).toBe(INDEX.length + "body{}".length);
    expect(r.breakdown.embedded).toBe(r.bytes.length);
    expect(r.breakdown.embedded).toBeGreaterThan(r.breakdown.totalRaw); // base64 overhead
    // the loader's advisory link is neutralised (it is not a load), and the CTA bridge is surfaced for the validator
    expect(r.html).toContain('href="#"');
    expect(r.html).not.toContain('href="https://bugzilla');
    expect(r.html).toContain("window.__adlabInstall=function(){try{window.PF.install();}catch(e){}}");
    expect(r.warnings).toEqual([]);
  });

  it("decompresses gzip and brotli builds and says so", async () => {
    for (const v of ["gz", "br"] as const) {
      const r = await compileUnityWebGL(build({}, v));
      expect(r.compression).toBe(v === "gz" ? "gzip" : "brotli");
      expect(r.breakdown.wasm).toBe(WASM.length); // measured uncompressed
      expect(r.html).toContain(`var WASM="${Buffer.from(WASM).toString("base64")}"`);
      expect(r.warnings.some((w) => w.includes("Compression Format = Disabled"))).toBe(true);
    }
  });

  it("embeds StreamingAssets and installs the fetch/XHR shim; honours a name override", async () => {
    const r = await compileUnityWebGL(build({ "StreamingAssets/levels/l1.json": enc('{"a":1}'), "StreamingAssets/cfg.txt": enc("hi") }), { name: "Override" });
    expect(r.streamingAssetFiles).toBe(2);
    expect(r.breakdown.streamingAssets).toBe(7 + 2);
    expect(r.html).toContain('"levels/l1.json":{"d":"' + Buffer.from('{"a":1}').toString("base64") + '","t":"application/json"}');
    expect(r.html).toContain("XMLHttpRequest.prototype.open=function");
    expect(r.html).toContain('productName:"Override"');
    expect(r.warnings.some((w) => w.includes("Embedded 2 StreamingAssets"))).toBe(true);
  });

  it("gives size guidance against the network caps", async () => {
    const bigData = new Uint8Array([...enc("UnityWebData1.0\0"), ...new Uint8Array(4 * 1024 * 1024)]);
    const r = await compileUnityWebGL(build({ "Build/game.data": bigData }));
    expect(r.breakdown.embedded).toBeGreaterThan(5 * 1024 * 1024);
    expect(r.warnings.some((w) => w.includes("above every network's cap"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("Assets dominate"))).toBe(true);
    expect(formatBytes(r.breakdown.data)).toMatch(/MB/);
  });

  it("rejects things that are not a (supported) Unity WebGL build with a clear code", async () => {
    await expect(compileUnityWebGL({ entry: "index.html", files: { "index.html": enc("<html></html>") } })).rejects.toMatchObject({ code: "not-unity-webgl" });
    await expect(compileUnityWebGL({ entry: "index.html", files: { "Build/UnityLoader.js": enc("x"), "Build/x.wasm.unityweb": WASM } })).rejects.toMatchObject({ code: "unsupported-unity" });
    const noWasm = build();
    delete noWasm.files["Build/game.wasm"];
    await expect(compileUnityWebGL(noWasm)).rejects.toBeInstanceOf(CompileError);
    const badWasm = build({ "Build/game.wasm": enc("not wasm at all") });
    await expect(compileUnityWebGL(badWasm)).rejects.toMatchObject({ code: "corrupt-part" });
  });

  it("warns when the game never calls the store, and takes the Unity version from the uploader", async () => {
    const r = await compileUnityWebGL(build({ "Build/game.framework.js": enc("var unityFramework = function(M){ return M; };") }), { unityVersion: "6000.2.6f2" });
    expect(r.unityVersion).toBe("6000.2.6f2");
    expect(r.html).not.toContain("__adlabInstall");
    expect(r.warnings.some((w) => w.includes("never calls Playable.InstallFullGame()"))).toBe(true);
  });

  it("the compiled playable flows through the normal per-network packaging", async () => {
    const r = await compileUnityWebGL(build());
    const src: PlayableSource = { entry: "index.html", files: { "index.html": r.bytes } };
    const out = await pack(src, getNetwork("applovin"), { ctaUrl: "https://apps.apple.com/x" });
    const html = new TextDecoder().decode(out.bytes);
    expect(out.ok, JSON.stringify(out.validation)).toBe(true);
    expect(out.validation.map((v) => v.code)).not.toContain("external-reference");
    expect(out.validation.map((v) => v.code)).not.toContain("no-cta-call");
    expect(html).toContain("window.PF"); // shim injected
    expect(html).toContain("function createUnityInstance"); // game still there
    expect(html).toContain("mraid.getState"); // waits for MRAID ready before booting
  });
});
