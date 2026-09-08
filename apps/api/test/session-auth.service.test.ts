import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import { SESSION_COOKIE_NAME } from "../src/auth/csrf.http.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { SessionAuthService } from "../src/auth/session-auth.service.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { generateOpaqueToken } from "../src/auth/token.js";
import type { ValidUserSession } from "../src/auth/user-session.repository.js";
import type { TransactionContext } from "../src/database/transaction-context.js";
import type { UnitOfWork } from "../src/database/unit-of-work.js";

class FakeUnitOfWork implements UnitOfWork {
  runs = 0;

  async run<T>(callback: (tx: TransactionContext) => Promise<T>): Promise<T> {
    this.runs += 1;
    return callback({ db: {} as never, sql: {} as never });
  }
}

class FakeSessionRepository {
  session: ValidUserSession | undefined;
  requestedHashCounts: number[] = [];

  async findValidByTokenHashes(
    _tx: TransactionContext,
    tokenHashes: readonly Buffer[],
  ): Promise<ValidUserSession | undefined> {
    this.requestedHashCounts.push(tokenHashes.length);
    return this.session;
  }
}

const fakeTransaction = (): TransactionContext => ({
  db: {} as never,
  sql: {} as never,
});

function validSession(
  authState: ValidUserSession["authState"],
): ValidUserSession {
  return {
    id: 42,
    userId: 7,
    authVersionAtIssue: 1,
    authState,
    idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    absoluteExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
}

function setup(session?: ValidUserSession) {
  const keyring = VersionedHmacKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  const tokenService = new SessionTokenService(keyring);
  const unitOfWork = new FakeUnitOfWork();
  const sessionRepository = new FakeSessionRepository();
  sessionRepository.session = session;
  const service = new SessionAuthService(
    unitOfWork as never,
    sessionRepository as never,
    tokenService,
  );
  return { tokenService, unitOfWork, sessionRepository, service };
}

describe("SessionAuthService", () => {
  test("有效 AUTHENTICATED Session 返回当前用户身份", async () => {
    const session = validSession("AUTHENTICATED");
    const { service, sessionRepository } = setup(session);
    const token = generateOpaqueToken();

    const actor = await service.resolveActor(
      `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure`,
    );

    expect(actor).toEqual({
      sessionId: session.id,
      userId: session.userId,
      authState: "AUTHENTICATED",
      authVersionAtIssue: session.authVersionAtIssue,
    });
    expect(sessionRepository.requestedHashCounts).toEqual([1]);
  });

  test("缺少 Session Cookie 时不进入事务并返回 undefined", async () => {
    const { service, unitOfWork } = setup(validSession("AUTHENTICATED"));

    await expect(service.resolveActor(undefined)).resolves.toBeUndefined();
    expect(unitOfWork.runs).toBe(0);
  });

  test("非法 Session Token 返回 undefined 且不查询数据库", async () => {
    const { service, unitOfWork } = setup(validSession("AUTHENTICATED"));

    await expect(
      service.resolveActor(`${SESSION_COOKIE_NAME}=short`),
    ).resolves.toBeUndefined();
    expect(unitOfWork.runs).toBe(0);
  });

  test("MFA 受限 Session 不解析为业务身份", async () => {
    const { service } = setup(validSession("MFA_CHALLENGE"));
    const token = generateOpaqueToken();

    await expect(
      service.resolveActor(`${SESSION_COOKIE_NAME}=${token}`),
    ).resolves.toBeUndefined();
  });

  test("Repository 未命中时返回 undefined", async () => {
    const { service } = setup(undefined);
    const token = generateOpaqueToken();

    await expect(
      service.resolveActor(`${SESSION_COOKIE_NAME}=${token}`),
    ).resolves.toBeUndefined();
  });

  test("resolveActorInTransaction 复用调用方事务并返回当前用户身份", async () => {
    const session = validSession("AUTHENTICATED");
    const { service, sessionRepository } = setup(session);
    const token = generateOpaqueToken();
    const tx = fakeTransaction();

    const actor = await service.resolveActorInTransaction(
      tx,
      `${SESSION_COOKIE_NAME}=${token}`,
    );

    expect(actor).toEqual({
      sessionId: session.id,
      userId: session.userId,
      authState: "AUTHENTICATED",
      authVersionAtIssue: session.authVersionAtIssue,
    });
    expect(sessionRepository.requestedHashCounts).toEqual([1]);
  });

  test("resolveActorInTransaction 缺少 Cookie 时不查询数据库", async () => {
    const { service, sessionRepository } = setup(validSession("AUTHENTICATED"));

    await expect(
      service.resolveActorInTransaction(fakeTransaction(), undefined),
    ).resolves.toBeUndefined();
    expect(sessionRepository.requestedHashCounts).toEqual([]);
  });

  test("resolveActorInTransaction 拒绝受限 Session", async () => {
    const { service } = setup(validSession("MFA_CHALLENGE"));
    const token = generateOpaqueToken();

    await expect(
      service.resolveActorInTransaction(
        fakeTransaction(),
        `${SESSION_COOKIE_NAME}=${token}`,
      ),
    ).resolves.toBeUndefined();
  });
});
