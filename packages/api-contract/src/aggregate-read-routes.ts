import type { BodyBinding, RouteDefinition } from "./route-definition.js";
import type { SchemaName } from "./schema-registry.js";

const json = (schemaRef: SchemaName): BodyBinding => ({
  body: { contentTypes: [{ contentType: "application/json", schemaRef }] },
});

/** 只登记 A 裁决 §2 冻结的状态码；四条路由都不登记 403（非成员统一 404）。 */
const errors = (statuses: readonly number[]) =>
  Object.fromEntries(
    statuses.map((status) => [String(status), json("ErrorResponse")]),
  );

/**
 * F-25 / F-29 / F-32 聚合读路由（A 裁决 docs/a-contract-review-f25-f29-f32.md）。
 * 四条均为只读 GET：authPolicy 为 session，其余策略按 §3 全量显式写 none。
 * 非成员项目或跨项目资源统一按「资源不存在」返回 404，不返回 403。
 */
export const aggregateReadRoutes: readonly RouteDefinition[] = [
  {
    method: "GET",
    path: "/task-groups/{groupId}",
    operationId: "getTaskGroup",
    summary:
      "F-25 任务聚合组视图：按 groupId 反查项目归属并按实时成员关系授权，返回组标识与全部成员（含已解除成员、任务原数据与每任务 PUBLISHED 记录数）；记录列表由 listTaskGroupRecords 子资源分页提供。",
    request: {
      path: "TaskGroupPath",
      query: "none",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": json("TaskGroupDetailResponse"),
      ...errors([401, 404, 500]),
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
  {
    method: "GET",
    path: "/task-groups/{groupId}/records",
    operationId: "listTaskGroupRecords",
    summary:
      "F-25 聚合组记录列表：只返回 PUBLISHED 与 VOID 记录，可按成员任务过滤，按 recordId DESC 游标分页，并附记录上的 GitHub 链接快照。",
    request: {
      path: "TaskGroupPath",
      query: "TaskGroupRecordQueryRequest",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": json("TaskGroupRecordPage"),
      ...errors([401, 404, 422, 500]),
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
  {
    method: "GET",
    path: "/projects/{projectId}/overview",
    operationId: "getProjectOverview",
    summary:
      "F-29 项目概览：服务端聚合活跃模块数、活跃功能数、未完成任务、迭代记录数、最近迭代、待处理遗留问题总数与列表；统计口径按功能设计 §29，无权限项目统一 404；recentRecordLimit 默认 3、activeLeftoverLimit 默认 2，上限 10。",
    request: {
      path: "ProjectPath",
      query: "ProjectOverviewQueryRequest",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": json("ProjectOverviewResponse"),
      ...errors([401, 404, 422, 500]),
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
  {
    method: "GET",
    path: "/task-groups/memberships",
    operationId: "listTaskGroupMemberships",
    summary:
      "F-25 任务卡片聚合关系批量查询（R-5）：按逗号分隔的 1..100 个任务 ID，返回当前用户可访问项目内、属于 ACTIVE 聚合组的任务与组内角色；无权、不存在或已解除的关系一律不入结果，不泄露资源存在性；数量、格式或重复校验失败返回 422。",
    request: {
      path: "none",
      query: "TaskGroupMembershipQueryRequest",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": json("TaskGroupMembershipResponse"),
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
  {
    method: "GET",
    path: "/me/tasks",
    operationId: "listMyTasks",
    summary:
      "F-32 我的任务：跨项目列出当前用户负责的任务，返回优先级、截止与完成时间、创建者、外部链接数与聚合组关系，并附统计卡片与遗留问题入口；服务端按 AuthorizedProjectScope 过滤并固定 id DESC 游标分页；V1 支持 projectId / scopeType / workStatus / hasPublishedRecord / priority / includeCanceled 六项筛选，不接受任何他人身份或授权范围参数。",
    request: {
      path: "none",
      query: "MyTasksQueryRequest",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": json("MyTaskPage"),
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
  {
    method: "GET",
    path: "/leftover-items",
    operationId: "listLeftoverItems",
    summary:
      "R-5 遗留问题列表（F-20 / F-32）：跨项目按 AuthorizedProjectScope 汇总可见记录的稳定遗留项；bucket 区分未闭环 / 已闭环，游标按 leftoverItemId DESC；内容取最新版本快照，来源任务与跟进任务只返回任务引用，不复制任务实体。",
    request: {
      path: "none",
      query: "LeftoverListQueryRequest",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": json("LeftoverItemPage"),
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
  {
    method: "GET",
    path: "/task-groups",
    operationId: "listTaskGroups",
    summary:
      "R-6 任务聚合组列表（F-25）：跨项目按 AuthorizedProjectScope 汇总聚合组与当前生效分支（主任务在前，来源任务按 joinedAt 升序）；已解除成员不进入摘要；按 groupId DESC 游标分页，服务端返回原始状态枚举。",
    request: {
      path: "none",
      query: "TaskGroupListQueryRequest",
      headers: "none",
      body: { noBody: true },
    },
    responses: {
      "200": json("TaskGroupListPage"),
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
