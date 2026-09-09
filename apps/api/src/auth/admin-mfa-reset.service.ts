import { Inject, Injectable } from "@nestjs/common";

import { AuditWritePort } from "../audit/audit.port.js";
import type { TransactionContext } from "../database/transaction-context.js";
import { AdminHighRiskAuthService } from "./admin-high-risk.service.js";
import {
  factorConflict,
  invalidAdminSession,
  lastAdmin,
  notAdmin as resetNotAdmin,
  selfReset,
  targetNotFound,
  targetNotActive,
} from "./admin-mfa-reset.error.js";
import type { HttpHeaderBag } from "./csrf.http.js";
import { PostgresMfaRecoveryCodeRepository } from "./mfa-recovery-code.repository.js";
import { PostgresUserCredentialRepository } from "./user-credential.repository.js";
import { PostgresUserSessionRepository } from "./user-session.repository.js";
import { PostgresUserTotpFactorRepository } from "./user-totp-factor.repository.js";
import { UserAuthInvalidationService } from "./user-auth-invalidation.service.js";

export interface AdminMfaResetInput {
  readonly userId: number;
  readonly reason: string;
  readonly requestId: string;
  readonly headers: HttpHeaderBag;
  readonly ipAddress?: string | null;
}

/**
 * F-02.5 管理员 MFA 在线重置：
 * - 必须由另一名系统管理员执行，且其 Session 刚完成密码 + 当前 TOTP 重认证；
 * - 目标必须为 ACTIVE 且已启用 TOTP 的系统管理员；
 * - 用户级可用 MFA 管理员只剩一名时拒绝在线重置，强制双人离线恢复；
 * - 与目标 user → factor → current Session 锁序和同一事务内完成因子禁用、
 *   恢复码失效、auth_version 递增、全 Session 撤销与 SYSTEM 审计写入。
 */
@Injectable()
export class AdminMfaResetService {
  constructor(
    private readonly userRepository: PostgresUserCredentialRepository,
    private readonly factorRepository: PostgresUserTotpFactorRepository,
    private readonly recoveryRepository: PostgresMfaRecoveryCodeRepository,
    private readonly sessionRepository: PostgresUserSessionRepository,
    private readonly highRisk: AdminHighRiskAuthService,
    private readonly authInvalidation: UserAuthInvalidationService,
    @Inject(AuditWritePort) private readonly audit: AuditWritePort,
  ) {}

  async execute(
    tx: TransactionContext,
    actorId: number,
    input: AdminMfaResetInput,
  ): Promise<void> {
    const actor = await this.highRisk.verify(tx, input.headers);
    if (actor.userId !== actorId) {
      throw invalidAdminSession();
    }
    const count = await this.countActiveMfaAdmins(tx);
    if (count <= 1) {
      throw lastAdmin();
    }

    const target = await this.userRepository.lockForMfaReset(tx, input.userId);
    if (target === undefined) {
      throw targetNotFound();
    }
    if (!target.isAdmin) {
      throw resetNotAdmin();
    }
    if (
      target.status !== "ACTIVE" ||
      target.disabledAt !== null ||
      target.id === actor.userId
    ) {
      if (target.id === actor.userId) {
        throw selfReset();
      }
      throw targetNotActive();
    }

    const factor = await this.factorRepository.findForUpdate(tx, target.id);
    if (factor === undefined || factor.status !== "ACTIVE") {
      throw factorConflict();
    }

    const actorSession = await this.sessionRepository.lockById(
      tx,
      actor.sessionId,
    );
    if (actorSession === undefined) {
      throw invalidAdminSession();
    }
    await this.highRisk.verify(tx, input.headers);

    const disabled = await this.factorRepository.disable(tx, target.id);
    if (!disabled) {
      throw factorConflict();
    }
    await this.recoveryRepository.invalidateAllUnused(tx, target.id);
    await this.authInvalidation.invalidateUserSessionsInTransaction(
      tx,
      target.id,
    );
    await this.audit.append(tx, {
      projectId: null,
      actorType: "USER",
      actorId: actor.userId,
      action: "admin.mfa.reset",
      targetType: "USER",
      targetId: String(target.id),
      eventPayload: { reason: input.reason },
      requestId: input.requestId,
      ipAddress: input.ipAddress ?? null,
    });
  }

  private async countActiveMfaAdmins(tx: TransactionContext): Promise<number> {
    const rows = (await tx.sql`
      SELECT u.id AS "userId"
        FROM app.users AS u
        JOIN app.user_totp_factors AS f
          ON f.user_id = u.id
         AND f.status = 'ACTIVE'
       WHERE u.is_admin = true
         AND u.status = 'ACTIVE'
         AND u.disabled_at IS NULL
       ORDER BY u.id
       FOR UPDATE OF u
    `) as unknown as readonly { userId: number }[];
    return rows.length;
  }
}
