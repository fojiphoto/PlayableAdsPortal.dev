/**
 * Unity WebGL → single-file playable compiler (Phase 2.3 / parity gap #2, approach B).
 *
 * Input: the output folder of a Unity WebGL build (2020.1+ — `createUnityInstance` loader):
 *   index.html, Build/<name>.loader.js, Build/<name>.framework.js[.gz|.br],
 *   Build/<name>.wasm[.gz|.br], Build/<name>.data[.gz|.br], StreamingAssets/**, TemplateData/**
 *
 * Output: ONE self-contained HTML file. The loader is inlined; framework.js, the wasm module and
 * the data archive are embedded as base64 and handed to Unity's loader as blob: URLs, so the
 * playable makes no network requests and goes through the normal per-network packaging (shim,
 * MRAID, size validation) like any other creative. StreamingAssets are embedded too and served
 * through a fetch/XHR shim. Compressed builds are decompressed server-side.
 *
 * It also returns a size breakdown + actionable warnings — for playable ads the cap (2–5 MB) is
 * the whole game, and the developer needs to know whether code (.wasm) or assets (.data) is what
 * has to shrink.
 *
 * What this is NOT: a C#→JS transpiler with a bespoke renderer (the competitor's "purpose-built
 * runtime"). That is the long-term track; this is the real, honest compile path available today.
 */
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import type { PlayableSource } from "./types.js";
import { formatBytes } from "./validate.js";

export interface UnityCompileOptions {
  /** product name shown on the loading screen (defaults to what index.html declares) */
  name?: string;
  companyName?: string;
  productVersion?: string;
  /** loading-screen / letterbox colour */
  background?: string;
}

export interface SizeBreakdown {
  loader: number;
  framework: number;
  wasm: number;
  data: number;
  streamingAssets: number;
  /** files we did not embed (template, symbols, index.html, …) */
  other: number;
  /** sum of the embedded parts, uncompressed */
  totalRaw: number;
  /** size of the final single HTML file (base64 overhead included) */
  embedded: number;
}

export interface CompileResult {
  html: string;
  bytes: Uint8Array;
  breakdown: SizeBreakdown;
  warnings: string[];
  unityVersion: string | null;
  compression: "none" | "gzip" | "brotli";
  streamingAssetFiles: number;
}

export class CompileError extends Error {
  constructor(
    message: string,
    public code: "not-unity-webgl" | "unsupported-unity" | "missing-part" | "corrupt-part",
  ) {
    super(message);
    this.name = "CompileError";
  }
}

const MB = 1024 * 1024;
const HARD_CAP = 5 * MB; // the largest network cap we ship to

const base = (p: string) => p.split("/").pop() ?? p;

