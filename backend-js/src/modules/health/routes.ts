import type { FastifyPluginCallback } from "fastify";

import type { Database } from "../../db/client.js";

interface HealthRoutesOptions {
  database: Database;
}

export const healthRoutes: FastifyPluginCallback<HealthRoutesOptions> = (app, options, done) => {
  app.get(
    "/api/health/",
    {
      schema: {
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["status"],
            properties: { status: { const: "ok" } },
          },
        },
      },
    },
    () => ({ status: "ok" as const }),
  );

  app.get(
    "/api/ready/",
    {
      schema: {
        response: {
          200: readinessSchema("ready"),
          503: readinessSchema("unavailable"),
        },
      },
    },
    async (_request, reply) => {
      try {
        await options.database.check();
        return { status: "ready" as const, database: "ready" as const };
      } catch {
        return reply
          .status(503)
          .send({ status: "unavailable" as const, database: "unavailable" as const });
      }
    },
  );

  done();
};

function readinessSchema(status: "ready" | "unavailable") {
  return {
    type: "object",
    additionalProperties: false,
    required: ["status", "database"],
    properties: {
      status: { const: status },
      database: { const: status },
    },
  } as const;
}
