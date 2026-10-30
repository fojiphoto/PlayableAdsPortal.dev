import { randomUUID } from "node:crypto";
import type { PackResult } from "@forge/packager";
import { getDb } from "./db.js";

const now = () => new Date().toISOString();

/** Owner ids whose apps `userId` can access: themselves + anyone who added them as a member. */
function accessibleOwnerIds(userId: string): string[] {
  const rows = getDb()
    .prepare("SELECT owner_user_id AS o FROM memberships WHERE member_user_id = ?")
    .all(userId) as unknown as { o: string }[];
  return [userId, ...rows.map((r) => r.o)];
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
  email_verify_hash: string | null;
  email_verify_expires: string | null;
  created_at: string;
}
export interface AppRow {
  id: string;
  user_id: string;
  name: string;
  platform: string | null;
  created_at: string;
}
export interface ConceptRow {
  id: string;
  app_id: string;
  name: string;
  network_order: string | null; // JSON array of network ids, or null = default order
  created_at: string;
}
export interface CreativeRow {
  id: string;
  concept_id: string;
  name: string;
  entry: string;
  source_zip: Uint8Array;
  options_json: string;
  created_at: string;
}
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
  created_at: string;
}

// ── users ────────────────────────────────────────────────────────────────────
export function createUser(email: string, passwordHash: string): UserRow {
  const row: UserRow = {
    id: randomUUID(), email, password_hash: passwordHash, plan: "free",
    totp_secret: null, totp_enabled: 0, totp_last_step: null, domain: null, domain_token: null, domain_verified: 0,
    stripe_customer_id: null, stripe_subscription_id: null, plan_status: null,
    email_verified: 0, email_verify_hash: null, email_verify_expires: null, created_at: now(),
  };
  getDb()
    .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(row.id, row.email, row.password_hash, row.created_at);
  return row;
}
export function getUserByEmail(email: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
}
export function getUserById(id: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

export function setUserPlan(id: string, plan: string): void {
  getDb().prepare("UPDATE users SET plan = ? WHERE id = ?").run(plan, id);
}

// ── Stripe billing ──
export function setStripeCustomer(id: string, customerId: string): void {
  getDb().prepare("UPDATE users SET stripe_customer_id = ? WHERE id = ?").run(customerId, id);
}

/** Set plan + subscription id + status together (called from the Stripe webhook). */
export function setUserBilling(id: string, plan: string, subscriptionId: string | null, status: string | null): void {
  getDb()
    .prepare("UPDATE users SET plan = ?, stripe_subscription_id = ?, plan_status = ? WHERE id = ?")
    .run(plan, subscriptionId, status, id);
}

export function getUserByStripeCustomer(customerId: string): UserRow | undefined {
  return getDb().prepare("SELECT * FROM users WHERE stripe_customer_id = ?").get(customerId) as UserRow | undefined;
}

// ── email verification ──
export function setEmailVerifyToken(id: string, hash: string, expiresIso: string): void {
  getDb().prepare("UPDATE users SET email_verify_hash = ?, email_verify_expires = ? WHERE id = ?").run(hash, expiresIso, id);
}
/** Mark the user whose pending token hash matches as verified; undefined if unknown/expired. */
export function verifyEmailByHash(hash: string): UserRow | undefined {
  const u = getDb().prepare("SELECT * FROM users WHERE email_verify_hash = ?").get(hash) as UserRow | undefined;
  if (!u || !u.email_verify_expires || u.email_verify_expires < now()) return undefined;
  getDb()
    .prepare("UPDATE users SET email_verified = 1, email_verify_hash = NULL, email_verify_expires = NULL WHERE id = ?")
    .run(u.id);
  return { ...u, email_verified: 1 };
}

// ── password resets (one-time, hashed, expiring) ──
export function createPasswordReset(userId: string, tokenHash: string, expiresIso: string): void {
  getDb()
    .prepare("INSERT INTO password_resets (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), userId, tokenHash, expiresIso, now());
}
export function findActiveReset(tokenHash: string): { id: string; user_id: string } | undefined {
  return getDb()
    .prepare("SELECT id, user_id FROM password_resets WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?")
    .get(tokenHash, now()) as { id: string; user_id: string } | undefined;
}
export function consumeReset(id: string): void {
  getDb().prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").run(now(), id);
}

export function updatePassword(id: string, passwordHash: string): void {
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
}

export function setTotp(id: string, secret: string | null, enabled: number): void {
  // reset the replay counter whenever the secret/enabled state changes
  getDb().prepare("UPDATE users SET totp_secret = ?, totp_enabled = ?, totp_last_step = NULL WHERE id = ?").run(secret, enabled, id);
}

/** Record the last accepted TOTP time-step (replay guard: a step can't be reused). */
export function setTotpLastStep(id: string, step: number): void {
  getDb().prepare("UPDATE users SET totp_last_step = ? WHERE id = ?").run(step, id);
}

export function setUserDomain(id: string, domain: string, token: string): void {
  getDb().prepare("UPDATE users SET domain = ?, domain_token = ?, domain_verified = 0 WHERE id = ?").run(domain, token, id);
}

export function setDomainVerified(id: string, verified: number): void {
  getDb().prepare("UPDATE users SET domain_verified = ? WHERE id = ?").run(verified, id);
}

export function addExportUsage(userId: string, network: string): void {
  getDb()
    .prepare("INSERT INTO export_usage (id, user_id, network, created_at) VALUES (?, ?, ?, ?)")
    .run(randomUUID(), userId, network, now());
}

export function countExportUsageSince(userId: string, sinceIso: string): number {
  const row = getDb()
    .prepare("SELECT COUNT(*) AS n FROM export_usage WHERE user_id = ? AND created_at >= ?")
    .get(userId, sinceIso) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function countExportUsage(userId: string): number {
  const row = getDb().prepare("SELECT COUNT(*) AS n FROM export_usage WHERE user_id = ?").get(userId) as { n: number } | undefined;
  return row?.n ?? 0;
}

export function exportDaily(userId: string, sinceIso: string): { d: string; n: number }[] {
  return getDb()
    .prepare(
      "SELECT substr(created_at,1,10) AS d, COUNT(*) AS n FROM export_usage WHERE user_id = ? AND created_at >= ? GROUP BY d ORDER BY d",
    )
    .all(userId, sinceIso) as unknown as { d: string; n: number }[];
}

export function exportByNetwork(userId: string): { network: string; n: number }[] {
  return getDb()
    .prepare("SELECT network, COUNT(*) AS n FROM export_usage WHERE user_id = ? GROUP BY network ORDER BY n DESC")
    .all(userId) as unknown as { network: string; n: number }[];
}

// ── apps ─────────────────────────────────────────────────────────────────────
export function createApp(userId: string, name: string, platform?: string): AppRow {
  const row: AppRow = { id: randomUUID(), user_id: userId, name, platform: platform ?? null, created_at: now() };
  getDb()
    .prepare("INSERT INTO apps (id, user_id, name, platform, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(row.id, row.user_id, row.name, row.platform, row.created_at);
  return row;
}
export function listApps(userId: string): AppRow[] {
  const ids = accessibleOwnerIds(userId);
  const ph = ids.map(() => "?").join(",");
  return getDb()
    .prepare(`SELECT * FROM apps WHERE user_id IN (${ph}) ORDER BY created_at DESC`)
    .all(...ids) as unknown as AppRow[];
}
export function getAppOwned(id: string, userId: string): AppRow | undefined {
  const ids = accessibleOwnerIds(userId);
  const ph = ids.map(() => "?").join(",");
  return getDb().prepare(`SELECT * FROM apps WHERE id = ? AND user_id IN (${ph})`).get(id, ...ids) as AppRow | undefined;
}
/** Rename / re-platform an app the user can access. */
export function updateApp(id: string, userId: string, patch: { name?: string; platform?: string | null }): boolean {
  const a = getAppOwned(id, userId);
  if (!a) return false;
  getDb()
    .prepare("UPDATE apps SET name = ?, platform = ? WHERE id = ?")
    .run(patch.name ?? a.name, patch.platform === undefined ? a.platform : patch.platform, id);
  return true;
}
export function deleteApp(id: string, userId: string): boolean {
  return getDb().prepare("DELETE FROM apps WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

// ── concepts ─────────────────────────────────────────────────────────────────
export function createConcept(appId: string, name: string): ConceptRow {
  const row: ConceptRow = { id: randomUUID(), app_id: appId, name, network_order: null, created_at: now() };
  getDb()
    .prepare("INSERT INTO concepts (id, app_id, name, created_at) VALUES (?, ?, ?, ?)")
    .run(row.id, row.app_id, row.name, row.created_at);
  return row;
}
export function listConcepts(appId: string): ConceptRow[] {
  return getDb().prepare("SELECT * FROM concepts WHERE app_id = ? ORDER BY created_at DESC").all(appId) as unknown as ConceptRow[];
}
export function getConceptOwned(id: string, userId: string): ConceptRow | undefined {
  const ids = accessibleOwnerIds(userId);
  const ph = ids.map(() => "?").join(",");
  return getDb()
    .prepare(`SELECT c.* FROM concepts c JOIN apps a ON a.id = c.app_id WHERE c.id = ? AND a.user_id IN (${ph})`)
    .get(id, ...ids) as ConceptRow | undefined;
}
/** Rename a concept and/or set its custom export network order (null = default). */
export function updateConcept(
  id: string,
  userId: string,
  patch: { name?: string; networkOrder?: string[] | null },
): boolean {
  const c = getConceptOwned(id, userId);
  if (!c) return false;
  const order = patch.networkOrder === undefined ? c.network_order : patch.networkOrder ? JSON.stringify(patch.networkOrder) : null;
  getDb().prepare("UPDATE concepts SET name = ?, network_order = ? WHERE id = ?").run(patch.name ?? c.name, order, id);
  return true;
}
export function deleteConcept(id: string, userId: string): boolean {
  return (
    getDb()
      .prepare(
        `DELETE FROM concepts WHERE id = ? AND app_id IN (SELECT id FROM apps WHERE user_id = ?)`,
      )
      .run(id, userId).changes > 0
  );
}

// ── creatives ────────────────────────────────────────────────────────────────
export function createCreative(args: {
  conceptId: string;
  name: string;
  entry: string;
  sourceZip: Uint8Array;
  optionsJson: string;
}): CreativeRow {
  const row: CreativeRow = {
    id: randomUUID(),
    concept_id: args.conceptId,
    name: args.name,
    entry: args.entry,
    source_zip: args.sourceZip,
    options_json: args.optionsJson,
    created_at: now(),
  };
  getDb()
    .prepare(
      "INSERT INTO creatives (id, concept_id, name, entry, source_zip, options_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(row.id, row.concept_id, row.name, row.entry, row.source_zip, row.options_json, row.created_at);
  return row;
}
export function listCreatives(conceptId: string): CreativeRow[] {
  return getDb()
    .prepare("SELECT * FROM creatives WHERE concept_id = ? ORDER BY created_at DESC")
    .all(conceptId) as unknown as CreativeRow[];
}
export function getCreativeOwned(id: string, userId: string): CreativeRow | undefined {
  return getDb()
    .prepare(
      `SELECT cr.* FROM creatives cr
       JOIN concepts c ON c.id = cr.concept_id
       JOIN apps a ON a.id = c.app_id
       WHERE cr.id = ? AND a.user_id IN (${accessibleOwnerIds(userId).map(() => "?").join(",")})`,
    )
    .get(id, ...accessibleOwnerIds(userId)) as CreativeRow | undefined;
}
/** Rename a creative and/or replace its stored pack options (CTA / store URLs). */
export function updateCreative(id: string, userId: string, patch: { name?: string; optionsJson?: string }): boolean {
  const cr = getCreativeOwned(id, userId);
  if (!cr) return false;
  getDb()
    .prepare("UPDATE creatives SET name = ?, options_json = ? WHERE id = ?")
    .run(patch.name ?? cr.name, patch.optionsJson ?? cr.options_json, id);
  return true;
}
/** The user who owns the app a creative lives under (the publisher whose domain must be verified). */
export function creativeOwnerId(creativeId: string): string | undefined {
  const row = getDb()
    .prepare(
      `SELECT a.user_id AS uid FROM creatives cr JOIN concepts c ON c.id = cr.concept_id JOIN apps a ON a.id = c.app_id WHERE cr.id = ?`,
    )
    .get(creativeId) as { uid: string } | undefined;
  return row?.uid;
}
/** Fetch a creative without an ownership check (for UUID-guarded download/preview). */
export function getCreativeById(id: string): CreativeRow | undefined {
  return getDb().prepare("SELECT * FROM creatives WHERE id = ?").get(id) as CreativeRow | undefined;
}
export function deleteCreative(id: string, userId: string): boolean {
  return getDb()
    .prepare(
      `DELETE FROM creatives WHERE id = ? AND concept_id IN (
         SELECT c.id FROM concepts c JOIN apps a ON a.id = c.app_id WHERE a.user_id = ?)`,
    )
    .run(id, userId).changes > 0;
}

// ── exports ──────────────────────────────────────────────────────────────────
export function upsertExport(creativeId: string, r: PackResult): void {
  getDb()
    .prepare(
      `INSERT INTO exports (id, creative_id, network, filename, format, size_bytes, max_size_bytes, ok, validation_json, bytes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(creative_id, network) DO UPDATE SET
         filename=excluded.filename, format=excluded.format, size_bytes=excluded.size_bytes,
         max_size_bytes=excluded.max_size_bytes, ok=excluded.ok, validation_json=excluded.validation_json,
         bytes=excluded.bytes, created_at=excluded.created_at`,
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
      Buffer.from(r.bytes),
      now(),
    );
}
export function listExports(creativeId: string): ExportRow[] {
  return getDb().prepare("SELECT * FROM exports WHERE creative_id = ?").all(creativeId) as unknown as ExportRow[];
}
export function getExport(creativeId: string, network: string): ExportRow | undefined {
  return getDb()
    .prepare("SELECT * FROM exports WHERE creative_id = ? AND network = ?")
    .get(creativeId, network) as ExportRow | undefined;
}

// ── memberships / team ──
export interface MemberView {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

export function addMember(ownerId: string, memberId: string, role = "member"): void {
  getDb()
    .prepare(
      `INSERT INTO memberships (id, owner_user_id, member_user_id, role, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(owner_user_id, member_user_id) DO UPDATE SET role = excluded.role`,
    )
    .run(randomUUID(), ownerId, memberId, role, now());
}

export function listMembers(ownerId: string): MemberView[] {
  return getDb()
    .prepare(
      `SELECT m.member_user_id AS id, u.email AS email, m.role AS role, m.created_at AS createdAt
       FROM memberships m JOIN users u ON u.id = m.member_user_id
       WHERE m.owner_user_id = ? ORDER BY m.created_at`,
    )
    .all(ownerId) as unknown as MemberView[];
}

export function removeMember(ownerId: string, memberId: string): boolean {
  return getDb().prepare("DELETE FROM memberships WHERE owner_user_id = ? AND member_user_id = ?").run(ownerId, memberId).changes > 0;
}

// ── preloader ──
export interface PreloaderRow {
  user_id: string;
  logo: Uint8Array | null;
  logo_mime: string | null;
  bg: string | null;
  enabled: number;
  updated_at: string;
}

export function getPreloader(userId: string): PreloaderRow | undefined {
  return getDb().prepare("SELECT * FROM preloaders WHERE user_id = ?").get(userId) as PreloaderRow | undefined;
}

export function setPreloader(
  userId: string,
  args: { logo?: Uint8Array | null; logoMime?: string | null; bg: string | null; enabled: number },
): void {
  const existing = getPreloader(userId);
  const logo = args.logo === undefined ? (existing?.logo ?? null) : args.logo;
  const logoMime = args.logo === undefined ? (existing?.logo_mime ?? null) : (args.logoMime ?? null);
  getDb()
    .prepare(
      `INSERT INTO preloaders (user_id, logo, logo_mime, bg, enabled, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET logo=excluded.logo, logo_mime=excluded.logo_mime, bg=excluded.bg, enabled=excluded.enabled, updated_at=excluded.updated_at`,
    )
    .run(userId, logo ? Buffer.from(logo) : null, logoMime, args.bg, args.enabled, now());
}
