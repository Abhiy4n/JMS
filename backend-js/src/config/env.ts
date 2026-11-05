import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";
import { z } from "zod";

const projectRoot = resolve(process.cwd(), "..");
loadDotenv({ path: resolve(projectRoot, ".env"), quiet: true });
loadDotenv({ path: resolve(process.cwd(), ".env"), override: true, quiet: true });

const postgresUrl = z
  .string()
  .url()
  .refine(
    (value) => value.startsWith("postgresql://") || value.startsWith("postgres://"),
    "DATABASE_URL must use the postgresql:// or postgres:// protocol",
  );

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: postgresUrl,
  DATABASE_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
  DATABASE_POOL_SIZE: z.coerce.number().int().positive().max(50).default(5),
  CORS_ALLOWED_ORIGINS: z.string().default("http://localhost:3000,http://127.0.0.1:3000"),
});

export type Environment = z.infer<typeof environmentSchema>;

export function parseEnvironment(values: NodeJS.ProcessEnv = process.env): Environment {
  const result = environmentSchema.safeParse(values);

  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid backend-js environment: ${details}`);
  }

  return result.data;
}

export function allowedOrigins(environment: Environment): string[] {
  return environment.CORS_ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
