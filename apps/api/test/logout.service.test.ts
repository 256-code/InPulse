import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  PREAUTH_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "../src/auth/csrf.http.js";
import { LogoutService } from "../src/auth/logout.service.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
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
  readonly revokedSessionIds: number[] = [];

  async findValidByTokenHashes(
    _tx: TransactionContext,
    _tokenHashes: readonly Buffer[],
  ): Promise<ValidUserSession | undefined> {
    return this.session;
  }

  async revoke(_tx: TransactionContext, sessionId: number): Promise<boolean> {
    this.revokedSessionIds.push(sessionId);
    return true;
  }
}

class FakeCsrfRepository {
  hashes: readonly Buffer[] = [];

  async findValidHashes(
    _tx: TransactionContext,
    _sessionId: number,
  ): Promise<Buffer[]> {
    return [...this.hashes];
  }
}

function validSession(): ValidUserSession {
  return {
    id: 42,
    userId: 7,
    authVersionAtIssue: 1,
    authState: "AUTHENTICATED",
    idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    absoluteExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
  };
}

function setup(
  options: {
    readonly session?: ValidUserSession | undefined;
    readonly csrfHashes?: readonly Buffer[];
  } = {},
) {
  const keyring = VersionedHmacKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  const tokenService = new SessionTokenService(keyring);
  const sessionToken = generateOpaqueToken();
  const csrfToken = generateOpaqueToken();
  const unitOfWork = new FakeUnitOfWork();
  const sessionRepository = new FakeSessionRepository();
  const csrfRepository = new FakeCsrfRepository();
  sessionRepository.session = Object.hasOwn(options, "session")
    ? options.session
    : validSession();
  csrfRepository.hashes = options.csrfHashes ?? [
    tokenService.hash(csrfToken).hash,
  ];
  const service = new LogoutService(
    unitOfWork as never,
    sessionRepository as never,
    csrfRepository as never,
    tokenService,
  );
  return {
    service,
    tokenService,
    sessionToken,
    csrfToken,
    unitOfWork,
    sessionRepository,
    csrfRepository,
  };
}

function input(
  result: ReturnType<typeof setup>,
  overrides: {
    readonly cookieHeader?: string;
    readonly csrfToken?: string | undefined;
  } = {},
) {
  return {
    cookieHeader: Object.hasOwn(overrides, "cookieHeader")
      ? overrides.cookieHeader
      : `${SESSION_COOKIE_NAME}=${result.sessionToken}`,
    csrfToken: Object.hasOwn(overrides, "csrfToken")
      ? overrides.csrfToken
      : result.csrfToken,
  };
}

describe("LogoutService", () => {
  test("有效 Session 与正确 CSRF 在同一事务撤销并清空两种 Cookie", async () => {
    const result = setup();
    const logout = await result.service.logout(input(result));

    expect(logout.cookies).toEqual([
      { name: PREAUTH_COOKIE_NAME, value: null, maxAgeSeconds: 0 },
      { name: SESSION_COOKIE_NAME, value: null, maxAgeSeconds: 0 },
    ]);
    expect(result.unitOfWork.runs).toBe(1);
    expect(result.sessionRepository.revokedSessionIds).toEqual([42]);
  });

  test("有效 Session 缺少 CSRF 返回 403 且不撤销", async () => {
    const result = setup();
    await expect(
      result.service.logout(input(result, { csrfToken: undefined })),
    ).rejects.toMatchObject({
      status: 403,
      code: "CSRF_TOKEN_INVALID",
    });
    expect(result.sessionRepository.revokedSessionIds).toEqual([]);
  });

  test("有效 Session CSRF 不匹配返回 403 且不撤销", async () => {
    const result = setup();
    await expect(
      result.service.logout(input(result, { csrfToken: "A".repeat(43) })),
    ).rejects.toMatchObject({
      status: 403,
      code: "CSRF_TOKEN_INVALID",
    });
    expect(result.sessionRepository.revokedSessionIds).toEqual([]);
  });

  test("Session 已失效或已撤销时只清 Cookie，不执行状态写", async () => {
    const result = setup({ session: undefined });
    const logout = await result.service.logout(
      input(result, { csrfToken: undefined }),
    );

    expect(logout.cookies).toEqual([
      { name: PREAUTH_COOKIE_NAME, value: null, maxAgeSeconds: 0 },
      { name: SESSION_COOKIE_NAME, value: null, maxAgeSeconds: 0 },
    ]);
    expect(result.unitOfWork.runs).toBe(1);
    expect(result.sessionRepository.revokedSessionIds).toEqual([]);
  });

  test("没有 Session Cookie 时不进入事务，直接清 Cookie", async () => {
    const result = setup();
    const logout = await result.service.logout({
      cookieHeader: "__Host-preauth=stale",
      csrfToken: undefined,
    });

    expect(logout.cookies).toEqual([
      { name: PREAUTH_COOKIE_NAME, value: null, maxAgeSeconds: 0 },
      { name: SESSION_COOKIE_NAME, value: null, maxAgeSeconds: 0 },
    ]);
    expect(result.unitOfWork.runs).toBe(0);
  });

  test("CSRF 已过期时返回 403 且不撤销", async () => {
    const result = setup({ csrfHashes: [] });
    await expect(result.service.logout(input(result))).rejects.toMatchObject({
      status: 403,
      code: "CSRF_TOKEN_INVALID",
    });
    expect(result.sessionRepository.revokedSessionIds).toEqual([]);
  });
});
