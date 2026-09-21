import { Inject, Injectable } from "@nestjs/common";
import { SessionAuthService } from "../../auth/session-auth.service.js";
import { PostgresUnitOfWork } from "../../database/unit-of-work.js";
import { ApiHttpError } from "../../http/contract-errors.js";
import { ProjectMembersQueryPort } from "./project-members-query.port.js";
@Injectable()
export class ActiveMembersService {
  constructor(
    @Inject(SessionAuthService) private readonly auth: SessionAuthService,
    @Inject(PostgresUnitOfWork) private readonly uow: PostgresUnitOfWork,
    @Inject(ProjectMembersQueryPort)
    private readonly members: ProjectMembersQueryPort,
  ) {}
  list(cookie: string | undefined, projectId: number) {
    return this.uow.run(async (tx) => {
      const actor = await this.auth.resolveActorInTransaction(tx, cookie);
      if (!actor)
        throw new ApiHttpError(401, "PROJECT_SESSION_REQUIRED", "请先登录");
      const items = await this.members.listActiveMemberProfiles(tx, {
        actorUserId: actor.userId,
        projectId,
      });
      if (!items)
        throw new ApiHttpError(
          404,
          "PROJECT_NOT_FOUND",
          "项目不存在或无法访问",
        );
      return { items };
    });
  }
}
