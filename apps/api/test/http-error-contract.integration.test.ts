import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { apiBasePath } from "@inpulse/api-contract";
import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { testUrls } from "./database.helpers";

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly requestId: string;
}

/**
 * SEC-006：Nest 11.2.3 的未匹配路由会抛出 `Cannot {method} {url}`，由全局
 * `ApiExceptionFilter` 统一转换为固定文案的 404；本用例锁定该契约，防止
 * 框架默认文案、请求行或 Express 默认 HTML 回流。装配方式与 `main.ts` 一致
 * （同一份 `AppModule` + 同一全局前缀），全局前缀取自契约，与 `main.ts`
 * 的字面量由 `contract:validate` 的 Controller 绑定扫描保证一致。
 */
describe("未匹配路由的错误契约净化（SEC-006）", () => {
  let app: INestApplication;
  let baseUrl: string;
  let keyringDirectory: string | undefined;
  const previousEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    const { runtime } = testUrls();
    keyringDirectory = await mkdtemp(join(tmpdir(), "inpulse-http-404-"));
    const sessionKeyringFile = join(keyringDirectory, "session.keyring");
    await writeFile(
      sessionKeyringFile,
      `1:${randomBytes(32).toString("hex")}\n`,
      "utf8",
    );
    const totpKekFile = join(keyringDirectory, "totp.kek.keyring");
    await writeFile(
      totpKekFile,
      `1:${randomBytes(32).toString("hex")}\n`,
      "utf8",
    );

    previousEnvironment.NODE_ENV = process.env["NODE_ENV"];
    previousEnvironment.DATABASE_URL = process.env["DATABASE_URL"];
    previousEnvironment.SESSION_HASH_KEYRING_FILE =
      process.env["SESSION_HASH_KEYRING_FILE"];
    previousEnvironment.SESSION_HASH_KEYRING_TEST_PATH =
      process.env["SESSION_HASH_KEYRING_TEST_PATH"];
    previousEnvironment.SESSION_HASH_KEY_VERSION =
      process.env["SESSION_HASH_KEY_VERSION"];
    previousEnvironment.TOTP_KEK_KEYRING_FILE =
      process.env["TOTP_KEK_KEYRING_FILE"];
    previousEnvironment.TOTP_KEK_KEYRING_TEST_PATH =
      process.env["TOTP_KEK_KEYRING_TEST_PATH"];
    previousEnvironment.TOTP_KEK_VERSION = process.env["TOTP_KEK_VERSION"];
    process.env["NODE_ENV"] = "test";
    process.env["DATABASE_URL"] = runtime;
    process.env["SESSION_HASH_KEYRING_FILE"] = sessionKeyringFile;
    process.env["SESSION_HASH_KEYRING_TEST_PATH"] = "1";
    process.env["SESSION_HASH_KEY_VERSION"] = "1";
    process.env["TOTP_KEK_KEYRING_FILE"] = totpKekFile;
    process.env["TOTP_KEK_KEYRING_TEST_PATH"] = "1";
    process.env["TOTP_KEK_VERSION"] = "1";

    const { AppModule } = await import("../src/app.module.js");
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix(apiBasePath.replace(/^\//, ""));
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
    for (const [name, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
    if (keyringDirectory !== undefined) {
      await rm(keyringDirectory, { recursive: true, force: true });
    }
  });

  test("未知 API 路径返回统一 JSON 404，且不泄露 method 与 path", async () => {
    const response = await fetch(
      `${baseUrl}${apiBasePath}/definitely-not-a-route/SECRET-MARKER`,
      { method: "DELETE" },
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    const raw = await response.text();
    expect(raw).not.toContain("<html");
    expect(raw).not.toContain("SECRET-MARKER");
    expect(raw).not.toContain("DELETE");
    expect(raw).not.toContain("Cannot ");
    const body = JSON.parse(raw) as ErrorResponseDto;
    expect(body.code).toBe("NOT_FOUND");
    expect(body.message).toBe("请求的资源不存在");
    expect(body.details).toEqual({});
    expect(typeof body.requestId).toBe("string");
    expect(body.requestId.length).toBeGreaterThan(0);
    expect(response.headers.get("x-request-id")).toBe(body.requestId);
  });

  test("前缀之外与根路径同样返回统一 JSON 404", async () => {
    for (const path of ["/", "/api/v2/unknown", apiBasePath]) {
      const response = await fetch(`${baseUrl}${path}`);
      expect(response.status, path).toBe(404);
      expect(response.headers.get("content-type"), path).toContain(
        "application/json",
      );
      const body = (await response.json()) as ErrorResponseDto;
      expect(body.code, path).toBe("NOT_FOUND");
      expect(body.message, path).toBe("请求的资源不存在");
      expect(body.details, path).toEqual({});
    }
  });

  test("已匹配路由不受影响", async () => {
    const live = await fetch(`${baseUrl}${apiBasePath}/health/live`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual({ status: "ok" });

    const anon = await fetch(`${baseUrl}${apiBasePath}/me`);
    expect(anon.status).toBe(401);
    const body = (await anon.json()) as ErrorResponseDto;
    expect(body.code).not.toBe("NOT_FOUND");
    expect(body.message).not.toContain("/me");
  });
});
