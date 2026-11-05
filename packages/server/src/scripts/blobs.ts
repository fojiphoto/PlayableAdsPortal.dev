/**
 * Object-store maintenance (gap #16). Uses the app's database and BLOB_STORE settings.
 *
 *   npm run blobs -w @forge/server -- migrate         inline bytes → object store (safe while running)
 *   npm run blobs -w @forge/server -- migrate --to-db object store → inline (rollback)
 *   npm run blobs -w @forge/server -- sweep           delete objects no row references (older than 6 h)
 *
 * After `migrate` on SQLite, run `VACUUM` once to give the freed space back to the disk.
 */
import { closeDb, initDb } from "../db.js";
import { migrateBlobs, sweepOrphanBlobs } from "../blob-maintenance.js";

const [cmd] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const toDb = process.argv.includes("--to-db");

await initDb();
try {
  if (cmd === "migrate") {
    const r = await migrateBlobs({ toDb, log: (s) => console.log("  " + s) });
    const total = Object.values(r.moved).reduce((a, b) => a + b, 0);
    console.log(`Moved ${total} item(s), ${(r.bytes / 1048576).toFixed(1)} MB ${toDb ? "back into the database" : "to the object store"}.`);
  } else if (cmd === "sweep") {
    const r = await sweepOrphanBlobs();
    console.log(`Scanned ${r.scanned} object(s), deleted ${r.deleted} orphan(s).`);
  } else {
    console.log("usage: blobs migrate [--to-db] | blobs sweep");
    process.exitCode = 1;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await closeDb();
}
