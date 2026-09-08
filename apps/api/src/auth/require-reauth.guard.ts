import type { CanActivate, ExecutionContext } from "@nestjs/common";
import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

import type { TransactionContext } from "../database/transaction-context.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import { getHeader, type HttpHeaderBag } from "./csrf.http.js";
import { SessionAuthService } from "./session-auth.service.js";

/** 高风险操作要求密码 + 当前 TOTP 双重认证在 5 分钟内完成。 */
export const REAUTH_WINDOW_MS = 5 * 60 * 1000;

interface RequireReauthRequest {
  readonly headers: HttpHeaderBag;
}

interface ReauthMetaRow {
  readonly isAdmin: boolean;
  readonly reauthenticatedAt: Date | null;
  readonly mfaVerifiedAt: Date | null;
}

/**
 * 管理员高风险操作 Guard（F-07.3）：校验当前 Session 有效且为系统管理员，
 * 且其 `reauthenticated_at` 与 `mfa_verified_at` 均在 5 分钟内。
 * 未登录/会话失效按未认证处理；已登录但非管理员或重认证过期按 403 处理。
 *
 * 同一个事务内先 `resolveActorInTransaction` 解析身份，再读取重认证元数据，
 * 避免为一次认证检查开启两个独立 `UnitOfWork`。
 */
@Injectable()
export class RequireReauthGuard implements CanActivate {
  constructor(
    private readonly sessionAuth: SessionAuthService,
    private readonly unitOfWork: PostgresUnitOfWork,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequireReauthRequest>();
    const cookie = getHeader(request.headers, "cookie");
    const row = await this.unitOfWork.run(async (tx) => {
      const actor = await this.sessionAuth.resolveActorInTransaction(
        tx,
        cookie,
      );
      if (actor === undefined) {
        return undefined;
      }
      return (await this.readReauthMeta(tx, actor.sessionId))[0];
    });
    if (row === undefined) {
      throw new UnauthorizedException(
        "需要有效认证 Session 才能执行该高风险操作",
      );
    }
    if (!this.isReauthedAdmin(row)) {
      throw new ForbiddenException(
        "需要最近 5 分钟内完成密码与当前 TOTP 双重认证",
      );
    }
    return true;
  }

  private readReauthMeta(
    tx: TransactionContext,
    sessionId: number,
  ): Promise<readonly ReauthMetaRow[]> {
    return tx.sql`
        SELECT u.is_admin AS "isAdmin",
               us.reauthenticated_at AS "reauthenticatedAt",
               us.mfa_verified_at AS "mfaVerifiedAt"
          FROM app.user_sessions AS us
          JOIN app.users AS u ON u.id = us.user_id
         WHERE us.id = ${sessionId}
           AND us.revoked_at IS NULL
           AND us.idle_expires_at > now()
           AND us.absolute_expires_at > now()
           AND u.status = 'ACTIVE'
           AND u.disabled_at IS NULL
      ` as unknown as Promise<readonly ReauthMetaRow[]>;
  }

  private isReauthedAdmin(row: ReauthMetaRow): boolean {
    if (!row.isAdmin) {
      return false;
    }
    if (row.reauthenticatedAt === null || row.mfaVerifiedAt === null) {
      return false;
    }
    const now = Date.now();
    return (
      now - row.reauthenticatedAt.getTime() <= REAUTH_WINDOW_MS &&
      now - row.mfaVerifiedAt.getTime() <= REAUTH_WINDOW_MS
    );
  }
}
