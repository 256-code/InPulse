import type { BodyBinding, RouteDefinition } from "./route-definition.js";
import type { SchemaName } from "./schema-registry.js";

const json = (schemaRef: SchemaName): BodyBinding => ({
  body: { contentTypes: [{ contentType: "application/json", schemaRef }] },
});

const errors = (statuses: readonly number[]) =>
  Object.fromEntries(
    statuses.map((status) => [String(status), json("ErrorResponse")]),
  );

/**
 * F-33 迭代总结读路由。
 *
 * 只读 GET：authPolicy 为 session，其余策略按 §3 全量显式写 none。
 * 授权范围固定为服务端 AuthorizedProjectScope：projectId / memberId 只用于收窄，
 * 非成员项目被静默排除而不是返回 403 / 404（与 listRecordFeed、R-6、R-7 同族），
 * 因此不登记 403 与 404。请求校验失败（日期格式、起止倒置、跨度超限、
 * groupBy 非法）统一 422。
 */
export const recordSummaryRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/change-records/summary",
    operationId: "getRecordSummary",
    summary:
      "F-33 迭代总结取数：按 AuthorizedProjectScope 汇总 from / to（Asia/Shanghai 自然日，含首尾）范围内的 PUBLISHED 正式记录、已完成任务、遗留问题与「已完成但没有任何记录」的缺口，并按 PROJECT 或 MEMBER 分组给出分节与计数；projectId / memberId 只收窄范围，越权项目静默排除；不在服务端生成正文措辞。",
    request: {
      path: "none",
      query: "RecordSummaryQueryRequest",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": json("RecordSummaryResponse"),
      ...errors([401, 422, 500]),
    },
    authPolicy: "session",
    csrfPolicy: "none",
    idempotencyPolicy: "none",
    idempotencyExceptionAdr: "none",
    idempotencyContractVersion: "none",
    idempotencyFingerprintVersion: "none",
    behaviorHeaders: "none",
    idempotencyReplayPolicy: "none",
    replayAuthorizationPolicy: "none",
    securityFlowPolicy: "none",
    versionPolicy: "none",
    concurrencyPolicy: "none",
    auditAction: "none",
  },
];
