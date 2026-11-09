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
import { config } from "../src/config.js";
import { setAdmin } from "../src/repo.js";
import { resetRateLimits } from "../src/rate-limit.js";
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
  await resetDb();
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  await resetDb();
  clearOutbox();
  await resetRateLimits();
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
async function verifyDomain(email = "dev@factorialstudio.com"): Promise<void> {
  const u = (await getUserByEmail(email))!;
  await setUserDomain(u.id, "factorialstudio.dev", "fav-test");
  await setDomainVerified(u.id, 1);
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
    await verifyDomain();
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
    await verifyDomain();
    const cid = await setupCreative(token);
    const blocked = await app.inject({ method: "POST", url: `/api/creatives/${cid}/export`, headers: bearer(token), payload: { networks: ["applovin"] } });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().code).toBe("network-not-in-plan");
    const ok = await app.inject({ method: "POST", url: `/api/creatives/${cid}/export`, headers: bearer(token), payload: { networks: ["unityads"] } });
    expect(ok.statusCode).toBe(200);
  });

  it("upgrading unlocks all networks and counts usage", async () => {
    const token = await signup();
    await verifyDomain();
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
    await verifyDomain("cap@factorialstudio.com");
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
    await verifyDomain("cap22@factorialstudio.com");
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

  it("plugin sign-in contract: an empty code is ignored without 2FA and asks for one with it", async () => {
    const { generateToken } = await import("../src/totp.js");
    const plain = await signup("plain-plugin@factorialstudio.com", "secret123");
    expect(plain).toBeTruthy();
    // the Unity plugin always sends `code` (JsonUtility serialises an empty string)
    const ok = await app.inject({ method: "POST", url: "/api/login", headers: { "x-adlab-plugin": "0.2.0" }, payload: { email: "plain-plugin@factorialstudio.com", password: "secret123", code: "" } });
    expect(ok.statusCode).toBe(200);

    const token = await signup("tfa-plugin@factorialstudio.com", "secret123");
    const secret = (await app.inject({ method: "POST", url: "/api/2fa/begin", headers: bearer(token) })).json().secret as string;
    await app.inject({ method: "POST", url: "/api/2fa/confirm", headers: bearer(token), payload: { code: generateToken(secret) } });
    const login = (code: string) =>
      app.inject({ method: "POST", url: "/api/login", headers: { "x-adlab-plugin": "0.2.0" }, payload: { email: "tfa-plugin@factorialstudio.com", password: "secret123", code } });
    const ask = await login("");
    expect(ask.statusCode).toBe(401);
    expect(ask.json().code).toBe("2fa-required");
    expect((await login("000000")).json().code).toBe("2fa-invalid");
    expect((await login(generateToken(secret))).statusCode).toBe(200);
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
    await verifyDomain("gate@factorialstudio.com");
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
    await verifyDomain("order@factorialstudio.com");
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
  const seed = async (email: string) => {
    const u = (await getUserByEmail(email))!;
    await setStripeCustomer(u.id, "cus_1");
    await setUserBilling(u.id, "studio", "sub_1", "active", { renewsAt: null, cancelAtPeriodEnd: false });
    return u.id;
  };
  const status = async (token: string) => (await app.inject({ method: "GET", url: "/api/billing/status", headers: bearer(token) })).json();

  it("webhook subscription.updated stores renewal date + cancel flag (items-level current_period_end)", async () => {
    const WH = "whsec_state";
    process.env.STRIPE_WEBHOOK_SECRET = WH;
    process.env.STRIPE_PRICE_STUDIO = PRICE;
    try {
      const token = await signup("state@factorialstudio.com");
      await seed("state@factorialstudio.com");
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
      await seed("stripestate@factorialstudio.com");

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
    await verifyDomain(email);
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
    const u = (await getUserByEmail("jobsrecover@factorialstudio.com"))!;
    const job = await createJob(u.id, "export", { creativeId: "none" });
    expect((await claimNextJob())?.id).toBe(job.id); // worker took it (attempt 1)…
    expect((await getJob(job.id))!.status).toBe("running");
    expect(await recoverStaleJobs()).toBe(1); // …process died → back to the queue
    expect(await getJob(job.id)).toMatchObject({ status: "queued", attempts: 1 });
    expect((await claimNextJob())?.id).toBe(job.id); // attempt 2 dies too
    expect(await recoverStaleJobs()).toBe(1);
    expect(await getJob(job.id)).toMatchObject({ status: "failed", error: "Interrupted by a server restart" });
    expect(await claimNextJob()).toBeUndefined();
  });
});

describe("in-playable analytics: collector + dashboard funnel", () => {
  const UUID_RE = /^[0-9a-f-]{36}$/;
  async function creativeFor(email: string) {
    const token = await signup(email);
    await verifyDomain(email);
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
      { name: "level_2", hits: 2, sessions: 1, total: null },
      { name: "level_1", hits: 1, sessions: 1, total: null },
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
    await verifyDomain(email);
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

describe("support, feedback, contact, admin console, reminders", () => {
  const makeAdmin = async (email: string) => {
    const t = await signup(email);
    await setAdmin((await getUserByEmail(email))!.id, true);
    return t;
  };
  const get = (url: string, token?: string) => app.inject({ method: "GET", url, headers: token ? bearer(token) : {} });
  const post = (url: string, payload: Record<string, unknown>, token?: string) => app.inject({ method: "POST", url, headers: token ? bearer(token) : {}, payload });

  it("public contact form: validation, honeypot, admin inbox, handled; non-admins are refused", async () => {
    expect((await post("/api/contact", { name: "Ana", email: "not-an-email", message: "hi" })).statusCode).toBe(400);
    expect((await post("/api/contact", { name: "", email: "a@b.co", message: "hi" })).statusCode).toBe(400);
    // honeypot filled → silently "ok", nothing stored
    expect((await post("/api/contact", { name: "Bot", email: "bot@spam.co", message: "buy", website: "http://spam" })).json()).toEqual({ ok: true });
    const ok = await post("/api/contact", { name: "Ana Lee", email: "Ana@Studio.co", company: "Studio Co", message: "We need 500 exports/month." });
    expect(ok.statusCode).toBe(201);
    // the support inbox is notified
    expect(outbox.some((m) => m.to === config.supportEmail && m.subject.includes("[Contact] Ana Lee · Studio Co"))).toBe(true);

    const user = await signup("plainuser@factorialstudio.com");
    const denied = await get("/api/admin/contact", user);
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("admin-only");

    const admin = await makeAdmin("ops@factorialstudio.com");
    const inbox = (await get("/api/admin/contact", admin)).json();
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({ name: "Ana Lee", email: "ana@studio.co", company: "Studio Co" });
    expect((await post(`/api/contact/${inbox[0].id}/handled`, {}, admin)).json()).toEqual({ handled: true });
    expect((await get("/api/admin/contact", admin)).json()).toEqual([]);
    expect((await get("/api/admin/contact?handled=1", admin)).json()).toHaveLength(1);
  });

  it("support thread round trip: user opens → admin sees unread → replies (emailed) → user unread → read clears it", async () => {
    const user = await signup("needshelp@factorialstudio.com");
    const created = await post("/api/support/thread", { subject: "Export fails on Meta", message: "The zip is rejected.\nWhat now?" }, user);
    expect(created.statusCode).toBe(201);
    const t = created.json();
    expect(t).toMatchObject({ subject: "Export fails on Meta", status: "open", unread: 0 });
    expect(t.messages).toHaveLength(1);
    expect(outbox.some((m) => m.to === config.supportEmail && m.subject === "[Support] Export fails on Meta")).toBe(true);
    expect((await post("/api/support/thread", { subject: "", message: "x" }, user)).statusCode).toBe(400);

    const admin = await makeAdmin("support-agent@factorialstudio.com");
    const open = (await get("/api/admin/support/threads", admin)).json();
    expect(open[0]).toMatchObject({ id: t.id, unread: 1, userEmail: "needshelp@factorialstudio.com", workspace: "needshelp's workspace", plan: "free" });
    // admin reads from the console (as=support clears the support side) and replies (flagged fromSupport, emailed)
    const seen = (await get(`/api/support/threads/${t.id}?as=support`, admin)).json();
    expect(seen.user.email).toBe("needshelp@factorialstudio.com");
    clearOutbox();
    const rep = await post(`/api/support/threads/${t.id}/reply?as=support`, { message: "Meta needs index.html at the zip root — fixed on our side." }, admin);
    expect(rep.statusCode).toBe(200);
    expect(rep.json().messages.at(-1)).toMatchObject({ fromSupport: true });
    expect(outbox.some((m) => m.to === "needshelp@factorialstudio.com" && m.subject.startsWith("Re: Export fails on Meta"))).toBe(true);
    expect((await get("/api/admin/support/threads", admin)).json()[0].unread).toBe(0);

    // the user sees one unread reply; reading the thread clears it
    expect((await get("/api/support/unread", user)).json()).toEqual({ count: 1 });
    expect((await get("/api/support/threads", user)).json()[0].unread).toBe(1);
    const detail = (await get(`/api/support/threads/${t.id}`, user)).json();
    expect(detail.messages.map((m: { fromSupport: boolean }) => m.fromSupport)).toEqual([false, true]);
    expect((await get("/api/support/unread", user)).json()).toEqual({ count: 0 });

    // close, and a reply reopens it; strangers cannot see it
    expect((await post(`/api/support/threads/${t.id}/close`, {}, user)).json().status).toBe("closed");
    expect((await get("/api/admin/support/threads?status=closed", admin)).json().map((x: { id: string }) => x.id)).toContain(t.id);
    await post(`/api/support/threads/${t.id}/reply`, { message: "Still broken for TikTok." }, user);
    expect((await get(`/api/support/threads/${t.id}`, user)).json().status).toBe("open");
    const stranger = await signup("nosy@factorialstudio.com");
    expect((await get(`/api/support/threads/${t.id}`, stranger)).statusCode).toBe(404);
    expect((await post(`/api/support/threads/${t.id}/reply`, { message: "hi" }, stranger)).statusCode).toBe(404);
  });

  it("an admin who files a ticket in their own workspace is the customer on the Support page, support in the console", async () => {
    const founder = await makeAdmin("founder-ticket@factorialstudio.com");
    const t = (await post("/api/support/thread", { subject: "Self-filed", message: "Testing my own support." }, founder)).json();
    // reply from the console as support: the founder's customer side gets an unread
    expect((await post(`/api/support/threads/${t.id}/reply?as=support`, { message: "Support here." }, founder)).json().messages.at(-1).fromSupport).toBe(true);
    expect((await get("/api/support/unread", founder)).json()).toEqual({ count: 1 });
    // opening it from the Support page (no as=support) clears the CUSTOMER side
    const asCustomer = (await get(`/api/support/threads/${t.id}`, founder)).json();
    expect(asCustomer.unread).toBe(0);
    expect((await get("/api/support/unread", founder)).json()).toEqual({ count: 0 });
    // and a reply from the Support page is a customer message, not a support one
    expect((await post(`/api/support/threads/${t.id}/reply`, { message: "Thanks!" }, founder)).json().messages.at(-1).fromSupport).toBe(false);
    expect((await get("/api/admin/support/threads", founder)).json().find((x: { id: string }) => x.id === t.id).unread).toBe(2); // opening message + "Thanks!", neither read from the console
  });

  it("bug reports reach the admin list and can be marked handled", async () => {
    const user = await signup("bugfinder@factorialstudio.com");
    expect((await post("/api/feedback/bug", { title: "Preview blank", body: "Safari 17, AppLovin preview is white.", page: "/workspace" }, user)).statusCode).toBe(201);
    expect((await post("/api/feedback/bug", { title: "", body: "x" }, user)).statusCode).toBe(400);
    expect((await get("/api/feedback/bugs", user)).statusCode).toBe(403);
    const admin = await makeAdmin("triage@factorialstudio.com");
    const bugs = (await get("/api/feedback/bugs", admin)).json();
    expect(bugs[0]).toMatchObject({ title: "Preview blank", page: "/workspace", userEmail: "bugfinder@factorialstudio.com" });
    await post(`/api/feedback/bugs/${bugs[0].id}/handled`, {}, admin);
    expect((await get("/api/feedback/bugs", admin)).json()).toEqual([]);
    expect((await get("/api/admin/overview", admin)).json()).toMatchObject({ openBugs: 0 });
  });

  it("admin role: ADMIN_EMAILS bootstrap at login, overview, user search/promote/plan override/delete, self-protection", async () => {
    config.adminEmails.push("founder@factorialstudio.com");
    try {
      await signup("founder@factorialstudio.com");
      const login = await post("/api/login", { email: "founder@factorialstudio.com", password: "secret123" });
      expect(login.json().user.isAdmin).toBe(true);
      const founder = login.json().token as string;
      expect((await get("/api/me", founder)).json().user.isAdmin).toBe(true);

      const other = await signup("customer@factorialstudio.com");
      expect((await get("/api/me", other)).json().user.isAdmin).toBe(false);
      await post("/api/login", { email: "customer@factorialstudio.com", password: "secret123" });

      const ov = (await get("/api/admin/overview", founder)).json();
      expect(ov.users).toBeGreaterThanOrEqual(2);
      const found = (await get("/api/admin/users?q=customer", founder)).json();
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ email: "customer@factorialstudio.com", plan: "free", isAdmin: false, workspace: "customer's workspace" });
      expect(found[0].lastLoginAt).toBeTruthy();
      const id = found[0].id;

      // plan override (enterprise deal) + promote
      expect((await app.inject({ method: "PATCH", url: `/api/admin/users/${id}`, headers: bearer(founder), payload: { plan: "enterprise", admin: true } })).json()).toMatchObject({ plan: "enterprise", isAdmin: true });
      expect((await get("/api/me", other)).json()).toMatchObject({ plan: "enterprise", user: { isAdmin: true } });
      expect((await app.inject({ method: "PATCH", url: `/api/admin/users/${id}`, headers: bearer(founder), payload: { plan: "platinum" } })).statusCode).toBe(400);

      // cannot demote or delete yourself
      const selfId = (await getUserByEmail("founder@factorialstudio.com"))!.id;
      expect((await app.inject({ method: "PATCH", url: `/api/admin/users/${selfId}`, headers: bearer(founder), payload: { admin: false } })).statusCode).toBe(400);
      expect((await app.inject({ method: "DELETE", url: `/api/admin/users/${selfId}`, headers: bearer(founder) })).statusCode).toBe(400);

      // delete removes the user and the workspaces they own
      const appId = (await post("/api/apps", { name: "Doomed" }, other)).json().id;
      expect((await app.inject({ method: "DELETE", url: `/api/admin/users/${id}`, headers: bearer(founder) })).json()).toEqual({ deleted: true });
      expect(await getUserByEmail("customer@factorialstudio.com")).toBeUndefined();
      expect((await get(`/api/apps/${appId}`, founder)).statusCode).toBe(404);
      // jobs listing works for admins
      expect((await get("/api/admin/jobs", founder)).statusCode).toBe(200);
    } finally {
      config.adminEmails.splice(config.adminEmails.indexOf("founder@factorialstudio.com"), 1);
    }
  });

  it("reminders: never-exported after 3 days and dormant exporters; dry run, send once, logged", async () => {
    const { db: openDb } = await import("../src/db.js");
    const db = openDb();
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const quiet = new Date(Date.now() - 20 * 86_400_000).toISOString();
    await signup("signedup-old@factorialstudio.com");
    await signup("signedup-today@factorialstudio.com");
    await signup("was-active@factorialstudio.com");
    await db.prepare("UPDATE users SET created_at = ? WHERE email IN ('signedup-old@factorialstudio.com', 'was-active@factorialstudio.com')").run(old);
    const active = (await getUserByEmail("was-active@factorialstudio.com"))!;
    await db.prepare("UPDATE users SET last_login_at = ? WHERE id = ?").run(quiet, active.id);
    await db.prepare("INSERT INTO export_usage (id, user_id, network, created_at) VALUES ('u1', ?, 'unityads', ?)").run(active.id, quiet);

    const admin = await makeAdmin("growth@factorialstudio.com");
    const c = (await get("/api/admin/reminders", admin)).json();
    expect(c.candidates["no-export"].map((u: { email: string }) => u.email)).toEqual(["signedup-old@factorialstudio.com"]);
    expect(c.candidates.dormant.map((u: { email: string }) => u.email)).toEqual(["was-active@factorialstudio.com"]);

    clearOutbox();
    const dry = (await post("/api/admin/reminders/run", { dryRun: true }, admin)).json();
    expect(dry).toMatchObject({ dryRun: true, sent: { "no-export": 0, dormant: 0 } });
    expect(outbox).toHaveLength(0);

    const run = (await post("/api/admin/reminders/run", {}, admin)).json();
    expect(run.sent).toEqual({ "no-export": 1, dormant: 1 });
    expect(outbox.map((m) => m.to).sort()).toEqual(["signedup-old@factorialstudio.com", "was-active@factorialstudio.com"]);
    // logged → nobody is nudged twice
    expect((await post("/api/admin/reminders/run", {}, admin)).json().sent).toEqual({ "no-export": 0, dormant: 0 });
    const signupId = (await getUserByEmail("signedup-today@factorialstudio.com"))!.id;
    expect((await post("/api/admin/reminders/send", { userId: signupId, kind: "nope" }, admin)).statusCode).toBe(400);
    expect((await post("/api/admin/reminders/send", { userId: signupId, kind: "no-export" }, admin)).json()).toEqual({ sent: true });
  });
});

describe("runtime API: custom variables + valued events", () => {
  async function creativeFor(email: string) {
    const token = await signup(email);
    await verifyDomain(email);
    await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(token), payload: { plan: "studio" } });
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(token), payload: { name: "Vars", platform: "ios" } })).json().id;
    const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(token), payload: { name: "c" } })).json().id;
    const form = new FormData();
    form.append("file", await fixtureZip(), { filename: "sample.zip", contentType: "application/zip" });
    const up = await app.inject({ method: "POST", url: `/api/concepts/${conceptId}/creatives`, headers: { ...bearer(token), ...form.getHeaders() }, payload: form.getBuffer() });
    return { token, conceptId, creativeId: up.json().id as string };
  }
  const patchVars = (token: string, id: string, body: Record<string, unknown>) => app.inject({ method: "PATCH", url: `/api/creatives/${id}`, headers: bearer(token), payload: body });

  it("schema from the plugin: defaults, typed/clamped edits, free-form keys, injection into the export", async () => {
    const { token, creativeId } = await creativeFor("vars@factorialstudio.com");
    const schema = [
      { key: "TapCubeGame.tapsToWin", displayName: "Taps to win", section: "Gameplay", order: 2, type: "int", min: 1, max: 10, step: 1, default: 3 },
      { key: "TapCubeGame.speed", type: "number", min: 0.5, max: 3, default: 1.0 },
      { key: "TapCubeGame.title", type: "string", default: "Tap!" },
      { key: "TapCubeGame.hard", type: "bool", default: false, order: 1 },
      { key: "TapCubeGame.unbounded", type: "number", min: -3.4028235e38, max: 3.4028235e38, default: 7 },
    ];
    const set = await patchVars(token, creativeId, { variableSchema: schema });
    expect(set.statusCode).toBe(200);
    // sorted by order, then key; the float.MinValue/MaxValue "unbounded" range is dropped
    expect(set.json().variableSchema.map((d: { key: string }) => d.key)).toEqual([
      "TapCubeGame.speed", "TapCubeGame.title", "TapCubeGame.unbounded", "TapCubeGame.hard", "TapCubeGame.tapsToWin",
    ]);
    expect(set.json().variableSchema.find((d: { key: string }) => d.key === "TapCubeGame.unbounded")).not.toHaveProperty("min");
    // schema-only patch leaves values untouched (empty here); detail exposes both
    const detail = (await app.inject({ method: "GET", url: `/api/creatives/${creativeId}`, headers: bearer(token) })).json();
    expect(detail.variableSchema).toHaveLength(5);
    expect(detail.variables).toEqual({});

    // edits: int rounds + clamps, number clamps, bool from string, free-form key accepted, null deletes
    const edit = await patchVars(token, creativeId, {
      variables: { "TapCubeGame.tapsToWin": "14.6", "TapCubeGame.speed": 0.1, "TapCubeGame.hard": "yes", "TapCubeGame.title": 42, promo: "SUMMER", lives: 3 },
    });
    expect(edit.statusCode).toBe(200);
    expect(edit.json().variables).toEqual({ "TapCubeGame.tapsToWin": 10, "TapCubeGame.speed": 0.5, "TapCubeGame.hard": true, "TapCubeGame.title": "42", promo: "SUMMER", lives: 3 });
    const del = await patchVars(token, creativeId, { variables: { promo: null } });
    expect(del.json().variables).not.toHaveProperty("promo");
    expect(del.json().variables.lives).toBe(3);
    // bad input → 400, nothing changes
    expect((await patchVars(token, creativeId, { variables: { "TapCubeGame.speed": "fast" } })).statusCode).toBe(400);
    expect((await patchVars(token, creativeId, { variables: { "bad key!": 1 } })).statusCode).toBe(400);
    expect((await patchVars(token, creativeId, { variables: { nested: { a: 1 } } })).statusCode).toBe(400);
    expect((await patchVars(token, creativeId, { variableSchema: [{ key: "x", type: "colour" }] })).statusCode).toBe(400);

    // the export carries the values as PF.vars
    const exp = await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: bearer(token), payload: { networks: ["applovin"] } });
    expect(exp.statusCode).toBe(200);
    const html = (await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/preview/applovin` })).body;
    expect(html).toContain('"vars":{"TapCubeGame.tapsToWin":10,"TapCubeGame.speed":0.5,"TapCubeGame.hard":true,"TapCubeGame.title":"42","lives":3}');
  });

  it("compile upload accepts the plugin's variable manifest and seeds defaults; valued custom events are summed", async () => {
    const { token, conceptId, creativeId } = await creativeFor("varscompile@factorialstudio.com");
    const zip = new JSZip();
    zip.file("index.html", "<html></html>");
    zip.file("Build/g.loader.js", "function createUnityInstance(){}");
    zip.file("Build/g.framework.js", "var unityFramework = 1;");
    zip.file("Build/g.wasm", Buffer.from([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]));
    zip.file("Build/g.data", Buffer.from("UnityWebData1.0\0xx"));
    const form = new FormData();
    form.append("file", await zip.generateAsync({ type: "nodebuffer" }), { filename: "build.zip", contentType: "application/zip" });
    form.append("variables", JSON.stringify([{ key: "Game.lives", type: "int", min: 1, max: 9, default: 3 }, { key: "Game.skin", type: "string", default: "red" }]));
    const res = await app.inject({ method: "POST", url: `/api/concepts/${conceptId}/compile`, headers: { ...bearer(token), ...form.getHeaders() }, payload: form.getBuffer() });
    expect(res.statusCode).toBe(202);
    await drainJobs();
    const j = (await app.inject({ method: "GET", url: `/api/jobs/${res.json().jobId}`, headers: bearer(token) })).json();
    expect(j.status, j.error).toBe("done");
    expect(j.result.variableCount).toBe(2);
    const detail = (await app.inject({ method: "GET", url: `/api/creatives/${j.result.creativeId}`, headers: bearer(token) })).json();
    expect(detail.variables).toEqual({ "Game.lives": 3, "Game.skin": "red" });
    expect(detail.variableSchema.map((d: { key: string }) => d.key)).toEqual(["Game.lives", "Game.skin"]);
    // malformed manifest is rejected before anything is queued
    const bad = new FormData();
    bad.append("file", await zip.generateAsync({ type: "nodebuffer" }), { filename: "build.zip", contentType: "application/zip" });
    bad.append("variables", "not json");
    expect((await app.inject({ method: "POST", url: `/api/concepts/${conceptId}/compile`, headers: { ...bearer(token), ...bad.getHeaders() }, payload: bad.getBuffer() })).statusCode).toBe(400);

    // valued events: ?v= is stored and summed per name
    for (const v of [5, 7]) await app.inject({ method: "GET", url: `/api/t/${creativeId}/applovin?e=custom&n=coins&s=sessV1&v=${v}` });
    await app.inject({ method: "GET", url: `/api/t/${creativeId}/applovin?e=custom&n=coins&s=sessV2&v=abc` }); // non-numeric → no value
    const a = (await app.inject({ method: "GET", url: "/api/analytics", headers: bearer(token) })).json();
    expect(a.playable.customEvents).toEqual([{ name: "coins", hits: 3, sessions: 2, total: 12 }]);
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
    await verifyDomain("roles-owner@factorialstudio.com");
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
    const o = (await getUserByEmail("legacy-owner@factorialstudio.com"))!;
    const f = (await getUserByEmail("legacy-friend@factorialstudio.com"))!;
    // simulate a database from before orgs existed, then run the startup migration on it
    const { db: openDb, migrateOrgs } = await import("../src/db.js");
    const db = openDb();
    await db.exec("DELETE FROM org_members; DELETE FROM orgs; UPDATE users SET current_org_id = NULL; UPDATE apps SET org_id = NULL");
    await db.prepare("INSERT INTO memberships (id, owner_user_id, member_user_id, role, created_at) VALUES ('m1', ?, ?, 'admin', '2026-01-01T00:00:00.000Z')").run(o.id, f.id);
    await migrateOrgs(db);

    expect((await me(owner)).workspace).toMatchObject({ name: "legacy-owner's workspace", role: "owner" });
    expect((await app.inject({ method: "GET", url: `/api/apps/${appId}`, headers: bearer(owner) })).statusCode).toBe(200);
    const shared = (await ws(friend)).find((w: { name: string }) => w.name === "legacy-owner's workspace");
    expect(shared).toMatchObject({ role: "admin" });
    expect((await switchTo(friend, shared.id)).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/api/apps/${appId}`, headers: bearer(friend) })).statusCode).toBe(200);
    // running it again changes nothing
    await migrateOrgs(db);
    expect((await ws(owner)).length).toBe(1);
  });
});

