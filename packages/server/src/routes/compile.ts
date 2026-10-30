import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import JSZip from "jszip";
import { allNetworks, compileUnityWebGL, CompileError, filesFromZip } from "@forge/packager";
import type { PackOptions } from "@forge/packager";
import { authed } from "../auth.js";
import { createCreative, createUpload, deleteUpload, getConceptOwned, getUpload, getJobOwned } from "../repo.js";
import { enqueue, registerJobHandler, JobError, jobView } from "../jobs.js";
import { rateLimit } from "../rate-limit.js";
import { needs } from "../orgs.js";

/**
 * Compile jobs (parity gap #2): a Unity WebGL build (zip of index.html + Build/ [+ StreamingAssets/])
 * → one self-contained HTML playable stored as a creative, with a size breakdown + warnings.
 * The heavy work runs on the job worker; the upload answers 202 { jobId } at once.
 */
export interface CompileJobPayload {
  uploadId: string;
  conceptId: string;
  name?: string;
  companyName?: string;
  unityVersion?: string;
  ctaUrl?: string;
  iosUrl?: string;
  androidUrl?: string;
}

registerJobHandler("compile", async (job, progress) => {
  const p = JSON.parse(job.payload_json) as CompileJobPayload;
  const up = getUpload(p.uploadId);
  if (!up || up.user_id !== job.user_id) throw new JobError("The uploaded build is no longer available — upload it again.", "upload-missing");
  try {
    const concept = getConceptOwned(p.conceptId, job.user_id);
    if (!concept) throw new JobError("Concept not found", "concept-missing");

    progress(5, "Unpacking the build…");
    const files = await filesFromZip(up.bytes);
    progress(20, "Compiling Unity WebGL → single-file playable…");
    const r = await compileUnityWebGL({ entry: "index.html", files }, { name: p.name, companyName: p.companyName, unityVersion: p.unityVersion });

    progress(85, "Saving creative…");
    const zip = new JSZip();
    zip.file("index.html", r.bytes);
    const sourceZip = await zip.generateAsync({ type: "uint8array" });
    const name = p.name || up.filename.replace(/\.zip$/i, "") || "unity-playable";
    const options: PackOptions = { name, ctaUrl: p.ctaUrl, iosUrl: p.iosUrl, androidUrl: p.androidUrl };
    const row = createCreative({ conceptId: concept.id, name, entry: "index.html", sourceZip, optionsJson: JSON.stringify(options) });

    const fitsNetworks = allNetworks()
      .filter((n) => r.breakdown.embedded <= n.maxSizeBytes)
      .map((n) => n.id);
    progress(100, "Done");
    return {
      creativeId: row.id,
      conceptId: concept.id,
      name,
      sizeBytes: r.breakdown.embedded,
      breakdown: r.breakdown,
      warnings: r.warnings,
      unityVersion: r.unityVersion,
      compression: r.compression,
      fitsNetworks,
      streamingAssetFiles: r.streamingAssetFiles,
    };
  } catch (e) {
    if (e instanceof CompileError) throw new JobError(e.message, e.code);
    throw e;
  } finally {
    deleteUpload(up.id); // the input is only needed once
  }
});

type Fields = Record<string, string>;

async function readMultipart(req: FastifyRequest): Promise<{ file?: Buffer; filename: string; fields: Fields }> {
  let file: Buffer | undefined;
  let filename = "build.zip";
  const fields: Fields = {};
  for await (const part of req.parts()) {
    if (part.type === "file") {
      filename = part.filename ?? filename;
      file = await part.toBuffer();
    } else {
      fields[part.fieldname] = String(part.value);
    }
  }
  return { file, filename, fields };
}

export async function compileRoutes(app: FastifyInstance): Promise<void> {
  async function startCompile(req: FastifyRequest, reply: FastifyReply, conceptIdFrom: (fields: Fields) => string | undefined) {
    const uid = req.user!.id;
    if (!rateLimit(`compile:${uid}`, 20, 60 * 60_000)) return reply.code(429).send({ error: "Too many compiles — try again in an hour." });

    const { file, filename, fields } = await readMultipart(req);
    const conceptId = conceptIdFrom(fields);
    const concept = conceptId ? getConceptOwned(conceptId, uid) : undefined;
    if (!concept) return reply.code(404).send({ error: "concept not found" });
    if (!file) return reply.code(400).send({ error: "no build uploaded (multipart field 'file', a .zip of the WebGL build folder)" });
    // zip magic "PK\x03\x04"
    if (!(file[0] === 0x50 && file[1] === 0x4b && file[2] === 0x03 && file[3] === 0x04)) {
      return reply.code(400).send({ error: "Upload a .zip of the Unity WebGL build folder (index.html + Build/)." });
    }

    const uploadId = createUpload(uid, filename, new Uint8Array(file));
    const payload: CompileJobPayload = {
      uploadId,
      conceptId: concept.id,
      name: fields.name || undefined,
      companyName: fields.companyName || undefined,
      unityVersion: fields.unityVersion || undefined,
      ctaUrl: fields.ctaUrl || undefined,
      iosUrl: fields.iosUrl || undefined,
      androidUrl: fields.androidUrl || undefined,
    };
    const job = enqueue(uid, "compile", payload);
    return reply.code(202).send({ jobId: job.id, status: job.status, statusUrl: `/api/jobs/${job.id}`, uploadBytes: file.length });
  }

  app.post<{ Params: { conceptId: string } }>("/api/concepts/:conceptId/compile", needs("member"), (req, reply) => startCompile(req, reply, () => req.params.conceptId));

  // competitor-shaped aliases: POST /api/compile/jobs (conceptId as a form field), GET /api/compile/jobs/:id
  app.post("/api/compile/jobs", needs("member"), (req, reply) => startCompile(req, reply, (f) => f.conceptId));
  app.get<{ Params: { id: string } }>("/api/compile/jobs/:id", authed, async (req, reply) => {
    const j = getJobOwned(req.params.id, req.user!.id);
    if (!j || j.kind !== "compile") return reply.code(404).send({ error: "not found" });
    return jobView(j);
  });
}
