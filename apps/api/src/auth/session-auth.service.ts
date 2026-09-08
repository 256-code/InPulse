import { Injectable } from "@nestjs/common";

import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import { SESSION_COOKIE_NAME, parseCookieHeader } from "./csrf.http.js";
import { SessionTokenService } from "./session-token.service.js";
import { PostgresUserSessionRepository } from "./user-session.repository.js";

export interface AuthenticatedSessionActor {
  readonly sessionId: number;
  readonly userId: number;
  readonly authState: "AUTHENTICATED";
  readonly authVersionAtIssue: number;
}

/**
 * 从 `__Host-session` Cookie 解析当前认证用户的通用身份服务。
 *
 * 只接受 `AUTHENTICATED` Session；匿名、无效、停用、过期、撤销以及
 * MFA/恢复码受限状态统一返回 undefined，由 Controller 按 401 处理。
 */
@Injectable()
export class SessionAuthService {
  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly sessionRepository: PostgresUserSessionRepository,
    private readonly tokenService: SessionTokenService,
  ) {}

  async resolveActor(
    cookieHeader: string | undefined,
  ): Promise<AuthenticatedSessionActor | undefined> {
    const sessionToken = parseCookieHeader(cookieHeader, SESSION_COOKIE_NAME);
    if (sessionToken === undefined) {
      return undefined;
    }

    const candidates = this.tokenService.hashCandidates(sessionToken);
    if (candidates.length === 0) {
      return undefined;
    }

    return this.unitOfWork.run(async (tx) => {
      const session = await this.sessionRepository.findValidByTokenHashes(
        tx,
        candidates.map((candidate) => candidate.hash),
      );
      if (session === undefined || session.authState !== "AUTHENTICATED") {
        return undefined;
      }
      return {
        sessionId: session.id,
        userId: session.userId,
        authState: session.authState,
        authVersionAtIssue: session.authVersionAtIssue,
      };
    });
  }
}
