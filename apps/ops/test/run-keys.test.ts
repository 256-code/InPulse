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

import { resolveArchiveDatabaseUrl } from "../src/config.js";
import {
  checkpointObjectKey,
  exportObjectKey,
  previousUtcDay,
} from "../src/run.js";

const managedEnvironmentKeys = [
  "NODE_ENV",
  "ARCHIVE_DATABASE_URL",
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_SSLMODE",
  "DB_PASSWORD_FILE",
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

describe("归档对象键", () => {
  test("检查点键包含链 slug、紧凑时间戳与序号", () => {
    expect(
      checkpointObjectKey(
        "inpulse/audit",
        "PROJECT:42",
        new Date("2026-09-11T12:34:56.789Z"),
        1234,
      ),
    ).toBe(
      "inpulse/audit/checkpoints/chain=PROJECT-42/20260911T123456Z-seq1234.json",
    );
  });

  test("链 ID 的非法字符折叠为连字符", () => {
    expect(
      checkpointObjectKey("p", "a/b c", new Date("2026-01-01T00:00:00Z"), 7),
    ).toBe("p/checkpoints/chain=a-b-c/20260101T000000Z-seq7.json");
  });

  test("导出键按窗口起始 UTC 日期归档", () => {
    expect(
      exportObjectKey("inpulse/audit", {
        from: new Date("2026-09-10T00:00:00.000Z"),
        to: new Date("2026-09-11T00:00:00.000Z"),
      }),
    ).toBe(
      "inpulse/audit/exports/date=2026-09-10/audit-export-20260910T000000Z-20260911T000000Z.jsonl.enc",
    );
  });
});

describe("默认导出窗口", () => {
  test("默认窗口是前一个 UTC 自然日 [00:00, 24:00)", () => {
    const window = previousUtcDay(new Date("2026-09-11T05:30:00Z"));
    expect(window.from.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(window.to.toISOString()).toBe("2026-09-11T00:00:00.000Z");
  });

  test("跨月与闰年边界正确回退", () => {
    const month = previousUtcDay(new Date("2026-09-01T03:00:00Z"));
    expect(month.from.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(month.to.toISOString()).toBe("2026-09-01T00:00:00.000Z");

    const leap = previousUtcDay(new Date("2028-03-01T12:00:00Z"));
    expect(leap.from.toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(leap.to.toISOString()).toBe("2028-03-01T00:00:00.000Z");
  });
});

describe("归档数据库连接解析", () => {
  test("非生产环境允许 ARCHIVE_DATABASE_URL 直连", async () => {
    process.env.NODE_ENV = "test";
    process.env.ARCHIVE_DATABASE_URL =
      "postgresql://audit_archive_writer@127.0.0.1:55436/app";
    await expect(resolveArchiveDatabaseUrl()).resolves.toBe(
      "postgresql://audit_archive_writer@127.0.0.1:55436/app",
    );
  });

  test("生产环境拒绝 ARCHIVE_DATABASE_URL 直连", async () => {
    process.env.NODE_ENV = "production";
    process.env.ARCHIVE_DATABASE_URL =
      "postgresql://audit_archive_writer@db:5432/app";
    await expect(resolveArchiveDatabaseUrl()).rejects.toThrow(
      "ARCHIVE_DATABASE_URL is forbidden in production",
    );
  });

  test("缺少直连与密码文件时 fail closed", async () => {
    process.env.NODE_ENV = "test";
    process.env.DB_HOST = "db";
    await expect(resolveArchiveDatabaseUrl()).rejects.toThrow(
      "Missing required environment variable: DB_PASSWORD_FILE",
    );
  });

  test("从 DB_PASSWORD_FILE 组装默认 audit_archive_writer 连接", async () => {
    const passwordFile = await writeTempSecret("  archive-secret\n");
    process.env.NODE_ENV = "test";
    process.env.DB_PASSWORD_FILE = passwordFile;
    process.env.DB_HOST = "db.internal";

    const url = new URL(await resolveArchiveDatabaseUrl());
    expect(url.username).toBe("audit_archive_writer");
    expect(url.password).toBe("archive-secret");
    expect(url.hostname).toBe("db.internal");
    expect(url.port).toBe("5432");
    expect(url.pathname).toBe("/app");
    expect(url.searchParams.get("sslmode")).toBe("require");
  });

  test("DB_USER / DB_PORT / DB_NAME / DB_SSLMODE 覆盖默认值", async () => {
    const passwordFile = await writeTempSecret("secret");
    process.env.NODE_ENV = "test";
    process.env.DB_PASSWORD_FILE = passwordFile;
    process.env.DB_HOST = "db.internal";
    process.env.DB_PORT = "6432";
    process.env.DB_NAME = "audit";
    process.env.DB_USER = "custom_archive";
    process.env.DB_SSLMODE = "verify-full";

    const url = new URL(await resolveArchiveDatabaseUrl());
    expect(url.username).toBe("custom_archive");
    expect(url.password).toBe("secret");
    expect(url.port).toBe("6432");
    expect(url.pathname).toBe("/audit");
    expect(url.searchParams.get("sslmode")).toBe("verify-full");
  });
});

const temporaryDirectories: string[] = [];

async function writeTempSecret(content: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "inpulse-archive-secret-"));
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
