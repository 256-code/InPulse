# F-25 / F-29 / F-32 聚合读接口候选 DTO 与路由（提交给 A 的契约评审输入）

## 1. 文档信息

| 字段 | 内容 |
| --- | --- |
| 提交方 | C 岗 / 前端与聚合发现域（`@256-code`） |
| 接收方 | A 岗 / 平台与访问域，F-11 工程基座与 API 契约平台 |
| 文档性质 | 契约评审输入，不是 ADR，不替代现有设计 |
| 状态 | 待 A 评审；本文档全部路由、字段名与 operationId 均为候选 |
| 当前日期 | 2026-09-10 |
| 基线 | 分支创建自 `origin/main` `77b2d7e`（F-09 PR #83 之后）；本文档引用的代码、契约与表结构事实已按 `origin/main` `935844b`（F-24 PR #87 合并之后）复核，分支合并前需 rebase |
| 上游文档 | [前端对生成客户端的消费需求清单](./frontend-generated-client-consumption-requirements.md) |
| 关联编号 | 上游 C-003（聚合接口缺口）、C-010（候选接口尚未冻结） |
| 配套文档 | [F-29 / F-32 跨域只读端口扩展提案](./c-port-extension-proposal.md)（交 B，后端端口层） |

### 1.1 与上游文档的关系

上游文档 §2.2 把「定义业务字段的最终名称、具体领域 DTO 或页面交互细节」列为**非目标**，因此上游 §4.8.1 只登记了三条候选路由的方法、路径与用途，没有字段级输入。而上游 §7 第 6 问要求 A 判断「项目概览、任务聚合详情、我的任务等路由和 DTO 是否进入 Route Registry」——A 需要看到具体候选才能裁决。

本文档只补这一处空白：

- 补充上游 §4.8.1 三条候选路由的**候选 DTO 字段清单**；
- 补充候选路由的**建议策略登记**（状态码、鉴权、CSRF、幂等、并发、审计），格式对齐 `packages/api-contract/src/route-definition.ts` 的 `RouteDefinition`；
- 提出**待 A 裁决的问题**（Q-01 ~ Q-15）。

本文档不推翻、不重复上游文档的任何结论，也不构成第三份契约真相。

### 1.2 本文档的边界

本文档不做以下事项（与上游 §8 第三条规定一致）：

- 不创建生成客户端依赖、不手工生成 OpenAPI/客户端文件、不锁定候选生成工具版本；
- 不修改 `packages/api-contract` 的 Route Registry、Schema Registry、权限矩阵或任何生成物；
- 不替代[权限矩阵](./permissions.md)或[测试矩阵](./test-matrix.md)；
- 不在 A 给出结论前把这三条路由当作实现依据。

字段名、可空性、枚举值、默认值、排序与游标键均为**候选**。A 在 Schema Registry 定案时可直接改名、拆合或删除字段，只需在评审记录中说明。

---

## 2. 候选路由登记表

三条路由均对应上游 §4.8.1 已登记的候选，路径与用途不变；本文档补充建议策略。

| 编号 | 方法 | 路径 | 建议 operationId | 用途 | 上游依据 |
| --- | --- | --- | --- | --- | --- |
| R-1 | `GET` | `/api/v1/task-groups/{groupId}` | `getTaskGroup` | 任务聚合组详情（F-25） | 上游 §4.8.1 第 2 行 |
| R-2 | `GET` | `/api/v1/projects/{projectId}/overview` | `getProjectOverview` | 项目概览聚合（F-29） | 上游 §4.8.1 第 1 行 |
| R-3 | `GET` | `/api/v1/me/tasks` | `listMyTasks` | 跨项目「我的任务」（F-32） | 上游 §4.8.1 第 3 行 |

R-1 是否需要追加子资源路由取决于 Q-02 的裁决，本文档按"可能新增第 4 条"处理。

### 2.1 建议策略登记

三条均为只读、无 body、无并发要求的 `GET`。登记值按现有只读路由写法（对照 `packages/api-contract/src/route-registry.ts` 中 `getSearch` 与 `getProjectActivity` 的完整策略块）：

