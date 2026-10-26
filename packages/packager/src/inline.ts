import { parse } from "node-html-parser";
import type { PlayableSource } from "./types.js";

/**
 * Collapse a multi-file HTML5 playable into ONE self-contained HTML string:
 *  - <script src> / <link stylesheet> / inline <style>  -> inlined
 *  - <img>/<source>/<audio>/<video> src & poster        -> data: URIs
 *  - url(...) inside CSS and style="" attributes         -> data: URIs
 *  - <link rel=icon>                                     -> data: URI
 *
 * External (http/https/protocol-relative/data:) references are left untouched; validation flags
 * any that remain for single-file formats.
 */

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
  webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", bmp: "image/bmp",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac",
  mp4: "video/mp4", webm: "video/webm",
  woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf", eot: "application/vnd.ms-fontobject",
  json: "application/json", js: "text/javascript", css: "text/css", wasm: "application/wasm",
};

function extOf(path: string): string {
  const base = path.split(/[?#]/)[0] ?? path;
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
}

function mimeFor(path: string): string {
  return MIME[extOf(path)] ?? "application/octet-stream";
}

function cleanPath(p: string): string {
  const noProto = p.replace(/\\/g, "/").split(/[?#]/)[0] ?? p;
  return noProto.replace(/^\.\//, "").replace(/^\//, "");
}

function dirOf(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

/** POSIX-style join that resolves ./ and ../ segments. */
function joinPath(base: string, rel: string): string {
  const segs = (base ? base.split("/") : []).concat(rel.replace(/\\/g, "/").split("/"));
  const out: string[] = [];
  for (const seg of segs) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") { out.pop(); continue; }
    out.push(seg);
  }
  return out.join("/");
}

const EXTERNAL = /^(data:|https?:|\/\/|#|mailto:|tel:|blob:|javascript:)/i;

export function isExternalRef(ref: string): boolean {
  return EXTERNAL.test(ref.trim());
}

export function inlineToSingleHtml(source: PlayableSource): string {
  const fileMap = new Map<string, Uint8Array>();
  for (const [k, v] of Object.entries(source.files)) fileMap.set(cleanPath(k), v);

  const entry = cleanPath(source.entry);
  const entryBytes = fileMap.get(entry);
  if (!entryBytes) throw new Error(`Entry file "${source.entry}" not found in source`);
  const entryDir = dirOf(entry);

  const decode = (b: Uint8Array) => new TextDecoder().decode(b);
  const toDataUri = (bytes: Uint8Array, mime: string) =>
    `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

  /** Resolve a reference to a known file path, or null if external/missing. */
  function resolve(ref: string, baseDir: string): string | null {
    if (!ref || isExternalRef(ref)) return null;
    const rel = (ref.split(/[?#]/)[0] ?? ref).replace(/\\/g, "/");
    const candidates = [cleanPath(joinPath(baseDir, rel)), cleanPath(rel)];
    for (const c of candidates) if (fileMap.has(c)) return c;
    return null;
  }

  /** Replace url(...) tokens in a CSS string with data: URIs where the target is a local file. */
  function inlineCssUrls(css: string, cssDir: string): string {
    return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (whole, _q, ref: string) => {
      const p = resolve(ref, cssDir);
      if (!p) return whole;
      return `url(${toDataUri(fileMap.get(p)!, mimeFor(p))})`;
    });
  }

  const htmlText = decode(entryBytes);
  const doctype = htmlText.match(/^\s*<!doctype[^>]*>/i)?.[0]?.trim() ?? "<!DOCTYPE html>";
  const root = parse(htmlText, { comment: true });

  // 1) inline <style> blocks (resolve url() against the entry dir)
  for (const el of root.querySelectorAll("style")) {
    const css = inlineCssUrls(el.text, entryDir);
    el.insertAdjacentHTML("afterend", `<style>${css}</style>`);
    el.remove();
  }

  // 2) <link rel=stylesheet> -> <style>, and <link rel=icon> -> data: URI
  for (const el of root.querySelectorAll("link")) {
    const rel = (el.getAttribute("rel") ?? "").toLowerCase();
    const href = el.getAttribute("href") ?? "";
    if (rel.includes("stylesheet")) {
      const p = resolve(href, entryDir);
      if (p) {
        const css = inlineCssUrls(decode(fileMap.get(p)!), dirOf(p));
        el.insertAdjacentHTML("afterend", `<style>${css}</style>`);
        el.remove();
      }
    } else if (rel.includes("icon")) {
      const p = resolve(href, entryDir);
      if (p) el.setAttribute("href", toDataUri(fileMap.get(p)!, mimeFor(p)));
    }
  }

  // 3) <script src> -> inline <script> (guard any literal </script> in the code)
  for (const el of root.querySelectorAll("script")) {
    const src = el.getAttribute("src");
    if (!src) continue;
    const p = resolve(src, entryDir);
    if (!p) continue;
    const code = decode(fileMap.get(p)!).replace(/<\/script>/gi, "<\\/script>");
    const typeAttr = el.getAttribute("type");
    const t = typeAttr ? ` type="${typeAttr}"` : "";
    el.insertAdjacentHTML("afterend", `<script${t}>${code}</script>`);
    el.remove();
  }

  // 4) media src/poster -> data: URIs
  for (const tag of ["img", "source", "audio", "video"]) {
    for (const el of root.querySelectorAll(tag)) {
      for (const attr of ["src", "poster"]) {
        const v = el.getAttribute(attr);
        if (!v) continue;
        const p = resolve(v, entryDir);
        if (p) el.setAttribute(attr, toDataUri(fileMap.get(p)!, mimeFor(p)));
      }
    }
  }

  // 5) inline style="" attributes containing url()
  for (const el of root.querySelectorAll("[style]")) {
    const s = el.getAttribute("style");
    if (s && s.includes("url(")) el.setAttribute("style", inlineCssUrls(s, entryDir));
  }

  let out = root.toString();
  if (!/^\s*<!doctype/i.test(out)) out = `${doctype}\n${out}`;
  return out;
}

/** List remaining external (http/https/protocol-relative) references in an HTML string. */
export function findExternalRefs(html: string): string[] {
  const refs = new Set<string>();
  const attrRe = /\b(?:src|href)\s*=\s*(['"])(.*?)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(html))) {
    const v = (m[2] ?? "").trim();
    if (/^(https?:)?\/\//i.test(v)) refs.add(v);
  }
  const urlRe = /url\(\s*['"]?((https?:)?\/\/[^'")]+)['"]?\s*\)/gi;
  while ((m = urlRe.exec(html))) {
    if (m[1]) refs.add(m[1]);
  }
  return [...refs];
}
