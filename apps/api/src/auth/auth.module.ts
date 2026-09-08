import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
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
import { SessionTokenService } from "./session-token.service.js";
import { PostgresUserCredentialRepository } from "./user-credential.repository.js";
import { PostgresUserSessionRepository } from "./user-session.repository.js";
import { PostgresUserTotpFactorRepository } from "./user-totp-factor.repository.js";
import { RequireReauthGuard } from "./require-reauth.guard.js";
import { SessionAuthService } from "./session-auth.service.js";
import { UserAuthInvalidationService } from "./user-auth-invalidation.service.js";
import { PostgresUserProfileRepository } from "./user-profile.repository.js";

/**
 * 认证/会话支柱的 Nest 模块。
 *
 * 按保密基线，keyring 只从 `/run/secrets/*` 的
 * `SESSION_HASH_KEYRING_FILE` 加载并 fail closed；因此在生产 Secret 与
 * `SESSION_HASH_KEY_VERSION` 就绪前，本模块不挂入 `AppModule`，
 * 避免匿名健康探针启动时被未配置的 Secret 阻断。
 */
@Module({
  imports: [DatabaseModule],
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
    PostgresUserProfileRepository,
  ],
  controllers: [
    CsrfController,
    LoginController,
    LogoutController,
    MeController,
  ],
  exports: [
    SESSION_HMAC_KEYRING,
    SessionTokenService,
    PostgresAuthRateLimitRepository,
    LoginRateLimitService,
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
  ],
})
export class AuthModule {}
