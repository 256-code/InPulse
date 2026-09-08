import type { AddressInfo } from "node:net";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

interface HealthResponseDto {
  readonly status: "ok";
}

interface ErrorResponseDto {
  readonly code: string;
  readonly message: string;
  readonly details: Readonly<Record<string, unknown>>;
  readonly requestId: string;
}

describe("就绪探针：数据库不可达返回 503", () => {
  let app: INestApplication;
  let baseUrl: string;
  const previousEnvironment: Record<string, string | undefined> = {};

  beforeAll(async () => {
    previousEnvironment.DATABASE_URL = process.env["DATABASE_URL"];
    previousEnvironment.NODE_ENV = process.env["NODE_ENV"];
    process.env["NODE_ENV"] = "test";
    // 指向一个必然拒绝连接的地址；就绪检查不得在启动时连接，因此应用仍可启动。
    process.env["DATABASE_URL"] = "postgresql://app_runtime@127.0.0.1:1/app";

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

  test("数据库不可达时 /health/live 仍返回 200", async () => {
    const response = await fetch(`${baseUrl}/api/v1/health/live`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as HealthResponseDto;
    expect(body).toEqual({ status: "ok" });
  });

  test("数据库不可达时 /health/ready 返回 503 且不泄露内部细节", async () => {
    const response = await fetch(`${baseUrl}/api/v1/health/ready`);
    expect(response.status).toBe(503);
    const body = (await response.json()) as ErrorResponseDto;
    expect(body.code).toBe("SERVICE_NOT_READY");
    expect(body.message).toBe("服务未就绪：数据库连接或迁移版本检查失败");
    expect(body.details).toEqual({});
    expect(body.requestId).toEqual(expect.any(String) as string);
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|stack|Database|pg/i);
  });
});
