import type { AddressInfo } from "node:net";

import "reflect-metadata";

import { type INestApplication } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants.js";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, test } from "vitest";

import { LoginController } from "../src/auth/login.controller.js";
import type { LoginResult } from "../src/auth/login.service.js";
import { LoginService } from "../src/auth/login.service.js";

class FakeLoginService {
  async login(): Promise<LoginResult> {
    return {
      csrfToken: "A".repeat(43),
      authState: "AUTHENTICATED",
      cookies: [
        { name: "__Host-preauth", value: null, maxAgeSeconds: 0 },
        {
          name: "__Host-session",
          value: "B".repeat(43),
          maxAgeSeconds: 7 * 24 * 60 * 60,
        },
      ],
    };
  }
}

class LoginHttpTestModule {}

Reflect.defineMetadata(
  MODULE_METADATA.CONTROLLERS,
  [LoginController],
  LoginHttpTestModule,
);
Reflect.defineMetadata(
  MODULE_METADATA.PROVIDERS,
  [{ provide: LoginService, useValue: new FakeLoginService() }],
  LoginHttpTestModule,
);

describe("LoginController HTTP status", () => {
  let app: INestApplication | undefined;

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
      app = undefined;
    }
  });

  test("POST /api/v1/auth/login 成功响应固定为 200", async () => {
    app = await NestFactory.create(LoginHttpTestModule, { logger: false });
    app.setGlobalPrefix("api/v1");
    await app.listen(0, "127.0.0.1");
    const server = app.getHttpServer();
    const address = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/auth/login`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: `http://127.0.0.1:${address.port}`,
          cookie: "__Host-preauth=token",
          "x-csrf-token": "A".repeat(43),
        },
        body: JSON.stringify({ loginName: "alice", password: "secret" }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      csrfToken: "A".repeat(43),
      authState: "AUTHENTICATED",
    });
  });
});
