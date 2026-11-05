import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { authed, verifyToken } from "../auth.js";
import { config } from "../config.js";
import {
  activePluginBan,
  createPluginBan,
  createPluginDownload,
  currentOrgFor,
  getPluginDownload,
  getUserByEmail,
  getUserById,
  liftPluginBan,
  listPluginBans,
  listPluginDownloadsAdmin,
  listPluginDownloadsFor,
  pluginUsageFor,
  touchPluginUsage,
  type PluginDownloadStats,
} from "../repo.js";
import { rateLimit } from "../rate-limit.js";
import { siteUrl } from "../site.js";
import { issueLicense, verifyLicense, watermarkFor } from "../plugin/license.js";
import { buildPluginPackage, compareVersions, currentRelease } from "../plugin/release.js";
import { adminOnly } from "./admin.js";

const PLUGIN_HEADER = "x-adlab-plugin";
const LICENSE_HEADER = "x-adlab-license";
/** Plugin requests that must work even for outdated or banned plugins (so they can learn why). */
const OPEN_PATHS = new Set(["/api/plugin/version", "/api/health"]);

const banMessage = () => `This Unity plugin licence has been revoked. Contact ${config.supportEmail} if you think this is a mistake.`;

function header(req: FastifyRequest, name: string): string | null {
  const v = req.headers[name];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Global onRequest guard for requests made BY THE PLUGIN (they carry `X-AdLab-Plugin: <version>`):
 *   - below PLUGIN_MIN_VERSION → 426 `plugin-outdated` (with where to get the update);
 *   - a licence (`X-AdLab-License`) that isn't signed by us → 403 `plugin-license-invalid`;
 *   - no licence while PLUGIN_REQUIRE_LICENSE=1 → 403 `plugin-license-required`;
 *   - a banned download, or a banned account → 403 `plugin-banned`.
 * Valid licensed requests are recorded per (download, account), which is how a leaked download shows up.
 * The web dashboard never sends the header, so a plugin ban never locks anyone out of the website.
 */
export async function pluginGuard(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ver = header(req, PLUGIN_HEADER);
  if (!ver) return;
  const path = (req.raw.url ?? "").split("?")[0]!;
  if (OPEN_PATHS.has(path)) return;

  if (config.pluginMinVersion && compareVersions(ver, config.pluginMinVersion) < 0) {
    await reply.code(426).send({
      error: `This version of the Unity plugin (${ver}) is no longer supported. Update to ${currentRelease().version} from the plugin window or your dashboard settings.`,
      code: "plugin-outdated",
      minVersion: config.pluginMinVersion,
      latest: currentRelease().version,
    });
    return;
  }

  const bearer = header(req, "authorization");
  const uid = bearer?.startsWith("Bearer ") ? (verifyToken(bearer.slice(7))?.sub ?? null) : null;

  const compact = header(req, LICENSE_HEADER);
  let lid: string | null = null;
  if (compact) {
    const lic = verifyLicense(compact);
    if (!lic) {
      await reply.code(403).send({ error: "The plugin's licence file is damaged or was not issued by Factorial AdLab. Download the plugin again.", code: "plugin-license-invalid" });
      return;
    }
    lid = lic.lid;
    if (activePluginBan("download", lid)) {
      await reply.code(403).send({ error: banMessage(), code: "plugin-banned" });
      return;
    }
  } else if (config.pluginRequireLicense) {
    await reply.code(403).send({ error: "Download the Unity plugin from your dashboard (Settings ▸ Unity plugin): this copy has no licence.", code: "plugin-license-required" });
    return;
  }

  if (uid && activePluginBan("user", uid)) {
    await reply.code(403).send({ error: banMessage(), code: "plugin-banned" });
    return;
  }
  if (lid && uid) touchPluginUsage(lid, uid, ver);
}

const downloadView = (d: PluginDownloadStats) => ({
  id: d.id,
  wm: d.wm,
  version: d.version,
  createdAt: d.created_at,
  accounts: d.accounts,
  lastSeenAt: d.last_seen,
  banned: !!d.banned,
});

/**
 * Unity plugin distribution (parity gap #13) — the competitor's `/plugin/download|version|downloads`
 * and `/plugin/bans`. The plugin source in this repo is packaged per download into a .unitypackage
 * carrying a signed, watermarked licence; the plugin self-updates from `/api/plugin/version`.
 */
export async function pluginRoutes(app: FastifyInstance): Promise<void> {
  /** Public: the latest release, and whether the caller (X-AdLab-Plugin) is behind or below the minimum. */
  app.get("/api/plugin/version", async (req) => {
    const rel = currentRelease();
    const installed = header(req, PLUGIN_HEADER);
    return {
      ...rel,
      minVersion: config.pluginMinVersion || null,
      downloadUrl: "/api/plugin/download",
      installed,
      updateAvailable: installed ? compareVersions(installed, rel.version) < 0 : null,
      supported: installed && config.pluginMinVersion ? compareVersions(installed, config.pluginMinVersion) >= 0 : true,
    };
  });

  /** A fresh, signed .unitypackage for the signed-in user (one licence per download). */
  app.get("/api/plugin/download", authed, async (req, reply) => {
    const me = getUserById(req.user!.id);
    if (!me) return reply.code(401).send({ error: "unauthorized" });
    if (activePluginBan("user", me.id)) return reply.code(403).send({ error: banMessage(), code: "plugin-banned" });
    if (!rateLimit(`plugin:dl:${me.id}`, 20, 60 * 60_000)) return reply.code(429).send({ error: "Too many downloads this hour." });

    const rel = currentRelease();
    const ws = currentOrgFor(me.id);
    const lid = randomUUID();
    const wm = watermarkFor(lid);
    const lic = issueLicense({ lid, wm, uid: me.id, email: me.email, org: ws.org.name, ver: rel.version });
    const bytes = buildPluginPackage({ licenseFile: lic.file, watermark: wm, apiBase: siteUrl(req) });
    createPluginDownload({ id: lid, wm, user_id: me.id, email: me.email, org_id: ws.org.id, version: rel.version, ip: req.ip ?? null });
    return reply
      .header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename="FactorialAdLab-${rel.version}.unitypackage"`)
      .header("X-AdLab-Licence", wm)
      .header("Cache-Control", "no-store")
      .send(Buffer.from(bytes));
  });

  /** The caller's own downloads (licence codes, versions, when each was last used). */
  app.get("/api/plugin/downloads", authed, async (req) => listPluginDownloadsFor(req.user!.id).map(downloadView));

  // ── admin: downloads, leak tracing, bans ──
  const admin = adminOnly();
  app.get<{ Querystring: { q?: string; shared?: string } }>("/api/admin/plugin/downloads", admin, async (req) =>
    listPluginDownloadsAdmin(req.query?.q ?? "", req.query?.shared === "1").map((d) => ({
      ...downloadView(d),
      userId: d.user_id,
      email: d.email,
      ip: d.ip,
      otherAccounts: d.other_accounts,
      requests: d.requests,
    })),
  );
  app.get<{ Params: { id: string } }>("/api/admin/plugin/downloads/:id", admin, async (req, reply) => {
    const d = getPluginDownload(req.params.id);
    if (!d) return reply.code(404).send({ error: "download not found" });
    return {
      id: d.id,
      wm: d.wm,
      email: d.email,
      version: d.version,
      createdAt: d.created_at,
      usage: pluginUsageFor(d.id).map((u) => ({ userId: u.user_id, email: u.email, firstSeen: u.first_seen, lastSeen: u.last_seen, version: u.last_version, requests: u.requests })),
    };
  });

  app.get<{ Querystring: { all?: string } }>("/api/plugin/bans", admin, async (req) =>
    listPluginBans(req.query?.all === "1").map((b) => ({
      id: b.id,
      scope: b.scope,
      target: b.target,
      targetLabel: b.target_label,
      reason: b.reason,
      createdAt: b.created_at,
      liftedAt: b.lifted_at,
    })),
  );

  /**
   * Ban a download (target = licence id or watermark code) or a user (target = user id or email).
   * Plugin requests from it are refused with 403 `plugin-banned`; a banned user also can't download.
   */
  app.post<{ Body: { scope?: string; target?: string; reason?: string } }>("/api/plugin/bans", admin, async (req, reply) => {
    const scope = req.body?.scope;
    const raw = String(req.body?.target ?? "").trim();
    const reason = String(req.body?.reason ?? "").trim().slice(0, 300) || null;
    if (scope !== "download" && scope !== "user") return reply.code(400).send({ error: 'scope must be "download" or "user"' });
    if (!raw) return reply.code(400).send({ error: "target required" });
    let target: string | undefined;
    if (scope === "download") target = getPluginDownload(raw)?.id;
    else {
      target = (getUserById(raw) ?? getUserByEmail(raw.toLowerCase()))?.id;
      if (target === req.user!.id) return reply.code(400).send({ error: "You can't ban yourself." });
    }
    if (!target) return reply.code(404).send({ error: scope === "download" ? "No download with that licence id or code." : "No user with that id or email." });
    if (activePluginBan(scope, target)) return reply.code(409).send({ error: "Already banned." });
    const b = createPluginBan(scope, target, reason, req.user!.id);
    return reply.code(201).send({ id: b.id, scope: b.scope, target: b.target, reason: b.reason, createdAt: b.created_at });
  });

  app.post<{ Params: { id: string } }>("/api/plugin/bans/:id/lift", admin, async (req, reply) =>
    liftPluginBan(req.params.id, req.user!.id) ? { lifted: true } : reply.code(404).send({ error: "no active ban with that id" }),
  );
}
