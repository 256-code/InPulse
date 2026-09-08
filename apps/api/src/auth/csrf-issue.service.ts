import { Injectable } from "@nestjs/common";

import { generateOpaqueToken } from "./token.js";
import type { TransactionContext } from "../database/transaction-context.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import {
  AUTH_CSRF_MAX_AGE_SECONDS,
  PREAUTH_COOKIE_NAME,
  PREAUTH_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  type CsrfRequestInput,
  type CsrfSetCookie,
  parseCookieHeader,
} from "./csrf.http.js";
import { PostgresPreauthSessionRepository } from "./preauth-session.repository.js";
import { PostgresSessionCsrfTokenRepository } from "./session-csrf-token.repository.js";
import { PostgresUserSessionRepository } from "./user-session.repository.js";
import { SessionTokenService } from "./session-token.service.js";

export interface CsrfIssueResult {
  readonly csrfToken: string;
  readonly cookies: readonly CsrfSetCookie[];
}

/**
 * 匿名/已登录 CSRF 签发纵切片：
 * - 匿名或无效 Session：创建/轮换 9 分钟匿名预认证 Session，写入 Hash；
 * - 有效认证 Session：在 Session 行锁内签发新 CSRF Hash，最多保留 4 个；
 * - Cookie 只保存会话令牌，CSRF Token 明文只在 HTTP 响应中出现。
 */
@Injectable()
export class CsrfIssueService {
  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly preauthRepository: PostgresPreauthSessionRepository,
    private readonly userSessionRepository: PostgresUserSessionRepository,
    private readonly csrfRepository: PostgresSessionCsrfTokenRepository,
    private readonly tokenService: SessionTokenService,
  ) {}

  async issue(input: CsrfRequestInput): Promise<CsrfIssueResult> {
    return this.unitOfWork.run(async (tx) => {
      const sessionToken = parseCookieHeader(
        input.cookieHeader,
        SESSION_COOKIE_NAME,
      );
      const candidates = sessionToken
        ? this.tokenService.hashCandidates(sessionToken)
        : [];
      const session = await this.userSessionRepository.findValidByTokenHashes(
        tx,
        candidates.map((candidate) => candidate.hash),
      );

      if (session !== undefined) {
        const csrfToken = generateOpaqueToken();
        const expiresAt = this.csrfExpiry(session.absoluteExpiresAt);
        await this.csrfRepository.issue(tx, {
          sessionId: session.id,
          tokenHash: this.tokenService.hash(csrfToken).hash,
          expiresAt,
        });
        return {
          csrfToken,
          cookies: [
            {
              name: PREAUTH_COOKIE_NAME,
              value: null,
              maxAgeSeconds: 0,
            },
          ],
        };
      }

      const result = await this.issuePreauth(tx);
      return {
        ...result,
        cookies:
          sessionToken === undefined
            ? result.cookies
            : [
                {
                  name: SESSION_COOKIE_NAME,
                  value: null,
                  maxAgeSeconds: 0,
                },
                ...result.cookies,
              ],
      };
    });
  }

  private async issuePreauth(tx: TransactionContext): Promise<CsrfIssueResult> {
    const material = this.tokenService.issuePreauthMaterial();
    await this.preauthRepository.create(tx, {
      tokenHash: material.sessionTokenHash,
      tokenHashKeyVersion: material.tokenHashKeyVersion,
      csrfTokenHash: material.csrfTokenHash,
      expiresAt: new Date(Date.now() + PREAUTH_MAX_AGE_SECONDS * 1000),
    });
    return {
      csrfToken: material.csrfToken,
      cookies: [
        {
          name: PREAUTH_COOKIE_NAME,
          value: material.sessionToken,
          maxAgeSeconds: PREAUTH_MAX_AGE_SECONDS,
        },
      ],
    };
  }

  private csrfExpiry(absoluteExpiresAt: Date): Date {
    const now = Date.now();
    const max = new Date(now + AUTH_CSRF_MAX_AGE_SECONDS * 1000);
    return absoluteExpiresAt.getTime() < max.getTime()
      ? absoluteExpiresAt
      : max;
  }
}
