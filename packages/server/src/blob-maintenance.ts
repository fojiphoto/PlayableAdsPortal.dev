import { blobStore } from "./blobstore.js";
import { db } from "./db.js";
import { referencedBlobKeys } from "./repo.js";

/**
 * Object-store housekeeping (gap #16).
 *
 * - `sweepOrphanBlobs`: objects no row references any more (their creative/app/workspace was deleted —
 *   the database cascades, the store can't) are removed once they're older than `minAgeMs`, which keeps
 *   in-flight uploads (object written, row not yet committed) safe.
 * - `migrateBlobs`: move inline bytes into the configured store (or back with `toDb`), one row at a time,
 *   while the app keeps serving — reads follow the key whenever a row has one.
 */
const PREFIXES = ["creatives/", "exports/", "uploads/", "kits/"];

export async function sweepOrphanBlobs(minAgeMs = 6 * 60 * 60_000): Promise<{ scanned: number; deleted: number }> {
  const store = blobStore();
  if (!store) return { scanned: 0, deleted: 0 };
  const keep = await referencedBlobKeys();
  const cutoff = Date.now() - minAgeMs;
  let scanned = 0;
  let deleted = 0;
  for (const prefix of PREFIXES) {
    for await (const o of store.list(prefix)) {
      scanned++;
      if (keep.has(o.key) || o.modified.getTime() > cutoff) continue;
      await store.delete(o.key);
      deleted++;
    }
  }
  return { scanned, deleted };
}

interface BlobColumn {
  table: string;
  inline: string;
  key: string;
  /** columns needed to build the key */
  select: string;
  keyFor: (row: Record<string, unknown>) => string;
  /** what the inline column holds once the bytes are external */
  emptyInline: "empty" | "null";
  contentType: (row: Record<string, unknown>) => string | undefined;
}
export const BLOB_COLUMNS: BlobColumn[] = [
  { table: "creatives", inline: "source_zip", key: "source_key", select: "id", keyFor: (r) => `creatives/${r.id}/source.zip`, emptyInline: "empty", contentType: () => "application/zip" },
  {
    table: "exports",
    inline: "bytes",
    key: "bytes_key",
    select: "id, creative_id, network, format",
    keyFor: (r) => `exports/${r.creative_id}/${r.network}`,
    emptyInline: "empty",
    contentType: (r) => (r.format === "zip" ? "application/zip" : "text/html"),
  },
  { table: "uploads", inline: "bytes", key: "bytes_key", select: "id", keyFor: (r) => `uploads/${r.id}`, emptyInline: "empty", contentType: () => "application/zip" },
  { table: "preloader_kits", inline: "logo", key: "logo_key", select: "id, logo_mime", keyFor: (r) => `kits/${r.id}/logo`, emptyInline: "null", contentType: (r) => (r.logo_mime as string) ?? undefined },
];

export interface MigrateReport {
  moved: Record<string, number>;
  bytes: number;
}

/** Move inline bytes into the object store (default) or, with `toDb`, back into the database. */
export async function migrateBlobs(opts: { toDb?: boolean; batch?: number; log?: (s: string) => void } = {}): Promise<MigrateReport> {
  const store = blobStore();
  if (!store) throw new Error("No object store configured: set BLOB_STORE=fs or s3 (and its settings) first.");
  const d = db();
  const log = opts.log ?? (() => {});
  const report: MigrateReport = { moved: {}, bytes: 0 };
  const batch = opts.batch ?? 20;
  for (const c of BLOB_COLUMNS) {
    report.moved[c.table] = 0;
    for (;;) {
      const rows = opts.toDb
        ? await d.prepare(`SELECT ${c.select}, ${c.key} AS k FROM ${c.table} WHERE ${c.key} IS NOT NULL LIMIT ?`).all<Record<string, unknown>>(batch)
        : await d
            .prepare(`SELECT ${c.select}, ${c.inline} AS b FROM ${c.table} WHERE ${c.key} IS NULL AND ${c.inline} IS NOT NULL AND length(${c.inline}) > 0 LIMIT ?`)
            .all<Record<string, unknown>>(batch);
      if (!rows.length) break;
      for (const r of rows) {
        if (opts.toDb) {
          const bytes = await store.get(r.k as string);
          if (!bytes) throw new Error(`${c.table} ${r.id}: object ${r.k} is missing from the store`);
          await d.prepare(`UPDATE ${c.table} SET ${c.inline} = ?, ${c.key} = NULL WHERE id = ?`).run(Buffer.from(bytes), r.id);
          report.bytes += bytes.length;
        } else {
          const bytes = r.b as Uint8Array;
          const key = c.keyFor(r);
          await store.put(key, bytes, c.contentType(r));
          // only switch the row over if nobody replaced its bytes meanwhile
          await d
            .prepare(`UPDATE ${c.table} SET ${c.key} = ?, ${c.inline} = ? WHERE id = ? AND ${c.key} IS NULL`)
            .run(key, c.emptyInline === "null" ? null : Buffer.alloc(0), r.id);
          report.bytes += bytes.length;
        }
        report.moved[c.table]!++;
      }
      log(`${c.table}: ${report.moved[c.table]} moved`);
    }
  }
  return report;
}
