import { Module } from "@nestjs/common";

import { NotificationWritePort } from "./notification.write-port.js";
import { PostgresNotificationWritePort } from "./postgres-notification-write-port.js";

/**
 * 横切站内通知维护模块。只暴露 WritePort，业务 Workflow 通过它在同一事务
 * 内按服务端计算出的接收方写入通知。
 */
@Module({
  providers: [
    {
      provide: NotificationWritePort,
      useClass: PostgresNotificationWritePort,
    },
  ],
  exports: [NotificationWritePort],
})
export class NotificationProjectionModule {}
