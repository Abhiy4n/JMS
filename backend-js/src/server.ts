import { buildApp } from "./app.js";
import { parseEnvironment } from "./config/env.js";
import { createDatabase } from "./db/client.js";

const environment = parseEnvironment();
const database = createDatabase(environment);
const app = await buildApp({ environment, database });

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close();
  process.exitCode = 0;
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void shutdown(signal);
  });
}

try {
  await app.listen({ host: environment.HOST, port: environment.PORT });
} catch (error) {
  app.log.fatal({ err: error }, "backend-js failed to start");
  await app.close();
  process.exitCode = 1;
}
