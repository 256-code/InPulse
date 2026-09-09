import { describe, expect, test, vi } from "vitest";

import type { AuthenticatedSessionActor } from "../src/auth/session-auth.service.js";
import type { TransactionContext } from "../src/database/transaction-context.js";
import type {
  IdempotencyHttpCommand,
  IdempotencyHttpResult,
} from "../src/idempotency/http-service.js";
import { ProjectBootstrapController } from "../src/modules/projects/project-bootstrap.controller.js";

const actor: AuthenticatedSessionActor = {
  sessionId: 1,
  userId: 7,
  authState: "AUTHENTICATED",
  authVersionAtIssue: 1,
};

class FakeMutationAuth {
  async verify(
    _tx: TransactionContext,
  ): Promise<AuthenticatedSessionActor | undefined> {
    return actor;
  }
}

class FakeIdempotency {
  readonly calls: IdempotencyHttpCommand[] = [];

  async run(input: IdempotencyHttpCommand): Promise<IdempotencyHttpResult> {
    this.calls.push(input);
    const tx = {} as TransactionContext;
    if (typeof input.actorId === "function") {
      await input.actorId(tx);
    }
    await input.execute?.(tx, actor.userId);
    return {
      responseStatus: 200,
      responseSchemaRef: "CreateProjectResponse",
      responseHasBody: true,
      responseBody: {
        project: {
          id: 42,
          code: "SHOP",
          name: "商城系统",
          description: "",
          status: "ACTIVE",
          rowVersion: 1,
          createdBy: actor.userId,
          createdAt: "2026-09-09T00:00:00.000Z",
          updatedAt: "2026-09-09T00:00:00.000Z",
        },
        members: [
          {
            userId: actor.userId,
            status: "ACTIVE",
            joinedAt: "2026-09-09T00:00:00.000Z",
          },
        ],
        unclassifiedModuleId: 1,
      },
    };
  }
}

class FakeWorkflow {
  async execute(_tx: TransactionContext, _actorId: number): Promise<unknown> {
    return {
      responseStatus: 200,
      responseSchemaRef: "CreateProjectResponse",
      responseHasBody: true,
      responseBody: null,
    };
  }
}

function responseFixture() {
  return { status: vi.fn(() => undefined) };
}

function createController(): {
  readonly controller: ProjectBootstrapController;
  readonly idempotency: FakeIdempotency;
} {
  const idempotency = new FakeIdempotency();
  return {
    controller: new ProjectBootstrapController(
      new FakeMutationAuth() as never,
      idempotency as never,
      new FakeWorkflow() as never,
    ),
    idempotency,
  };
}

describe("ProjectBootstrapController", () => {
  test("浏览器完整同源请求头通过 CSRF 校验并进入幂等事务", async () => {
    const { controller, idempotency } = createController();
    const response = responseFixture();
    const request = {
      headers: {
        accept: "*/*",
        cookie: "__Host-session=token",
        host: "127.0.0.1:4173",
        origin: "http://127.0.0.1:4173",
        referer: "http://127.0.0.1:4173/projects",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent": "Playwright",
        "x-csrf-token": "a".repeat(43),
      },
      body: {
        name: "商城系统",
        code: "SHOP",
        description: "",
        memberIds: [],
      },
    };

    const result = await controller.create(
      request as never,
      response as never,
      {
        name: request.body.name,
        code: request.body.code,
        description: request.body.description,
        memberIds: request.body.memberIds,
      },
      { "x-csrf-token": "a".repeat(43) },
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(result).toMatchObject({
      project: { code: "SHOP", name: "商城系统" },
    });
    expect(idempotency.calls).toHaveLength(1);
    expect(idempotency.calls[0]?.operationId).toBe("createProject");
    expect(idempotency.calls[0]?.request.body).toEqual(request.body);
  });
});
