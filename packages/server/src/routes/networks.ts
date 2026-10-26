import type { FastifyInstance } from "fastify";
import { allNetworks } from "@forge/packager";

/** GET /api/networks — the catalog of supported ad networks and their specs. */
export async function networkRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/networks", async () =>
    allNetworks().map((n) => ({
      id: n.id,
      name: n.name,
      format: n.format,
      maxSizeBytes: n.maxSizeBytes,
      orientation: n.orientation,
      usesMraid: n.usesMraid,
      ext: n.ext,
      notes: n.notes,
    })),
  );
}
