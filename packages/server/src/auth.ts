import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string; email: string };
  }
}

// ── password hashing (scrypt, dependency-free) ────────────────────────────────
export function hashPassword(pw: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pw, salt, 32);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "base64");
  const expected = Buffer.from(parts[2]!, "base64");
  const actual = scryptSync(pw, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

// ── HMAC-signed JWT-style tokens (dependency-free) ────────────────────────────
function sign(data: string): string {
  return createHmac("sha256", config.jwtSecret).update(data).digest("base64url");
}

export interface TokenPayload {
  sub: string;
  email: string;
  iat: number;
  exp: number;
}

export function signToken(user: { id: string; email: string }): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const iat = Math.floor(Date.now() / 1000);
  const body: TokenPayload = { sub: user.id, email: user.email, iat, exp: iat + config.tokenTtlSeconds };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${header}.${payload}.${sign(`${header}.${payload}`)}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts as [string, string, string];
  // timing-safe signature comparison
  const expected = Buffer.from(sign(`${h}.${p}`));
  const got = Buffer.from(s);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const payload = JSON.parse(Buffer.from(p, "base64url").toString()) as TokenPayload;
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Fastify preHandler: require a valid Bearer token; sets req.user. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const h = req.headers.authorization;
  const token = h && h.startsWith("Bearer ") ? h.slice(7) : null;
  const payload = token ? verifyToken(token) : null;
  if (!payload) {
    await reply.code(401).send({ error: "unauthorized" });
    return;
  }
  req.user = { id: payload.sub, email: payload.email };
}

/** Route options spread that marks a route as authenticated. */
export const authed = { preHandler: requireAuth };
