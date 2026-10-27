import type { FastifyInstance } from "fastify";
import { authed } from "../auth.js";
import { setUserPlan } from "../repo.js";
import { allPlans, isPlanId } from "../plans.js";
import { planStatus } from "../plan-status.js";

export async function billingRoutes(app: FastifyInstance): Promise<void> {
  // the plan catalog (public)
  app.get("/api/billing/plans", async () => allPlans());

  // current user's plan + usage
  app.get("/api/billing/status", authed, async (req) => planStatus(req.user!.id));

  // switch plan — STUB (sets immediately). Stripe checkout wires in here later.
  app.post<{ Body: { plan?: string } }>("/api/billing/plan", authed, async (req, reply) => {
    const plan = req.body?.plan;
    if (!plan || !isPlanId(plan)) return reply.code(400).send({ error: "unknown plan" });
    setUserPlan(req.user!.id, plan);
    return planStatus(req.user!.id);
  });
}
