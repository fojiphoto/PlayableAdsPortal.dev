import { isHexColor, isTemplateId, MAX_PRELOADER_TEXT, type PreloaderConfig } from "@forge/packager";
import { resolveKit, type KitFields, type KitRow } from "./repo.js";

/** Kit images are inlined into every export, so keep them small enough not to blow network size caps. */
export const MAX_KIT_LOGO = 512 * 1024;
export const MAX_KITS_PER_WORKSPACE = 25;
const LOGO_MIMES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];

export function logoUri(logo: Uint8Array | null, mime: string | null): string | null {
  if (!logo) return null;
  return `data:${mime || "image/png"};base64,${Buffer.from(logo).toString("base64")}`;
}

/** The packager config for a stored kit. */
export function kitToConfig(k: KitRow): PreloaderConfig {
  const cfg: PreloaderConfig = { template: isTemplateId(k.template) ? k.template : "classic", showPercent: !!k.show_percent };
  if (k.bg) cfg.bg = k.bg;
  if (k.accent) cfg.accent = k.accent;
  if (k.text) cfg.text = k.text;
  const uri = logoUri(k.logo, k.logo_mime);
  if (uri) cfg.logoDataUri = uri;
  return cfg;
}

export function kitView(k: KitRow) {
  return {
    id: k.id,
    name: k.name,
    template: k.template,
    bg: k.bg,
    accent: k.accent,
    text: k.text,
    showPercent: !!k.show_percent,
    logoDataUri: logoUri(k.logo, k.logo_mime),
    createdAt: k.created_at,
    updatedAt: k.updated_at,
  };
}

/** The preloader to inject when exporting a creative of this concept (concept → app → workspace default). */
export async function preloaderForConcept(conceptId: string): Promise<PreloaderConfig | undefined> {
  const { kit } = await resolveKit(conceptId);
  return kit ? kitToConfig(kit) : undefined;
}

/** What the dashboard shows next to a concept: which kit its exports get, and where that came from. */
export async function effectiveKitView(conceptId: string) {
  const { kit, source } = await resolveKit(conceptId);
  return { kitId: kit?.id ?? null, kitName: kit?.name ?? null, source };
}

/** Decode a `data:image/...;base64,` upload. */
export function parseLogo(uri: string): { bytes: Uint8Array; mime: string } | string {
  const m = /^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=\s]+)$/i.exec(uri);
  if (!m) return "logo must be a base64 data: URI";
  const mime = m[1]!.toLowerCase();
  if (!LOGO_MIMES.includes(mime)) return "logo must be PNG, JPEG, GIF, WebP or SVG";
  const bytes = new Uint8Array(Buffer.from(m[2]!.replace(/\s/g, ""), "base64"));
  if (bytes.length === 0) return "logo is empty";
  if (bytes.length > MAX_KIT_LOGO) return "logo is too large — keep it under 512 KB";
  return { bytes, mime };
}

export type KitBody = {
  name?: unknown;
  template?: unknown;
  bg?: unknown;
  accent?: unknown;
  text?: unknown;
  showPercent?: unknown;
  /** data: URI to set, null to remove, absent to keep */
  logoDataUri?: unknown;
};

/**
 * Validate a kit create/update body. On create every field gets a default; on update only the fields
 * present are returned. Returns an error message string when invalid.
 */
export function parseKitBody(b: KitBody | undefined, create: boolean): Partial<KitFields> | string {
  const body = b ?? {};
  const out: Partial<KitFields> = {};
  if (body.name !== undefined || create) {
    const name = String(body.name ?? "").trim().slice(0, 60);
    if (!name) return create ? "name is required" : "name cannot be empty";
    out.name = name;
  }
  if (body.template !== undefined || create) {
    const t = body.template ?? "classic";
    if (!isTemplateId(t)) return "unknown template — see GET /api/kit/templates";
    out.template = t;
  }
  for (const key of ["bg", "accent"] as const) {
    if (body[key] === undefined) {
      if (create) out[key] = null;
      continue;
    }
    if (body[key] === null || body[key] === "") out[key] = null;
    else if (isHexColor(body[key])) out[key] = (body[key] as string).toLowerCase();
    else return `${key} must be a hex colour like #0b1220`;
  }
  if (body.text !== undefined || create) {
    const text = body.text == null ? "" : String(body.text).trim();
    if (text.length > MAX_PRELOADER_TEXT) return `text must be at most ${MAX_PRELOADER_TEXT} characters`;
    out.text = text || null;
  }
  if (body.showPercent !== undefined || create) out.showPercent = body.showPercent === true || body.showPercent === "1";
  if (body.logoDataUri === null) out.logo = null;
  else if (body.logoDataUri !== undefined && body.logoDataUri !== "") {
    if (typeof body.logoDataUri !== "string") return "logoDataUri must be a string or null";
    const logo = parseLogo(body.logoDataUri);
    if (typeof logo === "string") return logo;
    out.logo = logo.bytes;
    out.logoMime = logo.mime;
  }
  return out;
}
