import type {
  App,
  AuthUser,
  Concept,
  CreativeDetail,
  CreativeRef,
  CreativeSummary,
  MeResponse,
  Network,
  PackResultView,
  Plan,
  PlanStatus,
  TeamMember,
  Analytics,
  PreloaderSettings,
  DomainStatus,
} from "./types";

// Same-origin by default ("/api"). For a split deploy (SPA and API on different hosts),
// build with VITE_API_BASE=https://api.factorialstudio.dev → base becomes that + "/api".
const base = `${import.meta.env.VITE_API_BASE ?? ""}/api`;
const TOKEN_KEY = "forge_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function authHeaders(): Record<string, string> {
  const t = getToken();
  return t ? { authorization: `Bearer ${t}` } : {};
}

async function toError(res: Response): Promise<never> {
  let msg = res.statusText;
  let code: string | undefined;
  try {
    const body = (await res.json()) as { error?: string; code?: string };
    if (body.error) msg = body.error;
    code = body.code;
  } catch {
    /* ignore */
  }
  const e = new Error(msg) as Error & { code?: string };
  if (code) e.code = code;
  throw e;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { headers: authHeaders() });
  if (!res.ok) return toError(res);
  return res.json();
}
async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) return toError(res);
  return res.json();
}

async function patchJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) return toError(res);
  return res.json();
}

// ── auth ──
export const signup = (email: string, password: string) =>
  postJson<{ token: string; user: AuthUser }>("/signup", { email, password });
export const login = (email: string, password: string, code?: string) =>
  postJson<{ token: string; user: AuthUser }>("/login", { email, password, code });
export const me = () => getJson<MeResponse>("/me");

// ── account / security ──
export const changePassword = (currentPassword: string, newPassword: string) =>
  postJson<{ ok: true }>("/users/password", { currentPassword, newPassword });
export const twofaStatus = () => getJson<{ enabled: boolean }>("/2fa/status");
export const twofaBegin = () => postJson<{ secret: string; otpauth: string }>("/2fa/begin", {});
export const twofaConfirm = (code: string) => postJson<{ enabled: boolean }>("/2fa/confirm", { code });
export const twofaDisable = (code: string) => postJson<{ enabled: boolean }>("/2fa/disable", { code });

// ── team ──
async function delJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { method: "DELETE", headers: authHeaders() });
  if (!res.ok) return toError(res);
  return res.json();
}
export const listTeam = () => getJson<TeamMember[]>("/team");
export const inviteTeam = (email: string) => postJson<TeamMember[]>("/team/invite", { email });
export const removeTeam = (memberId: string) => delJson<TeamMember[]>(`/team/${memberId}`);

// ── analytics ──
export const getAnalytics = () => getJson<Analytics>("/analytics");

// ── preloader ──
export const getPreloader = () => getJson<PreloaderSettings>("/preloader");
export async function savePreloader(fields: {
  enabled: boolean;
  bg?: string;
  logo?: File | null;
  removeLogo?: boolean;
}): Promise<PreloaderSettings> {
  const fd = new FormData();
  fd.append("enabled", fields.enabled ? "1" : "0");
  if (fields.bg) fd.append("bg", fields.bg);
  if (fields.logo) fd.append("logo", fields.logo);
  if (fields.removeLogo) fd.append("removeLogo", "1");
  const res = await fetch(`${base}/preloader`, { method: "POST", headers: authHeaders(), body: fd });
  if (!res.ok) return toError(res);
  return res.json();
}

// ── domain verification ──
export const getDomain = () => getJson<DomainStatus>("/domain");
export const setDomain = (domain: string) => postJson<DomainStatus>("/domain", { domain });
export const checkDomain = () => postJson<{ verified: boolean; checked: string[] }>("/domain/check", {});

// ── billing / plans ──
export const listPlans = () => getJson<Plan[]>("/billing/plans");
export const getBillingStatus = () => getJson<PlanStatus>("/billing/status");
/** @deprecated dev-only direct switch; prefer checkout() */
export const setPlan = (plan: string) => postJson<PlanStatus>("/billing/plan", { plan });
/** Start an upgrade: with Stripe → { url } to redirect to Checkout; without → { dev, status }. */
export const checkout = (plan: string) =>
  postJson<{ url?: string; dev?: boolean; contact?: boolean; status?: PlanStatus }>("/billing/checkout", { plan });
/** Open the Stripe billing portal (returns a { url } to redirect to). */
export const billingPortal = () => postJson<{ url: string }>("/billing/portal", {});

// ── rename / update ──
export const renameApp = (id: string, name: string) => patchJson<App>(`/apps/${id}`, { name });
export const renameConcept = (id: string, name: string) => patchJson<Concept>(`/concepts/${id}`, { name });
/** Enterprise: custom export network order for a concept (null = default). */
export const setNetworkOrder = (conceptId: string, order: string[] | null) =>
  patchJson<Concept>(`/concepts/${conceptId}`, { networkOrder: order });
export const updateCreative = (
  id: string,
  patch: { name?: string; ctaUrl?: string | null; iosUrl?: string | null; androidUrl?: string | null },
) => patchJson<CreativeDetail>(`/creatives/${id}`, patch);

// ── networks ──
export const getNetworks = () => getJson<Network[]>("/networks");

// ── apps / concepts ──
export const listApps = () => getJson<App[]>("/apps");
export const createApp = (name: string, platform?: string) => postJson<App>("/apps", { name, platform });
export const getApp = (id: string) => getJson<App & { concepts: Concept[] }>(`/apps/${id}`);
export const listConcepts = (appId: string) => getJson<Concept[]>(`/apps/${appId}/concepts`);
export const createConcept = (appId: string, name: string) => postJson<Concept>(`/apps/${appId}/concepts`, { name });
export const getConcept = (id: string) => getJson<Concept & { creatives: CreativeRef[] }>(`/concepts/${id}`);

// ── creatives ──
export interface UploadFields {
  name?: string;
  ctaUrl?: string;
  iosUrl?: string;
  androidUrl?: string;
}
export async function uploadCreative(conceptId: string, file: File, fields: UploadFields): Promise<CreativeSummary> {
  const fd = new FormData();
  fd.append("file", file);
  for (const [k, v] of Object.entries(fields)) if (v) fd.append(k, v);
  const res = await fetch(`${base}/concepts/${conceptId}/creatives`, {
    method: "POST",
    headers: authHeaders(),
    body: fd,
  });
  if (!res.ok) return toError(res);
  return res.json();
}
export const getCreative = (id: string) => getJson<CreativeDetail>(`/creatives/${id}`);
export async function exportCreative(id: string, networks: string[]): Promise<PackResultView[]> {
  const r = await postJson<{ exported: PackResultView[] }>(`/creatives/${id}/export`, { networks });
  return r.exported;
}

// ── public delivery (UUID-guarded; usable as <a href>/<iframe src>) ──
export const downloadUrl = (id: string, network: string) => `${base}/creatives/${id}/download/${network}`;
export const downloadAllUrl = (id: string) => `${base}/creatives/${id}/download-all`;
export const previewUrl = (id: string, network: string) => `${base}/creatives/${id}/preview/${network}`;
