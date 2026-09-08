import { Module } from "@nestjs/common";

import { DatabaseModule } from "../database/database.module.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import {
  IDEMPOTENCY_FINGERPRINT_KEYRING,
  IDEMPOTENCY_ROUTE_RESOLVER,
} from "./constants.js";
import { IdempotencyHttpService } from "./http-service.js";
import { IdempotencyFingerprintKeyring } from "./keyring.js";
import { resolveRegisteredRoute } from "./route.js";
import { IdempotencyRunner } from "./runner.js";
import { PostgresIdempotencyStore } from "./store.js";

/**
 * 阶段 0 幂等基础设施模块。keyring 采用惰性加载，因此当前没有
 * idempotencyRequired 路由时不会因生产 Secret 未就绪而阻断启动。
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    PostgresIdempotencyStore,
    {
      provide: IdempotencyRunner,
      useFactory: (
        unitOfWork: PostgresUnitOfWork,
        store: PostgresIdempotencyStore,
      ) => new IdempotencyRunner(unitOfWork, store),
      inject: [PostgresUnitOfWork, PostgresIdempotencyStore],
    },
    {
      provide: IDEMPOTENCY_FINGERPRINT_KEYRING,
      useFactory: () => new IdempotencyFingerprintKeyring(process.env),
    },
    {
      provide: IDEMPOTENCY_ROUTE_RESOLVER,
      useValue: resolveRegisteredRoute,
    },
    IdempotencyHttpService,
  ],
  exports: [IdempotencyRunner, IdempotencyHttpService],
})
export class IdempotencyModule {}
