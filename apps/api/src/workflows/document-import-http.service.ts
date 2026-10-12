import { randomUUID } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import {
  projectDocumentImportPreviewResponseSchema,
  projectDocumentImportReplayContextSchema,
  projectDocumentImportResultSchema,
  type ProjectDocumentImportPreviewRequest,
  type ProjectDocumentImportPreviewResponse,
  type ProjectDocumentImportReplayContext,
  type ProjectDocumentImportRequest,
  type ProjectDocumentImportResult,
} from "@inpulse/api-contract";

import { AuthenticatedMutationService } from "../auth/authenticated-mutation.service.js";
import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "../auth/csrf.http.js";
import { SessionAuthService } from "../auth/session-auth.service.js";
import type { TransactionContext } from "../database/transaction-context.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import { ApiHttpError } from "../http/contract-errors.js";
import {
  IdempotencyHttpError,
  IdempotencyHttpService,
} from "../idempotency/http-service.js";
import { FeatureManagementError } from "../modules/features/features-management.service.js";
import { ModuleManagementError } from "../modules/modules/modules-management.service.js";
import {
  ProjectBootstrapConflictError,
  ProjectBootstrapValidationError,
  ProjectCodeConflictError,
} from "../modules/projects/project-bootstrap.workflow.js";
import { SearchProjectionCapacityError } from "../modules/search/public/search-projection-errors.js";
import { TaskManagementError } from "../modules/tasks/tasks-management.service.js";
import {
  DocumentImportError,
  DocumentImportWorkflow,
} from "./document-import.workflow.js";

const DOCUMENT_IMPORT_SESSION_REQUIRED = "DOCUMENT_IMPORT_SESSION_REQUIRED";
/**
 * ADR-064 文档导入 HTTP 编排：预览为纯校验读路径（只验证身份，不写任何
 * 持久化状态），执行为数据库级幂等写命令。预览与执行共用同一份计划阶段，
 * 摘要不一致 409；计划含 ERROR 时 422 并携带行级问题；同一文档已导入过
 * 时 409，绝不产生部分写入。
 */
@Injectable()
export class DocumentImportHttpService {
  constructor(
    @Inject(AuthenticatedMutationService)
    private readonly auth: AuthenticatedMutationService,
    @Inject(SessionAuthService)
    private readonly sessions: SessionAuthService,
    @Inject(PostgresUnitOfWork)
    private readonly uow: PostgresUnitOfWork,
    @Inject(IdempotencyHttpService)
    private readonly idempotency: IdempotencyHttpService,
    @Inject(DocumentImportWorkflow)
    private readonly workflow: DocumentImportWorkflow,
  ) {}

  /** 项目内导入预览：仅已登录且拥有项目写权限的用户。 */
  previewInProject(
    headers: HttpHeaderBag,
    projectId: number,
    input: ProjectDocumentImportPreviewRequest,
  ): Promise<ProjectDocumentImportPreviewResponse> {
    return this.preview(headers, (tx, actorId) =>
      this.workflow.previewInProject(tx, actorId, projectId, input.document),
    );
  }

  /** 整项目导入预览：任意已登录用户，校验编码、成员与全部下级计划。 */
  previewNewProject(
    headers: HttpHeaderBag,
    input: ProjectDocumentImportPreviewRequest,
  ): Promise<ProjectDocumentImportPreviewResponse> {
    return this.preview(headers, (tx, actorId) =>
      this.workflow.previewNewProject(tx, actorId, input.document),
    );
  }
  /** 项目内导入执行：项目锁内重新计划，单事务创建，整笔幂等。 */
  executeInProject(
    headers: HttpHeaderBag,
    projectId: number,
    input: ProjectDocumentImportRequest,
  ): Promise<ProjectDocumentImportResult> {
    return this.execute({
      headers,
      operationId: "importProjectDocument",
      path: "/projects/{projectId}/document-imports",
      pathParams: { projectId: String(projectId) },
      body: input,
      run: (tx, actorId) =>
        this.workflow.executeInProject(
          tx,
          actorId,
          projectId,
          input.document,
          input.expectedDigest,
          randomUUID(),
        ),
    });
  }

  /** 整项目导入执行：单事务创建项目、成员、模块、功能与任务，整笔幂等。 */
  executeNewProject(
    headers: HttpHeaderBag,
    input: ProjectDocumentImportRequest,
  ): Promise<ProjectDocumentImportResult> {
    return this.execute({
      headers,
      operationId: "importProject",
      path: "/project-imports",
      pathParams: {},
      body: input,
      run: (tx, actorId) =>
        this.workflow.executeNewProject(
          tx,
          actorId,
          input.document,
          input.expectedDigest,
          randomUUID(),
        ),
    });
  }

