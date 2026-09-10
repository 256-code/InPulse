import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { routeRegistry, schemaRegistry } from "@inpulse/api-contract";
import { SessionAuthService } from "../../auth/session-auth.service.js";
import { getHeader } from "../../auth/csrf.http.js";
import { RecordDraftError } from "./record-drafts.service.js";
import type { DraftHttpRequest } from "./record-drafts-http.service.js";
import { PublishedRecordReadService } from "./published-record-read.service.js";
export type PublishedReadOperation =
  | "listChangeRecords"
  | "getChangeRecord"
  | "listChangeRecordVersions"
  | "getChangeRecordVersion";
@Injectable()
export class PublishedRecordsHttpService {
  constructor(
    @Inject(SessionAuthService) private readonly auth: SessionAuthService,
    @Inject(PublishedRecordReadService)
    private readonly service: PublishedRecordReadService,
  ) {}
  async handle(operation: PublishedReadOperation, request: DraftHttpRequest) {
    const requestId = randomUUID();
    try {
      const actor = await this.auth.resolveActor(
        getHeader(request.headers, "cookie"),
      );
      if (!actor)
        throw new RecordDraftError(401, "RECORD_SESSION_REQUIRED", "请先登录");
      const route = routeRegistry.find((r) => r.operationId === operation)!;
      if (route.request.path === "none") throw Error("Record path missing");
      const parsed = schemaRegistry[route.request.path].schema.safeParse(
        request.params,
      );
      if (
        !parsed.success ||
        (operation === "listChangeRecords"
          ? !schemaRegistry.RecordListQuery.schema.safeParse(
              request.query ?? {},
            ).success
          : Object.keys((request.query ?? {}) as object).length)
      )
        throw new RecordDraftError(
          422,
          "RECORD_VALIDATION_FAILED",
          "请检查记录路径和版本",
        );
      const path = parsed.data as {
        projectId: number;
        recordId?: number;
        versionNo?: number;
      };
      return {
        status: 200,
        body: await this.service.read(
          actor.userId,
          path.projectId,
          path.recordId,
          operation === "listChangeRecordVersions" ||
            operation === "getChangeRecordVersion",
          path.versionNo,
          operation === "listChangeRecords"
            ? schemaRegistry.RecordListQuery.schema.parse(request.query ?? {})
                .status
            : undefined,
        ),
      };
    } catch (error) {
      const known = error instanceof RecordDraftError;
      return {
        status: known ? error.status : 500,
        body: schemaRegistry.ErrorResponse.schema.parse({
          code: known ? error.code : "INTERNAL_ERROR",
          message: known ? error.message : "暂时无法读取迭代记录",
          details: {},
          requestId,
        }),
      };
    }
  }
}
