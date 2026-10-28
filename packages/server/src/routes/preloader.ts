import type { FastifyInstance } from "fastify";
import { authed } from "../auth.js";
import { setPreloader } from "../repo.js";
import { preloaderView } from "../preloader-config.js";

export async function preloaderRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/preloader", authed, async (req) => preloaderView(req.user!.id));

  // multipart: optional file "logo" + fields bg, enabled ("1"), removeLogo ("1")
  app.post("/api/preloader", authed, async (req, reply) => {
    let logo: Buffer | undefined;
    let logoMime: string | undefined;
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === "file") {
        logo = await part.toBuffer();
        logoMime = part.mimetype;
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    if (logo && !(logoMime ?? "").startsWith("image/")) {
      return reply.code(400).send({ error: "logo must be an image" });
    }
    const removeLogo = fields.removeLogo === "1";
    setPreloader(req.user!.id, {
      bg: fields.bg || null,
      enabled: fields.enabled === "1" || fields.enabled === "true" ? 1 : 0,
      logo: logo ? new Uint8Array(logo) : removeLogo ? null : undefined,
      logoMime: logo ? logoMime : undefined,
    });
    return preloaderView(req.user!.id);
  });
}
