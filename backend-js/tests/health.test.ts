import { describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import type { Environment } from "../src/config/env.js";
import type { Database } from "../src/db/client.js";

const testEnvironment: Environment = {
  NODE_ENV: "test",
  HOST: "127.0.0.1",
  PORT: 8001,
  LOG_LEVEL: "silent",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  DATABASE_CONNECTION_TIMEOUT_MS: 100,
  DATABASE_POOL_SIZE: 1,
  CORS_ALLOWED_ORIGINS: "http://localhost:3000",
};

function databaseMock(): Database {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    check: vi.fn().mockResolvedValue(undefined),
  };
}

describe("health routes", () => {
  it("preserves the existing Django health contract", async () => {
    const app = await buildApp({ environment: testEnvironment, database: databaseMock(), logger: false });

    const response = await app.inject({ method: "GET", url: "/api/health/" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("reports database readiness", async () => {
    const app = await buildApp({ environment: testEnvironment, database: databaseMock(), logger: false });

    const response = await app.inject({ method: "GET", url: "/api/ready/" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready", database: "ready" });
    await app.close();
  });

  it("returns 503 when PostgreSQL is unavailable", async () => {
    const database = databaseMock();
    database.check = () => Promise.reject(new Error("database unavailable"));
    const app = await buildApp({ environment: testEnvironment, database, logger: false });

    const response = await app.inject({ method: "GET", url: "/api/ready/" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "unavailable", database: "unavailable" });
    await app.close();
  });
});