```ts
// R-1、R-2、R-3 共用
authPolicy: "session",                    // AuthPolicy = "none" | "session" | "adminSessionWithReauthentication"
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
```

建议响应状态码：

| 路由 | 建议状态码 | 理由 |
| --- | --- | --- |
| R-1 | `200` / `401` / `404` / `500` | 组不存在，或当前用户不属该组所属项目，统一 `404` |
| R-2 | `200` / `401` / `404` / `422` / `500` | 与 `getProjectActivity` 已登记的状态码集合一致（`route-registry.ts`：200/401/404/422/500）；`422` 覆盖查询参数非法 |
| R-3 | `200` / `401` / `422` / `500` | 无单一路径资源；筛选参数非法用 `422`，与 `getSearch` 一致 |

三条都不建议出现 `403`：按 [AGENTS.md](../AGENTS.md) §7，已登录但无权访问某项目或聚合组时返回 `404`，避免泄露资源存在性；`403` 保留给「已登录但缺少全局权限」的场景，这三条只读路由不涉及。

### 2.2 与现有路由的形态对照

| 现有路由 | operationId | 形态 | 与本文档的关系 |
| --- | --- | --- | --- |
| `GET /projects/{projectId}/activity` | `getProjectActivity` | 项目前缀 + 游标分页 | R-2 的同族范式 |
| `GET /projects/{projectId}/members/{userId}/unfinished-tasks` | `listProjectMemberUnfinishedTasks` | 项目前缀 + 无分页 | 同为"某人的未完成任务"，见 §6 第 2 点 |
| `GET /search` | `getSearch` | 全局路径 + 游标分页 | R-3 的同族范式 |

⇒ R-1（全局路径）与 R-2（项目前缀）形态不同，这是 Q-01 要裁决的点。

---

## 3. 候选 DTO

以下类型用 TypeScript 表达便于评审；落库时按 Schema Registry 的 Zod 风格改写，时间统一为 ISO 8601 字符串，ID 统一为 `number`（上游 C-009）。

### 3.1 R-1 `getTaskGroup`（F-25 任务聚合组视图）

#### 3.1.1 展示依据

[开发工作书v1.0.md](../开发工作书v1.0.md) F-25 步骤 1~3 与[功能设计v1.1.md](../功能设计v1.1.md) §18.12 要求展示：

```text
任务聚合组：退款回调重复处理

主任务 T-101
├── CR-201 增加商户订单号幂等校验
│   来源：主任务
│
来源分支 T-108
├── CR-205 增加回调请求唯一标识
│   来源：T-108
└── CR-206 修复退款重复入账
     来源：T-108
```

筛选标签：`[全部记录] [主任务] [来源任务 T-108] [来源任务 T-112]`

⇒ 需要：组标识与状态、成员列表（MAIN / SOURCE、活动 / 历史、已加入 / 已解除）、每成员的迭代记录数与记录明细、每记录的 GitHub 链接、按成员筛选记录。

数据来源（`database/migrations/0000_initial.sql`）：

| 展示信息 | 来源 |
| --- | --- |
| 组标识与状态 | `app.task_groups`（`code`、`name`、`status`、`row_version`、`closed_at`） |
| 成员角色 | `app.task_group_members.role`（`MAIN` / `SOURCE`） |
| 来源状态 | `app.task_group_members.source_kind`（`ACTIVE` / `HISTORICAL`）与 `status`（`ACTIVE` / `DETACHED`） |
| 解除信息 | `app.task_group_members.detached_at` / `detach_reason` |
| 任务原数据 | `app.tasks`（`code`、`title`、`work_status`、`lifecycle_status`、`assignee_id`、`module_id`、`feature_id`） |
| 迭代记录 | `app.change_records`（`code`、`title`、`status`、`published_at`、`task_id`、`feature_id`） |
| GitHub 链接 | `app.external_links` 经 `app.task_external_links` 与 `app.change_record_external_links` |

验收要求「聚合页信息与各任务原数据一致（不复制）」⇒ DTO 只做投影，不得引入存储副本。

