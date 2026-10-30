export interface Network {
  id: string;
  name: string;
  format: string;
  maxSizeBytes: number;
  orientation: string;
  usesMraid: boolean;
  ext: string;
  notes?: string;
}

export interface ValidationIssue {
  level: "error" | "warning";
  code: string;
  message: string;
}

export interface PackResultView {
  network: string;
  networkName: string;
  filename: string;
  format: string;
  sizeBytes: number;
  maxSizeBytes: number;
  sizeLabel: string;
  ok: boolean;
  validation: ValidationIssue[];
}

export interface AuthUser {
  id: string;
  email: string;
  emailVerified?: boolean;
}

export interface App {
  id: string;
  name: string;
  platform?: string | null;
  createdAt: string;
  conceptCount?: number;
}

export interface Concept {
  id: string;
  name: string;
  appId: string;
  createdAt: string;
}

export interface CreativeRef {
  id: string;
  name: string;
  entry: string;
  createdAt: string;
}

export interface CreativeSummary {
  id: string;
  name: string;
  entry: string;
  fileCount: number;
  conceptId: string;
  createdAt: string;
}

export interface CreativeDetail {
  id: string;
  name: string;
  entry: string;
  conceptId: string;
  createdAt: string;
  exports: PackResultView[];
}

export interface Plan {
  id: string;
  name: string;
  price: number | null;
  priceLabel: string;
  exportsPer30d: number | null;
  networks: "all" | string[];
  blurb: string;
  features: string[];
  popular?: boolean;
}

export interface PlanStatus {
  plan: string;
  planName: string;
  limit: number | null; // null = unlimited
  used: number;
  networks: "all" | string[];
  status: string | null;
  renewsAt: string | null;
  cancelAtPeriodEnd: boolean;
  hasSubscription: boolean;
}

export interface MeResponse extends PlanStatus {
  user: AuthUser;
}

export interface TeamMember {
  id: string;
  email: string;
  role: string;
  createdAt: string;
}

/** In-playable funnel counts (unique play sessions) + derived rates in percent. */
export interface Funnel {
  impressions: number;
  engagements: number;
  starts: number;
  completes: number;
  ctaClicks: number;
  engageRate: number;
  completionRate: number;
  ctr: number;
}

export interface PlayableAnalytics extends Funnel {
  daily: { date: string; impressions: number; engagements: number; ctaClicks: number }[];
  byNetwork: (Funnel & { network: string; networkName: string })[];
  customEvents: { name: string; hits: number; sessions: number }[];
}

export interface Analytics {
  // export usage (billing side)
  total: number;
  last30: number;
  daily: { date: string; count: number }[];
  byNetwork: { network: string; networkName: string; count: number }[];
  // in-playable performance
  tracking: { enabled: boolean };
  window: { days: number; includePreview: boolean };
  playable: PlayableAnalytics & {
    byCreative: (Funnel & { creativeId: string; creative: string; concept: string; app: string })[];
  };
}

export interface PreloaderSettings {
  enabled: boolean;
  bg: string | null;
  logoDataUri: string | null;
}

export interface DomainStatus {
  domain: string | null;
  token: string | null;
  verified: boolean;
  verifyFile: string;
}

/** Async job (GET /api/jobs/:id) — exports run in the background and are polled through this. */
export interface Job {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number; // 0–100
  label: string | null;
  payload: unknown;
  result: { id: string; exported: PackResultView[] } | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}
