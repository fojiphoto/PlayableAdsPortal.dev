import type { NetworkSpec, ValidationIssue } from "./types.js";
import { findExternalRefs } from "./inline.js";

/**
 * Validate a packaged playable against a network spec. Mirrors what a network's own review tool
 * checks: size cap, self-containment, MRAID presence, viewport. `error`s would get the ad rejected.
 */
export function validate(bytes: Uint8Array, html: string, spec: NetworkSpec): ValidationIssue[] {
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

  // self-containment (single-file formats must not reach out to the network)
  const external = findExternalRefs(html);
  if (external.length > 0) {
    issues.push({
      level: spec.format === "zip" ? "warning" : "error",
      code: "external-reference",
      message: `${external.length} external reference(s) not inlined: ${external.slice(0, 3).join(", ")}${external.length > 3 ? "…" : ""}`,
    });
  }

  // MRAID presence
  if (spec.usesMraid && !/mraid/i.test(html)) {
    issues.push({
      level: "warning",
      code: "no-mraid-ref",
      message: `${spec.name} serves MRAID but the playable never references window.mraid`,
    });
  }

  // viewport
  if (!/name=["']viewport["']/i.test(html)) {
    issues.push({ level: "warning", code: "no-viewport", message: "No <meta viewport> — may render at desktop scale" });
  }

  return issues;
}

function fmt(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export { fmt as formatBytes };
