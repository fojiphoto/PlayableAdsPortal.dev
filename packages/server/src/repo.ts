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
    totp_secret: null, totp_enabled: 0, created_at: now(),
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

export function updatePassword(id: string, passwordHash: string): void {
  getDb().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, id);
}

export function setTotp(id: string, secret: string | null, enabled: number): void {
  getDb().prepare("UPDATE users SET totp_secret = ?, totp_enabled = ? WHERE id = ?").run(secret, enabled, id);
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
export function deleteApp(id: string, userId: string): boolean {
  return getDb().prepare("DELETE FROM apps WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

// ── concepts ─────────────────────────────────────────────────────────────────
export function createConcept(appId: string, name: string): ConceptRow {
  const row: ConceptRow = { id: randomUUID(), app_id: appId, name, created_at: now() };
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
