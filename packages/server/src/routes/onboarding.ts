import type { FastifyInstance } from "fastify";
import { authed } from "../auth.js";
import { db } from "../db.js";
import { currentOrgFor, getUserById } from "../repo.js";
import { getPlan } from "../plans.js";
import { currentRelease } from "../plugin/release.js";
import { companyDomainOf } from "../email-domain.js";

/**
 * "Start here" checklist (GET /api/onboarding): which getting-started steps are done for the caller's
 * current workspace, plus the ids the page needs to link straight to the next action.
 */
export async function onboardingRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/onboarding", authed, async (req) => {
    const uid = req.user!.id;
    const ws = await currentOrgFor(uid);
    const me = await getUserById(uid);
    const owner = await getUserById(ws.org.owner_user_id);
    const plan = getPlan(owner?.plan);
    const d = db();
    const org = ws.org.id;
    const count = async (sql: string, ...p: unknown[]) => Number((await d.prepare(sql).get<{ n: number }>(...p))?.n ?? 0);
    const first = async (sql: string, ...p: unknown[]) => (await d.prepare(sql).get<{ id: string }>(...p))?.id ?? null;

    const apps = await count("SELECT COUNT(*) AS n FROM apps WHERE org_id = ?", org);
    const concepts = await count("SELECT COUNT(*) AS n FROM concepts c JOIN apps a ON a.id = c.app_id WHERE a.org_id = ?", org);
    const creatives = await count(
      "SELECT COUNT(*) AS n FROM creatives cr JOIN concepts c ON c.id = cr.concept_id JOIN apps a ON a.id = c.app_id WHERE a.org_id = ?",
      org,
    );
    const exports = await count(
      "SELECT COUNT(*) AS n FROM exports e JOIN creatives cr ON cr.id = e.creative_id JOIN concepts c ON c.id = cr.concept_id JOIN apps a ON a.id = c.app_id WHERE a.org_id = ?",
      org,
    );
    const firstAppId = await first("SELECT id FROM apps WHERE org_id = ? ORDER BY created_at LIMIT 1", org);
    const firstConcept = (await d
      .prepare("SELECT c.id, c.app_id FROM concepts c JOIN apps a ON a.id = c.app_id WHERE a.org_id = ? ORDER BY c.created_at LIMIT 1")
      .get<{ id: string; app_id: string }>(org)) ?? null;
    const pluginDownloads = await count("SELECT COUNT(*) AS n FROM plugin_downloads WHERE user_id = ?", uid);
    const pluginLastSeen = (await d.prepare("SELECT MAX(last_seen) AS t FROM plugin_usage WHERE user_id = ?").get<{ t: string | null }>(uid))?.t ?? null;

    return {
      workspace: { id: org, name: ws.org.name, role: ws.role, isOwner: ws.org.owner_user_id === uid },
      emailVerified: !!me?.email_verified,
      /** the company domain of the sign-up email (null for Gmail & co.): verifying the email verifies it */
      companyDomain: me ? companyDomainOf(me.email) : null,
      domain: { name: owner?.domain ?? null, verified: !!owner?.domain_verified },
      plan: { id: plan.id, name: plan.name, networks: plan.networks },
      counts: { apps, concepts, creatives, exports },
      firstAppId,
      firstConcept: firstConcept ? { id: firstConcept.id, appId: firstConcept.app_id } : null,
      plugin: { version: currentRelease().version, downloaded: pluginDownloads > 0, connectedAt: pluginLastSeen },
    };
  });
}
