import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { buildPreloaderPreview, PRELOADER_TEMPLATES, type PreloaderConfig } from "@forge/packager";
import { authed } from "../auth.js";
import { atLeast, needs } from "../orgs.js";
import {
  createKit,
  currentOrgFor,
  deleteKit,
  getKit,
  kitAssignments,
  listKits,
  NO_KIT,
  setDefaultKit,
  updateKit,
  type KitFields,
} from "../repo.js";
import {
  kitToConfig,
  kitView,
  logoUri,
  MAX_KIT_LOGO,
  MAX_KITS_PER_WORKSPACE,
  parseKitBody,
  type KitBody,
} from "../preloader-config.js";

// The preview is our own generated markup; lock it down anyway (inline only, images from data: URIs).
const PREVIEW_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'";
const sendPreview = (reply: FastifyReply, cfg: PreloaderConfig, progress?: unknown) =>
  reply
    .header("Content-Type", "text/html; charset=utf-8")
    .header("Content-Security-Policy", PREVIEW_CSP)
    .header("Cache-Control", "no-store")
    .send(buildPreloaderPreview(cfg, { progress: typeof progress === "number" ? progress : undefined }));

/** Packager config from validated (possibly partial) fields; `logo` falls back to `fallbackLogo`. */
function fieldsToConfig(f: Partial<KitFields>, fallbackLogo: string | null): PreloaderConfig {
  const cfg: PreloaderConfig = { template: (f.template as PreloaderConfig["template"]) ?? "classic", showPercent: !!f.showPercent };
  if (f.bg) cfg.bg = f.bg;
  if (f.accent) cfg.accent = f.accent;
  if (f.text) cfg.text = f.text;
  const logo = f.logo === undefined ? fallbackLogo : f.logo ? logoUri(f.logo, f.logoMime ?? null) : null;
  if (logo) cfg.logoDataUri = logo;
  return cfg;
}

/**
 * Preloader kits (parity gap #12) — the competitor's `/kit/templates`, `/kit/create`, `/kit/preview`.
 * Kits belong to the current workspace; admins manage them, any member can pick which kit an app or
 * concept uses (PATCH /api/apps/:id, /api/concepts/:id `kitId`). The preview is rendered by the same
 * packager code as exports, so what the editor shows is what ships.
 */
