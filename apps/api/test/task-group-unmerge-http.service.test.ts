import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedMutationService } from "../src/auth/authenticated-mutation.service.js";
import type { TransactionContext } from "../src/database/transaction-context.js";
import {
  IdempotencyHttpError,
  IdempotencyHttpService,
} from "../src/idempotency/http-service.js";
import type {
  IdempotencyRunner,
  RunIdempotencyCommand,
} from "../src/idempotency/runner.js";
import { resolveRegisteredRoute } from "../src/idempotency/route.js";
import { TaskGroupUnmergeHttpService } from "../src/modules/task-groups/task-group-unmerge-http.service.js";
import {
  TaskGroupCommandError,
  TaskGroupsService,
} from "../src/modules/task-groups/task-groups.service.js";

const tx = {} as TransactionContext;
const key = randomBytes(32);
const response = {
  group: {
    id: 5,
    projectId: 3,
    code: "PAY-TG-1",
    name: "支付重试",
    status: "ACTIVE" as const,
    createdBy: 7,
    rowVersion: 3,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:10:00.000Z",
    closedAt: null,
    mainTaskId: 42,
  },
  detachedMembers: [
    {
      id: 2,
      taskId: 43,
      role: "SOURCE" as const,
      sourceKind: "HISTORICAL" as const,
      originalWorkStatus: "DONE" as const,
      originalAssigneeId: 9,
      joinedAt: "2026-09-10T00:00:01.000Z",
      detachedAt: "2026-09-10T00:10:00.000Z",
      detachReason: "重复录入",
    },
  ],
};
const body = { sourceTaskId: 43, unmergeReason: "重复录入" };

function request(
  overrides: {
    headers?: Record<string, string>;
    query?: Record<string, unknown>;
    body?: unknown;
  } = {},
) {
  return {
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "sec-fetch-site": "same-origin",
      cookie: "__Host-session=x",
      "x-csrf-token": "c".repeat(43),
      "idempotency-key": "f24-unit-key-0001",
      "content-type": "application/json",
      ...overrides.headers,
    },
    params: {},
    query: overrides.query ?? {},
    body: overrides.body === undefined ? body : overrides.body,
  };
}

function setup(
  options: {
    actorId?: number | undefined;
    failWith?: unknown;
    item?: unknown;
  } = {},
) {
  const verify = vi
    .fn()
    .mockResolvedValue(
      options.actorId === undefined ? undefined : { userId: options.actorId },
    );
  const results: unknown[] = [];
  const unmerge = vi.fn(async (_tx: TransactionContext, _actorId: number) => {
    if (options.failWith !== undefined) throw options.failWith;
    return options.item ?? response;
  });
  const replayUnmerge = vi.fn().mockResolvedValue(undefined);
  const executed: RunIdempotencyCommand[] = [];
  const runnerRun = vi.fn(async (input: RunIdempotencyCommand) => {
    executed.push(input);
    const actorId =
      typeof input.actorId === "number"
        ? input.actorId
        : await input.actorId(tx);
    const result = await input.execute(tx, actorId);
    results.push(result);
    return {
      kind: "executed" as const,
      record: {
        responseStatus: result.responseStatus,
        responseSchemaRef: result.responseSchemaRef,
        responseHasBody: result.responseHasBody,
        responseBody: result.responseBody,
      },
    };
  });
  const service = new TaskGroupUnmergeHttpService(
    { verify } as unknown as AuthenticatedMutationService,
    new IdempotencyHttpService(
      { run: runnerRun } as unknown as IdempotencyRunner,
      { currentVersion: 1, currentKey: () => key, keyFor: () => key },
      resolveRegisteredRoute,
    ),
    { unmerge, replayUnmerge } as unknown as TaskGroupsService,
  );
  return {
    service,
    verify,
    unmerge,
    replayUnmerge,
    executed,
    results,
    runnerRun,
  };
}

