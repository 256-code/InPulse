import { Injectable } from "@nestjs/common";

import type { TransactionContext } from "../database/transaction-context.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import {
  PREAUTH_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  type CsrfSetCookie,
  parseCookieHeader,
} from "./csrf.http.js";
import { LogoutError } from "./logout.error.js";
import { PostgresSessionCsrfTokenRepository } from "./session-csrf-token.repository.js";
import { SessionTokenService } from "./session-token.service.js";
import { constantTimeEqual, isValidOpaqueToken } from "./token.js";
import { PostgresUserSessionRepository } from "./user-session.repository.js";

export interface LogoutInput {
  readonly cookieHeader: string | undefined;
  readonly csrfToken: string | undefined;
}

export interface LogoutResult {
  readonly cookies: readonly CsrfSetCookie[];
}

/**
 * 登出纵切片（ADR-015 / ADR-023）：
 * - 没有 `__Host-session` 时只清 Cookie，不进入事务；
 * - 有效 Session 必须验证当前 CSRF Hash，成功后在同一事务条件撤销；
 * - Session 无效、已撤销或响应丢失后的重试只清 Cookie，不执行状态写。
 */
@Injectable()
export class LogoutService {
  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly sessionRepository: PostgresUserSessionRepository,
    private readonly csrfRepository: PostgresSessionCsrfTokenRepository,
    private readonly tokenService: SessionTokenService,
  ) {}

  async logout(input: LogoutInput): Promise<LogoutResult> {
    const sessionToken = parseCookieHeader(
      input.cookieHeader,
      SESSION_COOKIE_NAME,
    );
    if (sessionToken === undefined) {
      return { cookies: clearAuthCookies() };
    }

    return this.unitOfWork.run(async (tx) => {
      const candidates = this.tokenService
        .hashCandidates(sessionToken)
        .map((candidate) => candidate.hash);
      const session = await this.sessionRepository.findValidByTokenHashes(
        tx,
        candidates,
      );
      if (session === undefined) {
        return { cookies: clearAuthCookies() };
      }

      await this.verifyCsrf(tx, session.id, input.csrfToken);
      await this.sessionRepository.revoke(tx, session.id);
      return { cookies: clearAuthCookies() };
    });
  }

  private async verifyCsrf(
    tx: TransactionContext,
    sessionId: number,
    csrfToken: string | undefined,
  ): Promise<void> {
    if (csrfToken === undefined || !isValidOpaqueToken(csrfToken)) {
      throw invalidCsrf();
    }
    const storedHashes = await this.csrfRepository.findValidHashes(
      tx,
      sessionId,
    );
    const candidates = this.tokenService
      .hashCandidates(csrfToken)
      .map((candidate) => candidate.hash);
    const matched = candidates.some((candidate) =>
      storedHashes.some((stored) => constantTimeEqual(candidate, stored)),
    );
    if (!matched) {
      throw invalidCsrf();
    }
  }
}

function clearAuthCookies(): readonly CsrfSetCookie[] {
  return [
    { name: PREAUTH_COOKIE_NAME, value: null, maxAgeSeconds: 0 },
    { name: SESSION_COOKIE_NAME, value: null, maxAgeSeconds: 0 },
  ];
}

function invalidCsrf(): LogoutError {
  return new LogoutError(
    403,
    "CSRF_TOKEN_INVALID",
    "Session 的 CSRF Token 缺失、无效或已过期",
    "invalid-csrf",
  );
}
