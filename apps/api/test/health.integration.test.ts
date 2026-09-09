import type { AddressInfo } from "node:net";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { testUrls } from "./database.helpers";

interface HealthResponseDto {
  readonly status: "ok";
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly requestId: string;
}

describe("健康探针 HTTP 集成", () => {
  let app: INestApplication;
  let baseUrl: string;
  const previousEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    const { runtime } = testUrls();
    previousEnvironment.DATABASE_URL = process.env["DATABASE_URL"];
    previousEnvironment.NODE_ENV = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "test";
    process.env["DATABASE_URL"] = runtime;

    const { AppModule } = await import("../src/app.module.js");
    app = await NestFactory.create(AppModule, { logger: false });
    app.setGlobalPrefix("api/v1");
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
  });

  async function get(path: string): Promise<{
    readonly status: number;
    readonly body: HealthResponseDto | ErrorResponseDto;
  }> {
    const response = await fetch(`${baseUrl}${path}`);
    return {
      status: response.status,
      body: (await response.json()) as HealthResponseDto | ErrorResponseDto,
    };
  }

  test("GET /health 返回 200 ok", async () => {
    const { status, body } = await get("/api/v1/health");
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  test("GET /health/live 返回 200 ok 且不访问数据库", async () => {
    const { status, body } = await get("/api/v1/health/live");
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });

  test("GET /health/ready 数据库与迁移正常时返回 200 ok", async () => {
    const { status, body } = await get("/api/v1/health/ready");
    expect(status).toBe(200);
    expect(body).toEqual({ status: "ok" });
  });
});
