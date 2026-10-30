import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import JSZip from "jszip";
import FormData from "form-data";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { resetDb } from "../src/db.js";
import { getUserByEmail, setDomainVerified, setUserDomain, setStripeCustomer, setUserBilling, createJob, claimNextJob, recoverStaleJobs, getJob } from "../src/repo.js";
import { drainJobs } from "../src/jobs.js";
import { outbox, clearOutbox } from "../src/mail.js";
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
  clearOutbox();
});

/** Pull the one-time token out of the last dev-outbox mail's link (?reset=… / ?verify=…). */
function tokenFromMail(kind: "reset" | "verify", to?: string): string {
  const m = [...outbox].reverse().find((x) => (!to || x.to === to) && x.html.includes(`?${kind}=`));
  if (!m) throw new Error(`no ${kind} mail in outbox`);
  const match = m.html.match(new RegExp(`[?&]${kind}=([a-f0-9]+)`));
  if (!match) throw new Error(`no ${kind} token in mail`);
  return match[1]!;
}

async function signup(email = "dev@factorialstudio.com", password = "secret123"): Promise<string> {
  const res = await app.inject({ method: "POST", url: "/api/signup", payload: { email, password } });
  expect(res.statusCode).toBe(201);
  return res.json().token;
}
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
/** Exports are gated on a verified company domain — mark the user verified (as /api/domain/check would). */
function verifyDomain(email = "dev@factorialstudio.com"): void {
  const u = getUserByEmail(email)!;
  setUserDomain(u.id, "factorialstudio.dev", "fav-test");
  setDomainVerified(u.id, 1);
}

