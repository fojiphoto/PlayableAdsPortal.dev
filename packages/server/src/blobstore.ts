import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { createHash } from "node:crypto";
import { AwsClient } from "aws4fetch";
import { config } from "./config.js";

/**
 * Where binary data lives (parity gap #16): uploaded sources, exported playables, compile uploads and
 * kit logos.
 *
 *   db  (default) — inline in the database row, as before. Zero setup; fine for a small team.
 *   fs            — files under BLOB_DIR (e.g. a mounted disk), keeping the database small.
 *   s3            — any S3-compatible object store: Cloudflare R2, AWS S3, Backblaze B2, MinIO.
 *
 * Rows store a key (`*_key` columns) when their bytes are external, and the inline column stays empty.
 * Reads check the key first, so a database can be migrated to an object store gradually
 * (`npm run blobs:migrate -w @forge/server`) while the app keeps running.
 */
export interface BlobStore {
  readonly kind: "fs" | "s3";
  put(key: string, bytes: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  delete(key: string): Promise<void>;
  /** every key under `prefix`, with its last-modified time (for orphan cleanup) */
  list(prefix: string): AsyncIterable<{ key: string; modified: Date }>;
}

const KEY = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,400}$/;
function checkKey(key: string): string {
  if (!KEY.test(key) || key.includes("..") || key.includes("//")) throw new Error(`invalid blob key: ${key}`);
  return key;
}

// ── local directory ──────────────────────────────────────────────────────────
class FsStore implements BlobStore {
  readonly kind = "fs" as const;
  constructor(private root: string) {}
  private path(key: string) {
    return join(this.root, ...checkKey(key).split("/"));
  }
  async put(key: string, bytes: Uint8Array): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, p); // atomic replace: readers never see half a file
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw e;
    }
  }
  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
  async *list(prefix: string): AsyncIterable<{ key: string; modified: Date }> {
    const walk = async function* (this: FsStore, dir: string): AsyncGenerator<{ key: string; modified: Date }> {
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        return;
      }
      for (const n of names) {
        const full = join(dir, n);
        const st = await stat(full);
        if (st.isDirectory()) yield* walk.call(this, full);
        else if (!n.endsWith(".tmp")) yield { key: relative(this.root, full).split(sep).join("/"), modified: st.mtime };
      }
    };
    const base = prefix ? join(this.root, ...prefix.replace(/\/$/, "").split("/")) : this.root;
    yield* walk.call(this, base);
  }
}

// ── S3-compatible (R2 / S3 / B2 / MinIO), signed with SigV4 by aws4fetch ──────
class S3Store implements BlobStore {
  readonly kind = "s3" as const;
  private aws: AwsClient;
  private base: string;
  constructor(opts: { endpoint: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; prefix: string }) {
    this.aws = new AwsClient({ accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey, service: "s3", region: opts.region });
    // path-style addressing works on R2, MinIO, B2 and AWS alike
    this.base = `${opts.endpoint.replace(/\/$/, "")}/${encodeURIComponent(opts.bucket)}`;
    this.prefix = opts.prefix ? opts.prefix.replace(/\/?$/, "/") : "";
  }
  private prefix: string;
  private url(key: string) {
    return `${this.base}/${(this.prefix + checkKey(key)).split("/").map(encodeURIComponent).join("/")}`;
  }
  /** One request with retries on network errors, 5xx and 429 (backoff 0.2 s, 0.4 s); other 4xx fail at once. */
  private async call(url: string, init: RequestInit & { expect: number[] }): Promise<Response> {
    const { expect, ...req } = init;
    let last: Error = new Error("object store unreachable");
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await new Promise((res) => setTimeout(res, 200 * 2 ** (attempt - 1)));
      let r: Response;
      try {
        r = await this.aws.fetch(url, { ...req, signal: AbortSignal.timeout(60_000) });
      } catch (e) {
        last = e instanceof Error ? e : new Error(String(e));
        continue;
      }
      if (expect.includes(r.status)) return r;
      const err = new Error(`object store ${req.method ?? "GET"} ${r.status}: ${(await r.text()).slice(0, 300)}`);
      if (r.status >= 500 || r.status === 429) {
        last = err;
        continue;
      }
      throw err;
    }
    throw last;
  }
  async put(key: string, bytes: Uint8Array, contentType = "application/octet-stream"): Promise<void> {
    // sign the real payload hash (not UNSIGNED-PAYLOAD): the store verifies the bytes it received
    const sha = createHash("sha256").update(bytes).digest("hex");
    await this.call(this.url(key), { method: "PUT", body: bytes, headers: { "content-type": contentType, "x-amz-content-sha256": sha }, expect: [200] });
  }
  async get(key: string): Promise<Uint8Array | undefined> {
    const r = await this.call(this.url(key), { method: "GET", expect: [200, 404] });
    if (r.status === 404) return undefined;
    return new Uint8Array(await r.arrayBuffer());
  }
  async delete(key: string): Promise<void> {
    await this.call(this.url(key), { method: "DELETE", expect: [200, 204, 404] });
  }
  async *list(prefix: string): AsyncIterable<{ key: string; modified: Date }> {
    let token: string | undefined;
    const full = this.prefix + prefix;
    do {
      const q = new URLSearchParams({ "list-type": "2", prefix: full, "max-keys": "1000" });
      if (token) q.set("continuation-token", token);
      const xml = await (await this.call(`${this.base}?${q}`, { method: "GET", expect: [200] })).text();
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = unxml(/<Key>([\s\S]*?)<\/Key>/.exec(m[1]!)?.[1] ?? "");
        const mod = /<LastModified>([\s\S]*?)<\/LastModified>/.exec(m[1]!)?.[1];
        if (key) yield { key: key.slice(this.prefix.length), modified: mod ? new Date(mod) : new Date(0) };
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? unxml(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1] ?? "") || undefined : undefined;
    } while (token);
  }
}
const unxml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

// ── selection ────────────────────────────────────────────────────────────────
let cached: { sig: string; store: BlobStore | null } | null = null;

/** The configured external store, or null when bytes stay inline in the database. */
export function blobStore(): BlobStore | null {
  const b = config.blobs;
  const sig = JSON.stringify(b);
  if (cached && cached.sig === sig) return cached.store;
  let store: BlobStore | null = null;
  if (b.driver === "fs") store = new FsStore(b.dir);
  else if (b.driver === "s3") {
    const missing = (["endpoint", "bucket", "accessKeyId", "secretAccessKey"] as const).filter((k) => !b.s3[k]);
    if (missing.length) throw new Error(`BLOB_STORE=s3 needs ${missing.map((m) => `S3_${m.replace(/[A-Z]/g, (c) => `_${c}`).toUpperCase()}`).join(", ")}`);
    store = new S3Store(b.s3);
  }
  cached = { sig, store };
  return store;
}

/** For tests: swap the store (or null = inline). */
export function setBlobStoreForTests(store: BlobStore | null): void {
  cached = { sig: JSON.stringify(config.blobs), store };
}

export { FsStore, S3Store };
