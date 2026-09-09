import { Injectable } from "@nestjs/common";

import type { PreauthSession } from "./preauth-session.repository.js";
import { PostgresPreauthSessionRepository } from "./preauth-session.repository.js";
import type {
  UserCredential,
  UserSessionIssueSnapshot,
} from "./user-credential.repository.js";
import { PostgresUserCredentialRepository } from "./user-credential.repository.js";
import type { UserAuthState } from "./user-session.repository.js";
import { PostgresUserSessionRepository } from "./user-session.repository.js";
import type { TotpFactorLoginSnapshot } from "./user-totp-factor.repository.js";
import { PostgresUserTotpFactorRepository } from "./user-totp-factor.repository.js";
import { PostgresMfaRecoveryCodeRepository } from "./mfa-recovery-code.repository.js";
import type { TransactionContext } from "../database/transaction-context.js";
import {
  AUTH_CSRF_MAX_AGE_SECONDS,
  PREAUTH_COOKIE_NAME,
  SESSION_ABSOLUTE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  SESSION_IDLE_MAX_AGE_SECONDS,
  type CsrfSetCookie,
  parseCookieHeader,
} from "./csrf.http.js";
import { PostgresSessionCsrfTokenRepository } from "./session-csrf-token.repository.js";
import { SessionTokenService } from "./session-token.service.js";
import {
  constantTimeEqual,
  generateOpaqueToken,
  isValidOpaqueToken,
} from "./token.js";
import { PasswordService } from "./password.service.js";
import { LoginError } from "./login.error.js";
import { LoginRateLimitService } from "./auth-rate-limit.service.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";

export interface LoginInput {
  readonly loginName: string;
  readonly password: string;
  readonly clientIp: string;
  readonly cookieHeader: string | undefined;
  readonly csrfToken: string | undefined;
  readonly challengeMode?: "totp" | "recovery";
}

export interface LoginResult {
  readonly csrfToken: string;
  readonly authState: UserAuthState;
  readonly enrollmentGeneration?: number;
  readonly cookies: readonly CsrfSetCookie[];
}

interface PreparedLogin {
  readonly preauth: PreauthSession | undefined;
  readonly user: UserCredential | undefined;
}

/**
 * 登录纵切片：
 * 1. 只接受匿名预认证 Session 与其 CSRF；
 * 2. 已存在有效认证/受限 Session 时返回 409；
 * 3. 在 Argon2id 前按账号 + IP + 全局检查登录限流；
 * 4. Argon2id 校验放在事务外，避免长时间 CPU 计算持锁；
 * 5. 密码通过后在单个事务内重新锁定用户、条件消费预认证、创建显式状态
 *    的认证 Session 并签发新 CSRF Token，防止 Session Fixation。
 */
