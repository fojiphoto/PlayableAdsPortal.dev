import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getNetwork } from "@forge/packager";
import { creativeExists, insertEvent, isEventKind } from "../repo.js";
import { rateLimit } from "../rate-limit.js";

// 1×1 transparent GIF — the pixel fallback the shim uses when sendBeacon is unavailable
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SESSION = /^[A-Za-z0-9_-]{4,40}$/;

type Q = { e?: string; s?: string; n?: string; p?: string; t?: string };

/**
 * Public in-playable analytics collector: `GET|POST /api/t/:creativeId/:network?e=<event>&s=<session>[&n=<name>][&p=1]`.
 * Unauthenticated by design (it is called from inside ads on other people's sites); the creative
 * UUID is the capability. Invalid hits are swallowed (still 200/204) so a bad beacon never shows
 * up as an error inside a creative. Rate-limited per IP.
 */
export async function trackRoutes(app: FastifyInstance): Promise<void> {
  // sendBeacon posts text/plain (or nothing) — accept and discard any body in this scope
  app.removeAllContentTypeParsers();
  app.addContentTypeParser("*", (_req, payload, done) => {
    payload.resume();
    done(null, undefined);
  });

  const handler = async (req: FastifyRequest<{ Params: { creativeId: string; network: string }; Querystring: Q }>, reply: FastifyReply) => {
    reply.header("cache-control", "no-store, private").header("access-control-allow-origin", "*");
    const respond = () => (req.method === "GET" ? reply.type("image/gif").send(GIF) : reply.code(204).send());

    if (!rateLimit(`track:${req.ip}`, 600, 60_000)) return reply.code(429).send();

    const { creativeId } = req.params;
    const q = req.query ?? {};
    const event = String(q.e ?? "");
    const session = String(q.s ?? "");
    if (!UUID.test(creativeId) || !isEventKind(event) || !SESSION.test(session) || !creativeExists(creativeId)) return respond();

    let network = String(req.params.network ?? "").slice(0, 40);
    try {
      getNetwork(network);
    } catch {
      network = "unknown";
    }
    const name = event === "custom" ? String(q.n ?? "").slice(0, 64) || null : null;
    insertEvent(creativeId, network, event, session, name, q.p === "1");
    return respond();
  };

  app.get("/api/t/:creativeId/:network", handler);
  app.post("/api/t/:creativeId/:network", handler);
}
