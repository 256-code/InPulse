import { AUTH_CSRF_MAX_AGE_SECONDS } from "./csrf.http.js";
import type { SessionTokenService } from "./session-token.service.js";
import type { SessionCsrfTokenRepository } from "./session-csrf-token.repository.js";
import type {
  UserSessionInsert,
  UserSessionRepository,
} from "./user-session.repository.js";
import { generateOpaqueToken } from "./token.js";
import type { TransactionContext } from "../database/transaction-context.js";

export interface AuthenticatedSessionIssueInput {
  readonly userId: number;
  readonly authVersion: number;
  readonly idleMaxAgeSeconds: number;
  readonly absoluteMaxAgeSeconds: number;
}

export interface IssuedAuthenticatedSession {
  readonly sessionToken: string;
  readonly csrfToken: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export interface AuthenticatedSessionIssueDependencies {
  readonly sessions: Pick<UserSessionRepository, "create">;
  readonly csrfTokens: Pick<SessionCsrfTokenRepository, "issue">;
  readonly tokens: Pick<SessionTokenService, "hash">;
}

/**
 * ADR-032：签发完整认证会话的共享实现。口令登录与 SSO 回调必须走同一路径，
 * 保证两种入口的会话同构：同一 `user_sessions` 机制、显式
 * `auth_state=AUTHENTICATED`、同一 CSRF 轮换与过期规则，避免安全语义漂移。
 */
export async function issueAuthenticatedSession(
  tx: TransactionContext,
  dependencies: AuthenticatedSessionIssueDependencies,
  input: AuthenticatedSessionIssueInput,
): Promise<IssuedAuthenticatedSession> {
  const sessionToken = generateOpaqueToken();
  const csrfToken = generateOpaqueToken();
  const sessionHash = dependencies.tokens.hash(sessionToken);
  const csrfHash = dependencies.tokens.hash(csrfToken);
  const now = Date.now();
  const absoluteExpiresAt = new Date(now + input.absoluteMaxAgeSeconds * 1000);
  const idleExpiresAt = new Date(now + input.idleMaxAgeSeconds * 1000);

  const created = await dependencies.sessions.create(tx, {
    userId: input.userId,
    tokenHash: sessionHash.hash,
    tokenHashKeyVersion: sessionHash.keyVersion,
    authVersionAtIssue: input.authVersion,
    authState: "AUTHENTICATED",
    idleExpiresAt,
    absoluteExpiresAt,
  } satisfies UserSessionInsert);
  await dependencies.csrfTokens.issue(tx, {
    sessionId: created.id,
    tokenHash: csrfHash.hash,
    expiresAt: new Date(
      Math.min(
        now + AUTH_CSRF_MAX_AGE_SECONDS * 1000,
        absoluteExpiresAt.getTime(),
      ),
    ),
  });

  return { sessionToken, csrfToken, idleExpiresAt, absoluteExpiresAt };
}
