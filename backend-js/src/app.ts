import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyInstance } from "fastify";

import { allowedOrigins, type Environment } from "./config/env.js";
import type { Database } from "./db/client.js";
import { healthRoutes } from "./modules/health/routes.js";
import { registerErrorHandler } from "./shared/errors.js";

interface BuildAppOptions {
  environment: Environment;
  database: Database;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger === false ? false : { level: options.environment.LOG_LEVEL },
    requestIdHeader: "x-request-id",
    trustProxy: false,
    bodyLimit: 1_048_576,
  });

  await app.register(helmet);
  await app.register(cors, {
    origin: allowedOrigins(options.environment),
    credentials: false,
  });

  registerErrorHandler(app);
  await app.register(healthRoutes, { database: options.database });

  app.addHook("onClose", async () => {
    await options.database.disconnect();
  });

  return app;
}
