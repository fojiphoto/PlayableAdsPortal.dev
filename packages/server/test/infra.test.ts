import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import FormData from "form-data";
import type { FastifyInstance } from "fastify";
import { loadFromDir } from "@forge/packager";
import { buildApp } from "../src/app.js";
import { db, openDatabase, resetDb, toPostgresSql } from "../src/db.js";
import { FsStore, S3Store, setBlobStoreForTests } from "../src/blobstore.js";
import { migrateBlobs, sweepOrphanBlobs } from "../src/blob-maintenance.js";
import { copyDatabase } from "../src/scripts/copy-database.js";
import { rateLimit, resetRateLimits } from "../src/rate-limit.js";
import { config } from "../src/config.js";
import { claimNextJob, createJob, getUserByEmail, recoverStaleJobs, setDomainVerified, setSettingIfAbsent, setUserDomain, takeLease } from "../src/repo.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "..", "packager", "test", "fixtures", "sample-playable");
async function fixtureZip(): Promise<Buffer> {
  const src = await loadFromDir(fixtureDir);
  const zip = new JSZip();
  for (const [p, bytes] of Object.entries(src.files)) zip.file(p, bytes);
  return zip.generateAsync({ type: "nodebuffer" });
}

let app: FastifyInstance;
const tmpDirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "forge-blobs-"));
  tmpDirs.push(d);
  return d;
};

beforeAll(async () => {
  await resetDb();
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});
beforeEach(async () => {
  await resetDb();
  await resetRateLimits();
  setBlobStoreForTests(null);
  config.rateLimitStore = "";
});

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
async function studio(email: string) {
  const token = (await app.inject({ method: "POST", url: "/api/signup", payload: { email, password: "secret123" } })).json().token as string;
  const u = (await getUserByEmail(email))!;
  await setUserDomain(u.id, "factorialstudio.dev", "t");
  await setDomainVerified(u.id, 1);
  await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(token), payload: { plan: "studio" } });
  const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(token), payload: { name: "Infra" } })).json().id as string;
  const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(token), payload: { name: "c" } })).json().id as string;
  const form = new FormData();
  form.append("file", await fixtureZip(), { filename: "sample.zip", contentType: "application/zip" });
  const creativeId = (await app.inject({ method: "POST", url: `/api/concepts/${conceptId}/creatives`, headers: { ...bearer(token), ...form.getHeaders() }, payload: form.getBuffer() })).json().id as string;
  const exp = await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: bearer(token), payload: { networks: ["applovin", "meta"] } });
  expect(exp.statusCode).toBe(200);
  return { token, appId, conceptId, creativeId };
}
const PNG = "data:image/png;base64," + Buffer.from("logo-bytes-for-tests").toString("base64");

describe("Postgres dialect translation", () => {
  it("rewrites placeholders outside quotes and INSERT OR IGNORE", () => {
    expect(toPostgresSql("SELECT * FROM t WHERE a = ? AND b = '?' AND c = ?")).toBe("SELECT * FROM t WHERE a = $1 AND b = '?' AND c = $2");
    expect(toPostgresSql("INSERT OR IGNORE INTO t (a) VALUES (?)")).toBe("INSERT INTO t (a) VALUES ($1) ON CONFLICT DO NOTHING");
  });
});

