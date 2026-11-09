import type { FastifyInstance } from "fastify";
import { getNetwork } from "@forge/packager";
import { authed } from "../auth.js";
import { db } from "../db.js";
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
  setAppKit,
  setConceptKit,
  updateApp,
  updateConcept,
  type AppRow,
  type ConceptRow,
  type CreativeMeta,
} from "../repo.js";
import { getPlan } from "../plans.js";
import { billingOwnerId, needs, requireRole } from "../orgs.js";
import { effectiveKitView } from "../preloader-config.js";
import { checkKitRef } from "./preloader.js";

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
  kitId: a.kit_id,
  createdAt: a.created_at,
});
const conceptView = (c: ConceptRow) => ({
  id: c.id,
  name: c.name,
  appId: c.app_id,
  networkOrder: parseNetworkOrder(c.network_order),
  kitId: c.kit_id,
  createdAt: c.created_at,
});
const creativeRef = (c: CreativeMeta) => ({ id: c.id, name: c.name, entry: c.entry, createdAt: c.created_at });

export async function appRoutes(app: FastifyInstance): Promise<void> {
  // ── apps ──
  app.post<{ Body: { name?: string; platform?: string } }>("/api/apps", needs("member"), async (req, reply) => {
    const name = req.body?.name?.trim();
    if (!name) return reply.code(400).send({ error: "name required" });
    return reply.code(201).send(appView(await createApp(req.user!.id, req.workspace!.org.id, name, req.body?.platform)));
  });

  /** playables (creatives) and exports under one app, for the library table */
  async function appCounts(appId: string): Promise<{ creativeCount: number; exportCount: number }> {
    const row = await db()
      .prepare(
        `SELECT (SELECT COUNT(*) FROM creatives cr JOIN concepts c ON c.id = cr.concept_id WHERE c.app_id = ?) AS creatives,
                (SELECT COUNT(*) FROM exports e JOIN creatives cr ON cr.id = e.creative_id JOIN concepts c ON c.id = cr.concept_id WHERE c.app_id = ?) AS exports`,
      )
      .get<{ creatives: number; exports: number }>(appId, appId);
    return { creativeCount: Number(row?.creatives ?? 0), exportCount: Number(row?.exports ?? 0) };
  }

  app.get("/api/apps", authed, async (req) =>
    Promise.all(
      (await listApps(req.user!.id)).map(async (a) => ({
        ...appView(a),
        conceptCount: (await listConcepts(a.id)).length,
        ...(await appCounts(a.id)),
      })),
    ),
  );

  app.get<{ Params: { id: string } }>("/api/apps/:id", authed, async (req, reply) => {
    const a = await getAppOwned(req.params.id, req.user!.id);
    if (!a) return reply.code(404).send({ error: "not found" });
    return { ...appView(a), concepts: (await listConcepts(a.id)).map(conceptView) };
  });

  // rename / re-platform
  app.patch<{ Params: { id: string }; Body: { name?: string; platform?: string | null; kitId?: string | null } }>(
    "/api/apps/:id",
    needs("member"),
    async (req, reply) => {
      const name = req.body?.name?.trim();
      if (req.body?.name !== undefined && !name) return reply.code(400).send({ error: "name cannot be empty" });
      // preloader kit for the whole app (null = workspace default, "none" = no preloader)
      let kit: string | null | undefined;
      if (req.body?.kitId !== undefined) {
        const r = await checkKitRef(req.body.kitId, req.workspace!.org.id);
        if (!r.ok) return reply.code(400).send({ error: r.error });
        kit = r.value;
      }
      if (!await updateApp(req.params.id, req.user!.id, { name, platform: req.body?.platform }))
        return reply.code(404).send({ error: "not found" });
      if (kit !== undefined) await setAppKit(req.params.id, kit);
      return appView((await getAppOwned(req.params.id, req.user!.id))!);
    },
  );

  app.delete<{ Params: { id: string } }>("/api/apps/:id", needs("admin"), async (req, reply) => {
    return await deleteApp(req.params.id, req.user!.id)
      ? { deleted: true }
      : reply.code(404).send({ error: "not found" });
  });

  // ── concepts (nested under an app) ──
  app.post<{ Params: { appId: string }; Body: { name?: string } }>(
    "/api/apps/:appId/concepts",
    needs("member"),
    async (req, reply) => {
      const a = await getAppOwned(req.params.appId, req.user!.id);
      if (!a) return reply.code(404).send({ error: "app not found" });
      const name = req.body?.name?.trim();
      if (!name) return reply.code(400).send({ error: "name required" });
      return reply.code(201).send(conceptView(await createConcept(a.id, name)));
    },
  );

  app.get<{ Params: { appId: string } }>("/api/apps/:appId/concepts", authed, async (req, reply) => {
    const a = await getAppOwned(req.params.appId, req.user!.id);
    if (!a) return reply.code(404).send({ error: "app not found" });
    return (await listConcepts(a.id)).map(conceptView);
  });

  app.get<{ Params: { id: string } }>("/api/concepts/:id", authed, async (req, reply) => {
    const c = await getConceptOwned(req.params.id, req.user!.id);
    if (!c) return reply.code(404).send({ error: "not found" });
    return { ...conceptView(c), preloader: await effectiveKitView(c.id), creatives: (await listCreatives(c.id)).map(creativeRef) };
  });

  // rename, and (Enterprise) set a custom export network order used when none is passed to /export
  app.patch<{ Params: { id: string }; Body: { name?: string; networkOrder?: string[] | null; kitId?: string | null } }>(
    "/api/concepts/:id",
    needs("member"),
    async (req, reply) => {
      const c = await getConceptOwned(req.params.id, req.user!.id);
      if (!c) return reply.code(404).send({ error: "not found" });
      const name = req.body?.name?.trim();
      if (req.body?.name !== undefined && !name) return reply.code(400).send({ error: "name cannot be empty" });

      let networkOrder: string[] | null | undefined = undefined;
      if (req.body?.networkOrder !== undefined) {
        if (!await requireRole(req, reply, "admin")) return reply; // changing the export set is an admin action
        const plan = getPlan((await getUserById(await billingOwnerId(req.user!.id)))?.plan); // the workspace's plan
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
      // preloader kit for this concept (null = inherit from the app / workspace, "none" = no preloader)
      if (req.body?.kitId !== undefined) {
        const r = await checkKitRef(req.body.kitId, req.workspace!.org.id);
        if (!r.ok) return reply.code(400).send({ error: r.error });
        await setConceptKit(c.id, r.value);
      }
      await updateConcept(c.id, req.user!.id, { name, networkOrder });
      return { ...conceptView((await getConceptOwned(c.id, req.user!.id))!), preloader: await effectiveKitView(c.id) };
    },
  );

  app.delete<{ Params: { id: string } }>("/api/concepts/:id", needs("admin"), async (req, reply) => {
    return await deleteConcept(req.params.id, req.user!.id)
      ? { deleted: true }
      : reply.code(404).send({ error: "not found" });
  });
}
