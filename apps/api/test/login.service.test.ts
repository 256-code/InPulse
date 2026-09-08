import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  PREAUTH_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from "../src/auth/csrf.http.js";
import { LoginService } from "../src/auth/login.service.js";
import { LoginError } from "../src/auth/login.error.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import type { PreauthSession } from "../src/auth/preauth-session.repository.js";
import { SessionTokenService } from "../src/auth/session-token.service.js";
import type { UserCredential } from "../src/auth/user-credential.repository.js";
import type { ValidUserSession } from "../src/auth/user-session.repository.js";
import type { TransactionContext } from "../src/database/transaction-context.js";
import type { UnitOfWork } from "../src/database/unit-of-work.js";

const TEST_LOGIN_PASSWORD = "correct-password";

class FakeUnitOfWork implements UnitOfWork {
  runs = 0;

  async run<T>(callback: (tx: TransactionContext) => Promise<T>): Promise<T> {
    this.runs += 1;
    return callback({ db: {} as never, sql: {} as never });
  }
}

class FakePreauthRepository {
  row: PreauthSession | undefined;
  consumed = false;

  async findByTokenHash(
    _tx: TransactionContext,
  ): Promise<PreauthSession | undefined> {
    return this.row;
  }

  async consumeOnce(_tx: TransactionContext): Promise<boolean> {
    if (this.consumed) {
      return false;
    }
    this.consumed = true;
    return true;
  }
}

class FakeUserCredentialRepository {
  credential: UserCredential | undefined;
  activeLock: boolean;

  constructor(options: { readonly activeLock?: boolean } = {}) {
    this.activeLock = options.activeLock ?? true;
  }

  async findByNormalizedLoginName(
    _tx: TransactionContext,
    _loginName: string,
  ): Promise<UserCredential | undefined> {
    return this.credential;
  }

  async lockForSessionIssue(
    _tx: TransactionContext,
    _userId: number,
    _expectedAuthVersion: number,
  ): Promise<
    | {
        readonly id: number;
        readonly isAdmin: boolean;
        readonly authVersion: number;
      }
    | undefined
  > {
    const credential = this.credential;
    if (!this.activeLock || credential === undefined) {
      return undefined;
    }
    return {
      id: credential.id,
      isAdmin: credential.isAdmin,
      authVersion: credential.authVersion,
    };
  }
}

class FakeFactorRepository {
  status: "ENROLLING" | "ACTIVE" | "DISABLED" | undefined;

  async findByUserId(
    _tx: TransactionContext,
  ): Promise<"ENROLLING" | "ACTIVE" | "DISABLED" | undefined> {
    return this.status;
  }
}

class FakeSessionRepository {
  existing: ValidUserSession | undefined;
  readonly inserts: Array<{
    readonly userId: number;
    readonly authState: ValidUserSession["authState"];
  }> = [];

  async findValidByTokenHashes(
    _tx: TransactionContext,
    _tokenHashes: readonly Buffer[],
  ): Promise<ValidUserSession | undefined> {
    return this.existing;
  }

  async create(
    _tx: TransactionContext,
    insert: {
      readonly userId: number;
      readonly authState: ValidUserSession["authState"];
    },
  ): Promise<{
    readonly id: number;
    readonly authState: ValidUserSession["authState"];
  }> {
    this.inserts.push(insert);
    return { id: this.inserts.length, authState: insert.authState };
  }
}

class FakeCsrfRepository {
  readonly inserts: Array<{ readonly sessionId: number }> = [];

  async issue(
    _tx: TransactionContext,
    insert: { readonly sessionId: number },
  ): Promise<void> {
    this.inserts.push(insert);
  }
}

class FakePasswordService {
  readonly encodedHashes: Array<string | undefined> = [];
  pass = true;

  async verify(
    _password: string,
    encodedHash: string | undefined,
  ): Promise<boolean> {
    this.encodedHashes.push(encodedHash);
    return this.pass;
  }
}

class FakeRateLimitService {
  blocked = false;
  readonly failures: Array<{
    readonly loginName: string;
    readonly clientIp: string;
  }> = [];
  readonly clearedAccounts: string[] = [];

  async assertAllowed(
    _tx: TransactionContext,
    _loginName: string,
    _clientIp: string,
  ): Promise<void> {
    if (this.blocked) {
      throw new LoginError(
        429,
        "LOGIN_RATE_LIMITED",
        "登录失败次数过多，请稍后再试",
        "login-rate-limited",
      );
    }
  }

