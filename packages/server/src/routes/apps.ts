import type { FastifyInstance } from "fastify";
import { authed } from "../auth.js";
import {
  createApp,
  createConcept,
  deleteApp,
  deleteConcept,
  getAppOwned,
  getConceptOwned,
  listApps,
  listConcepts,
  listCreatives,
  type AppRow,
  type ConceptRow,
  type CreativeRow,
} from "../repo.js";

const appView = (a: AppRow) => ({
  id: a.id,
  name: a.name,
  platform: a.platform,
  createdAt: a.created_at,
});
const conceptView = (c: ConceptRow) => ({ id: c.id, name: c.name, appId: c.app_id, createdAt: c.created_at });
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

  app.delete<{ Params: { id: string } }>("/api/concepts/:id", authed, async (req, reply) => {
    return deleteConcept(req.params.id, req.user!.id)
      ? { deleted: true }
      : reply.code(404).send({ error: "not found" });
  });
}
