import type {
  App,
  AuthUser,
  Concept,
  CreativeDetail,
  CreativeRef,
  CreativeSummary,
  Network,
  PackResultView,
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
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) msg = body.error;
  } catch {
    /* ignore */
  }
  throw new Error(msg);
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

// ── auth ──
export const signup = (email: string, password: string) =>
  postJson<{ token: string; user: AuthUser }>("/signup", { email, password });
export const login = (email: string, password: string) =>
  postJson<{ token: string; user: AuthUser }>("/login", { email, password });
export const me = () => getJson<{ user: AuthUser }>("/me");

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
