import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { authed } from "../auth.js";
import { getUserById, setDomainVerified, setUserDomain } from "../repo.js";

const VERIFY_FILE = "factorialadlab-verify.txt";

function domainView(userId: string) {
  const u = getUserById(userId);
  return {
    domain: u?.domain ?? null,
    token: u?.domain_token ?? null,
    verified: !!u?.domain_verified,
    verifyFile: VERIFY_FILE,
  };
}

/** Normalize + sanity-check a user-supplied domain (no IPs/localhost → basic SSRF guard). */
function cleanDomain(input: string): string | null {
  const d = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) return null;
  if (d === "localhost" || /\.local$/.test(d) || /^\d+\.\d+\.\d+\.\d+$/.test(d)) return null;
  return d;
}

export async function domainRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/domain", authed, async (req) => domainView(req.user!.id));

  app.post<{ Body: { domain?: string } }>("/api/domain", authed, async (req, reply) => {
    const d = cleanDomain(req.body?.domain ?? "");
    if (!d) return reply.code(400).send({ error: "Enter a valid domain, e.g. factorialstudio.dev" });
    const u = getUserById(req.user!.id);
    const token = u?.domain === d && u?.domain_token ? u.domain_token : `fav-${randomBytes(16).toString("hex")}`;
    setUserDomain(req.user!.id, d, token);
    return domainView(req.user!.id);
  });

  app.post("/api/domain/check", authed, async (req, reply) => {
    const u = getUserById(req.user!.id);
    if (!u?.domain || !u.domain_token) return reply.code(400).send({ error: "Set a domain first" });
    const token = u.domain_token;
    const urls = [`https://${u.domain}/${VERIFY_FILE}`, `https://${u.domain}/app-ads.txt`];
    const checked: string[] = [];
    let found = false;
    for (const url of urls) {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "follow" });
        checked.push(`${url} → ${res.status}`);
        if (res.ok && (await res.text()).slice(0, 300000).includes(token)) {
          found = true;
          break;
        }
      } catch (e) {
        checked.push(`${url} → ${(e as Error).name}`);
      }
    }
    setDomainVerified(req.user!.id, found ? 1 : 0);
    return { verified: found, checked };
  });
}
