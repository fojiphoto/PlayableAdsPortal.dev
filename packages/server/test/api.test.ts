import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import JSZip from "jszip";
import FormData from "form-data";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { resetDb } from "../src/db.js";
import { loadFromDir } from "@forge/packager";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(here, "..", "..", "packager", "test", "fixtures", "sample-playable");

async function fixtureZip(): Promise<Buffer> {
  const src = await loadFromDir(fixtureDir);
  const zip = new JSZip();
  for (const [p, bytes] of Object.entries(src.files)) zip.file(p, bytes);
  return zip.generateAsync({ type: "nodebuffer" });
}

let app: FastifyInstance;

beforeAll(async () => {
  resetDb();
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(() => {
  resetDb();
});

async function signup(email = "dev@factorialstudio.com", password = "secret123"): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/signup", payload: { email, password } });
  expect(res.statusCode).toBe(201);
  return res.json().token;
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

describe("health + networks", () => {
  it("is healthy and lists 20+ networks", async () => {
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    const nets = (await app.inject({ method: "GET", url: "/api/networks" })).json();
    expect(nets.length).toBeGreaterThanOrEqual(20);
    const ids = nets.map((n: { id: string }) => n.id);
    expect(ids).toEqual(expect.arrayContaining(["applovin", "tiktok", "vungle", "meta"]));
  });
});

describe("auth", () => {
  it("signup → token, duplicate → 409, login + bad password, /me", async () => {
    const token = await signup();
    expect(token.split(".")).toHaveLength(3);

    const dup = await app.inject({ method: "POST", url: "/api/signup", payload: { email: "dev@factorialstudio.com", password: "secret123" } });
    expect(dup.statusCode).toBe(409);

    const login = await app.inject({ method: "POST", url: "/api/login", payload: { email: "dev@factorialstudio.com", password: "secret123" } });
    expect(login.statusCode).toBe(200);

    const bad = await app.inject({ method: "POST", url: "/api/login", payload: { email: "dev@factorialstudio.com", password: "wrong" } });
    expect(bad.statusCode).toBe(401);

    expect((await app.inject({ method: "GET", url: "/api/me" })).statusCode).toBe(401);
    const me = await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) });
    expect(me.json().user.email).toBe("dev@factorialstudio.com");
  });

  it("protected routes reject without a token", async () => {
    expect((await app.inject({ method: "POST", url: "/api/apps", payload: { name: "x" } })).statusCode).toBe(401);
  });
});

describe("app → concept → creative → export flow", () => {
  it("full happy path, persisted", async () => {
    const token = await signup();
    // free plan is Unity-Ads-only; switch to a paid plan to export multiple networks
    await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(token), payload: { plan: "starter" } });

    const appRes = await app.inject({ method: "POST", url: "/api/apps", headers: bearer(token), payload: { name: "Construction ASMR", platform: "ios" } });
    expect(appRes.statusCode).toBe(201);
    const appId = appRes.json().id;

    const conceptRes = await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(token), payload: { name: "castle_v2" } });
    expect(conceptRes.statusCode).toBe(201);
    const conceptId = conceptRes.json().id;

    // upload creative under the concept
    const form = new FormData();
    form.append("file", await fixtureZip(), { filename: "sample.zip", contentType: "application/zip" });
    form.append("name", "lumber");
    form.append("iosUrl", "https://apps.apple.com/app/id123");
    const upload = await app.inject({
      method: "POST",
      url: `/api/concepts/${conceptId}/creatives`,
      headers: { ...bearer(token), ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(upload.statusCode).toBe(201);
    const creativeId = upload.json().id;
    expect(upload.json().fileCount).toBeGreaterThanOrEqual(3);

    // export
    const exp = await app.inject({
      method: "POST",
      url: `/api/creatives/${creativeId}/export`,
      headers: bearer(token),
      payload: { networks: ["applovin", "meta"] },
    });
    expect(exp.statusCode).toBe(200);
    const exported = exp.json().exported;
    expect(exported).toHaveLength(2);
    for (const r of exported) expect(r.ok, JSON.stringify(r.validation)).toBe(true);

    // persisted: creative detail lists the exports
    const detail = await app.inject({ method: "GET", url: `/api/creatives/${creativeId}`, headers: bearer(token) });
    expect(detail.json().exports).toHaveLength(2);

    // download (public, UUID-guarded — no auth header)
    const dl = await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/download/applovin` });
    expect(dl.statusCode).toBe(200);
    expect(dl.body).toContain("window.PF");
    expect(dl.body).toContain("https://apps.apple.com/app/id123");

    // preview (zip network) inline html
    const prev = await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/preview/meta` });
    expect(prev.statusCode).toBe(200);
    expect(prev.headers["content-type"]).toContain("text/html");

    // download-all
    const all = await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/download-all` });
    const outZip = await JSZip.loadAsync(all.rawPayload);
    expect(Object.keys(outZip.files)).toHaveLength(2);
  });

  it("enforces ownership across users", async () => {
    const owner = await signup("owner@factorialstudio.com");
    const other = await signup("other@factorialstudio.com");

    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(owner), payload: { name: "Mine" } })).json().id;

    // other user cannot see or delete owner's app
    expect((await app.inject({ method: "GET", url: `/api/apps/${appId}`, headers: bearer(other) })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/api/apps/${appId}`, headers: bearer(other) })).statusCode).toBe(404);
    // owner can
    expect((await app.inject({ method: "GET", url: `/api/apps/${appId}`, headers: bearer(owner) })).statusCode).toBe(200);
  });
});

describe("billing / plan enforcement", () => {
  async function setupCreative(token: string): Promise<string> {
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(token), payload: { name: "A" } })).json().id;
    const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(token), payload: { name: "c" } })).json().id;
    const form = new FormData();
    form.append("file", await fixtureZip(), { filename: "s.zip", contentType: "application/zip" });
    const up = await app.inject({
      method: "POST",
      url: `/api/concepts/${conceptId}/creatives`,
      headers: { ...bearer(token), ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    return up.json().id as string;
  }

  it("lists 4 plans; new users default to free", async () => {
    const token = await signup();
    expect((await app.inject({ method: "GET", url: "/api/billing/plans" })).json()).toHaveLength(4);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) })).json().plan).toBe("free");
  });

  it("free plan blocks non-Unity networks, allows Unity Ads", async () => {
    const token = await signup();
    const cid = await setupCreative(token);
    const blocked = await app.inject({ method: "POST", url: `/api/creatives/${cid}/export`, headers: bearer(token), payload: { networks: ["applovin"] } });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().code).toBe("network-not-in-plan");
    const ok = await app.inject({ method: "POST", url: `/api/creatives/${cid}/export`, headers: bearer(token), payload: { networks: ["unityads"] } });
    expect(ok.statusCode).toBe(200);
  });

  it("upgrading unlocks all networks and counts usage", async () => {
    const token = await signup();
    const cid = await setupCreative(token);
    await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(token), payload: { plan: "starter" } });
    const ok = await app.inject({ method: "POST", url: `/api/creatives/${cid}/export`, headers: bearer(token), payload: { networks: ["applovin", "meta"] } });
    expect(ok.statusCode).toBe(200);
    const me = (await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) })).json();
    expect(me.plan).toBe("starter");
    expect(me.used).toBe(2);
    expect(me.limit).toBe(30);
  });
});