#### 3.1.2 候选响应 DTO

```ts
/** GET /task-groups/{groupId} → 200 */
interface TaskGroupDetailResponse {
  readonly group: TaskGroupSummary;
  /** 主任务在前，来源任务按 joinedAt 升序、taskId 升序 */
  readonly members: readonly TaskGroupMemberItem[];
}

interface TaskGroupSummary {
  readonly groupId: number;
  readonly projectId: number;
  readonly code: string;                       // 例：SHOP-TG-1
  readonly name: string;
  readonly status: "ACTIVE" | "CLOSED";
  readonly createdAt: string;
  readonly closedAt: string | null;
  readonly rowVersion: number;
}

interface TaskGroupMemberItem {
  readonly taskId: number;
  readonly taskCode: string;
  readonly title: string;
  readonly role: "MAIN" | "SOURCE";
  /** MAIN 恒为 null；SOURCE 必非空 */
  readonly sourceKind: "ACTIVE" | "HISTORICAL" | null;
  /** 成员关系状态，不是任务状态 */
  readonly memberStatus: "ACTIVE" | "DETACHED";
  readonly workStatus: "TODO" | "DONE" | "CANCELED";
  readonly lifecycleStatus: "ACTIVE" | "ARCHIVED" | "INVALID";
  readonly moduleId: number;
  readonly featureId: number | null;
  readonly assignee: UserRef;
  readonly joinedAt: string;
  readonly detachedAt: string | null;
  readonly detachReason: string | null;
  /** 「迭代记录 n 条」标记，口径见 §4.2 */
  readonly publishedRecordCount: number;
}

interface UserRef {
  readonly userId: number;
  readonly name: string;
  readonly avatarUrl: string | null;
}
```

说明：

- `sourceKind` 与 `memberStatus` 是两个正交维度：`sourceKind` 表示该分支是否仍可继续工作（功能设计 §18.13），`memberStatus` 表示合并关系是否已解除（功能设计 §18.14）。已解除的成员仍需展示历史，不能从列表移除。
- 表约束 `task_group_members_snapshot_check` 保证 `role = 'MAIN'` 时 `source_kind` 为 `NULL`、`role = 'SOURCE'` 时非空，因此 `sourceKind` 的可空性由 `role` 决定，A 可用 discriminated union 表达。
- `detachReason` 是用户输入文本（1~10000 字符），属于可安全展示内容；但聚合页禁止展示未经脱敏的原始审计内容（工作书 F-25 禁止事项），因此**不**返回审计快照。

#### 3.1.3 记录列表的两种形态（Q-02）

功能设计的筛选标签要求记录按**成员任务**过滤，而一个聚合组的记录数没有业务上限。两种候选：

**形态 A：单响应内嵌全部记录**

```ts
interface TaskGroupRecordItem {
  readonly recordId: number;
  readonly code: string;                       // 仅 PUBLISHED / VOID 有值
  readonly title: string;
  readonly recordStatus: "PUBLISHED" | "VOID";
  readonly taskId: number;                     // 归属成员
  readonly sourceLabel: string;                // 「主任务」或来源任务编号
  readonly featureId: number | null;
  readonly publishedAt: string;
  readonly externalLinks: readonly ExternalLinkItem[];
}

// TaskGroupDetailResponse 追加：
//   readonly records: readonly TaskGroupRecordItem[];
//   readonly recordTotal: number;
```

**形态 B：成员内嵌计数 + 独立子资源分页**

```ts
/** GET /task-groups/{groupId}/records?memberTaskId={taskId}&cursor={cursor}&limit={limit} */
interface TaskGroupRecordPage {
  readonly items: readonly TaskGroupRecordItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}
```

| 维度 | 形态 A | 形态 B |
| --- | --- | --- |
| 响应体规模 | 无上限，随历史增长 | 受 `limit` 控制 |
| 筛选 | 客户端过滤（全量已下传） | 服务端过滤 |
| 新增路由 | 0 条 | 1 条（超出上游 §4.8.1 已登记的三条） |
| 游标约定 | 不需要 | 沿用 C-006 的 `{ items, nextCursor, hasMore }` |
| 与上游 L214 的关系 | 单次请求即完整，无 N+1 | 需要多次请求，仍无 N+1 |

