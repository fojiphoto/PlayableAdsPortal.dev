import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createHmac } from "node:crypto";
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

describe("team / shared access", () => {
  it("invited member accesses the owner's apps; removal revokes it", async () => {
    const owner = await signup("teamowner@factorialstudio.com");
    const member = await signup("teammember@factorialstudio.com");
    const appId = (await app.inject({ method: "POST", url: "/api/apps", headers: bearer(owner), payload: { name: "Shared" } })).json().id;

    // before invite: member can't see it
    expect((await app.inject({ method: "GET", url: `/api/apps/${appId}`, headers: bearer(member) })).statusCode).toBe(404);

    const inv = await app.inject({ method: "POST", url: "/api/team/invite", headers: bearer(owner), payload: { email: "teammember@factorialstudio.com" } });
    expect(inv.statusCode).toBe(201);
    expect(inv.json()).toHaveLength(1);

    // now member can access it and it shows in their app list
    expect((await app.inject({ method: "GET", url: `/api/apps/${appId}`, headers: bearer(member) })).statusCode).toBe(200);
    const memberApps = (await app.inject({ method: "GET", url: "/api/apps", headers: bearer(member) })).json();
    expect(memberApps.map((a: { id: string }) => a.id)).toContain(appId);

    // inviting a non-existent user → 404
    expect((await app.inject({ method: "POST", url: "/api/team/invite", headers: bearer(owner), payload: { email: "nobody@x.com" } })).statusCode).toBe(404);

    // remove revokes access
    const memberId = inv.json()[0].id as string;
    await app.inject({ method: "DELETE", url: `/api/team/${memberId}`, headers: bearer(owner) });
    expect((await app.inject({ method: "GET", url: `/api/apps/${appId}`, headers: bearer(member) })).statusCode).toBe(404);
  });
});