describe("F-24 解除合并 HTTP 边界", () => {
  it("合法请求返回 200 并校验契约 DTO，业务命令收到认证用户", async () => {
    const { service, unmerge } = setup({ actorId: 7 });
    const result = await service.handle(request());
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      group: { id: 5, status: "ACTIVE", rowVersion: 3 },
      detachedMembers: [{ taskId: 43, role: "SOURCE" }],
    });
    expect(unmerge).toHaveBeenCalledTimes(1);
    expect(unmerge.mock.calls[0]?.[1]).toBe(7);
  });

  it("重放授权上下文登记项目、聚合组与来源/主任务", async () => {
    const { service, results } = setup({ actorId: 7 });
    await service.handle(request());
    expect(results[0]).toMatchObject({
      responseSchemaRef: "TaskGroupUnmergeResponse",
      replayAuthContext: { projectId: 3, groupId: 5, taskIds: [42, 43] },
    });
  });

  it("同源校验失败返回 403 且不进入幂等与业务层", async () => {
    const { service, runnerRun, unmerge } = setup({ actorId: 7 });
    const crossOrigin = await service.handle(
      request({ headers: { origin: "https://evil.example" } }),
    );
    expect(crossOrigin).toMatchObject({ status: 403 });
    expect(crossOrigin.body).toMatchObject({
      code: "CSRF_ORIGIN_REJECTED",
    });
    expect(runnerRun).not.toHaveBeenCalled();
    expect(unmerge).not.toHaveBeenCalled();
  });

  it("非 JSON 请求体返回 400 契约错误码", async () => {
    const { service, unmerge } = setup({ actorId: 7 });
    const result = await service.handle(
      request({ headers: { "content-type": "text/plain" } }),
    );
    expect(result).toMatchObject({ status: 400 });
    expect(result.body).toMatchObject({
      code: "TASK_UNMERGE_CONTENT_TYPE_INVALID",
    });
    expect(unmerge).not.toHaveBeenCalled();
  });

  it("请求头与请求体违反契约返回 422 与字段明细", async () => {
    const { service, unmerge } = setup({ actorId: 7 });
    const badHeader = await service.handle(
      request({ headers: { "x-csrf-token": "" } }),
    );
    expect(badHeader).toMatchObject({ status: 422 });
    expect(badHeader.body).toMatchObject({
      code: "TASK_UNMERGE_VALIDATION_FAILED",
      details: { "x-csrf-token": expect.any(String) },
    });
    const badBody = await service.handle(
      request({ body: { ...body, projectId: 3 } }),
    );
    expect(badBody).toMatchObject({ status: 422 });
    expect(badBody.body).toMatchObject({
      code: "TASK_UNMERGE_VALIDATION_FAILED",
    });
    const emptyReason = await service.handle(
      request({ body: { sourceTaskId: 43 } }),
    );
    expect(emptyReason).toMatchObject({ status: 422 });
    const withQuery = await service.handle(request({ query: { dryRun: "1" } }));
    expect(withQuery).toMatchObject({
      status: 422,
      body: { details: { query: expect.any(String) } },
    });
    expect(unmerge).not.toHaveBeenCalled();
  });

  it("幂等键缺失或过短返回 400", async () => {
    const { service } = setup({ actorId: 7 });
    const missing = await service.handle(
      request({ headers: { "idempotency-key": "" } }),
    );
    expect(missing).toMatchObject({ status: 400 });
    expect(missing.body).toMatchObject({ code: "IDEMPOTENCY_KEY_REQUIRED" });
    const short = await service.handle(
      request({ headers: { "idempotency-key": "short" } }),
    );
    expect(short).toMatchObject({ status: 400 });
    expect(short.body).toMatchObject({ code: "IDEMPOTENCY_KEY_INVALID" });
  });

  it("匿名或 CSRF 失效返回 401 且不写入业务", async () => {
    const { service, unmerge } = setup();
    const result = await service.handle(request());
    expect(result).toMatchObject({ status: 401 });
    expect(result.body).toMatchObject({
      code: "TASK_UNMERGE_SESSION_REQUIRED",
    });
    expect(unmerge).not.toHaveBeenCalled();
  });

  it("业务层显式错误按状态码直通", async () => {
    const { service } = setup({
      actorId: 7,
      failWith: new TaskGroupCommandError(
        409,
        "TASK_NOT_MERGED",
        "任务当前不是活跃来源分支，无法解除合并",
      ),
    });
    const result = await service.handle(request());
    expect(result).toMatchObject({ status: 409 });
    expect(result.body).toMatchObject({
      code: "TASK_NOT_MERGED",
      message: "任务当前不是活跃来源分支，无法解除合并",
    });
  });

  it("幂等冲突错误按 409 返回", async () => {
    const { service } = setup({
      actorId: 7,
      failWith: new IdempotencyHttpError(
        409,
        "IDEMPOTENCY_REQUEST_MISMATCH",
        "相同 Idempotency-Key 对应不同请求内容",
      ),
    });
    const result = await service.handle(request());
    expect(result).toMatchObject({ status: 409 });
    expect(result.body).toMatchObject({
      code: "IDEMPOTENCY_REQUEST_MISMATCH",
    });
  });

  it("业务结果越出可重放字段白名单时拒绝缓存", async () => {
    const { service, runnerRun } = setup({
      actorId: 7,
      item: { ...response, secretField: "leak" },
    });
    const result = await service.handle(request());
    expect(result).toMatchObject({ status: 500 });
    expect(result.body).toMatchObject({ code: "INTERNAL_ERROR" });
    expect(JSON.stringify(result.body)).not.toContain("leak");
    expect(runnerRun).toHaveBeenCalledTimes(1);
  });
});
