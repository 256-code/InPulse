import { Module } from "@nestjs/common";

import { AuthModule } from "../auth/auth.module.js";
import { FeaturesModule } from "../modules/features/index.js";
import { ModulesModule } from "../modules/modules/index.js";
import { ProjectsModule } from "../modules/projects/index.js";
import { ProjectWriteAccessWorkflow } from "./project-write-access.workflow.js";

/**
 * 跨域 Workflow 的 Nest 模块。
 *
 * 当前仅提供父级写前检查编排；不挂入 AppModule，等待首个业务 Workflow
 * 或 Controller 接入后再按 AppModule 的鉴权装配条件启用。
 */
@Module({
  imports: [AuthModule, ProjectsModule, ModulesModule, FeaturesModule],
  providers: [ProjectWriteAccessWorkflow],
  exports: [ProjectWriteAccessWorkflow],
})
export class WorkflowModule {}
