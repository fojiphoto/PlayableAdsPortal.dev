import { randomUUID } from "node:crypto";
import type { PackResult } from "@forge/packager";
import { db } from "./db.js";
import { blobStore } from "./blobstore.js";

const now = () => new Date().toISOString();

// ── binary data: inline in the row, or in the configured object store (gap #16) ──
const EMPTY = new Uint8Array(0);
/**
 * Keep `bytes` in the object store under `key` when one is configured. Returns what to write to the row:
 * the inline bytes (store off) or an empty inline column plus the key.
 */
async function stash(key: string, bytes: Uint8Array, contentType?: string): Promise<{ inline: Uint8Array; key: string | null }> {
  const store = blobStore();
  if (!store) return { inline: bytes, key: null };
  await store.put(key, bytes, contentType);
  return { inline: EMPTY, key };
}
/** A row's bytes: from the object store when it has a key, else the inline column. */
export async function loadBytes(key: string | null | undefined, inline: Uint8Array | null | undefined): Promise<Uint8Array> {
  if (!key) return inline ?? EMPTY;
  const store = blobStore();
  if (!store) throw new Error(`"${key}" lives in an object store but BLOB_STORE isn't configured on this server`);
  const bytes = await store.get(key);
  if (!bytes) throw new Error(`"${key}" is missing from the object store`);
  return bytes;
}
async function dropBlob(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await blobStore()?.delete(key);
  } catch (e) {
    console.warn(`[blobs] could not delete ${key}: ${(e as Error).message}`); // the orphan sweep retries
  }
}


// ── row types ────────────────────────────────────────────────────────────────
export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  plan: string;
  totp_secret: string | null;
  totp_enabled: number;
  totp_last_step: number | null;
  domain: string | null;
  domain_token: string | null;
  domain_verified: number;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan_status: string | null;
  email_verified: number;
  analytics_enabled: number;
  current_org_id: string | null;
  is_admin: number;
  last_login_at: string | null;
  email_verify_hash: string | null;
  email_verify_expires: string | null;
  plan_renews_at: string | null;
  plan_cancel_at_period_end: number;
  created_at: string;
}
export interface AppRow {
  id: string;
  user_id: string;
  org_id: string | null;
  name: string;
  platform: string | null;
  /** preloader kit override: a kit id, 'none' (no preloader), or null = the workspace default */
  kit_id: string | null;
  created_at: string;
}
export interface ConceptRow {
  id: string;
  app_id: string;
  name: string;
  network_order: string | null; // JSON array of network ids, or null = default order
  /** preloader kit override: a kit id, 'none', or null = inherit from the app */
  kit_id: string | null;
  created_at: string;
}
export interface CreativeRow {
  id: string;
  concept_id: string;
  name: string;
  entry: string;
  source_zip: Uint8Array;
  /** object-store key of the source (then `source_zip` is empty in the row) */
  source_key: string | null;
  options_json: string;
  created_at: string;
}
/** A creative without its source bytes (lists). */
export type CreativeMeta = Omit<CreativeRow, "source_zip">;
export interface ExportRow {
  id: string;
  creative_id: string;
  network: string;
  filename: string;
  format: string;
  size_bytes: number;
  max_size_bytes: number;
  ok: number;
  validation_json: string;
  bytes: Uint8Array;
  /** object-store key of the package (then `bytes` is empty in the row) */
  bytes_key: string | null;
  created_at: string;
}
/** An export without its package bytes (lists). */
export type ExportMeta = Omit<ExportRow, "bytes">;

