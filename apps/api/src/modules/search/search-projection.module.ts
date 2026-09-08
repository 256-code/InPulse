import { Module } from "@nestjs/common";

import { PostgresSearchProjectionWritePort } from "./postgres-search-projection-write-port.js";
import { SearchProjectionWritePort } from "./search-projection.write-port.js";

/**
 * 横切搜索投影维护模块。只暴露 WritePort，避免业务 Workflow 因注入
 * 搜索写能力而依赖查询 Controller、Session 或项目查询适配器。
 */
@Module({
  providers: [
    {
      provide: SearchProjectionWritePort,
      useClass: PostgresSearchProjectionWritePort,
    },
  ],
  exports: [SearchProjectionWritePort],
})
export class SearchProjectionModule {}
