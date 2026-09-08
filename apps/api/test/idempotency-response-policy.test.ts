import { describe, expect, test } from "vitest";

import type { RouteDefinition } from "@inpulse/api-contract";
import {
  assertIdempotencyResponsePolicy,
  IdempotencyResponsePolicyError,
} from "../src/idempotency/response-policy";

function route(overrides: Partial<RouteDefinition> = {}): RouteDefinition {
  return {
    method: "POST",
    path: "/projects",
    operationId: "createProject",
    summary: "测试幂等路由。",
    request: {
      path: "none",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "204": { noBody: true },
    },
    authPolicy: "session",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    idempotencyReplayPolicy: {
      version: "1.0.0",
      success: {
        "204": { noBody: true },
      },
    },
    replayAuthorizationPolicy: { version: "1.0.0", actorOnly: true },
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
    ...overrides,
  };
}

function result(
  overrides: Partial<{
    responseStatus: number;
    responseSchemaRef: string | null;
    responseHasBody: boolean;
    responseBody: unknown;
  }> = {},
): Parameters<typeof assertIdempotencyResponsePolicy>[1] {
  return {
    responseStatus: 204,
    responseSchemaRef: null,
    responseHasBody: false,
    responseBody: null,
    replayAuthContext: {},
    ...overrides,
  };
}

describe("assertIdempotencyResponsePolicy", () => {
  test("接受 Registry 声明的 noBody 204", () => {
    expect(() =>
      assertIdempotencyResponsePolicy(route(), result()),
    ).not.toThrow();
  });

  test("拒绝未登记的状态码 202", () => {
    expect(() =>
      assertIdempotencyResponsePolicy(
        route(),
        result({
          responseStatus: 202,
          responseHasBody: true,
          responseSchemaRef: "HealthResponse",
          responseBody: { status: "ok" },
        }),
      ),
    ).toThrowError(IdempotencyResponsePolicyError);
  });

  test("拒绝 noBody 白名单外携带响应体或 Schema", () => {
    expect(() =>
      assertIdempotencyResponsePolicy(
        route(),
        result({
          responseHasBody: true,
          responseSchemaRef: "HealthResponse",
          responseBody: { status: "ok" },
        }),
      ),
    ).toThrowError(IdempotencyResponsePolicyError);
  });

  test("body 白名单拒绝额外叶子字段", () => {
    const bodyRoute = route({
      responses: {
        "201": {
          body: {
            contentTypes: [
              { contentType: "application/json", schemaRef: "HealthResponse" },
            ],
          },
        },
      },
      idempotencyReplayPolicy: {
        version: "1.0.0",
        success: {
          "201": {
            body: {
              responseSchemaRef: "HealthResponse",
              safeBodyFieldPaths: ["status"],
            },
          },
        },
      },
    });

    expect(() =>
      assertIdempotencyResponsePolicy(
        bodyRoute,
        result({
          responseStatus: 201,
          responseHasBody: true,
          responseSchemaRef: "HealthResponse",
          responseBody: { status: "ok", leaked: true },
        }),
      ),
    ).toThrowError(/cannot cache body leaf "leaked"/);
  });

  test("body 白名单接受声明的叶子字段", () => {
    const bodyRoute = route({
      responses: {
        "201": {
          body: {
            contentTypes: [
              { contentType: "application/json", schemaRef: "HealthResponse" },
            ],
          },
        },
      },
      idempotencyReplayPolicy: {
        version: "1.0.0",
        success: {
          "201": {
            body: {
              responseSchemaRef: "HealthResponse",
              safeBodyFieldPaths: ["status"],
            },
          },
        },
      },
    });

    expect(() =>
      assertIdempotencyResponsePolicy(
        bodyRoute,
        result({
          responseStatus: 201,
          responseHasBody: true,
          responseSchemaRef: "HealthResponse",
          responseBody: { status: "ok" },
        }),
      ),
    ).not.toThrow();
  });

  test("body 白名单拒绝 Schema 不匹配", () => {
    const bodyRoute = route({
      responses: {
        "201": {
          body: {
            contentTypes: [
              { contentType: "application/json", schemaRef: "HealthResponse" },
            ],
          },
        },
      },
      idempotencyReplayPolicy: {
        version: "1.0.0",
        success: {
          "201": {
            body: {
              responseSchemaRef: "HealthResponse",
              safeBodyFieldPaths: ["status"],
            },
          },
        },
      },
    });

    expect(() =>
      assertIdempotencyResponsePolicy(
        bodyRoute,
        result({
          responseStatus: 201,
          responseHasBody: true,
          responseSchemaRef: "LoginResponse",
          responseBody: {
            csrfToken: "A".repeat(43),
            authState: "AUTHENTICATED",
          },
        }),
      ),
    ).toThrowError(/requires response schema HealthResponse/);
  });
});