function decompress(name: string, bytes: Uint8Array): { bytes: Uint8Array; fmt: "none" | "gzip" | "brotli" } {
  const lower = name.toLowerCase();
  try {
    if (lower.endsWith(".gz") || (bytes[0] === 0x1f && bytes[1] === 0x8b)) return { bytes: new Uint8Array(gunzipSync(bytes)), fmt: "gzip" };
    if (lower.endsWith(".br")) return { bytes: new Uint8Array(brotliDecompressSync(bytes)), fmt: "brotli" };
  } catch (e) {
    throw new CompileError(`Could not decompress ${base(name)}: ${(e as Error).message}`, "corrupt-part");
  }
  return { bytes, fmt: "none" };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const jsStr = (s: string) => JSON.stringify(s).replace(/<\/script/gi, "<\\/script");

/** Pull productName / companyName / productVersion out of Unity's generated index.html, if present. */
function readIndexConfig(html: string | undefined): Partial<Record<"productName" | "companyName" | "productVersion", string>> {
  if (!html) return {};
  const out: Record<string, string> = {};
  for (const key of ["productName", "companyName", "productVersion"] as const) {
    const m = html.match(new RegExp(`${key}\\s*:\\s*(["'])(.*?)\\1`));
    if (m?.[2]) out[key] = m[2];
  }
  return out;
}

export async function compileUnityWebGL(source: PlayableSource, opts: UnityCompileOptions = {}): Promise<CompileResult> {
  const files = Object.entries(source.files).map(([path, bytes]) => ({ path: path.replace(/\\/g, "/"), bytes }));
  const warnings: string[] = [];

  const find = (re: RegExp) => files.find((f) => re.test(base(f.path).toLowerCase()));

  // ── guard rails: is this a Unity WebGL build we can handle? ──
  if (find(/^unityloader\.js$/) || files.some((f) => /\.unityweb$/i.test(f.path))) {
    throw new CompileError("Unity 2019 (or older) WebGL builds are not supported — build with Unity 2020.1 or newer.", "unsupported-unity");
  }
  const loader = find(/\.loader\.js$/);
  if (!loader) {
    throw new CompileError(
      "Not a Unity WebGL build: no *.loader.js found. Build your game with File ▸ Build Settings ▸ WebGL and zip the output folder (index.html + Build/).",
      "not-unity-webgl",
    );
  }
  const framework = find(/\.framework\.js(\.gz|\.br)?$/);
  const wasm = find(/\.wasm(\.gz|\.br)?$/);
  const data = find(/\.data(\.gz|\.br)?$/);
  if (!framework) throw new CompileError("Build is missing *.framework.js.", "missing-part");
  if (!wasm) throw new CompileError("Build is missing the *.wasm module.", "missing-part");

  // ── decompress what Unity compressed ──
  let compression: CompileResult["compression"] = "none";
  const take = (f: { path: string; bytes: Uint8Array }) => {
    const r = decompress(f.path, f.bytes);
    if (r.fmt !== "none") compression = r.fmt;
    return r.bytes;
  };
  const loaderJs = new TextDecoder().decode(loader.bytes);
  const frameworkBytes = take(framework);
  const wasmBytes = take(wasm);
  const dataBytes = data ? take(data) : new Uint8Array(0);

  if (!(wasmBytes[0] === 0x00 && wasmBytes[1] === 0x61 && wasmBytes[2] === 0x73 && wasmBytes[3] === 0x6d)) {
    throw new CompileError(`${base(wasm.path)} is not a valid WebAssembly module.`, "corrupt-part");
  }
  if (data && !new TextDecoder().decode(dataBytes.slice(0, 15)).startsWith("UnityWebData1.0")) {
    warnings.push(`${base(data.path)} does not start with the UnityWebData header — the build may be corrupt or from an unsupported Unity version.`);
  }
  if (!data) warnings.push("No *.data file in the build — fine for an empty scene, unexpected otherwise.");

  // ── StreamingAssets: embed and serve through a fetch/XHR shim ──
  const streaming = files.filter((f) => /(^|\/)StreamingAssets\//i.test(f.path));
  const saMap: Record<string, { d: string; t: string }> = {};
  let saBytes = 0;
  for (const f of streaming) {
    const rel = f.path.replace(/^.*?(^|\/)StreamingAssets\//i, "");
    saMap[rel] = { d: Buffer.from(f.bytes).toString("base64"), t: mimeOf(rel) };
    saBytes += f.bytes.length;
  }

  const used = new Set<string>([loader.path, framework.path, wasm.path, ...(data ? [data.path] : []), ...streaming.map((s) => s.path)]);
  const otherBytes = files.filter((f) => !used.has(f.path)).reduce((n, f) => n + f.bytes.length, 0);
  const indexHtml = files.find((f) => /(^|\/)index\.html?$/i.test(f.path));
  const declared = readIndexConfig(indexHtml ? new TextDecoder().decode(indexHtml.bytes) : undefined);
  const name = opts.name || declared.productName || "Playable";
  const company = opts.companyName || declared.companyName || "";
  const version = opts.productVersion || declared.productVersion || "1.0";
  const bg = opts.background || "#000000";
  const unityVersion = loaderJs.match(/\b(\d{4}\.\d+\.\d+[abfp]\d+|6000\.\d+\.\d+[abfp]\d+)\b/)?.[1] ?? null;

  if (find(/\.symbols\.json(\.gz|\.br)?$/)) warnings.push("Debug symbols (*.symbols.json) were dropped — turn Debug Symbols off in Publishing Settings to skip generating them.");
  if (compression !== "none") {
    warnings.push(`The build was ${compression}-compressed; it was decompressed for embedding. Set Publishing Settings ▸ Compression Format = Disabled for faster compiles.`);
  }
  if (/UNITY_DEVELOPMENT_BUILD|developmentBuild\s*[:=]\s*(true|1)/.test(new TextDecoder().decode(frameworkBytes.slice(0, 200_000)))) {
    warnings.push("This looks like a Development Build — untick it; release builds are much smaller.");
  }

  // ── assemble the single-file playable ──
  const fwB64 = Buffer.from(frameworkBytes).toString("base64");
  const wasmB64 = Buffer.from(wasmBytes).toString("base64");
  const dataB64 = Buffer.from(dataBytes).toString("base64");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no">
<meta name="generator" content="Factorial AdLab Unity compiler${unityVersion ? ` (Unity ${esc(unityVersion)})` : ""}">
<title>${esc(name)}</title>
<style>
html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:${esc(bg)};touch-action:none;-webkit-user-select:none;user-select:none;-webkit-tap-highlight-color:transparent}
#unity-canvas{display:block;width:100%;height:100%;outline:none}
#__ul{position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:${esc(bg)};color:#fff;font:600 14px/1.3 system-ui,-apple-system,sans-serif;transition:opacity .4s ease;z-index:5}
#__ul .bar{width:56%;max-width:260px;height:6px;border-radius:999px;background:rgba(255,255,255,.18);overflow:hidden}
#__ul .bar i{display:block;height:100%;width:0;background:#fff;border-radius:999px;transition:width .2s}
#__ul.hide{opacity:0;pointer-events:none}
#__err{position:fixed;left:12px;right:12px;bottom:12px;background:#b00020;color:#fff;padding:10px 12px;border-radius:8px;font:13px/1.35 system-ui,sans-serif;display:none;z-index:9}
</style>
</head>
<body>
<canvas id="unity-canvas" tabindex="-1"></canvas>
<div id="__ul"><div>${esc(name)}</div><div class="bar"><i id="__ulb"></i></div></div>
<div id="__err"></div>
<script>${loaderJs.replace(/<\/script>/gi, "<\\/script>")}</script>
<script>(function(){
var FW=${jsStr(fwB64)};
var WASM=${jsStr(wasmB64)};
var DATA=${jsStr(dataB64)};
var SA=${JSON.stringify(saMap).replace(/<\/script/gi, "<\\/script")};
function b64(s){var bin=atob(s),n=bin.length,u=new Uint8Array(n);for(var i=0;i<n;i++)u[i]=bin.charCodeAt(i);return u;}
function blobUrl(s,type){return URL.createObjectURL(new Blob([b64(s)],{type:type}));}
var saUrls={},saCount=0;for(var k in SA){saUrls[k]=blobUrl(SA[k].d,SA[k].t);saCount++;}
function mapUrl(u){var m=/(?:^|\\/)StreamingAssets\\/(.+?)(?:[?#].*)?$/.exec(String(u));if(m){var p=decodeURIComponent(m[1]);if(saUrls[p])return saUrls[p];}return u;}
if(saCount){
  var xo=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(m,u){var a=[].slice.call(arguments);a[1]=mapUrl(u);return xo.apply(this,a);};
  if(window.fetch){var of=window.fetch;window.fetch=function(u,o){return of.call(window,typeof u==="string"?mapUrl(u):u,o);};}
}
var canvas=document.getElementById("unity-canvas"),ov=document.getElementById("__ul"),bar=document.getElementById("__ulb"),err=document.getElementById("__err");
function fail(msg){err.textContent=String(msg);err.style.display="block";}
function fit(){canvas.style.width=window.innerWidth+"px";canvas.style.height=window.innerHeight+"px";}
window.addEventListener("resize",fit);fit();
var config={
  dataUrl:blobUrl(DATA,"application/octet-stream"),
  frameworkUrl:blobUrl(FW,"text/javascript"),
  codeUrl:blobUrl(WASM,"application/wasm"),
  streamingAssetsUrl:"StreamingAssets",
  companyName:${jsStr(company)},productName:${jsStr(name)},productVersion:${jsStr(version)},
  showBanner:function(msg,type){if(type==="error")fail(msg);else try{console.warn(msg);}catch(e){}},
  devicePixelRatio:Math.min(window.devicePixelRatio||1,2)
};
var started=false;
function start(){
  if(started)return;started=true;
  if(typeof createUnityInstance!=="function"){fail("Unity loader missing");return;}
  createUnityInstance(canvas,config,function(p){bar.style.width=Math.round(p*100)+"%";}).then(function(inst){
    window.unityInstance=inst;
    ov.classList.add("hide");setTimeout(function(){if(ov.parentNode)ov.parentNode.removeChild(ov);},500);
    try{if(window.PF){window.PF.lifecycle.gameLoaded();if(window.PF.hidePreloader)window.PF.hidePreloader();
      // viewability → pause/resume the main loop (ad SDKs reject creatives that run off-screen)
      if(window.PF.on){window.PF.on("pause",function(){try{inst.Module.pauseMainLoop();}catch(e){}});window.PF.on("resume",function(){try{inst.Module.resumeMainLoop();}catch(e){}});}
    }}catch(e){}
  }).catch(function(e){fail("Could not start the game: "+(e&&e.message||e));});
}
// MRAID hosts: don't boot while the container is still "loading"
if(window.mraid&&typeof window.mraid.getState==="function"&&window.mraid.getState()==="loading"&&typeof window.mraid.addEventListener==="function"){window.mraid.addEventListener("ready",start);setTimeout(start,4000);}
else start();
})();</script>
</body>
</html>
`;

  const bytes = new TextEncoder().encode(html);
  const breakdown: SizeBreakdown = {
    loader: loader.bytes.length,
    framework: frameworkBytes.length,
    wasm: wasmBytes.length,
    data: dataBytes.length,
    streamingAssets: saBytes,
    other: otherBytes,
    totalRaw: loader.bytes.length + frameworkBytes.length + wasmBytes.length + dataBytes.length + saBytes,
    embedded: bytes.length,
  };

  // ── size guidance (the point of a playable compiler: tell the dev what to cut) ──
  if (breakdown.embedded > HARD_CAP) {
    warnings.push(
      `The playable is ${formatBytes(breakdown.embedded)} — above every network's cap (2–5 MB). Base64 embedding adds ~33%, so the raw build must be ≈3.5 MB or less for a 5 MB network.`,
    );
  } else if (breakdown.embedded > 2 * MB) {
    warnings.push(`At ${formatBytes(breakdown.embedded)} the playable fits 5 MB networks (AppLovin, Unity Ads, ironSource…) but not 2 MB ones (Meta, TikTok, Chartboost, Tencent).`);
  }
  if (breakdown.data > 1.5 * MB && breakdown.data > breakdown.wasm) {
    warnings.push(`Assets dominate (${formatBytes(breakdown.data)} .data): lower texture Max Size, use crunch/ASTC compression, trim audio clips and remove unused scenes/Resources.`);
  }
  if (breakdown.wasm > 2.5 * MB) {
    warnings.push(`Code is heavy (${formatBytes(breakdown.wasm)} .wasm): set Managed Stripping Level = High, Enable Exceptions = None, Strip Engine Code on, IL2CPP Code Generation = Faster (smaller) builds, and remove unused packages.`);
  }
  if (streaming.length) warnings.push(`Embedded ${streaming.length} StreamingAssets file(s) (${formatBytes(saBytes)}) and routed their requests to the embedded copies.`);

  return { html, bytes, breakdown, warnings, unityVersion, compression, streamingAssetFiles: streaming.length };
}

function mimeOf(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return (
    {
      json: "application/json", txt: "text/plain", xml: "application/xml", bin: "application/octet-stream", bytes: "application/octet-stream",
      png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
      mp3: "audio/mpeg", ogg: "audio/ogg", wav: "audio/wav", mp4: "video/mp4", webm: "video/webm", bundle: "application/octet-stream", hash: "text/plain",
    } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}