  async recordFailure(loginName: string, clientIp: string): Promise<void> {
    this.failures.push({ loginName, clientIp });
  }

  async clearAccount(
    _tx: TransactionContext,
    loginName: string,
  ): Promise<void> {
    this.clearedAccounts.push(loginName);
  }
}

interface SetupResult {
  readonly service: LoginService;
  readonly tokenService: SessionTokenService;
  readonly material: ReturnType<SessionTokenService["issuePreauthMaterial"]>;
  readonly unitOfWork: FakeUnitOfWork;
  readonly preauthRepository: FakePreauthRepository;
  readonly passwordService: FakePasswordService;
  readonly sessionRepository: FakeSessionRepository;
  readonly csrfRepository: FakeCsrfRepository;
  readonly factorRepository: FakeFactorRepository;
  readonly rateLimitService: FakeRateLimitService;
}

function setup(
  options: {
    readonly credential?: UserCredential;
    readonly userLockActive?: boolean;
    readonly factorStatus?: "ENROLLING" | "ACTIVE" | "DISABLED";
    readonly existingSession?: boolean;
  } = {},
): SetupResult {
  const keyring = VersionedHmacKeyring.fromEntries(
    [{ version: 1, key: randomBytes(32) }],
    1,
  );
  const tokenService = new SessionTokenService(keyring);
  const unitOfWork = new FakeUnitOfWork();
  const preauthRepository = new FakePreauthRepository();
  const userRepository = new FakeUserCredentialRepository({
    activeLock: options.userLockActive ?? true,
  });
  const factorRepository = new FakeFactorRepository();
  const sessionRepository = new FakeSessionRepository();
  const csrfRepository = new FakeCsrfRepository();
  const passwordService = new FakePasswordService();
  const rateLimitService = new FakeRateLimitService();
  const service = new LoginService(
    unitOfWork as never,
    preauthRepository as never,
    userRepository as never,
    factorRepository as never,
    sessionRepository as never,
    csrfRepository as never,
    tokenService,
    passwordService as never,
    rateLimitService as never,
  );

  const material = tokenService.issuePreauthMaterial();
  preauthRepository.row = {
    id: 1,
    tokenHash: material.sessionTokenHash,
    tokenHashKeyVersion: material.tokenHashKeyVersion,
    csrfTokenHash: material.csrfTokenHash,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 9 * 60 * 1000),
    consumedAt: null,
  };
  userRepository.credential =
    options.credential ??
    ({
      id: 7,
      loginName: "alice",
      passwordHash: "$argon2id$fixture",
      isAdmin: false,
      status: "ACTIVE",
      authVersion: 1,
      disabledAt: null,
    } satisfies UserCredential);
  factorRepository.status = options.factorStatus;
  if (options.existingSession === true) {
    sessionRepository.existing = {
      id: 42,
      userId: 7,
      authVersionAtIssue: 1,
      authState: "AUTHENTICATED",
      idleExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
      absoluteExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }
  return {
    service,
    tokenService,
    material,
    unitOfWork,
    preauthRepository,
    passwordService,
    sessionRepository,
    csrfRepository,
    factorRepository,
    rateLimitService,
  };
}

function input(
  result: SetupResult,
  overrides: Partial<{
    readonly password: string;
    readonly csrfToken: string | undefined;
    readonly cookieHeader: string | undefined;
    readonly clientIp: string;
  }> = {},
) {
  const material = result.material;
  return {
    loginName: "alice",
    password: TEST_LOGIN_PASSWORD,
    clientIp: "203.0.113.7",
    cookieHeader:
      overrides.cookieHeader ??
      `${PREAUTH_COOKIE_NAME}=${material.sessionToken}`,
    csrfToken: material.csrfToken,
    ...overrides,
  };
}

