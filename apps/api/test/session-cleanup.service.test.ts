import { describe, expect, test } from "vitest";

import type { SessionCleanupBatch } from "../src/auth/session-cleanup.repository.js";
import { PostgresSessionCleanupRepository } from "../src/auth/session-cleanup.repository.js";
import {
  SessionCleanupService,
  sessionCleanupOptionsFromEnv,
} from "../src/auth/session-cleanup.service.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import type { TransactionContext } from "../src/database/transaction-context.js";

class FakeUnitOfWork {
  runs = 0;

  async run<T>(callback: (tx: TransactionContext) => Promise<T>): Promise<T> {
    this.runs += 1;
    return callback({ db: {} as never, sql: {} as never });
  }
}

class FakeCleanupRepository {
  batches: readonly SessionCleanupBatch[] = [];
  callIndex = 0;
  batchSizes: number[] = [];

  async cleanupBatch(
    _tx: TransactionContext,
    batchSize: number,
  ): Promise<SessionCleanupBatch> {
    this.batchSizes.push(batchSize);
    const batch = this.batches[this.callIndex];
    this.callIndex += 1;
    return (
      batch ?? {
        deletedUserSessions: 0,
        deletedSessionCsrfTokens: 0,
        deletedPreauthSessions: 0,
      }
    );
  }
}

function setup(batches: readonly SessionCleanupBatch[]) {
  const unitOfWork = new FakeUnitOfWork();
  const repository = new FakeCleanupRepository();
  repository.batches = batches;
  const service = new SessionCleanupService(
    unitOfWork as unknown as PostgresUnitOfWork,
    repository as unknown as PostgresSessionCleanupRepository,
  );
  return { service, unitOfWork, repository };
}

describe("SessionCleanupService", () => {
  test("空批次只执行一次并立即结束", async () => {
    const { service, unitOfWork, repository } = setup([]);

    const result = await service.run({ batchSize: 100, maxBatches: 1000 });

    expect(result).toEqual({
      deletedUserSessions: 0,
      deletedSessionCsrfTokens: 0,
      deletedPreauthSessions: 0,
      batches: 1,
    });
    expect(unitOfWork.runs).toBe(1);
    expect(repository.batchSizes).toEqual([100]);
  });

  test("满批次继续并聚合并及时空批次停止", async () => {
    const { service, unitOfWork, repository } = setup([
      {
        deletedUserSessions: 2,
        deletedSessionCsrfTokens: 1,
        deletedPreauthSessions: 3,
      },
      {
        deletedUserSessions: 0,
        deletedSessionCsrfTokens: 1,
        deletedPreauthSessions: 0,
      },
      {
        deletedUserSessions: 0,
        deletedSessionCsrfTokens: 0,
        deletedPreauthSessions: 0,
      },
    ]);

    const result = await service.run({ batchSize: 25, maxBatches: 1000 });

    expect(result).toEqual({
      deletedUserSessions: 2,
      deletedSessionCsrfTokens: 2,
      deletedPreauthSessions: 3,
      batches: 3,
    });
    expect(unitOfWork.runs).toBe(3);
    expect(repository.batchSizes).toEqual([25, 25, 25]);
  });

  test("达到最大批次后停止", async () => {
    const { service, unitOfWork } = setup([
      {
        deletedUserSessions: 1,
        deletedSessionCsrfTokens: 0,
        deletedPreauthSessions: 0,
      },
      {
        deletedUserSessions: 1,
        deletedSessionCsrfTokens: 0,
        deletedPreauthSessions: 0,
      },
      {
        deletedUserSessions: 1,
        deletedSessionCsrfTokens: 0,
        deletedPreauthSessions: 0,
      },
    ]);

    const result = await service.run({ batchSize: 10, maxBatches: 2 });

    expect(result).toEqual({
      deletedUserSessions: 2,
      deletedSessionCsrfTokens: 0,
      deletedPreauthSessions: 0,
      batches: 2,
    });
    expect(unitOfWork.runs).toBe(2);
  });

  test("环境变量默认值有效且非法值 fail closed", () => {
    expect(sessionCleanupOptionsFromEnv({})).toEqual({
      batchSize: 100,
      maxBatches: 1000,
    });
    expect(
      sessionCleanupOptionsFromEnv({
        SESSION_CLEANUP_BATCH_SIZE: "50",
        SESSION_CLEANUP_MAX_BATCHES: "7",
      }),
    ).toEqual({ batchSize: 50, maxBatches: 7 });
    expect(() =>
      sessionCleanupOptionsFromEnv({ SESSION_CLEANUP_BATCH_SIZE: "0" }),
    ).toThrow("positive integer");
  });
});
