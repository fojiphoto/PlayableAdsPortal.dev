import type { FastifyInstance, FastifyReply } from "fastify";
import JSZip from "jszip";
import { loadFromZip, packAll, getNetwork, PRIORITY_NETWORK_IDS, formatBytes, buildCapturePlayable } from "@forge/packager";
import type { PackOptions, PackResult, CaptureBuildOptions, TapZone } from "@forge/packager";
import { authed } from "../auth.js";
import {
  addExportUsage,
  createCreative,
  creativeOwnerId,
  deleteCreative,
  getConceptOwned,
  getCreativeOwned,
  getExport,
  getUserById,
  listExports,
  updateCreative,
  upsertExport,
  type ExportRow,
} from "../repo.js";
import { parseNetworkOrder } from "./apps.js";
import { checkExport } from "../plan-status.js";
import { preloaderForExport } from "../preloader-config.js";

function networkName(id: string): string {
  try {
    return getNetwork(id).name;
  } catch {
    return id;
  }
}

function packView(r: PackResult) {
  return {
    network: r.network,
    networkName: r.networkName,
    filename: r.filename,
    format: r.format,
    sizeBytes: r.sizeBytes,
    maxSizeBytes: r.maxSizeBytes,
    sizeLabel: `${formatBytes(r.sizeBytes)} / ${formatBytes(r.maxSizeBytes)}`,
    ok: r.ok,
    validation: r.validation,
  };
}

function exportView(e: ExportRow) {
  return {
    network: e.network,
    networkName: networkName(e.network),
    filename: e.filename,
    format: e.format,
    sizeBytes: e.size_bytes,
    maxSizeBytes: e.max_size_bytes,
    sizeLabel: `${formatBytes(e.size_bytes)} / ${formatBytes(e.max_size_bytes)}`,
    ok: e.ok === 1,
    validation: JSON.parse(e.validation_json),
  };
}

function sanitize(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "playable";
}

function sendBytes(reply: FastifyReply, bytes: Uint8Array, filename: string, contentType: string) {
  return reply
    .header("Content-Type", contentType)
    .header("Content-Disposition", `attachment; filename="${filename}"`)
    .send(Buffer.from(bytes));
}

