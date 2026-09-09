import { describe, expect, test, vi } from "vitest";

import { reauthExpired } from "../src/auth/admin-high-risk.error.js";
import { selfReset } from "../src/auth/admin-mfa-reset.error.js";
import { AdminMfaResetController } from "../src/auth/admin-mfa-reset.controller.js";
import { IdempotencyHttpError } from "../src/idempotency/http-service.js";

class FakeMutationAuth {
  verifyCalls = 0;
  actor: { readonly userId: number } | undefined = { userId: 11 };

  async verify(): Promise<{ readonly userId: number } | undefined> {
    this.verifyCalls += 1;
    return this.actor;
  }
}

class FakeHighRiskAuth {
  verifyCalls = 0;

  async verify(): Promise<{ readonly userId: number }> {
    this.verifyCalls += 1;
    return { userId: 11 };
  }
}

interface IdempotencyCommandShape {
  readonly operationId: string;
  readonly actorId: (tx: never) => Promise<number>;
  readonly execute: (tx: never, actorId: number) => Promise<unknown>;
  readonly replayAuthorizer?: (record: unknown, tx: never) => Promise<void>;
  readonly request: {
    readonly method: string;
    readonly path: string;
    readonly pathParams: Readonly<Record<string, unknown>>;
    readonly query: Readonly<Record<string, unknown>>;
    readonly headers: Readonly<Record<string, string>>;
    readonly body: unknown;
  };
}

class FakeIdempotency {
  runCalls = 0;
  lastInput: IdempotencyCommandShape | undefined;
  runError: unknown;

  async run(input: IdempotencyCommandShape) {
    this.runCalls += 1;
    this.lastInput = input;
    await input.actorId({} as never);
    if (this.runError !== undefined) {
      throw this.runError;
    }
    return {
      responseStatus: 204,
      responseSchemaRef: null,
      responseHasBody: false,
      responseBody: null,
    };
  }
}

class FakeResetService {
  executeCalls = 0;
  lastInput: unknown;

  async execute(_tx: never, _actorId: number, input: unknown): Promise<void> {
    this.executeCalls += 1;
    this.lastInput = input;
  }
}

function responseFixture() {
  return {
    status: vi.fn(() => undefined),
  };
}

function validHeaders(): Readonly<Record<string, string>> {
  return {
    host: "127.0.0.1",
    origin: "http://127.0.0.1",
    cookie: "__Host-session=A".repeat(43),
    "x-csrf-token": "B".repeat(43),
    "idempotency-key": "C".repeat(24),
  };
}

function validBody(): Readonly<Record<string, unknown>> {
  return {
    userId: 2,
    reason: "疑似凭据泄露，执行管理员离线接管",
  };
}

function requestFixture(
  headers: Readonly<Record<string, string>> = validHeaders(),
  body: unknown = validBody(),
) {
  return { headers, body };
}

function createController() {
  const mutationAuth = new FakeMutationAuth();
  const highRisk = new FakeHighRiskAuth();
  const idempotency = new FakeIdempotency();
  const resetService = new FakeResetService();
  const controller = new AdminMfaResetController(
    mutationAuth as never,
    highRisk as never,
    idempotency as never,
    resetService as never,
  );
  return {
    controller,
    mutationAuth,
    highRisk,
    idempotency,
    resetService,
  };
}

describe("AdminMfaResetController", () => {
  test("缺少同源来源时返回 403 且不进入幂等", async () => {
    const { controller, idempotency } = createController();
    const response = responseFixture();

    const result = await controller.reset(
      requestFixture({ host: "127.0.0.1" }, validBody()) as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(result).toMatchObject({ code: "CSRF_ORIGIN_REJECTED" });
    expect(idempotency.runCalls).toBe(0);
  });

  test("缺少 CSRF 请求头时返回 422", async () => {
    const { controller, idempotency } = createController();
    const response = responseFixture();
    const headers = validHeaders();
    const { "x-csrf-token": _csrf, ...withoutCsrf } = headers;

    const result = await controller.reset(
      requestFixture(withoutCsrf, validBody()) as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(422);
    expect(result).toMatchObject({ code: "ADMIN_MFA_RESET_HEADERS_INVALID" });
    expect(idempotency.runCalls).toBe(0);
  });

  test("请求体字段无效时返回 422", async () => {
    const { controller, idempotency } = createController();
    const response = responseFixture();

    const result = await controller.reset(
      requestFixture(validHeaders(), {
        userId: 0,
        reason: "",
      }) as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(422);
    expect(result).toMatchObject({ code: "ADMIN_MFA_RESET_VALIDATION_FAILED" });
    expect(idempotency.runCalls).toBe(0);
  });

  test("成功时进入幂等命令并执行重置，返回 204", async () => {
    const { controller, mutationAuth, idempotency, resetService } =
      createController();
    const response = responseFixture();
    const request = requestFixture();

    const result = await controller.reset(request as never, response as never);
    const command = idempotency.lastInput;
    expect(command).toBeDefined();
    await command!.execute({} as never, 11);

    expect(result).toBeUndefined();
    expect(response.status).toHaveBeenCalledWith(204);
    expect(mutationAuth.verifyCalls).toBe(1);
    expect(command!.operationId).toBe("resetAdminMfa");
    expect(command!.request).toMatchObject({
      method: "POST",
      path: "/auth/admin/mfa-reset",
      pathParams: {},
      query: {},
      body: validBody(),
    });
    expect(resetService.executeCalls).toBe(1);
    expect(resetService.lastInput).toMatchObject({
      userId: 2,
      reason: validBody().reason,
    });
  });

  test("未认证 actor 映射为 401", async () => {
    const { controller, mutationAuth } = createController();
    mutationAuth.actor = undefined;
    const response = responseFixture();

    const result = await controller.reset(
      requestFixture() as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(401);
    expect(result).toMatchObject({
      code: "ADMIN_MFA_RESET_UNAUTHENTICATED",
    });
  });

  test("业务错误 409 映射为统一错误信封", async () => {
    const { controller, idempotency } = createController();
    idempotency.runError = selfReset();
    const response = responseFixture();

    const result = await controller.reset(
      requestFixture() as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(result).toMatchObject({
      code: "ADMIN_MFA_SELF_RESET_REJECTED",
      details: { reason: "self-reset" },
    });
  });

  test("管理员高风险校验错误 403 映射为统一错误信封", async () => {
    const { controller, idempotency } = createController();
    idempotency.runError = reauthExpired();
    const response = responseFixture();

    const result = await controller.reset(
      requestFixture() as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(403);
    expect(result).toMatchObject({
      code: "ADMIN_REAUTH_REQUIRED",
      details: { reason: "reauth-expired" },
    });
  });

  test("幂等协议错误 400 映射为统一错误信封", async () => {
    const { controller, idempotency } = createController();
    idempotency.runError = new IdempotencyHttpError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "请求必须携带 Idempotency-Key",
    );
    const response = responseFixture();

    const result = await controller.reset(
      requestFixture() as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(result).toMatchObject({
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
  });

  test("未知错误映射为 500 且不泄露内部信息", async () => {
    const { controller, idempotency } = createController();
    idempotency.runError = new Error("secret database detail");
    const response = responseFixture();

    const result = await controller.reset(
      requestFixture() as never,
      response as never,
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(result).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "服务器无法完成管理员 MFA 重置",
    });
    expect(JSON.stringify(result)).not.toContain("secret database detail");
  });
});
