import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { config } from "../config.js";
import { buildUnityPackage, type PackageEntry } from "./unitypackage.js";
import { publicKeyParams } from "./license.js";

/** Where the plugin lands in a project when imported from the .unitypackage. */
export const INSTALL_ROOT = "Assets/FactorialAdLab";
/** Generated at download time inside the package (never in the repo). */
export const LICENSE_FILE = "Editor/FactorialAdLabLicense.json";
export const RELEASE_FILE = "Editor/FactorialAdLabRelease.json";
/** Carries the version + watermark as C# constants (the repo copy has an empty watermark). */
export const BUILD_INFO_FILE = "Editor/AdLabBuildInfo.cs";

export interface PluginRelease {
  version: string;
  unity: string;
  displayName: string;
  /** release date from the changelog heading, if any */
  releasedAt: string | null;
  /** bullet points of this version's changelog entry */
  notes: string[];
  commit: string | null;
}

/** Compare dotted versions numerically ("0.10.0" > "0.9.3"); non-numeric parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** Changelog entries: `## [x.y.z] - YYYY-MM-DD` headings followed by `- bullet` lines. */
export function parseChangelog(md: string): { version: string; date: string | null; notes: string[] }[] {
  const out: { version: string; date: string | null; notes: string[] }[] = [];
  for (const line of md.split(/\r?\n/)) {
    const h = /^##\s*\[?v?(\d+\.\d+\.\d+[^\]\s]*)\]?(?:\s*[-–]\s*(\d{4}-\d{2}-\d{2}))?/.exec(line);
    if (h) {
      out.push({ version: h[1]!, date: h[2] ?? null, notes: [] });
      continue;
    }
    const b = /^\s*[-*]\s+(.*\S)/.exec(line);
    if (b && out.length) out[out.length - 1]!.notes.push(b[1]!);
  }
  return out;
}

/** The current plugin release, read from the plugin folder (package.json + CHANGELOG.md). */
export function currentRelease(dir = config.pluginDir): PluginRelease {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { version: string; unity?: string; displayName?: string };
  let entry: { date: string | null; notes: string[] } | undefined;
  try {
    entry = parseChangelog(readFileSync(join(dir, "CHANGELOG.md"), "utf8")).find((e) => e.version === pkg.version);
  } catch {
    /* no changelog */
  }
  return {
    version: pkg.version,
    unity: pkg.unity ?? "6000.0",
    displayName: pkg.displayName ?? "Factorial AdLab",
    releasedAt: entry?.date ?? null,
    notes: entry?.notes ?? [],
    commit: (process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "").slice(0, 7) || null,
  };
}

/** Plugin source files (relative paths), excluding UPM-only and editor-generated files. */
export function pluginSourceFiles(dir = config.pluginDir): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith(".") || name.endsWith(".meta")) continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else out.push(relative(dir, full).split(sep).join("/"));
    }
  };
  walk(dir);
  // package.json only matters to the Package Manager; a stray licence/release file must never ship
  return out.filter((f) => f !== "package.json" && f !== LICENSE_FILE && f !== RELEASE_FILE).sort();
}

/**
 * Assemble the .unitypackage for one download: the plugin source under Assets/FactorialAdLab, the
 * watermark stamped into AdLabBuildInfo.cs, plus the signed licence and the release file (version,
 * signing public key, and the API base the plugin should talk to).
 */
export async function buildPluginPackage(opts: { licenseFile: string; watermark: string; apiBase: string }, dir = config.pluginDir): Promise<Uint8Array> {
  const rel = currentRelease(dir);
  const enc = new TextEncoder();
  const entries: PackageEntry[] = pluginSourceFiles(dir).map((f) => {
    let bytes: Uint8Array = readFileSync(join(dir, f));
    if (f === BUILD_INFO_FILE) {
      const src = new TextDecoder().decode(bytes).replace(/(Watermark\s*=\s*)"[^"]*"/, `$1"${opts.watermark}"`);
      bytes = enc.encode(src);
    }
    return { path: `${INSTALL_ROOT}/${f}`, bytes };
  });
  const key = await publicKeyParams();
  const release = {
    version: rel.version,
    commit: rel.commit,
    unity: rel.unity,
    api: opts.apiBase,
    keys: "production",
    kid: key.kid,
    modulus: key.modulus,
    exponent: key.exponent,
  };
  entries.push({ path: `${INSTALL_ROOT}/${LICENSE_FILE}`, bytes: enc.encode(opts.licenseFile) });
  entries.push({ path: `${INSTALL_ROOT}/${RELEASE_FILE}`, bytes: enc.encode(JSON.stringify(release, null, 2)) });
  return buildUnityPackage(entries);
}
