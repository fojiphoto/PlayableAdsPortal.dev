import { columnsOf, TABLE_ORDER, tableNames, type Database } from "../db.js";

/**
 * Copy every row from one database into another (SQLite → Postgres for the move to a managed DB; any
 * direction works). Tables go parents-first so foreign keys hold, in pages of `pageSize`, inside one
 * transaction on the target — a failure leaves the target untouched. Columns are matched by name, so a
 * source from an older version (fewer columns) copies fine. Row counts are verified at the end.
 */
export interface CopyReport {
  tables: { table: string; rows: number }[];
  totalRows: number;
}

export async function copyDatabase(
  src: Database,
  dst: Database,
  opts: { replace?: boolean; pageSize?: number; log?: (s: string) => void } = {},
): Promise<CopyReport> {
  const log = opts.log ?? (() => {});
  const pageSize = opts.pageSize ?? 500;
  const srcTables = new Set(await tableNames(src));
  const tables = TABLE_ORDER.filter((t) => srcTables.has(t) && t !== "rate_limits"); // limits are ephemeral

  // refuse to merge into a database that already has data, unless asked to replace it
  const nonEmpty: string[] = [];
  for (const t of tables) {
    const n = (await dst.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get<{ n: number }>())?.n ?? 0;
    if (Number(n)) nonEmpty.push(`${t} (${n})`);
  }
  if (nonEmpty.length && !opts.replace)
    throw new Error(`The target database already has data: ${nonEmpty.join(", ")}. Re-run with --replace to wipe it first.`);

  const report: CopyReport = { tables: [], totalRows: 0 };
  await dst.tx(async () => {
    if (nonEmpty.length) {
      // children first when deleting
      for (const t of [...tables].reverse()) await dst.prepare(`DELETE FROM ${t}`).run();
    }
    for (const t of tables) {
      const dstCols = new Set(await columnsOf(dst, t));
      const cols = (await columnsOf(src, t)).filter((c) => dstCols.has(c));
      const insert = dst.prepare(`INSERT INTO ${t} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`);
      // a stable order for paging: rowid on SQLite, the first column (the key) elsewhere
      const order = src.kind === "sqlite" ? "rowid" : cols[0]!;
      let copied = 0;
      for (let offset = 0; ; offset += pageSize) {
        const rows = await src.prepare(`SELECT ${cols.join(", ")} FROM ${t} ORDER BY ${order} LIMIT ? OFFSET ?`).all<Record<string, unknown>>(pageSize, offset);
        for (const r of rows) await insert.run(...cols.map((c) => r[c]));
        copied += rows.length;
        if (rows.length < pageSize) break;
      }
      report.tables.push({ table: t, rows: copied });
      report.totalRows += copied;
      log(`${t}: ${copied}`);
    }
  });

  // verify
  for (const { table, rows } of report.tables) {
    const n = Number((await dst.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get<{ n: number }>())?.n ?? 0);
    if (n !== rows) throw new Error(`Verification failed for ${table}: copied ${rows}, target has ${n}`);
  }
  return report;
}