// ── users ────────────────────────────────────────────────────────────────────
export async function createUser(email: string, passwordHash: string): Promise<UserRow> {
  const row: UserRow = {
    id: randomUUID(), email, password_hash: passwordHash, plan: "free",
    totp_secret: null, totp_enabled: 0, totp_last_step: null, domain: null, domain_token: null, domain_verified: 0,
    stripe_customer_id: null, stripe_subscription_id: null, plan_status: null,
    email_verified: 0, email_verify_hash: null, email_verify_expires: null,
    plan_renews_at: null, plan_cancel_at_period_end: 0, analytics_enabled: 1, current_org_id: null, is_admin: 0, last_login_at: null, created_at: now(),
  };
  await db()
    .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(row.id, row.email, row.password_hash, row.created_at);
  const org = await createOrg(row.id, defaultOrgName(email)); // everyone owns a personal workspace
  row.current_org_id = org.id;
  return row;
}
export async function getUserByEmail(email: string): Promise<UserRow | undefined> {
  return await db().prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
}
export async function getUserById(id: string): Promise<UserRow | undefined> {
  return await db().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export async function setUserPlan(id: string, plan: string): Promise<void> {
  await db().prepare("UPDATE users SET plan = ? WHERE id = ?").run(plan, id);
}

// ── Stripe billing ──
export async function setStripeCustomer(id: string, customerId: string): Promise<void> {
  await db().prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(customerId, id);
}

/** Set plan + subscription id/status (+ period end and cancel flag) together — from the webhook or a sync. */
export async function setUserBilling(
  id: string,
  plan: string,
  subscriptionId: string | null,
  status: string | null,
  details?: { renewsAt?: string | null; cancelAtPeriodEnd?: boolean },
): Promise<void> {
  if (details) {
    await db()
      .prepare(
        "UPDATE users SET plan = ?, stripe_subscription_id = ?, plan_status = ?, plan_renews_at = ?, plan_cancel_at_period_end = ? WHERE id = ?",
      )
      .run(plan, subscriptionId, status, details.renewsAt ?? null, details.cancelAtPeriodEnd ? 1 : 0, id);
  } else {
    await db()
      .prepare("UPDATE users SET plan = ?, stripe_subscription_id = ?, plan_status = ? WHERE id = ?")
      .run(plan, subscriptionId, status, id);
  }
}

export async function getUserByStripeCustomer(customerId: string): Promise<UserRow | undefined> {
  return await db().prepare("SELECT * FROM users WHERE stripe_customer_id = ?").get(customerId) as UserRow | undefined;
}

// ── email verification ──
export async function setEmailVerifyToken(id: string, hash: string, expiresIso: string): Promise<void> {
  await db().prepare("UPDATE users SET email_verify_hash = ?, email_verify_expires = ? WHERE id = ?").run(hash, expiresIso, id);
}
/** Mark the user whose pending token hash matches as verified; undefined if unknown/expired. */
export async function verifyEmailByHash(hash: string): Promise<UserRow | undefined> {
  const u = await db().prepare("SELECT * FROM users WHERE email_verify_hash = ?").get(hash) as UserRow | undefined;
  if (!u || !u.email_verify_expires || u.email_verify_expires < now()) return undefined;
  await db()
    .prepare("UPDATE users SET email_verified = 1, email_verify_hash = NULL, email_verify_expires = NULL WHERE id = ?")
    .run(u.id);
  return { ...u, email_verified: 1 };
}

// ── password resets (one-time, hashed, expiring) ──
export async function createPasswordReset(userId: string, tokenHash: string, expiresIso: string): Promise<void> {
  await db()
    .prepare("INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), userId, tokenHash, expiresIso, now());
}
export async function findActiveReset(tokenHash: string): Promise<{ id: string; user_id: string } | undefined> {
  return await db()
    .prepare("SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
    .get(tokenHash, now()) as { id: string; user_id: string } | undefined;
}
export async function consumeReset(id: string): Promise<void> {
  await db().prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").run(now(), id);
}

export async function updatePassword(id: string, passwordHash: string): Promise<void> {
  await db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
}

export async function setTotp(id: string, secret: string | null, enabled: number): Promise<void> {
  // reset the replay counter whenever the secret/enabled state changes
  await db().prepare("UPDATE users SET totp_secret = ?, totp_enabled = ?, totp_last_step = NULL WHERE id = ?").run(secret, enabled, id);
}

/** Record the last accepted TOTP time-step (replay guard: a step can't be reused). */
export async function setTotpLastStep(id: string, step: number): Promise<void> {
  await db().prepare("UPDATE users SET totp_last_step = ? WHERE id = ?").run(step, id);
}

export async function setUserDomain(id: string, domain: string, token: string): Promise<void> {
  await db().prepare("UPDATE users SET domain = ?, domain_token = ?, domain_verified = 0 WHERE id = ?").run(domain, token, id);
}

export async function setDomainVerified(id: string, verified: number): Promise<void> {
  await db().prepare("UPDATE users SET domain_verified = ? WHERE id = ?").run(verified, id);
}

export async function addExportUsage(userId: string, network: string): Promise<void> {
  await db()
    .prepare("INSERT INTO export_usage (id, user_id, network, created_at) VALUES (?, ?, ?, ?)")
    .run(randomUUID(), userId, network, now());
}

export async function countExportUsageSince(userId: string, sinceIso: string): Promise<number> {
  const row = await db()
    .prepare("SELECT COUNT(*) AS n FROM export_usage WHERE user_id = ? AND created_at >= ?")
    .get(userId, sinceIso) as { n: number } | undefined;
  return row?.n ?? 0;
}

export async function countExportUsage(userId: string): Promise<number> {
  const row = await db().prepare("SELECT COUNT(*) AS n FROM export_usage WHERE user_id = ?").get(userId) as { n: number } | undefined;
  return row?.n ?? 0;
}

export async function exportDaily(userId: string, sinceIso: string): Promise<{ d: string; n: number }[]> {
  return await db()
    .prepare(
      "SELECT substr(created_at,1,10) AS d, COUNT(*) AS n FROM export_usage WHERE user_id = ? AND created_at >= ? GROUP BY d ORDER BY d",
    )
    .all(userId, sinceIso) as unknown as { d: string; n: number }[];
}

export async function exportByNetwork(userId: string): Promise<{ network: string; n: number }[]> {
  return await db()
    .prepare("SELECT network, COUNT(*) AS n FROM export_usage WHERE user_id = ? GROUP BY network ORDER BY n DESC")
    .all(userId) as unknown as { network: string; n: number }[];
}

// ── apps ─────────────────────────────────────────────────────────────────────
/** Create an app in a workspace (`userId` = creator, kept for attribution). */
export async function createApp(userId: string, orgId: string, name: string, platform?: string): Promise<AppRow> {
  const row: AppRow = { id: randomUUID(), user_id: userId, org_id: orgId, name, platform: platform ?? null, kit_id: null, created_at: now() };
  await db()
    .prepare("INSERT INTO apps (id, user_id, org_id, name, platform, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, row.user_id, row.org_id, row.name, row.platform, row.created_at);
  return row;
}
/** Apps of the user's CURRENT workspace. */
export async function listApps(userId: string): Promise<AppRow[]> {
  return await db()
    .prepare("SELECT * FROM apps WHERE org_id = ? ORDER BY created_at DESC")
    .all((await currentOrgFor(userId)).org.id) as unknown as AppRow[];
}
/** An app in the user's current workspace (any role), else undefined. */
export async function getAppOwned(id: string, userId: string): Promise<AppRow | undefined> {
  return await db().prepare("SELECT * FROM apps WHERE id = ? AND org_id = ?").get(id, (await currentOrgFor(userId)).org.id) as AppRow | undefined;
}
/** Rename / re-platform an app the user can access. */
export async function updateApp(id: string, userId: string, patch: { name?: string; platform?: string | null }): Promise<boolean> {
  const a = await getAppOwned(id, userId);
  if (!a) return false;
  await db()
    .prepare("UPDATE apps SET name = ?, platform = ? WHERE id = ?")
    .run(patch.name ?? a.name, patch.platform === undefined ? a.platform : patch.platform, id);
  return true;
}
export async function deleteApp(id: string, userId: string): Promise<boolean> {
  return (await db().prepare("DELETE FROM apps WHERE id = ? AND org_id = ?").run(id, (await currentOrgFor(userId)).org.id)).changes > 0;
}

// ── concepts ─────────────────────────────────────────────────────────────────
export async function createConcept(appId: string, name: string): Promise<ConceptRow> {
  const row: ConceptRow = { id: randomUUID(), app_id: appId, name, network_order: null, kit_id: null, created_at: now() };
  await db()
    .prepare("INSERT INTO concepts (id, app_id, name, created_at) VALUES (?, ?, ?, ?)")
    .run(row.id, row.app_id, row.name, row.created_at);
  return row;
}
export async function listConcepts(appId: string): Promise<ConceptRow[]> {
  return await db().prepare("SELECT * FROM concepts WHERE app_id = ? ORDER BY created_at DESC").all(appId) as unknown as ConceptRow[];
}
export async function getConceptOwned(id: string, userId: string): Promise<ConceptRow | undefined> {
  return await db()
    .prepare("SELECT c.* FROM concepts c JOIN apps a ON a.id = c.app_id WHERE c.id = ? AND a.org_id = ?")
    .get(id, (await currentOrgFor(userId)).org.id) as ConceptRow | undefined;
}
/** Rename a concept and/or set its custom export network order (null = default). */
export async function updateConcept(
  id: string,
  userId: string,
  patch: { name?: string; networkOrder?: string[] | null },
): Promise<boolean> {
  const c = await getConceptOwned(id, userId);
  if (!c) return false;
  const order = patch.networkOrder === undefined ? c.network_order : patch.networkOrder ? JSON.stringify(patch.networkOrder) : null;
  await db().prepare("UPDATE concepts SET name = ?, network_order = ? WHERE id = ?").run(patch.name ?? c.name, order, id);
  return true;
}
export async function deleteConcept(id: string, userId: string): Promise<boolean> {
  return (
    (await db()
      .prepare("DELETE FROM concepts WHERE id = ? AND app_id IN (SELECT id FROM apps WHERE org_id = ?)")
      .run(id, (await currentOrgFor(userId)).org.id)).changes > 0
  );
}

// ── creatives ────────────────────────────────────────────────────────────────
export async function createCreative(args: {
  conceptId: string;
  name: string;
  entry: string;
  sourceZip: Uint8Array;
  optionsJson: string;
}): Promise<CreativeRow> {
  const id = randomUUID();
  const blob = await stash(`creatives/${id}/source.zip`, args.sourceZip, "application/zip");
  const row: CreativeRow = {
    id,
    concept_id: args.conceptId,
    name: args.name,
    entry: args.entry,
    source_zip: args.sourceZip,
    source_key: blob.key,
    options_json: args.optionsJson,
    created_at: now(),
  };
  await db()
    .prepare(
      "INSERT INTO creatives (id, concept_id, name, entry, source_zip, source_key, options_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(row.id, row.concept_id, row.name, row.entry, blob.inline, blob.key, row.options_json, row.created_at);
  return row;
}
const CREATIVE_META = "id, concept_id, name, entry, source_key, options_json, created_at";
async function withSource(cr: CreativeRow | undefined): Promise<CreativeRow | undefined> {
  if (cr) cr.source_zip = await loadBytes(cr.source_key, cr.source_zip);
  return cr;
}
export async function listCreatives(conceptId: string): Promise<CreativeMeta[]> {
  return await db()
    .prepare(`SELECT ${CREATIVE_META} FROM creatives WHERE concept_id = ? ORDER BY created_at DESC`)
    .all(conceptId) as unknown as CreativeMeta[];
}
export async function getCreativeOwned(id: string, userId: string): Promise<CreativeRow | undefined> {
  return withSource(await getCreativeOwnedMeta(id, userId));
}
/** Ownership-checked creative row without loading its source from the object store. */
async function getCreativeOwnedMeta(id: string, userId: string): Promise<CreativeRow | undefined> {
  return await db()
    .prepare(
      `SELECT cr.* FROM creatives cr
       JOIN concepts c ON c.id = cr.concept_id
       JOIN apps a ON a.id = c.app_id
       WHERE cr.id = ? AND a.org_id = ?`,
    )
    .get(id, (await currentOrgFor(userId)).org.id) as CreativeRow | undefined;
}
/** Rename a creative and/or replace its stored pack options (CTA / store URLs). */
export async function updateCreative(id: string, userId: string, patch: { name?: string; optionsJson?: string }): Promise<boolean> {
  const cr = await getCreativeOwnedMeta(id, userId);
  if (!cr) return false;
  await db()
    .prepare("UPDATE creatives SET name = ?, options_json = ? WHERE id = ?")
    .run(patch.name ?? cr.name, patch.optionsJson ?? cr.options_json, id);
  return true;
}
/** The workspace owner a creative belongs to — whose plan, domain verification, billing and quota apply. */
export async function creativeOwnerId(creativeId: string): Promise<string | undefined> {
  const row = await db()
    .prepare(
      `SELECT COALESCE(o.owner_user_id, a.user_id) AS uid
       FROM creatives cr JOIN concepts c ON c.id = cr.concept_id JOIN apps a ON a.id = c.app_id LEFT JOIN orgs o ON o.id = a.org_id
       WHERE cr.id = ?`,
    )
    .get(creativeId) as { uid: string } | undefined;
  return row?.uid;
}
/** Fetch a creative without an ownership check (for UUID-guarded download/preview). */
export async function getCreativeById(id: string): Promise<CreativeRow | undefined> {
  return withSource((await db().prepare("SELECT * FROM creatives WHERE id = ?").get(id)) as CreativeRow | undefined);
}
export async function deleteCreative(id: string, userId: string): Promise<boolean> {
  const cr = await getCreativeOwnedMeta(id, userId);
  if (!cr) return false;
  const keys = [cr.source_key, ...(await listExports(id)).map((e) => e.bytes_key)];
  const deleted = (await db()
    .prepare(
      `DELETE FROM creatives WHERE id = ? AND concept_id IN (
         SELECT c.id FROM concepts c JOIN apps a ON a.id = c.app_id WHERE a.org_id = ?)`,
    )
    .run(id, (await currentOrgFor(userId)).org.id)).changes > 0;
  if (deleted) for (const k of keys) await dropBlob(k);
  return deleted;
}

// ── exports ──────────────────────────────────────────────────────────────────
export async function upsertExport(creativeId: string, r: PackResult): Promise<void> {
  // one object per creative × network, overwritten by a re-export
  const blob = await stash(`exports/${creativeId}/${r.network}`, r.bytes, r.format === "zip" ? "application/zip" : "text/html");
  await db()
    .prepare(
      `INSERT INTO exports (id, creative_id, network, filename, format, size_bytes, max_size_bytes, ok, validation_json, bytes, bytes_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(creative_id, network) DO UPDATE SET
         filename=excluded.filename, format=excluded.format, size_bytes=excluded.size_bytes,
         max_size_bytes=excluded.max_size_bytes, ok=excluded.ok, validation_json=excluded.validation_json,
         bytes=excluded.bytes, bytes_key=excluded.bytes_key, created_at=excluded.created_at`,
    )
    .run(
      randomUUID(),
      creativeId,
      r.network,
      r.filename,
      r.format,
      r.sizeBytes,
      r.maxSizeBytes,
      r.ok ? 1 : 0,
      JSON.stringify(r.validation),
      Buffer.from(blob.inline),
      blob.key,
      now(),
    );
}
const EXPORT_META = "id, creative_id, network, filename, format, size_bytes, max_size_bytes, ok, validation_json, bytes_key, created_at";
/** A creative's exports, without package bytes (metadata for the dashboard and quota checks). */
export async function listExports(creativeId: string): Promise<ExportMeta[]> {
  return await db().prepare(`SELECT ${EXPORT_META} FROM exports WHERE creative_id = ?`).all(creativeId) as unknown as ExportMeta[];
}
/** A creative's exports including their bytes (download-all). */
export async function listExportsWithBytes(creativeId: string): Promise<ExportRow[]> {
  const rows = (await db().prepare("SELECT * FROM exports WHERE creative_id = ?").all(creativeId)) as unknown as ExportRow[];
  for (const r of rows) r.bytes = await loadBytes(r.bytes_key, r.bytes);
  return rows;
}
export async function getExport(creativeId: string, network: string): Promise<ExportRow | undefined> {
  const r = (await db().prepare("SELECT * FROM exports WHERE creative_id = ? AND network = ?").get(creativeId, network)) as ExportRow | undefined;
  if (r) r.bytes = await loadBytes(r.bytes_key, r.bytes);
  return r;
}

// ── organizations / workspaces / roles ──
export type OrgRole = "owner" | "admin" | "member" | "viewer";
export interface OrgRow {
  id: string;
  name: string;
  owner_user_id: string;
  default_kit_id: string | null;
  created_at: string;
}
export interface OrgMemberView {
  id: string;
  email: string;
  role: OrgRole;
  createdAt: string;
}
export interface OrgInviteRow {
  id: string;
  org_id: string;
  email: string;
  role: OrgRole;
  token_hash: string;
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

export const defaultOrgName = (email: string): string => `${email.split("@")[0] || "my"}'s workspace`;

/** Create a workspace owned by `ownerId` (also becomes their current workspace if they have none). */
export async function createOrg(ownerId: string, name: string): Promise<OrgRow> {
  const row: OrgRow = { id: randomUUID(), name, owner_user_id: ownerId, default_kit_id: null, created_at: now() };
  const d = db();
  await d.prepare("INSERT INTO orgs (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)").run(row.id, row.name, row.owner_user_id, row.created_at);
  await d.prepare("INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(row.id, ownerId, now());
  await d.prepare("UPDATE users SET current_org_id = ? WHERE id = ? AND current_org_id IS NULL").run(row.id, ownerId);
  return row;
}
export async function getOrg(id: string): Promise<OrgRow | undefined> {
  return await db().prepare("SELECT * FROM orgs WHERE id = ?").get(id) as OrgRow | undefined;
}
export async function renameOrg(id: string, name: string): Promise<void> {
  await db().prepare("UPDATE orgs SET name = ? WHERE id = ?").run(name, id);
}
export async function getRole(orgId: string, userId: string): Promise<OrgRole | undefined> {
  const r = await db().prepare("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?").get(orgId, userId) as { role: OrgRole } | undefined;
  return r?.role;
}
export async function listUserOrgs(userId: string): Promise<(OrgRow & { role: OrgRole; member_count: number; owner_email: string })[]> {
  return await db()
    .prepare(
      `SELECT o.*, m.role AS role, u.email AS owner_email,
              (SELECT COUNT(*) FROM org_members x WHERE x.org_id = o.id) AS member_count
       FROM org_members m JOIN orgs o ON o.id = m.org_id JOIN users u ON u.id = o.owner_user_id
       WHERE m.user_id = ? ORDER BY o.created_at`,
    )
    .all(userId) as unknown as (OrgRow & { role: OrgRole; member_count: number; owner_email: string })[];
}
/**
 * The user's current workspace + their role in it. Self-healing: a missing or stale pointer falls
 * back to the first workspace they belong to, and a user with none gets a personal one.
 */
export async function currentOrgFor(userId: string): Promise<{ org: OrgRow; role: OrgRole }> {
  const u = await getUserById(userId);
  if (!u) throw new Error("user not found");
  if (u.current_org_id) {
    const role = await getRole(u.current_org_id, userId);
    const org = await getOrg(u.current_org_id);
    if (org && role) return { org, role };
  }
  const first = (await listUserOrgs(userId))[0];
  if (first) {
    await db().prepare("UPDATE users SET current_org_id = ? WHERE id = ?").run(first.id, userId);
    return { org: (await getOrg(first.id))!, role: first.role };
  }
  const org = await createOrg(userId, defaultOrgName(u.email));
  await db().prepare("UPDATE users SET current_org_id = ? WHERE id = ?").run(org.id, userId);
  return { org, role: "owner" };
}
export async function setCurrentOrg(userId: string, orgId: string): Promise<boolean> {
  if (!await getRole(orgId, userId)) return false;
  await db().prepare("UPDATE users SET current_org_id = ? WHERE id = ?").run(orgId, userId);
  return true;
}
export async function listOrgMembers(orgId: string): Promise<OrgMemberView[]> {
  return await db()
    .prepare(
      `SELECT u.id AS id, u.email AS email, m.role AS role, m.created_at AS "createdAt"
       FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, m.created_at`,
    )
    .all(orgId) as unknown as OrgMemberView[];
}
export async function upsertOrgMember(orgId: string, userId: string, role: OrgRole): Promise<void> {
  await db()
    .prepare(
      `INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role`,
    )
    .run(orgId, userId, role, now());
}
export async function removeOrgMember(orgId: string, userId: string): Promise<boolean> {
  const d = db();
  const changed = (await d.prepare("DELETE FROM org_members WHERE org_id = ? AND user_id = ?").run(orgId, userId)).changes > 0;
  await d.prepare("UPDATE users SET current_org_id = NULL WHERE id = ? AND current_org_id = ?").run(userId, orgId);
  return changed;
}
export async function transferOrgOwnership(orgId: string, newOwnerId: string): Promise<void> {
  const d = db();
  const org = await getOrg(orgId);
  if (!org) return;
  await d.prepare("UPDATE orgs SET owner_user_id = ? WHERE id = ?").run(newOwnerId, orgId);
  await d.prepare("UPDATE org_members SET role = 'admin' WHERE org_id = ? AND user_id = ?").run(orgId, org.owner_user_id);
  await d.prepare("UPDATE org_members SET role = 'owner' WHERE org_id = ? AND user_id = ?").run(orgId, newOwnerId);
}
export async function createOrgInvite(orgId: string, email: string, role: OrgRole, tokenHash: string, invitedBy: string, expiresIso: string): Promise<OrgInviteRow> {
  const row: OrgInviteRow = { id: randomUUID(), org_id: orgId, email, role, token_hash: tokenHash, invited_by: invitedBy, expires_at: expiresIso, accepted_at: null, created_at: now() };
  await db()
    .prepare("INSERT INTO org_invites (id, org_id, email, role, token_hash, invited_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.org_id, row.email, row.role, row.token_hash, row.invited_by, row.expires_at, row.created_at);
  return row;
}
export async function findInviteByHash(hash: string): Promise<(OrgInviteRow & { org_name: string }) | undefined> {
  return await db()
    .prepare("SELECT i.*, o.name AS org_name FROM org_invites i JOIN orgs o ON o.id = i.org_id WHERE i.token_hash = ?")
    .get(hash) as (OrgInviteRow & { org_name: string }) | undefined;
}
/** Pending (unaccepted, unexpired) invites of a workspace. */
export async function listOrgInvites(orgId: string): Promise<OrgInviteRow[]> {
  return await db()
    .prepare("SELECT * FROM org_invites WHERE org_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC")
    .all(orgId, now()) as unknown as OrgInviteRow[];
}
export async function deleteInvite(id: string, orgId: string): Promise<boolean> {
  return (await db().prepare("DELETE FROM org_invites WHERE id = ? AND org_id = ?").run(id, orgId)).changes > 0;
}
export async function markInviteAccepted(id: string): Promise<void> {
  await db().prepare("UPDATE org_invites SET accepted_at = ? WHERE id = ?").run(now(), id);
}

// ── preloader kits ───────────────────────────────────────────────────────────
/** Sentinel for apps.kit_id / concepts.kit_id: explicitly no preloader. */
export const NO_KIT = "none";
export interface KitRow {
  id: string;
  org_id: string;
  name: string;
  template: string;
  bg: string | null;
  accent: string | null;
  text: string | null;
  show_percent: number;
  logo: Uint8Array | null;
  logo_mime: string | null;
  /** object-store key of the logo (then `logo` is NULL in the row) */
  logo_key: string | null;
  created_at: string;
  updated_at: string;
}
export interface KitFields {
  name: string;
  template: string;
  bg: string | null;
  accent: string | null;
  text: string | null;
  showPercent: boolean;
  /** undefined = keep, null = remove */
  logo?: Uint8Array | null;
  logoMime?: string | null;
}

async function withLogo(k: KitRow): Promise<KitRow> {
  if (k.logo_key) k.logo = await loadBytes(k.logo_key, null);
  return k;
}
export async function listKits(orgId: string): Promise<KitRow[]> {
  const rows = (await db().prepare("SELECT * FROM preloader_kits WHERE org_id = ? ORDER BY created_at").all(orgId)) as unknown as KitRow[];
  return Promise.all(rows.map(withLogo));
}
/** The kit row as stored (logo not loaded from the object store). */
async function getKitRaw(id: string, orgId: string): Promise<KitRow | undefined> {
  return (await db().prepare("SELECT * FROM preloader_kits WHERE id = ? AND org_id = ?").get(id, orgId)) as KitRow | undefined;
}
export async function getKit(id: string, orgId: string): Promise<KitRow | undefined> {
  const k = await getKitRaw(id, orgId);
  return k && withLogo(k);
}
export async function createKit(orgId: string, f: KitFields): Promise<KitRow> {
  const id = randomUUID();
  const t = now();
  const blob = f.logo ? await stash(`kits/${id}/logo`, f.logo, f.logoMime ?? undefined) : null;
  await db()
    .prepare(
      "INSERT INTO preloader_kits (id, org_id, name, template, bg, accent, text, show_percent, logo, logo_mime, logo_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id, orgId, f.name, f.template, f.bg, f.accent, f.text, f.showPercent ? 1 : 0,
      blob && !blob.key ? Buffer.from(blob.inline) : null, f.logo ? (f.logoMime ?? null) : null, blob?.key ?? null, t, t,
    );
  return (await getKit(id, orgId))!;
}
export async function updateKit(id: string, orgId: string, f: Partial<KitFields>): Promise<KitRow | undefined> {
  const k = await getKitRaw(id, orgId);
  if (!k) return undefined;
  // logo: undefined keeps the stored one (inline or keyed) untouched; null removes it; bytes replace it
  let logo: Uint8Array | null = k.logo;
  let logoKey = k.logo_key;
  if (f.logo === null) {
    await dropBlob(k.logo_key);
    logo = null;
    logoKey = null;
  } else if (f.logo) {
    const blob = await stash(`kits/${id}/logo`, f.logo, f.logoMime ?? undefined);
    logo = blob.key ? null : blob.inline;
    logoKey = blob.key;
  }
  const mime = f.logo === undefined ? k.logo_mime : f.logo ? (f.logoMime ?? null) : null;
  await db()
    .prepare(
      "UPDATE preloader_kits SET name = ?, template = ?, bg = ?, accent = ?, text = ?, show_percent = ?, logo = ?, logo_mime = ?, logo_key = ?, updated_at = ? WHERE id = ?",
    )
    .run(
      f.name ?? k.name,
      f.template ?? k.template,
      f.bg === undefined ? k.bg : f.bg,
      f.accent === undefined ? k.accent : f.accent,
      f.text === undefined ? k.text : f.text,
      f.showPercent === undefined ? k.show_percent : f.showPercent ? 1 : 0,
      logo ? Buffer.from(logo) : null,
      mime,
      logoKey,
      now(),
      id,
    );
  return await getKit(id, orgId);
}
/** Delete a kit; anything that pointed at it falls back to inheriting (and the default is cleared). */
export async function deleteKit(id: string, orgId: string): Promise<boolean> {
  const d = db();
  const k = await getKitRaw(id, orgId);
  if (!k) return false;
  await dropBlob(k.logo_key);
  await d.prepare("UPDATE orgs SET default_kit_id = NULL WHERE id = ? AND default_kit_id = ?").run(orgId, id);
  await d.prepare("UPDATE apps SET kit_id = NULL WHERE org_id = ? AND kit_id = ?").run(orgId, id);
  await d.prepare("UPDATE concepts SET kit_id = NULL WHERE kit_id = ? AND app_id IN (SELECT id FROM apps WHERE org_id = ?)").run(id, orgId);
  return (await d.prepare("DELETE FROM preloader_kits WHERE id = ? AND org_id = ?").run(id, orgId)).changes > 0;
}
export async function setDefaultKit(orgId: string, kitId: string | null): Promise<void> {
  await db().prepare("UPDATE orgs SET default_kit_id = ? WHERE id = ?").run(kitId, orgId);
}
export async function setAppKit(appId: string, kitId: string | null): Promise<void> {
  await db().prepare("UPDATE apps SET kit_id = ? WHERE id = ?").run(kitId, appId);
}
export async function setConceptKit(conceptId: string, kitId: string | null): Promise<void> {
  await db().prepare("UPDATE concepts SET kit_id = ? WHERE id = ?").run(kitId, conceptId);
}
/** Every app and concept of a workspace with its kit override, for the kit assignment table. */
export async function kitAssignments(orgId: string): Promise<{
  apps: { id: string; name: string; kit_id: string | null }[];
  concepts: { id: string; name: string; app_id: string; kit_id: string | null }[];
}> {
  const d = db();
  return {
    apps: await d.prepare("SELECT id, name, kit_id FROM apps WHERE org_id = ? ORDER BY created_at").all(orgId) as never,
    concepts: await d
      .prepare("SELECT c.id, c.name, c.app_id, c.kit_id FROM concepts c JOIN apps a ON a.id = c.app_id WHERE a.org_id = ? ORDER BY c.created_at")
      .all(orgId) as never,
  };
}

export type KitSource = "concept" | "app" | "workspace";
/**
 * The kit an export of this concept uses: concept override, then app override, then workspace default.
 * `kit: null` with a source means that level explicitly chose no preloader.
 */
export async function resolveKit(conceptId: string): Promise<{ kit: KitRow | null; source: KitSource | null }> {
  const d = db();
  const row = await d
    .prepare(
      "SELECT c.kit_id AS ck, a.kit_id AS ak, o.default_kit_id AS dk, a.org_id AS org FROM concepts c JOIN apps a ON a.id = c.app_id JOIN orgs o ON o.id = a.org_id WHERE c.id = ?",
    )
    .get(conceptId) as { ck: string | null; ak: string | null; dk: string | null; org: string } | undefined;
  if (!row) return { kit: null, source: null };
  const [id, source]: [string | null, KitSource | null] = row.ck
    ? [row.ck, "concept"]
    : row.ak
      ? [row.ak, "app"]
      : row.dk
        ? [row.dk, "workspace"]
        : [null, null];
  if (!id || id === NO_KIT) return { kit: null, source };
  return { kit: await getKit(id, row.org) ?? null, source };
}

// ── jobs (async work queue: export today, capture/compiler later) ─────────────
export type JobStatus = "queued" | "running" | "done" | "failed";
export interface JobRow {
  id: string;
  user_id: string;
  kind: string;
  status: JobStatus;
  payload_json: string;
  result_json: string | null;
  error: string | null;
  progress: number;
  progress_label: string | null;
  attempts: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export async function createJob(userId: string, kind: string, payload: unknown): Promise<JobRow> {
  const id = randomUUID();
  await db()
    .prepare("INSERT INTO jobs (id, user_id, kind, status, payload_json, created_at) VALUES (?, ?, ?, 'queued', ?, ?)")
    .run(id, userId, kind, JSON.stringify(payload ?? {}), now());
  return (await getJob(id))!;
}
export async function getJob(id: string): Promise<JobRow | undefined> {
  return await db().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
}
export async function getJobOwned(id: string, userId: string): Promise<JobRow | undefined> {
  return await db().prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").get(id, userId) as JobRow | undefined;
}
export async function listJobs(userId: string, limit = 20): Promise<JobRow[]> {
  return await db()
    .prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(userId, Math.max(1, Math.min(100, limit))) as unknown as JobRow[];
}
/** Atomically move the oldest queued job to `running` and return it (undefined when the queue is empty). */
export async function claimNextJob(): Promise<JobRow | undefined> {
  const d = db();
  const next = await d.prepare("SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  if (!next) return undefined;
  const r = await d
    .prepare("UPDATE jobs SET status = 'running', started_at = ?, heartbeat_at = ?, attempts = attempts + 1, progress = 0, progress_label = NULL WHERE id = ? AND status = 'queued'")
    .run(now(), now(), next.id);
  return r.changes === 1 ? await getJob(next.id) : undefined;
}
export async function setJobProgress(id: string, progress: number, label?: string | null): Promise<void> {
  await db()
    .prepare("UPDATE jobs SET progress = ?, progress_label = ?, heartbeat_at = ? WHERE id = ? AND status = 'running'")
    .run(Math.max(0, Math.min(100, Math.round(progress))), label ?? null, now(), id);
}
/** A running job is still being worked on (so no other instance recovers it). */
export async function heartbeatJob(id: string): Promise<void> {
  await db().prepare("UPDATE jobs SET heartbeat_at = ? WHERE id = ? AND status = 'running'").run(now(), id);
}
export async function completeJob(id: string, result: unknown): Promise<void> {
  await db()
    .prepare("UPDATE jobs SET status = 'done', progress = 100, progress_label = NULL, result_json = ?, finished_at = ? WHERE id = ?")
    .run(JSON.stringify(result ?? null), now(), id);
}
export async function failJob(id: string, error: string): Promise<void> {
  await db()
    .prepare("UPDATE jobs SET status = 'failed', progress_label = NULL, error = ?, finished_at = ? WHERE id = ?")
    .run(error.slice(0, 500), now(), id);
}
/**
 * Boot-time recovery: jobs left `running` by a crashed/restarted process go back to the queue,
 * or fail permanently once they have been attempted `maxAttempts` times. Returns how many moved.
 */
export async function recoverStaleJobs(maxAttempts = 2, staleMs = 0): Promise<number> {
  // staleMs = 0: every running job is abandoned (single instance, at boot). With several instances
  // only jobs whose worker stopped heart-beating are taken back, so live work is never stolen.
  const cutoff = new Date(Date.now() - staleMs).toISOString();
  const d = db();
  const stale = "status = 'running' AND COALESCE(heartbeat_at, started_at, created_at) <= ?";
  const failed = (await d
    .prepare(`UPDATE jobs SET status = 'failed', error = 'Interrupted by a server restart', finished_at = ? WHERE ${stale} AND attempts >= ?`)
    .run(now(), cutoff, maxAttempts)).changes;
  const requeued = (await d.prepare(`UPDATE jobs SET status = 'queued', started_at = NULL, heartbeat_at = NULL WHERE ${stale}`).run(cutoff)).changes;
  return Number(failed) + Number(requeued);
}
/** Housekeeping: drop finished jobs older than `olderThanIso` (results are already persisted as exports). */
export async function pruneJobs(olderThanIso: string): Promise<number> {
  return Number((await db().prepare("DELETE FROM jobs WHERE status IN ('done','failed') AND finished_at < ?").run(olderThanIso)).changes);
}

export async function setAnalyticsEnabled(userId: string, enabled: boolean): Promise<void> {
  await db().prepare("UPDATE users SET analytics_enabled = ? WHERE id = ?").run(enabled ? 1 : 0, userId);
}

// ── in-playable analytics events ─────────────────────────────────────────────
export const EVENT_KINDS = ["impression", "engage", "start", "complete", "cta", "custom"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const isEventKind = (s: string): s is EventKind => (EVENT_KINDS as readonly string[]).includes(s);

/** Existence check for the public collector (no ownership — the creative UUID is the capability). */
export async function creativeExists(id: string): Promise<boolean> {
  return !!await db().prepare("SELECT 1 FROM creatives WHERE id = ?").get(id);
}

export async function insertEvent(creativeId: string, network: string, event: EventKind, session: string, name: string | null, preview: boolean, value: number | null = null): Promise<void> {
  await db()
    .prepare("INSERT INTO events (id, creative_id, network, event, name, session, preview, value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), creativeId, network, event, name, session, preview ? 1 : 0, value, now());
}

/** Shared FROM/WHERE for event aggregates scoped to the user's current workspace. */
async function eventScope(userId: string, sinceIso: string, includePreview: boolean, creativeId?: string) {
  const where = ["a.org_id = ?", "ev.created_at >= ?"];
  const params: unknown[] = [(await currentOrgFor(userId)).org.id, sinceIso];
  if (!includePreview) where.push("ev.preview = 0");
  if (creativeId) {
    where.push("ev.creative_id = ?");
    params.push(creativeId);
  }
  return {
    sql: `FROM events ev JOIN creatives cr ON cr.id = ev.creative_id JOIN concepts c ON c.id = cr.concept_id JOIN apps a ON a.id = c.app_id WHERE ${where.join(" AND ")}`,
    params,
  };
}
const FUNNEL_COLS = `
  COUNT(DISTINCT CASE WHEN ev.event = 'impression' THEN ev.session END) AS impressions,
  COUNT(DISTINCT CASE WHEN ev.event = 'engage' THEN ev.session END) AS engages,
  COUNT(DISTINCT CASE WHEN ev.event = 'start' THEN ev.session END) AS starts,
  COUNT(DISTINCT CASE WHEN ev.event = 'complete' THEN ev.session END) AS completes,
  COUNT(DISTINCT CASE WHEN ev.event = 'cta' THEN ev.session END) AS ctas`;

export interface FunnelCounts {
  impressions: number;
  engages: number;
  starts: number;
  completes: number;
  ctas: number;
}
export async function eventFunnel(userId: string, sinceIso: string, includePreview = false, creativeId?: string): Promise<FunnelCounts> {
  const { sql, params } = await eventScope(userId, sinceIso, includePreview, creativeId);
  return await db().prepare(`SELECT ${FUNNEL_COLS} ${sql}`).get(...(params as never[])) as unknown as FunnelCounts;
}
export async function eventDaily(userId: string, sinceIso: string, includePreview = false, creativeId?: string): Promise<(FunnelCounts & { d: string })[]> {
  const { sql, params } = await eventScope(userId, sinceIso, includePreview, creativeId);
  return await db()
    .prepare(`SELECT substr(ev.created_at,1,10) AS d, ${FUNNEL_COLS} ${sql} GROUP BY d ORDER BY d`)
    .all(...(params as never[])) as unknown as (FunnelCounts & { d: string })[];
}
export async function eventByNetwork(userId: string, sinceIso: string, includePreview = false, creativeId?: string): Promise<(FunnelCounts & { network: string })[]> {
  const { sql, params } = await eventScope(userId, sinceIso, includePreview, creativeId);
  return await db()
    .prepare(`SELECT ev.network, ${FUNNEL_COLS} ${sql} GROUP BY ev.network ORDER BY impressions DESC`)
    .all(...(params as never[])) as unknown as (FunnelCounts & { network: string })[];
}
export async function eventByCreative(
  userId: string,
  sinceIso: string,
  includePreview = false,
): Promise<(FunnelCounts & { creative_id: string; creative: string; concept: string; app: string })[]> {
  const { sql, params } = await eventScope(userId, sinceIso, includePreview);
  return await db()
    .prepare(`SELECT ev.creative_id, cr.name AS creative, c.name AS concept, a.name AS app, ${FUNNEL_COLS} ${sql} GROUP BY ev.creative_id, cr.name, c.name, a.name ORDER BY impressions DESC LIMIT 50`)
    .all(...(params as never[])) as unknown as (FunnelCounts & { creative_id: string; creative: string; concept: string; app: string })[];
}
export async function customEvents(userId: string, sinceIso: string, includePreview = false, creativeId?: string, limit = 25): Promise<{ name: string; hits: number; sessions: number; total: number | null }[]> {
  const { sql, params } = await eventScope(userId, sinceIso, includePreview, creativeId);
  return await db()
    .prepare(`SELECT ev.name AS name, COUNT(*) AS hits, COUNT(DISTINCT ev.session) AS sessions, SUM(ev.value) AS total ${sql} AND ev.event = 'custom' AND ev.name IS NOT NULL GROUP BY ev.name ORDER BY hits DESC LIMIT ?`)
    .all(...(params as never[]), limit) as unknown as { name: string; hits: number; sessions: number; total: number | null }[];
}
/** Housekeeping: raw events older than `olderThanIso` are dropped (dashboards look back 90 days at most). */
export async function pruneEvents(olderThanIso: string): Promise<number> {
  return Number((await db().prepare("DELETE FROM events WHERE created_at < ?").run(olderThanIso)).changes);
}

// ── raw uploads awaiting a job (compile inputs; deleted once the job finishes) ──
export interface UploadRow {
  id: string;
  user_id: string;
  filename: string;
  bytes: Uint8Array;
  bytes_key: string | null;
  created_at: string;
}
export async function createUpload(userId: string, filename: string, bytes: Uint8Array): Promise<string> {
  const id = randomUUID();
  const blob = await stash(`uploads/${id}`, bytes, "application/zip");
  await db()
    .prepare("INSERT INTO uploads (id, user_id, filename, bytes, bytes_key, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, userId, filename, blob.inline, blob.key, now());
  return id;
}
export async function getUpload(id: string): Promise<UploadRow | undefined> {
  const u = (await db().prepare("SELECT * FROM uploads WHERE id = ?").get(id)) as UploadRow | undefined;
  if (u) u.bytes = await loadBytes(u.bytes_key, u.bytes);
  return u;
}
export async function deleteUpload(id: string): Promise<void> {
  const row = (await db().prepare("SELECT bytes_key FROM uploads WHERE id = ?").get(id)) as { bytes_key: string | null } | undefined;
  await db().prepare("DELETE FROM uploads WHERE id = ?").run(id);
  await dropBlob(row?.bytes_key);
}
/** Orphaned inputs (job never ran) are dropped after a day. */
export async function pruneUploads(olderThanIso: string): Promise<number> {
  const keys = (await db().prepare("SELECT bytes_key FROM uploads WHERE created_at < ? AND bytes_key IS NOT NULL").all(olderThanIso)) as { bytes_key: string }[];
  const n = Number((await db().prepare("DELETE FROM uploads WHERE created_at < ?").run(olderThanIso)).changes);
  for (const k of keys) await dropBlob(k.bytes_key);
  return n;
}

/** Every object-store key the database still references (for the orphan sweep and migrations). */
export async function referencedBlobKeys(): Promise<Set<string>> {
  const d = db();
  const keys = new Set<string>();
  for (const [table, col] of [["creatives", "source_key"], ["exports", "bytes_key"], ["uploads", "bytes_key"], ["preloader_kits", "logo_key"]] as const)
    for (const r of (await d.prepare(`SELECT ${col} AS k FROM ${table} WHERE ${col} IS NOT NULL`).all()) as { k: string }[]) keys.add(r.k);
  return keys;
}

// ── admin / ops ───────────────────────────────────────────────────────────────
export async function setAdmin(id: string, admin: boolean): Promise<void> {
  await db().prepare("UPDATE users SET is_admin = ? WHERE id = ?").run(admin ? 1 : 0, id);
}
export async function setLastLogin(id: string): Promise<void> {
  await db().prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(now(), id);
}
export async function deleteUserAdmin(id: string): Promise<boolean> {
  const d = db();
  // workspaces they own go with them (cascades to apps/creatives/exports/events)
  await d.prepare("DELETE FROM orgs WHERE owner_user_id = ?").run(id);
  return (await d.prepare("DELETE FROM users WHERE id = ?").run(id)).changes > 0;
}
export async function adminStats() {
  const d = db();
  const one = async (sql: string, ...p: unknown[]) => Number(((await d.prepare(sql).get(...p)) as { n: number }).n);
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  return {
    users: await one("SELECT COUNT(*) n FROM users"),
    usersThisWeek: await one("SELECT COUNT(*) n FROM users WHERE created_at >= ?", weekAgo),
    paidUsers: await one("SELECT COUNT(*) n FROM users WHERE plan NOT IN ('free')"),
    workspaces: await one("SELECT COUNT(*) n FROM orgs"),
    apps: await one("SELECT COUNT(*) n FROM apps"),
    creatives: await one("SELECT COUNT(*) n FROM creatives"),
    exports30d: await one("SELECT COUNT(*) n FROM export_usage WHERE created_at >= ?", monthAgo),
    playsToday: await one("SELECT COUNT(DISTINCT session) n FROM events WHERE event = 'impression' AND preview = 0 AND created_at >= ?", dayAgo),
    jobsFailed7d: await one("SELECT COUNT(*) n FROM jobs WHERE status = 'failed' AND created_at >= ?", weekAgo),
    jobsQueued: await one("SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running')"),
    openThreads: await one("SELECT COUNT(*) n FROM support_threads WHERE status = 'open'"),
    unreadThreads: await one("SELECT COUNT(*) n FROM support_threads WHERE admin_unread > 0"),
    openBugs: await one("SELECT COUNT(*) n FROM feedback_bugs WHERE handled_at IS NULL"),
    openContacts: await one("SELECT COUNT(*) n FROM contact_messages WHERE handled_at IS NULL"),
    pluginDownloads30d: await one("SELECT COUNT(*) n FROM plugin_downloads WHERE created_at >= ?", monthAgo),
    pluginBans: await one("SELECT COUNT(*) n FROM plugin_bans WHERE lifted_at IS NULL"),
  };
}
export interface AdminUserRow extends UserRow {
  org_name: string | null;
  exports_30d: number;
  creatives: number;
}
export async function listUsersAdmin(q: string, limit = 50): Promise<AdminUserRow[]> {
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  return await db()
    .prepare(
      `SELECT u.*, o.name AS org_name,
              (SELECT COUNT(*) FROM export_usage x WHERE x.user_id = u.id AND x.created_at >= ?) AS exports_30d,
              (SELECT COUNT(*) FROM creatives cr JOIN concepts c ON c.id = cr.concept_id JOIN apps a ON a.id = c.app_id JOIN orgs oo ON oo.id = a.org_id WHERE oo.owner_user_id = u.id) AS creatives
       FROM users u LEFT JOIN orgs o ON o.id = u.current_org_id
       WHERE (CAST(? AS TEXT) = '' OR lower(u.email) LIKE lower(?))
       ORDER BY u.created_at DESC LIMIT ?`,
    )
    .all(monthAgo, q, `%${q}%`, limit) as unknown as AdminUserRow[];
}
export async function recentLogins(limit = 50): Promise<UserRow[]> {
  return await db().prepare("SELECT * FROM users WHERE last_login_at IS NOT NULL ORDER BY last_login_at DESC LIMIT ?").all(limit) as unknown as UserRow[];
}
export async function listJobsAdmin(status: string | undefined, limit = 50): Promise<(JobRow & { user_email: string | null })[]> {
  return await db()
    .prepare(
      `SELECT j.*, u.email AS user_email FROM jobs j LEFT JOIN users u ON u.id = j.user_id
       WHERE (CAST(? AS TEXT) IS NULL OR j.status = ?) ORDER BY j.created_at DESC LIMIT ?`,
    )
    .all(status ?? null, status ?? null, limit) as unknown as (JobRow & { user_email: string | null })[];
}

// ── support threads ──
export interface ThreadRow {
  id: string;
  org_id: string;
  user_id: string;
  subject: string;
  status: "open" | "closed";
  user_unread: number;
  admin_unread: number;
  created_at: string;
  updated_at: string;
}
export interface MessageRow {
  id: string;
  thread_id: string;
  author_user_id: string;
  is_admin: number;
  body: string;
  created_at: string;
}
export async function createThread(orgId: string, userId: string, subject: string): Promise<ThreadRow> {
  const t = now();
  const row: ThreadRow = { id: randomUUID(), org_id: orgId, user_id: userId, subject, status: "open", user_unread: 0, admin_unread: 0, created_at: t, updated_at: t };
  await db()
    .prepare("INSERT INTO support_threads (id, org_id, user_id, subject, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'open', ?, ?)")
    .run(row.id, orgId, userId, subject, t, t);
  return row;
}
export async function getThread(id: string): Promise<ThreadRow | undefined> {
  return await db().prepare("SELECT * FROM support_threads WHERE id = ?").get(id) as ThreadRow | undefined;
}
export async function addMessage(threadId: string, authorId: string, isAdmin: boolean, body: string): Promise<MessageRow> {
  const row: MessageRow = { id: randomUUID(), thread_id: threadId, author_user_id: authorId, is_admin: isAdmin ? 1 : 0, body, created_at: now() };
  const d = db();
  await d.prepare("INSERT INTO support_messages (id, thread_id, author_user_id, is_admin, body, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(row.id, threadId, authorId, row.is_admin, body, row.created_at);
  await d.prepare(`UPDATE support_threads SET updated_at = ?, ${isAdmin ? "user_unread = user_unread + 1" : "admin_unread = admin_unread + 1"} WHERE id = ?`).run(row.created_at, threadId);
  return row;
}
export async function listMessages(threadId: string): Promise<MessageRow[]> {
  return await db().prepare("SELECT * FROM support_messages WHERE thread_id = ? ORDER BY created_at").all(threadId) as unknown as MessageRow[];
}
export async function listThreadsForOrg(orgId: string): Promise<ThreadRow[]> {
  return await db().prepare("SELECT * FROM support_threads WHERE org_id = ? ORDER BY updated_at DESC").all(orgId) as unknown as ThreadRow[];
}
export async function unreadForOrg(orgId: string): Promise<number> {
  return Number((await db().prepare("SELECT COALESCE(SUM(user_unread),0) n FROM support_threads WHERE org_id = ?").get(orgId) as { n: number }).n);
}
export async function markThreadRead(id: string, byAdmin: boolean): Promise<void> {
  await db().prepare(`UPDATE support_threads SET ${byAdmin ? "admin_unread" : "user_unread"} = 0 WHERE id = ?`).run(id);
}
export async function setThreadStatus(id: string, status: "open" | "closed"): Promise<void> {
  await db().prepare("UPDATE support_threads SET status = ?, updated_at = ? WHERE id = ?").run(status, now(), id);
}
export async function listThreadsAdmin(status?: "open" | "closed"): Promise<(ThreadRow & { user_email: string | null; org_name: string | null; plan: string | null })[]> {
  return await db()
    .prepare(
      `SELECT t.*, u.email AS user_email, o.name AS org_name, ou.plan AS plan
       FROM support_threads t LEFT JOIN users u ON u.id = t.user_id LEFT JOIN orgs o ON o.id = t.org_id LEFT JOIN users ou ON ou.id = o.owner_user_id
       WHERE (CAST(? AS TEXT) IS NULL OR t.status = ?) ORDER BY t.admin_unread DESC, t.updated_at DESC LIMIT 200`,
    )
    .all(status ?? null, status ?? null) as unknown as (ThreadRow & { user_email: string | null; org_name: string | null; plan: string | null })[];
}

// ── bug reports + contact form ──
export interface BugRow {
  id: string;
  org_id: string;
  user_id: string;
  title: string;
  body: string;
  page: string | null;
  handled_at: string | null;
  created_at: string;
}
export async function createBug(orgId: string, userId: string, title: string, body: string, page: string | null): Promise<BugRow> {
  const row: BugRow = { id: randomUUID(), org_id: orgId, user_id: userId, title, body, page, handled_at: null, created_at: now() };
  await db().prepare("INSERT INTO feedback_bugs (id, org_id, user_id, title, body, page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(row.id, orgId, userId, title, body, page, row.created_at);
  return row;
}
export async function listBugs(handled: boolean): Promise<(BugRow & { user_email: string | null; org_name: string | null })[]> {
  return await db()
    .prepare(
      `SELECT b.*, u.email AS user_email, o.name AS org_name FROM feedback_bugs b LEFT JOIN users u ON u.id = b.user_id LEFT JOIN orgs o ON o.id = b.org_id
       WHERE b.handled_at IS ${handled ? "NOT NULL" : "NULL"} ORDER BY b.created_at DESC LIMIT 200`,
    )
    .all() as unknown as (BugRow & { user_email: string | null; org_name: string | null })[];
}
export async function markBugHandled(id: string): Promise<boolean> {
  return (await db().prepare("UPDATE feedback_bugs SET handled_at = ? WHERE id = ? AND handled_at IS NULL").run(now(), id)).changes > 0;
}
export interface ContactRow {
  id: string;
  name: string;
  email: string;
  company: string | null;
  message: string;
  handled_at: string | null;
  created_at: string;
}
export async function createContact(name: string, email: string, company: string | null, message: string): Promise<ContactRow> {
  const row: ContactRow = { id: randomUUID(), name, email, company, message, handled_at: null, created_at: now() };
  await db().prepare("INSERT INTO contact_messages (id, name, email, company, message, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(row.id, name, email, company, message, row.created_at);
  return row;
}
export async function listContacts(handled: boolean): Promise<ContactRow[]> {
  return await db().prepare(`SELECT * FROM contact_messages WHERE handled_at IS ${handled ? "NOT NULL" : "NULL"} ORDER BY created_at DESC LIMIT 200`).all() as unknown as ContactRow[];
}
export async function markContactHandled(id: string): Promise<boolean> {
  return (await db().prepare("UPDATE contact_messages SET handled_at = ? WHERE id = ? AND handled_at IS NULL").run(now(), id)).changes > 0;
}

// ── reminders ──
export async function logReminder(userId: string, kind: string): Promise<void> {
  await db().prepare("INSERT INTO reminder_log (id, user_id, kind, sent_at) VALUES (?, ?, ?, ?)").run(randomUUID(), userId, kind, now());
}
/** Signed up at least `days` ago, never exported, never nudged for this. */
export async function reminderCandidatesNoExport(days: number): Promise<UserRow[]> {
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  return await db()
    .prepare(
      `SELECT u.* FROM users u WHERE u.created_at <= ?
         AND NOT EXISTS (SELECT 1 FROM export_usage x WHERE x.user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM reminder_log r WHERE r.user_id = u.id AND r.kind = 'no-export')
       ORDER BY u.created_at LIMIT 500`,
    )
    .all(cutoff) as unknown as UserRow[];
}
/** Has exported before, no login for `idleDays`, not nudged as dormant in the last `cooldownDays`. */
export async function reminderCandidatesDormant(idleDays: number, cooldownDays: number): Promise<UserRow[]> {
  const idle = new Date(Date.now() - idleDays * 86_400_000).toISOString();
  const cooldown = new Date(Date.now() - cooldownDays * 86_400_000).toISOString();
  return await db()
    .prepare(
      `SELECT u.* FROM users u WHERE u.last_login_at IS NOT NULL AND u.last_login_at <= ?
         AND EXISTS (SELECT 1 FROM export_usage x WHERE x.user_id = u.id)
         AND NOT EXISTS (SELECT 1 FROM reminder_log r WHERE r.user_id = u.id AND r.kind = 'dormant' AND r.sent_at >= ?)
       ORDER BY u.last_login_at LIMIT 500`,
    )
    .all(idle, cooldown) as unknown as UserRow[];
}

// ── settings ─────────────────────────────────────────────────────────────────
export async function getSetting(key: string): Promise<string | undefined> {
  return (await db().prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;
}
/** Store `value` unless the key exists; returns whichever value is stored (first writer wins across instances). */
export async function setSettingIfAbsent(key: string, value: string): Promise<string> {
  await db().prepare("INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)").run(key, value, now());
  return (await getSetting(key)) ?? value;
}
/**
 * A once-per-interval lease shared by every instance (e.g. the daily reminder run): true for exactly one
 * caller per `intervalMs`, using an atomic compare-and-set on app_settings.
 */
export async function takeLease(name: string, intervalMs: number, nowMs = Date.now()): Promise<boolean> {
  const key = `lease:${name}`;
  await db().prepare("INSERT OR IGNORE INTO app_settings (key, value, updated_at) VALUES (?, '0', ?)").run(key, now());
  const prev = await getSetting(key);
  if (prev === undefined || nowMs - Number(prev) < intervalMs) return false;
  const r = await db().prepare("UPDATE app_settings SET value = ?, updated_at = ? WHERE key = ? AND value = ?").run(String(nowMs), now(), key, prev);
  return r.changes === 1;
}
export async function setSetting(key: string, value: string): Promise<void> {
  await db()
    .prepare("INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(key, value, now());
}

// ── Unity plugin distribution ────────────────────────────────────────────────
export interface PluginDownloadRow {
  id: string;
  wm: string;
  user_id: string | null;
  email: string;
  org_id: string | null;
  version: string;
  ip: string | null;
  created_at: string;
}
export interface PluginBanRow {
  id: string;
  scope: "download" | "user";
  target: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  lifted_at: string | null;
  lifted_by: string | null;
}
export async function createPluginDownload(r: Omit<PluginDownloadRow, "created_at">): Promise<PluginDownloadRow> {
  const row = { ...r, created_at: now() };
  await db()
    .prepare("INSERT INTO plugin_downloads (id, wm, user_id, email, org_id, version, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.wm, row.user_id, row.email, row.org_id, row.version, row.ip, row.created_at);
  return row;
}
export async function getPluginDownload(idOrWm: string): Promise<PluginDownloadRow | undefined> {
  return await db().prepare("SELECT * FROM plugin_downloads WHERE id = ? OR wm = ?").get(idOrWm, idOrWm.toUpperCase()) as PluginDownloadRow | undefined;
}
/** Record that `userId` made a plugin request with download `lid`. */
export async function touchPluginUsage(lid: string, userId: string, version: string | null): Promise<void> {
  const t = now();
  await db()
    .prepare(
      `INSERT INTO plugin_usage (lid, user_id, first_seen, last_seen, last_version, requests) VALUES (?, ?, ?, ?, ?, 1)
       ON CONFLICT(lid, user_id) DO UPDATE SET last_seen = excluded.last_seen, last_version = excluded.last_version, requests = plugin_usage.requests + 1`,
    )
    .run(lid, userId, t, t, version);
}
export interface PluginDownloadStats extends PluginDownloadRow {
  accounts: number;
  other_accounts: number;
  requests: number;
  last_seen: string | null;
  banned: number;
}
const DOWNLOAD_STATS = `
  SELECT d.*,
    (SELECT COUNT(*) FROM plugin_usage u WHERE u.lid = d.id) AS accounts,
    (SELECT COUNT(*) FROM plugin_usage u WHERE u.lid = d.id AND (d.user_id IS NULL OR u.user_id <> d.user_id)) AS other_accounts,
    (SELECT COALESCE(SUM(requests), 0) FROM plugin_usage u WHERE u.lid = d.id) AS requests,
    (SELECT MAX(last_seen) FROM plugin_usage u WHERE u.lid = d.id) AS last_seen,
    EXISTS (SELECT 1 FROM plugin_bans b WHERE b.lifted_at IS NULL AND ((b.scope = 'download' AND b.target = d.id) OR (b.scope = 'user' AND b.target = d.user_id))) AS banned
  FROM plugin_downloads d`;
export async function listPluginDownloadsFor(userId: string, limit = 20): Promise<PluginDownloadStats[]> {
  return await db().prepare(`${DOWNLOAD_STATS} WHERE d.user_id = ? ORDER BY d.created_at DESC LIMIT ?`).all(userId, limit) as unknown as PluginDownloadStats[];
}
/** Admin list; `q` matches email or watermark; `shared` = only downloads used by other accounts (leaks). */
export async function listPluginDownloadsAdmin(q = "", shared = false, limit = 200): Promise<PluginDownloadStats[]> {
  const like = `%${q.trim().toLowerCase()}%`;
  return await db()
    .prepare(
      `SELECT * FROM (${DOWNLOAD_STATS}) x WHERE (CAST(? AS TEXT) = '' OR lower(x.email) LIKE ? OR lower(x.wm) LIKE ? OR x.id = ?) AND (CAST(? AS INTEGER) = 0 OR x.other_accounts > 0) ORDER BY x.created_at DESC LIMIT ?`,
    )
    .all(q.trim(), like, like, q.trim(), shared ? 1 : 0, limit) as unknown as PluginDownloadStats[];
}
export async function pluginUsageFor(lid: string): Promise<{ user_id: string; email: string | null; first_seen: string; last_seen: string; last_version: string | null; requests: number }[]> {
  return await db()
    .prepare("SELECT u.*, us.email FROM plugin_usage u LEFT JOIN users us ON us.id = u.user_id WHERE u.lid = ? ORDER BY u.last_seen DESC")
    .all(lid) as never;
}
export async function activePluginBan(scope: "download" | "user", target: string): Promise<PluginBanRow | undefined> {
  return await db()
    .prepare("SELECT * FROM plugin_bans WHERE scope = ? AND target = ? AND lifted_at IS NULL ORDER BY created_at DESC LIMIT 1")
    .get(scope, target) as PluginBanRow | undefined;
}
export async function createPluginBan(scope: "download" | "user", target: string, reason: string | null, by: string): Promise<PluginBanRow> {
  const row: PluginBanRow = { id: randomUUID(), scope, target, reason, created_by: by, created_at: now(), lifted_at: null, lifted_by: null };
  await db()
    .prepare("INSERT INTO plugin_bans (id, scope, target, reason, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, row.scope, row.target, row.reason, row.created_by, row.created_at);
  return row;
}
export async function liftPluginBan(id: string, by: string): Promise<boolean> {
  return (await db().prepare("UPDATE plugin_bans SET lifted_at = ?, lifted_by = ? WHERE id = ? AND lifted_at IS NULL").run(now(), by, id)).changes > 0;
}
export async function listPluginBans(includeLifted = false): Promise<(PluginBanRow & { target_label: string | null })[]> {
  return await db()
    .prepare(
      `SELECT b.*, CASE b.scope WHEN 'user' THEN (SELECT email FROM users WHERE id = b.target)
                                ELSE (SELECT wm || ' · ' || email FROM plugin_downloads WHERE id = b.target) END AS target_label
       FROM plugin_bans b ${includeLifted ? "" : "WHERE b.lifted_at IS NULL"} ORDER BY b.created_at DESC LIMIT 200`,
    )
    .all() as never;
}
