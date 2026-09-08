import { Module } from "@nestjs/common";

import { AUDIT_HMAC_KEYRING } from "./audit.constants.js";
import { AuditHmacKeyring } from "./audit-keyring.js";
import { AuditWritePort } from "./audit.port.js";
import { PostgresAuditWritePort } from "./postgres-audit-write-port.js";

/**
 * F-08 审计写入基础设施。keyring 惰性加载，因此生产 Secret 未就绪前
 * 不会阻断启动；一旦真正写审计，缺失/空/越界/版本不符即 fail closed。
 */
@Module({
  providers: [
    {
      provide: AUDIT_HMAC_KEYRING,
      useFactory: () => new AuditHmacKeyring(process.env),
    },
    {
      provide: AuditWritePort,
      inject: [AUDIT_HMAC_KEYRING],
      useFactory: (keyring: AuditHmacKeyring) =>
        new PostgresAuditWritePort(keyring),
    },
  ],
  exports: [AuditWritePort],
})
export class AuditModule {}