describe("health + networks", () => {
  it("is healthy and lists all 29 networks (competitor's 27 + extras)", async () => {
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    const nets = (await app.inject({ method: "GET", url: "/api/networks" })).json();
    expect(nets.length).toBeGreaterThanOrEqual(29);
    const ids = nets.map((n: { id: string }) => n.id);
    expect(ids).toEqual(
      expect.arrayContaining(["applovin", "tiktok", "vungle", "meta", "remerge", "tencent", "aarki", "line", "appreciate", "revx", "adikteev", "youappi", "mraid"]),
    );
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
    verifyDomain();
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

describe("account: password + 2FA", () => {
  it("changes password (wrong current rejected)", async () => {
    const token = await signup("pw@factorialstudio.com", "secret123");
    const bad = await app.inject({ method: "POST", url: "/api/users/password", headers: bearer(token), payload: { currentPassword: "wrong", newPassword: "newpass1" } });
    expect(bad.statusCode).toBe(401);
    const ok = await app.inject({ method: "POST", url: "/api/users/password", headers: bearer(token), payload: { currentPassword: "secret123", newPassword: "newpass1" } });
    expect(ok.statusCode).toBe(200);
    // old password no longer works, new one does
    expect((await app.inject({ method: "POST", url: "/api/login", payload: { email: "pw@factorialstudio.com", password: "secret123" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/login", payload: { email: "pw@factorialstudio.com", password: "newpass1" } })).statusCode).toBe(200);
  });

  it("enables 2FA and then requires a code at login", async () => {
    const { generateToken } = await import("../src/totp.js");
    const token = await signup("tfa@factorialstudio.com", "secret123");

    const begin = await app.inject({ method: "POST", url: "/api/2fa/begin", headers: bearer(token) });
    const secret = begin.json().secret as string;
    expect(secret.length).toBeGreaterThan(10);

    // wrong code rejected, correct code enables
    expect((await app.inject({ method: "POST", url: "/api/2fa/confirm", headers: bearer(token), payload: { code: "000000" } })).statusCode).toBe(400);
    const confirm = await app.inject({ method: "POST", url: "/api/2fa/confirm", headers: bearer(token), payload: { code: generateToken(secret) } });
    expect(confirm.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/2fa/status", headers: bearer(token) })).json().enabled).toBe(true);

    // login now needs the code
    const noCode = await app.inject({ method: "POST", url: "/api/login", payload: { email: "tfa@factorialstudio.com", password: "secret123" } });
    expect(noCode.statusCode).toBe(401);
    expect(noCode.json().code).toBe("2fa-required");
    const withCode = await app.inject({ method: "POST", url: "/api/login", payload: { email: "tfa@factorialstudio.com", password: "secret123", code: generateToken(secret) } });
    expect(withCode.statusCode).toBe(200);

    // disable
    const dis = await app.inject({ method: "POST", url: "/api/2fa/disable", headers: bearer(token), payload: { code: generateToken(secret) } });
    expect(dis.statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/2fa/status", headers: bearer(token) })).json().enabled).toBe(false);
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
    verifyDomain();
    const cid = await setupCreative(token);
    const blocked = await app.inject({ method: "POST", url: `/api/creatives/${cid}/export`, headers: bearer(token), payload: { networks: ["applovin"] } });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().code).toBe("network-not-in-plan");
    const ok = await app.inject({ method: "POST", url: `/api/creatives/${cid}/export`, headers: bearer(token), payload: { networks: ["unityads"] } });
    expect(ok.statusCode).toBe(200);
  });

  it("upgrading unlocks all networks and counts usage", async () => {
    const token = await signup();
    verifyDomain();
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

describe("capture → creative (Phase 2.1)", () => {
  // 1x1 JPEG — a real image the canvas player can decode
  const FRAME = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////" +
      "////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAA" +
      "AAAAAAAAAAP/aAAgBAQABPxA=",
    "base64",
  );

  it("builds a flipbook playable from an uploaded frame sequence, then exports it", async () => {
    const token = await signup("cap@factorialstudio.com");
    verifyDomain("cap@factorialstudio.com");
    await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(token), payload: { plan: "starter" } });
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(token), payload: { name: "Beat Matrix" } })).json().id;
    const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(token), payload: { name: "hop" } })).json().id;

    const form = new FormData();
    for (let i = 0; i < 10; i++) form.append("frames", FRAME, { filename: `frame_${String(i).padStart(3, "0")}.jpg`, contentType: "image/jpeg" });
    form.append("name", "Hop Ball 3D");
    form.append("fps", "24");
    form.append("endCardCta", "Install");

    const cap = await app.inject({
      method: "POST",
      url: `/api/concepts/${conceptId}/capture`,
      headers: { ...bearer(token), ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(cap.statusCode).toBe(201);
    expect(cap.json().source).toBe("capture");
    expect(cap.json().frameCount).toBe(10);
    const creativeId = cap.json().id;

    // the built capture playable flows through the normal export pipeline
    const exp = await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: bearer(token), payload: { networks: ["applovin"] } });
    expect(exp.statusCode).toBe(200);
    expect(exp.json().exported[0].ok).toBe(true);

    const prev = await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/preview/applovin` });
    expect(prev.body).toContain("<canvas");
    expect(prev.body).toContain("window.PF");
    expect(prev.body).toContain("Install");
  });

  it("authors a tap zone + rich end-card (Phase 2.2) into the built playable", async () => {
    const token = await signup("cap22@factorialstudio.com");
    verifyDomain("cap22@factorialstudio.com");
    await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(token), payload: { plan: "starter" } });
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(token), payload: { name: "Beat Matrix" } })).json().id;
    const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(token), payload: { name: "hop" } })).json().id;

    const form = new FormData();
    for (let i = 0; i < 6; i++) form.append("frames", FRAME, { filename: `frame_${String(i).padStart(3, "0")}.jpg`, contentType: "image/jpeg" });
    form.append("name", "Hop Ball 3D");
    form.append("tapZone", JSON.stringify({ x: 0.35, y: 0.5, w: 0.3, h: 0.2, label: "Tap the ball!" }));
    form.append("requiredTaps", "2");
    form.append("endCardSubtitle", "10M downloads");
    form.append("endCardCtaBg", "#15803d");

    const cap = await app.inject({
      method: "POST",
      url: `/api/concepts/${conceptId}/capture`,
      headers: { ...bearer(token), ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(cap.statusCode).toBe(201);
    const creativeId = cap.json().id;
    await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: bearer(token), payload: { networks: ["applovin"] } });
    const prev = await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/preview/applovin` });
    expect(prev.body).toContain("Tap the ball!");
    expect(prev.body).toContain('"taps":2');
    expect(prev.body).toContain("10M downloads");
    expect(prev.body).toContain("#15803d");
    expect(prev.body).toContain("LOOP=true"); // a tap zone makes the clip loop until completed
  });

  it("rejects a capture with no frames", async () => {
    const token = await signup("cap2@factorialstudio.com");
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(token), payload: { name: "X" } })).json().id;
    const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(token), payload: { name: "c" } })).json().id;
    const form = new FormData();
    form.append("name", "empty");
    const cap = await app.inject({
      method: "POST",
      url: `/api/concepts/${conceptId}/capture`,
      headers: { ...bearer(token), ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(cap.statusCode).toBe(400);
  });
});

describe("billing: Stripe checkout + webhook", () => {
  async function sendEvent(secret: string, event: unknown) {
    const payload = JSON.stringify(event);
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
    return app.inject({
      method: "POST",
      url: "/api/billing/webhook",
      headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${sig}` },
      payload,
    });
  }

  it("checkout falls back to an instant dev switch when Stripe is unconfigured", async () => {
    const token = await signup("checkout@factorialstudio.com");
    const res = await app.inject({ method: "POST", url: "/api/billing/checkout", headers: bearer(token), payload: { plan: "starter" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().dev).toBe(true);
    expect(res.json().status.plan).toBe("starter");
  });

  it("checkout returns contact:true for enterprise", async () => {
    const token = await signup("ent@factorialstudio.com");
    const res = await app.inject({ method: "POST", url: "/api/billing/checkout", headers: bearer(token), payload: { plan: "enterprise" } });
    expect(res.json().contact).toBe(true);
  });

  it("portal is unavailable without Stripe configured", async () => {
    const token = await signup("portal@factorialstudio.com");
    const res = await app.inject({ method: "POST", url: "/api/billing/portal", headers: bearer(token), payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a webhook with a bad signature", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/billing/webhook",
      headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=deadbeef" },
      payload: JSON.stringify({ type: "ping" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("applies a verified subscription event to the user's plan", async () => {
    const WH = "whsec_test_abc";
    const PRICE = "price_studio_123";
    process.env.STRIPE_WEBHOOK_SECRET = WH;
    process.env.STRIPE_PRICE_STUDIO = PRICE;
    try {
      const token = await signup("wh@factorialstudio.com");
      const uid = (await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) })).json().user.id;

      // 1. checkout.session.completed links the Stripe customer to the user
      const link = await sendEvent(WH, { type: "checkout.session.completed", data: { object: { client_reference_id: uid, customer: "cus_1" } } });
      expect(link.statusCode).toBe(200);
      // 2. subscription.updated sets the plan from the price
      await sendEvent(WH, { type: "customer.subscription.updated", data: { object: { id: "sub_1", customer: "cus_1", status: "active", items: { data: [{ price: { id: PRICE } }] } } } });

      const me = (await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) })).json();
      expect(me.plan).toBe("studio");

      // 3. subscription.deleted downgrades back to free
      await sendEvent(WH, { type: "customer.subscription.deleted", data: { object: { customer: "cus_1" } } });
      expect((await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) })).json().plan).toBe("free");
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_PRICE_STUDIO;
    }
  });
});

describe("security hardening (audit fixes)", () => {
  it("rate-limits repeated failed logins (429)", async () => {
    await signup("brute@factorialstudio.com", "secret123");
    let got429 = false;
    for (let i = 0; i < 12; i++) {
      const r = await app.inject({ method: "POST", url: "/api/login", payload: { email: "brute@factorialstudio.com", password: "wrong" } });
      if (r.statusCode === 429) { got429 = true; break; }
    }
    expect(got429).toBe(true);
  });

  it("rejects an oversized preloader logo", async () => {
    const token = await signup("logo@factorialstudio.com");
    const form = new FormData();
    form.append("logo", Buffer.alloc(600 * 1024, 7), { filename: "big.png", contentType: "image/png" });
    form.append("enabled", "1");
    const r = await app.inject({
      method: "POST",
      url: "/api/preloader",
      headers: { ...bearer(token), ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(r.statusCode).toBe(400);
  });

  it("rejects a replayed 2FA code at login", async () => {
    const { generateToken } = await import("../src/totp.js");
    const token = await signup("replay@factorialstudio.com", "secret123");
    const secret = (await app.inject({ method: "POST", url: "/api/2fa/begin", headers: bearer(token) })).json().secret as string;
    await app.inject({ method: "POST", url: "/api/2fa/confirm", headers: bearer(token), payload: { code: generateToken(secret) } });

    const code = generateToken(secret);
    const first = await app.inject({ method: "POST", url: "/api/login", payload: { email: "replay@factorialstudio.com", password: "secret123", code } });
    expect(first.statusCode).toBe(200);
    const replay = await app.inject({ method: "POST", url: "/api/login", payload: { email: "replay@factorialstudio.com", password: "secret123", code } });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().code).toBe("2fa-replay");
  });
});

describe("quick wins: domain gate, rename/update, network order", () => {
  async function appConceptCreative(token: string) {
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(token), payload: { name: "Game", platform: "ios" } })).json().id as string;
    const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(token), payload: { name: "c1" } })).json().id as string;
    const form = new FormData();
    form.append("file", await fixtureZip(), { filename: "s.zip", contentType: "application/zip" });
    const up = await app.inject({ method: "POST", url: `/api/concepts/${conceptId}/creatives`, headers: { ...bearer(token), ...form.getHeaders() }, payload: form.getBuffer() });
    return { appId, conceptId, creativeId: up.json().id as string };
  }

  it("blocks export until the company domain is verified (403 domain-unverified)", async () => {
    const token = await signup("gate@factorialstudio.com");
    const { creativeId } = await appConceptCreative(token);
    const blocked = await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: bearer(token), payload: { networks: ["unityads"] } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe("domain-unverified");
    verifyDomain("gate@factorialstudio.com");
    const ok = await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: bearer(token), payload: { networks: ["unityads"] } });
    expect(ok.statusCode).toBe(200);
  });

  it("renames apps, concepts and creatives; updates creative store URLs", async () => {
    const token = await signup("ren@factorialstudio.com");
    const { appId, conceptId, creativeId } = await appConceptCreative(token);

    const a = await app.inject({ method: "PATCH", url: `/api/apps/${appId}`, headers: bearer(token), payload: { name: "Game Deluxe", platform: "android" } });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ name: "Game Deluxe", platform: "android" });
    expect((await app.inject({ method: "GET", url: `/api/apps/${appId}`, headers: bearer(token) })).json().name).toBe("Game Deluxe");

    const c = await app.inject({ method: "PATCH", url: `/api/concepts/${conceptId}`, headers: bearer(token), payload: { name: "castle_v3" } });
    expect(c.json().name).toBe("castle_v3");

    const cr = await app.inject({ method: "PATCH", url: `/api/creatives/${creativeId}`, headers: bearer(token), payload: { name: "lumber2", iosUrl: "https://apps.apple.com/app/id777" } });
    expect(cr.statusCode).toBe(200);
    expect(cr.json().name).toBe("lumber2");
    const detail = (await app.inject({ method: "GET", url: `/api/creatives/${creativeId}`, headers: bearer(token) })).json();
    expect(detail.name).toBe("lumber2");
    expect(detail.options.iosUrl).toBe("https://apps.apple.com/app/id777");

    // empty name rejected; other users can't rename
    expect((await app.inject({ method: "PATCH", url: `/api/apps/${appId}`, headers: bearer(token), payload: { name: "  " } })).statusCode).toBe(400);
    const other = await signup("other2@factorialstudio.com");
    expect((await app.inject({ method: "PATCH", url: `/api/apps/${appId}`, headers: bearer(other), payload: { name: "hax" } })).statusCode).toBe(404);
  });

  it("custom network order: Enterprise-only, validated, and used as the default export set", async () => {
    const token = await signup("order@factorialstudio.com");
    verifyDomain("order@factorialstudio.com");
    const { conceptId, creativeId } = await appConceptCreative(token);

    // not on Enterprise -> 402
    const denied = await app.inject({ method: "PATCH", url: `/api/concepts/${conceptId}`, headers: bearer(token), payload: { networkOrder: ["unityads", "applovin"] } });
    expect(denied.statusCode).toBe(402);
    expect(denied.json().code).toBe("network-ordering-not-in-plan");

    await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(token), payload: { plan: "enterprise" } });
    // unknown network id rejected
    expect((await app.inject({ method: "PATCH", url: `/api/concepts/${conceptId}`, headers: bearer(token), payload: { networkOrder: ["nope"] } })).statusCode).toBe(400);
    const set = await app.inject({ method: "PATCH", url: `/api/concepts/${conceptId}`, headers: bearer(token), payload: { networkOrder: ["unityads", "applovin"] } });
    expect(set.statusCode).toBe(200);
    expect(set.json().networkOrder).toEqual(["unityads", "applovin"]);

    // export with no explicit networks follows the concept's order
    const exp = await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: bearer(token), payload: {} });
    expect(exp.statusCode).toBe(200);
    expect(exp.json().exported.map((e: { network: string }) => e.network)).toEqual(["unityads", "applovin"]);
  });
});

describe("auth recovery: email verification + password reset (dev mail outbox)", () => {
  it("signup sends a verification mail; verifying flips /me.emailVerified; the link is single-use", async () => {
    const token = await signup("new@factorialstudio.com");
    expect(outbox.some((m) => m.to === "new@factorialstudio.com" && /Verify your email/.test(m.subject))).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) })).json().user.emailVerified).toBe(false);

    const vt = tokenFromMail("verify", "new@factorialstudio.com");
    expect((await app.inject({ method: "POST", url: "/api/signup/verify", payload: { token: "nope" } })).statusCode).toBe(400);
    const ok = await app.inject({ method: "POST", url: "/api/signup/verify", payload: { token: vt } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().verified).toBe(true);
    expect((await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) })).json().user.emailVerified).toBe(true);
    // consumed
    expect((await app.inject({ method: "POST", url: "/api/signup/verify", payload: { token: vt } })).statusCode).toBe(400);
  });

  it("resend issues a fresh verification mail and is rate-limited", async () => {
    const token = await signup("again@factorialstudio.com");
    clearOutbox();
    const r = await app.inject({ method: "POST", url: "/api/signup/resend", headers: bearer(token), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(outbox.filter((m) => m.to === "again@factorialstudio.com").length).toBe(1);
    let last = 200;
    for (let i = 0; i < 5; i++) {
      last = (await app.inject({ method: "POST", url: "/api/signup/resend", headers: bearer(token), payload: {} })).statusCode;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });

  it("forgot → reset: mails a one-time link, old password stops working, link can't be reused", async () => {
    await signup("lost@factorialstudio.com", "oldpass1");
    // unknown email: same 200, no mail (no account enumeration)
    expect((await app.inject({ method: "POST", url: "/api/password/forgot", payload: { email: "nobody@x.com" } })).statusCode).toBe(200);
    expect(outbox.some((m) => m.to === "nobody@x.com")).toBe(false);

    const f = await app.inject({ method: "POST", url: "/api/password/forgot", payload: { email: "lost@factorialstudio.com" } });
    expect(f.statusCode).toBe(200);
    const rt = tokenFromMail("reset", "lost@factorialstudio.com");

    expect((await app.inject({ method: "POST", url: "/api/password/reset/check", payload: { token: rt } })).json().valid).toBe(true);
    expect((await app.inject({ method: "POST", url: "/api/password/reset/check", payload: { token: "bogus" } })).json().valid).toBe(false);

    // too-short password rejected
    expect((await app.inject({ method: "POST", url: "/api/password/reset", payload: { token: rt, newPassword: "123" } })).statusCode).toBe(400);
    const done = await app.inject({ method: "POST", url: "/api/password/reset", payload: { token: rt, newPassword: "newpass9" } });
    expect(done.statusCode).toBe(200);

    expect((await app.inject({ method: "POST", url: "/api/login", payload: { email: "lost@factorialstudio.com", password: "oldpass1" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/api/login", payload: { email: "lost@factorialstudio.com", password: "newpass9" } })).statusCode).toBe(200);

    // single-use
    expect((await app.inject({ method: "POST", url: "/api/password/reset/check", payload: { token: rt } })).json().valid).toBe(false);
    expect((await app.inject({ method: "POST", url: "/api/password/reset", payload: { token: rt, newPassword: "another1" } })).statusCode).toBe(400);
  });

  it("forgot is rate-limited per ip+email", async () => {
    await signup("spam@factorialstudio.com");
    let last = 200;
    for (let i = 0; i < 8; i++) {
      last = (await app.inject({ method: "POST", url: "/api/password/forgot", payload: { email: "spam@factorialstudio.com" } })).statusCode;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe("billing state: period end, cancel/resume, sync", () => {
  const PRICE = "price_studio_state";
  const PERIOD_END = 1_900_000_000; // unix seconds
  /** A Stripe subscription as the 2025+ API shapes it (period end lives on the item). */
  const subObj = (over: Partial<{ status: string; cancel_at_period_end: boolean; price: string }> = {}) => ({
    id: "sub_1",
    object: "subscription",
    customer: "cus_1",
    status: over.status ?? "active",
    cancel_at_period_end: over.cancel_at_period_end ?? false,
    items: { data: [{ price: { id: over.price ?? PRICE }, current_period_end: PERIOD_END }] },
  });
  const seed = (email: string) => {
    const u = getUserByEmail(email)!;
    setStripeCustomer(u.id, "cus_1");
    setUserBilling(u.id, "studio", "sub_1", "active", { renewsAt: null, cancelAtPeriodEnd: false });
    return u.id;
  };
  const status = async (token: string) => (await app.inject({ method: "GET", url: "/api/billing/status", headers: bearer(token) })).json();

  it("webhook subscription.updated stores renewal date + cancel flag (items-level current_period_end)", async () => {
    const WH = "whsec_state";
    process.env.STRIPE_WEBHOOK_SECRET = WH;
    process.env.STRIPE_PRICE_STUDIO = PRICE;
    try {
      const token = await signup("state@factorialstudio.com");
      seed("state@factorialstudio.com");
      const payload = JSON.stringify({ type: "customer.subscription.updated", data: { object: subObj({ cancel_at_period_end: true }) } });
      const t = Math.floor(Date.now() / 1000);
      const sig = createHmac("sha256", WH).update(`${t}.${payload}`).digest("hex");
      const r = await app.inject({ method: "POST", url: "/api/billing/webhook", headers: { "content-type": "application/json", "stripe-signature": `t=${t},v1=${sig}` }, payload });
      expect(r.statusCode).toBe(200);
      const st = await status(token);
      expect(st.plan).toBe("studio");
      expect(st.hasSubscription).toBe(true);
      expect(st.cancelAtPeriodEnd).toBe(true);
      expect(st.renewsAt).toBe(new Date(PERIOD_END * 1000).toISOString());
      expect(st.status).toBe("active");
    } finally {
      delete process.env.STRIPE_WEBHOOK_SECRET;
      delete process.env.STRIPE_PRICE_STUDIO;
    }
  });

  it("dev mode (no Stripe): cancel drops to free immediately; resume has nothing to do", async () => {
    const token = await signup("devcancel@factorialstudio.com");
    await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(token), payload: { plan: "starter" } });
    const c = await app.inject({ method: "POST", url: "/api/billing/cancel", headers: bearer(token), payload: {} });
    expect(c.statusCode).toBe(200);
    expect(c.json().plan).toBe("free");
    expect((await app.inject({ method: "POST", url: "/api/billing/resume", headers: bearer(token), payload: {} })).statusCode).toBe(400);
  });

  it("Stripe mode: cancel/resume flip cancel_at_period_end via the API; sync reconciles from Stripe", async () => {
    const realFetch = globalThis.fetch;
    const calls: { url: string; method: string; body: string }[] = [];
    let remote = subObj(); // what "Stripe" currently holds
    process.env.STRIPE_SECRET_KEY = "sk_test_stub";
    process.env.STRIPE_PRICE_STUDIO = PRICE;
    globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = typeof init?.body === "string" ? init.body : "";
      calls.push({ url, method, body });
      if (/\/v1\/subscriptions\/sub_1$/.test(url)) {
        if (method === "POST") remote = { ...remote, cancel_at_period_end: /cancel_at_period_end=true/.test(body) };
        return new Response(JSON.stringify(remote), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: { message: "unexpected call" } }), { status: 404 });
    }) as typeof fetch;
    try {
      const token = await signup("stripestate@factorialstudio.com");
      seed("stripestate@factorialstudio.com");

      const c = await app.inject({ method: "POST", url: "/api/billing/cancel", headers: bearer(token), payload: {} });
      expect(c.statusCode).toBe(200);
      expect(c.json().cancelAtPeriodEnd).toBe(true);
      expect(c.json().plan).toBe("studio"); // access continues until period end
      expect(c.json().renewsAt).toBe(new Date(PERIOD_END * 1000).toISOString());
      expect(calls.at(-1)).toMatchObject({ method: "POST" });
      expect(calls.at(-1)!.body).toContain("cancel_at_period_end=true");

      const r = await app.inject({ method: "POST", url: "/api/billing/resume", headers: bearer(token), payload: {} });
      expect(r.statusCode).toBe(200);
      expect(r.json().cancelAtPeriodEnd).toBe(false);
      expect(calls.at(-1)!.body).toContain("cancel_at_period_end=false");

      // Stripe-side change we never got a webhook for → sync picks it up
      remote = subObj({ status: "past_due", cancel_at_period_end: true });
      const sync = await app.inject({ method: "POST", url: "/api/billing/sync", headers: bearer(token), payload: {} });
      expect(sync.statusCode).toBe(200);
      expect(sync.json().plan).toBe("free"); // past_due is not active → free
      expect(sync.json().status).toBe("past_due");
      expect(sync.json().cancelAtPeriodEnd).toBe(true);
      expect(calls.at(-1)).toMatchObject({ method: "GET" });
    } finally {
      globalThis.fetch = realFetch;
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_PRICE_STUDIO;
    }
  });
});

describe("async jobs: export runs on the worker", () => {
  /** signup → verified domain → Starter plan → app → concept → uploaded creative */
  async function creativeFor(email: string, plan: string | null = "starter") {
    const token = await signup(email);
    verifyDomain(email);
    if (plan) await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(token), payload: { plan } });
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(token), payload: { name: "Jobs App", platform: "ios" } })).json().id;
    const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(token), payload: { name: "c1" } })).json().id;
    const form = new FormData();
    form.append("file", await fixtureZip(), { filename: "sample.zip", contentType: "application/zip" });
    form.append("name", "lumber");
    const up = await app.inject({ method: "POST", url: `/api/concepts/${conceptId}/creatives`, headers: { ...bearer(token), ...form.getHeaders() }, payload: form.getBuffer() });
    expect(up.statusCode).toBe(201);
    return { token, creativeId: up.json().id as string };
  }
  const jobOf = async (token: string, id: string) => (await app.inject({ method: "GET", url: `/api/jobs/${id}`, headers: bearer(token) })).json();

  it("async:true → 202 job; worker packs it; result, persistence and quota match the sync path", async () => {
    const { token, creativeId } = await creativeFor("jobs@factorialstudio.com");
    const res = await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: bearer(token), payload: { networks: ["applovin", "meta"], async: true } });
    expect(res.statusCode).toBe(202);
    const { jobId, status, statusUrl } = res.json();
    expect(status).toBe("queued");
    expect(statusUrl).toBe(`/api/jobs/${jobId}`);

    // nothing has run yet (tests never start the loop)
    let j = await jobOf(token, jobId);
    expect(j).toMatchObject({ status: "queued", progress: 0, kind: "export" });
    expect(j.payload).toMatchObject({ creativeId, networks: ["applovin", "meta"] });
    expect((await app.inject({ method: "GET", url: `/api/creatives/${creativeId}`, headers: bearer(token) })).json().exports).toHaveLength(0);

    expect(await drainJobs()).toBe(1);

    j = await jobOf(token, jobId);
    expect(j.status).toBe("done");
    expect(j.progress).toBe(100);
    expect(j.finishedAt).toBeTruthy();
    expect(j.result.exported).toHaveLength(2);
    for (const r of j.result.exported) expect(r.ok, JSON.stringify(r.validation)).toBe(true);

    // persisted exactly like a sync export; download works
    expect((await app.inject({ method: "GET", url: `/api/creatives/${creativeId}`, headers: bearer(token) })).json().exports).toHaveLength(2);
    expect((await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/download/meta` })).statusCode).toBe(200);
    // listed for the user
    const list = (await app.inject({ method: "GET", url: "/api/jobs", headers: bearer(token) })).json();
    expect(list.map((x: { id: string }) => x.id)).toContain(jobId);

    // quota: 2 networks charged once; re-exporting the same networks via a job charges nothing more
    expect((await app.inject({ method: "GET", url: "/api/billing/status", headers: bearer(token) })).json().used).toBe(2);
    await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export?async=1`, headers: bearer(token), payload: { networks: ["applovin", "meta"] } });
    await drainJobs();
    expect((await app.inject({ method: "GET", url: "/api/billing/status", headers: bearer(token) })).json().used).toBe(2);
  });

  it("gates still answer immediately on the async path — nothing is queued", async () => {
    // free plan = Unity Ads only → 402 before any job exists
    const { token, creativeId } = await creativeFor("jobsfree@factorialstudio.com", null);
    const blocked = await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: bearer(token), payload: { networks: ["applovin"], async: true } });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().code).toBe("network-not-in-plan");
    // unknown network → 400
    const bad = await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: bearer(token), payload: { networks: ["nope"], async: true } });
    expect(bad.statusCode).toBe(400);
    expect((await app.inject({ method: "GET", url: "/api/jobs", headers: bearer(token) })).json()).toEqual([]);

    // domain not verified → 403, still no job
    const t2 = await signup("jobsnodomain@factorialstudio.com");
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(t2), payload: { name: "x", platform: "ios" } })).json().id;
    const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(t2), payload: { name: "c" } })).json().id;
    const form = new FormData();
    form.append("file", await fixtureZip(), { filename: "sample.zip", contentType: "application/zip" });
    const cid = (await app.inject({ method: "POST", url: `/api/concepts/${conceptId}/creatives`, headers: { ...bearer(t2), ...form.getHeaders() }, payload: form.getBuffer() })).json().id;
    const noDomain = await app.inject({ method: "POST", url: `/api/creatives/${cid}/export`, headers: bearer(t2), payload: { networks: ["unityads"], async: true } });
    expect(noDomain.statusCode).toBe(403);
    expect(noDomain.json().code).toBe("domain-unverified");
    expect((await app.inject({ method: "GET", url: "/api/jobs", headers: bearer(t2) })).json()).toEqual([]);
  });

  it("jobs are private to their owner; a job whose creative vanished fails with an error, not a crash", async () => {
    const { token, creativeId } = await creativeFor("jobsowner@factorialstudio.com");
    const other = await signup("jobsother@factorialstudio.com");
    const { jobId } = (await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: bearer(token), payload: { networks: ["applovin"], async: true } })).json();
    expect((await app.inject({ method: "GET", url: `/api/jobs/${jobId}`, headers: bearer(other) })).statusCode).toBe(404);

    // the creative is deleted while the job waits in the queue
    expect((await app.inject({ method: "DELETE", url: `/api/creatives/${creativeId}`, headers: bearer(token) })).statusCode).toBeLessThan(300);
    expect(await drainJobs()).toBe(1);
    const j = await jobOf(token, jobId);
    expect(j.status).toBe("failed");
    expect(j.error).toBeTruthy();
    expect(j.result).toBeNull();
  });

  it("restart recovery: interrupted running jobs are re-queued once, then failed", async () => {
    await signup("jobsrecover@factorialstudio.com");
    const u = getUserByEmail("jobsrecover@factorialstudio.com")!;
    const job = createJob(u.id, "export", { creativeId: "none" });
    expect(claimNextJob()?.id).toBe(job.id); // worker took it (attempt 1)…
    expect(getJob(job.id)!.status).toBe("running");
    expect(recoverStaleJobs()).toBe(1); // …process died → back to the queue
    expect(getJob(job.id)).toMatchObject({ status: "queued", attempts: 1 });
    expect(claimNextJob()?.id).toBe(job.id); // attempt 2 dies too
    expect(recoverStaleJobs()).toBe(1);
    expect(getJob(job.id)).toMatchObject({ status: "failed", error: "Interrupted by a server restart" });
    expect(claimNextJob()).toBeUndefined();
  });
});

describe("in-playable analytics: collector + dashboard funnel", () => {
  const UUID_RE = /^[0-9a-f-]{36}$/;
  async function creativeFor(email: string) {
    const token = await signup(email);
    verifyDomain(email);
    await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(token), payload: { plan: "studio" } });
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(token), payload: { name: "Tracked App", platform: "ios" } })).json().id;
    const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(token), payload: { name: "c1" } })).json().id;
    const form = new FormData();
    form.append("file", await fixtureZip(), { filename: "sample.zip", contentType: "application/zip" });
    form.append("name", "lumber");
    const up = await app.inject({ method: "POST", url: `/api/concepts/${conceptId}/creatives`, headers: { ...bearer(token), ...form.getHeaders() }, payload: form.getBuffer() });
    return { token, creativeId: up.json().id as string };
  }
  const hit = (creativeId: string, network: string, e: string, s: string, extra = "") =>
    app.inject({ method: "GET", url: `/api/t/${creativeId}/${network}?e=${e}&s=${s}${extra}` });

  it("exported packages carry the collector URL derived from the request host; off when tracking is disabled", async () => {
    const { token, creativeId } = await creativeFor("track@factorialstudio.com");
    const exp = await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: { ...bearer(token), host: "app.factorialstudio.dev", "x-forwarded-proto": "https" }, payload: { networks: ["applovin", "meta"] } });
    expect(exp.statusCode).toBe(200);
    const applovin = (await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/preview/applovin` })).body;
    expect(applovin).toContain(`"analytics":{"endpoint":"https://app.factorialstudio.dev/api/t","creativeId":"${creativeId}","network":"applovin"}`);
    // Meta forbids outbound requests → no beacons in that package
    const meta = (await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/preview/meta` })).body;
    expect(meta).toContain('"analytics":null');

    // user turns tracking off → next export has no collector
    const off = await app.inject({ method: "PATCH", url: "/api/analytics/settings", headers: bearer(token), payload: { enabled: false } });
    expect(off.json()).toEqual({ enabled: false });
    await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: { ...bearer(token), host: "app.factorialstudio.dev" }, payload: { networks: ["applovin"] } });
    expect((await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/preview/applovin` })).body).toContain('"analytics":null');
    expect((await app.inject({ method: "GET", url: "/api/analytics", headers: bearer(token) })).json().tracking.enabled).toBe(false);
  });

  it("collector accepts GET pixel + POST beacon, dedupes per session, ignores junk, excludes preview plays", async () => {
    const { token, creativeId } = await creativeFor("funnel@factorialstudio.com");
    expect(creativeId).toMatch(UUID_RE);

    // play 1: full funnel on AppLovin (impression fired twice → counted once)
    for (const e of ["impression", "impression", "engage", "start", "complete", "cta"]) {
      const r = await hit(creativeId, "applovin", e, "sessA1");
      expect(r.statusCode).toBe(200);
      expect(r.headers["content-type"]).toContain("image/gif");
      expect(r.headers["cache-control"]).toContain("no-store");
    }
    // play 2: bounced on AppLovin (impression only), via sendBeacon-style POST with a text/plain body
    const post = await app.inject({ method: "POST", url: `/api/t/${creativeId}/applovin?e=impression&s=sessA2`, headers: { "content-type": "text/plain" }, payload: "" });
    expect(post.statusCode).toBe(204);
    // play 3: Unity Ads, engaged + custom events
    await hit(creativeId, "unityads", "impression", "sessU1");
    await hit(creativeId, "unityads", "engage", "sessU1");
    await hit(creativeId, "unityads", "custom", "sessU1", "&n=level_1");
    await hit(creativeId, "unityads", "custom", "sessU1", "&n=level_2");
    await hit(creativeId, "unityads", "custom", "sessU1", "&n=level_2");
    // our own device preview: flagged, excluded by default
    await hit(creativeId, "applovin", "impression", "sessPrev", "&p=1");
    await hit(creativeId, "applovin", "cta", "sessPrev", "&p=1");
    // junk: unknown event / bad session / unknown creative / unknown network → swallowed (never an error inside an ad)
    expect((await hit(creativeId, "applovin", "hack", "sessX")).statusCode).toBe(200);
    expect((await hit(creativeId, "applovin", "impression", "<script>")).statusCode).toBe(200);
    expect((await hit("00000000-0000-4000-8000-000000000000", "applovin", "impression", "sessX")).statusCode).toBe(200);
    expect((await hit(creativeId, "nonsense-network", "impression", "sessN1")).statusCode).toBe(200);

    const a = (await app.inject({ method: "GET", url: "/api/analytics?days=7", headers: bearer(token) })).json();
    expect(a.window).toEqual({ days: 7, includePreview: false });
    // sessions: A1, A2, U1, N1 (unknown network is kept, as "unknown") → 4 impressions; preview excluded
    expect(a.playable.impressions).toBe(4);
    expect(a.playable.engagements).toBe(2);
    expect(a.playable.starts).toBe(1);
    expect(a.playable.completes).toBe(1);
    expect(a.playable.ctaClicks).toBe(1);
    expect(a.playable.engageRate).toBe(50);
    expect(a.playable.ctr).toBe(25);
    const byNet = Object.fromEntries(a.playable.byNetwork.map((n: { network: string }) => [n.network, n]));
    expect(byNet.applovin).toMatchObject({ networkName: "AppLovin", impressions: 2, ctaClicks: 1, ctr: 50 });
    expect(byNet.unityads).toMatchObject({ impressions: 1, engagements: 1, ctaClicks: 0 });
    expect(byNet.unknown).toMatchObject({ impressions: 1 });
    expect(a.playable.byCreative).toHaveLength(1);
    expect(a.playable.byCreative[0]).toMatchObject({ creativeId, creative: "lumber", app: "Tracked App", concept: "c1", impressions: 4 });
    expect(a.playable.customEvents).toEqual([
      { name: "level_2", hits: 2, sessions: 1 },
      { name: "level_1", hits: 1, sessions: 1 },
    ]);
    // the daily series is padded to the window and today carries the plays
    expect(a.playable.daily).toHaveLength(7);
    expect(a.playable.daily.at(-1)).toMatchObject({ impressions: 4, ctaClicks: 1 });

    // include preview plays → one more impression + CTA
    const withPrev = (await app.inject({ method: "GET", url: "/api/analytics?preview=1", headers: bearer(token) })).json();
    expect(withPrev.playable.impressions).toBe(5);
    expect(withPrev.playable.ctaClicks).toBe(2);

    // per-creative drill-down; other users see nothing
    const per = await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/analytics`, headers: bearer(token) });
    expect(per.statusCode).toBe(200);
    expect(per.json()).toMatchObject({ creativeId, name: "lumber", impressions: 4, ctaClicks: 1 });
    const stranger = await signup("stranger@factorialstudio.com");
    expect((await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/analytics`, headers: bearer(stranger) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/analytics", headers: bearer(stranger) })).json().playable.impressions).toBe(0);
  });
});

