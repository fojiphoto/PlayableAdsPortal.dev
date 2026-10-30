import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { authed } from "../auth.js";
import { getUserById, setDomainVerified, setUserDomain } from "../repo.js";
import { billingOwnerId, needs } from "../orgs.js";

const VERIFY_FILE = "factorialadlab-verify.txt";

/** Reject private / loopback / link-local / cloud-metadata ranges (SSRF defense). */
function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const p = ip.split(".").map(Number);
    return (
      p[0] === 10 ||
      p[0] === 127 ||
      p[0] === 0 ||
      (p[0] === 172 && p[1]! >= 16 && p[1]! <= 31) ||
      (p[0] === 192 && p[1] === 168) ||
      (p[0] === 169 && p[1] === 254) // link-local incl. 169.254.169.254 metadata
    );
  }
  const l = ip.toLowerCase();
  return (
    l === "::1" ||
    l.startsWith("fc") ||
    l.startsWith("fd") ||
    l.startsWith("fe80") ||
    l.startsWith("::ffff:127.") ||
    l.startsWith("::ffff:10.") ||
    l.startsWith("::ffff:169.254.") ||
    l.startsWith("::ffff:192.168.") ||
    l.startsWith("::ffff:172.")
  );
}

/** True only when every DNS answer for the domain is a public address. */
async function resolvesPublic(domain: string): Promise<boolean> {
  try {
    const addrs = await lookup(domain, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

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
  app.get("/api/domain", authed, async (req) => domainView(billingOwnerId(req.user!.id)));

  app.post<{ Body: { domain?: string } }>("/api/domain", needs("admin"), async (req, reply) => {
    const d = cleanDomain(req.body?.domain ?? "");
    if (!d) return reply.code(400).send({ error: "Enter a valid domain, e.g. factorialstudio.dev" });
    const u = getUserById(billingOwnerId(req.user!.id));
    const token = u?.domain === d && u?.domain_token ? u.domain_token : `fav-${randomBytes(16).toString("hex")}`;
    setUserDomain(billingOwnerId(req.user!.id), d, token);
    return domainView(billingOwnerId(req.user!.id));
  });

  app.post("/api/domain/check", needs("admin"), async (req, reply) => {
    const u = getUserById(billingOwnerId(req.user!.id));
    if (!u?.domain || !u.domain_token) return reply.code(400).send({ error: "Set a domain first" });
    const token = u.domain_token;
    // SSRF guard: only probe domains that resolve to public addresses
    if (!(await resolvesPublic(u.domain))) {
      setDomainVerified(billingOwnerId(req.user!.id), 0);
      return reply.code(400).send({ error: "Domain does not resolve to a public address" });
    }
    const urls = [`https://${u.domain}/${VERIFY_FILE}`, `https://${u.domain}/app-ads.txt`];
    const checked: string[] = [];
    let found = false;
    for (const url of urls) {
      try {
        // redirect:"manual" so a 3xx can't bounce us to an internal host
        const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: "manual" });
        checked.push(`${url} → ${res.status}`);
        if (res.ok && (await res.text()).slice(0, 300000).includes(token)) {
          found = true;
          break;
        }
      } catch (e) {
        checked.push(`${url} → ${(e as Error).name}`);
      }
    }
    setDomainVerified(billingOwnerId(req.user!.id), found ? 1 : 0);
    return { verified: found, checked };
  });
}