describe("blob stores", () => {
  it("fs: put/get/overwrite/delete/list, and refuses keys that escape the root", async () => {
    const s = new FsStore(tmp());
    await s.put("exports/c1/applovin", new Uint8Array([1, 2, 3]));
    await s.put("exports/c1/applovin", new Uint8Array([4, 5]));
    expect([...(await s.get("exports/c1/applovin"))!]).toEqual([4, 5]);
    expect(await s.get("exports/c1/missing")).toBeUndefined();
    const keys: string[] = [];
    for await (const o of s.list("exports/")) keys.push(o.key);
    expect(keys).toEqual(["exports/c1/applovin"]);
    await s.delete("exports/c1/applovin");
    expect(await s.get("exports/c1/applovin")).toBeUndefined();
    await expect(s.put("../escape", new Uint8Array(1))).rejects.toThrow(/invalid blob key/);
  });

  it("s3: SigV4-signed, path-style requests; retries 5xx; 404 is 'missing'; other 4xx fail fast; lists pages", async () => {
    const objects = new Map<string, Buffer>();
    const seen: { method: string; url: string; auth: string; sha: string; bodySha: string }[] = [];
    let failNextPut = 1;
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        seen.push({
          method: req.method!,
          url: req.url!,
          auth: String(req.headers.authorization ?? ""),
          sha: String(req.headers["x-amz-content-sha256"] ?? ""),
          bodySha: createHash("sha256").update(body).digest("hex"),
        });
        const u = new URL(req.url!, "http://x");
        if (!u.pathname.startsWith("/adlab-bucket")) return void res.writeHead(404).end();
        if (u.searchParams.get("list-type") === "2") {
          const prefix = u.searchParams.get("prefix") ?? "";
          const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
          const start = u.searchParams.get("continuation-token") ? Number(u.searchParams.get("continuation-token")) : 0;
          const page = all.slice(start, start + 1); // 1 per page, to exercise continuation
          const more = start + 1 < all.length;
          res.writeHead(200, { "content-type": "application/xml" });
          return void res.end(
            `<ListBucketResult>${page.map((k) => `<Contents><Key>${k.replace(/&/g, "&amp;")}</Key><LastModified>2020-01-01T00:00:00.000Z</LastModified></Contents>`).join("")}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + 1}</NextContinuationToken>` : ""}</ListBucketResult>`,
          );
        }
        const key = decodeURIComponent(u.pathname.slice("/adlab-bucket/".length));
        if (key.endsWith("forbidden")) return void res.writeHead(403).end("AccessDenied");
        if (req.method === "PUT") {
          if (failNextPut-- > 0) return void res.writeHead(503).end("SlowDown");
          objects.set(key, body);
          return void res.writeHead(200).end();
        }
        if (req.method === "GET") return objects.has(key) ? void res.writeHead(200).end(objects.get(key)) : void res.writeHead(404).end("NoSuchKey");
        if (req.method === "DELETE") {
          objects.delete(key);
          return void res.writeHead(204).end();
        }
        res.writeHead(400).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    try {
      const port = (server.address() as AddressInfo).port;
      const s = new S3Store({ endpoint: `http://127.0.0.1:${port}`, bucket: "adlab-bucket", region: "auto", accessKeyId: "AKIDTEST", secretAccessKey: "secret", prefix: "prod" });
      await s.put("exports/c1/meta", new Uint8Array([9, 8, 7]), "application/zip");
      const put = seen.filter((x) => x.method === "PUT");
      expect(put).toHaveLength(2); // one 503, then the retry
      expect(put[1]!.url).toBe("/adlab-bucket/prod/exports/c1/meta");
      expect(put[1]!.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDTEST\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=[a-z0-9;-]*x-amz-content-sha256[a-z0-9;-]*, Signature=[0-9a-f]{64}$/);
      expect(put[1]!.sha).toBe(put[1]!.bodySha); // signed over the real payload
      expect([...(await s.get("exports/c1/meta"))!]).toEqual([9, 8, 7]);
      expect(await s.get("exports/c1/none")).toBeUndefined();
      await s.put("exports/c2/meta", new Uint8Array([1]));
      const listed: string[] = [];
      for await (const o of s.list("exports/")) listed.push(o.key);
      expect(listed).toEqual(["exports/c1/meta", "exports/c2/meta"]); // prefix stripped, both pages read
      await s.delete("exports/c1/meta");
      expect(await s.get("exports/c1/meta")).toBeUndefined();
      const before = seen.length;
      await expect(s.get("forbidden")).rejects.toThrow(/403/);
      expect(seen.length - before).toBe(1); // no retries on 4xx
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  });
});

describe("app data in an object store", () => {
  it("creatives, exports, uploads and kit logos live in the store; rows keep only keys; everything reads back", async () => {
    const root = tmp();
    const store = new FsStore(root);
    setBlobStoreForTests(store);
    const { token, creativeId } = await studio("store@factorialstudio.com");

    const cr = (await db().prepare("SELECT length(source_zip) AS n, source_key FROM creatives WHERE id = ?").get<{ n: number; source_key: string }>(creativeId))!;
    expect(Number(cr.n)).toBe(0);
    expect(cr.source_key).toBe(`creatives/${creativeId}/source.zip`);
    const ex = await db().prepare("SELECT network, length(bytes) AS n, bytes_key FROM exports WHERE creative_id = ? ORDER BY network").all<{ network: string; n: number; bytes_key: string }>(creativeId);
    expect(ex.map((e) => [e.network, Number(e.n), e.bytes_key])).toEqual([
      ["applovin", 0, `exports/${creativeId}/applovin`],
      ["meta", 0, `exports/${creativeId}/meta`],
    ]);
    expect(existsSync(join(root, "exports", creativeId, "applovin"))).toBe(true);

    // reads come back from the store: preview, single download, download-all, re-export from the stored source
    expect((await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/preview/applovin?host=0` })).body).toContain("window.PF");
    expect((await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/download/meta` })).rawPayload.subarray(0, 2).toString()).toBe("PK");
    const all = await JSZip.loadAsync((await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/download-all` })).rawPayload);
    expect(Object.keys(all.files).sort()).toEqual(["sample_applovin.html", "sample_meta.zip"]);
    expect((await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: bearer(token), payload: { networks: ["tiktok"] } })).statusCode).toBe(200);

    // kit logos: stored, replaced in place, removed
    const kit = (await app.inject({ method: "POST", url: "/api/kits", headers: bearer(token), payload: { name: "K", logoDataUri: PNG } })).json();
    expect(kit.logoDataUri).toBe(PNG);
    const kr = (await db().prepare("SELECT logo, logo_key FROM preloader_kits WHERE id = ?").get<{ logo: unknown; logo_key: string }>(kit.id))!;
    expect(kr).toMatchObject({ logo: null, logo_key: `kits/${kit.id}/logo` });
    expect((await app.inject({ method: "GET", url: "/api/kits", headers: bearer(token) })).json().kits[0].logoDataUri).toBe(PNG);
    const renamed = (await app.inject({ method: "PATCH", url: `/api/kits/${kit.id}`, headers: bearer(token), payload: { name: "K2" } })).json();
    expect(renamed).toMatchObject({ name: "K2", logoDataUri: PNG }); // untouched logo stays in the store
    await app.inject({ method: "PATCH", url: `/api/kits/${kit.id}`, headers: bearer(token), payload: { logoDataUri: null } });
    expect(existsSync(join(root, "kits", kit.id, "logo"))).toBe(false);

    // deleting a creative deletes its objects
    expect((await app.inject({ method: "DELETE", url: `/api/creatives/${creativeId}`, headers: bearer(token) })).statusCode).toBe(200);
    expect(existsSync(join(root, "creatives", creativeId, "source.zip"))).toBe(false);
    expect(existsSync(join(root, "exports", creativeId, "applovin"))).toBe(false);
  });

  it("the sweep removes objects orphaned by cascading deletes (and leaves referenced/new ones)", async () => {
    const root = tmp();
    setBlobStoreForTests(new FsStore(root));
    const keep = await studio("sweep-keep@factorialstudio.com");
    const gone = await studio("sweep-gone@factorialstudio.com");
    // deleting the app cascades in the database; the store can't know
    expect((await app.inject({ method: "DELETE", url: `/api/apps/${gone.appId}`, headers: bearer(gone.token) })).statusCode).toBe(200);
    expect(existsSync(join(root, "creatives", gone.creativeId, "source.zip"))).toBe(true);
    expect((await sweepOrphanBlobs(60_000)).deleted).toBe(0); // too new: could be an in-flight upload
    const r = await sweepOrphanBlobs(0);
    expect(r.deleted).toBe(3); // source + 2 exports
    expect(existsSync(join(root, "creatives", gone.creativeId, "source.zip"))).toBe(false);
    expect(existsSync(join(root, "creatives", keep.creativeId, "source.zip"))).toBe(true);
  });

  it("migrate: inline → store while serving, and back again", async () => {
    const { creativeId, token } = await studio("migrate@factorialstudio.com"); // created with no store: inline
    await app.inject({ method: "POST", url: "/api/kits", headers: bearer(token), payload: { name: "K", logoDataUri: PNG } });
    const root = tmp();
    setBlobStoreForTests(new FsStore(root));
    const out = await migrateBlobs();
    expect(out.moved).toEqual({ creatives: 1, exports: 2, uploads: 0, preloader_kits: 1 });
    expect(Number((await db().prepare("SELECT COUNT(*) AS n FROM exports WHERE bytes_key IS NULL").get<{ n: number }>())!.n)).toBe(0);
    expect((await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/download/applovin` })).body).toContain("window.PF");
    expect((await migrateBlobs()).moved.exports).toBe(0); // idempotent

    const back = await migrateBlobs({ toDb: true });
    expect(back.moved).toEqual({ creatives: 1, exports: 2, uploads: 0, preloader_kits: 1 });
    setBlobStoreForTests(null); // the store can go away now
    expect((await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/download/applovin` })).body).toContain("window.PF");
    expect((await app.inject({ method: "GET", url: "/api/kits", headers: bearer(token) })).json().kits[0].logoDataUri).toBe(PNG);
  });
});

describe("copy to Postgres", () => {
  it("copies every table parents-first, verifies counts, keeps bytes, and won't merge into a non-empty target", async () => {
    const { creativeId } = await studio("copy@factorialstudio.com");
    const target = await openDatabase({ driver: "pglite" });
    try {
      const r = await copyDatabase(db(), target);
      const count = async (t: string) => Number((await target.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get<{ n: number }>())!.n);
      expect(await count("users")).toBe(1);
      expect(await count("exports")).toBe(2);
      expect(r.tables.find((t) => t.table === "creatives")!.rows).toBe(1);
      const srcZip = (await db().prepare("SELECT source_zip FROM creatives WHERE id = ?").get<{ source_zip: Uint8Array }>(creativeId))!.source_zip;
      const dstZip = (await target.prepare("SELECT source_zip FROM creatives WHERE id = ?").get<{ source_zip: Uint8Array }>(creativeId))!.source_zip;
      expect(Buffer.from(dstZip).equals(Buffer.from(srcZip))).toBe(true);
      await expect(copyDatabase(db(), target)).rejects.toThrow(/already has data/);
      expect((await copyDatabase(db(), target, { replace: true })).totalRows).toBe(r.totalRows);
    } finally {
      await target.close();
    }
  });
});

describe("shared state for several instances", () => {
  it("rate limits in the database: atomic per window, shared, expiring", async () => {
    config.rateLimitStore = "db";
    expect(await rateLimit("t:1", 2, 60_000)).toBe(true);
    expect(await rateLimit("t:1", 2, 60_000)).toBe(true);
    expect(await rateLimit("t:1", 2, 60_000)).toBe(false);
    expect(Number((await db().prepare("SELECT count FROM rate_limits WHERE key = 't:1'").get<{ count: number }>())!.count)).toBe(3);
    await db().prepare("UPDATE rate_limits SET reset_at = 0 WHERE key = 't:1'").run(); // window over
    expect(await rateLimit("t:1", 2, 60_000)).toBe(true);
    // concurrent hits never lose a count
    await Promise.all(Array.from({ length: 10 }, () => rateLimit("t:burst", 100, 60_000)));
    expect(Number((await db().prepare("SELECT count FROM rate_limits WHERE key = 't:burst'").get<{ count: number }>())!.count)).toBe(10);
  });

  it("only jobs whose heartbeat stopped are recovered", async () => {
    await app.inject({ method: "POST", url: "/api/signup", payload: { email: "beat@factorialstudio.com", password: "secret123" } });
    const u = (await getUserByEmail("beat@factorialstudio.com"))!;
    const job = await createJob(u.id, "export", {});
    expect((await claimNextJob())?.id).toBe(job.id);
    expect(await recoverStaleJobs(2, 60_000)).toBe(0); // alive on another instance
    await db().prepare("UPDATE jobs SET heartbeat_at = ? WHERE id = ?").run(new Date(Date.now() - 5 * 60_000).toISOString(), job.id);
    expect(await recoverStaleJobs(2, 60_000)).toBe(1);
  });

  it("a lease is taken once per interval; the first writer of a setting wins", async () => {
    const t = Date.now();
    expect(await takeLease("daily", 86_400_000, t)).toBe(true);
    expect(await takeLease("daily", 86_400_000, t + 1000)).toBe(false);
    expect(await takeLease("daily", 86_400_000, t + 86_400_001)).toBe(true);
    const both = await Promise.all([takeLease("race", 1000, t + 5000), takeLease("race", 1000, t + 5000)]);
    expect(both.filter(Boolean)).toHaveLength(1);
    expect(await setSettingIfAbsent("k", "first")).toBe("first");
    expect(await setSettingIfAbsent("k", "second")).toBe("first");
  });
});