describe("compile jobs: Unity WebGL build → single-file playable", () => {
  const WASM = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0, 0, 0, ...new Array(64).fill(7)]);
  async function unityBuildZip(opts: { withLoader?: boolean } = {}): Promise<Buffer> {
    const zip = new JSZip();
    zip.file("index.html", `<html><script>var config = { productName: "Hop Ball", companyName: "Factorial" };</script></html>`);
    if (opts.withLoader !== false) zip.file("Build/game.loader.js", "function createUnityInstance(c, cfg, p){ return Promise.resolve({}); }");
    zip.file("Build/game.framework.js", "var unityFramework = function(M){ return M; };");
    zip.file("Build/game.wasm", WASM);
    zip.file("Build/game.data", Buffer.concat([Buffer.from("UnityWebData1.0\0"), Buffer.alloc(300, 1)]));
    zip.file("TemplateData/style.css", "body{}");
    return zip.generateAsync({ type: "nodebuffer" });
  }
  async function setup(email: string) {
    const token = await signup(email);
    verifyDomain(email);
    await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(token), payload: { plan: "studio" } });
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(token), payload: { name: "Hop Ball", platform: "ios" } })).json().id;
    const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(token), payload: { name: "unity" } })).json().id;
    return { token, conceptId };
  }
  const multipart = (buf: Buffer, fields: Record<string, string> = {}) => {
    const form = new FormData();
    form.append("file", buf, { filename: "build.zip", contentType: "application/zip" });
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    return form;
  };

  it("upload → 202 job → worker compiles → creative with one self-contained index.html → exports", async () => {
    const { token, conceptId } = await setup("compile@factorialstudio.com");
    const form = multipart(await unityBuildZip(), { name: "hop-ball-playable", iosUrl: "https://apps.apple.com/app/id1" });
    const res = await app.inject({ method: "POST", url: `/api/concepts/${conceptId}/compile`, headers: { ...bearer(token), ...form.getHeaders() }, payload: form.getBuffer() });
    expect(res.statusCode).toBe(202);
    const { jobId, status } = res.json();
    expect(status).toBe("queued");
    expect((await app.inject({ method: "GET", url: `/api/compile/jobs/${jobId}`, headers: bearer(token) })).json().kind).toBe("compile");

    expect(await drainJobs()).toBe(1);
    const j = (await app.inject({ method: "GET", url: `/api/jobs/${jobId}`, headers: bearer(token) })).json();
    expect(j.status, j.error).toBe("done");
    const r = j.result;
    expect(r.creativeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.name).toBe("hop-ball-playable");
    expect(r.breakdown).toMatchObject({ wasm: WASM.length, streamingAssets: 0 });
    expect(r.sizeBytes).toBe(r.breakdown.embedded);
    expect(r.fitsNetworks).toContain("applovin"); // tiny fixture fits everything
    expect(r.fitsNetworks).toContain("meta");

    // the creative is a normal creative: detail works, export works, the game is inside the package
    const detail = await app.inject({ method: "GET", url: `/api/creatives/${r.creativeId}`, headers: bearer(token) });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().name).toBe("hop-ball-playable");
    const exp = await app.inject({ method: "POST", url: `/api/creatives/${r.creativeId}/export`, headers: bearer(token), payload: { networks: ["applovin", "unityads"] } });
    expect(exp.statusCode).toBe(200);
    for (const e of exp.json().exported) expect(e.ok, JSON.stringify(e.validation)).toBe(true);
    const html = (await app.inject({ method: "GET", url: `/api/creatives/${r.creativeId}/preview/applovin` })).body;
    expect(html).toContain("function createUnityInstance");
    expect(html).toContain(`var WASM="${Buffer.from(WASM).toString("base64")}"`);
    expect(html).toContain("window.PF"); // shim injected at export
    expect(html).toContain('"iosUrl":"https://apps.apple.com/app/id1"');

    // the raw upload is gone once the job finished; the concept lists the compiled creative
    const concept = (await app.inject({ method: "GET", url: `/api/concepts/${conceptId}`, headers: bearer(token) })).json();
    expect(concept.creatives.map((c: { id: string }) => c.id)).toContain(r.creativeId);
  });

  it("rejects non-zip uploads up front, and a non-Unity zip fails the job with the compiler's message", async () => {
    const { token, conceptId } = await setup("compilebad@factorialstudio.com");
    const notZip = multipart(Buffer.from("<html>hi</html>"));
    const bad = await app.inject({ method: "POST", url: `/api/concepts/${conceptId}/compile`, headers: { ...bearer(token), ...notZip.getHeaders() }, payload: notZip.getBuffer() });
    expect(bad.statusCode).toBe(400);

    const form = multipart(await unityBuildZip({ withLoader: false }));
    const res = await app.inject({ method: "POST", url: "/api/compile/jobs", headers: { ...bearer(token), ...form.getHeaders() }, payload: form.getBuffer() });
    expect(res.statusCode).toBe(404); // alias needs conceptId as a field
    const form2 = multipart(await unityBuildZip({ withLoader: false }), { conceptId });
    const res2 = await app.inject({ method: "POST", url: "/api/compile/jobs", headers: { ...bearer(token), ...form2.getHeaders() }, payload: form2.getBuffer() });
    expect(res2.statusCode).toBe(202);
    await drainJobs();
    const j = (await app.inject({ method: "GET", url: `/api/jobs/${res2.json().jobId}`, headers: bearer(token) })).json();
    expect(j.status).toBe("failed");
    expect(j.error).toContain("Not a Unity WebGL build");
    // other users cannot see the job
    const other = await signup("compileother@factorialstudio.com");
    expect((await app.inject({ method: "GET", url: `/api/compile/jobs/${res2.json().jobId}`, headers: bearer(other) })).statusCode).toBe(404);
  });
});