describe("preloader kits (templates, per-app/concept kits, server preview)", () => {
  const PNG = "data:image/png;base64," + Buffer.from("fake-png-bytes").toString("base64");
  const kits = async (token: string) => (await app.inject({ method: "GET", url: "/api/kits", headers: bearer(token) })).json();
  const mkKit = (token: string, body: Record<string, unknown>) => app.inject({ method: "POST", url: "/api/kits", headers: bearer(token), payload: body });
  async function setup(email: string) {
    const token = await signup(email);
    await verifyDomain(email);
    await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(token), payload: { plan: "studio" } });
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(token), payload: { name: "Kit App" } })).json().id as string;
    const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(token), payload: { name: "Kit Concept" } })).json().id as string;
    const form = new FormData();
    form.append("file", await fixtureZip(), { filename: "sample.zip", contentType: "application/zip" });
    const up = await app.inject({ method: "POST", url: `/api/concepts/${conceptId}/creatives`, headers: { ...bearer(token), ...form.getHeaders() }, payload: form.getBuffer() });
    return { token, appId, conceptId, creativeId: up.json().id as string };
  }
  /** Export to AppLovin and return the shipped HTML. */
  async function exportedHtml(token: string, creativeId: string): Promise<string> {
    const r = await app.inject({ method: "POST", url: `/api/creatives/${creativeId}/export`, headers: bearer(token), payload: { networks: ["applovin"] } });
    expect(r.statusCode).toBe(200);
    return (await app.inject({ method: "GET", url: `/api/creatives/${creativeId}/preview/applovin` })).body;
  }

  it("lists the template library publicly", async () => {
    const t = (await app.inject({ method: "GET", url: "/api/kit/templates" })).json();
    expect(t.map((x: { id: string }) => x.id)).toEqual(["classic", "minimal", "pulse", "ring", "dots", "splash"]);
    expect(t.find((x: { id: string }) => x.id === "splash").imageRole).toBe("background");
  });

  it("creates, validates, edits, duplicates and deletes kits; the first kit becomes the default", async () => {
    const { token } = await setup("kits-crud@factorialstudio.com");
    expect(await kits(token)).toMatchObject({ kits: [], defaultKitId: null, canEdit: true, canAssign: true });

    const bad: [Record<string, unknown>, RegExp][] = [
      [{ name: "x", template: "bogus" }, /unknown template/],
      [{ name: "x", bg: "red; background:url(x)" }, /hex colour/],
      [{ name: "x", text: "y".repeat(61) }, /at most 60/],
      [{ name: "x", logoDataUri: "data:text/html;base64,PGI+" }, /PNG, JPEG/],
      [{ name: "x", logoDataUri: "data:image/png;base64," + Buffer.alloc(600 * 1024).toString("base64") }, /512 KB/],
      [{ name: "  " }, /name is required/],
    ];
    for (const [body, msg] of bad) {
      const r = await mkKit(token, body);
      expect(r.statusCode).toBe(400);
      expect(r.json().error).toMatch(msg);
    }

    const a = await mkKit(token, { name: "Brand", template: "ring", bg: "#FF8800", accent: "#112233", text: "Get ready!", showPercent: true, logoDataUri: PNG });
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({ name: "Brand", template: "ring", bg: "#ff8800", accent: "#112233", text: "Get ready!", showPercent: true, logoDataUri: PNG });
    const b = (await mkKit(token, { name: "Holiday", template: "splash" })).json();
    let s = await kits(token);
    expect(s.defaultKitId).toBe(a.json().id); // first kit only
    expect(s.kits.map((k: { name: string }) => k.name)).toEqual(["Brand", "Holiday"]);

    // partial edit keeps the image; logoDataUri null removes it
    const e1 = (await app.inject({ method: "PATCH", url: `/api/kits/${a.json().id}`, headers: bearer(token), payload: { text: "Almost there" } })).json();
    expect(e1).toMatchObject({ text: "Almost there", template: "ring", logoDataUri: PNG });
    const e2 = (await app.inject({ method: "PATCH", url: `/api/kits/${a.json().id}`, headers: bearer(token), payload: { logoDataUri: null, accent: null } })).json();
    expect(e2).toMatchObject({ logoDataUri: null, accent: null, bg: "#ff8800" });

    const dup = await app.inject({ method: "POST", url: `/api/kits/${b.id}/duplicate`, headers: bearer(token) });
    expect(dup.json()).toMatchObject({ name: "Holiday copy", template: "splash" });
    // competitor-compatible alias
    expect((await app.inject({ method: "POST", url: "/api/kit/create", headers: bearer(token), payload: { name: "Alias" } })).statusCode).toBe(201);

    // deleting the default clears it
    expect((await app.inject({ method: "DELETE", url: `/api/kits/${a.json().id}`, headers: bearer(token) })).json()).toEqual({ deleted: true });
    s = await kits(token);
    expect(s.defaultKitId).toBeNull();
    expect(s.kits).toHaveLength(3);
    // a kit id from somebody else's workspace is invisible
    const other = await signup("kits-other@factorialstudio.com");
    expect((await app.inject({ method: "PATCH", url: `/api/kits/${b.id}`, headers: bearer(other), payload: { name: "mine" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: "/api/kits/default", headers: bearer(other), payload: { kitId: b.id } })).statusCode).toBe(400);
  });

  it("server preview renders the same markup exports ship, locked down, with the saved image reused by kitId", async () => {
    const { token } = await setup("kits-preview@factorialstudio.com");
    const k = (await mkKit(token, { name: "P", template: "pulse", bg: "#123456", logoDataUri: PNG })).json();
    const draft = await app.inject({
      method: "POST",
      url: "/api/kit/preview",
      headers: bearer(token),
      payload: { template: "ring", bg: "#abcdef", text: "<script>alert(1)</script>", kitId: k.id, progress: 0.5 },
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.headers["content-type"]).toMatch(/text\/html/);
    expect(draft.headers["content-security-policy"]).toContain("default-src 'none'");
    expect(draft.body).toContain('data-template="ring"');
    expect(draft.body).toContain("#abcdef");
    expect(draft.body).toContain(PNG); // saved image of kitId
    expect(draft.body).toContain("__pfPreloaderStay=true");
    expect(draft.body).not.toContain("<script>alert(1)");
    expect(draft.body).toContain("&lt;script&gt;alert(1)");
    // explicit null drops the saved image from the draft
    const noImg = await app.inject({ method: "POST", url: "/api/kit/preview", headers: bearer(token), payload: { kitId: k.id, logoDataUri: null } });
    expect(noImg.body).not.toContain(PNG);
    const saved = await app.inject({ method: "GET", url: `/api/kits/${k.id}/preview`, headers: bearer(token) });
    expect(saved.body).toContain('data-template="pulse"');
    expect((await app.inject({ method: "POST", url: "/api/kit/preview", payload: {} })).statusCode).toBe(401);
  });

  it("exports resolve concept, then app, then workspace default; 'none' opts out; deleting a kit falls back", async () => {
    const { token, appId, conceptId, creativeId } = await setup("kits-resolve@factorialstudio.com");
    expect(await exportedHtml(token, creativeId)).not.toContain('id="__pf_pl"'); // no kits yet

    const brand = (await mkKit(token, { name: "Brand", template: "classic", bg: "#101010" })).json();
    const promo = (await mkKit(token, { name: "Promo", template: "dots", bg: "#202020", text: "Promo time" })).json();
    let html = await exportedHtml(token, creativeId);
    expect(html).toContain('data-template="classic"');
    expect(html).toContain("#101010");
    let c = (await app.inject({ method: "GET", url: `/api/concepts/${conceptId}`, headers: bearer(token) })).json();
    expect(c.preloader).toEqual({ kitId: brand.id, kitName: "Brand", source: "workspace" });

    // the app picks Promo
    const pa = await app.inject({ method: "PATCH", url: `/api/apps/${appId}`, headers: bearer(token), payload: { kitId: promo.id } });
    expect(pa.json().kitId).toBe(promo.id);
    html = await exportedHtml(token, creativeId);
    expect(html).toContain('data-template="dots"');
    expect(html).toContain("Promo time");

    // the concept opts out entirely
    const pc = (await app.inject({ method: "PATCH", url: `/api/concepts/${conceptId}`, headers: bearer(token), payload: { kitId: "none" } })).json();
    expect(pc).toMatchObject({ kitId: "none", preloader: { kitId: null, source: "concept" } });
    expect(await exportedHtml(token, creativeId)).not.toContain('id="__pf_pl"');

    // back to inheriting; then deleting the app's kit falls back to the workspace default
    await app.inject({ method: "PATCH", url: `/api/concepts/${conceptId}`, headers: bearer(token), payload: { kitId: null } });
    await app.inject({ method: "DELETE", url: `/api/kits/${promo.id}`, headers: bearer(token) });
    c = (await app.inject({ method: "GET", url: `/api/concepts/${conceptId}`, headers: bearer(token) })).json();
    expect(c.preloader).toMatchObject({ kitName: "Brand", source: "workspace" });
    expect((await app.inject({ method: "GET", url: `/api/apps/${appId}`, headers: bearer(token) })).json().kitId).toBeNull();

    // bad references are rejected
    expect((await app.inject({ method: "PATCH", url: `/api/concepts/${conceptId}`, headers: bearer(token), payload: { kitId: "nope" } })).statusCode).toBe(400);
    const s = await kits(token);
    expect(s.assignments.concepts).toEqual([{ id: conceptId, name: "Kit Concept", appId, kitId: null }]);
  });

  it("roles: admins edit kits, members assign them, viewers only look", async () => {
    const { token: owner, conceptId } = await setup("kits-owner@factorialstudio.com");
    const k = (await mkKit(owner, { name: "Brand" })).json();
    const join = async (email: string, role: string) => {
      await app.inject({ method: "POST", url: "/api/orgs/current/invites", headers: bearer(owner), payload: { email, role } });
      const m = [...outbox].reverse().find((x) => x.to === email && x.html.includes("?invite="))!;
      const t = await signup(email);
      await app.inject({ method: "POST", url: "/api/invites/accept", headers: bearer(t), payload: { token: m.html.match(/[?&]invite=([a-f0-9]+)/)![1] } });
      return t;
    };
    const member = await join("kits-member@factorialstudio.com", "member");
    const viewer = await join("kits-viewer@factorialstudio.com", "viewer");

    expect(await kits(member)).toMatchObject({ canEdit: false, canAssign: true, defaultKitId: k.id });
    expect((await mkKit(member, { name: "Nope" })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/api/kits/${k.id}`, headers: bearer(member), payload: { name: "x" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PUT", url: "/api/kits/default", headers: bearer(member), payload: { kitId: null } })).statusCode).toBe(403);
    expect((await app.inject({ method: "PATCH", url: `/api/concepts/${conceptId}`, headers: bearer(member), payload: { kitId: "none" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "PATCH", url: `/api/concepts/${conceptId}`, headers: bearer(viewer), payload: { kitId: null } })).statusCode).toBe(403);
    expect(await kits(viewer)).toMatchObject({ canEdit: false, canAssign: false });
  });

  it("legacy /api/preloader maps onto the default kit, and old preloader rows migrate into kits", async () => {
    const token = await signup("kits-legacy@factorialstudio.com");
    const form = new FormData();
    form.append("logo", Buffer.from("tiny"), { filename: "l.png", contentType: "image/png" });
    form.append("bg", "#334455");
    form.append("enabled", "1");
    const r = await app.inject({ method: "POST", url: "/api/preloader", headers: { ...bearer(token), ...form.getHeaders() }, payload: form.getBuffer() });
    expect(r.json()).toMatchObject({ enabled: true, bg: "#334455" });
    let s = await kits(token);
    expect(s.kits).toHaveLength(1);
    expect(s.defaultKitId).toBe(s.kits[0].id);

    // a database from before kits: one enabled legacy row becomes a "Brand kit" that is the workspace default
    const u = (await getUserByEmail("kits-legacy@factorialstudio.com"))!;
    const { db: openDb, migratePreloaders } = await import("../src/db.js");
    const db = openDb();
    await db.exec("DELETE FROM preloader_kits; UPDATE orgs SET default_kit_id = NULL");
    await db.prepare("INSERT INTO preloaders (user_id, logo, logo_mime, bg, enabled, updated_at) VALUES (?, ?, 'image/png', '#0a0b0c', 1, '2026-01-01T00:00:00.000Z')").run(u.id, Buffer.from("old-logo"));
    await migratePreloaders(db);
    s = await kits(token);
    expect(s.kits).toEqual([
      expect.objectContaining({ name: "Brand kit", template: "classic", bg: "#0a0b0c", logoDataUri: "data:image/png;base64," + Buffer.from("old-logo").toString("base64") }),
    ]);
    expect(s.defaultKitId).toBe(s.kits[0].id);
    await migratePreloaders(db); // idempotent: the legacy row is gone
    expect((await kits(token)).kits).toHaveLength(1);
  });
});

describe("unity plugin distribution (download, version, licence, bans)", () => {
  const pluginDir = join(here, "..", "..", "unity-plugin");
  const makeAdmin = async (email: string) => {
    const t = await signup(email);
    await setAdmin((await getUserByEmail(email))!.id, true);
    return t;
  };
  /** Download the plugin and unpack it: pathname → { bytes, meta, guid }. */
  async function download(token: string) {
    const r = await app.inject({ method: "GET", url: "/api/plugin/download", headers: bearer(token) });
    expect(r.statusCode).toBe(200);
    const { gunzipSync } = await import("node:zlib");
    const { untar } = await import("../src/plugin/unitypackage.js");
    const entries = untar(gunzipSync(r.rawPayload));
    const byGuid = new Map<string, Record<string, Uint8Array>>();
    for (const e of entries) {
      const [g, f] = e.name.split("/");
      if (!f) continue;
      byGuid.set(g!, { ...(byGuid.get(g!) ?? {}), [f]: e.bytes });
    }
    const files = new Map<string, { guid: string; bytes?: Uint8Array; meta: string }>();
    for (const [guid, parts] of byGuid) {
      const path = new TextDecoder().decode(parts.pathname!);
      files.set(path, { guid, bytes: parts.asset, meta: new TextDecoder().decode(parts["asset.meta"]!) });
    }
    const text = (p: string) => new TextDecoder().decode(files.get(p)!.bytes!);
    return { r, files, text, wm: r.headers["x-adlab-licence"] as string };
  }
  const licenseOf = (text: (p: string) => string) => {
    const lic = JSON.parse(text("Assets/FactorialAdLab/Editor/FactorialAdLabLicense.json"));
    return { ...lic, compact: `${lic.payload}.${lic.sig}` };
  };
  const pluginGet = (url: string, opts: { token?: string; license?: string; version?: string } = {}) =>
    app.inject({
      method: "GET",
      url,
      headers: {
        ...(opts.token ? bearer(opts.token) : {}),
        "x-adlab-plugin": opts.version ?? "0.2.0",
        ...(opts.license ? { "x-adlab-license": opts.license } : {}),
      },
    });

  it("version: matches package.json, the C# build constant and the changelog; tells a plugin when it's behind", async () => {
    const { readFileSync } = await import("node:fs");
    const pkg = JSON.parse(readFileSync(join(pluginDir, "package.json"), "utf8"));
    const cs = readFileSync(join(pluginDir, "Editor", "AdLabBuildInfo.cs"), "utf8");
    expect(cs).toContain(`Version = "${pkg.version}"`);
    expect(cs).toContain('Watermark = ""');

    const v = (await app.inject({ method: "GET", url: "/api/plugin/version" })).json();
    expect(v).toMatchObject({ version: pkg.version, unity: "6000.0", downloadUrl: "/api/plugin/download", installed: null, updateAvailable: null });
    expect(v.notes.length).toBeGreaterThan(0);
    expect(v.releasedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await pluginGet("/api/plugin/version", { version: "0.1.0" })).json()).toMatchObject({ installed: "0.1.0", updateAvailable: true, supported: true });
    expect((await pluginGet("/api/plugin/version", { version: pkg.version })).json().updateAvailable).toBe(false);
  });

  it("download: a .unitypackage of the plugin under Assets/FactorialAdLab with a signed, watermarked licence", async () => {
    expect((await app.inject({ method: "GET", url: "/api/plugin/download" })).statusCode).toBe(401);
    const token = await signup("plugin-dl@factorialstudio.com");
    const { r, files, text, wm } = await download(token);
    expect(r.headers["content-disposition"]).toMatch(/FactorialAdLab-\d+\.\d+\.\d+\.unitypackage/);
    expect(wm).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);

    const paths = [...files.keys()];
    for (const p of [
      "Assets/FactorialAdLab",
      "Assets/FactorialAdLab/Editor",
      "Assets/FactorialAdLab/Editor/PluginUpdater.cs",
      "Assets/FactorialAdLab/Editor/FactorialAdLab.Editor.asmdef",
      "Assets/FactorialAdLab/Runtime/Playable.cs",
      "Assets/FactorialAdLab/Runtime/Plugins/WebGL/FactorialAdLab.jslib",
      "Assets/FactorialAdLab/Editor/FactorialAdLabLicense.json",
      "Assets/FactorialAdLab/Editor/FactorialAdLabRelease.json",
    ])
      expect(paths).toContain(p);
    expect(paths.some((p) => p.endsWith("package.json"))).toBe(false);
    // folders carry a folder meta and no asset; GUIDs are stable per path (updates overwrite in place)
    const { guidFor } = await import("../src/plugin/unitypackage.js");
    expect(files.get("Assets/FactorialAdLab/Editor")).toMatchObject({ bytes: undefined, guid: guidFor("Assets/FactorialAdLab/Editor") });
    expect(files.get("Assets/FactorialAdLab/Editor")!.meta).toContain("folderAsset: yes");
    expect(files.get("Assets/FactorialAdLab/Runtime/Plugins/WebGL/FactorialAdLab.jslib")!.meta).toMatch(/WebGL: WebGL\n    second:\n      enabled: 1/);
    expect(files.get("Assets/FactorialAdLab/Editor/PluginUpdater.cs")!.meta).toContain(`guid: ${guidFor("Assets/FactorialAdLab/Editor/PluginUpdater.cs")}`);

    // the watermark is stamped into the C# build constant and matches the licence
    expect(text("Assets/FactorialAdLab/Editor/AdLabBuildInfo.cs")).toContain(`Watermark = "${wm}"`);
    const lic = licenseOf(text);
    expect(lic).toMatchObject({ wm, licensee: "plugin-dl@factorialstudio.com", workspace: "plugin-dl's workspace" });
    const { verifyLicense } = await import("../src/plugin/license.js");
    expect(await verifyLicense(lic.compact)).toMatchObject({ wm, email: "plugin-dl@factorialstudio.com" });

    // the release file's public key (what the C# side imports) verifies the signature too
    const rel = JSON.parse(text("Assets/FactorialAdLab/Editor/FactorialAdLabRelease.json"));
    expect(rel).toMatchObject({ version: expect.any(String), kid: lic.kid, api: expect.stringMatching(/^https?:\/\//) });
    const { createPublicKey, verify } = await import("node:crypto");
    const pub = createPublicKey({ key: { kty: "RSA", n: Buffer.from(rel.modulus, "base64").toString("base64url"), e: Buffer.from(rel.exponent, "base64").toString("base64url") }, format: "jwk" });
    expect(verify("sha256", Buffer.from(lic.payload), pub, Buffer.from(lic.sig, "base64"))).toBe(true);

    // each download is its own licence; the user sees their downloads
    const second = await download(token);
    expect(second.wm).not.toBe(wm);
    const mine = (await app.inject({ method: "GET", url: "/api/plugin/downloads", headers: bearer(token) })).json();
    expect(mine.map((d: { wm: string }) => d.wm)).toEqual([second.wm, wm]);
  });

  it("guard: plugin requests are licence-checked, recorded, and held to the minimum version", async () => {
    const token = await signup("plugin-guard@factorialstudio.com");
    const { text } = await download(token);
    const lic = licenseOf(text);
    expect((await pluginGet("/api/apps", { token, license: lic.compact })).statusCode).toBe(200);
    expect((await pluginGet("/api/apps", { token })).statusCode).toBe(200); // installed from source: no licence, allowed
    const forged = lic.compact.replace(/^./, (c: string) => (c === "e" ? "f" : "e"));
    const bad = await pluginGet("/api/apps", { token, license: forged });
    expect(bad.statusCode).toBe(403);
    expect(bad.json().code).toBe("plugin-license-invalid");

    const { config: cfg } = await import("../src/config.js");
    cfg.pluginMinVersion = "0.2.0";
    cfg.pluginRequireLicense = true;
    try {
      const old = await pluginGet("/api/apps", { token, license: lic.compact, version: "0.1.9" });
      expect(old.statusCode).toBe(426);
      expect(old.json()).toMatchObject({ code: "plugin-outdated", minVersion: "0.2.0" });
      // the version check itself stays open so an outdated plugin can find the update
      expect((await pluginGet("/api/plugin/version", { version: "0.1.9" })).json()).toMatchObject({ supported: false, updateAvailable: true });
      expect((await pluginGet("/api/apps", { token })).json().code).toBe("plugin-license-required");
      expect((await pluginGet("/api/apps", { token, license: lic.compact })).statusCode).toBe(200);
      // the website (no plugin header) is never affected
      expect((await app.inject({ method: "GET", url: "/api/apps", headers: bearer(token) })).statusCode).toBe(200);
    } finally {
      cfg.pluginMinVersion = "";
      cfg.pluginRequireLicense = false;
    }
  });

  it("bans: a leaked download is traced to its owner, banned and lifted; a banned user can't use or download the plugin", async () => {
    const admin = await makeAdmin("plugin-admin@factorialstudio.com");
    const owner = await signup("plugin-owner@factorialstudio.com");
    const other = await signup("plugin-borrower@factorialstudio.com");
    const { text, wm } = await download(owner);
    const lic = licenseOf(text);
    await pluginGet("/api/apps", { token: owner, license: lic.compact });
    await pluginGet("/api/apps", { token: other, license: lic.compact }); // someone else is using the owner's copy

    expect((await app.inject({ method: "GET", url: "/api/admin/plugin/downloads", headers: bearer(owner) })).statusCode).toBe(403);
    const leaks = (await app.inject({ method: "GET", url: "/api/admin/plugin/downloads?shared=1", headers: bearer(admin) })).json();
    expect(leaks).toEqual([expect.objectContaining({ wm, email: "plugin-owner@factorialstudio.com", accounts: 2, otherAccounts: 1, requests: 2, banned: false })]);
    const detail = (await app.inject({ method: "GET", url: `/api/admin/plugin/downloads/${wm}`, headers: bearer(admin) })).json();
    expect(detail.usage.map((u: { email: string }) => u.email).sort()).toEqual(["plugin-borrower@factorialstudio.com", "plugin-owner@factorialstudio.com"]);

    // ban the download by its watermark code
    const ban = await app.inject({ method: "POST", url: "/api/plugin/bans", headers: bearer(admin), payload: { scope: "download", target: wm.toLowerCase(), reason: "posted on a forum" } });
    expect(ban.statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/plugin/bans", headers: bearer(admin), payload: { scope: "download", target: wm } })).statusCode).toBe(409);
    const refused = await pluginGet("/api/apps", { token: other, license: lic.compact });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().code).toBe("plugin-banned");
    expect((await app.inject({ method: "GET", url: "/api/apps", headers: bearer(other) })).statusCode).toBe(200); // website unaffected
    expect((await pluginGet("/api/plugin/version", { license: lic.compact })).statusCode).toBe(200);
    const bans = (await app.inject({ method: "GET", url: "/api/plugin/bans", headers: bearer(admin) })).json();
    expect(bans).toEqual([expect.objectContaining({ scope: "download", targetLabel: `${wm} · plugin-owner@factorialstudio.com`, reason: "posted on a forum" })]);
    expect((await app.inject({ method: "POST", url: `/api/plugin/bans/${ban.json().id}/lift`, headers: bearer(admin) })).json()).toEqual({ lifted: true });
    expect((await pluginGet("/api/apps", { token: other, license: lic.compact })).statusCode).toBe(200);

    // ban a user by email: their plugin requests (any copy) and downloads are refused
    expect((await app.inject({ method: "POST", url: "/api/plugin/bans", headers: bearer(admin), payload: { scope: "user", target: "plugin-admin@factorialstudio.com" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/plugin/bans", headers: bearer(admin), payload: { scope: "user", target: "nobody@x.io" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/plugin/bans", headers: bearer(admin), payload: { scope: "user", target: "plugin-borrower@factorialstudio.com" } })).statusCode).toBe(201);
    expect((await pluginGet("/api/apps", { token: other })).json().code).toBe("plugin-banned");
    expect((await app.inject({ method: "GET", url: "/api/plugin/download", headers: bearer(other) })).statusCode).toBe(403);
    expect((await pluginGet("/api/apps", { token: owner, license: lic.compact })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/plugin/bans", headers: bearer(owner), payload: { scope: "user", target: "plugin-borrower@factorialstudio.com" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/admin/overview", headers: bearer(admin) })).json()).toMatchObject({ pluginDownloads30d: 1, pluginBans: 1 });
  });

  it("the signing key is generated once and persisted, so licences survive a restart", async () => {
    const token = await signup("plugin-key@factorialstudio.com");
    const { text } = await download(token);
    const lic = licenseOf(text);
    const { resetLicenseKeyCache, verifyLicense } = await import("../src/plugin/license.js");
    resetLicenseKeyCache(); // as after a restart
    expect(await verifyLicense(lic.compact)).not.toBeNull();
    const { getSetting } = await import("../src/repo.js");
    expect(await getSetting("plugin_signing_key")).toMatch(/BEGIN PRIVATE KEY/);
  });
});

describe("device preview: simulated network host + sandbox", () => {
  it("previews get the network's simulated host and an opaque-origin sandbox; downloads stay untouched", async () => {
    const token = await signup("preview-host@factorialstudio.com");
    await verifyDomain("preview-host@factorialstudio.com");
    await app.inject({ method: "POST", url: "/api/billing/plan", headers: bearer(token), payload: { plan: "studio" } });
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(token), payload: { name: "P" } })).json().id;
    const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(token), payload: { name: "c" } })).json().id;
    const form = new FormData();
    form.append("file", await fixtureZip(), { filename: "sample.zip", contentType: "application/zip" });
    const cid = (await app.inject({ method: "POST", url: `/api/concepts/${conceptId}/creatives`, headers: { ...bearer(token), ...form.getHeaders() }, payload: form.getBuffer() })).json().id;
    expect((await app.inject({ method: "POST", url: `/api/creatives/${cid}/export`, headers: bearer(token), payload: { networks: ["applovin", "google"] } })).statusCode).toBe(200);

    const mraid = await app.inject({ method: "GET", url: `/api/creatives/${cid}/preview/applovin` });
    expect(mraid.headers["content-security-policy"]).toMatch(/^sandbox allow-scripts/);
    expect(mraid.headers["content-security-policy"]).not.toContain("allow-same-origin");
    expect(mraid.body).toContain("__adlabPreviewHost");
    expect(mraid.body.indexOf("__adlabPreviewHost")).toBeLessThan(mraid.body.indexOf("window.PF ="));

    const google = (await app.inject({ method: "GET", url: `/api/creatives/${cid}/preview/google` })).body;
    expect(google).toContain('"hook":"google-exitapi"');
    expect(google).toContain("simulated by the preview host");

    const raw = await app.inject({ method: "GET", url: `/api/creatives/${cid}/preview/applovin?host=0` });
    expect(raw.body).not.toContain("__adlabPreviewHost");
    expect(raw.headers["content-security-policy"]).toMatch(/^sandbox/);
    const dl = await app.inject({ method: "GET", url: `/api/creatives/${cid}/download/applovin` });
    expect(dl.body).not.toContain("__adlabPreviewHost");
    expect(dl.body).toBe(raw.body);
  });
});

describe("SPA deep links", () => {
  it("serves the dashboard for every screen path; unknown /api paths stay JSON 404s", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { config: cfg } = await import("../src/config.js");
    const dist = mkdtempSync(join(tmpdir(), "spa-"));
    writeFileSync(join(dist, "index.html"), "<!doctype html><div id=root></div>");
    const prev = cfg.webDist;
    cfg.webDist = dist;
    const spa = await buildApp();
    try {
      for (const path of ["/", "/apps/a1/concepts/c1/creatives/k1", "/support/t1", "/admin/plugin", "/settings"]) {
        const r = await spa.inject({ method: "GET", url: path });
        expect(r.statusCode, path).toBe(200);
        expect(r.body).toContain('<div id=root>');
      }
      const api = await spa.inject({ method: "GET", url: "/api/nope" });
      expect(api.statusCode).toBe(404);
      expect(api.json()).toEqual({ error: "not found" });
    } finally {
      await spa.close();
      cfg.webDist = prev;
      rmSync(dist, { recursive: true, force: true });
    }
  });
});

describe("Cloudflare Turnstile on public forms", () => {
  /** Turn Turnstile on and stub Cloudflare's siteverify: token "good-<action>" passes for that action. */
  async function withTurnstile(fn: (calls: { body: Record<string, unknown> }[]) => Promise<void>, opts: { down?: boolean } = {}) {
    const { config: cfg } = await import("../src/config.js");
    const { vi } = await import("vitest");
    const calls: { body: Record<string, unknown> }[] = [];
    const realFetch = globalThis.fetch;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (!url.includes("challenges.cloudflare.com")) return realFetch(input as never, init);
      if (opts.down) throw new TypeError("fetch failed");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      calls.push({ body });
      const m = /^good-(\w+)$/.exec(String(body.response));
      return new Response(JSON.stringify(m ? { success: true, action: m[1], hostname: "localhost" } : { success: false, "error-codes": ["invalid-input-response"] }), {
        headers: { "content-type": "application/json" },
      });
    });
    cfg.turnstileSiteKey = "site-key-for-tests";
    cfg.turnstileSecret = "secret-for-tests";
    try {
      await fn(calls);
    } finally {
      cfg.turnstileSiteKey = "";
      cfg.turnstileSecret = "";
      spy.mockRestore();
    }
  }
  const post = (url: string, payload: Record<string, unknown>) => app.inject({ method: "POST", url, payload });

  it("is off (and invisible to the web app) until both keys are set", async () => {
    expect((await app.inject({ method: "GET", url: "/api/config/public" })).json()).toEqual({ turnstileSiteKey: null });
    expect((await post("/api/signup", { email: "noturnstile@factorialstudio.com", password: "secret123" })).statusCode).toBe(201);
  });

  it("sign-up, forgot-password and contact need a valid token for their own form", async () => {
    await withTurnstile(async (calls) => {
      expect((await app.inject({ method: "GET", url: "/api/config/public" })).json()).toEqual({ turnstileSiteKey: "site-key-for-tests" });

      const missing = await post("/api/signup", { email: "bot@factorialstudio.com", password: "secret123" });
      expect(missing.statusCode).toBe(400);
      expect(missing.json().code).toBe("captcha-required");
      const bad = await post("/api/signup", { email: "bot@factorialstudio.com", password: "secret123", turnstileToken: "forged" });
      expect(bad.json().code).toBe("captcha-failed");
      // a token solved on another form doesn't count
      expect((await post("/api/signup", { email: "bot@factorialstudio.com", password: "secret123", turnstileToken: "good-contact" })).json().code).toBe("captcha-failed");
      expect((await post("/api/signup", { email: "human@factorialstudio.com", password: "secret123", turnstileToken: "good-signup" })).statusCode).toBe(201);
      expect(calls.at(-1)!.body).toMatchObject({ secret: "secret-for-tests", response: "good-signup", idempotency_key: expect.any(String) });
      // cheap validation happens before the token is spent
      expect((await post("/api/signup", { email: "", password: "x", turnstileToken: "good-signup" })).statusCode).toBe(400);
      const before = calls.length;
      await post("/api/signup", { email: "short@factorialstudio.com", password: "123" });
      expect(calls.length).toBe(before);

      expect((await post("/api/password/forgot", { email: "human@factorialstudio.com" })).json().code).toBe("captcha-required");
      expect((await post("/api/password/forgot", { email: "human@factorialstudio.com", turnstileToken: "good-forgot" })).statusCode).toBe(200);

      const contact = { name: "Ana", email: "ana@studio.io", message: "Pricing?" };
      expect((await post("/api/contact", contact)).json().code).toBe("captcha-required");
      expect((await post("/api/contact", { ...contact, turnstileToken: "good-contact" })).statusCode).toBe(201);
      // the honeypot still short-circuits bots before any verification
      expect((await post("/api/contact", { ...contact, website: "http://spam" })).json()).toEqual({ ok: true });

      // login and signed-in routes are not gated (the Unity plugin signs in without a browser)
      expect((await post("/api/login", { email: "human@factorialstudio.com", password: "secret123" })).statusCode).toBe(200);
      // oversized tokens are refused without calling Cloudflare
      const n = calls.length;
      expect((await post("/api/contact", { ...contact, turnstileToken: "x".repeat(3000) })).json().code).toBe("captcha-failed");
      expect(calls.length).toBe(n);
    });
  });

  it("fails open if Cloudflare can't be reached (rate limits still apply)", async () => {
    await withTurnstile(
      async () => {
        expect((await post("/api/signup", { email: "outage@factorialstudio.com", password: "secret123", turnstileToken: "anything" })).statusCode).toBe(201);
      },
      { down: true },
    );
  });

  it("sign-ups are rate-limited per network", async () => {
    for (let i = 0; i < 10; i++) expect((await post("/api/signup", { email: `burst${i}@factorialstudio.com`, password: "secret123" })).statusCode).toBe(201);
    expect((await post("/api/signup", { email: "burst-x@factorialstudio.com", password: "secret123" })).statusCode).toBe(429);
  });
});

describe("per-workspace two-factor policy", () => {
  const H = (t: string) => ({ authorization: `Bearer ${t}` });
  const call = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, token: string, payload?: Record<string, unknown>) =>
    app.inject({ method, url, headers: H(token), ...(payload ? { payload } : {}) });
  async function enable2fa(token: string) {
    const { generateToken } = await import("../src/totp.js");
    const secret = (await call("POST", "/api/2fa/begin", token)).json().secret as string;
    expect((await call("POST", "/api/2fa/confirm", token, { code: generateToken(secret) })).json()).toEqual({ enabled: true });
    return secret;
  }
  async function join(owner: string, email: string, role = "member") {
    await call("POST", "/api/orgs/current/invites", owner, { email, role });
    const m = [...outbox].reverse().find((x) => x.to === email && x.html.includes("?invite="))!;
    const t = await signup(email);
    await call("POST", "/api/invites/accept", t, { token: m.html.match(/[?&]invite=([a-f0-9]+)/)![1]! });
    return t;
  }

  it("admins turn it on only with 2FA themselves; members without 2FA are held at the door until they enable it", async () => {
    const owner = await signup("policy-owner@factorialstudio.com");
    const member = await join(owner, "policy-member@factorialstudio.com");
    await call("POST", "/api/apps", owner, { name: "Shared app" });
    expect((await call("GET", "/api/orgs/current", owner)).json().require2fa).toBe(false);

    const noSelf = await call("PATCH", "/api/orgs/current", owner, { require2fa: true });
    expect(noSelf.statusCode).toBe(400);
    expect(noSelf.json().code).toBe("2fa-self-required");
    expect((await call("PATCH", "/api/orgs/current", member, { require2fa: true })).statusCode).toBe(403); // members can't

    const ownerSecret = await enable2fa(owner);
    clearOutbox();
    const on = (await call("PATCH", "/api/orgs/current", owner, { require2fa: true })).json();
    expect(on.require2fa).toBe(true);
    expect(on.members.map((m: { email: string; twoFactor: boolean }) => [m.email, m.twoFactor]).sort()).toEqual([
      ["policy-member@factorialstudio.com", false],
      ["policy-owner@factorialstudio.com", true],
    ]);
    expect(outbox.filter((m) => m.subject.includes("requires two-factor")).map((m) => m.to)).toEqual(["policy-member@factorialstudio.com"]);

    // the member is blocked from workspace data — everything the plugin and dashboard do
    const blocked = await call("GET", "/api/apps", member);
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json()).toMatchObject({ code: "workspace-2fa-required", workspace: { name: "policy-owner's workspace" } });
    expect((await call("POST", "/api/apps", member, { name: "x" })).json().code).toBe("workspace-2fa-required");
    // …but can see why, and fix it or go elsewhere
    const me = (await call("GET", "/api/me", member)).json();
    expect(me).toMatchObject({ user: { twoFactor: false }, workspace: { require2fa: true } });
    expect((await call("GET", "/api/orgs/current", member)).statusCode).toBe(200);
    const list = (await call("GET", "/api/workspaces", member)).json();
    const own = list.find((w: { role: string }) => w.role === "owner");
    expect(list.find((w: { isCurrent: boolean }) => w.isCurrent).require2fa).toBe(true);
    expect((await call("POST", "/api/workspaces/switch", member, { orgId: own.id })).statusCode).toBe(200);
    expect((await call("GET", "/api/apps", member)).statusCode).toBe(200); // their own workspace has no policy
    await call("POST", "/api/workspaces/switch", member, { orgId: on.id });
    expect((await call("GET", "/api/apps", member)).statusCode).toBe(403);

    // enabling 2FA lets them in; turning it off is refused while the workspace requires it
    const memberSecret = await enable2fa(member);
    expect((await call("GET", "/api/apps", member)).json().map((a: { name: string }) => a.name)).toEqual(["Shared app"]);
    const { generateToken } = await import("../src/totp.js");
    const off = await call("POST", "/api/2fa/disable", member, { code: generateToken(memberSecret) });
    expect(off.statusCode).toBe(409);
    expect(off.json()).toMatchObject({ code: "2fa-required-by-workspace", workspaces: ["policy-owner's workspace"] });

    // the admin drops the policy (still needs 2FA to change it); then the member may turn 2FA off
    expect((await call("PATCH", "/api/orgs/current", owner, { require2fa: false })).json().require2fa).toBe(false);
    expect((await call("POST", "/api/2fa/disable", member, { code: generateToken(memberSecret) })).json()).toEqual({ enabled: false });
    expect(ownerSecret).toBeTruthy();
  });

  it("a blocked member can still leave the workspace", async () => {
    const owner = await signup("policy-owner2@factorialstudio.com");
    const member = await join(owner, "policy-leaver@factorialstudio.com");
    await enable2fa(owner);
    await call("PATCH", "/api/orgs/current", owner, { require2fa: true });
    expect((await call("GET", "/api/apps", member)).statusCode).toBe(403);
    const left = await call("DELETE", "/api/orgs/current/members/me", member);
    expect(left.json()).toMatchObject({ left: true, workspace: { role: "owner", require2fa: false } });
    expect((await call("GET", "/api/apps", member)).statusCode).toBe(200);
  });
});

describe("Start here checklist", () => {
  it("reports each getting-started step for the current workspace", async () => {
    const token = await signup("start@factorialstudio.com");
    const get = async () => (await app.inject({ method: "GET", url: "/api/onboarding", headers: bearer(token) })).json();
    let s = await get();
    expect(s).toMatchObject({
      emailVerified: false,
      domain: { verified: false },
      plan: { id: "free", networks: ["unityads"] },
      counts: { apps: 0, concepts: 0, creatives: 0, exports: 0 },
      firstAppId: null,
      firstConcept: null,
      plugin: { downloaded: false, connectedAt: null },
      workspace: { role: "owner", isOwner: true },
    });
    expect(s.plugin.version).toMatch(/^\d+\.\d+\.\d+$/);

    await verifyDomain("start@factorialstudio.com");
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(token), payload: { name: "A" } })).json().id;
    const conceptId = (await app.inject({ method: "POST", url: `/api/apps/${appId}/concepts`, headers: bearer(token), payload: { name: "C" } })).json().id;
    const form = new FormData();
    form.append("file", await fixtureZip(), { filename: "s.zip", contentType: "application/zip" });
    const cid = (await app.inject({ method: "POST", url: `/api/concepts/${conceptId}/creatives`, headers: { ...bearer(token), ...form.getHeaders() }, payload: form.getBuffer() })).json().id;
    await app.inject({ method: "POST", url: `/api/creatives/${cid}/export`, headers: bearer(token), payload: { networks: ["unityads"] } });
    await app.inject({ method: "GET", url: "/api/plugin/download", headers: bearer(token) });
    s = await get();
    expect(s).toMatchObject({
      domain: { verified: true },
      counts: { apps: 1, concepts: 1, creatives: 1, exports: 1 },
      firstAppId: appId,
      firstConcept: { id: conceptId, appId },
      plugin: { downloaded: true },
    });
    expect((await app.inject({ method: "GET", url: "/api/onboarding" })).statusCode).toBe(401);
  });
});

describe("company-email domain verification", () => {
  it("verifying a work email verifies its domain; free mail never does; the Domain page confirms it instantly", async () => {
    const { companyDomainOf } = await import("../src/email-domain.js");
    expect(companyDomainOf("ali@YourStudio.com")).toBe("yourstudio.com");
    expect(companyDomainOf("x@gmail.com")).toBeNull();
    expect(companyDomainOf("x@yahoo.co.uk")).toBeNull();
    expect(companyDomainOf("x@hotmail.fr")).toBeNull();
    expect(companyDomainOf("not-an-email")).toBeNull();

    const work = await signup("lead@acme-games.io");
    expect((await app.inject({ method: "GET", url: "/api/onboarding", headers: bearer(work) })).json()).toMatchObject({ companyDomain: "acme-games.io", domain: { verified: false } });
    const v = (await app.inject({ method: "POST", url: "/api/signup/verify", payload: { token: tokenFromMail("verify", "lead@acme-games.io") } })).json();
    expect(v).toEqual({ verified: true, email: "lead@acme-games.io", domainVerified: "acme-games.io" });
    expect((await app.inject({ method: "GET", url: "/api/domain", headers: bearer(work) })).json()).toMatchObject({ domain: "acme-games.io", verified: true });

    const free = await signup("someone@gmail.com");
    const fv = (await app.inject({ method: "POST", url: "/api/signup/verify", payload: { token: tokenFromMail("verify", "someone@gmail.com") } })).json();
    expect(fv.domainVerified).toBeNull();
    expect((await app.inject({ method: "GET", url: "/api/domain", headers: bearer(free) })).json().verified).toBe(false);

    // a work address verified before this feature: entering its own domain on the Domain page is instant
    const late = await signup("dev@late-studio.com");
    await app.inject({ method: "POST", url: "/api/signup/verify", payload: { token: tokenFromMail("verify", "dev@late-studio.com") } });
    const { getUserByEmail: byEmail, setDomainVerified: setVerified } = await import("../src/repo.js");
    await setVerified((await byEmail("dev@late-studio.com"))!.id, 0);
    const d = (await app.inject({ method: "POST", url: "/api/domain", headers: bearer(late), payload: { domain: "late-studio.com" } })).json();
    expect(d).toMatchObject({ domain: "late-studio.com", verified: true });
    const other = (await app.inject({ method: "POST", url: "/api/domain", headers: bearer(late), payload: { domain: "someone-else.com" } })).json();
    expect(other.verified).toBe(false); // a different domain still needs the file check
  });
});
