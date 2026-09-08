import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import { CsrfIssueService } from "../src/auth/csrf-issue.service.js";
import {
  PREAUTH_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "../src/auth/csrf.http.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import type { PreauthSessionInsert } from "../src/auth/preauth-session.repository.js";
import type { SessionCsrfTokenInsert } from "../src/auth/session-csrf-token.repository.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import { generateOpaqueToken } from "../src/auth/token.js";
import type { ValidUserSession } from "../src/auth/user-session.repository.js";
import type { TransactionContext } from "../src/database/transaction-context.js";
import type { UnitOfWork } from "../src/database/unit-of-work.js";

class FakeUnitOfWork implements UnitOfWork {
  async run<T>(callback: (tx: TransactionContext) => Promise<T>): Promise<T> {
    return callback({ db: {} as never, sql: {} as never });
  }
}

class FakePreauthRepository {
  readonly inserts: PreauthSessionInsert[] = [];

  async create(_tx: TransactionContext, insert: PreauthSessionInsert) {
    this.inserts.push(insert);
    return { id: this.inserts.length };
  }
}

class FakeUserSessionRepository {
  session: ValidUserSession | undefined;
  readonly requestedHashes: Buffer[][] = [];

  async findValidByTokenHashes(
    _tx: TransactionContext,
    tokenHashes: readonly Buffer[],
  ): Promise<ValidUserSession | undefined> {
    this.requestedHashes.push([...tokenHashes]);
    return this.session;
  }
}

class FakeCsrfRepository {
  readonly inserts: SessionCsrfTokenInsert[] = [];

  async issue(_tx: TransactionContext, insert: SessionCsrfTokenInsert) {
    this.inserts.push(insert);
  }
}

function setup() {
  const keyring = VersionedHmacKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  const tokenService = new SessionTokenService(keyring);
  const unitOfWork = new FakeUnitOfWork();
  const preauthRepository = new FakePreauthRepository();
  const userSessionRepository = new FakeUserSessionRepository();
  const csrfRepository = new FakeCsrfRepository();
  const service = new CsrfIssueService(
    unitOfWork as never,
    preauthRepository as never,
    userSessionRepository as never,
    csrfRepository as never,
    tokenService,
  );
  return {
    tokenService,
    preauthRepository,
    userSessionRepository,
    csrfRepository,
    service,
  };
}

describe("CsrfIssueService", () => {
  test("匿名请求创建预认证 Session，返回新 Token 与 Cookie", async () => {
    const { service, tokenService, preauthRepository } = setup();
    const issue = await service.issue({ cookieHeader: undefined });

    expect(issue.cookies).toHaveLength(1);
    expect(issue.cookies[0]?.name).toBe(PREAUTH_COOKIE_NAME);
    expect(issue.cookies[0]?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(preauthRepository.inserts).toHaveLength(1);
    const insert = preauthRepository.inserts[0]!;
    expect(
      insert.csrfTokenHash.equals(tokenService.hash(issue.csrfToken).hash),
    ).toBe(true);
    expect(insert.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 9 * 60 * 1000 - 1000,
    );
  });

  test("有效认证 Session 在原 Session 上签发 CSRF 并清过时预认证 Cookie", async () => {
    const { service, tokenService, userSessionRepository, csrfRepository } =
      setup();
    const sessionToken = generateOpaqueToken();
    userSessionRepository.session = {
      id: 42,
      userId: 7,
      authVersionAtIssue: 1,
      authState: "AUTHENTICATED",
      idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      absoluteExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    };

    const issue = await service.issue({
      cookieHeader: `${SESSION_COOKIE_NAME}=${sessionToken}`,
    });

    expect(csrfRepository.inserts).toHaveLength(1);
    expect(csrfRepository.inserts[0]?.sessionId).toBe(42);
    expect(
      csrfRepository.inserts[0]?.tokenHash.equals(
        tokenService.hash(issue.csrfToken).hash,
      ),
    ).toBe(true);
    expect(issue.cookies).toEqual([
      { name: PREAUTH_COOKIE_NAME, value: null, maxAgeSeconds: 0 },
    ]);
    expect(userSessionRepository.requestedHashes[0]).toHaveLength(1);
  });

  test("无效或缺失 Session 回退为匿名预认证，并清失效认证 Cookie", async () => {
    const { service, userSessionRepository, preauthRepository } = setup();
    userSessionRepository.session = undefined;
    const sessionToken = "not-a-valid-token";

    const issue = await service.issue({
      cookieHeader: `${SESSION_COOKIE_NAME}=${sessionToken}`,
    });

    expect(preauthRepository.inserts).toHaveLength(1);
    expect(issue.cookies).toHaveLength(2);
    expect(issue.cookies[0]).toEqual({
      name: SESSION_COOKIE_NAME,
      value: null,
      maxAgeSeconds: 0,
    });
    expect(issue.cookies[1]?.name).toBe(PREAUTH_COOKIE_NAME);
  });
});
