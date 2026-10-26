import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import JSZip from "jszip";
import type { PlayableSource } from "./types.js";

const ENTRY_CANDIDATES = ["index.html", "playable.html", "ad.html", "main.html"];

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function pickEntry(paths: string[], preferred?: string): string {
  if (preferred && paths.includes(preferred)) return preferred;
  for (const c of ENTRY_CANDIDATES) {
    const hit = paths.find((p) => p.toLowerCase() === c);
    if (hit) return hit;
  }
  const anyHtml = paths.find((p) => p.toLowerCase().endsWith(".html"));
  if (!anyHtml) throw new Error("No HTML entry file found in playable source");
  return anyHtml;
}

/** Load an HTML5 playable from a directory on disk. */
export async function loadFromDir(dir: string, entry?: string): Promise<PlayableSource> {
  const files: Record<string, Uint8Array> = {};

  async function walk(cur: string): Promise<void> {
    for (const ent of await readdir(cur, { withFileTypes: true })) {
      const full = join(cur, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile()) {
        const rel = toPosix(relative(dir, full));
        files[rel] = new Uint8Array(await readFile(full));
      }
    }
  }
  await walk(dir);

  const paths = Object.keys(files);
  if (paths.length === 0) throw new Error(`No files found in "${dir}"`);
  return { entry: pickEntry(paths, entry), files };
}

/** Load an HTML5 playable from a .zip buffer. */
export async function loadFromZip(data: Uint8Array, entry?: string): Promise<PlayableSource> {
  const zip = await JSZip.loadAsync(data);
  const files: Record<string, Uint8Array> = {};
  await Promise.all(
    Object.values(zip.files).map(async (f) => {
      if (f.dir) return;
      files[f.name] = await f.async("uint8array");
    }),
  );
  const paths = Object.keys(files);
  if (paths.length === 0) throw new Error("Zip contained no files");
  return { entry: pickEntry(paths, entry), files };
}