export async function creativeRoutes(app: FastifyInstance): Promise<void> {
  // upload a playable under a concept
  app.post<{ Params: { conceptId: string } }>(
    "/api/concepts/:conceptId/creatives",
    authed,
    async (req, reply) => {
      const concept = getConceptOwned(req.params.conceptId, req.user!.id);
      if (!concept) return reply.code(404).send({ error: "concept not found" });

      let fileBuf: Buffer | undefined;
      let filename = "upload";
      const fields: Record<string, string> = {};
      for await (const part of req.parts()) {
        if (part.type === "file") {
          filename = part.filename ?? "upload";
          fileBuf = await part.toBuffer();
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }
      if (!fileBuf) return reply.code(400).send({ error: "no file uploaded (multipart field 'file')" });

      let sourceZip: Uint8Array;
      let entry: string;
      let fileCount: number;
      try {
        if (/\.html?$/i.test(filename)) {
          const zip = new JSZip();
          zip.file("index.html", fileBuf);
          sourceZip = await zip.generateAsync({ type: "uint8array" });
          entry = "index.html";
          fileCount = 1;
        } else {
          const source = await loadFromZip(new Uint8Array(fileBuf), fields.entry || undefined);
          sourceZip = new Uint8Array(fileBuf);
          entry = source.entry;
          fileCount = Object.keys(source.files).length;
        }
      } catch (e) {
        return reply.code(400).send({ error: `could not read playable: ${(e as Error).message}` });
      }

      const name = fields.name || filename.replace(/\.[^.]+$/, "") || "playable";
      const options: PackOptions = {
        name,
        ctaUrl: fields.ctaUrl || undefined,
        iosUrl: fields.iosUrl || undefined,
        androidUrl: fields.androidUrl || undefined,
      };
      const row = createCreative({
        conceptId: concept.id,
        name,
        entry,
        sourceZip,
        optionsJson: JSON.stringify(options),
      });
      return reply.code(201).send({
        id: row.id,
        name: row.name,
        entry: row.entry,
        fileCount,
        conceptId: concept.id,
        createdAt: row.created_at,
      });
    },
  );

  // capture → creative: the Unity plugin (Phase 2.1) POSTs an ordered gameplay frame
  // sequence; we build a lightweight HTML5 flipbook playable and store it as a creative.
  app.post<{ Params: { conceptId: string } }>(
    "/api/concepts/:conceptId/capture",
    authed,
    async (req, reply) => {
      const concept = getConceptOwned(req.params.conceptId, req.user!.id);
      if (!concept) return reply.code(404).send({ error: "concept not found" });

      const MAX_FRAMES = 240;
      const captured: { name: string; buf: Buffer; mime: string }[] = [];
      const fields: Record<string, string> = {};
      for await (const part of req.parts()) {
        if (part.type === "file") {
          if (captured.length >= MAX_FRAMES) {
            await part.toBuffer(); // drain
            continue;
          }
          captured.push({
            name: part.filename ?? `frame_${captured.length}`,
            buf: await part.toBuffer(),
            mime: part.mimetype || "image/jpeg",
          });
        } else {
          fields[part.fieldname] = String(part.value);
        }
      }
      if (captured.length === 0) {
        return reply.code(400).send({ error: "no frames uploaded (multipart file fields)" });
      }

      // play back in filename order so frame_000, frame_001 … stay in sequence
      captured.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      const mime = captured[0]!.mime.startsWith("image/") ? captured[0]!.mime : "image/jpeg";
      const fps = Math.min(60, Math.max(1, Number(fields.fps) || 24));
      const name = fields.name || "Captured gameplay";

      // Phase 2.2: interaction authoring, end-card editor, size tuning (all optional)
      let tapZone: TapZone | undefined;
      if (fields.tapZone) {
        try {
          const z = JSON.parse(fields.tapZone);
          if (typeof z?.x === "number" && typeof z?.y === "number" && typeof z?.w === "number" && typeof z?.h === "number") {
            tapZone = { x: z.x, y: z.y, w: z.w, h: z.h, label: z.label, hand: z.hand };
          }
        } catch {
          /* ignore a malformed zone */
        }
      }
      const endCard = {
        title: fields.endCardTitle || undefined,
        subtitle: fields.endCardSubtitle || undefined,
        cta: fields.endCardCta || undefined,
        bg: fields.endCardBg || undefined,
        titleColor: fields.endCardTitleColor || undefined,
        ctaBg: fields.endCardCtaBg || undefined,
        ctaColor: fields.endCardCtaColor || undefined,
        logoDataUri: fields.endCardLogo || undefined,
      };
      const hasEndCard = Object.values(endCard).some((v) => v !== undefined);
      const buildOpts: CaptureBuildOptions = {
        mime,
        fps,
        tapZone,
        requiredTaps: fields.requiredTaps ? Math.max(1, Number(fields.requiredTaps)) : undefined,
        loop: fields.loop ? fields.loop === "true" : undefined,
        endCard: hasEndCard ? endCard : undefined,
        frameBudgetBytes: fields.frameBudgetBytes ? Math.max(0, Number(fields.frameBudgetBytes)) : undefined,
      };

      let sourceZip: Uint8Array;
      try {
        const built = buildCapturePlayable(
          captured.map((c) => new Uint8Array(c.buf)),
          buildOpts,
        );
        const zip = new JSZip();
        zip.file("index.html", Buffer.from(built.files["index.html"]!));
        sourceZip = await zip.generateAsync({ type: "uint8array" });
      } catch (e) {
        return reply.code(400).send({ error: `could not build playable: ${(e as Error).message}` });
      }

      const options: PackOptions = {
        name,
        ctaUrl: fields.ctaUrl || undefined,
        iosUrl: fields.iosUrl || undefined,
        androidUrl: fields.androidUrl || undefined,
      };
      const row = createCreative({
        conceptId: concept.id,
        name,
        entry: "index.html",
        sourceZip,
        optionsJson: JSON.stringify(options),
      });
      return reply.code(201).send({
        id: row.id,
        name: row.name,
        entry: row.entry,
        source: "capture",
        frameCount: captured.length,
        fps,
        conceptId: concept.id,
        createdAt: row.created_at,
      });
    },
  );

  // creative detail + its exports
  app.get<{ Params: { id: string } }>("/api/creatives/:id", authed, async (req, reply) => {
    const cr = getCreativeOwned(req.params.id, req.user!.id);
    if (!cr) return reply.code(404).send({ error: "not found" });
    return {
      id: cr.id,
      name: cr.name,
      entry: cr.entry,
      conceptId: cr.concept_id,
      options: JSON.parse(cr.options_json),
      createdAt: cr.created_at,
      exports: listExports(cr.id).map(exportView),
    };
  });

  // rename / update stored CTA + store URLs
  app.patch<{ Params: { id: string }; Body: { name?: string; ctaUrl?: string | null; iosUrl?: string | null; androidUrl?: string | null } }>(
    "/api/creatives/:id",
    authed,
    async (req, reply) => {
      const cr = getCreativeOwned(req.params.id, req.user!.id);
      if (!cr) return reply.code(404).send({ error: "not found" });
      const name = req.body?.name?.trim();
      if (req.body?.name !== undefined && !name) return reply.code(400).send({ error: "name cannot be empty" });
      const stored = JSON.parse(cr.options_json) as PackOptions;
      const pick = (v: string | null | undefined, cur: string | undefined) => (v === undefined ? cur : v || undefined);
      const options: PackOptions = {
        ...stored,
        name: name ?? stored.name,
        ctaUrl: pick(req.body?.ctaUrl, stored.ctaUrl),
        iosUrl: pick(req.body?.iosUrl, stored.iosUrl),
        androidUrl: pick(req.body?.androidUrl, stored.androidUrl),
      };
      updateCreative(cr.id, req.user!.id, { name, optionsJson: JSON.stringify(options) });
      const fresh = getCreativeOwned(cr.id, req.user!.id)!;
      return { id: fresh.id, name: fresh.name, entry: fresh.entry, conceptId: fresh.concept_id, options, createdAt: fresh.created_at };
    },
  );

  // export: build packages and persist them
  app.post<{ Params: { id: string }; Body: { networks?: string[]; ctaUrl?: string; iosUrl?: string; androidUrl?: string } }>(
    "/api/creatives/:id/export",
    authed,
    async (req, reply) => {
      const cr = getCreativeOwned(req.params.id, req.user!.id);
      if (!cr) return reply.code(404).send({ error: "not found" });

      // publisher gate: the app owner's company domain must be verified (app-ads.txt / verify file)
      // before anything ships to a network — the same gate the competitor applies.
      const owner = getUserById(creativeOwnerId(cr.id) ?? req.user!.id);
      if (!owner?.domain_verified) {
        return reply.code(403).send({
          error: "Verify your company domain before exporting: open the Domain page, add the token to app-ads.txt (or the verify file), then Check now.",
          code: "domain-unverified",
        });
      }

      const body = req.body ?? {};
      const concept = getConceptOwned(cr.concept_id, req.user!.id);
      const customOrder = parseNetworkOrder(concept?.network_order);
      const ids = body.networks && body.networks.length ? body.networks : (customOrder ?? [...PRIORITY_NETWORK_IDS]);
      try {
        ids.forEach(getNetwork);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }

      // plan gate: allowed networks + rolling-30-day quota
      const gate = checkExport(req.user!.id, ids);
      if (!gate.ok) return reply.code(402).send(gate);

      const source = await loadFromZip(cr.source_zip, cr.entry);
      const stored = JSON.parse(cr.options_json) as PackOptions;
      const opts: PackOptions = {
        name: stored.name,
        ctaUrl: body.ctaUrl ?? stored.ctaUrl,
        iosUrl: body.iosUrl ?? stored.iosUrl,
        androidUrl: body.androidUrl ?? stored.androidUrl,
        preloader: preloaderForExport(req.user!.id),
      };
      // only count a network toward quota the first time this creative exports it —
      // re-exporting an unchanged creative must not keep burning the 30-day allowance
      const already = new Set(listExports(cr.id).map((e) => e.network));
      const results = await packAll(source, opts, ids);
      for (const r of results) upsertExport(cr.id, r);
      for (const id of ids) if (!already.has(id)) addExportUsage(req.user!.id, id);
      return { id: cr.id, exported: results.map(packView) };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/creatives/:id", authed, async (req, reply) => {
    return deleteCreative(req.params.id, req.user!.id)
      ? { deleted: true }
      : reply.code(404).send({ error: "not found" });
  });

  // ── public, UUID-guarded delivery (so <iframe>/<a download> work without headers) ──
  app.get<{ Params: { id: string; network: string } }>(
    "/api/creatives/:id/download/:network",
    async (req, reply) => {
      const e = getExport(req.params.id, req.params.network);
      if (!e) return reply.code(404).send({ error: "not exported" });
      return sendBytes(reply, e.bytes, e.filename, e.format === "zip" ? "application/zip" : "text/html");
    },
  );

  app.get<{ Params: { id: string; network: string } }>(
    "/api/creatives/:id/preview/:network",
    async (req, reply) => {
      const e = getExport(req.params.id, req.params.network);
      if (!e) return reply.code(404).send({ error: "not exported" });
      let html: string;
      if (e.format === "zip") {
        const zip = await JSZip.loadAsync(e.bytes);
        const idx = zip.file("index.html");
        html = idx ? await idx.async("string") : "<!-- no index.html -->";
      } else {
        html = new TextDecoder().decode(e.bytes);
      }
      return reply.header("Content-Type", "text/html; charset=utf-8").send(html);
    },
  );

  app.get<{ Params: { id: string } }>("/api/creatives/:id/download-all", async (req, reply) => {
    const exports = listExports(req.params.id);
    if (exports.length === 0) return reply.code(404).send({ error: "nothing exported" });
    const zip = new JSZip();
    for (const e of exports) zip.file(e.filename, e.bytes);
    const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    return sendBytes(reply, bytes, `playables_all.zip`, "application/zip");
  });
}
