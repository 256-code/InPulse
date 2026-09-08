import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { SESSION_HMAC_KEYRING } from "./auth.constants.js";
import { VersionedHmacKeyring } from "./keyring.js";
import { PostgresPreauthSessionRepository } from "./preauth-session.repository.js";
import { SessionTokenService } from "./session-token.service.js";

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
    PostgresPreauthSessionRepository,
  ],
  exports: [
    SESSION_HMAC_KEYRING,
    SessionTokenService,
    PostgresPreauthSessionRepository,
  ],
})
export class AuthModule {}
