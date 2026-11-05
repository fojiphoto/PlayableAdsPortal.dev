import { defineConfig } from "vitest/config";

// The same suite against real Postgres (PGlite, in-process): `npm run test:pg -w @forge/server`.
export default defineConfig({
  test: { env: { FORGE_DB_DRIVER: "pglite" } },
});
