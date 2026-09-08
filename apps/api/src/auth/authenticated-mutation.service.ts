import { Injectable } from "@nestjs/common";

import type { TransactionContext } from "../database/transaction-context.js";
import { getHeader, type HttpHeaderBag } from "./csrf.http.js";
import {
  SessionAuthService,
  type AuthenticatedSessionActor,
} from "./session-auth.service.js";
import { PostgresSessionCsrfTokenRepository } from "./session-csrf-token.repository.js";
import { SessionTokenService } from "./session-token.service.js";
import { constantTimeEqual, isValidOpaqueToken } from "./token.js";

/**
 * 业务写接口的通用认证 + CSRF 校验。调用方显式传入与业务命令相同的
 * `TransactionContext`，保证身份校验与幂等、业务写入在同事务内完成。
 */
@Injectable()
export class AuthenticatedMutationService {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly csrfRepository: PostgresSessionCsrfTokenRepository,
    private readonly tokenService: SessionTokenService,
  ) {}

  async verify(
    tx: TransactionContext,
    headers: HttpHeaderBag,
  ): Promise<AuthenticatedSessionActor | undefined> {
    const cookieHeader = getHeader(headers, "cookie");
    const csrfToken = getHeader(headers, "x-csrf-token");
    const actor = await this.sessionAuth.resolveActorInTransaction(
      tx,
      cookieHeader,
    );
    if (actor === undefined || csrfToken === undefined) {
      return undefined;
    }
    if (!isValidOpaqueToken(csrfToken)) {
      return undefined;
    }
    const candidate = this.tokenService.hash(csrfToken).hash;
    const hashes = await this.csrfRepository.findValidHashes(
      tx,
      actor.sessionId,
    );
    return hashes.some((hash) => constantTimeEqual(hash, candidate))
      ? actor
      : undefined;
  }
}
