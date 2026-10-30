import { buildApp } from "./app.js";
import { config, isDevSecret } from "./config.js";
import { startWorker, stopWorker } from "./jobs.js";

// Fail fast: never run in production with the insecure dev token secret.
if (config.isProduction && isDevSecret) {
  console.error("[forge-server] FATAL: JWT_SECRET must be set in production (refusing to start).");
  process.exit(1);
}

const app = await buildApp();
// in-process async worker (export jobs): recovers anything interrupted by the last restart, then polls
startWorker();
app.addHook("onClose", async () => stopWorker());

try {
  const addr = await app.listen({ port: config.port, host: config.host });
  console.log(`forge-server listening on ${addr}`);
} catch (err) {
  console.error(err);
  process.exit(1);
}
