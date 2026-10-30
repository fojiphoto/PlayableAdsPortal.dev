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

export interface Analytics {
  total: number;
  last30: number;
  daily: { date: string; count: number }[];
  byNetwork: { network: string; networkName: string; count: number }[];
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