describe("LoginService", () => {
  test("普通用户登录成功并消费预认证、创建 Session 与 CSRF", async () => {
    const result = setup();
    const login = await result.service.login(input(result));

    expect(login.authState).toBe("AUTHENTICATED");
    expect(login.csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(login.cookies.map((cookie) => cookie.name)).toEqual([
      PREAUTH_COOKIE_NAME,
      SESSION_COOKIE_NAME,
    ]);
    expect(login.cookies[1]?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.preauthRepository.consumed).toBe(true);
    expect(result.sessionRepository.inserts).toHaveLength(1);
    expect(result.csrfRepository.inserts).toHaveLength(1);
    expect(result.unitOfWork.runs).toBe(2);
    expect(result.rateLimitService.clearedAccounts).toEqual(["alice"]);
  });

  test("已存在有效认证 Session 返回 409 且不校验密码", async () => {
    const result = setup({ existingSession: true });
    await expect(result.service.login(input(result))).rejects.toMatchObject({
      status: 409,
      code: "AUTH_SESSION_CONFLICT",
    });
    expect(result.passwordService.encodedHashes).toHaveLength(0);
    expect(result.sessionRepository.inserts).toHaveLength(0);
  });

  test("密码错误返回 401 且不产生任何写操作", async () => {
    const result = setup();
    result.passwordService.pass = false;
    await expect(result.service.login(input(result))).rejects.toMatchObject({
      status: 401,
      code: "INVALID_AUTH_CREDENTIALS",
    });
    expect(result.preauthRepository.consumed).toBe(false);
    expect(result.sessionRepository.inserts).toHaveLength(0);
    expect(result.rateLimitService.failures).toEqual([
      { loginName: "alice", clientIp: "203.0.113.7" },
    ]);
  });

  test("CSRF 不匹配时执行等时校验并返回 401", async () => {
    const result = setup();
    const request = input(result, {
      csrfToken: "A".repeat(43),
    });
    await expect(result.service.login(request)).rejects.toMatchObject({
      status: 401,
    });
    expect(result.passwordService.encodedHashes).toEqual([undefined]);
    expect(result.unitOfWork.runs).toBe(1);
    expect(result.rateLimitService.failures).toEqual([
      { loginName: "alice", clientIp: "203.0.113.7" },
    ]);
  });

  test("停用用户返回 401 且不把真实密码哈希传给校验器", async () => {
    const result = setup({
      credential: {
        id: 7,
        loginName: "alice",
        passwordHash: "$argon2id$fixture",
        isAdmin: false,
        status: "DISABLED",
        authVersion: 1,
        disabledAt: new Date(),
      },
    });
    await expect(result.service.login(input(result))).rejects.toMatchObject({
      status: 401,
    });
    expect(result.passwordService.encodedHashes).toEqual([undefined]);
  });

  test("签发前用户 auth_version 变化或停用则回滚并返回 401", async () => {
    const result = setup({ userLockActive: false });
    await expect(result.service.login(input(result))).rejects.toMatchObject({
      status: 401,
    });
    expect(result.sessionRepository.inserts).toHaveLength(0);
    expect(result.preauthRepository.consumed).toBe(false);
  });

  test("同一预认证只能成功登录一次", async () => {
    const result = setup();
    const first = input(result);
    await result.service.login(first);
    await expect(result.service.login(first)).rejects.toMatchObject({
      status: 401,
    });
    expect(result.sessionRepository.inserts).toHaveLength(1);
  });

  test("限流命中时返回 429 且不校验密码", async () => {
    const result = setup();
    result.rateLimitService.blocked = true;
    await expect(result.service.login(input(result))).rejects.toMatchObject({
      status: 429,
      code: "LOGIN_RATE_LIMITED",
    });
    expect(result.passwordService.encodedHashes).toHaveLength(0);
    expect(result.preauthRepository.consumed).toBe(false);
    expect(result.unitOfWork.runs).toBe(1);
  });
});

describe("管理员 MFA 状态选择", () => {
  function adminCredential(): UserCredential {
    return {
      id: 7,
      loginName: "admin",
      passwordHash: "$argon2id$fixture",
      isAdmin: true,
      status: "ACTIVE",
      authVersion: 1,
      disabledAt: null,
    };
  }

  test("管理员无 ACTIVE 因子进入 MFA_ENROLLMENT", async () => {
    const result = setup({ credential: adminCredential() });
    const login = await result.service.login(input(result));
    expect(login.authState).toBe("MFA_ENROLLMENT");
  });

  test("管理员有 ACTIVE 因子进入 MFA_CHALLENGE", async () => {
    const result = setup({
      credential: adminCredential(),
      factorStatus: "ACTIVE",
    });
    const login = await result.service.login(input(result));
    expect(login.authState).toBe("MFA_CHALLENGE");
  });
});
