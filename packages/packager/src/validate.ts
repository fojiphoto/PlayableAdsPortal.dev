import type { NetworkSpec, ValidationIssue } from "./types.js";
import { findExternalRefs } from "./inline.js";

/** Things a playable can call to fire its CTA — if none appear, the ad has no click-through. */
const CTA_CALL =
  /PF\.(install|installFullGame|openStore)|PlayableForge\.|mraid\.open|window\.open\(|ExitApi\.exit|FbPlayableAd\.onCTAClick|openAppStore\(|dapi\.openStoreUrl|window\.install\(|postMessage\(\s*["']download/;

/**
 * Validate a packaged playable against a network spec. Mirrors what a network's own review tool
 * checks — size cap, self-containment, no bundled SDK, a real click-through, orientation,
 * viewport. `error`s would get the ad rejected; `warning`s are review risks.
 *
 * `html` is the final packaged markup (shim injected); `sourceHtml` is the playable as uploaded
 * (inlined, pre-shim) so checks about what the *author* wrote are not fooled by our own runtime.
 */
export function validate(
  bytes: Uint8Array,
  html: string,
  spec: NetworkSpec,
  sourceHtml: string = html,
  sourceFiles: readonly string[] = [],
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // size cap
  if (bytes.length > spec.maxSizeBytes) {
    issues.push({
      level: "error",
      code: "size-exceeded",
      message: `${fmt(bytes.length)} exceeds ${spec.name}'s ${fmt(spec.maxSizeBytes)} cap`,
    });
  } else if (bytes.length > spec.maxSizeBytes * 0.9) {
    issues.push({
      level: "warning",
      code: "size-near-cap",
      message: `${fmt(bytes.length)} is within 10% of the ${fmt(spec.maxSizeBytes)} cap`,
    });
  }

  // self-containment: nothing external except the hosts this network itself requires
  const allowed = (spec.allowedExternalHosts ?? []).map((h) => h.toLowerCase());
  const external = findExternalRefs(html).filter((ref) => {
    const host = hostOf(ref);
    return !allowed.some((a) => host === a || host.endsWith(`.${a}`));
  });
  if (external.length > 0) {
    issues.push({
      level: spec.format === "zip" ? "warning" : "error",
      code: "external-reference",
      message: `${external.length} external reference(s) not inlined: ${external.slice(0, 3).join(", ")}${external.length > 3 ? "…" : ""}`,
    });
  }

  // bundled SDK: networks inject mraid.js / dapi.js themselves — shipping your own copy is a rejection.
  // Check the uploaded file list (the inliner absorbs a local copy, erasing the src) and any leftover tag.
  const bundledSdk =
    sourceFiles.some((f) => /(^|\/)(mraid|dapi)\.js$/i.test(f)) ||
    /<script[^>]+src=["'][^"']*\b(mraid|dapi)\.js/i.test(sourceHtml);
  if (bundledSdk) {
    issues.push({
      level: "error",
      code: "bundled-sdk",
      message: `The playable bundles its own mraid.js/dapi.js — ${spec.name} injects the SDK; remove the script tag`,
    });
  }

  // a real click-through: the author must trigger the CTA somewhere
  if (!CTA_CALL.test(sourceHtml)) {
    issues.push({
      level: "warning",
      code: "no-cta-call",
      message: "No click-through found — call window.PF.install() (or the network's CTA) from the playable",
    });
  }

  // orientation: a portrait-/landscape-only network wants the creative to handle (or lock) orientation
  if (spec.orientation !== "both" && !/orientation/i.test(sourceHtml)) {
    issues.push({
      level: "warning",
      code: "no-orientation-handling",
      message: `${spec.name} is ${spec.orientation}-only but the playable has no orientation handling (CSS @media (orientation) or screen.orientation)`,
    });
  }

  // viewport
  if (!/name=["']viewport["']/i.test(html)) {
    issues.push({ level: "warning", code: "no-viewport", message: "No <meta viewport> — may render at desktop scale" });
  }

  return issues;
}

function hostOf(ref: string): string {
  try {
    return new URL(ref.startsWith("//") ? `https:${ref}` : ref).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export { fmt as formatBytes };
