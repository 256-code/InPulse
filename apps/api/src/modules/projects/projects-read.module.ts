import { Module } from "@nestjs/common";

import { AuthModule } from "../../auth/auth.module.js";
import { DatabaseModule } from "../../database/database.module.js";
import { ProjectsReadController } from "./projects-read.controller.js";
import { ProjectsReadService } from "./projects-read.service.js";
import { ProjectsModule } from "./projects.module.js";

/** F-05.1 项目只读 HTTP 纵切片；仅在有认证 Secret 时由 AppModule 挂载。 */
@Module({
  imports: [AuthModule, DatabaseModule, ProjectsModule],
  providers: [ProjectsReadService],
  controllers: [ProjectsReadController],
})
export class ProjectsReadModule {}
