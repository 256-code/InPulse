import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  routeRegistry,
  schemaRegistry,
  type OrganizationAssignRequest,
  type OrganizationCreateRequest,
  type OrganizationItem,
  type OrganizationUpdateRequest,
} from "@inpulse/api-contract";

import { AdminHighRiskAuthService } from "../auth/admin-high-risk.service.js";
import { AdminHighRiskError } from "../auth/admin-high-risk.error.js";
import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "../auth/csrf.http.js";
import type { TransactionContext } from "../database/transaction-context.js";
import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import {
  IdempotencyHttpError,
  IdempotencyHttpService,
} from "../idempotency/http-service.js";
import { OrganizationError } from "./organization.error.js";
import {
  normalizeOrganizationUserIds,
  OrganizationService,
} from "./organization.service.js";

export type OrganizationOperation =
  | "listOrganizations"
  | "createOrganization"
  | "updateOrganization"
  | "deleteOrganization"
  | "assignUsersOrganization";

export interface OrganizationsHttpRequest {
  readonly headers: HttpHeaderBag;
  readonly params: unknown;
  readonly query: unknown;
  readonly body?: unknown;
}

class OrganizationsHttpError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 422,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "OrganizationsHttpError";
  }
}

class OrganizationsInputError extends Error {
  constructor(readonly fields: Readonly<Record<string, string>>) {
    super("invalid organization input");
    this.name = "OrganizationsInputError";
  }
}

/**
 * ADR-081 组织管理 HTTP 编排：读路径独立事务，写路径由幂等 runner 持有
 * 单事务；管理员身份与 CSRF 由 AdminHighRiskAuthService 在同一事务内校验。
 */
@Injectable()
export class OrganizationsHttpService {
  constructor(
    @Inject(PostgresUnitOfWork) private readonly uow: PostgresUnitOfWork,
    @Inject(AdminHighRiskAuthService)
    private readonly highRisk: AdminHighRiskAuthService,
    @Inject(OrganizationService)
    private readonly organizations: OrganizationService,
    @Inject(IdempotencyHttpService)
    private readonly idempotency: IdempotencyHttpService,
  ) {}

  async handle(
    operation: OrganizationOperation,
    request: OrganizationsHttpRequest,
  ): Promise<{ readonly status: number; readonly body: unknown }> {
    const requestId = randomUUID();
    try {
      const route = routeRegistry.find(
        (entry) => entry.operationId === operation,
      )!;
      const write = operation !== "listOrganizations";
      if (
        write &&
        mutationSameOriginValidationError(request.headers) !== undefined
      ) {
        throw new OrganizationsHttpError(
          403,
          "CSRF_ORIGIN_REJECTED",
          "请求未通过同源安全校验",
        );
      }
      if (Object.keys((request.query ?? {}) as object).length) {
        throw new OrganizationsInputError({
          query: "此接口不接受查询参数",
        });
      }
      const parsedPath = this.parseRouteValue(
        route.request.path,
        request.params,
      );
      const path = parsedPath as { readonly organizationId?: number };
      if (!write) {
        const items = await this.uow.run((tx) =>
          this.organizations.list(tx, request.headers),
        );
        return {
          status: 200,
          body: schemaRegistry.OrganizationListResponse.schema.parse({ items }),
        };
      }

      this.parseRouteValue(
        route.request.headers,
        this.headersFor(operation, request.headers),
      );
      const body = this.parseWriteBody(operation, route, request);
      const version = this.versionOf(operation, request.headers);
      const execute = async (tx: TransactionContext, actorId: number) => {
        const meta = {
          actorId,
          headers: request.headers,
          requestId,
        };
        if (operation === "createOrganization") {
          const created = await this.organizations.create(
            tx,
            meta,
            body as OrganizationCreateRequest,
          );
          return organizationResult(created, actorId);
        }
        const organizationId = path.organizationId!;
        if (operation === "updateOrganization") {
          const updated = await this.organizations.update(
            tx,
            meta,
            organizationId,
            body as OrganizationUpdateRequest,
            version!,
          );
          return organizationResult(updated, actorId);
        }
        if (operation === "deleteOrganization") {
          await this.organizations.delete(tx, meta, organizationId, version!);
          return deleteResult(actorId, organizationId);
        }
        const assign = body as OrganizationAssignRequest;
        const updatedCount = await this.organizations.assignUsers(
          tx,
          meta,
          assign,
        );
        return assignResult(
          updatedCount,
          actorId,
          assign.organizationId,
          normalizeOrganizationUserIds(assign.userIds),
        );
      };
      const result = await this.idempotency.run({
        operationId: operation,
        actorId: (tx) => this.resolveWriteActor(tx, request.headers),
        request: {
          method: route.method,
          path: route.path,
          pathParams: toPathParams(path),
          query: {},
          headers: request.headers,
          body: "noBody" in route.request.body ? null : body,
        },
        execute,
      });
      return {
        status: result.responseStatus,
        body: result.responseSchemaRef
          ? schemaRegistry[
              result.responseSchemaRef as keyof typeof schemaRegistry
            ].schema.parse(result.responseBody)
          : undefined,
      };
    } catch (error) {
      return this.mapError(error, requestId);
    }
  }

