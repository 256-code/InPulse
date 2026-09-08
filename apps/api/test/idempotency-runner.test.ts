import { describe, expect, test } from "vitest";

import type { UnitOfWork } from "../src/database/unit-of-work.js";
import type { TransactionContext } from "../src/database/transaction-context.js";
import {
  type IdempotencyExecutionResult,
  type IdempotencyCommand,
  IdempotencyRunner,
} from "../src/idempotency/runner.js";
import {
  type IdempotencyRecord,
  type IdempotencyRecordInsert,
  type IdempotencyStore,
  type IdempotencySuccess,
} from "../src/idempotency/store.js";

const now = new Date("2026-09-08T00:00:00Z");
const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
const requestHash = Buffer.from("ab".repeat(32), "hex");

let idSequence = 1;

function seedRecord(
  input: IdempotencyRecordInsert,
  overrides: Partial<IdempotencyRecord> = {},
): IdempotencyRecord {
  return {
    id: idSequence++,
    actorId: input.actorId,
    operationId: input.operationId,
    idempotencyKey: input.idempotencyKey,
    idempotencyContractVersion: input.idempotencyContractVersion,
    requestHash: Buffer.from(input.requestHash),
    requestHashKeyVersion: input.requestHashKeyVersion,
    state: "PENDING",
    responseStatus: null,
    responseSchemaRef: null,
    replayPolicyVersion: null,
    replayAuthPolicyVersion: null,
    replayAuthContext: null,
    responseHasBody: null,
    responseBody: null,
    createdAt: now,
    expiresAt: input.expiresAt,
    ...overrides,
  };
}

class FakeIdempotencyStore implements IdempotencyStore {
  records = new Map<string, IdempotencyRecord>();

  private key(actorId: number, operationId: string, idempotencyKey: string) {
    return `${actorId}:${operationId}:${idempotencyKey}`;
  }

  async insertPending(
    _tx: TransactionContext,
    insert: IdempotencyRecordInsert,
  ): Promise<IdempotencyRecord | undefined> {
    const key = this.key(
      insert.actorId,
      insert.operationId,
      insert.idempotencyKey,
    );
    if (this.records.has(key)) {
      return undefined;
    }
    const record = seedRecord(insert);
    this.records.set(key, record);
    return record;
  }

  async find(
    _tx: TransactionContext,
    actorId: number,
    operationId: string,
    idempotencyKey: string,
  ): Promise<IdempotencyRecord | undefined> {
    return this.records.get(this.key(actorId, operationId, idempotencyKey));
  }

  async markSucceeded(
    _tx: TransactionContext,
    actorId: number,
    operationId: string,
    idempotencyKey: string,
    success: IdempotencySuccess,
  ): Promise<IdempotencyRecord | undefined> {
    const key = this.key(actorId, operationId, idempotencyKey);
    const current = this.records.get(key);
    if (current === undefined || current.state !== "PENDING") {
      return undefined;
    }
    const updated: IdempotencyRecord = {
      ...current,
      state: "SUCCEEDED",
      responseStatus: success.responseStatus,
      responseSchemaRef: success.responseSchemaRef,
      replayPolicyVersion: success.replayPolicyVersion,
      replayAuthPolicyVersion: success.replayAuthPolicyVersion,
      replayAuthContext: success.replayAuthContext,
      responseHasBody: success.responseHasBody,
      responseBody: success.responseBody,
    };
    this.records.set(key, updated);
    return updated;
  }

  clone(): FakeIdempotencyStore {
    const clone = new FakeIdempotencyStore();
    for (const [key, value] of this.records) {
      clone.records.set(key, {
        ...value,
        requestHash: Buffer.from(value.requestHash),
      });
    }
    return clone;
  }
}

class FakeUnitOfWork implements UnitOfWork {
  constructor(private readonly store: FakeIdempotencyStore) {}

  async run<T>(callback: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const backup = this.store.clone();
    const tx = { db: {} as never, sql: {} as never } as TransactionContext;
    try {
      return await callback(tx);
    } catch (error) {
      this.store.records = backup.records;
      throw error;
    }
  }
}

function command(
  overrides: Partial<IdempotencyCommand> = {},
): IdempotencyCommand {
  return {
    operationId: "createProject",
    idempotencyKey: "key-1234567890abcdef",
    idempotencyContractVersion: "1",
    requestHash,
    requestHashKeyVersion: 1,
    expiresAt,
    replayPolicyVersion: "1",
    replayAuthPolicyVersion: "1",
    ...overrides,
  };
}

function result(
  overrides: Partial<IdempotencyExecutionResult> = {},
): IdempotencyExecutionResult {
  return {
    responseStatus: 201,
    responseSchemaRef: "ProjectResponse",
    responseHasBody: true,
    responseBody: { id: 1 },
    replayAuthContext: { actorId: 7 },
    ...overrides,
  };
}

