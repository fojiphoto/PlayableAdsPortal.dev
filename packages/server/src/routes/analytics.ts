import type { FastifyInstance } from "fastify";
import { getNetwork } from "@forge/packager";
import { authed } from "../auth.js";
import {
  countExportUsage,
  countExportUsageSince,
  customEvents,
  eventByCreative,
  eventByNetwork,
  eventDaily,
  eventFunnel,
  exportByNetwork,
  exportDaily,
  getCreativeOwned,
  getUserById,
  setAnalyticsEnabled,
  type FunnelCounts,
} from "../repo.js";
import { since30dIso } from "../plan-status.js";

function networkName(id: string): string {
  try {
    return getNetwork(id).name;
  } catch {
    return id;
  }
}

const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0); // percent, 1 decimal

function funnelView(f: FunnelCounts) {
  return {
    impressions: f.impressions,
    engagements: f.engages,
    starts: f.starts,
    completes: f.completes,
    ctaClicks: f.ctas,
    engageRate: rate(f.engages, f.impressions),
    completionRate: rate(f.completes, f.impressions),
    ctr: rate(f.ctas, f.impressions),
  };
}

/** Clamp the look-back window: 1–90 days (raw events are pruned after 90). */
function windowFrom(q: { days?: string; preview?: string }) {
  const days = Math.max(1, Math.min(90, Number(q.days ?? 30) || 30));
  return { days, since: new Date(Date.now() - days * 86400000).toISOString(), includePreview: q.preview === "1" };
}

/** Daily series padded to every day in the window (zeros where nothing happened). */
function dailySeries(rows: (FunnelCounts & { d: string })[], days: number) {
  const byDay = new Map(rows.map((r) => [r.d, r]));
  const out: { date: string; impressions: number; engagements: number; ctaClicks: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    const r = byDay.get(date);
    out.push({ date, impressions: r?.impressions ?? 0, engagements: r?.engages ?? 0, ctaClicks: r?.ctas ?? 0 });
  }
  return out;
}

function playableBlock(userId: string, w: ReturnType<typeof windowFrom>, creativeId?: string) {
  return {
    ...funnelView(eventFunnel(userId, w.since, w.includePreview, creativeId)),
    daily: dailySeries(eventDaily(userId, w.since, w.includePreview, creativeId), w.days),
    byNetwork: eventByNetwork(userId, w.since, w.includePreview, creativeId).map((r) => ({
      network: r.network,
      networkName: networkName(r.network),
      ...funnelView(r),
    })),
    customEvents: customEvents(userId, w.since, w.includePreview, creativeId),
  };
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Dashboard analytics: in-playable funnel (impressions → engagement → CTA) from the beacons the
   * runtime shim sends, plus the billing-side export usage. `?days=7|30|90`, `?preview=1` to include
   * plays made in our own device preview (excluded by default).
   */
  app.get<{ Querystring: { days?: string; preview?: string } }>("/api/analytics", authed, async (req) => {
    const uid = req.user!.id;
    const w = windowFrom(req.query ?? {});
    const since = since30dIso();

    const rows = new Map(exportDaily(uid, since).map((r) => [r.d, r.n]));
    const daily: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      daily.push({ date, count: rows.get(date) ?? 0 });
    }

    return {
      // ── export usage (billing side) ──
      total: countExportUsage(uid),
      last30: countExportUsageSince(uid, since),
      daily,
      byNetwork: exportByNetwork(uid).map((r) => ({ network: r.network, networkName: networkName(r.network), count: r.n })),
      // ── in-playable performance ──
      tracking: { enabled: !!getUserById(uid)?.analytics_enabled },
      window: { days: w.days, includePreview: w.includePreview },
      playable: {
        ...playableBlock(uid, w),
        byCreative: eventByCreative(uid, w.since, w.includePreview).map((r) => ({
          creativeId: r.creative_id,
          creative: r.creative,
          concept: r.concept,
          app: r.app,
          ...funnelView(r),
        })),
      },
    };
  });

  /** Per-creative drill-down (same shape as `playable` above, scoped to one creative). */
  app.get<{ Params: { id: string }; Querystring: { days?: string; preview?: string } }>(
    "/api/creatives/:id/analytics",
    authed,
    async (req, reply) => {
      const cr = getCreativeOwned(req.params.id, req.user!.id);
      if (!cr) return reply.code(404).send({ error: "not found" });
      const w = windowFrom(req.query ?? {});
      return { creativeId: cr.id, name: cr.name, window: { days: w.days, includePreview: w.includePreview }, ...playableBlock(req.user!.id, w, cr.id) };
    },
  );

  /** Toggle in-playable tracking for future exports (existing packages keep whatever they were built with). */
  app.patch<{ Body: { enabled?: boolean } }>("/api/analytics/settings", authed, async (req, reply) => {
    if (typeof req.body?.enabled !== "boolean") return reply.code(400).send({ error: "enabled (boolean) is required" });
    setAnalyticsEnabled(req.user!.id, req.body.enabled);
    return { enabled: req.body.enabled };
  });
}
