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
  /** platform admin (Admin console) */
  isAdmin?: boolean;
  /** two-factor authentication is on */
  twoFactor?: boolean;
}

export interface App {
  id: string;
  name: string;
  platform?: string | null;
  /** preloader kit override: kit id, "none", or null = workspace default */
  kitId?: string | null;
  createdAt: string;
  conceptCount?: number;
}

export interface Concept {
  id: string;
  name: string;
  appId: string;
  /** preloader kit override: kit id, "none", or null = inherit from the app */
  kitId?: string | null;
  /** the kit this concept's exports actually get, and which level chose it */
  preloader?: EffectiveKit;
  createdAt: string;
}

export interface EffectiveKit {
  kitId: string | null;
  kitName: string | null;
  source: "concept" | "app" | "workspace" | null;
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

export type VariableValues = Record<string, number | string | boolean>;
export interface VariableDef {
  key: string;
  displayName?: string;
  section?: string;
  order?: number;
  type: "number" | "int" | "bool" | "string";
  min?: number;
  max?: number;
  step?: number;
  default: number | string | boolean;
}

export interface CreativeDetail {
  id: string;
  name: string;
  entry: string;
  conceptId: string;
  createdAt: string;
  exports: PackResultView[];
  variables: VariableValues;
  variableSchema: VariableDef[];
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

export type OrgRole = "owner" | "admin" | "member" | "viewer";

/** The caller's current workspace (from /api/me). */
export interface WorkspaceRef {
  id: string;
  name: string;
  role: OrgRole;
  ownerId: string;
  ownerEmail: string | null;
  /** every member must have two-factor authentication on */
  require2fa?: boolean;
}
export interface WorkspaceListItem {
  id: string;
  name: string;
  role: OrgRole;
  ownerEmail: string;
  memberCount: number;
  require2fa?: boolean;
  isCurrent: boolean;
}
export interface OrgMember {
  id: string;
  email: string;
  role: OrgRole;
  twoFactor?: boolean;
  createdAt: string;
}
export interface OrgInvite {
  id: string;
  email: string;
  role: OrgRole;
  expiresAt: string;
  createdAt: string;
}
export interface OrgDetail {
  id: string;
  name: string;
  role: OrgRole;
  require2fa?: boolean;
  owner: { id: string; email: string | null };
  members: OrgMember[];
  invites: OrgInvite[];
  createdAt: string;
}
export interface InviteInfo {
  org: string;
  email: string;
  role: OrgRole;
  expired: boolean;
  accepted: boolean;
}

export interface MeResponse extends PlanStatus {
  user: AuthUser;
  workspace: WorkspaceRef;
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
  customEvents: { name: string; hits: number; sessions: number; total: number | null }[];
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

export type PreloaderTemplateId = "classic" | "minimal" | "pulse" | "ring" | "dots" | "splash";
export interface PreloaderTemplate {
  id: PreloaderTemplateId;
  name: string;
  description: string;
  imageRole: "logo" | "background";
}
/** Editable fields of a preloader kit (logoDataUri: a data: URI to set, null to remove, absent to keep). */
export interface KitDraft {
  name: string;
  template: PreloaderTemplateId;
  bg: string | null;
  accent: string | null;
  text: string;
  showPercent: boolean;
  logoDataUri?: string | null;
}
export interface Kit {
  id: string;
  name: string;
  template: PreloaderTemplateId;
  bg: string | null;
  accent: string | null;
  text: string | null;
  showPercent: boolean;
  logoDataUri: string | null;
  usedBy?: number;
  createdAt: string;
  updatedAt: string;
}
export interface KitsState {
  kits: Kit[];
  defaultKitId: string | null;
  canEdit: boolean;
  canAssign: boolean;
  limit: number;
  assignments: {
    apps: { id: string; name: string; kitId: string | null }[];
    concepts: { id: string; name: string; appId: string; kitId: string | null }[];
  };
}

export interface DomainStatus {
  domain: string | null;
  token: string | null;
  verified: boolean;
  verifyFile: string;
}

export interface SizeBreakdown {
  loader: number;
  framework: number;
  wasm: number;
  data: number;
  streamingAssets: number;
  other: number;
  totalRaw: number;
  embedded: number;
}

/** Result of a "compile" job (Unity WebGL build → single-file playable). */
export interface CompileJobResult {
  creativeId: string;
  conceptId: string;
  name: string;
  sizeBytes: number;
  breakdown: SizeBreakdown;
  warnings: string[];
  unityVersion: string | null;
  compression: "none" | "gzip" | "brotli";
  fitsNetworks: string[];
  streamingAssetFiles: number;
}

/** Union of job results: export jobs carry `exported`, compile jobs carry `creativeId` + breakdown. */
export type JobResult = Partial<{ id: string; exported: PackResultView[] }> & Partial<CompileJobResult>;

/** Async job (GET /api/jobs/:id) — exports run in the background and are polled through this. */
export interface Job {
  id: string;
  kind: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number; // 0–100
  label: string | null;
  payload: unknown;
  result: JobResult | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

// ── support / admin ──
export interface SupportThread {
  id: string;
  subject: string;
  status: "open" | "closed";
  createdAt: string;
  updatedAt: string;
  unread: number;
}
export interface SupportMessage {
  id: string;
  authorId: string;
  authorEmail: string | null;
  fromSupport: boolean;
  body: string;
  createdAt: string;
}
export interface SupportThreadDetail extends SupportThread {
  user?: { id: string; email: string | null };
  orgId?: string;
  messages: SupportMessage[];
}
export interface AdminOverview {
  users: number;
  usersThisWeek: number;
  paidUsers: number;
  workspaces: number;
  apps: number;
  creatives: number;
  exports30d: number;
  playsToday: number;
  jobsFailed7d: number;
  jobsQueued: number;
  openThreads: number;
  unreadThreads: number;
  openBugs: number;
  openContacts: number;
  pluginDownloads30d: number;
  pluginBans: number;
}

// ── Unity plugin distribution ──
/** GET /api/onboarding — the "Start here" checklist status for the current workspace. */
export interface Onboarding {
  workspace: { id: string; name: string; role: OrgRole; isOwner: boolean };
  emailVerified: boolean;
  /** company domain of the sign-up email; null for free providers */
  companyDomain: string | null;
  domain: { name: string | null; verified: boolean };
  plan: { id: string; name: string; networks: "all" | string[] };
  counts: { apps: number; concepts: number; creatives: number; exports: number };
  firstAppId: string | null;
  firstConcept: { id: string; appId: string } | null;
  plugin: { version: string; downloaded: boolean; connectedAt: string | null };
}

export interface PluginRelease {
  version: string;
  unity: string;
  displayName: string;
  releasedAt: string | null;
  notes: string[];
  commit: string | null;
  minVersion: string | null;
}
export interface PluginDownload {
  id: string;
  wm: string;
  version: string;
  createdAt: string;
  accounts: number;
  lastSeenAt: string | null;
  banned: boolean;
}
export interface AdminPluginDownload extends PluginDownload {
  userId: string | null;
  email: string;
  ip: string | null;
  otherAccounts: number;
  requests: number;
}
export interface PluginBan {
  id: string;
  scope: "download" | "user";
  target: string;
  targetLabel: string | null;
  reason: string | null;
  createdAt: string;
  liftedAt: string | null;
}
export interface AdminUser {
  id: string;
  email: string;
  plan: string;
  planName: string;
  isAdmin: boolean;
  emailVerified: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  workspace: string | null;
  exports30d: number;
  creatives: number;
}
export interface AdminThread extends SupportThread {
  userEmail: string | null;
  workspace: string | null;
  plan: string | null;
}
export interface AdminBug {
  id: string;
  title: string;
  body: string;
  page: string | null;
  userEmail: string | null;
  workspace: string | null;
  handledAt: string | null;
  createdAt: string;
}
export interface AdminContact {
  id: string;
  name: string;
  email: string;
  company: string | null;
  message: string;
  handledAt: string | null;
  createdAt: string;
}
export interface AdminJob {
  id: string;
  kind: string;
  status: string;
  error: string | null;
  attempts: number;
  userEmail: string | null;
  createdAt: string;
  finishedAt: string | null;
}
