import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { SESSION_HMAC_KEYRING } from "./auth.constants.js";
import { LoginRateLimitService } from "./auth-rate-limit.service.js";
import { PostgresAuthRateLimitRepository } from "./auth-rate-limit.repository.js";
import { CsrfController } from "./csrf.controller.js";
import { CsrfIssueService } from "./csrf-issue.service.js";
import { VersionedHmacKeyring } from "./keyring.js";
import { AuthenticatedMutationService } from "./authenticated-mutation.service.js";
import { LoginController } from "./login.controller.js";
import { LoginService } from "./login.service.js";
import { LogoutController } from "./logout.controller.js";
import { LogoutService } from "./logout.service.js";
import { MeController } from "./me.controller.js";
import { MeService } from "./me.service.js";
import { PasswordService } from "./password.service.js";
import { PostgresPreauthSessionRepository } from "./preauth-session.repository.js";
import { PostgresSessionCsrfTokenRepository } from "./session-csrf-token.repository.js";
import { PostgresSessionCleanupRepository } from "./session-cleanup.repository.js";
import { SessionCleanupService } from "./session-cleanup.service.js";
import { SessionCleanupScheduler } from "./session-cleanup.scheduler.js";
import { SessionTokenService } from "./session-token.service.js";
import { PostgresUserCredentialRepository } from "./user-credential.repository.js";
import { PostgresUserSessionRepository } from "./user-session.repository.js";
import { SessionAuthService } from "./session-auth.service.js";
import { AdminHighRiskAuthService } from "./admin-high-risk.service.js";
import { UserAuthInvalidationService } from "./user-auth-invalidation.service.js";
import { PostgresUserProfileRepository } from "./user-profile.repository.js";
import { UserDirectoryController } from "./user-directory.controller.js";
import { PostgresUserDirectoryRepository } from "./user-directory.repository.js";
import { UserDirectoryService } from "./user-directory.service.js";
import { PostgresUserReadPort, UserReadPort } from "./user-read.port.js";

/**
 * 认证/会话支柱的 Nest 模块。ADR-031 之后不再包含 TOTP、恢复码与
 * 管理员重认证：登录只保留口令因素，高风险操作只要求完整管理员 Session。
 *
 * 按保密基线，keyring 只从 `/run/secrets/*` 的
 * `SESSION_HASH_KEYRING_FILE` 加载并 fail closed；因此在生产 Secret 与
 * `SESSION_HASH_KEY_VERSION` 就绪前，本模块不挂入 `AppModule`，
 * 避免匿名健康探针启动时被未配置的 Secret 阻断。
 */
@Module({
  imports: [DatabaseModule, AuditModule, IdempotencyModule],
  providers: [
    {
      provide: SESSION_HMAC_KEYRING,
      useFactory: () => VersionedHmacKeyring.fromEnv(process.env),
    },
    SessionTokenService,
    PostgresAuthRateLimitRepository,
    LoginRateLimitService,
    PostgresPreauthSessionRepository,
    PostgresUserCredentialRepository,
    PostgresUserSessionRepository,
    PostgresSessionCsrfTokenRepository,
    PostgresSessionCleanupRepository,
    SessionCleanupService,
    SessionCleanupScheduler,
    PasswordService,
    CsrfIssueService,
    LoginService,
    LogoutService,
    MeService,
    SessionAuthService,
    AuthenticatedMutationService,
    UserAuthInvalidationService,
    PostgresUserProfileRepository,
    PostgresUserDirectoryRepository,
    UserDirectoryService,
    { provide: UserReadPort, useClass: PostgresUserReadPort },
    AdminHighRiskAuthService,
  ],
  controllers: [
    CsrfController,
    LoginController,
    LogoutController,
    MeController,
    UserDirectoryController,
  ],
  exports: [
    UserReadPort,
    SESSION_HMAC_KEYRING,
    SessionTokenService,
    PostgresAuthRateLimitRepository,
    LoginRateLimitService,
    PostgresPreauthSessionRepository,
    PostgresUserCredentialRepository,
    PostgresUserSessionRepository,
    PostgresSessionCsrfTokenRepository,
    PostgresSessionCleanupRepository,
    PasswordService,
    CsrfIssueService,
    LoginService,
    LogoutService,
    MeService,
    SessionAuthService,
    AuthenticatedMutationService,
    UserAuthInvalidationService,
    AdminHighRiskAuthService,
  ],
})
export class AuthModule {}
