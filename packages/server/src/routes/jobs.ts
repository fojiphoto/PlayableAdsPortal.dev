import type { FastifyInstance } from "fastify";
import { authed } from "../auth.js";
import { getJobOwned, listJobs } from "../repo.js";
import { jobView } from "../jobs.js";

/** Job status/result polling for async work (exports today). Jobs are private to the user who queued them. */
export async function jobRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string } }>("/api/jobs", authed, async (req) => {
    const limit = Number(req.query?.limit ?? 20) || 20;
    return listJobs(req.user!.id, limit).map(jobView);
  });

  app.get<{ Params: { id: string } }>("/api/jobs/:id", authed, async (req, reply) => {
    const j = getJobOwned(req.params.id, req.user!.id);
    if (!j) return reply.code(404).send({ error: "not found" });
    return jobView(j);
  });
}
