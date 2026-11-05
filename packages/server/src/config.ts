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

  // Stripe keys are read live from the environment in stripe.ts (STRIPE_SECRET_KEY,
  // STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_STARTER, STRIPE_PRICE_STUDIO); when unset, billing
  // stays in dev mode (plans switch instantly).
  /** absolute base URL for Checkout return links when the request Origin is missing */
  publicUrl: process.env.PUBLIC_URL ?? "",

  // ── support / ops ──
  /** where ticket, bug and contact-form notifications go */
  supportEmail: process.env.SUPPORT_EMAIL ?? "contact@factorialstudio.com",
  /** comma-separated emails that are platform admins (bootstrapped at login; admins can promote others) */
  adminEmails: (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
  /** send reminder emails automatically once a day (admins can always run them by hand) */
  remindersAuto: process.env.REMINDERS_AUTO === "1",

  // ── Unity plugin distribution ──
  /** the plugin source the server packages per download. Default: packages/unity-plugin */
  pluginDir: process.env.PLUGIN_DIR ?? resolve(here, "../../unity-plugin"),
  /** plugin requests below this version get 426 `plugin-outdated` (empty = no minimum) */
  pluginMinVersion: process.env.PLUGIN_MIN_VERSION ?? "",
  /** reject plugin requests that carry no signed licence (installs from source have none) */
  pluginRequireLicense: process.env.PLUGIN_REQUIRE_LICENSE === "1",
  /** RSA private key (PKCS#8 PEM) that signs download licences; when unset one is generated once and kept in the DB */
  pluginSigningKey: (process.env.PLUGIN_SIGNING_KEY ?? "").replace(/\\n/g, "\n"),
};

export const isDevSecret = config.jwtSecret === "dev-insecure-secret-change-me";
