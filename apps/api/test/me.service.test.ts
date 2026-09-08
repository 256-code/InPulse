import { describe, expect, test } from "vitest";

import { MeService } from "../src/auth/me.service.js";
import { SessionAuthService } from "../src/auth/session-auth.service.js";
import {
  type CurrentUserProfile,
  type PostgresUserProfileRepository,
} from "../src/auth/user-profile.repository.js";
import type { TransactionContext } from "../src/database/transaction-context.js";
import type { UnitOfWork } from "../src/database/unit-of-work.js";

const tx: TransactionContext = { db: {} as never, sql: {} as never };

class FakeUnitOfWork implements UnitOfWork {
  callback: ((innerTx: TransactionContext) => Promise<unknown>) | undefined;

  async run<T>(
    callback: (innerTx: TransactionContext) => Promise<T>,
  ): Promise<T> {
    this.callback = callback as (
      innerTx: TransactionContext,
    ) => Promise<unknown>;
    return callback(tx);
  }
}

class FakeSessionAuthService {
  actorUserId: number | undefined;
  receivedTx: TransactionContext | undefined;

  async resolveActorInTransaction(
    receivedTx: TransactionContext,
    _cookieHeader: string | undefined,
  ): Promise<{ userId: number } | undefined> {
    this.receivedTx = receivedTx;
    return this.actorUserId === undefined
      ? undefined
      : { userId: this.actorUserId };
  }
}

class FakeProfileRepository implements PostgresUserProfileRepository {
  profile: CurrentUserProfile | undefined;
  requestedUserId: number | undefined;

  constructor(profile: CurrentUserProfile | undefined) {
    this.profile = profile;
  }

  async findActiveById(
    _tx: TransactionContext,
    userId: number,
  ): Promise<CurrentUserProfile | undefined> {
    this.requestedUserId = userId;
    return this.profile;
  }
}

function setup(
  actorUserId: number | undefined,
  profile: CurrentUserProfile | undefined,
) {
  const unitOfWork = new FakeUnitOfWork();
  const sessionAuth = new FakeSessionAuthService();
  sessionAuth.actorUserId = actorUserId;
  const profiles = new FakeProfileRepository(profile);
  const service = new MeService(
    unitOfWork as never,
    sessionAuth as never as SessionAuthService,
    profiles as never,
  );
  return { unitOfWork, sessionAuth, profiles, service };
}

describe("MeService", () => {
  test("身份与资料查询共用同一个事务", async () => {
    const profile = {
      id: 7,
      loginName: "alice",
      name: "Alice",
      email: null,
      avatarUrl: null,
      isAdmin: false,
      status: "ACTIVE" as const,
    };
    const { sessionAuth, profiles, service } = setup(7, profile);

    await expect(
      service.getCurrentUser("__Host-session=token"),
    ).resolves.toEqual(profile);
    expect(sessionAuth.receivedTx).toBe(tx);
    expect(profiles.requestedUserId).toBe(7);
  });

  test("未认证身份不查询用户资料", async () => {
    const { profiles, service } = setup(undefined, undefined);

    await expect(service.getCurrentUser(undefined)).resolves.toBeUndefined();
    expect(profiles.requestedUserId).toBeUndefined();
  });

  test("身份有效但用户资料不可读时返回 undefined", async () => {
    const { service } = setup(7, undefined);

    await expect(
      service.getCurrentUser("__Host-session=token"),
    ).resolves.toBeUndefined();
  });
});
