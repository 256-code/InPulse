import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  routeRegistry,
  schemaRegistry,
  recordDraftItemSchema,
  type IndependentRecordDraftRequest,
  type RecordDraftContent,
} from "@inpulse/api-contract";
import { SessionAuthService } from "../../auth/session-auth.service.js";
import { AuthenticatedMutationService } from "../../auth/authenticated-mutation.service.js";
import {
  getHeader,
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "../../auth/csrf.http.js";
import {
  IdempotencyHttpService,
  IdempotencyHttpError,
} from "../../idempotency/http-service.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import {
  RecordDraftsService,
  RecordDraftError,
} from "./record-drafts.service.js";

export type DraftOperation =
  | "listRecordDrafts"
  | "getRecordDraft"
  | "createIndependentRecordDraft"
  | "updateIndependentRecordDraft";
export interface DraftHttpRequest {
  headers: HttpHeaderBag;
  params: unknown;
  query: unknown;
  body?: unknown;
}
class DraftInputError extends Error {
  constructor(readonly fields: Record<string, string>) {
    super("Invalid draft input");
  }
}
@Injectable()
export class RecordDraftsHttpService {
  constructor(
    @Inject(SessionAuthService) private readonly auth: SessionAuthService,
    @Inject(AuthenticatedMutationService)
    private readonly mutation: AuthenticatedMutationService,
    @Inject(IdempotencyHttpService)
    private readonly idempotency: IdempotencyHttpService,
    @Inject(RecordDraftsService) private readonly drafts: RecordDraftsService,
  ) {}
  async handle(
    operation: DraftOperation,
    request: DraftHttpRequest,
  ): Promise<{ status: number; body: unknown }> {
    const requestId = randomUUID();
    try {
      const route = routeRegistry.find((r) => r.operationId === operation)!;
      const create = operation === "createIndependentRecordDraft";
      const write = route.method !== "GET";
      if (
        write &&
        mutationSameOriginValidationError(request.headers) !== undefined
      )
        throw new RecordDraftError(
          403,
          "CSRF_ORIGIN_REJECTED",
          "请求未通过同源安全校验",
        );
      const actor = write
        ? undefined
        : await this.auth.resolveActor(getHeader(request.headers, "cookie"));
      if (!write && !actor)
        throw new RecordDraftError(401, "DRAFT_SESSION_REQUIRED", "请先登录");
      const parse = (
        ref: keyof typeof schemaRegistry,
        value: unknown,
      ): unknown => {
        const result = schemaRegistry[ref].schema.safeParse(value);
        if (!result.success)
          throw new DraftInputError(
            Object.fromEntries(
              result.error.issues.map((issue) => [
                issue.path.join("."),
                issue.message,
              ]),
            ),
          );
        return result.data;
      };
      if (Object.keys((request.query ?? {}) as object).length)
        throw new DraftInputError({ query: "此接口不接受查询参数" });
      if (route.request.path === "none") throw Error("Draft path missing");
      const path = parse(route.request.path, request.params) as {
        projectId: number;
        moduleId?: number;
        recordId?: number;
      };
      if (!write)
        return {
          status: 200,
          body: await this.drafts.read(
            actor!.userId,
            path.projectId,
            path.recordId,
          ),
        };
      if (route.request.headers === "none")
        throw Error("Draft headers missing");
      parse(route.request.headers, {
        "x-csrf-token": getHeader(request.headers, "x-csrf-token"),
        ...(create
          ? {}
          : { "if-match": getHeader(request.headers, "if-match") }),
      });
      if (
        getHeader(request.headers, "content-type")
          ?.split(";")[0]
          ?.trim()
          .toLowerCase() !== "application/json"
      )
        throw new RecordDraftError(
          400,
          "DRAFT_CONTENT_TYPE_INVALID",
          "请使用 application/json",
        );
      if (!("contentTypes" in route.request.body))
        throw Error("Draft body missing");
      const input = parse(
        route.request.body.contentTypes[0]!.schemaRef,
        request.body,
      );
      const resolve = async (tx: TransactionContext) => {
        const actor = await this.mutation.verify(tx, request.headers);
        if (!actor)
          throw new RecordDraftError(
            401,
            "DRAFT_SESSION_REQUIRED",
            "登录或CSRF状态已失效",
          );
        if (create) {
          const body = input as IndependentRecordDraftRequest;
          await this.drafts.authorize(tx, actor.userId, {
            projectId: path.projectId,
            moduleId: path.moduleId!,
            featureId: body.scopeType === "FEATURE" ? body.featureId : null,
            impactFeatureIds:
              body.scopeType === "MODULE" ? body.impactFeatureIds : [],
          });
        } else
          await this.drafts.resolveExisting(
            tx,
            actor.userId,
            path.projectId,
            path.recordId!,
          );
        return actor.userId;
      };
      const result = await this.idempotency.run({
        operationId: operation,
        actorId: resolve,
        request: {
          method: route.method,
          path: route.path,
          pathParams: Object.fromEntries(
            Object.entries(path).map(([key, value]) => [key, String(value)]),
          ),
          query: {},
          headers: request.headers,
          body: input,
        },
        execute: async (tx, actorId) => {
          const body = create
            ? await this.drafts.create(
                tx,
                actorId,
                path.projectId,
                path.moduleId!,
                input as IndependentRecordDraftRequest,
                requestId,
              )
            : await this.drafts.update(
                tx,
                actorId,
                path.projectId,
                path.recordId!,
                Number(getHeader(request.headers, "if-match")!.slice(1, -1)),
                input as RecordDraftContent,
                requestId,
              );
          return {
            responseStatus: 200,
            responseSchemaRef: "RecordDraftItem",
            responseHasBody: true,
            responseBody: body,
            replayAuthContext: {
              projectId: body.projectId,
              recordId: body.id,
              moduleId: body.moduleId,
              featureId: body.featureId,
              taskId: body.taskId,
              impactFeatureIds: body.impactFeatureIds,
            },
          };
        },
        replayAuthorizer: async (record, tx) => {
          await this.drafts.replay(
            tx,
            await resolve(tx),
            record.replayAuthContext,
          );
        },
      });
      return {
        status: result.responseStatus,
        body: recordDraftItemSchema.parse(result.responseBody),
      };
    } catch (error) {
      let status = 500,
        code = "INTERNAL_ERROR",
        message = "暂时无法保存草稿";
      let details: Record<string, string> = {};
      if (
        error instanceof RecordDraftError ||
        error instanceof IdempotencyHttpError
      )
        ({ status, code, message } = error);
      else if (error instanceof DraftInputError) {
        status = 422;
        code = "DRAFT_VALIDATION_FAILED";
        message = "请检查草稿内容";
        details = error.fields;
      }
      return {
        status,
        body: schemaRegistry.ErrorResponse.schema.parse({
          code,
          message,
          details,
          requestId,
        }),
      };
    }
  }
}
