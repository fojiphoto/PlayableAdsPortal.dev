/**
 * Plan catalog + rules. Billing is stubbed for now (switching a plan just sets it);
 * Stripe checkout/webhooks wire in later against these same definitions.
 */
export type PlanId = "free" | "starter" | "studio" | "enterprise";

export interface PlanDef {
  id: PlanId;
  name: string;
  price: number | null; // monthly USD; null = custom
  priceLabel: string;
  /** exports allowed per rolling 30 days; null = unlimited */
  exportsPer30d: number | null;
  /** allowed network ids, or "all" */
  networks: "all" | string[];
  blurb: string;
  features: string[];
  popular?: boolean;
}

export const PLANS: Record<PlanId, PlanDef> = {
  free: {
    id: "free", name: "Free", price: 0, priceLabel: "$0", exportsPer30d: null, networks: ["unityads"],
    blurb: "Try it out", features: ["Unlimited Unity Ads exports", "Device-frame preview", "No card required"],
  },
  starter: {
    id: "starter", name: "Starter", price: 49, priceLabel: "$49/mo", exportsPer30d: 30, networks: "all",
    blurb: "For a solo dev shipping regularly", features: ["30 exports / 30 days", "All 20+ networks", "Custom CTA & store links"],
  },
  studio: {
    id: "studio", name: "Studio", price: 199, priceLabel: "$199/mo", exportsPer30d: 150, networks: "all", popular: true,
    blurb: "For a UA team", features: ["150 exports / 30 days", "All networks", "Team workspace", "Priority support"],
  },
  enterprise: {
    id: "enterprise", name: "Enterprise", price: null, priceLabel: "Custom", exportsPer30d: null, networks: "all",
    blurb: "Volume & SLA", features: ["Unlimited exports", "Custom network ordering", "Dedicated support"],
  },
};

export const DEFAULT_PLAN: PlanId = "free";

export function isPlanId(x: string): x is PlanId {
  return Object.prototype.hasOwnProperty.call(PLANS, x);
}

export function getPlan(id: string | undefined | null): PlanDef {
  return PLANS[id && isPlanId(id) ? id : DEFAULT_PLAN];
}

export function networkAllowed(plan: PlanDef, networkId: string): boolean {
  return plan.networks === "all" || plan.networks.includes(networkId);
}

export function allPlans(): PlanDef[] {
  return Object.values(PLANS);
}