describe("organizations / workspaces / roles", () => {
  const ws = async (token: string) => (await app.inject({ method: "GET", url: "/api/workspaces", headers: bearer(token) })).json();
  const me = async (token: string) => (await app.inject({ method: "GET", url: "/api/me", headers: bearer(token) })).json();
  const org = async (token: string) => (await app.inject({ method: "GET", url: "/api/orgs/current", headers: bearer(token) })).json();
  const invite = (token: string, email: string, role = "member") =>
    app.inject({ method: "POST", url: "/api/orgs/current/invites", headers: bearer(token), payload: { email, role } });
  const accept = (token: string, invToken: string) => app.inject({ method: "POST", url: "/api/invites/accept", headers: bearer(token), payload: { token: invToken } });
  const switchTo = (token: string, orgId: string) => app.inject({ method: "POST", url: "/api/workspaces/switch", headers: bearer(token), payload: { orgId } });
  const inviteTokenFor = (email: string) => {
    const m = [...outbox].reverse().find((x) => x.to === email && x.html.includes("?invite="));
    if (!m) throw new Error("no invite mail for " + email);
    return m.html.match(/[?&]invite=([a-f0-9]+)/)![1]!;
  };

  it("signup creates a personal workspace; /api/me and /api/workspaces expose it", async () => {
    const token = await signup("solo@factorialstudio.com");
    const m = await me(token);
    expect(m.workspace).toMatchObject({ name: "solo's workspace", role: "owner", ownerEmail: "solo@factorialstudio.com" });
    const list = await ws(token);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ role: "owner", memberCount: 1, isCurrent: true });
    const detail = await org(token);
    expect(detail.members).toEqual([expect.objectContaining({ email: "solo@factorialstudio.com", role: "owner" })]);
    // rename (admin+), create a second workspace and switch
    expect((await app.inject({ method: "PATCH", url: "/api/orgs/current", headers: bearer(token), payload: { name: "Solo Studio" } })).json().name).toBe("Solo Studio");
    const created = await app.inject({ method: "POST", url: "/api/orgs", headers: bearer(token), payload: { name: "Side Project" } });
    expect(created.statusCode).toBe(201);
    expect((await me(token)).workspace.name).toBe("Side Project");
    expect((await ws(token)).map((w: { name: string }) => w.name).sort()).toEqual(["Side Project", "Solo Studio"]);
  });

  it("email invite → accept (no prior account) → switch → shared apps; apps are isolated per workspace", async () => {
    const owner = await signup("orgowner@factorialstudio.com");
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(owner), payload: { name: "Shared App" } })).json().id;

    // invite someone who has NO account yet
    const inv = await invite(owner, "newbie@factorialstudio.com", "member");
    expect(inv.statusCode).toBe(201);
    expect(inv.json().invites).toEqual([expect.objectContaining({ email: "newbie@factorialstudio.com", role: "member" })]);
    const raw = inviteTokenFor("newbie@factorialstudio.com");
    // public lookup tells the auth screen what the link is for
    const info = (await app.inject({ method: "GET", url: `/api/invites/${raw}` })).json();
    expect(info).toMatchObject({ org: "orgowner's workspace", email: "newbie@factorialstudio.com", role: "member", expired: false, accepted: false });

    // the wrong account cannot accept it
    const stranger = await signup("stranger2@factorialstudio.com");
    expect((await accept(stranger, raw)).statusCode).toBe(403);

    const newbie = await signup("newbie@factorialstudio.com");
    expect((await me(newbie)).workspace.name).toBe("newbie's workspace");
    const acc = await accept(newbie, raw);
    expect(acc.statusCode).toBe(200);
    expect(acc.json().workspace).toMatchObject({ name: "orgowner's workspace", role: "member" });
    expect((await accept(newbie, raw)).statusCode).toBe(410); // single use

    // now in the owner's workspace: sees the shared app
    expect((await app.inject({ method: "GET", url: `/api/apps/${appId}`, headers: bearer(newbie) })).statusCode).toBe(200);
    const list = await ws(newbie);
    expect(list).toHaveLength(2);
    const own = list.find((w: { role: string }) => w.role === "owner");
    // switch back to the personal workspace: the shared app is not visible there
    expect((await switchTo(newbie, own.id)).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/apps/${appId}`, headers: bearer(newbie) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/apps", headers: bearer(newbie) })).json()).toEqual([]);
    // cannot switch to a workspace they are not in
    expect((await switchTo(stranger, own.id)).statusCode).toBe(404);
    // owner sees 2 members; the invite is consumed
    const detail = await org(owner);
    expect(detail.members.map((m: { email: string; role: string }) => [m.email, m.role])).toEqual([
      ["orgowner@factorialstudio.com", "owner"],
      ["newbie@factorialstudio.com", "member"],
    ]);
    expect(detail.invites).toEqual([]);
  });

  it("roles are enforced: viewer reads only, member creates/exports, admin manages, owner bills; plan + quota follow the owner", async () => {
    const owner = await signup("roles-owner@factorialstudio.com");
    verifyDomain("roles-owner@factorialstudio.com");
    await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(owner), payload: { plan: "studio" } });
    const ownerOrg = (await me(owner)).workspace.id;
    const join = async (email: string, role: string) => {
      await invite(owner, email, role);
      const t = await signup(email);
      expect((await accept(t, inviteTokenFor(email))).statusCode).toBe(200);
      return t;
    };
    const viewer = await join("viewer@factorialstudio.com", "viewer");
    const member = await join("member@factorialstudio.com", "member");
    const admin = await join("admin@factorialstudio.com", "admin");

    // everyone in the workspace sees the OWNER's plan (studio), not their own free plan
    for (const t of [viewer, member, admin]) expect((await me(t)).plan).toBe("studio");

    // viewer: read yes, create no
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(member), payload: { name: "Team App", platform: "ios" } })).json().id;
    expect((await app.inject({ method: "GET", url: `/api/apps/${appId}`, headers: bearer(viewer) })).statusCode).toBe(200);
    const denied = await app.inject({ method: "POST", url: "/api/apps", headers: bearer(viewer), payload: { name: "Nope" } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({ code: "role-insufficient", role: "viewer", required: "member" });
    expect((await invite(viewer, "x@factorialstudio.com")).statusCode).toBe(403);

    // member: upload + export (domain gate uses the OWNER's verified domain; quota charged to the owner)
    const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(member), payload: { name: "c" } })).json().id;
    const form = new FormData();
    form.append("file", await fixtureZip(), { filename: "sample.zip", contentType: "application/zip" });
    const up = await app.inject({ method: "POST", url: `/api/concepts/${conceptId}/creatives`, headers: { ...bearer(member), ...form.getHeaders() }, payload: form.getBuffer() });
    expect(up.statusCode).toBe(201);
    const exp = await app.inject({ method: "POST", url: `/api/creatives/${up.json().id}/export`, headers: bearer(member), payload: { networks: ["applovin", "meta"] } });
    expect(exp.statusCode).toBe(200);
    expect((await me(owner)).used).toBe(2); // owner's allowance was spent
    expect((await me(member)).used).toBe(2); // and that is what the member sees too
    // member cannot delete, invite, or touch billing
    expect((await app.inject({ method: "DELETE", url: `/api/apps/${appId}`, headers: bearer(member) })).statusCode).toBe(403);
    expect((await invite(member, "y@factorialstudio.com")).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(member), payload: { plan: "starter" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/billing/checkout", headers: bearer(member), payload: { plan: "starter" } })).statusCode).toBe(403);

    // admin: invites members, changes roles, removes members — but not the owner, and cannot mint admins
    expect((await invite(admin, "z@factorialstudio.com", "member")).statusCode).toBe(201);
    expect((await invite(admin, "w@factorialstudio.com", "admin")).statusCode).toBe(403);
    const viewerId = (await org(admin)).members.find((m: { email: string }) => m.email === "viewer@factorialstudio.com").id;
    const ownerId = (await org(admin)).owner.id;
    expect((await app.inject({ method: "PATCH", url: `/api/orgs/current/members/${viewerId}`, headers: bearer(admin), payload: { role: "member" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: `/api/orgs/current/members/${viewerId}`, headers: bearer(admin), payload: { role: "admin" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/api/orgs/current/members/${ownerId}`, headers: bearer(admin), payload: { role: "member" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: `/api/orgs/current/members/${ownerId}`, headers: bearer(admin) })).statusCode).toBe(400);
    expect((await app.inject({ method: "DELETE", url: `/api/apps/${appId}`, headers: bearer(admin) })).statusCode).toBe(200);
    // promoted ex-viewer can now create
    expect((await app.inject({ method: "POST", url: "/api/apps", headers: bearer(viewer), payload: { name: "Now allowed" } })).statusCode).toBe(201);

    // a member leaves → falls back to their personal workspace
    const left = await app.inject({ method: "DELETE", url: "/api/orgs/current/members/me", headers: bearer(member) });
    expect(left.statusCode).toBe(200);
    expect(left.json().workspace).toMatchObject({ name: "member's workspace", role: "owner" });
    expect((await ws(member)).some((w: { id: string }) => w.id === ownerOrg)).toBe(false);

    // ownership transfer: owner → admin; old owner becomes admin
    const adminId = (await org(owner)).members.find((m: { email: string }) => m.email === "admin@factorialstudio.com").id;
    const tr = await app.inject({ method: "POST", url: "/api/orgs/current/transfer", headers: bearer(owner), payload: { userId: adminId } });
    expect(tr.statusCode).toBe(200);
    expect((await me(admin)).workspace.role).toBe("owner");
    expect((await me(owner)).workspace.role).toBe("admin");
    expect((await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(owner), payload: { plan: "starter" } })).statusCode).toBe(403);
  });

  it("migration: pre-orgs data gets a workspace, apps attach to it, legacy memberships carry over", async () => {
    const owner = await signup("legacy-owner@factorialstudio.com");
    const friend = await signup("legacy-friend@factorialstudio.com");
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(owner), payload: { name: "Old App" } })).json().id;
    const o = getUserByEmail("legacy-owner@factorialstudio.com")!;
    const f = getUserByEmail("legacy-friend@factorialstudio.com")!;
    // simulate a database from before orgs existed, then run the startup migration on it
    const { getDb, migrateOrgs } = await import("../src/db.js");
    const db = getDb();
    db.exec("DELETE FROM org_members; DELETE FROM orgs; UPDATE users SET current_org_id = NULL; UPDATE apps SET org_id = NULL");
    db.prepare("INSERT INTO memberships (id, owner_user_id, member_user_id, role, created_at) VALUES ('m1', ?, ?, 'admin', '2026-01-01T00:00:00.000Z')").run(o.id, f.id);
    migrateOrgs(db);

    expect((await me(owner)).workspace).toMatchObject({ name: "legacy-owner's workspace", role: "owner" });
    expect((await app.inject({ method: "GET", url: `/api/apps/${appId}`, headers: bearer(owner) })).statusCode).toBe(200);
    const shared = (await ws(friend)).find((w: { name: string }) => w.name === "legacy-owner's workspace");
    expect(shared).toMatchObject({ role: "admin" });
    expect((await switchTo(friend, shared.id)).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/apps/${appId}`, headers: bearer(friend) })).statusCode).toBe(200);
    // running it again changes nothing
    migrateOrgs(db);
    expect((await ws(owner)).length).toBe(1);
  });
});
