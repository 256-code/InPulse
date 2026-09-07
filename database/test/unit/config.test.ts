import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { resolveDatabaseUrl } from "../../src/config.js";

const managedEnvironmentKeys = [
  "NODE_ENV",
  "DATABASE_URL",
  "RUNTIME_DATABASE_URL_FILE",
  "RUNTIME_DB_PASSWORD_FILE",
  "DB_HOST",
] as const;

const originalEnvironment = new Map(
  managedEnvironmentKeys.map((key) => [key, process.env[key]]),
);

beforeEach(() => {
  for (const key of managedEnvironmentKeys) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of managedEnvironmentKeys) {
    const value = originalEnvironment.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("database Secret configuration", () => {
  test("allows a direct database URL only outside production", async () => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = "postgresql://app_runtime@127.0.0.1:55432/app";

    await expect(resolveDatabaseUrl("RUNTIME")).resolves.toBe(
      process.env.DATABASE_URL,
    );
  });

  test("rejects a direct database URL in production", async () => {
    process.env.NODE_ENV = "production";
    process.env.DATABASE_URL = "postgresql://app_runtime@127.0.0.1:5432/app";

    await expect(resolveDatabaseUrl("RUNTIME")).rejects.toThrow(
      "DATABASE_URL is forbidden in production",
    );
  });

  test.each(["/tmp/runtime-url", "/run/secrets/../runtime-url"])(
    "rejects a production Secret path outside its fixed root: %s",
    async (path) => {
      process.env.NODE_ENV = "production";
      process.env.RUNTIME_DATABASE_URL_FILE = path;

      await expect(resolveDatabaseUrl("RUNTIME")).rejects.toThrow(
        "must name a direct child of /run/secrets",
      );
    },
  );

  test("fails closed when a production Secret file is missing", async () => {
    process.env.NODE_ENV = "production";
    process.env.RUNTIME_DB_PASSWORD_FILE =
      "/run/secrets/inpulse_missing_secret_test";
    process.env.DB_HOST = "db";

    await expect(resolveDatabaseUrl("RUNTIME")).rejects.toThrow();
  });
});