  private async resolveWriteActor(
    tx: TransactionContext,
    headers: HttpHeaderBag,
  ): Promise<number> {
    const verified = await this.highRisk.verify(tx, headers);
    return verified.userId;
  }

  private parseRouteValue(
    ref: keyof typeof schemaRegistry | "none",
    value: unknown,
  ): unknown {
    if (ref === "none") return {};
    const parsed = schemaRegistry[ref].schema.safeParse(value);
    if (!parsed.success) {
      throw new OrganizationsInputError(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            issue.path.join("."),
            issue.message,
          ]),
        ),
      );
    }
    return parsed.data;
  }

  private headersFor(
    operation: OrganizationOperation,
    headers: HttpHeaderBag,
  ): Readonly<Record<string, string | undefined>> {
    const requiresVersion =
      operation === "updateOrganization" || operation === "deleteOrganization";
    return {
      "x-csrf-token": getHeader(headers, "x-csrf-token"),
      ...(requiresVersion
        ? { "if-match": getHeader(headers, "if-match") }
        : {}),
    };
  }

  private parseWriteBody(
    operation: OrganizationOperation,
    route: (typeof routeRegistry)[number],
    request: OrganizationsHttpRequest,
  ): unknown {
    if ("noBody" in route.request.body) return {};
    const contentType = getHeader(request.headers, "content-type")
      ?.split(";")[0]
      ?.trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      throw new OrganizationsHttpError(
        400,
        "ORGANIZATION_CONTENT_TYPE_INVALID",
        "请求必须使用 application/json",
      );
    }
    const ref = route.request.body.contentTypes[0]!.schemaRef;
    return this.parseRouteValue(ref, request.body);
  }

  private versionOf(
    operation: OrganizationOperation,
    headers: HttpHeaderBag,
  ): number | undefined {
    if (
      operation === "createOrganization" ||
      operation === "assignUsersOrganization"
    ) {
      return undefined;
    }
    const value = getHeader(headers, "if-match");
    if (value === undefined) return undefined;
    return Number(value.slice(1, -1));
  }

  private mapError(
    error: unknown,
    requestId: string,
  ): { readonly status: number; readonly body: unknown } {
    if (error instanceof OrganizationError) {
      return errorBody(error.status, error.code, error.message, {
        reason: error.reason,
        requestId,
      });
    }
    if (error instanceof AdminHighRiskError) {
      return errorBody(error.status, error.code, error.message, {
        reason: error.reason,
        requestId,
      });
    }
    if (error instanceof OrganizationsHttpError) {
      return errorBody(error.status, error.code, error.message, { requestId });
    }
    if (error instanceof IdempotencyHttpError) {
      return errorBody(error.status, error.code, error.message, { requestId });
    }
    if (error instanceof OrganizationsInputError) {
      return errorBody(
        422,
        "ORGANIZATION_VALIDATION_FAILED",
        "请检查组织管理输入字段",
        {
          ...error.fields,
          requestId,
        },
      );
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505" &&
      "constraint_name" in error &&
      String(error.constraint_name).includes("organizations_name_key")
    ) {
      return errorBody(409, "ORGANIZATION_NAME_CONFLICT", "组织名称已存在", {
        requestId,
      });
    }
    return errorBody(500, "INTERNAL_ERROR", "服务器无法完成组织管理操作", {
      requestId,
    });
  }
}

function toPathParams(
  parsed: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, String(value)]),
  );
}

function organizationResult(item: OrganizationItem, actorUserId: number) {
  return {
    responseStatus: 200,
    responseSchemaRef: "OrganizationItem",
    responseHasBody: true,
    responseBody: item,
    replayAuthContext: {
      actorUserId,
      organizationId: item.id,
    },
  };
}

function assignResult(
  updatedCount: number,
  actorUserId: number,
  organizationId: number | null,
  userIds: readonly number[],
) {
  return {
    responseStatus: 200,
    responseSchemaRef: "OrganizationAssignResponse",
    responseHasBody: true,
    responseBody: { updatedCount },
    replayAuthContext: {
      actorUserId,
      organizationId,
      userIds: [...userIds],
    },
  };
}

function deleteResult(actorUserId: number, organizationId: number) {
  return {
    responseStatus: 204,
    responseSchemaRef: null,
    responseHasBody: false,
    responseBody: null,
    replayAuthContext: {
      actorUserId,
      organizationId,
    },
  };
}

function errorBody(
  status: number,
  code: string,
  message: string,
  details: Readonly<Record<string, unknown>>,
) {
  return {
    status,
    body: schemaRegistry.ErrorResponse.schema.parse({
      code,
      message,
      details,
      requestId: details.requestId ?? "",
    }),
  };
}
