/**
 * Move the app's data from its SQLite file to Postgres (gap #16).
 *
 *   FORGE_DB=/data/forge.db DATABASE_URL=postgres://… npm run db:to-postgres -w @forge/server [-- --replace]
 *
 * Stop the app (or put it in maintenance) first so nothing is written while copying. The Postgres schema
 * is created automatically. Afterwards keep DATABASE_URL set and restart: the app now runs on Postgres.
 * The SQLite file is left untouched as a backup.
 */
import { existsSync } from "node:fs";
import { config } from "../config.js";
import { openDatabase } from "../db.js";
import { copyDatabase } from "./copy-database.js";

const replace = process.argv.includes("--replace");
const sqlitePath = process.env.SQLITE_PATH ?? config.dbPath;
if (!config.databaseUrl) {
  console.error("Set DATABASE_URL to the target Postgres database.");
  process.exit(1);
}
if (!existsSync(sqlitePath)) {
  console.error(`SQLite database not found at ${sqlitePath} (set FORGE_DB or SQLITE_PATH).`);
  process.exit(1);
}

const src = await openDatabase({ driver: "sqlite", path: sqlitePath });
const dst = await openDatabase({ driver: "postgres", url: config.databaseUrl });
try {
  console.log(`Copying ${sqlitePath} → Postgres…`);
  const r = await copyDatabase(src, dst, { replace, log: (s) => console.log("  " + s) });
  console.log(`Done: ${r.totalRows} rows in ${r.tables.length} tables, counts verified.`);
} catch (e) {
  console.error(`Copy failed, nothing was changed in Postgres: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await src.close();
  await dst.close();
}
