import { describe, expect, test } from "vitest";

import type { RouteDefinition } from "@inpulse/api-contract";
import {
  IdempotencyHttpError,
  IdempotencyHttpService,
  type HmacKeyProvider,
} from "../src/idempotency/http-service";
import type {
  RunIdempotencyCommand,
  IdempotencyOutcome,
} from "../src/idempotency/runner";
import type { IdempotencyRecord } from "../src/idempotency/store";

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
  behaviorHeaders: [],
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

class FakeRunner {
  calls: RunIdempotencyCommand[] = [];
  outcome: IdempotencyOutcome = {
    kind: "executed",
    record: succeededRecord(),
  };

  async run(input: RunIdempotencyCommand): Promise<IdempotencyOutcome> {
    this.calls.push(input);
    return this.outcome;
  }
}

function succeededRecord(): IdempotencyRecord {
  return {
    id: 1,
    actorId: 7,
    operationId: "createProject",
    idempotencyKey: "key-1234567890abcdef",
    idempotencyContractVersion: "1.0.0",
    requestHash: Buffer.alloc(32, 1),
    requestHashKeyVersion: 1,
    state: "SUCCEEDED",
    responseStatus: 201,
    responseSchemaRef: "LoginResponse",
    replayPolicyVersion: "1.0.0",
    replayAuthPolicyVersion: "1.0.0",
    replayAuthContext: {},
    responseHasBody: true,
    responseBody: { csrfToken: "opaque" },
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };
}

function keyProvider(): HmacKeyProvider {
  return {
    currentVersion: 1,
    currentKey: () => Buffer.from("0123456789abcdef0123456789abcdef", "utf8"),
    keyFor: () => Buffer.from("0123456789abcdef0123456789abcdef", "utf8"),
  };
}

function setup(outcome?: IdempotencyOutcome) {
  const runner = new FakeRunner();
  if (outcome !== undefined) {
    runner.outcome = outcome;
  }
  const service = new IdempotencyHttpService(
    runner as never,
    keyProvider(),
    () => route,
  );
  return { runner, service };
}

function command() {
  return {
    operationId: "createProject",
    actorId: 7,
    request: {
      method: "POST",
      path: "/api/v1/projects",
      pathParams: {},
      query: {},
      headers: {
        "content-type": "application/json",
        "idempotency-key": "key-1234567890abcdef",
      },
      body: { name: "demo" },
    },
    execute: async () => ({
      responseStatus: 201,
      responseSchemaRef: "LoginResponse",
      responseHasBody: true,
      responseBody: { csrfToken: "opaque" },
      replayAuthContext: {},
    }),
  };
}

describe("IdempotencyHttpService", () => {
  test("把 Route Registry 策略转换成 runner 命令并返回缓存结果", async () => {
    const { runner, service } = setup();
    const result = await service.run(command());

    expect(result.responseStatus).toBe(201);
    expect(runner.calls).toHaveLength(1);
    expect(runner.calls[0]?.command.operationId).toBe("createProject");
    expect(runner.calls[0]?.command.requestHashKeyVersion).toBe(1);
    expect(runner.calls[0]?.replayAuthorizer).toBeDefined();
  });

  test("缺少 Idempotency-Key 返回稳定的 400 错误", async () => {
    const { service } = setup();
    const input = command();
    const request = {
      ...input.request,
      headers: { "content-type": "application/json" },
    };
    await expect(service.run({ ...input, request })).rejects.toMatchObject({
      status: 400,
      code: "IDEMPOTENCY_KEY_REQUIRED",
    } satisfies Partial<IdempotencyHttpError>);
  });

  test("摘要冲突映射为 409 契约/请求不变量错误", async () => {
    const { service } = setup({
      kind: "conflict",
      reason: "hash",
    });
    await expect(service.run(command())).rejects.toMatchObject({
      status: 409,
      code: "IDEMPOTENCY_REQUEST_MISMATCH",
    });
  });

  test("resources 授权策略缺少 ReplayAuthorizer 时 fail closed", async () => {
    const resourceRoute: RouteDefinition = {
      ...route,
      replayAuthorizationPolicy: {
        version: "1.0.0",
        resources: {
          contextSchemaRef: "LoginRequest",
          resultRefExtractor: "$.projectId",
          currentReadAuthorizer: "canReadProject",
        },
      },
    };
    const service = new IdempotencyHttpService(
      new FakeRunner() as never,
      keyProvider(),
      () => resourceRoute,
    );
    await expect(service.run(command())).rejects.toThrow(
      "requires a ReplayAuthorizer",
    );
  });
});
