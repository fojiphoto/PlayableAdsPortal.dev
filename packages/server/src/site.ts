import type { FastifyRequest } from "fastify";
import { config } from "./config.js";

/** The SPA origin to build email links against (request Origin, else Referer, else PUBLIC_URL). */
export function siteUrl(req: FastifyRequest): string {
  const origin = (req.headers.origin as string) || "";
  if (origin) return origin.replace(/\/$/, "");
  const ref = (req.headers.referer as string) || "";
  if (ref) {
    try {
      return new URL(ref).origin;
    } catch {
      /* ignore */
    }
  }
  return (config.publicUrl || "https://app.factorialstudio.dev").replace(/\/$/, "");
}

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
