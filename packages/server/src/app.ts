import { existsSync } from "node:fs";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { config } from "./config.js";
import { getDb } from "./db.js";
import { networkRoutes } from "./routes/networks.js";
import { authRoutes } from "./routes/auth.js";
import { appRoutes } from "./routes/apps.js";
import { creativeRoutes } from "./routes/creatives.js";
import { billingRoutes } from "./routes/billing.js";
import { accountRoutes } from "./routes/account.js";
import { orgRoutes } from "./routes/orgs.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { preloaderRoutes } from "./routes/preloader.js";
import { domainRoutes } from "./routes/domain.js";
import { jobRoutes } from "./routes/jobs.js";
import { trackRoutes } from "./routes/track.js";
import { compileRoutes } from "./routes/compile.js";

/** Build the Fastify app (exported separately so tests can drive it via inject()). */
export async function buildApp(): Promise<FastifyInstance> {
  getDb(); // ensure the database + schema exist

  const app = Fastify({ logger: false, bodyLimit: config.maxUploadBytes });

  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: config.maxUploadBytes } });

  app.get("/api/health", async () => ({ ok: true, service: "forge-server" }));

  await app.register(networkRoutes);
  await app.register(authRoutes);
  await app.register(appRoutes);
  await app.register(creativeRoutes);
  await app.register(billingRoutes);
  await app.register(accountRoutes);
  await app.register(orgRoutes);
  await app.register(analyticsRoutes);
  await app.register(preloaderRoutes);
  await app.register(domainRoutes);
  await app.register(jobRoutes);
  await app.register(trackRoutes);
  await app.register(compileRoutes);

  // Serve the built web SPA from the same origin (no CORS/proxy needed in prod).
  if (existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method !== "GET" || req.raw.url?.startsWith("/api")) {
        return reply.code(404).send({ error: "not found" });
      }
      return reply.sendFile("index.html"); // SPA fallback
    });
  }

  return app;
}
