import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { routeRegistry, schemaRegistry } from "@inpulse/api-contract";
import { AdminHighRiskAuthService } from "../../auth/admin-high-risk.service.js";
import { AdminHighRiskError } from "../../auth/admin-high-risk.error.js";
import {
  getHeader,
  mutationSameOriginValidationError,
} from "../../auth/csrf.http.js";
import {
  IdempotencyHttpService,
  IdempotencyHttpError,
} from "../../idempotency/http-service.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import type { DraftHttpRequest } from "./record-drafts-http.service.js";
import { RecordLifecycleService } from "./record-lifecycle.service.js";

import { RecordDraftError } from "./record-drafts.service.js";
export type LifecycleOperation = "voidChangeRecord" | "restoreChangeRecord";
@Injectable()
export class RecordLifecycleHttpService {
  constructor(
    @Inject(AdminHighRiskAuthService)
    private readonly mutation: AdminHighRiskAuthService,
    @Inject(IdempotencyHttpService)
    private readonly idempotency: IdempotencyHttpService,
    @Inject(RecordLifecycleService)
    private readonly service: RecordLifecycleService,
  ) {}
  async handle(operation: LifecycleOperation, request: DraftHttpRequest) {
    const requestId = randomUUID();
    try {
      if (mutationSameOriginValidationError(request.headers) !== undefined)
        throw new RecordDraftError(
          403,
          "CSRF_ORIGIN_REJECTED",
          "请求未通过同源安全校验",
        );
      const route = routeRegistry.find((r) => r.operationId === operation)!,
        restore = operation === "restoreChangeRecord";
      const parse = (
        ref: keyof typeof schemaRegistry,
        value: unknown,
      ): unknown => {
        const parsed = schemaRegistry[ref].schema.safeParse(value);
        if (!parsed.success)
          throw new RecordDraftError(
            422,
            "RECORD_LIFECYCLE_VALIDATION_FAILED",
            "请检查原因和记录版本",
          );
        return parsed.data;
      };
      if (
        route.request.path === "none" ||
        route.request.headers === "none" ||
        !("contentTypes" in route.request.body)
      )
        throw Error("Publication contract incomplete");
      const path = parse(route.request.path, request.params) as {
        projectId: number;
        recordId: number;
      };
      if (Object.keys((request.query ?? {}) as object).length)
        throw new RecordDraftError(
          422,
          "RECORD_VALIDATION_FAILED",
          "此接口不接受查询参数",
        );
      parse(route.request.headers, {
        "x-csrf-token": getHeader(request.headers, "x-csrf-token"),
        "if-match": getHeader(request.headers, "if-match"),
      });
      if (
        getHeader(request.headers, "content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() !== "application/json"
      )
        throw new RecordDraftError(
          400,
          "RECORD_CONTENT_TYPE_INVALID",
          "请使用 application/json",
        );
      const body = parse(
        route.request.body.contentTypes[0]!.schemaRef,
        request.body,
      );
      const actor = async (tx: TransactionContext) => {
        const value = await this.mutation.verify(tx, request.headers);
        if (!value)
          throw new RecordDraftError(
            401,
            "RECORD_SESSION_REQUIRED",
            "登录或CSRF状态已失效",
          );

        return value.userId;
      };
      const result = await this.idempotency.run({
        operationId: operation,
        actorId: actor,
        request: {
          method: "POST",
          path: route.path,
          pathParams: Object.fromEntries(
            Object.entries(path).map(([key, value]) => [key, String(value)]),
          ),
          query: {},
          headers: request.headers,
          body,
        },
        execute: async (tx, actorId) => {
          const version = Number(
            getHeader(request.headers, "if-match")!.slice(1, -1),
          );
          const value = await this.service.transition(
            tx,
            actorId,
            path.projectId,
            path.recordId,
            version,
            restore,
            body,
            requestId,
            () => actor(tx),
          );
          return {
            responseStatus: 200,
            responseSchemaRef: "RecordLifecycleResult",
            responseHasBody: true,
            responseBody: value,
            replayAuthContext: {
              projectId: value.projectId,
              recordId: value.id,
            },
          };
        },
        replayAuthorizer: async (record, tx) => {
          await this.service.replay(
            tx,
            await actor(tx),
            record.replayAuthContext,
          );
          await actor(tx);
        },
      });
      return {
        status: result.responseStatus,
        body: schemaRegistry.RecordLifecycleResult.schema.parse(
          result.responseBody,
        ),
      };
    } catch (error) {
      const known =
        error instanceof AdminHighRiskError ||
        error instanceof RecordDraftError ||
        error instanceof IdempotencyHttpError;
      return {
        status: known ? error.status : 500,
        body: schemaRegistry.ErrorResponse.schema.parse({
          code: known ? error.code : "INTERNAL_ERROR",
          message: known ? error.message : "暂时无法变更记录状态",
          details: {},
          requestId,
        }),
      };
    }
  }
}
