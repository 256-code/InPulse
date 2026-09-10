import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "vitest";

import {
  isPrivateOwnerReadableFile,
  resolveDatabaseUrl,
} from "../../src/config.js";

const managedEnvironmentKeys = [
  "NODE_ENV",
  "DATABASE_URL",
  "RUNTIME_DATABASE_URL_FILE",
  "RUNTIME_DB_PASSWORD_FILE",
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_SSLMODE",
  "MIGRATION_DB_PASSWORD_FILE",
  "MIGRATION_DATABASE_URL",
  "MIGRATION_DATABASE_URL_FILE",
  "TEST_BOOTSTRAP_DATABASE_URL",
  "TEST_BOOTSTRAP_DATABASE_URL_FILE",
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
  test("只接受属主可读且不含组/其他权限位的常规文件", () => {
    expect(isPrivateOwnerReadableFile(true, 0o600)).toBe(true);
    expect(isPrivateOwnerReadableFile(true, 0o400)).toBe(true);

    expect(isPrivateOwnerReadableFile(false, 0o600)).toBe(false);
    expect(isPrivateOwnerReadableFile(true, 0o500)).toBe(false);
    expect(isPrivateOwnerReadableFile(true, 0o000)).toBe(false);
    expect(isPrivateOwnerReadableFile(true, 0o200)).toBe(false);
    expect(isPrivateOwnerReadableFile(true, 0o640)).toBe(false);
    expect(isPrivateOwnerReadableFile(true, 0o604)).toBe(false);
    expect(isPrivateOwnerReadableFile(true, 0o606)).toBe(false);
    expect(isPrivateOwnerReadableFile(true, 0o777)).toBe(false);
    expect(isPrivateOwnerReadableFile(true, 0o700)).toBe(false);
  });

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

  test("生产模式同样拒绝直连的迁移库连接串，不因 purpose 不同放宽", async () => {
    process.env.NODE_ENV = "production";
    process.env.MIGRATION_DATABASE_URL =
      "postgresql://app_migrator@127.0.0.1:5432/app";
    process.env.MIGRATION_DB_PASSWORD_FILE =
      "/run/secrets/inpulse_missing_secret_test";

    await expect(resolveDatabaseUrl("MIGRATION")).rejects.toThrow(
      "MIGRATION_DATABASE_URL is forbidden in production",
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

  test.each([
    "run/secrets/runtime-url",
    "/run/secrets/nested/runtime-url",
    "/run/secrets",
  ])(
    "rejects a non-absolute or non-direct-child production Secret path: %s",
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

  test("生产模式缺少密码文件变量时 fail closed，不回退到环境变量", async () => {
    process.env.NODE_ENV = "production";
    process.env.DB_HOST = "db";

    await expect(resolveDatabaseUrl("RUNTIME")).rejects.toThrow(
      "Missing required environment variable: RUNTIME_DB_PASSWORD_FILE",
    );
  });

  test.each(["", "   \n\n", "\t"])(
    "空 Secret 文件按 fail closed 拒绝（内容 %j）",
    async (content) => {
      const file = await writeTempSecret(content);
      process.env.NODE_ENV = "test";
      process.env.RUNTIME_DATABASE_URL_FILE = file;

      await expect(resolveDatabaseUrl("RUNTIME")).rejects.toThrow(
        "RUNTIME_DATABASE_URL_FILE is empty",
      );
    },
  );

  test("Secret 内容读取后去除首尾空白", async () => {
    const file = await writeTempSecret(
      "  postgresql://app_runtime@db:5432/app\n",
    );
    process.env.NODE_ENV = "test";
    process.env.RUNTIME_DATABASE_URL_FILE = file;

    await expect(resolveDatabaseUrl("RUNTIME")).resolves.toBe(
      "postgresql://app_runtime@db:5432/app",
    );
  });
});

const temporaryDirectories: string[] = [];

async function writeTempSecret(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "inpulse-secret-"));
  temporaryDirectories.push(directory);
  const file = join(directory, "secret");
  await writeFile(file, content, "utf8");
  return file;
}

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});