export async function preloaderRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/kit/templates", async () => PRELOADER_TEMPLATES);

  app.get("/api/kits", authed, async (req) => {
    const ws = await currentOrgFor(req.user!.id);
    const kits = await listKits(ws.org.id);
    const a = await kitAssignments(ws.org.id);
    const usage = (id: string) => a.apps.filter((x) => x.kit_id === id).length + a.concepts.filter((x) => x.kit_id === id).length;
    return {
      kits: kits.map((k) => ({ ...kitView(k), usedBy: usage(k.id) + (ws.org.default_kit_id === k.id ? 1 : 0) })),
      defaultKitId: ws.org.default_kit_id && kits.some((k) => k.id === ws.org.default_kit_id) ? ws.org.default_kit_id : null,
      canEdit: atLeast(ws.role, "admin"),
      canAssign: atLeast(ws.role, "member"),
      limit: MAX_KITS_PER_WORKSPACE,
      assignments: {
        apps: a.apps.map((x) => ({ id: x.id, name: x.name, kitId: x.kit_id })),
        concepts: a.concepts.map((x) => ({ id: x.id, name: x.name, appId: x.app_id, kitId: x.kit_id })),
      },
    };
  });

  const create = async (req: FastifyRequest, reply: FastifyReply) => {
    const org = req.workspace!.org;
    const orgId = org.id;
    if ((await listKits(orgId)).length >= MAX_KITS_PER_WORKSPACE)
      return reply.code(400).send({ error: `A workspace can have at most ${MAX_KITS_PER_WORKSPACE} kits — delete one first.`, code: "kit-limit" });
    const f = parseKitBody(req.body as KitBody, true);
    if (typeof f === "string") return reply.code(400).send({ error: f });
    const kit = await createKit(orgId, f as KitFields);
    // the first kit of a workspace becomes its default, so a new user's first save "just works"
    if (!org.default_kit_id) await setDefaultKit(orgId, kit.id);
    return reply.code(201).send(kitView(kit));
  };
  app.post("/api/kits", needs("admin"), create);
  app.post("/api/kit/create", needs("admin"), create); // competitor-compatible alias

  app.patch<{ Params: { id: string } }>("/api/kits/:id", needs("admin"), async (req, reply) => {
    const f = parseKitBody(req.body as KitBody, false);
    if (typeof f === "string") return reply.code(400).send({ error: f });
    const k = await updateKit(req.params.id, req.workspace!.org.id, f);
    return k ? kitView(k) : reply.code(404).send({ error: "kit not found" });
  });

  app.post<{ Params: { id: string } }>("/api/kits/:id/duplicate", needs("admin"), async (req, reply) => {
    const orgId = req.workspace!.org.id;
    const k = await getKit(req.params.id, orgId);
    if (!k) return reply.code(404).send({ error: "kit not found" });
    if ((await listKits(orgId)).length >= MAX_KITS_PER_WORKSPACE)
      return reply.code(400).send({ error: `A workspace can have at most ${MAX_KITS_PER_WORKSPACE} kits — delete one first.`, code: "kit-limit" });
    const copy = await createKit(orgId, {
      name: `${k.name} copy`.slice(0, 60),
      template: k.template,
      bg: k.bg,
      accent: k.accent,
      text: k.text,
      showPercent: !!k.show_percent,
      logo: k.logo,
      logoMime: k.logo_mime,
    });
    return reply.code(201).send(kitView(copy));
  });

  app.delete<{ Params: { id: string } }>("/api/kits/:id", needs("admin"), async (req, reply) =>
    await deleteKit(req.params.id, req.workspace!.org.id) ? { deleted: true } : reply.code(404).send({ error: "kit not found" }),
  );

  /** The workspace default kit (null = exports get no preloader unless an app/concept picks one). */
  app.put<{ Body: { kitId?: string | null } }>("/api/kits/default", needs("admin"), async (req, reply) => {
    const orgId = req.workspace!.org.id;
    const id = req.body?.kitId ?? null;
    if (id !== null && !await getKit(id, orgId)) return reply.code(400).send({ error: "kit not found in this workspace" });
    await setDefaultKit(orgId, id);
    return { defaultKitId: id };
  });

  /**
   * Server-rendered preview of an unsaved kit (the editor's live preview and the template gallery).
   * Body: kit fields as for create, plus optional `kitId` (reuse that kit's saved image when
   * `logoDataUri` is absent) and `progress` (0–1 to freeze the bar; omitted = animated loop).
   */
  app.post<{ Body: KitBody & { kitId?: string; progress?: number } }>("/api/kit/preview", authed, async (req, reply) => {
    const f = parseKitBody({ ...req.body, name: "preview" }, true);
    if (typeof f === "string") return reply.code(400).send({ error: f });
    if (req.body?.logoDataUri === undefined) delete f.logo; // keep the saved image of kitId
    const saved = req.body?.kitId ? await getKit(req.body.kitId, (await currentOrgFor(req.user!.id)).org.id) : undefined;
    return sendPreview(reply, fieldsToConfig(f, saved ? logoUri(saved.logo, saved.logo_mime) : null), req.body?.progress);
  });

  app.get<{ Params: { id: string }; Querystring: { progress?: string } }>("/api/kits/:id/preview", authed, async (req, reply) => {
    const k = await getKit(req.params.id, (await currentOrgFor(req.user!.id)).org.id);
    if (!k) return reply.code(404).send({ error: "kit not found" });
    const p = req.query?.progress !== undefined ? Number(req.query.progress) : undefined;
    return sendPreview(reply, kitToConfig(k), Number.isFinite(p) ? p : undefined);
  });

  // ── legacy single-preloader API (pre-kit dashboard, scripts): maps onto the workspace default kit ──
  app.get("/api/preloader", authed, async (req) => {
    const org = (await currentOrgFor(req.user!.id)).org;
    const kits = await listKits(org.id);
    const k = kits.find((x) => x.id === org.default_kit_id) ?? kits[0];
    return { enabled: !!k && k.id === org.default_kit_id, bg: k?.bg ?? null, logoDataUri: k ? logoUri(k.logo, k.logo_mime) : null };
  });

  // multipart: optional file "logo" + fields bg, enabled ("1"), removeLogo ("1")
  app.post("/api/preloader", needs("admin"), async (req, reply) => {
    let logo: Buffer | undefined;
    let logoMime: string | undefined;
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === "file") {
        logo = await part.toBuffer();
        logoMime = part.mimetype;
      } else fields[part.fieldname] = String(part.value);
    }
    if (logo && !(logoMime ?? "").startsWith("image/")) return reply.code(400).send({ error: "logo must be an image" });
    if (logo && logo.length > MAX_KIT_LOGO) return reply.code(400).send({ error: "logo is too large — keep it under 512 KB" });
    const f = parseKitBody({ bg: fields.bg || null }, false);
    if (typeof f === "string") return reply.code(400).send({ error: f });
    if (logo) Object.assign(f, { logo: new Uint8Array(logo), logoMime });
    else if (fields.removeLogo === "1") f.logo = null;

    const org = req.workspace!.org;
    const kits = await listKits(org.id);
    const target = kits.find((x) => x.id === org.default_kit_id) ?? kits[0];
    const k = target
      ? (await updateKit(target.id, org.id, f))!
      : await createKit(org.id, { name: "Brand kit", template: "classic", bg: null, accent: null, text: null, showPercent: false, ...f });
    const enabled = fields.enabled === "1" || fields.enabled === "true";
    await setDefaultKit(org.id, enabled ? k.id : null);
    return { enabled, bg: k.bg, logoDataUri: logoUri(k.logo, k.logo_mime) };
  });
}

/** Validate an app/concept `kitId` patch value: null (inherit), "none", or a kit of this workspace. */
export async function checkKitRef(kitId: unknown, orgId: string): Promise<{ ok: true; value: string | null } | { ok: false; error: string }> {
  if (kitId === null) return { ok: true, value: null };
  if (kitId === NO_KIT) return { ok: true, value: NO_KIT };
  if (typeof kitId === "string" && await getKit(kitId, orgId)) return { ok: true, value: kitId };
  return { ok: false, error: `kitId must be a kit of this workspace, "${NO_KIT}", or null` };
}
