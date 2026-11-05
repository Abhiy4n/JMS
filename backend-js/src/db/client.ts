import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../generated/prisma/client.js";
import type { Environment } from "../config/env.js";

export interface Database {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  check(): Promise<void>;
}

export function createDatabase(environment: Environment): Database {
  const adapter = new PrismaPg({
    connectionString: environment.DATABASE_URL,
    connectionTimeoutMillis: environment.DATABASE_CONNECTION_TIMEOUT_MS,
    max: environment.DATABASE_POOL_SIZE,
  });

  const client = new PrismaClient({ adapter });

  return {
    connect: async () => client.$connect(),
    disconnect: async () => client.$disconnect(),
    check: async () => {
      await client.$queryRaw`SELECT 1`;
    },
  };
}
