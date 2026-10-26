import JSZip from "jszip";
import type { NetworkSpec, PackOptions, PackResult, PlayableSource } from "./types.js";
import { getNetwork, PRIORITY_NETWORK_IDS } from "./networks.js";
import { inlineToSingleHtml } from "./inline.js";
import { injectRuntime } from "./wrap.js";
import { validate } from "./validate.js";

function sanitize(name: string): string {
  return (name || "playable").trim().replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "playable";
}

/** Package one playable for one network: inline → inject runtime → (zip?) → validate. */
export async function pack(
  source: PlayableSource,
  spec: NetworkSpec,
  opts: PackOptions = {},
): Promise<PackResult> {
  const html = injectRuntime(inlineToSingleHtml(source), spec, opts);

  let bytes: Uint8Array;
  if (spec.format === "zip") {
    const zip = new JSZip();
    zip.file("index.html", html);
    bytes = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
  } else {
    bytes = new TextEncoder().encode(html);
  }

  const validation = validate(bytes, html, spec);
  const filename = `${sanitize(opts.name ?? "playable")}_${spec.id}.${spec.ext}`;

  return {
    network: spec.id,
    networkName: spec.name,
    filename,
    format: spec.format,
    bytes,
    sizeBytes: bytes.length,
    maxSizeBytes: spec.maxSizeBytes,
    validation,
    ok: !validation.some((i) => i.level === "error"),
  };
}

/** Package one playable for several networks (defaults to the priority set). */
export async function packAll(
  source: PlayableSource,
  opts: PackOptions = {},
  networkIds: readonly string[] = PRIORITY_NETWORK_IDS,
): Promise<PackResult[]> {
  return Promise.all(networkIds.map((id) => pack(source, getNetwork(id), opts)));
}
