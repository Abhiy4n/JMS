import "dotenv/config";

import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Runtime configuration rejects a missing DATABASE_URL. The fallback only
    // lets schema generation and static checks run without opening a connection.
    url: process.env.DATABASE_URL ?? "postgresql://localhost:5432/jms",
  },
});
