import { Injectable } from "@nestjs/common";

import type { TransactionContext } from "../database/transaction-context.js";
import {
  SESSION_COOKIE_NAME,
  getHeader,
  parseCookieHeader,
  type HttpHeaderBag,
} from "./csrf.http.js";
import {
  invalidAdminSession,
  notAdmin,
  csrfRejected,
} from "./admin-high-risk.error.js";
import { PostgresSessionCsrfTokenRepository } from "./session-csrf-token.repository.js";
import { SessionTokenService } from "./session-token.service.js";
import { constantTimeEqual, isValidOpaqueToken } from "./token.js";
import { PostgresUserCredentialRepository } from "./user-credential.repository.js";
import type { ValidUserSession } from "./user-session.repository.js";
import { PostgresUserSessionRepository } from "./user-session.repository.js";

export interface AdminHighRiskActor {
  readonly userId: number;
  readonly sessionId: number;
  readonly authVersionAtIssue: number;
}

/**
 * 管理员高风险操作的前置校验。ADR-031 之后不再要求密码 + TOTP 的
 * 五分钟重认证窗口，只校验：有效的完整认证 Session、管理员身份与
 * （写操作所需的）同步 CSRF Token。
 *
 * 只负责解析与读取，不锁定 user/Session；调用方若仍需锁序，须在取锁后
 * 再次调用本方法确认身份与 CSRF 未被撤销。
 */
@Injectable()
export class AdminHighRiskAuthService {
  constructor(
    private readonly sessionRepository: PostgresUserSessionRepository,
    private readonly csrfRepository: PostgresSessionCsrfTokenRepository,
    private readonly tokenService: SessionTokenService,
    private readonly userRepository: PostgresUserCredentialRepository,
  ) {}

  async verify(
    tx: TransactionContext,
    headers: HttpHeaderBag,
  ): Promise<AdminHighRiskActor> {
    return this.verifyFresh(tx, headers, true);
  }

  /**
   * 高风险只读入口：仍要求完整管理员 Session，但 GET 没有状态变更，
   * 不强制同步 CSRF。
   */
  async verifyRead(
    tx: TransactionContext,
    headers: HttpHeaderBag,
  ): Promise<AdminHighRiskActor> {
    return this.verifyFresh(tx, headers, false);
  }

  private async verifyFresh(
    tx: TransactionContext,
    headers: HttpHeaderBag,
    requireCsrf: boolean,
  ): Promise<AdminHighRiskActor> {
    const session = await this.findUnlockedSession(
      tx,
      getHeader(headers, "cookie"),
    );
    if (session === undefined) {
      throw invalidAdminSession();
    }
    if (
      requireCsrf &&
      !(await this.csrfMatches(
        tx,
        session.id,
        getHeader(headers, "x-csrf-token"),
      ))
    ) {
      throw csrfRejected();
    }

    const user = await this.userRepository.findById(tx, session.userId);
    if (user === undefined || !user.isAdmin) {
      throw notAdmin();
    }
    return {
      userId: session.userId,
      sessionId: session.id,
      authVersionAtIssue: session.authVersionAtIssue,
    };
  }

  private async findUnlockedSession(
    tx: TransactionContext,
    cookieHeader: string | undefined,
  ): Promise<ValidUserSession | undefined> {
    const sessionToken = parseCookieHeader(cookieHeader, SESSION_COOKIE_NAME);
    if (sessionToken === undefined) {
      return undefined;
    }
    const candidates = this.tokenService.hashCandidates(sessionToken);
    if (candidates.length === 0) {
      return undefined;
    }
    return this.sessionRepository.findValidUnlockedByTokenHashes(
      tx,
      candidates.map((candidate) => candidate.hash),
    );
  }

  private async csrfMatches(
    tx: TransactionContext,
    sessionId: number,
    csrfToken: string | undefined,
  ): Promise<boolean> {
    if (csrfToken === undefined || !isValidOpaqueToken(csrfToken)) {
      return false;
    }
    const candidate = this.tokenService.hash(csrfToken).hash;
    const hashes = await this.csrfRepository.findValidHashes(tx, sessionId);
    return hashes.some((hash) => constantTimeEqual(hash, candidate));
  }
}
