import { describe, expect, test, vi } from "vitest";

import type { DatabaseClient } from "@inpulse/database/client";

import {
  HealthReadinessError,
  HealthService,
} from "../src/health/health.service.js";

function clientFixture({
  connectReady = true,
  migrationCount = 1,
}: {
  readonly connectReady?: boolean;
  readonly migrationCount?: number;
} = {}): {
  readonly client: DatabaseClient;
  readonly sql: ReturnType<typeof vi.fn>;
} {
  const sql = vi.fn(async (parts: TemplateStringsArray) => {
    const text = parts.join(" ");
    if (!connectReady) {
      throw new Error("database unavailable");
    }
    if (text.includes("schema_migrations")) {
      return [{ count: migrationCount }];
    }
    return [];
  });
  const client = {
    db: {},
    sql,
    close: async () => undefined,
  } as unknown as DatabaseClient;
  return { client, sql };
}

describe("HealthService", () => {
  test("数据库可连接且迁移存在时通过", async () => {
    const { client } = clientFixture({ connectReady: true, migrationCount: 1 });
    const service = new HealthService(client);
    await expect(service.checkReadiness()).resolves.toBeUndefined();
  });

  test("数据库不可连接时抛错", async () => {
    const { client } = clientFixture({
      connectReady: false,
      migrationCount: 1,
    });
    const service = new HealthService(client);
    await expect(service.checkReadiness()).rejects.toThrow(
      "database unavailable",
    );
  });

  test("迁移版本缺失时抛出 HealthReadinessError", async () => {
    const { client } = clientFixture({
      connectReady: true,
      migrationCount: 0,
    });
    const service = new HealthService(client);
    await expect(service.checkReadiness()).rejects.toBeInstanceOf(
      HealthReadinessError,
    );
  });
});
