import { Module } from "@nestjs/common";

import { ActivityWritePort } from "./activity.write-port.js";
import { PostgresActivityWritePort } from "./postgres-activity-write-port.js";

/**
 * 横切项目动态投影维护模块。只暴露 WritePort，业务 Workflow 通过它把
 * 脱敏动态与审计、通知和搜索投影写入同一事务。
 */
@Module({
  providers: [
    {
      provide: ActivityWritePort,
      useClass: PostgresActivityWritePort,
    },
  ],
  exports: [ActivityWritePort],
})
export class ActivityProjectionModule {}