@Injectable()
export class LoginService {
  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly preauthRepository: PostgresPreauthSessionRepository,
    private readonly userRepository: PostgresUserCredentialRepository,
    private readonly factorRepository: PostgresUserTotpFactorRepository,
    private readonly recoveryCodeRepository: PostgresMfaRecoveryCodeRepository,
    private readonly sessionRepository: PostgresUserSessionRepository,
    private readonly csrfRepository: PostgresSessionCsrfTokenRepository,
    private readonly tokenService: SessionTokenService,
    private readonly passwordService: PasswordService,
    private readonly rateLimitService: LoginRateLimitService,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const loginName = input.loginName.trim();
    const clientIp = input.clientIp;
    const prepared = await this.prepare(input, loginName, clientIp);
    try {
      await this.verifyPassword(prepared, input.password);
    } catch (error) {
      if (error instanceof LoginError && error.status === 401) {
        await this.rateLimitService.recordFailure(loginName, clientIp);
      }
      throw error;
    }
    return this.issueSession(
      prepared,
      input.cookieHeader,
      loginName,
      input.challengeMode ?? "totp",
    );
  }

  private async prepare(
    input: LoginInput,
    loginName: string,
    clientIp: string,
  ): Promise<PreparedLogin> {
    return this.unitOfWork.run(async (tx) => {
      const sessionToken = parseCookieHeader(
        input.cookieHeader,
        SESSION_COOKIE_NAME,
      );
      const sessionCandidates = sessionToken
        ? this.tokenService.hashCandidates(sessionToken)
        : [];
      const existing = await this.sessionRepository.findValidByTokenHashes(
        tx,
        sessionCandidates.map((candidate) => candidate.hash),
      );
      if (existing !== undefined) {
        throw this.sessionConflict();
      }

      await this.rateLimitService.assertAllowed(tx, loginName, clientIp);

      const preauthToken = parseCookieHeader(
        input.cookieHeader,
        PREAUTH_COOKIE_NAME,
      );
      const preauth = await this.findPreauth(tx, preauthToken, input.csrfToken);
      if (preauth === undefined) {
        return { preauth: undefined, user: undefined };
      }

      const user = await this.userRepository.findByNormalizedLoginName(
        tx,
        loginName,
      );
      return { preauth, user };
    });
  }

  private async findPreauth(
    tx: TransactionContext,
    preauthToken: string | undefined,
    csrfToken: string | undefined,
  ): Promise<PreauthSession | undefined> {
    const token = preauthToken;
    const csrf = csrfToken;
    if (
      token === undefined ||
      csrf === undefined ||
      !isValidOpaqueToken(token) ||
      !isValidOpaqueToken(csrf)
    ) {
      return undefined;
    }

    for (const candidate of this.tokenService.hashCandidates(token)) {
      const row = await this.preauthRepository.findByTokenHash(
        tx,
        candidate.hash,
      );
      if (row === undefined) {
        continue;
      }
      const sessionHash = this.tokenService.hashWithVersion(
        token,
        row.tokenHashKeyVersion,
      );
      const csrfHash = this.tokenService.hashWithVersion(
        csrf,
        row.tokenHashKeyVersion,
      );
      if (
        constantTimeEqual(sessionHash, row.tokenHash) &&
        constantTimeEqual(csrfHash, row.csrfTokenHash)
      ) {
        return row;
      }
    }
    return undefined;
  }

  private async verifyPassword(
    prepared: PreparedLogin,
    password: string,
  ): Promise<void> {
    const user = prepared.user;
    if (prepared.preauth === undefined) {
      await this.passwordService.verify(password, undefined);
      throw invalidCredentials();
    }
    const eligible =
      user !== undefined &&
      user.status === "ACTIVE" &&
      user.disabledAt === null;
    const ok = await this.passwordService.verify(
      password,
      eligible ? user.passwordHash : undefined,
    );
    if (!ok || !eligible) {
      throw invalidCredentials();
    }
  }

  private async issueSession(
    prepared: PreparedLogin,
    cookieHeader: string | undefined,
    loginName: string,
    challengeMode: "totp" | "recovery",
  ): Promise<LoginResult> {
    return this.unitOfWork.run(async (tx) => {
      const sessionToken = parseCookieHeader(cookieHeader, SESSION_COOKIE_NAME);
      const sessionCandidates = sessionToken
        ? this.tokenService.hashCandidates(sessionToken)
        : [];
      const existing = await this.sessionRepository.findValidByTokenHashes(
        tx,
        sessionCandidates.map((candidate) => candidate.hash),
      );
      if (existing !== undefined) {
        throw this.sessionConflict();
      }

      if (prepared.preauth === undefined || prepared.user === undefined) {
        throw invalidCredentials();
      }

      const snapshot = await this.userRepository.lockForSessionIssue(
        tx,
        prepared.user.id,
        prepared.user.authVersion,
      );
      if (snapshot === undefined) {
        throw invalidCredentials();
      }

      const factorSnapshot = await this.factorRepository.findLoginSnapshot(
        tx,
        snapshot.id,
      );
      const auth = await authStateFor(
        tx,
        snapshot,
        factorSnapshot,
        challengeMode,
        this.recoveryCodeRepository,
      );
      const authState = auth.authState;
      const issuedSessionToken = generateOpaqueToken();
      const issuedCsrfToken = generateOpaqueToken();
      const sessionHash = this.tokenService.hash(issuedSessionToken);
      const csrfHash = this.tokenService.hash(issuedCsrfToken);
      const now = Date.now();
      const absoluteExpiresAt = new Date(
        now + SESSION_ABSOLUTE_MAX_AGE_SECONDS * 1000,
      );
      const idleExpiresAt = new Date(now + SESSION_IDLE_MAX_AGE_SECONDS * 1000);

      const consumed = await this.preauthRepository.consumeOnce(
        tx,
        prepared.preauth.id,
      );
      if (!consumed) {
        throw invalidCredentials();
      }

      const created = await this.sessionRepository.create(tx, {
        userId: snapshot.id,
        tokenHash: sessionHash.hash,
        tokenHashKeyVersion: sessionHash.keyVersion,
        authVersionAtIssue: snapshot.authVersion,
        authState,
        idleExpiresAt,
        absoluteExpiresAt,
      });
      await this.csrfRepository.issue(tx, {
        sessionId: created.id,
        tokenHash: csrfHash.hash,
        expiresAt: new Date(
          Math.min(
            Date.now() + AUTH_CSRF_MAX_AGE_SECONDS * 1000,
            absoluteExpiresAt.getTime(),
          ),
        ),
      });

      await this.rateLimitService.clearAccount(tx, loginName);

      return {
        csrfToken: issuedCsrfToken,
        authState,
        ...(auth.enrollmentGeneration === undefined
          ? {}
          : { enrollmentGeneration: auth.enrollmentGeneration }),
        cookies: [
          {
            name: PREAUTH_COOKIE_NAME,
            value: null,
            maxAgeSeconds: 0,
          },
          {
            name: SESSION_COOKIE_NAME,
            value: issuedSessionToken,
            maxAgeSeconds: SESSION_ABSOLUTE_MAX_AGE_SECONDS,
          },
        ],
      };
    });
  }

  private sessionConflict(): LoginError {
    return new LoginError(
      409,
      "AUTH_SESSION_CONFLICT",
      "已有认证或受限 Session，请先登出或清 Cookie 后再登录",
      "existing-authenticated-session",
    );
  }
}