**C 的建议**：形态 B。功能设计 §18.12 的筛选标签语义是"按成员任务筛选记录"，服务端过滤与服务端聚合原则一致；且形态 A 会让一个长期存活的聚合组响应体持续膨胀。若 A 认为增加路由的成本高于收益，形态 A 也可接受，但建议明确响应体上限。

#### 3.1.4 GitHub 链接 DTO

```ts
interface ExternalLinkItem {
  readonly linkId: number;
  readonly displayUrl: string;
  readonly kind: "ISSUE" | "PULL_REQUEST" | "COMMIT" | "OTHER";
  readonly repository: string | null;
  readonly externalNumber: number | null;
  readonly externalSha: string | null;
  /** 关联时刻的快照，不是实时状态，见 Q-14 */
  readonly titleSnapshot: string | null;
  readonly stateSnapshot: string | null;
  readonly createdAt: string;
}
```

依据：功能设计 §22.3 支持多链接（§22.2 定义支持的链接类型）；`app.external_links` 的 CHECK 约束已限定 `display_url` / `normalized_url` 必须以 `https://github.com` 开头，`provider` 恒为 `GITHUB`，因此 `provider` 不必出现在响应中。

### 3.2 R-2 `getProjectOverview`（F-29 项目概览）

#### 3.2.1 展示依据

[功能设计v1.1.md](../功能设计v1.1.md) §9.5 规定展示内容：

```text
商城系统
状态：正常
成员：8 人

┌────────────┬────────────┬────────────┬────────────┐
│ 活跃模块数 │ 活跃功能数 │ 未完成任务 │ 迭代记录数 │
│     5      │     38     │     21     │    245     │
└────────────┴────────────┴────────────┴────────────┘

最近迭代
├── 微信支付退款回调：增加幂等校验
├── 订单批量导出：改为异步导出
└── 会员等级计算：修正边界条件

待处理遗留问题
├── 大数据量导出内存占用较高
└── 退款异常告警策略不完善
```

工作书 F-29 步骤 1~2 要求服务端聚合，禁止前端跨域拼装；验收要求统计口径与功能设计 §29 一致，无权限项目不返回。

#### 3.2.2 候选响应 DTO

```ts
/** GET /projects/{projectId}/overview → 200 */
interface ProjectOverviewResponse {
  readonly project: ProjectOverviewProject;
  readonly memberCount: number;
  readonly stats: ProjectOverviewStats;
  /** 按 publishedAt DESC, recordId DESC；默认 3 条，上限见 Q-06 */
  readonly recentRecords: readonly RecentRecordItem[];
  /** 按 createdAt DESC, leftoverItemId DESC；默认 2 条，上限见 Q-06 */
  readonly activeLeftovers: readonly LeftoverItemSummary[];
}

interface ProjectOverviewProject {
  readonly projectId: number;
  readonly name: string;
  /** 原始枚举，展示文案由前端映射（功能设计 §9.5 显示「正常」），见 Q-15 */
  readonly status: "ACTIVE" | "ARCHIVED";
}

interface ProjectOverviewStats {
  readonly activeModuleCount: number;
  readonly activeFeatureCount: number;
  readonly openTaskCount: number;
  readonly publishedRecordCount: number;
}

interface RecentRecordItem {
  readonly recordId: number;
  readonly code: string;
  readonly title: string;
  readonly moduleId: number;
  readonly featureId: number | null;
  /** 展示为「微信支付退款回调：增加幂等校验」 */
  readonly featureName: string | null;
  readonly publishedAt: string;
}

interface LeftoverItemSummary {
  readonly leftoverItemId: number;
  readonly recordId: number;
  readonly recordCode: string;
  readonly content: string;
  readonly createdAt: string;
}
```

已具备的现成来源：

