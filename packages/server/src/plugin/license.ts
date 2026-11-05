import { createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { config } from "../config.js";
import { getSetting, setSetting } from "../repo.js";

/**
 * Plugin licences (the competitor's `PlayableForgeLicense.json`: watermark + RSA signature).
 *
 * Every download carries a licence: a base64url JSON payload (licence id, watermark, who downloaded
 * it, plugin version) and an RSA-SHA256 PKCS#1 v1.5 signature over the payload string. The plugin
 * verifies it with the public key shipped in the release file and sends `payload.sig` back on every
 * request (`X-AdLab-License`), so the server can tell which download is talking — and refuse banned
 * ones. The private key comes from PLUGIN_SIGNING_KEY or is generated once and kept in the DB.
 */
export interface LicensePayload {
  v: 1;
  /** licence (download) id */
  lid: string;
  /** short watermark code, XXXX-XXXX-XXXX */
  wm: string;
  uid: string;
  email: string;
  org: string | null;
  /** plugin version this licence was issued with */
  ver: string;
  /** issued at (unix seconds) */
  iat: number;
  /** signing key id */
  kid: string;
}

const SETTING = "plugin_signing_key";
let cached: { pem: string; priv: KeyObject; pub: KeyObject; kid: string } | null = null;

function loadKey() {
  let pem = config.pluginSigningKey || getSetting(SETTING);
  if (!pem) {
    pem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    setSetting(SETTING, pem);
  }
  if (cached && cached.pem === pem) return cached;
  const priv = createPrivateKey(pem);
  const pub = createPublicKey(priv);
  const kid = createHash("sha256").update(pub.export({ type: "spki", format: "der" })).digest("hex").slice(0, 16);
  cached = { pem, priv, pub, kid };
  return cached;
}

/** The public key as RSA modulus/exponent (standard base64), which C#'s RSAParameters imports anywhere. */
export function publicKeyParams(): { kid: string; modulus: string; exponent: string } {
  const k = loadKey();
  const jwk = k.pub.export({ format: "jwk" }) as { n: string; e: string };
  const b64 = (s: string) => Buffer.from(s, "base64url").toString("base64");
  return { kid: k.kid, modulus: b64(jwk.n), exponent: b64(jwk.e) };
}

/** Short, human-readable watermark derived from the licence id. */
export function watermarkFor(lid: string): string {
  const h = createHmac("sha256", config.jwtSecret).update(`plugin-wm:${lid}`).digest("hex").slice(0, 12).toUpperCase();
  return `${h.slice(0, 4)}-${h.slice(4, 8)}-${h.slice(8, 12)}`;
}

/** Sign a licence; returns the compact form `payload.sig` and the file the package carries. */
export function issueLicense(p: Omit<LicensePayload, "v" | "kid" | "iat">): { compact: string; file: string; payload: LicensePayload } {
  const k = loadKey();
  const payload: LicensePayload = { v: 1, ...p, iat: Math.floor(Date.now() / 1000), kid: k.kid };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = sign("sha256", Buffer.from(body), k.priv).toString("base64");
  const file = JSON.stringify(
    { wm: payload.wm, licensee: payload.email, workspace: payload.org, version: payload.ver, issued: new Date(payload.iat * 1000).toISOString(), kid: k.kid, payload: body, sig },
    null,
    2,
  );
  return { compact: `${body}.${sig}`, file, payload };
}

/** Verify a compact licence from the X-AdLab-License header; null if malformed or not signed by us. */
export function verifyLicense(compact: string): LicensePayload | null {
  const dot = compact.lastIndexOf(".");
  if (dot <= 0 || compact.length > 4096) return null;
  const body = compact.slice(0, dot);
  const sig = compact.slice(dot + 1);
  try {
    if (!verify("sha256", Buffer.from(body), loadKey().pub, Buffer.from(sig, "base64"))) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as LicensePayload;
    return p && p.v === 1 && typeof p.lid === "string" ? p : null;
  } catch {
    return null;
  }
}

/** Forget the cached key (tests swap databases). */
export function resetLicenseKeyCache(): void {
  cached = null;
}
