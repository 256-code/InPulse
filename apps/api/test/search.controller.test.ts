import { describe, expect, test, vi } from "vitest";

import type { AuthenticatedSessionActor } from "../src/auth/session-auth.service.js";
import {
  SearchAuthorizationError,
  SearchQueryValidationError,
  type SearchQueryCommand,
  type SearchQueryPage,
} from "../src/modules/search/search-query.service.js";
import { SearchController } from "../src/modules/search/search.controller.js";

class FakeSessionAuth {
  actor: AuthenticatedSessionActor | undefined = {
    sessionId: 1,
    userId: 7,
    authState: "AUTHENTICATED",
    authVersionAtIssue: 1,
  };
  calls = 0;

  async resolveActor(): Promise<AuthenticatedSessionActor | undefined> {
    this.calls += 1;
    return this.actor;
  }
}

class FakeSearchService {
  result: SearchQueryPage = {
    items: [
      {
        id: "projection-1",
        projectId: 1,
        entityType: "TASK",
        entityId: 2,
        title: "实现搜索契约",
        summary: "契约纵切片",
      },
    ],
    nextCursor: "2",
  };
  error: unknown;
  commands: SearchQueryCommand[] = [];

  async search(command: SearchQueryCommand): Promise<SearchQueryPage> {
    this.commands.push(command);
    if (this.error !== undefined) {
      throw this.error;
    }
    return this.result;
  }
}

function responseFixture() {
  return {
    status: vi.fn(() => undefined),
  };
}

function requestFixture(
  headers: Readonly<Record<string, string>> = {
    cookie: "__Host-session=token",
  },
) {
  return { headers };
}

describe("SearchController", () => {
  test("匿名请求返回 401 且不调用搜索服务", async () => {
    const session = new FakeSessionAuth();
    session.actor = undefined;
    const service = new FakeSearchService();
    const controller = new SearchController(session as never, service as never);
    const response = responseFixture();

    const result = await controller.search(
      requestFixture({}),
      response as never,
      { q: "ai" },
    );

    expect(session.calls).toBe(1);
    expect(service.commands).toEqual([]);
    expect(response.status).toHaveBeenCalledWith(401);
    expect(result).toMatchObject({ code: "SEARCH_UNAUTHENTICATED" });
  });

  test("查询参数无效返回 400 且不调用搜索服务", async () => {
    const session = new FakeSessionAuth();
    const service = new FakeSearchService();
    const controller = new SearchController(session as never, service as never);
    const response = responseFixture();

    const result = await controller.search(
      requestFixture(),
      response as never,
      { q: "a" },
    );

    expect(service.commands).toEqual([]);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(result).toMatchObject({ code: "SEARCH_VALIDATION_FAILED" });
  });

  test("成功返回统一 SearchPage 形状，不暴露内部 id", async () => {
    const session = new FakeSessionAuth();
    const service = new FakeSearchService();
    const controller = new SearchController(session as never, service as never);
    const response = responseFixture();

    const result = await controller.search(
      requestFixture(),
      response as never,
      { q: "ai", cursor: "1", limit: "10" },
    );

    expect(service.commands).toEqual([
      {
        actorUserId: 7,
        query: "ai",
        after: "1",
        limit: 10,
      },
    ]);
    expect(result).toEqual({
      items: [
        {
          projectId: 1,
          entityType: "TASK",
          entityId: 2,
          title: "实现搜索契约",
          summary: "契约纵切片",
        },
      ],
      nextCursor: "2",
      hasMore: true,
    });
  });

  test("includeVoid 字符串参数透传为布尔值", async () => {
    const session = new FakeSessionAuth();
    const service = new FakeSearchService();
    const controller = new SearchController(session as never, service as never);
    const response = responseFixture();

    await controller.search(requestFixture(), response as never, {
      q: "ai",
      includeVoid: "true",
    });

    expect(service.commands[0]?.includeVoid).toBe(true);
  });

  test("服务校验错误映射为 400", async () => {
    const session = new FakeSessionAuth();
    const service = new FakeSearchService();
    service.error = new SearchQueryValidationError(
      "too-short",
      "query too short",
    );
    const controller = new SearchController(session as never, service as never);
    const response = responseFixture();

    const result = await controller.search(
      requestFixture(),
      response as never,
      { q: "ai" },
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(result).toMatchObject({ code: "SEARCH_VALIDATION_FAILED" });
  });

  test("授权范围错误映射为 401", async () => {
    const session = new FakeSessionAuth();
    const service = new FakeSearchService();
    service.error = new SearchAuthorizationError("scope mismatch");
    const controller = new SearchController(session as never, service as never);
    const response = responseFixture();

    const result = await controller.search(
      requestFixture(),
      response as never,
      { q: "ai" },
    );

    expect(response.status).toHaveBeenCalledWith(401);
    expect(result).toMatchObject({ code: "SEARCH_AUTHORIZATION_FAILED" });
  });

  test("未知服务错误映射为统一 500 信封", async () => {
    const session = new FakeSessionAuth();
    const service = new FakeSearchService();
    service.error = new Error("database failure");
    const controller = new SearchController(session as never, service as never);
    const response = responseFixture();

    const result = await controller.search(
      requestFixture(),
      response as never,
      { q: "ai" },
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(result).toMatchObject({
      code: "INTERNAL_ERROR",
      message: "服务器无法完成全局搜索",
    });
  });
});