- `memberCount`：A 的 `ProjectQueryPort.list(projectIds)` 返回的 `ProjectItem` 已包含 `memberCount`（见 `apps/api/src/modules/projects/postgres-project-query-port.ts`），无需新查询。
- `publishedRecordCount` / `recentRecords` / `activeLeftovers`：需 B 的记录只读端口（见配套端口提案 §6）。
- `activeModuleCount` / `activeFeatureCount` / `openTaskCount`：需 B 的模块、功能、任务只读端口扩展（见配套端口提案 §3~§5）。

`LeftoverItemSummary.content` 需要额外说明：`app.change_record_leftover_items` 表**没有内容列**，内容存在版本快照表 `app.change_record_version_leftovers.content_snapshot`，因此实现需要取该遗留项最新版本快照。这不是 HTTP 契约问题，但会影响 B 端口方法的可行性，已在端口提案 §6.4 标注。

### 3.3 R-3 `listMyTasks`（F-32 我的任务）

#### 3.3.1 展示依据

[开发工作书v1.0.md](../开发工作书v1.0.md) F-32 步骤 3 要求筛选「任务状态、任务范围、是否有迭代记录、负责人=我」；[功能设计v1.1.md](../功能设计v1.1.md) §21 规定跨项目查询使用**列表**视图，需展示"负责人、模块、功能、时间等多个字段"。

功能设计 §24.3 的完整筛选集合（项目、模块、功能、任务范围、任务状态、负责人、是否有迭代记录、是否有遗留问题、是否有 GitHub、是否为来源任务、分支类型、记录时间、记录作者）大于 F-32 当前范围，收敛方案见 Q-09。

F-32 禁止事项：禁止在本页面按项目逐次请求后前端合并全量数据。

#### 3.3.2 候选查询参数

```ts
interface MyTasksQueryRequest {
  readonly cursor?: string;               // 不透明游标，沿用 C-006
  readonly limit?: number;                // 默认 20，上限见 Q-10
  readonly projectId?: number;            // 需经服务端授权范围复验，不作为授权依据
  readonly scopeType?: "FEATURE" | "MODULE";
  readonly workStatus?: "TODO" | "DONE" | "CANCELED";
  readonly hasPublishedRecord?: boolean;  // 冲突 A，见 Q-07 与端口提案 §7
  readonly assigneeMe?: boolean;          // 是否固定为 true，见 Q-08
  readonly sort?: "id";                   // 见 Q-10
}
```

**必须由服务端拒绝的参数**：任何客户端提交的 `assigneeId`、`userId`、`projectIds` 数组或授权范围。若前端需要查看他人的任务，应走另一条明确授权的路由，不能复用 `/me/tasks`。

#### 3.3.3 候选项 DTO

```ts
interface MyTaskPage {
  readonly items: readonly MyTaskItem[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

interface MyTaskItem {
  readonly taskId: number;
  readonly code: string;
  readonly title: string;
  readonly projectId: number;
  readonly projectName: string;
  readonly moduleId: number;
  readonly moduleName: string;
  readonly featureId: number | null;
  readonly featureName: string | null;
  readonly scopeType: "FEATURE" | "MODULE";
  readonly workStatus: "TODO" | "DONE" | "CANCELED";
  readonly lifecycleStatus: "ACTIVE" | "ARCHIVED" | "INVALID";
  readonly assignee: UserRef;
  readonly updatedAt: string;
  /** 该任务是否有正式（PUBLISHED）迭代记录 */
  readonly hasPublishedRecord: boolean;
  /** 该任务是否属于聚合组；用于任务卡片「主任务/来源任务」标记 */
  readonly groupRole: "MAIN" | "SOURCE" | null;
}
```

`groupRole` 的依据：F-25 步骤 3 要求「任务卡片显示"主任务/来源任务/迭代记录 n 条"标记」。任务卡片在多个列表复用，该标记的数据归属见 Q-11。

`hasPublishedRecord` 是实现风险最高的字段：它需要跨 `app.tasks` 与 `app.change_records` 判断，而两个表分属 B 域的不同模块，详见配套端口提案 §7.1。