function invalidCredentials(): LoginError {
  return new LoginError(
    401,
    "INVALID_AUTH_CREDENTIALS",
    "预认证 Session、CSRF 或用户名密码无效",
    "invalid-credentials",
  );
}

async function authStateFor(
  tx: TransactionContext,
  snapshot: UserSessionIssueSnapshot,
  factor: TotpFactorLoginSnapshot | undefined,
  challengeMode: "totp" | "recovery",
  recoveryCodeRepository: PostgresMfaRecoveryCodeRepository,
): Promise<{
  readonly authState: UserAuthState;
  readonly enrollmentGeneration?: number;
}> {
  if (!snapshot.isAdmin) {
    return { authState: "AUTHENTICATED" };
  }
  if (factor === undefined) {
    return { authState: "MFA_ENROLLMENT", enrollmentGeneration: 0 };
  }
  if (factor.status !== "ACTIVE") {
    return {
      authState: "MFA_ENROLLMENT",
      enrollmentGeneration: factor.enrollmentGeneration,
    };
  }
  if (challengeMode === "recovery") {
    const hashes = await recoveryCodeRepository.findActiveHashes(
      tx,
      snapshot.id,
    );
    if (hashes.length > 0) {
      return { authState: "RECOVERY_CHALLENGE" };
    }
  }
  return { authState: "MFA_CHALLENGE" };
}
