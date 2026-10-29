import type { FastifyInstance } from "fastify";
import { getNetwork } from "@forge/packager";
import { authed } from "../auth.js";
import {
  createApp,
  createConcept,
  deleteApp,
  deleteConcept,
  getAppOwned,
  getConceptOwned,
  getUserById,
  listApps,
  listConcepts,
  listCreatives,
  updateApp,
  updateConcept,
  type AppRow,
  type ConceptRow,
  type CreativeRow,
} from "../repo.js";
import { getPlan } from "../plans.js";

/** Parse a stored network order; tolerate bad JSON. */
export function parseNetworkOrder(raw: string | null | undefined): string[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) && v.every((x) => typeof x === "string") && v.length ? v : null;
  } catch {
    return null;
  }
}

const appView = (a: AppRow) => ({
  id: a.id,
  name: a.name,
  platform: a.platform,
  createdAt: a.created_at,
});
const conceptView = (c: ConceptRow) => ({
  id: c.id,
  name: c.name,
  appId: c.app_id,
  networkOrder: parseNetworkOrder(c.network_order),
  createdAt: c.created_at,
});
const creativeRef = (c: CreativeRow) => ({ id: c.id, name: c.name, entry: c.entry, createdAt: c.created_at });

export async function appRoutes(app: FastifyInstance): Promise<void> {
  // ── apps ──
  app.post<{ Body: { name?: string; platform?: string } }>("/api/apps", authed, async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    return reply.code(201).send(appView(createApp(req.user!.id, name, req.body?.platform)));
  });

  app.get("/api/apps", authed, async (req) =>
    listApps(req.user!.id).map((a) => ({
      ...appView(a),
      conceptCount: listConcepts(a.id).length,
    })),
  );

  app.get<{ Params: { id: string } }>("/api/apps/:id", authed, async (req, reply) => {
    const a = getAppOwned(req.params.id, req.user!.id);
    if (!a) return reply.code(404).send({ error: "not found" });
    return { ...appView(a), concepts: listConcepts(a.id).map(conceptView) };
  });

  // rename / re-platform
  app.patch<{ Params: { id: string }; Body: { name?: string; platform?: string | null } }>(
    "/api/apps/:id",
    authed,
    async (req, reply) => {
      const name = req.body?.name?.trim();
      if (req.body?.name !== undefined && !name) return reply.code(400).send({ error: "name cannot be empty" });
      if (!updateApp(req.params.id, req.user!.id, { name, platform: req.body?.platform }))
        return reply.code(404).send({ error: "not found" });
      return appView(getAppOwned(req.params.id, req.user!.id)!);
    },
  );

  app.delete<{ Params: { id: string } }>("/api/apps/:id", authed, async (req, reply) => {
    return deleteApp(req.params.id, req.user!.id)
      ? { deleted: true }
      : reply.code(404).send({ error: "not found" });
  });

  // ── concepts (nested under an app) ──
  app.post<{ Params: { appId: string }; Body: { name?: string } }>(
    "/api/apps/:appId/concepts",
    authed,
    async (req, reply) => {
      const a = getAppOwned(req.params.appId, req.user!.id);
      if (!a) return reply.code(404).send({ error: "app not found" });
      const name = req.body?.name?.trim();
      if (!name) return reply.code(400).send({ error: "name required" });
      return reply.code(201).send(conceptView(createConcept(a.id, name)));
    },
  );

  app.get<{ Params: { appId: string } }>("/api/apps/:appId/concepts", authed, async (req, reply) => {
    const a = getAppOwned(req.params.appId, req.user!.id);
    if (!a) return reply.code(404).send({ error: "app not found" });
    return listConcepts(a.id).map(conceptView);
  });

  app.get<{ Params: { id: string } }>("/api/concepts/:id", authed, async (req, reply) => {
    const c = getConceptOwned(req.params.id, req.user!.id);
    if (!c) return reply.code(404).send({ error: "not found" });
    return { ...conceptView(c), creatives: listCreatives(c.id).map(creativeRef) };
  });

  // rename, and (Enterprise) set a custom export network order used when none is passed to /export
  app.patch<{ Params: { id: string }; Body: { name?: string; networkOrder?: string[] | null } }>(
    "/api/concepts/:id",
    authed,
    async (req, reply) => {
      const c = getConceptOwned(req.params.id, req.user!.id);
      if (!c) return reply.code(404).send({ error: "not found" });
      const name = req.body?.name?.trim();
      if (req.body?.name !== undefined && !name) return reply.code(400).send({ error: "name cannot be empty" });

      let networkOrder: string[] | null | undefined = undefined;
      if (req.body?.networkOrder !== undefined) {
        const plan = getPlan(getUserById(req.user!.id)?.plan);
        if (!plan.networkOrdering) {
          return reply.code(402).send({
            error: `Custom network ordering is an Enterprise feature (you're on ${plan.name}).`,
            code: "network-ordering-not-in-plan",
          });
        }
        if (req.body.networkOrder === null) networkOrder = null;
        else {
          if (!Array.isArray(req.body.networkOrder) || req.body.networkOrder.length === 0)
            return reply.code(400).send({ error: "networkOrder must be a non-empty array of network ids, or null" });
          try {
            req.body.networkOrder.forEach(getNetwork);
          } catch (e) {
            return reply.code(400).send({ error: (e as Error).message });
          }
          networkOrder = [...new Set(req.body.networkOrder)];
        }
      }
      updateConcept(c.id, req.user!.id, { name, networkOrder });
      return conceptView(getConceptOwned(c.id, req.user!.id)!);
    },
  );

  app.delete<{ Params: { id: string } }>("/api/concepts/:id", authed, async (req, reply) => {
    return deleteConcept(req.params.id, req.user!.id)
      ? { deleted: true }
      : reply.code(404).send({ error: "not found" });
  });
}
