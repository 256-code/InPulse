import type { AddressInfo } from "node:net";

import "reflect-metadata";

import { type INestApplication } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants.js";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { SsoController } from "../src/auth/sso/sso.controller.js";
import {
  SsoGateway,
  type SsoCompleteInput,
  type SsoCompleteResult,
  type SsoStartResult,
} from "../src/auth/sso/sso-gateway.js";
import { ApiExceptionFilter } from "../src/http/api-exception.filter.js";

const ISSUER = "https://authtest.libiaorobot.com";

class RecordingGateway extends SsoGateway {
  readonly enabled = true;
  lastComplete: SsoCompleteInput | undefined;

  start(): Promise<SsoStartResult> {
    return Promise.resolve({ location: "/", cookies: [] });
  }

  complete(input: SsoCompleteInput): Promise<SsoCompleteResult> {
    this.lastComplete = input;
    return Promise.resolve({ location: "/records", cookies: [] });
  }
}
const gateway = new RecordingGateway();

/** 直接读字段会被上一句赋 undefined 的控制流收窄成 never，用函数绕开收窄。 */
function lastComplete(): SsoCompleteInput | undefined {
  return gateway.lastComplete;
}

class SsoRuntimeModule {}

Reflect.defineMetadata(
  MODULE_METADATA.CONTROLLERS,
  [SsoController],
  SsoRuntimeModule,
);
Reflect.defineMetadata(
  MODULE_METADATA.PROVIDERS,
  [
    { provide: SsoGateway, useValue: gateway },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
  SsoRuntimeModule,
);

describe("SSO 回调查询契约（HTTP 边界）", () => {
  let app: INestApplication;
  let baseUrl: string;

  beforeAll(async () => {
    app = await NestFactory.create(SsoRuntimeModule, { logger: false });
    app.setGlobalPrefix("api/v1");
    await app.listen(0, "127.0.0.1");
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app?.close();
  });
  test("Casdoor 按 RFC 9207 回传的 iss 不再被 422 拒绝", async () => {
    gateway.lastComplete = undefined;
    const response = await fetch(
      `${baseUrl}/api/v1/auth/sso/callback?code=code-1&state=state-1&iss=${encodeURIComponent(ISSUER)}`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/records");
    expect(lastComplete()?.iss).toBe(ISSUER);
  });

  test("未知查询参数仍被严格契约拒绝", async () => {
    const response = await fetch(
      `${baseUrl}/api/v1/auth/sso/callback?code=code-1&state=state-1&bogus=1`,
      { redirect: "manual" },
    );

    expect(response.status).toBe(422);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
