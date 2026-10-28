import type { PreloaderConfig } from "@forge/packager";
import { getPreloader } from "./repo.js";

function logoUri(logo: Uint8Array | null, mime: string | null): string | null {
  if (!logo) return null;
  return `data:${mime || "image/png"};base64,${Buffer.from(logo).toString("base64")}`;
}

/** The preloader to inject at export time, or undefined when disabled/empty. */
export function preloaderForExport(userId: string): PreloaderConfig | undefined {
  const p = getPreloader(userId);
  if (!p || !p.enabled) return undefined;
  const cfg: PreloaderConfig = {};
  if (p.bg) cfg.bg = p.bg;
  const uri = logoUri(p.logo, p.logo_mime);
  if (uri) cfg.logoDataUri = uri;
  return cfg.bg || cfg.logoDataUri ? cfg : undefined;
}

/** A UI-facing view of the saved preloader (logo as a data URI for preview). */
export function preloaderView(userId: string) {
  const p = getPreloader(userId);
  if (!p) return { enabled: false, bg: null as string | null, logoDataUri: null as string | null };
  return { enabled: !!p.enabled, bg: p.bg, logoDataUri: logoUri(p.logo, p.logo_mime) };
}
