import { describe, expect, it } from "vitest";

import { parseEnvironment } from "../src/config/env.js";

describe("environment configuration", () => {
  it("applies safe service defaults", () => {
    const environment = parseEnvironment({
      DATABASE_URL: "postgresql://test:test@localhost:5432/jms",
    });

    expect(environment.PORT).toBe(8001);
    expect(environment.DATABASE_POOL_SIZE).toBe(5);
  });

  it("rejects non-PostgreSQL databases", () => {
    expect(() => parseEnvironment({ DATABASE_URL: "file:../backend/db.sqlite3" })).toThrow(
      "DATABASE_URL",
    );
  });
});