---

## 4. 服务端聚合边界与实现前提

### 4.1 授权范围

三条路由都必须在 SQL 之前取得服务端生成的授权范围，不得信任客户端提交的 `projectId`（[AGENTS.md](../AGENTS.md) §7）：

| 路由 | 授权方式 |
| --- | --- |
| R-1 | 由 `groupId` 反查 `project_id`，再经 A 的 `ProjectAccessQueryPort` 复验成员关系；不在可见范围时返回 `404` |
| R-2 | 经 `ProjectAccessQueryPort` 复验 `projectId`；不可访问返回 `404` |
| R-3 | 经 `ProjectAccessQueryPort.getAuthorizedSearchScope(actorUserId)` 取得 `AuthorizedProjectScope`，SQL 层按 `project_id = ANY(...)` 过滤 |

`AuthorizedProjectScope` 已由 A 提供（`apps/api/src/modules/projects/project-access.port.ts`），现有只读适配器范式见 `apps/api/src/modules/projects/postgres-project-query-port.ts`（`= ANY(${projectIds}::integer[])`，空数组短路返回 `[]`）。

成员关系不得缓存到 Session 或长生命周期对象，每次请求重新读取。

### 4.2 统计口径

被统计字段的口径必须以[功能设计v1.1.md](../功能设计v1.1.md) §29 为准：

| 字段 | 候选口径 | 依据 |
| --- | --- | --- |
| `activeModuleCount` | `modules.status = 'ACTIVE'` 计数 | 功能设计 §10；`modules_status_check` 约束 |
| `activeFeatureCount` | `features.status = 'ACTIVE'` 计数 | 功能设计 §11；`features_status_check` 约束 |
| `openTaskCount` | §29.1 有效任务（未无效 ∧ 未取消 ∧ 非历史来源分支）中 `work_status <> 'DONE'` 计数 | 功能设计 §29.1、§29.2；需确认，见 Q-04 |
| `publishedRecordCount` | `change_records.status = 'PUBLISHED'` 计数 | 功能设计 §29.4 |
| `publishedRecordCount`（R-1 每任务） | 同上，按 `task_id` 分组 | 功能设计 §29.4 |
| `hasPublishedRecord`（R-3） | `change_records.status = 'PUBLISHED'` 关联 `task_id` 存在性 | 功能设计 §29.4 |
| 遗留问题 | `change_record_leftover_items.status = 'ACTIVE'` | 功能设计 §29.4；`status IN ('ACTIVE','CONVERTED','RESOLVED')` |

§29.4 的三条硬性要求必须体现在实现中：

1. 模块级记录在多个功能页面引用时仍计 1 条 ⇒ 计数**不得** join `change_record_feature_impacts`；
2. 记录版本不增加迭代记录数量 ⇒ 计数基于 `change_records`，**不得**基于 `change_record_versions`；
3. 任务数 1、迭代记录数 1、影响功能数 N（§29.3）⇒ 模块级任务产生的记录不按 `task_id` 去重。

`openTaskCount` 与 `hasPublishedRecord` 都需要跨域数据：前者需要 `task_group_members`（C 自己的表）与 `tasks`（B 域），后者需要 `change_records`（B 域）与 `tasks`（B 域）。这两处是端口提案 §7 的核心冲突，归属见 Q-07、Q-12。

### 4.3 与端口提案的分工

"这些聚合查询由谁实现、需要哪些跨域只读端口"属于**后端端口层**，不在本文档范围，见[配套端口提案](./c-port-extension-proposal.md)。两条通道的边界：

| 通道 | 交付物 | 接收方 |
| --- | --- | --- |
| 本文档 | HTTP 路由、状态码、请求与响应 DTO、统计口径引用 | A |
| 端口提案 | TypeScript 端口签名、事务约定、索引证据与 SQL 骨架 | B |

两者结论必须一致；若 A 的裁决改变路由形态（例如 Q-02 选形态 B、Q-03 扩大任务基础 DTO），端口提案需同步修订。

---

