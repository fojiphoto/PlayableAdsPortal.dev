import { randomUUID } from "node:crypto";
import type { PackResult } from "@forge/packager";
import { getDb } from "./db.js";

const now = () => new Date().toISOString();


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
    email_verified: 0, email_verify_hash: null, email_verify_expires: null,
    plan_renews_at: null, plan_cancel_at_period_end: 0, analytics_enabled: 1, current_org_id: null, created_at: now(),
  };
  getDb()
    .prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)")
    .run(row.id, row.email, row.password_hash, row.created_at);
  const org = createOrg(row.id, defaultOrgName(email)); // everyone owns a personal workspace
  row.current_org_id = org.id;
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

/** Set plan + subscription id/status (+ period end and cancel flag) together — from the webhook or a sync. */
export function setUserBilling(
  id: string,
  plan: string,
  subscriptionId: string | null,
  status: string | null,
  details?: { renewsAt?: string | null; cancelAtPeriodEnd?: boolean },
): void {
  if (details) {
    getDb()
      .prepare(
        "UPDATE users SET plan = ?, stripe_subscription_id = ?, plan_status = ?, plan_renews_at = ?, plan_cancel_at_period_end = ? WHERE id = ?",
      )
      .run(plan, subscriptionId, status, details.renewsAt ?? null, details.cancelAtPeriodEnd ? 1 : 0, id);
  } else {
    getDb()
      .prepare("UPDATE users SET plan = ?, stripe_subscription_id = ?, plan_status = ? WHERE id = ?")
      .run(plan, subscriptionId, status, id);
  }
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
/** Create an app in a workspace (`userId` = creator, kept for attribution). */
export function createApp(userId: string, orgId: string, name: string, platform?: string): AppRow {
  const row: AppRow = { id: randomUUID(), user_id: userId, org_id: orgId, name, platform: platform ?? null, created_at: now() };
  getDb()
    .prepare("INSERT INTO apps (id, user_id, org_id, name, platform, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(row.id, row.user_id, row.org_id, row.name, row.platform, row.created_at);
  return row;
}
/** Apps of the user's CURRENT workspace. */
export function listApps(userId: string): AppRow[] {
  return getDb()
    .prepare("SELECT * FROM apps WHERE org_id = ? ORDER BY created_at DESC")
    .all(currentOrgFor(userId).org.id) as unknown as AppRow[];
}
/** An app in the user's current workspace (any role), else undefined. */
export function getAppOwned(id: string, userId: string): AppRow | undefined {
  return getDb().prepare("SELECT * FROM apps WHERE id = ? AND org_id = ?").get(id, currentOrgFor(userId).org.id) as AppRow | undefined;
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
  return getDb().prepare("DELETE FROM apps WHERE id = ? AND org_id = ?").run(id, currentOrgFor(userId).org.id).changes > 0;
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
  return getDb()
    .prepare("SELECT c.* FROM concepts c JOIN apps a ON a.id = c.app_id WHERE c.id = ? AND a.org_id = ?")
    .get(id, currentOrgFor(userId).org.id) as ConceptRow | undefined;
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
      .prepare("DELETE FROM concepts WHERE id = ? AND app_id IN (SELECT id FROM apps WHERE org_id = ?)")
      .run(id, currentOrgFor(userId).org.id).changes > 0
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
       WHERE cr.id = ? AND a.org_id = ?`,
    )
    .get(id, currentOrgFor(userId).org.id) as CreativeRow | undefined;
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
/** The workspace owner a creative belongs to — whose plan, domain verification, billing and quota apply. */
export function creativeOwnerId(creativeId: string): string | undefined {
  const row = getDb()
    .prepare(
      `SELECT COALESCE(o.owner_user_id, a.user_id) AS uid
       FROM creatives cr JOIN concepts c ON c.id = cr.concept_id JOIN apps a ON a.id = c.app_id LEFT JOIN orgs o ON o.id = a.org_id
       WHERE cr.id = ?`,
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
         SELECT c.id FROM concepts c JOIN apps a ON a.id = c.app_id WHERE a.org_id = ?)`,
    )
    .run(id, currentOrgFor(userId).org.id).changes > 0;
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

// ── organizations / workspaces / roles ──
export type OrgRole = "owner" | "admin" | "member" | "viewer";
export interface OrgRow {
  id: string;
  name: string;
  owner_user_id: string;
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
export function createOrg(ownerId: string, name: string): OrgRow {
  const row: OrgRow = { id: randomUUID(), name, owner_user_id: ownerId, created_at: now() };
  const db = getDb();
  db.prepare("INSERT INTO orgs (id, name, owner_user_id, created_at) VALUES (?, ?, ?, ?)").run(row.id, row.name, row.owner_user_id, row.created_at);
  db.prepare("INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)").run(row.id, ownerId, now());
  db.prepare("UPDATE users SET current_org_id = ? WHERE id = ? AND current_org_id IS NULL").run(row.id, ownerId);
  return row;
}
export function getOrg(id: string): OrgRow | undefined {
  return getDb().prepare("SELECT * FROM orgs WHERE id = ?").get(id) as OrgRow | undefined;
}
export function renameOrg(id: string, name: string): void {
  getDb().prepare("UPDATE orgs SET name = ? WHERE id = ?").run(name, id);
}
export function getRole(orgId: string, userId: string): OrgRole | undefined {
  const r = getDb().prepare("SELECT role FROM org_members WHERE org_id = ? AND user_id = ?").get(orgId, userId) as { role: OrgRole } | undefined;
  return r?.role;
}
export function listUserOrgs(userId: string): (OrgRow & { role: OrgRole; member_count: number; owner_email: string })[] {
  return getDb()
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
export function currentOrgFor(userId: string): { org: OrgRow; role: OrgRole } {
  const u = getUserById(userId);
  if (!u) throw new Error("user not found");
  if (u.current_org_id) {
    const role = getRole(u.current_org_id, userId);
    const org = getOrg(u.current_org_id);
    if (org && role) return { org, role };
  }
  const first = listUserOrgs(userId)[0];
  if (first) {
    getDb().prepare("UPDATE users SET current_org_id = ? WHERE id = ?").run(first.id, userId);
    return { org: { id: first.id, name: first.name, owner_user_id: first.owner_user_id, created_at: first.created_at }, role: first.role };
  }
  const org = createOrg(userId, defaultOrgName(u.email));
  getDb().prepare("UPDATE users SET current_org_id = ? WHERE id = ?").run(org.id, userId);
  return { org, role: "owner" };
}
export function setCurrentOrg(userId: string, orgId: string): boolean {
  if (!getRole(orgId, userId)) return false;
  getDb().prepare("UPDATE users SET current_org_id = ? WHERE id = ?").run(orgId, userId);
  return true;
}
export function listOrgMembers(orgId: string): OrgMemberView[] {
  return getDb()
    .prepare(
      `SELECT u.id AS id, u.email AS email, m.role AS role, m.created_at AS createdAt
       FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'member' THEN 2 ELSE 3 END, m.created_at`,
    )
    .all(orgId) as unknown as OrgMemberView[];
}
export function upsertOrgMember(orgId: string, userId: string, role: OrgRole): void {
  getDb()
    .prepare(
      `INSERT INTO org_members (org_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(org_id, user_id) DO UPDATE SET role = excluded.role`,
    )
    .run(orgId, userId, role, now());
}
export function removeOrgMember(orgId: string, userId: string): boolean {
  const db = getDb();
  const changed = db.prepare("DELETE FROM org_members WHERE org_id = ? AND user_id = ?").run(orgId, userId).changes > 0;
  db.prepare("UPDATE users SET current_org_id = NULL WHERE id = ? AND current_org_id = ?").run(userId, orgId);
  return changed;
}
export function transferOrgOwnership(orgId: string, newOwnerId: string): void {
  const db = getDb();
  const org = getOrg(orgId);
  if (!org) return;
  db.prepare("UPDATE orgs SET owner_user_id = ? WHERE id = ?").run(newOwnerId, orgId);
  db.prepare("UPDATE org_members SET role = 'admin' WHERE org_id = ? AND user_id = ?").run(orgId, org.owner_user_id);
  db.prepare("UPDATE org_members SET role = 'owner' WHERE org_id = ? AND user_id = ?").run(orgId, newOwnerId);
}
export function createOrgInvite(orgId: string, email: string, role: OrgRole, tokenHash: string, invitedBy: string, expiresIso: string): OrgInviteRow {
  const row: OrgInviteRow = { id: randomUUID(), org_id: orgId, email, role, token_hash: tokenHash, invited_by: invitedBy, expires_at: expiresIso, accepted_at: null, created_at: now() };
  getDb()
    .prepare("INSERT INTO org_invites (id, org_id, email, role, token_hash, invited_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(row.id, row.org_id, row.email, row.role, row.token_hash, row.invited_by, row.expires_at, row.created_at);
  return row;
}
export function findInviteByHash(hash: string): (OrgInviteRow & { org_name: string }) | undefined {
  return getDb()
    .prepare("SELECT i.*, o.name AS org_name FROM org_invites i JOIN orgs o ON o.id = i.org_id WHERE i.token_hash = ?")
    .get(hash) as (OrgInviteRow & { org_name: string }) | undefined;
}
/** Pending (unaccepted, unexpired) invites of a workspace. */
export function listOrgInvites(orgId: string): OrgInviteRow[] {
  return getDb()
    .prepare("SELECT * FROM org_invites WHERE org_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC")
    .all(orgId, now()) as unknown as OrgInviteRow[];
}
export function deleteInvite(id: string, orgId: string): boolean {
  return getDb().prepare("DELETE FROM org_invites WHERE id = ? AND org_id = ?").run(id, orgId).changes > 0;
}
export function markInviteAccepted(id: string): void {
  getDb().prepare("UPDATE org_invites SET accepted_at = ? WHERE id = ?").run(now(), id);
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

export function createJob(userId: string, kind: string, payload: unknown): JobRow {
  const id = randomUUID();
  getDb()
    .prepare("INSERT INTO jobs (id, user_id, kind, status, payload_json, created_at) VALUES (?, ?, ?, 'queued', ?, ?)")
    .run(id, userId, kind, JSON.stringify(payload ?? {}), now());
  return getJob(id)!;
}
export function getJob(id: string): JobRow | undefined {
  return getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
}
export function getJobOwned(id: string, userId: string): JobRow | undefined {
  return getDb().prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").get(id, userId) as JobRow | undefined;
}
export function listJobs(userId: string, limit = 20): JobRow[] {
  return getDb()
    .prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?")
    .all(userId, Math.max(1, Math.min(100, limit))) as unknown as JobRow[];
}
/** Atomically move the oldest queued job to `running` and return it (undefined when the queue is empty). */
export function claimNextJob(): JobRow | undefined {
  const db = getDb();
  const next = db.prepare("SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1").get() as { id: string } | undefined;
  if (!next) return undefined;
  const r = db
    .prepare("UPDATE jobs SET status = 'running', started_at = ?, attempts = attempts + 1, progress = 0, progress_label = NULL WHERE id = ? AND status = 'queued'")
    .run(now(), next.id);
  return r.changes === 1 ? getJob(next.id) : undefined;
}
export function setJobProgress(id: string, progress: number, label?: string | null): void {
  getDb()
    .prepare("UPDATE jobs SET progress = ?, progress_label = ? WHERE id = ? AND status = 'running'")
    .run(Math.max(0, Math.min(100, Math.round(progress))), label ?? null, id);
}
export function completeJob(id: string, result: unknown): void {
  getDb()
    .prepare("UPDATE jobs SET status = 'done', progress = 100, progress_label = NULL, result_json = ?, finished_at = ? WHERE id = ?")
    .run(JSON.stringify(result ?? null), now(), id);
}
export function failJob(id: string, error: string): void {
  getDb()
    .prepare("UPDATE jobs SET status = 'failed', progress_label = NULL, error = ?, finished_at = ? WHERE id = ?")
    .run(error.slice(0, 500), now(), id);
}
/**
 * Boot-time recovery: jobs left `running` by a crashed/restarted process go back to the queue,
 * or fail permanently once they have been attempted `maxAttempts` times. Returns how many moved.
 */
export function recoverStaleJobs(maxAttempts = 2): number {
  const db = getDb();
  const failed = db
    .prepare("UPDATE jobs SET status = 'failed', error = 'Interrupted by a server restart', finished_at = ? WHERE status = 'running' AND attempts >= ?")
    .run(now(), maxAttempts).changes;
  const requeued = db.prepare("UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'").run().changes;
  return Number(failed) + Number(requeued);
}
/** Housekeeping: drop finished jobs older than `olderThanIso` (results are already persisted as exports). */
export function pruneJobs(olderThanIso: string): number {
  return Number(getDb().prepare("DELETE FROM jobs WHERE status IN ('done','failed') AND finished_at < ?").run(olderThanIso).changes);
}

export function setAnalyticsEnabled(userId: string, enabled: boolean): void {
  getDb().prepare("UPDATE users SET analytics_enabled = ? WHERE id = ?").run(enabled ? 1 : 0, userId);
}

// ── in-playable analytics events ─────────────────────────────────────────────
export const EVENT_KINDS = ["impression", "engage", "start", "complete", "cta", "custom"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];
export const isEventKind = (s: string): s is EventKind => (EVENT_KINDS as readonly string[]).includes(s);

/** Existence check for the public collector (no ownership — the creative UUID is the capability). */
export function creativeExists(id: string): boolean {
  return !!getDb().prepare("SELECT 1 FROM creatives WHERE id = ?").get(id);
}

export function insertEvent(creativeId: string, network: string, event: EventKind, session: string, name: string | null, preview: boolean, value: number | null = null): void {
  getDb()
    .prepare("INSERT INTO events (id, creative_id, network, event, name, session, preview, value, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(randomUUID(), creativeId, network, event, name, session, preview ? 1 : 0, value, now());
}

/** Shared FROM/WHERE for event aggregates scoped to the user's current workspace. */
function eventScope(userId: string, sinceIso: string, includePreview: boolean, creativeId?: string) {
  const where = ["a.org_id = ?", "ev.created_at >= ?"];
  const params: unknown[] = [currentOrgFor(userId).org.id, sinceIso];
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
export function eventFunnel(userId: string, sinceIso: string, includePreview = false, creativeId?: string): FunnelCounts {
  const { sql, params } = eventScope(userId, sinceIso, includePreview, creativeId);
  return getDb().prepare(`SELECT ${FUNNEL_COLS} ${sql}`).get(...(params as never[])) as unknown as FunnelCounts;
}
export function eventDaily(userId: string, sinceIso: string, includePreview = false, creativeId?: string): (FunnelCounts & { d: string })[] {
  const { sql, params } = eventScope(userId, sinceIso, includePreview, creativeId);
  return getDb()
    .prepare(`SELECT substr(ev.created_at,1,10) AS d, ${FUNNEL_COLS} ${sql} GROUP BY d ORDER BY d`)
    .all(...(params as never[])) as unknown as (FunnelCounts & { d: string })[];
}
export function eventByNetwork(userId: string, sinceIso: string, includePreview = false, creativeId?: string): (FunnelCounts & { network: string })[] {
  const { sql, params } = eventScope(userId, sinceIso, includePreview, creativeId);
  return getDb()
    .prepare(`SELECT ev.network, ${FUNNEL_COLS} ${sql} GROUP BY ev.network ORDER BY impressions DESC`)
    .all(...(params as never[])) as unknown as (FunnelCounts & { network: string })[];
}
export function eventByCreative(
  userId: string,
  sinceIso: string,
  includePreview = false,
): (FunnelCounts & { creative_id: string; creative: string; concept: string; app: string })[] {
  const { sql, params } = eventScope(userId, sinceIso, includePreview);
  return getDb()
    .prepare(`SELECT ev.creative_id, cr.name AS creative, c.name AS concept, a.name AS app, ${FUNNEL_COLS} ${sql} GROUP BY ev.creative_id ORDER BY impressions DESC LIMIT 50`)
    .all(...(params as never[])) as unknown as (FunnelCounts & { creative_id: string; creative: string; concept: string; app: string })[];
}
export function customEvents(userId: string, sinceIso: string, includePreview = false, creativeId?: string, limit = 25): { name: string; hits: number; sessions: number; total: number | null }[] {
  const { sql, params } = eventScope(userId, sinceIso, includePreview, creativeId);
  return getDb()
    .prepare(`SELECT ev.name AS name, COUNT(*) AS hits, COUNT(DISTINCT ev.session) AS sessions, SUM(ev.value) AS total ${sql} AND ev.event = 'custom' AND ev.name IS NOT NULL GROUP BY ev.name ORDER BY hits DESC LIMIT ?`)
    .all(...(params as never[]), limit) as unknown as { name: string; hits: number; sessions: number; total: number | null }[];
}
/** Housekeeping: raw events older than `olderThanIso` are dropped (dashboards look back 90 days at most). */
export function pruneEvents(olderThanIso: string): number {
  return Number(getDb().prepare("DELETE FROM events WHERE created_at < ?").run(olderThanIso).changes);
}

// ── raw uploads awaiting a job (compile inputs; deleted once the job finishes) ──
export interface UploadRow {
  id: string;
  user_id: string;
  filename: string;
  bytes: Uint8Array;
  created_at: string;
}
export function createUpload(userId: string, filename: string, bytes: Uint8Array): string {
  const id = randomUUID();
  getDb().prepare("INSERT INTO uploads (id, user_id, filename, bytes, created_at) VALUES (?, ?, ?, ?, ?)").run(id, userId, filename, bytes, now());
  return id;
}
export function getUpload(id: string): UploadRow | undefined {
  return getDb().prepare("SELECT * FROM uploads WHERE id = ?").get(id) as UploadRow | undefined;
}
export function deleteUpload(id: string): void {
  getDb().prepare("DELETE FROM uploads WHERE id = ?").run(id);
}
/** Orphaned inputs (job never ran) are dropped after a day. */
export function pruneUploads(olderThanIso: string): number {
  return Number(getDb().prepare("DELETE FROM uploads WHERE created_at < ?").run(olderThanIso).changes);
}