  private async preview(
    headers: HttpHeaderBag,
    handler: (
      tx: TransactionContext,
      actorId: number,
    ) => Promise<ProjectDocumentImportPreviewResponse>,
  ): Promise<ProjectDocumentImportPreviewResponse> {
    try {
      const body = await this.uow.run(async (tx) => {
        const actor = await this.sessions.resolveActorInTransaction(
          tx,
          getHeader(headers, "cookie"),
        );
        if (actor === undefined) {
          throw new ApiHttpError(
            401,
            DOCUMENT_IMPORT_SESSION_REQUIRED,
            "登录状态已失效，请重新登录",
          );
        }
        return handler(tx, actor.userId);
      });
      return projectDocumentImportPreviewResponseSchema.parse(body);
    } catch (error) {
      throw mapDocumentImportError(error);
    }
  }
  private async execute(input: {
    readonly headers: HttpHeaderBag;
    readonly operationId: "importProjectDocument" | "importProject";
    readonly path: string;
    readonly pathParams: Readonly<Record<string, string>>;
    readonly body: ProjectDocumentImportRequest;
    readonly run: (
      tx: TransactionContext,
      actorId: number,
    ) => Promise<ProjectDocumentImportResult>;
  }): Promise<ProjectDocumentImportResult> {
    if (mutationSameOriginValidationError(input.headers)) {
      throw new ApiHttpError(
        403,
        "CSRF_ORIGIN_REJECTED",
        "请求未通过同源安全校验",
      );
    }
    const resolve = async (tx: TransactionContext) => {
      const actor = await this.auth.verify(tx, input.headers);
      if (actor === undefined) {
        throw new ApiHttpError(
          401,
          DOCUMENT_IMPORT_SESSION_REQUIRED,
          "登录或 CSRF 状态已失效",
        );
      }
      return actor.userId;
    };
    try {
      const result = await this.idempotency.run({
        operationId: input.operationId,
        actorId: resolve,
        request: {
          method: "POST",
          path: input.path,
          pathParams: input.pathParams,
          query: {},
          headers: input.headers,
          body: input.body,
        },
        execute: async (tx, actorId) => {
          const body = await input.run(tx, actorId);
          return {
            responseStatus: 200,
            responseSchemaRef: "ProjectDocumentImportResult",
            responseHasBody: true,
            responseBody: body,
            replayAuthContext: replayContextOf(body),
          };
        },
        replayAuthorizer: async (record, tx) => {
          const actorId = await resolve(tx);
          await this.workflow.replay(
            tx,
            actorId,
            projectDocumentImportReplayContextSchema.parse(
              record.replayAuthContext,
            ),
          );
        },
      });
      return projectDocumentImportResultSchema.parse(result.responseBody);
    } catch (error) {
      throw mapDocumentImportError(error);
    }
  }
}
function replayContextOf(
  result: ProjectDocumentImportResult,
): ProjectDocumentImportReplayContext {
  return {
    projectId: result.projectId,
    moduleIds: result.modules.map((item) => item.id),
    featureIds: result.features.map((item) => item.id),
    taskIds: result.tasks.map((item) => item.id),
  };
}

/** 业务错误统一映射为稳定 HTTP 错误体；未知错误保持原样由全局 Filter 处理。 */
function mapDocumentImportError(error: unknown): unknown {
  if (error instanceof ApiHttpError) {
    return error;
  }
  if (error instanceof DocumentImportError) {
    return new ApiHttpError(
      error.status,
      error.code,
      error.message,
      error.details,
    );
  }
  if (
    error instanceof IdempotencyHttpError ||
    error instanceof ProjectCodeConflictError ||
    error instanceof ProjectBootstrapValidationError ||
    error instanceof ProjectBootstrapConflictError ||
    error instanceof ModuleManagementError ||
    error instanceof FeatureManagementError ||
    error instanceof TaskManagementError ||
    error instanceof SearchProjectionCapacityError
  ) {
    return new ApiHttpError(error.status, error.code, error.message);
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  ) {
    return new ApiHttpError(
      409,
      "DOCUMENT_IMPORT_CONFLICT",
      "文档与现有数据冲突，请重新预览后重试",
    );
  }
  return error;
}
