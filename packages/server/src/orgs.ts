/**
 * Organizations / workspaces / roles (parity gap #5).
 *
 * Every user owns a personal workspace; apps live in a workspace; a user is in one *current*
 * workspace at a time (`users.current_org_id`, switched via /api/workspaces/switch). The workspace
 * owner's plan, domain verification, billing and export quota apply to everything in it.
 *
 * Roles (lowest → highest): viewer < member < admin < owner.
 *   viewer  — read, preview, download
 *   member  — + create apps/concepts, upload, capture, compile, export, rename
 *   admin   — + delete, manage members & invites, domain, preloader, analytics settings, network order
 *   owner   — + billing, transfer ownership, delete workspace
 */
import type { FastifyReply, FastifyRequest, RouteShorthandOptions, preHandlerHookHandler } from "fastify";
import { authed } from "./auth.js";
import { currentOrgFor, type OrgRole, type OrgRow } from "./repo.js";

export interface Workspace {
  org: OrgRow;
  role: OrgRole;
}

declare module "fastify" {
  interface FastifyRequest {
    /** set by `needs(role)` routes: the caller's current workspace + role */
    workspace?: Workspace;
  }
}

export const ROLES: OrgRole[] = ["viewer", "member", "admin", "owner"];
const RANK: Record<OrgRole, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
export const isRole = (s: unknown): s is OrgRole => typeof s === "string" && (ROLES as string[]).includes(s);
export const atLeast = (role: OrgRole, min: OrgRole): boolean => RANK[role] >= RANK[min];

function forbid(reply: FastifyReply, role: OrgRole, min: OrgRole) {
  return reply.code(403).send({
    error: `This needs the ${min} role in the current workspace (you are ${role}).`,
    code: "role-insufficient",
    role,
    required: min,
  });
}

/** Route options: authenticated AND holding at least `min` in the current workspace (403 `role-insufficient` otherwise). */
export function needs(min: OrgRole): RouteShorthandOptions {
  const base = authed as RouteShorthandOptions;
  const ph = base.preHandler;
  const prior: preHandlerHookHandler[] = ph ? (Array.isArray(ph) ? ph : [ph]) : [];
  const gate: preHandlerHookHandler = async (req, reply) => {
    const ws = currentOrgFor(req.user!.id);
    req.workspace = ws;
    if (!atLeast(ws.role, min)) return forbid(reply, ws.role, min);
  };
  return { ...base, preHandler: [...prior, gate] };
}

/** Inline check for handlers that only sometimes need a higher role (e.g. one field of a PATCH). */
export function requireRole(req: FastifyRequest, reply: FastifyReply, min: OrgRole): Workspace | undefined {
  const ws = req.workspace ?? currentOrgFor(req.user!.id);
  if (!atLeast(ws.role, min)) {
    forbid(reply, ws.role, min);
    return undefined;
  }
  return ws;
}

/** The user whose plan / domain / billing / quota govern the caller's current workspace. */
export function billingOwnerId(userId: string): string {
  return currentOrgFor(userId).org.owner_user_id;
}

export function workspaceView(ws: Workspace, ownerEmail?: string) {
  return { id: ws.org.id, name: ws.org.name, role: ws.role, ownerId: ws.org.owner_user_id, ownerEmail: ownerEmail ?? null };
}