function setup() {
  const store = new FakeIdempotencyStore();
  const unitOfWork = new FakeUnitOfWork(store);
  const runner = new IdempotencyRunner(unitOfWork, store);
  return { store, unitOfWork, runner };
}

describe("IdempotencyRunner", () => {
  test("新请求在同事务内执行并保存成功响应", async () => {
    const { runner, store } = setup();
    let executed = 0;
    const outcome = await runner.run({
      actorId: 7,
      command: command(),
      execute: async () => {
        executed += 1;
        return result();
      },
    });

    expect(outcome.kind).toBe("executed");
    if (outcome.kind !== "executed") {
      throw new Error("expected executed outcome");
    }
    expect(executed).toBe(1);
    expect(outcome.record.state).toBe("SUCCEEDED");
    const stored = store.records.get("7:createProject:key-1234567890abcdef");
    expect(stored?.responseStatus).toBe(201);
    expect(stored?.responseBody).toEqual({ id: 1 });
  });

  test("相同摘要与版本的重放返回缓存响应并调用授权器", async () => {
    const { runner } = setup();
    await runner.run({
      actorId: 7,
      command: command(),
      execute: async () => result(),
    });

    let authorizerCalled = 0;
    const outcome = await runner.run({
      actorId: 7,
      command: command(),
      execute: async () => {
        throw new Error("replay must not re-execute");
      },
      replayAuthorizer: async () => {
        authorizerCalled += 1;
      },
    });

    expect(outcome.kind).toBe("replayed");
    if (outcome.kind !== "replayed") {
      throw new Error("expected replayed outcome");
    }
    expect(outcome.record.responseStatus).toBe(201);
    expect(outcome.record.responseBody).toEqual({ id: 1 });
    expect(authorizerCalled).toBe(1);
  });

  test("重放授权失败时拒绝且不返回缓存响应", async () => {
    const { runner } = setup();
    await runner.run({
      actorId: 7,
      command: command(),
      execute: async () => result(),
    });

    await expect(
      runner.run({
        actorId: 7,
        command: command(),
        execute: async () => result(),
        replayAuthorizer: async () => {
          throw new Error("actor removed from project");
        },
      }),
    ).rejects.toThrow("actor removed from project");
  });

  test("同 Key 不同哈希摘要返回 409 冲突", async () => {
    const { runner } = setup();
    await runner.run({
      actorId: 7,
      command: command(),
      execute: async () => result(),
    });

    const outcome = await runner.run({
      actorId: 7,
      command: command({ requestHash: Buffer.from("cd".repeat(32), "hex") }),
      execute: async () => result(),
    });

    expect(outcome).toEqual({ kind: "conflict", reason: "hash" });
  });

  test("同 Key 不同幂等契约版本返回 409 冲突", async () => {
    const { runner } = setup();
    await runner.run({
      actorId: 7,
      command: command(),
      execute: async () => result(),
    });

    const outcome = await runner.run({
      actorId: 7,
      command: command({ idempotencyContractVersion: "2" }),
      execute: async () => result(),
    });

    expect(outcome).toEqual({ kind: "conflict", reason: "contract-version" });
  });

  test("同 Key 不同密钥版本返回 409 冲突", async () => {
    const { runner } = setup();
    await runner.run({
      actorId: 7,
      command: command(),
      execute: async () => result(),
    });

    const outcome = await runner.run({
      actorId: 7,
      command: command({ requestHashKeyVersion: 2 }),
      execute: async () => result(),
    });

    expect(outcome).toEqual({ kind: "conflict", reason: "key-version" });
  });

  test("旧记录可通过记录中的密钥版本重算摘要并重放", async () => {
    const { runner } = setup();
    await runner.run({
      actorId: 7,
      command: command(),
      execute: async () => result(),
    });

    const oldHash = Buffer.from("ab".repeat(32), "hex");
    const outcome = await runner.run({
      actorId: 7,
      command: command({
        requestHash: Buffer.from("cd".repeat(32), "hex"),
        requestHashKeyVersion: 2,
        resolveRequestHash: (version) =>
          version === 1 ? oldHash : Buffer.from("ef".repeat(32), "hex"),
      }),
      execute: async () => {
        throw new Error("replay must not re-execute");
      },
    });

    expect(outcome.kind).toBe("replayed");
  });

  test("业务命令抛错时整个事务回滚且不留下成功响应", async () => {
    const { runner, store } = setup();

    await expect(
      runner.run({
        actorId: 7,
        command: command(),
        execute: async () => {
          throw new Error("business failure");
        },
      }),
    ).rejects.toThrow("business failure");

    expect(
      store.records.get("7:createProject:key-1234567890abcdef"),
    ).toBeUndefined();
  });

  test("保存非 2xx 成功响应被拒绝", async () => {
    const { runner } = setup();

    await expect(
      runner.run({
        actorId: 7,
        command: command(),
        execute: async () => result({ responseStatus: 500 }),
      }),
    ).rejects.toThrow("idempotency replay response status must be a 2xx");
  });
});
