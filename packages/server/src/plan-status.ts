import { countExportUsageSince, getUserById } from "./repo.js";
import { getPlan, networkAllowed } from "./plans.js";

export const since30dIso = () => new Date(Date.now() - 30 * 86400000).toISOString();

export interface PlanStatus {
  plan: string;
  planName: string;
  limit: number | null; // null = unlimited
  used: number;
  networks: "all" | string[];
  // ── subscription state (null/false when there is no Stripe subscription) ──
  /** Stripe subscription status: active | trialing | past_due | canceled | … */
  status: string | null;
  /** end of the current billing period — the renewal date, or the end date if cancelling */
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  hasSubscription: boolean;
}

export function planStatus(userId: string): PlanStatus {
  const user = getUserById(userId);
  const plan = getPlan(user?.plan);
  return {
    plan: plan.id,
    planName: plan.name,
    limit: plan.exportsPer30d,
    used: countExportUsageSince(userId, since30dIso()),
    networks: plan.networks,
    status: user?.plan_status ?? null,
    renewsAt: user?.plan_renews_at ?? null,
    cancelAtPeriodEnd: !!user?.plan_cancel_at_period_end,
    hasSubscription: !!user?.stripe_subscription_id,
  };
}

export type ExportCheck =
  | { ok: true }
  | { ok: false; code: "network-not-in-plan" | "quota-exceeded"; error: string; blocked?: string[]; used?: number; limit?: number };

/** Enforce plan rules before an export: allowed networks + rolling-30-day quota. */
export function checkExport(userId: string, networkIds: string[]): ExportCheck {
  const user = getUserById(userId);
  const plan = getPlan(user?.plan);

  const blocked = networkIds.filter((id) => !networkAllowed(plan, id));
  if (blocked.length) {
    const allowed = plan.networks === "all" ? "all networks" : (plan.networks as string[]).join(", ");
    return {
      ok: false,
      code: "network-not-in-plan",
      blocked,
      error: `Your ${plan.name} plan exports to ${allowed}. Upgrade to export to ${blocked.join(", ")}.`,
    };
  }

  if (plan.exportsPer30d != null) {
    const used = countExportUsageSince(userId, since30dIso());
    if (used + networkIds.length > plan.exportsPer30d) {
      return {
        ok: false,
        code: "quota-exceeded",
        used,
        limit: plan.exportsPer30d,
        error: `Export quota reached — ${used}/${plan.exportsPer30d} in the last 30 days. Upgrade for more.`,
      };
    }
  }
  return { ok: true };
}
