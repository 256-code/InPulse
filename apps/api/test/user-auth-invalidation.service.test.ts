import { describe, expect, test } from "vitest";

import type { TransactionContext } from "../src/database/transaction-context.js";
import type { UnitOfWork } from "../src/database/unit-of-work.js";
import { UserAuthInvalidationService } from "../src/auth/user-auth-invalidation.service.js";

class FakeUnitOfWork implements UnitOfWork {
  runs = 0;

  async run<T>(callback: (tx: TransactionContext) => Promise<T>): Promise<T> {
    this.runs += 1;
    return callback({ db: {} as never, sql: {} as never });
  }
}

class FakeUserRepository {
  exists = true;
  readonly incrementedUserIds: number[] = [];

  async incrementAuthVersion(
    _tx: TransactionContext,
    userId: number,
  ): Promise<boolean> {
    if (!this.exists) {
      return false;
    }
    this.incrementedUserIds.push(userId);
    return true;
  }
}

class FakeSessionRepository {
  readonly revokedUserIds: number[] = [];

  async revokeAllForUser(
    _tx: TransactionContext,
    userId: number,
  ): Promise<number> {
    this.revokedUserIds.push(userId);
    return 1;
  }
}

function setup(options: { readonly userExists?: boolean } = {}) {
  const unitOfWork = new FakeUnitOfWork();
  const userRepository = new FakeUserRepository();
  const sessionRepository = new FakeSessionRepository();
  userRepository.exists = options.userExists ?? true;
  const service = new UserAuthInvalidationService(
    unitOfWork as never,
    userRepository as never,
    sessionRepository as never,
  );
  return { service, unitOfWork, userRepository, sessionRepository };
}

describe("UserAuthInvalidationService", () => {
  test("用户存在时递增 auth_version 并撤销全部 Session", async () => {
    const result = setup();
    const invalidated = await result.service.invalidateUserSessions(7);

    expect(invalidated).toBe(true);
    expect(result.unitOfWork.runs).toBe(1);
    expect(result.userRepository.incrementedUserIds).toEqual([7]);
    expect(result.sessionRepository.revokedUserIds).toEqual([7]);
  });

  test("用户不存在时返回 false 且不撤销 Session", async () => {
    const result = setup({ userExists: false });
    const invalidated = await result.service.invalidateUserSessions(7);

    expect(invalidated).toBe(false);
    expect(result.sessionRepository.revokedUserIds).toEqual([]);
  });

  test("复用调用方事务时不再开启新事务", async () => {
    const result = setup();
    const tx = { db: {} as never, sql: {} as never };
    const invalidated =
      await result.service.invalidateUserSessionsInTransaction(tx, 7);

    expect(invalidated).toBe(true);
    expect(result.unitOfWork.runs).toBe(0);
    expect(result.sessionRepository.revokedUserIds).toEqual([7]);
  });
});
