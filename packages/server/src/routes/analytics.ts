import type { FastifyInstance } from "fastify";
import { getNetwork } from "@forge/packager";
import { authed } from "../auth.js";
import { countExportUsage, countExportUsageSince, exportByNetwork, exportDaily } from "../repo.js";
import { since30dIso } from "../plan-status.js";

function networkName(id: string): string {
  try {
    return getNetwork(id).name;
  } catch {
    return id;
  }
}

export async function analyticsRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/analytics", authed, async (req) => {
    const uid = req.user!.id;
    const since = since30dIso();

    const rows = new Map(exportDaily(uid, since).map((r) => [r.d, r.n]));
    const daily: { date: string; count: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const date = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      daily.push({ date, count: rows.get(date) ?? 0 });
    }

    return {
      total: countExportUsage(uid),
      last30: countExportUsageSince(uid, since),
      daily,
      byNetwork: exportByNetwork(uid).map((r) => ({ network: r.network, networkName: networkName(r.network), count: r.n })),
    };
  });
}
