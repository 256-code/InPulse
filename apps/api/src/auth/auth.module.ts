import { Module } from "@nestjs/common";

import { AuditModule } from "../audit/audit.module.js";
import { DatabaseModule } from "../database/database.module.js";
import { IdempotencyModule } from "../idempotency/idempotency.module.js";
import { SESSION_HMAC_KEYRING, TOTP_KEK_KEYRING } from "./auth.constants.js";
import { LoginRateLimitService } from "./auth-rate-limit.service.js";
import { PostgresAuthRateLimitRepository } from "./auth-rate-limit.repository.js";
import { CsrfController } from "./csrf.controller.js";
import { CsrfIssueService } from "./csrf-issue.service.js";
import { VersionedHmacKeyring } from "./keyring.js";
import { AuthenticatedMutationService } from "./authenticated-mutation.service.js";
import { MfaRateLimitService } from "./mfa-rate-limit.service.js";
import { MfaReauthenticateController } from "./mfa-reauthenticate.controller.js";
import { MfaReauthenticateService } from "./mfa-reauthenticate.service.js";
import { LoginController } from "./login.controller.js";
import { LoginService } from "./login.service.js";
import { LogoutController } from "./logout.controller.js";
import { LogoutService } from "./logout.service.js";
import { MfaEnrollmentController } from "./mfa-enrollment.controller.js";
import { MfaEnrollmentService } from "./mfa-enrollment.service.js";
import { PostgresMfaRecoveryCodeRepository } from "./mfa-recovery-code.repository.js";
import { MfaVerifyController } from "./mfa-verify.controller.js";
import { MfaVerifyService } from "./mfa-verify.service.js";
import { MeController } from "./me.controller.js";
import { MeService } from "./me.service.js";
import { PasswordService } from "./password.service.js";
import { RecoveryCodeService } from "./recovery-code.service.js";
import { PostgresPreauthSessionRepository } from "./preauth-session.repository.js";
import { PostgresSessionCsrfTokenRepository } from "./session-csrf-token.repository.js";
import { SessionTokenService } from "./session-token.service.js";
import { PostgresUserCredentialRepository } from "./user-credential.repository.js";
import { PostgresUserSessionRepository } from "./user-session.repository.js";
import { PostgresUserTotpFactorRepository } from "./user-totp-factor.repository.js";
import { RequireReauthGuard } from "./require-reauth.guard.js";
import { SessionAuthService } from "./session-auth.service.js";
import { TotpService } from "./totp.service.js";
import { VersionedAeadKeyring } from "./totp-keyring.js";
import { UserAuthInvalidationService } from "./user-auth-invalidation.service.js";
import { PostgresUserProfileRepository } from "./user-profile.repository.js";
import { AdminHighRiskAuthService } from "./admin-high-risk.service.js";
import { AdminMfaResetController } from "./admin-mfa-reset.controller.js";
import { AdminMfaResetService } from "./admin-mfa-reset.service.js";
import { MfaRecoveryController } from "./mfa-recovery.controller.js";
import { MfaRecoveryService } from "./mfa-recovery.service.js";

/**
 * 认证/会话支柱的 Nest 模块。
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
    {
      provide: TOTP_KEK_KEYRING,
      useFactory: () => VersionedAeadKeyring.fromEnv(process.env),
    },
    SessionTokenService,
    TotpService,
    RecoveryCodeService,
    PostgresMfaRecoveryCodeRepository,
    PostgresAuthRateLimitRepository,
    LoginRateLimitService,
    MfaRateLimitService,
    PostgresPreauthSessionRepository,
    PostgresUserCredentialRepository,
    PostgresUserSessionRepository,
    PostgresUserTotpFactorRepository,
    PostgresSessionCsrfTokenRepository,
    PasswordService,
    CsrfIssueService,
    LoginService,
    LogoutService,
    MeService,
    SessionAuthService,
    AuthenticatedMutationService,
    RequireReauthGuard,
    UserAuthInvalidationService,
    MfaEnrollmentService,
    MfaVerifyService,
    MfaReauthenticateService,
    PostgresUserProfileRepository,
    AdminHighRiskAuthService,
    MfaRecoveryService,
    AdminMfaResetService,
  ],
  controllers: [
    CsrfController,
    LoginController,
    LogoutController,
    MeController,
    MfaEnrollmentController,
    MfaVerifyController,
    MfaReauthenticateController,
    MfaRecoveryController,
    AdminMfaResetController,
  ],
  exports: [
    SESSION_HMAC_KEYRING,
    TOTP_KEK_KEYRING,
    SessionTokenService,
    TotpService,
    RecoveryCodeService,
    PostgresMfaRecoveryCodeRepository,
    PostgresAuthRateLimitRepository,
    LoginRateLimitService,
    MfaRateLimitService,
    PostgresPreauthSessionRepository,
    PostgresUserCredentialRepository,
    PostgresUserSessionRepository,
    PostgresUserTotpFactorRepository,
    PostgresSessionCsrfTokenRepository,
    PasswordService,
    CsrfIssueService,
    LoginService,
    LogoutService,
    MeService,
    SessionAuthService,
    AuthenticatedMutationService,
    RequireReauthGuard,
    UserAuthInvalidationService,
    MfaEnrollmentService,
    MfaVerifyService,
    MfaReauthenticateService,
    AdminHighRiskAuthService,
    MfaRecoveryService,
    AdminMfaResetService,
  ],
})
export class AuthModule {}
