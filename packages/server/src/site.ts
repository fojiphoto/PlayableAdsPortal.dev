import type { FastifyRequest } from "fastify";
import { config } from "./config.js";

/**
 * The public origin this API is reachable at (for URLs baked into exported packages, e.g. the
 * analytics collector): PUBLIC_URL when set, else the proxied/host headers of the request.
 */
export function publicBase(req: FastifyRequest): string {
  if (config.publicUrl) return config.publicUrl.replace(/\/$/, "");
  const fwdProto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0]?.trim();
  const proto = fwdProto || req.protocol || "https";
  const host = (req.headers["x-forwarded-host"] as string | undefined) || (req.headers.host as string | undefined) || "";
  return host ? `${proto}://${host}` : "";
}
