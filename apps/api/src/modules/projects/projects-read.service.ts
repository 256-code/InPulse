import { Inject, Injectable } from "@nestjs/common";
import type {
  ProjectDetailResponse,
  ProjectListResponse,
} from "@inpulse/api-contract";
import type { AuthenticatedSessionActor } from "../../auth/session-auth.service.js";
import { SessionAuthService } from "../../auth/session-auth.service.js";
import {
  PROJECT_ACCESS_QUERY_PORT,
  type ProjectAccessQueryPort,
} from "./project-access.port.js";
import { ProjectQueryPort } from "./project-query.port.js";

export class ProjectReadServiceError extends Error {
  constructor(
    readonly status: 401 | 404,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProjectReadServiceError";
  }
}

@Injectable()
export class ProjectsReadService {
  constructor(
    @Inject(SessionAuthService) private readonly auth: SessionAuthService,
    @Inject(PROJECT_ACCESS_QUERY_PORT)
    private readonly access: ProjectAccessQueryPort,
    @Inject(ProjectQueryPort) private readonly projects: ProjectQueryPort,
  ) {}

  async list(cookieHeader: string | undefined): Promise<ProjectListResponse> {
    const actor = await this.requireActor(cookieHeader);
    const scope = await this.access.getAuthorizedSearchScope(actor.userId);
    return { items: [...(await this.projects.list(scope.projectIds))] };
  }

  async detail(
    cookieHeader: string | undefined,
    projectId: number,
  ): Promise<ProjectDetailResponse> {
    const actor = await this.requireActor(cookieHeader);
    const scope = await this.access.getAuthorizedSearchScope(actor.userId);
    if (!scope.projectIds.includes(projectId)) {
      throw this.notFound();
    }
    const project = await this.projects.find(projectId);
    if (project === undefined) {
      throw this.notFound();
    }
    return { project };
  }

  private async requireActor(
    cookieHeader: string | undefined,
  ): Promise<AuthenticatedSessionActor> {
    const actor = await this.auth.resolveActor(cookieHeader);
    if (actor === undefined) {
      throw new ProjectReadServiceError(
        401,
        "PROJECT_SESSION_REQUIRED",
        "需要有效认证 Session 才能读取项目",
      );
    }
    return actor;
  }

  private notFound(): ProjectReadServiceError {
    return new ProjectReadServiceError(
      404,
      "PROJECT_NOT_FOUND",
      "项目不存在或当前用户无权访问",
    );
  }
}
