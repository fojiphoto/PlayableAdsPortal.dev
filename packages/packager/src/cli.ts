#!/usr/bin/env -S node --import tsx
/**
 * forge-pack — package an HTML5 playable to per-network outputs from the command line.
 *
 *   node --import tsx src/cli.ts <input-dir-or-zip> [options]
 *     --out <dir>        output directory (default ./forge-out)
 *     --name <stem>      output filename stem (default: input basename)
 *     --networks a,b,c   network ids (default: priority set)
 *     --cta <url>        generic CTA url
 *     --ios <url>        iOS App Store url
 *     --android <url>    Google Play url
 *     --entry <file>     entry html inside the source (auto-detected otherwise)
 */
import { basename, join, resolve } from "node:path";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { loadFromDir, loadFromZip } from "./source.js";
import { packAll } from "./pack.js";
import { PRIORITY_NETWORK_IDS } from "./networks.js";
import { formatBytes } from "./validate.js";
import type { PlayableSource } from "./types.js";

function parseArgs(argv: string[]) {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      flags[a.slice(2)] = argv[i + 1] ?? "";
      i++;
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

async function main() {
  const { positional, flags } = parseArgs(process.argv.slice(2));
  const input = positional[0];
  if (!input) {
    console.error("usage: forge-pack <input-dir-or-zip> [--out dir] [--name stem] [--networks a,b] [--cta url] [--ios url] [--android url]");
    process.exit(1);
  }

  const inPath = resolve(input);
  const st = await stat(inPath);
  let source: PlayableSource;
  if (st.isDirectory()) {
    source = await loadFromDir(inPath, flags.entry);
  } else {
    source = await loadFromZip(new Uint8Array(await readFile(inPath)), flags.entry);
  }

  const name = flags.name ?? basename(input).replace(/\.[^.]+$/, "");
  const ids = flags.networks ? flags.networks.split(",").map((s) => s.trim()).filter(Boolean) : [...PRIORITY_NETWORK_IDS];
  const outDir = resolve(flags.out ?? "forge-out");
  await mkdir(outDir, { recursive: true });

  const results = await packAll(source, { name, ctaUrl: flags.cta, iosUrl: flags.ios, androidUrl: flags.android }, ids);

  console.log(`\nPackaged "${source.entry}" → ${results.length} network(s)  (out: ${outDir})\n`);
  for (const r of results) {
    await writeFile(join(outDir, r.filename), r.bytes);
    const status = r.ok ? "OK " : "ERR";
    const size = `${formatBytes(r.sizeBytes)} / ${formatBytes(r.maxSizeBytes)}`;
    console.log(`  [${status}] ${r.networkName.padEnd(12)} ${size.padEnd(20)} ${r.filename}`);
    for (const issue of r.validation) {
      console.log(`         ${issue.level === "error" ? "✗" : "•"} ${issue.code}: ${issue.message}`);
    }
  }
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\nDone. ${results.length - failed} ok, ${failed} with errors.\n`);
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
