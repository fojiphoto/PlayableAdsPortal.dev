import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { config } from "./config.js";
import { currentOrgFor, getUserById } from "./repo.js";

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
  await requireWorkspace2fa(req, reply);
}

/**
 * Routes a member of a 2FA-required workspace can still use without 2FA: setting it up, their account,
 * and leaving / switching / creating a workspace (so the requirement never traps anyone).
 */
const TWO_FA_EXEMPT: [string, RegExp][] = [
  ["GET", /^\/api\/me$/],
  ["*", /^\/api\/2fa\//],
  ["POST", /^\/api\/users\/password$/],
  ["POST", /^\/api\/signup\/resend$/],
  ["GET", /^\/api\/workspaces$/],
  ["POST", /^\/api\/workspaces\/switch$/],
  ["POST", /^\/api\/orgs$/],
  ["GET", /^\/api\/orgs\/current$/],
  ["DELETE", /^\/api\/orgs\/current\/members\/me$/],
  ["POST", /^\/api\/invites\/accept$/],
];

/** The workspace's two-factor policy: members without 2FA get 403 `workspace-2fa-required`. */
async function requireWorkspace2fa(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const path = (req.raw.url ?? "").split("?")[0]!;
  if (TWO_FA_EXEMPT.some(([m, re]) => (m === "*" || m === req.method) && re.test(path))) return;
  const ws = await currentOrgFor(req.user!.id);
  if (!ws.org.require_2fa) return;
  const u = await getUserById(req.user!.id);
  if (u?.totp_enabled) return;
  await reply.code(403).send({
    error: `${ws.org.name} requires two-factor authentication. Turn it on in Settings ▸ Security (or switch workspace) to continue.`,
    code: "workspace-2fa-required",
    workspace: { id: ws.org.id, name: ws.org.name },
  });
}

/** Route options spread that marks a route as authenticated. */
export const authed = { preHandler: requireAuth };

// ── opaque one-time tokens (password reset / email verification) ─────────────
// The raw token goes in the email link; only its sha256 is stored, so a DB leak can't be replayed.
export function hashOpaqueToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
export function createOpaqueToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString("hex");
  return { raw, hash: hashOpaqueToken(raw) };
}
