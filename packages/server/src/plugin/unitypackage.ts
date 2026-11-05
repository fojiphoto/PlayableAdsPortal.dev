import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

/**
 * A minimal `.unitypackage` writer (dependency-free). The format is a gzipped tar where every asset
 * is a folder named by its GUID holding `asset` (the bytes; absent for folders), `asset.meta` and
 * `pathname` (the path under the project, e.g. `Assets/FactorialAdLab/Editor/X.cs`).
 *
 * GUIDs are derived from the path, so every release of the plugin uses the same GUIDs and Unity's
 * `AssetDatabase.ImportPackage` overwrites files in place instead of importing duplicates.
 */
export interface PackageEntry {
  /** project path, e.g. "Assets/FactorialAdLab/Editor/PluginUpdater.cs" */
  path: string;
  /** file bytes; omit for a folder */
  bytes?: Uint8Array;
}

export const guidFor = (path: string): string => createHash("md5").update(`factorial-adlab:${path}`).digest("hex");

const IMPORTER_TAIL = "  userData: \n  assetBundleName: \n  assetBundleVariant: \n";

/** The `.meta` for an entry. Scripts and text get defaults; .jslib is pinned to WebGL. */
export function metaFor(path: string, isFolder: boolean): string {
  const head = `fileFormatVersion: 2\nguid: ${guidFor(path)}\n`;
  if (isFolder) return `${head}folderAsset: yes\nDefaultImporter:\n  externalObjects: {}\n${IMPORTER_TAIL}`;
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (ext === ".cs")
    return `${head}MonoImporter:\n  externalObjects: {}\n  serializedVersion: 2\n  defaultReferences: []\n  executionOrder: 0\n  icon: {instanceID: 0}\n${IMPORTER_TAIL}`;
  if (ext === ".asmdef") return `${head}AssemblyDefinitionImporter:\n  externalObjects: {}\n${IMPORTER_TAIL}`;
  if (ext === ".jslib")
    return (
      `${head}PluginImporter:\n  externalObjects: {}\n  serializedVersion: 2\n  iconMap: {}\n  executionOrder: {}\n  defineConstraints: []\n` +
      `  isPreloaded: 0\n  isOverridable: 0\n  isExplicitlyReferenced: 0\n  validateReferences: 1\n  platformData:\n` +
      `  - first:\n      Any: \n    second:\n      enabled: 0\n      settings: {}\n` +
      `  - first:\n      Editor: Editor\n    second:\n      enabled: 0\n      settings:\n        DefaultValueInitialized: true\n` +
      `  - first:\n      WebGL: WebGL\n    second:\n      enabled: 1\n      settings: {}\n${IMPORTER_TAIL}`
    );
  return `${head}TextScriptImporter:\n  externalObjects: {}\n${IMPORTER_TAIL}`;
}

// ── tar (ustar) ──────────────────────────────────────────────────────────────
function octal(n: number, width: number): string {
  return n.toString(8).padStart(width - 1, "0") + "\0";
}
function tarHeader(name: string, size: number, dir: boolean, mtime: number): Uint8Array {
  if (Buffer.byteLength(name) > 100) throw new Error(`tar name too long: ${name}`);
  const h = Buffer.alloc(512, 0);
  h.write(name, 0, 100, "utf8");
  h.write(octal(dir ? 0o755 : 0o644, 8), 100, "ascii");
  h.write(octal(0, 8), 108, "ascii");
  h.write(octal(0, 8), 116, "ascii");
  h.write(octal(size, 12), 124, "ascii");
  h.write(octal(mtime, 12), 136, "ascii");
  h.write("        ", 148, "ascii"); // checksum placeholder (8 spaces)
  h.write(dir ? "5" : "0", 156, "ascii");
  h.write("ustar\0", 257, "ascii");
  h.write("00", 263, "ascii");
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return h;
}

/** Plain tar bytes for files (`dir` entries end with "/"). */
export function tar(files: { name: string; bytes?: Uint8Array }[], mtime = Math.floor(Date.now() / 1000)): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const f of files) {
    const dir = !f.bytes;
    parts.push(tarHeader(f.name, dir ? 0 : f.bytes!.length, dir, mtime));
    if (!dir) {
      parts.push(f.bytes!);
      const pad = (512 - (f.bytes!.length % 512)) % 512;
      if (pad) parts.push(new Uint8Array(pad));
    }
  }
  parts.push(new Uint8Array(1024)); // end-of-archive
  return new Uint8Array(Buffer.concat(parts));
}

/** Build a gzipped `.unitypackage` from project-path entries (folders are added automatically). */
export function buildUnityPackage(entries: PackageEntry[]): Uint8Array {
  const all = new Map<string, PackageEntry>();
  for (const e of entries) {
    const parts = e.path.split("/");
    // every ancestor folder below Assets/ gets its own entry (with a stable meta)
    for (let i = 2; i < parts.length; i++) {
      const dir = parts.slice(0, i).join("/");
      if (!all.has(dir)) all.set(dir, { path: dir });
    }
    all.set(e.path, e);
  }
  const files: { name: string; bytes?: Uint8Array }[] = [];
  const enc = new TextEncoder();
  for (const e of [...all.values()].sort((a, b) => a.path.localeCompare(b.path))) {
    const g = guidFor(e.path);
    files.push({ name: `${g}/` });
    if (e.bytes) files.push({ name: `${g}/asset`, bytes: e.bytes });
    files.push({ name: `${g}/asset.meta`, bytes: enc.encode(metaFor(e.path, !e.bytes)) });
    files.push({ name: `${g}/pathname`, bytes: enc.encode(e.path) });
  }
  return new Uint8Array(gzipSync(tar(files)));
}

/** Read a tar back (tests and diagnostics). */
export function untar(bytes: Uint8Array): { name: string; dir: boolean; bytes: Uint8Array }[] {
  const out: { name: string; dir: boolean; bytes: Uint8Array }[] = [];
  const buf = Buffer.from(bytes);
  let off = 0;
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const size = parseInt(h.subarray(124, 136).toString("ascii").replace(/\0.*$/s, "").trim() || "0", 8);
    const dir = h[156] === 0x35;
    off += 512;
    out.push({ name, dir, bytes: new Uint8Array(buf.subarray(off, off + size)) });
    off += Math.ceil(size / 512) * 512;
  }
  return out;
}
