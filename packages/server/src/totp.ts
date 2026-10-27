import { createHmac, randomBytes } from "node:crypto";

// RFC 6238 TOTP (SHA1, 6 digits, 30s) + base32 — dependency-free.
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateSecret(bytes = 20): string {
  const buf = randomBytes(bytes);
  let bits = "";
  for (const b of buf) bits += b.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = "";
  for (const c of clean) {
    const v = B32.indexOf(c);
    if (v >= 0) bits += v.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret: string, counter: number): string {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", key).update(buf).digest();
  const o = h[h.length - 1]! & 0xf;
  const code =
    ((h[o]! & 0x7f) << 24) | ((h[o + 1]! & 0xff) << 16) | ((h[o + 2]! & 0xff) << 8) | (h[o + 3]! & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

/** Current 6-digit code for a secret (used in tests and demos). */
export function generateToken(secret: string): string {
  return hotp(secret, Math.floor(Date.now() / 30000));
}

export function verifyTotp(secret: string, token: string, window = 1): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const counter = Math.floor(Date.now() / 30000);
  for (let w = -window; w <= window; w++) {
    if (hotp(secret, counter + w) === token) return true;
  }
  return false;
}

export function otpauthURL(secret: string, label: string, issuer = "Factorial AdLab"): string {
  const l = encodeURIComponent(`${issuer}:${label}`);
  return `otpauth://totp/${l}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
