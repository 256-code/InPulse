import { describe, expect, test } from "vitest";

import type { RouteDefinition } from "@inpulse/api-contract";
import {
  buildIdempotencyRequestDigest,
  idempotencyKeyProblem,
  normalizeQuery,
  type IdempotencyHttpRequest,
} from "../src/idempotency/http";

const route: RouteDefinition = {
  method: "POST",
  path: "/projects",
  operationId: "createProject",
  summary: "测试幂等路由。",
  request: {
    path: "none",
    query: "none",
    headers: "none",
    body: {
      contentTypes: [
        { contentType: "application/json", schemaRef: "LoginRequest" },
      ],
    },
  },
  responses: {
    "201": {
      body: {
        contentTypes: [
          { contentType: "application/json", schemaRef: "LoginResponse" },
        ],
      },
    },
  },
  authPolicy: "session",
  csrfPolicy: "required",
  idempotencyPolicy: "idempotencyRequired",
  idempotencyExceptionAdr: "none",
  idempotencyContractVersion: "1.0.0",
  idempotencyFingerprintVersion: "1.0.0",
  behaviorHeaders: ["x-client-token"],
  idempotencyReplayPolicy: {
    version: "1.0.0",
    success: {
      "201": {
        body: {
          responseSchemaRef: "LoginResponse",
          safeBodyFieldPaths: ["csrfToken"],
        },
      },
    },
  },
  replayAuthorizationPolicy: { version: "1.0.0", actorOnly: true },
  securityFlowPolicy: "none",
  versionPolicy: "none",
  concurrencyPolicy: "none",
  auditAction: "none",
};

const hmacMaterial = "test-versioned-material";

function request(
  overrides: Partial<IdempotencyHttpRequest> = {},
): IdempotencyHttpRequest {
  return {
    method: "POST",
    path: "/api/v1/projects",
    pathParams: {},
    query: {},
    headers: {
      "content-type": "application/json; charset=utf-8",
      "idempotency-key": "key-1234567890abcdef",
      "x-client-token": "behavior-value",
    },
    body: { name: "demo" },
    ...overrides,
  };
}

describe("幂等 HTTP 摘要适配器", () => {
  test("构造摘要且 Idempotency-Key 不参与、行为头参与", () => {
    const base = buildIdempotencyRequestDigest(route, request(), hmacMaterial);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
    expect(
      buildIdempotencyRequestDigest(
        route,
        request({
          headers: {
            ...request().headers,
            "idempotency-key": "key-abcdefabcdefabcd",
          },
        }),
        hmacMaterial,
      ),
    ).toBe(base);
    expect(
      buildIdempotencyRequestDigest(
        route,
        request({
          headers: { ...request().headers, "x-client-token": "other" },
        }),
        hmacMaterial,
      ),
    ).not.toBe(base);
  });

  test("query 字段顺序不影响摘要，数组顺序变化会改变摘要", () => {
    const first = buildIdempotencyRequestDigest(
      route,
      request({
        query: { a: "1", tags: ["x", "y"] },
      }),
      hmacMaterial,
    );
    const same = buildIdempotencyRequestDigest(
      route,
      request({
        query: { tags: ["x", "y"], a: "1" },
      }),
      hmacMaterial,
    );
    const ordered = buildIdempotencyRequestDigest(
      route,
      request({
        query: { tags: ["y", "x"], a: "1" },
      }),
      hmacMaterial,
    );
    expect(first).toBe(same);
    expect(first).not.toBe(ordered);
  });

  test("query 只接受字符串或字符串数组，否则 fail closed", () => {
    expect(() => normalizeQuery({ nested: { value: "x" } })).toThrow();
    expect(() => normalizeQuery({ tags: [1] })).toThrow();
  });

  test("path 参数必须与 Route Registry 占位符一致", () => {
    expect(() =>
      buildIdempotencyRequestDigest(
        route,
        request({ pathParams: { projectId: "1" } }),
        hmacMaterial,
      ),
    ).toThrow();
  });

  test("Idempotency-Key 缺失或不合规返回对应问题", () => {
    expect(idempotencyKeyProblem({})).toBe("missing");
    expect(idempotencyKeyProblem({ "idempotency-key": "-short-" })).toBe(
      "invalid",
    );
    expect(
      idempotencyKeyProblem({ "idempotency-key": "key-1234567890abcdef" }),
    ).toBeUndefined();
  });
});