## 5. 待 A 裁决的问题清单

编号从 Q-01 顺延，不与上游 C-001 ~ C-010 混编；A 可在评审记录中按 Q 编号回填上游 §6.1 的状态。

| 编号 | 问题 | 关联 | C 的建议 |
| --- | --- | --- | --- |
| Q-01 | R-1 用全局路径 `/task-groups/{groupId}` 还是项目前缀 `/projects/{projectId}/task-groups/{groupId}`？ | R-1、上游 §4.8.1 | 保持上游登记形式，由服务端反查 `project_id` 后校验；若改为项目前缀，需同步修订上游文档 |
| Q-02 | R-1 的记录列表采用形态 A（单响应内嵌）还是形态 B（子资源分页）？形态 B 需新增路由 `/task-groups/{groupId}/records` | §3.1.3 | 形态 B |
| Q-03 | 任务基础 DTO 是否暴露聚合组信息（`groupId`、`groupRole`）？F-25 的「查看主任务」入口与任务卡片标记依赖它 | §3.3.3、Q-11 | 在任务基础 DTO 暴露 `groupId: number \| null`；若不扩大该契约，则由 R-3 提供 |
| Q-04 | `openTaskCount` 是否采用 §29.1 有效任务口径？是否排除历史来源分支？ | §4.2 | 采用 §29.1，包含排除历史来源分支 |
| Q-05 | `activeModuleCount` / `activeFeatureCount` 是否就是 `status = 'ACTIVE'` 的行数？ | §4.2 | 是 |
| Q-06 | `recentRecords` / `activeLeftovers` 的默认与上限条数由谁定？功能设计只给了 3 / 2 条的示例 | §3.2.2 | 默认 3 / 2，上限 10，由 A 在 Schema 定案 |
| Q-07 | `hasPublishedRecord` 筛选的服务端实现归属？它需要 `change_records`，而 `tasks` 与 `change_records` 分属 B 域两个模块 | §3.3.3、端口提案 §7.1 | 由 C 的只读适配器实现并补 ADR（端口提案路线 III；对 F-32 同时是替代工作书步骤 1 的处方）；或按路线 IV 建投影。端口提案已排除「直接塞进 `TaskQueryPort`」的路线 I |
| Q-08 | `assigneeMe` 是否固定为「负责人=我」？是否允许省略以查询项目内全部任务？ | §3.3.2 | 固定为"负责人=我"；查询他人任务走另一条明确授权的路由 |
| Q-09 | R-3 的筛选参数一次覆盖功能设计 §24.3 的 13 项，还是先实现 F-32 要求的 4 项？ | §3.3.2 | 先 4 项（状态、范围、是否有记录、负责人），其余后续扩展 |
| Q-10 | R-3 的排序键与游标键？现有索引可命中 `ORDER BY t.id DESC`，不能命中按 `updated_at` 排序 | §3.3.2、端口提案 §1.4 | `id DESC`；若产品要求按更新时间排序，需先补索引 |
| Q-11 | F-25 的任务卡片标记（「主任务/来源任务/迭代记录 n 条」）数据放在哪个契约？ | Q-03 | 放任务基础 DTO；若不宜扩大，则放 R-3 与任务列表 DTO |
| Q-12 | 三条路由的服务端聚合实现放在 C 聚合域（只读适配器）还是由 B 提供 QueryPort？ | §4.2 | 统计类由 B 端口提供；跨域筛选类（`hasPublishedRecord`、历史来源分支排除）由 C 只读适配器加 ADR 实现 |
| Q-13 | R-1 的记录列表中，`DRAFT` 状态记录是否可见？ | §3.1.3 | 不可见，只返回 `PUBLISHED` 与 `VOID`；功能设计只把正式记录计入迭代历史 |
| Q-14 | `state_snapshot` 是关联时刻快照而非实时状态，契约是否需要显式说明？ | §3.1.4 | 在字段说明中标注为快照，避免前端当作实时状态展示 |
| Q-15 | `project.status` 返回原始枚举还是展示文案？功能设计 §9.5 显示「正常」 | §3.2.2 | 返回原始枚举，展示文案由前端映射；`message` 的交互语义上游 C-008 仍未关闭 |

