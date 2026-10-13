import { Module } from "@nestjs/common";

import type { DatabaseClient } from "@inpulse/database/client";
import { AuthModule } from "../../auth/auth.module.js";
import { DATABASE_CLIENT } from "../../database/database.constants.js";
import { DatabaseModule } from "../../database/database.module.js";
import { IdempotencyModule } from "../../idempotency/idempotency.module.js";
import { WecomBindingController } from "./wecom-binding.controller.js";
import { WecomBindingStateService } from "./wecom-binding.service.js";

@Module({
  imports: [AuthModule, DatabaseModule, IdempotencyModule],
  providers: [
    {
      provide: WecomBindingStateService,
      useFactory: (client: DatabaseClient) =>
        new WecomBindingStateService(client.sql),
      inject: [DATABASE_CLIENT],
    },
  ],
  controllers: [WecomBindingController],
})
export class WecomBindingModule {}
