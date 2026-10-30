/** @forge/packager — HTML5 playable → a correct, size-checked package per ad network. */
export * from "./types.js";
export { NETWORKS, PRIORITY_NETWORK_IDS, getNetwork, allNetworks } from "./networks.js";
export { inlineToSingleHtml, findExternalRefs, isExternalRef } from "./inline.js";
export { injectRuntime } from "./wrap.js";
export { buildRuntimeShim } from "./runtime-shim.js";
export { validate, formatBytes } from "./validate.js";
export { pack, packAll } from "./pack.js";
export { loadFromDir, loadFromZip, filesFromZip } from "./source.js";
export { compileUnityWebGL, CompileError } from "./compile.js";
export type { UnityCompileOptions, CompileResult, SizeBreakdown } from "./compile.js";
export { buildCapturePlayable, fitFrameBudget } from "./capture.js";
export type { CaptureBuildOptions, TapZone, EndCard } from "./capture.js";
