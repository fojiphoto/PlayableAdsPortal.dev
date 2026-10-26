import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url)); // packages/server/src

export const config = {
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  /** upload size ceiling (bytes) */
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 50 * 1024 * 1024),
  /** sqlite file path, or ":memory:" for tests */
  dbPath: process.env.FORGE_DB ?? join(process.cwd(), "data", "forge.db"),
  /** HMAC secret for auth tokens — MUST be set in production */
  jwtSecret: process.env.JWT_SECRET ?? "dev-insecure-secret-change-me",
  /** token lifetime in seconds (default 7 days) */
  tokenTtlSeconds: Number(process.env.TOKEN_TTL ?? 7 * 24 * 60 * 60),
  /** built web SPA to serve (same-origin). Default: packages/web/dist */
  webDist: process.env.WEB_DIST ?? resolve(here, "../../web/dist"),
  isProduction: process.env.NODE_ENV === "production",
};

export const isDevSecret = config.jwtSecret === "dev-insecure-secret-change-me";