### 5.1 与其他上游编号的关系

- Q-03、Q-11 依赖上游 C-008（`message` 的用户交互语义）之外的展示约定，但本身不新增冲突；
- Q-07、Q-12 涉及跨域只读权限，若 A 判定需要 ADR，则按上游 §8 第二条的顺序记录冲突与裁决，H 实现前不得开工；
- Q-10 与 C-006（游标约定已定案）一致，只是确定排序键。

---

## 6. 对 A 的评审请求

在上述问题之外，请 A 顺便明确三点：

1. **接受方式**：本文档的候选 DTO 若被接受，是直接进入 Schema Registry，还是需要先转 ADR？涉及 Q-07 的跨域归属时可能属于后者。
2. **与现有路由的关系**：R-3 的 `/me/tasks` 是否与 A 已有的 `listProjectMemberUnfinishedTasks`（`GET /projects/{projectId}/members/{userId}/unfinished-tasks`）复用同一读取逻辑？两条路由的筛选维度不同（前者跨项目按负责人，后者单项目按指定成员），但都能回答"某人的未完成任务"。
3. **命名规范**：`getTaskGroup` / `getProjectOverview` / `listMyTasks` 是否符合 A 的 operationId 命名规范。

评审结论请回填上游文档的 §6 编号表或本文档 §5 的问题清单；本文档在 A 回复前不会将任何字段视为已定案。

---

## 7. 附录：依据清单

| 依据 | 位置 | 用途 |
| --- | --- | --- |
| 工作书 F-25 | [开发工作书v1.0.md](../开发工作书v1.0.md) F-25 节 | R-1 展示、筛选与入口要求 |
| 工作书 F-29 | [开发工作书v1.0.md](../开发工作书v1.0.md) F-29 节 | R-2 服务端聚合要求与验收 |
| 工作书 F-32 | [开发工作书v1.0.md](../开发工作书v1.0.md) F-32 节 | R-3 筛选、验收与禁止事项 |
| 工作书 §6.1 | [开发工作书v1.0.md](../开发工作书v1.0.md) 第六章 | 接口责任表（`TaskQueryPort` 消费方含 C） |
| 功能设计 §9.5 | [功能设计v1.1.md](../功能设计v1.1.md) §9.5 | R-2 展示内容 |
| 功能设计 §18.12 | [功能设计v1.1.md](../功能设计v1.1.md) §18.12 | R-1 展示结构与筛选标签 |
| 功能设计 §18.13 / §18.14 | [功能设计v1.1.md](../功能设计v1.1.md) §18.13、§18.14 | 活动 / 历史来源分支与解除规则 |
| 功能设计 §21 | [功能设计v1.1.md](../功能设计v1.1.md) 第 21 节 | 跨项目查询使用列表视图 |
| 功能设计 §22.3 | [功能设计v1.1.md](../功能设计v1.1.md) §22.3 | GitHub 多链接（§22.2 为支持的链接类型） |
| 功能设计 §24.3 | [功能设计v1.1.md](../功能设计v1.1.md) §24.3 | 筛选条件全集 |
| 功能设计 §29 | [功能设计v1.1.md](../功能设计v1.1.md) 第 29 节 | 统计口径（§29.1 ~ §29.4） |
| 表结构 | `database/migrations/0000_initial.sql` | 字段、枚举与 CHECK 约束 |
| 只读路由范式 | `packages/api-contract/src/route-registry.ts` | `getSearch`、`getProjectActivity` 策略登记 |
| 路由命名风格 | `packages/api-contract/src/*-routes.ts` | operationId 命名对照 |
| 授权范围端口 | `apps/api/src/modules/projects/project-access.port.ts` | `ProjectAccessQueryPort` 与 `AuthorizedProjectScope` |
| 只读适配器范式 | `apps/api/src/modules/projects/postgres-project-query-port.ts` | 授权范围过滤写法与 `memberCount` 现成来源 |
