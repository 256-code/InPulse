# F-29 项目概览 / F-32 我的任务 跨域只读端口扩展提案（提交给 B 的端口层评审输入）

| 字段 | 内容 |
| --- | --- |
| 提交方 | C 岗 / 前端与聚合发现域（`@256-code`） |
| 接收方 | B 岗 / 任务与记录域；涉及架构冲突的部分需人工定案 |
| 文档性质 | 后端端口层评审输入，不是 ADR，不替代现有设计 |
| 状态 | 端口已由 C 代 B 实现（2026-09-10）；签名、事务约定与 SQL 骨架均已按本文档与 A 裁决 §6 落库，待非作者人工确认 |
| 当前日期 | 2026-09-10 |
| 基线 | 分支创建自 `origin/main` `77b2d7e`（F-09 PR #83）；§1 的全部实测事实已按 `origin/main` `935844b`（F-19 PR #85、F-09 SEC PR #86、F-24 PR #87 之后）复核，分支合并前需 rebase |
| 依据 | 开发工作书 §6.1（接口责任）、工作书 F-29 / F-32、功能设计 §9.5 / §29、系统设计 §6（模块职责表） |
| 配套文档 | [F-25 / F-29 / F-32 聚合读接口候选 DTO 与路由](./c-aggregate-read-contract-proposal.md)（交 A，HTTP 契约层） |
| 目的 | 把 C 域 2 项硬阻塞（F-29、F-32）转成 B 可执行的接口工单，并把 2 处架构冲突交人工定案 |

> **C 代 B 实现回填（2026-09-10）**：B 无档期，经人工同意由 C 代为实现本提案的四个端口扩展，落库于 [PR #96](https://github.com/256-code/InPulse/pull/96)（`7f40763`）。
>
> 与本文档的差异有两处，均按 [A 的契约评审裁决](./a-contract-review-f25-f29-f32.md) §6 执行：
>
> 1. `hasPublishedRecord` 落在记录侧新增的 `MyTaskQueryPort`（`apps/api/src/modules/change-records/my-task-query.port.ts`），不放 `TaskQueryPort`，避免 `TasksModule → ChangeRecordsModule` 反向依赖；这是工作书 F-32 步骤 1「通过 TasksModule 公开的只读 Port」的**处方偏差**，需非作者人工在实现 PR 中确认。
> 2. 历史来源分支的排除集合由 C 计算后作为 `excludedTaskIds` 入参，在同一条 SQL 内先过滤后分页；上限 `TASK_EXCLUDED_IDS_MAX = 1000`，超限抛 `TaskListInputError` 并由应用层映射 422。
>
> 索引证据：四种查询形状（项目过滤列表、计数、负责人过滤列表、1000 条排除集合）在 `EXPLAIN (ANALYZE, BUFFERS)` 下均命中既有 `tasks_project_status_idx` / `tasks_assignee_status_idx`，无 `Seq Scan on tasks`，因此未新增数据库迁移。

> **与契约提案的分工**：本文档只处理**后端端口层**（TypeScript 端口签名、事务约定、索引证据、SQL 骨架），交付对象是 B；HTTP 路由、状态码与请求/响应 DTO 属于**契约层**，见[配套契约提案](./c-aggregate-read-contract-proposal.md)，交付对象是 A。两条通道的结论必须一致：若 A 的契约裁决改变路由形态（例如聚合组记录列表改子资源分页），本文档对应部分需同步修订。

---

## 0. 结论摘要

| # | 端口 | 提供方 | 现状 | 需要新增 | 解锁 | 人日 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `ModuleReadPort` | B | 仅 `find` | 项目内按状态计数 | F-29 | 0.1 |
| 2 | `FeatureReadPort` | B | 仅 `find` | 项目内按状态计数 | F-29 | 0.1 |
| 3 | `TaskQueryPort` | B | 3 个单任务方法 | 跨项目列表 + 计数 + 筛选 + 签名游标 | F-29 / F-32 | 0.3 |
| 4 | `ChangeRecordReadPort` | B | **完全不存在** | 记录计数 / 最近迭代 / 待处理遗留问题 / 任务关联 | F-29 | 0.4 |
| — | 合计 | — | — | — | 解锁 C 的 2.3 人日 | **≈0.9** |

**两处必须人工定案的架构冲突 + 一处处方替代**（详见 §7）：

- **冲突 A**：F-32 的「是否有迭代记录」筛选同时命中 `tasks`（B）与 `change_records`（B），若由 `TaskQueryPort` 承载会与 `ChangeRecordsModule → TaskQueryPort` 形成**模块依赖环**。
- **冲突 B**：功能设计 §29.1「有效任务」要求排除**历史来源分支**，该口径落在 `task_group_members`（**C 域**），单靠任一域的端口无法表达。
- **处方替代**：工作书 F-32 步骤 1 要求「通过 TasksModule 公开的只读 Port」提供服务端聚合，路线 III 改由 C 聚合域承载 F-32，属**替代该处方**，须在 ADR 中显式写明（§7.4）。

**推荐路线**（已被 2026-09-10 的 A 裁决取代，见本节末的裁决回填）：拆分——提案 1/2/4 按本文件实现（无争议）；提案 3 只提供**域内可表达**的部分；F-32 的完整口径按 §7.3 路线 III 由 C 的聚合域承载并走 ADR 备案（含替代工作书 F-32 步骤 1 的处方，见 §7.4）。

**★ 好消息（§1.4）**：四个提案所需索引**已全部存在于 `0000`-`0002`**，因此**不需要任何数据库迁移**；唯一约束是提案 3 的排序应选 `ORDER BY t.id DESC`。

> **A 裁决回填（2026-09-10）**：本文档 §7 的两处冲突已由 A 裁决，结论与本文推荐路线不同——**不接受路线 I 与路线 III**。冲突 A 由 B 域内不产生反向依赖的一侧承载（记录侧或 B 域新增只读查询模块），冲突 B 的排除集合改由 C 从其自有 `task_group_members` 计算后传入 B 端口，在单条 SQL 内先过滤后分页；工作书 F-32 步骤 1 的处方偏差改为「同一域内的公开只读端口、宿主模块不同」，仍需非作者人工在实现 PR 中确认。完整结论见 [A 的契约评审裁决](./a-contract-review-f25-f29-f32.md) §6；本文件 §7.4 结尾另有一份同内容的回填。

---

## 1. 实测现状（按 `origin/main` `935844b` 复核）

### 1.1 四个端口的真实签名

**`ModuleReadPort`** — `apps/api/src/modules/modules/module-read.port.ts`

```ts
export interface ModuleReadResource {
  readonly moduleId: number;
  readonly projectId: number;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
}
export abstract class ModuleReadPort {
  abstract find(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
  ): Promise<ModuleReadResource | undefined>;
}
```

**`FeatureReadPort`** — `apps/api/src/modules/features/feature-read.port.ts`

```ts
export interface FeatureReadResource {
  readonly featureId: number;
  readonly projectId: number;
  readonly moduleId: number;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
  readonly createdBy: number;
}
export abstract class FeatureReadPort {
  abstract find(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    featureId: number,
  ): Promise<FeatureReadResource | undefined>;
}
```

**`TaskQueryPort`** — `apps/api/src/modules/tasks/task-query.port.ts`（63 行）

```ts
export interface TaskReadModel {
  taskId: number; projectId: number; moduleId: number;
  featureId: number | null; scopeType: "FEATURE" | "MODULE";
  code: string; title: string; creatorId: number; assigneeId: number;
  workStatus: "TODO" | "DONE" | "CANCELED";
  lifecycleStatus: "ACTIVE" | "ARCHIVED" | "INVALID";
  rowVersion: number; impactFeatureIds: number[];
}
export abstract class TaskQueryPort {
  abstract findByTaskId(tx, taskId): Promise<TaskReadModel | undefined>;
  abstract find(tx, projectId, taskId): Promise<TaskReadModel | undefined>;
  abstract lock(tx, projectId, taskId): Promise<TaskReadModel | undefined>;
}
```

**`ChangeRecordReadPort`** — **不存在。** `apps/api/src/modules/change-records/index.ts` 共 5 条导出：

```ts
export * from "./record-draft.port.js";          // RecordDraftQueryPort / RecordDraftCommandPort
export { RecordDraftsModule } from "./record-drafts.module.js";
export { RecordDraftError } from "./record-drafts.service.js";
export * from "./record-publication.port.js";    // RecordPublicationCommandPort
export * from "./published-records.module.js";   // PublishedRecordsModule（exports 仅写端口）
```

其中只有三个 Port，且都不是项目维度只读：`RecordDraftQueryPort` / `RecordDraftCommandPort`（任务 / 记录维度的草稿）与 `RecordPublicationCommandPort`（写）；`PublishedRecordsModule` 的 `exports` 也只有 `RecordPublicationCommandPort`。**没有项目维度的已发布记录只读 Port**——记录域内部的 `PublishedRecordReadService` 不是 Port 也未导出，见 §6.1。

### 1.2 各端口消费方现状

| 端口 | 现消费方（模块 / 工作流） | 用途 |
| --- | --- | --- |
| `ModuleReadPort` | Features（`features-management.service.ts`，F-13）、Tasks（`tasks-management.service.ts`，F-14/F-15）、ChangeRecords（`record-drafts.service.ts`，F-17/F-18） | 单模块读 |
| `FeatureReadPort` | Tasks（`tasks-management.service.ts`，F-14/F-15）、ChangeRecords（`record-drafts.service.ts`、`record-publication.service.ts`，F-17/F-18） | 单功能读 |
| `TaskQueryPort` | TaskGroups（`task-groups.service.ts`，F-23/F-24）、ChangeRecords（`record-publication-access.ts`，F-18）、Workflows（`task-completion.workflow.ts` F-16/F-19、`task-record-draft.workflow.ts` F-17） | 单任务预读/锁/校验 |
| `ChangeRecordReadPort` | — | — |

### 1.3 已存在、可直接复用的能力（无需 B 新增）

| 能力 | 提供方 | 现状 | C 的用途 |
| --- | --- | --- | --- |
| `ProjectAccessQueryPort.getAuthorizedSearchScope(actorUserId)` | A | ✅ 已交付，返回 `AuthorizedProjectScope { actorUserId, projectIds, isSystemAdmin }` | F-29 / F-32 的**服务端授权范围** |
| `ProjectQueryPort.list(projectIds)` | A | ✅ 已交付，返回 `ProjectItem`（**含 `memberCount`**） | F-29 的「成员：8 人」 |
| `task_group_members` 表 | **C 自己** | ✅ F-23 已建 | §29.1 历史来源分支排除 |
| `search_projection` | C 自己 | ✅ 已交付；含 `CHANGE_RECORD` 行但**无 assignee / work_status** | ❌ 不可用于 F-32 |

> ⇒ **实际缺口比预想的小**：A 侧端口齐全，F-29 的「成员数」已现成。

### 1.4 ★ 现有索引证据：B 侧已为这些查询预留索引

实测 `0000_initial.sql` / `0001` / `0002`，以下索引**已存在**，说明 F-29 / F-32 的查询模式在建模阶段已被预见：

| 索引 | 定义 | 服务的本次查询 |
| --- | --- | --- |
| `tasks_project_status_idx` | `(project_id, lifecycle_status, work_status, id)` | **提案 3** 项目范围 + 状态筛选 + 按 `id` 排序 |
| `tasks_assignee_status_idx` | `(assignee_id, work_status, id)` | **提案 3**「负责人=我」（前导列即 `assignee_id`，天然跨项目） |
| `features_module_status_idx` | `(project_id, module_id, status, id)` | **提案 2** 项目/模块范围 + 状态计数 |
| `change_records_project_status_idx` | `(project_id, status, id)` | **提案 4** `countPublished` |
| `change_record_leftovers_record_status_idx` | `(project_id, record_id, status, id)` | **提案 4** `listActiveLeftovers` |
| `change_records_project_task_idx` | `(project_id, task_id, id) WHERE task_id IS NOT NULL` | **任务历史查询**（技术设计 §L890 明文：「非唯一索引 `(project_id, task_id)` 支持任务历史查询」）|
| `modules_project_order_idx` | `(project_id, sort_order, id)` | **提案 1** 项目前缀（无 status 列，见下）|

**三条推论（已写入后续章节）**：

1. **提案 3 的排序应选 `ORDER BY t.id DESC`**，可直接命中上表前两条索引，**无需新迁移**；若产品要求按 `updated_at` 排序，则需 B 在新迁移中补索引（`0000`-`0005` 不得改写）。
2. **`modules` 表没有 status 复合索引**（只有 `(project_id, sort_order, id)`）。因模块在单项目内为数十条量级，`project_id` 前缀已足够，**不需要新索引**。
3. `change_records_project_task_idx` 的列序 `(project_id, task_id, id)` **可以**支撑「给定项目 + 任务」的 `EXISTS` 探针（`status` 不在索引列中，需回表确认 `PUBLISHED`），因此该索引**不是** F-32「任务是否有记录」筛选的阻塞点；真正的阻塞是 §7.1 冲突 A 的模块依赖环与 §7.2 冲突 B 的口径归属。

---

## 2. 需求 → 端口映射矩阵（★核心）

### 2.1 F-29 项目概览（功能设计 §9.5）

| 展示项 | 数据来源表 | 归属域 | 现有端口 | 需要 |
| --- | --- | --- | --- | --- |
| 项目名 / 状态 | `projects` | A | `ProjectQueryPort.list` | ✅ 已够 |
| 成员：N 人 | `project_members` | A | `ProjectQueryPort.list`（`memberCount`） | ✅ 已够 |
| **活跃模块数** | `modules` | B | `ModuleReadPort.find` | **提案 1** |
| **活跃功能数** | `features` | B | `FeatureReadPort.find` | **提案 2** |
| **未完成任务** | `tasks` + `task_group_members` | B + **C** | — | **提案 3 + 冲突 B** |
| **迭代记录数** | `change_records`（`status='PUBLISHED'`） | B | — | **提案 4** |
| **最近迭代** | `change_records` + `change_record_versions` | B | — | **提案 4** |
| **待处理遗留问题** | `change_record_leftover_items`（`status='ACTIVE'`） | B | — | **提案 4** |

### 2.2 F-32 我的任务（工作书 F-32）

| 需求 | 数据来源表 | 归属域 | 需要 |
| --- | --- | --- | --- |
| 跨项目列表 + 服务端分页 | `tasks` | B | **提案 3** |
| 筛选：任务状态 | `tasks.work_status` | B | 提案 3 |
| 筛选：任务范围 | `tasks.scope_type` | B | 提案 3 |
| 筛选：负责人=我 | `tasks.assignee_id` | B | 提案 3 |
| **筛选：是否有迭代记录** | `change_records.task_id` | B | **提案 4 + 冲突 A** |
| 口径：排除历史来源分支 | `task_group_members` | **C** | **冲突 B** |
| 权限过滤 | `project_members` | A | ✅ `AuthorizedProjectScope` 已够 |

**工作书 F-32 硬约束（原文）**：

> 1. 通过 TasksModule 公开的只读 Port 提供**服务端聚合与分页**（权限过滤由服务端按成员关系执行）。
> 禁止事项：**禁止在本页面按项目逐次请求后前端合并全量数据。**

⇒ 前端拼装被明确禁止；处方指向 TasksModule 的公开只读 Port，它与推荐路线 III 的替代关系见 §7.4。

---

## 3. 提案 1：`ModuleReadPort` 扩展（B）

**目标**：F-29「活跃模块数」。

```ts
export interface ModuleCountInput {
  readonly projectId: number;
  /** 省略 = 不计状态 */
  readonly status?: "ACTIVE" | "ARCHIVED";
}

export abstract class ModuleReadPort {
  abstract find(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
  ): Promise<ModuleReadResource | undefined>;

  /** 新增：项目内模块计数。调用方必须先完成项目授权。 */
  abstract count(
    tx: TransactionContext,
    input: ModuleCountInput,
  ): Promise<number>;
}
```

**语义约束**

- 只读，不取锁；`tx` 仅用于与调用方同一 `TransactionContext`，不得使用全局 Client。
- `find` 现有注释「includes archived history」保持不变：`count` **不省略归档行**，由 `status` 参数决定。
- 不校验项目授权（与 `find` 一致，调用方负责）。
- 返回 `number`（`COUNT(*)::integer`），不是字符串。

**建议 SQL 骨架**

```sql
SELECT COUNT(*)::integer
  FROM app.modules
 WHERE project_id = $1
   AND ($2::text IS NULL OR status = $2)
```

**索引**：命中现有 `modules_project_order_idx (project_id, sort_order, id)` 的项目前缀。模块在单项目内为数十条量级，**不需要新增索引、不需要新迁移**。

**为什么必须是 B 提供**：`app.modules` 属于 ModulesModule；C 读该表违反 AGENTS.md §3「跨域读只允许通过稳定 QueryPort」。

---

## 4. 提案 2：`FeatureReadPort` 扩展（B）

**目标**：F-29「活跃功能数」（跨模块汇总）。

```ts
export interface FeatureCountInput {
  readonly projectId: number;
  /** 省略 = 项目内全部模块 */
  readonly moduleId?: number;
  readonly status?: "ACTIVE" | "ARCHIVED";
}

export abstract class FeatureReadPort {
  abstract find(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    featureId: number,
  ): Promise<FeatureReadResource | undefined>;

  /** 新增：项目（可选模块）内功能计数。调用方必须先完成项目授权。 */
  abstract count(
    tx: TransactionContext,
    input: FeatureCountInput,
  ): Promise<number>;
}
```

**要点**

- `moduleId` 可选是**必须**的：F-29 要项目级汇总，F-25/F-29 未来可能要模块级。
- 复合外键与 `features_module_status_idx (project_id, module_id, status, id)` 已存在，SQL 必须同时带 `project_id` 与 `module_id`（防止跨项目串联），可完整命中索引。
- 语义与提案 1 对齐：只读、不取锁、返回 `number`。

---

## 5. 提案 3：`TaskQueryPort` 扩展（B）

**目标**：F-32 跨项目列表 + 分页 + 3 项域内筛选；F-29「未完成任务」计数。

### 5.1 建议接口

```ts
export type TaskWorkStatus = "TODO" | "DONE" | "CANCELED";
export type TaskLifecycleStatus = "ACTIVE" | "ARCHIVED" | "INVALID";
export type TaskScopeType = "FEATURE" | "MODULE";

export interface TaskListFilter {
  /** 服务端生成的授权项目范围。空数组 = 返回空页（不得退化为全量）。 */
  readonly projectIds: readonly number[];
  readonly assigneeId?: number;
  readonly workStatuses?: readonly TaskWorkStatus[];
  readonly scopeTypes?: readonly TaskScopeType[];
  /**
   * §29.1「有效任务」的 B 侧可表达部分：
   *   lifecycle_status <> 'INVALID' AND work_status <> 'CANCELED'
   * 不含「非历史来源分支」——该字段在 C 域，见 §7 冲突 B。
   */
  readonly effectiveOnly?: boolean;
}

export interface TaskListRow {
  readonly taskId: number;
  readonly projectId: number;
  readonly moduleId: number;
  readonly featureId: number | null;
  readonly scopeType: TaskScopeType;
  readonly code: string;
  readonly title: string;
  readonly assigneeId: number;
  readonly workStatus: TaskWorkStatus;
  readonly lifecycleStatus: TaskLifecycleStatus;
  readonly rowVersion: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface TaskListPageInput extends TaskListFilter {
  /** 1..100，越界由契约层拒绝 */
  readonly limit: number;
  /** SearchQueryService 同款不透明签名游标 */
  readonly cursor?: string;
}

export interface TaskListPage {
  readonly items: readonly TaskListRow[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export abstract class TaskQueryPort {
  // ... 现有 3 个方法保持不变 ...

  /** 新增：跨项目分页列表 */
  abstract list(
    tx: TransactionContext,
    input: TaskListPageInput,
  ): Promise<TaskListPage>;

  /** 新增：与 list 同口径的计数（不分页） */
  abstract count(
    tx: TransactionContext,
    filter: TaskListFilter,
  ): Promise<number>;
}
```

### 5.2 语义约束（必须写进 Port 注释）

1. **`projectIds` 必须来自 `AuthorizedProjectScope.projectIds`**，Port 不再校验成员关系（与 `ProjectQueryPort.list` 同一约定）。
2. **`projectIds.length === 0` 必须短路返回空页 / 0**，不得退化为无 `WHERE` 的全表扫描。可参照 `PostgresProjectQueryPort.list` 的现有实现。
3. **非管理员也不得跨出 `projectIds`**：任何情况下 `WHERE project_id = ANY($1::integer[])` 都是硬条件。
4. **排序必须稳定且命中索引**：`ORDER BY t.id DESC`（`id` 是 `tasks_project_status_idx` 与 `tasks_assignee_status_idx` 的末列，可完全命中），避免分页重复/丢行。
   > 若产品要求「按最近更新排序」，需改用 `ORDER BY t.updated_at DESC, t.id DESC`，此时 B 必须在新迁移中补 `(project_id, assignee_id, updated_at DESC, id DESC)` 复合索引；**不得改写 `0000`-`0005`**（AGENTS.md §6）。建议 V1 先用 `id DESC` 以免新增迁移。
5. **游标必须服务端签名**：复用 `apps/api/src/modules/search/search-cursor.ts` 的既有实现，不新增一套。
6. **不取锁**：`list` / `count` 是纯读，不得 `FOR SHARE`/`FOR UPDATE`。
7. **不得返回内部字段**：`TaskListRow` 是端口内部契约，C 侧应用层再映射为 API DTO；不得直接把 `TaskListRow` 当 HTTP 响应。

### 5.3 建议 SQL 骨架

```sql
SELECT t.id            AS "taskId",
       t.project_id    AS "projectId",
       t.module_id     AS "moduleId",
       t.feature_id    AS "featureId",
       t.scope_type    AS "scopeType",
       t.code, t.title,
       t.assignee_id   AS "assigneeId",
       t.work_status   AS "workStatus",
       t.lifecycle_status AS "lifecycleStatus",
       t.row_version   AS "rowVersion",
       t.created_at    AS "createdAt",
       t.updated_at    AS "updatedAt"
  FROM app.tasks t
 WHERE t.project_id = ANY($1::integer[])
   AND ($2::integer IS NULL OR t.assignee_id = $2)
   AND ($3::text[] IS NULL OR t.work_status = ANY($3::text[]))
   AND ($4::text[] IS NULL OR t.scope_type = ANY($4::text[]))
   AND ($5::boolean IS NOT TRUE
        OR (t.lifecycle_status <> 'INVALID' AND t.work_status <> 'CANCELED'))
   AND ($6::boolean IS NOT TRUE OR t.id < $7::integer)
 ORDER BY t.id DESC
 LIMIT $8
```

**索引**：`tasks_project_status_idx (project_id, lifecycle_status, work_status, id)` 与 `tasks_assignee_status_idx (assignee_id, work_status, id)` **均已存在**，`assigneeId` 有值时走后者、否则走前者，**不需要新增索引或迁移**。

**验收要求**：集成测试需对「`assigneeId` 有值」与「无值」两条路径各跑一次 `EXPLAIN (ANALYZE, BUFFERS)`，断言命中上述索引、无 `Seq Scan on tasks`。可参照 `database/poc/search-pgroonga` 的既有 `EXPLAIN` 断言写法。

### 5.4 现有 `find` / `lock` / `findByTaskId` 不动

F-23 / F-24 / F-17 / F-18 的现有调用点依赖当前语义（`findByTaskId` 的「项目无关预读」注释尤其重要），**本次扩展只增不改**。

---

## 6. 提案 4：`ChangeRecordReadPort`（B，全新）

**目标**：F-29 的「迭代记录数 / 最近迭代 / 待处理遗留问题」。

### 6.1 为什么是新端口而不是复用现有

- `RecordDraftQueryPort` 是**任务/记录维度**的草稿端口（`findDraft` / `listForTask`），不覆盖项目维度已发布记录。
- `RecordPublicationCommandPort` 是写端口。
- F-29 需要的是**项目维度的只读聚合**，语义完全不同。
- 记录域内部已有 `PublishedRecordReadService`（`published-record-read.service.ts`）：其 `read(actorId, projectId, recordId?, versions?, versionNo?)` 在 `recordId` 省略时会列出项目全部已发布记录（`ORDER BY published_at DESC, id DESC`）。但它不是 Port、未被 `PublishedRecordsModule.exports` 暴露（跨域 import 属访问模块内部实现），返回的是含 payload 的完整记录 DTO，既无 `limit`、也无模块 / 功能 / 范围筛选与计数，无法承载 F-29 的「迭代记录数 / 最近迭代 / 待处理遗留问题」。

### 6.2 建议接口

```ts
/** 只统计 status='PUBLISHED' 的正式记录；DRAFT / VOID 不计。 */
export interface RecordCountInput {
  readonly projectId: number;
  /** 省略 = 项目内全部 */
  readonly moduleId?: number;
  readonly featureId?: number;
  readonly scopeType?: TaskScopeType;
}

export interface RecentRecordItem {
  readonly recordId: number;
  readonly projectId: number;
  readonly moduleId: number;
  readonly featureId: number | null;
  readonly code: string;
  readonly title: string;
  readonly currentVersion: number;
  readonly publishedAt: Date;
  /** 所属功能名，用于「微信支付退款回调」这类展示 */
  readonly featureName: string | null;
}

export interface LeftoverItemSummary {
  readonly leftoverItemId: number;
  readonly recordId: number;
  readonly projectId: number;
  readonly content: string;
  readonly createdAt: Date;
}

export abstract class ChangeRecordReadPort {
  /** F-29「迭代记录数」。只计 PUBLISHED，版本不重复计数（功能设计 §29.4）。 */
  abstract countPublished(
    tx: TransactionContext,
    input: RecordCountInput,
  ): Promise<number>;

  /** F-29「最近迭代」列表。按 published_at DESC, id DESC 稳定排序。 */
  abstract listRecentPublished(
    tx: TransactionContext,
    input: RecordCountInput & { readonly limit: number },
  ): Promise<readonly RecentRecordItem[]>;

  /** F-29「待处理遗留问题」。只取 status='ACTIVE'。 */
  abstract listActiveLeftovers(
    tx: TransactionContext,
    input: RecordCountInput & { readonly limit: number },
  ): Promise<readonly LeftoverItemSummary[]>;

  // 冲突 A 需要的方法（见 §7.1）：
  /** 给定任务集合，返回其中有正式记录的任务 ID。 */
  abstract listTaskIdsWithPublishedRecords(
    tx: TransactionContext,
    projectIds: readonly number[],
    taskIds?: readonly number[],
  ): Promise<readonly number[]>
}
```

### 6.3 关键口径（来自功能设计 §29.4）

| 规则 | 实现要求 |
| --- | --- |
| 功能直接记录计 1 条 | `COUNT(*)` 直接计数 |
| 功能级任务产生的记录计 1 条 | 同上，不按 `task_id` 去重 |
| **模块级记录在多个功能页面引用时仍计 1 条** | 计数**不得** join `change_record_feature_impacts`；按 `change_records.id` 去重 |
| **记录版本不增加迭代记录数量** | 计数基于 `change_records`，**不得**基于 `change_record_versions` |
| 遗留问题 | `change_record_leftover_items.status = 'ACTIVE'`（另有 `CONVERTED` / `RESOLVED`） |

**索引**：`change_records_project_status_idx (project_id, status, id)` 服务 `countPublished` 与 `listRecentPublished`；`change_record_leftovers_record_status_idx (project_id, record_id, status, id)` 服务 `listActiveLeftovers`。**均已存在，不需要新迁移。**

### 6.4 遗留问题内容字段

`change_record_leftover_items` 表本身**没有内容列**（只有 `id/record_id/project_id/status/created_by/row_version/created_at/updated_at`），内容在版本快照表 `change_record_version_leftovers.content_snapshot`。

⇒ `LeftoverItemSummary.content` 需取**该遗留项最新版本**的快照：

```sql
SELECT li.id AS "leftoverItemId",
       li.record_id AS "recordId",
       li.project_id AS "projectId",
       vl.content_snapshot AS content,
       li.created_at AS "createdAt"
  FROM app.change_record_leftover_items li
  JOIN LATERAL (
    SELECT content_snapshot
      FROM app.change_record_version_leftovers v
     WHERE v.leftover_item_id = li.id
     ORDER BY v.version_no DESC
     LIMIT 1
  ) vl ON TRUE
 WHERE li.project_id = $1
   AND li.status = 'ACTIVE'
 ORDER BY li.created_at DESC, li.id DESC
 LIMIT $2
```

> ⚠️ 需 B 确认：`change_record_version_leftovers` 是否总是先于或同时于 item 存在。若存在无版本快照的遗留项，应改用 `LEFT JOIN LATERAL` 并允许 `content` 可空，或由 B 说明不变量。

---

## 7. ★ 必须人工定案的架构冲突与处方替代

### 7.1 冲突 A：`hasRecord` 筛选会造成模块依赖环

**事实链（全部实测）**：

1. F-32 要求按「是否有迭代记录」筛选（工作书 F-32 步骤 3）。
2. 「有记录」= `EXISTS (SELECT 1 FROM app.change_records WHERE task_id = t.id AND status = 'PUBLISHED')`。
3. 系统设计 §6 模块职责表明确：`ChangeRecordsModule` 的依赖包含 **`TaskQueryPort`**（仅发布校验，系统设计 L380、L719）—— 已实测确认是 `record-publication-access.ts`（`import { TaskQueryPort } from "../tasks/index.js"`，L13）依赖 Tasks 域，端口文件 `record-publication.port.ts` 本身不依赖 Tasks。
4. 若把 `hasRecord` 放进 `TaskQueryPort`（TasksModule），则 TasksModule 需读 `change_records` ⇒ **TasksModule → ChangeRecordsModule**。技术设计 §L890 也明确「**TasksModule 不反向持有记录外键**；设置或改写 `task_id` 是跨域写，只能由 Workflow 调用 ChangeRecords CommandPort」，即该依赖方向在技术设计中已被显式排除。

⇒ **形成 `Tasks ↔ ChangeRecords` 双向依赖**，违反 AGENTS.md §3「禁止循环依赖」与 §11「反向/循环依赖」审查项。

**同理**：冲突 B 若放进 `TaskQueryPort`，则 TasksModule 需读 `task_group_members`，而 `TaskGroupsModule → TaskQueryPort` 已存在 ⇒ **同样是环**。

### 7.2 冲突 B：§29.1「有效任务」口径跨 C 域

功能设计 §29.1 原文：

> 默认有效任务：未被标记无效 且未取消 **且不是历史来源分支**

- 「未被标记无效」= `tasks.lifecycle_status <> 'INVALID'` → **B**
- 「未取消」= `tasks.work_status <> 'CANCELED'` → **B**
- 「不是历史来源分支」= `task_group_members.source_kind = 'HISTORICAL' AND status = 'ACTIVE'` → **C 自己的表**

实测约束佐证：`task_group_members_source_kind_check` 允许 `NULL | 'ACTIVE' | 'HISTORICAL'`，且 `role='MAIN'` 时 `source_kind` 必须为 `NULL`。

⇒ 完整口径需要**同时访问 B 与 C 的表**。分页正确性（先过滤后分页）要求**单条 SQL 内完成**，跨域两端拼装在应用层会破坏分页语义。

### 7.3 三条路线对比

| 路线 | 做法 | 分页正确性 | 架构合规 | 工作量 | 风险 |
| --- | --- | --- | --- | --- | --- |
| **I** 全部塞进 `TaskQueryPort` | B 在 Tasks 内读 `change_records` + `task_group_members` | ✅ | ❌ **双向依赖环**（写成 Port 导入时才被门禁看见，见 §7.4） | 0.5 | 高：违反 AGENTS.md §3/§11 |
| **II** 双端口 + C 应用层拼装 | B 出 `TaskQueryPort.list` + `ChangeRecordReadPort.listTaskIdsWithPublishedRecords`，C 侧组合 | ❌ **过滤在分页后 → 结果错误** | ✅ | 0.9 | 中：需要 C 侧全量拉取或多次往返，F-32 明确禁止 |
| **III** C 聚合域只读适配器 + ADR | C 新建聚合域模块，其只读 PostgreSQL 适配器在**单条 SQL** 内组合 `tasks` + `change_records` + `task_group_members` | ✅ | ⚠️ **需 ADR 备案例外** | 1.0 | 低：只读、无写、不暴露 Repository、不调用其他域写服务 |
| **IV** C 建 `my_tasks_projection` 投影 | 仿 `search_projection`，由 B/A 的命令通过 C 的公开写端口维护 | ✅ | ✅ | 2.5+ | 高：需 B 在任务状态/指派/记录发布/合并/解除 5 类命令上都补写投影 |

### 7.4 推荐：路线 III，并明确其边界

**推荐理由**：

1. **工作书 F-29 步骤 2 明文授权**：

   > 实现服务端聚合接口（如必要）：**按依赖方向放在聚合域**或由对应领域提供只读 Port；禁止前端跨域拼装。

2. 仓库现有的跨域只读先例是**投影模式**，不是路线 III：`SearchProjectionModule` / `ActivityProjectionModule` 的 SQL 只出现本域表 `app.search_projection` / `app.activity_projection`（已实测），跨域数据由 B/A 在各自事务内调用 C 的公开写端口（`SearchProjectionWritePort` / `ActivityWritePort`）写入。即现有先例支持的是**路线 IV**；路线 III（直接读 B 域业务表）在仓库内**没有先例**，这正是它必须走 ADR 的原因。
3. 路线 I 是**唯一能塞进现有端口**的方案，但它制造依赖环，实际不可用。
4. 路线 II 破坏分页正确性，且 F-32 明文禁止前端/应用层合并全量。
5. 路线 IV 最合规但代价最高（≈2.5 人日且要改 5 类 B/A 命令），V1 不划算。

**路线 III 的 ADR 必须写明的边界**：

- 只读：适配器只发 `SELECT`，不给本模块分配任何写权限；
- 不暴露：聚合域**不导出**任何 Repository，只导出面向 Controller 的查询服务；
- 不绕过授权：每次查询必须先取 `AuthorizedProjectScope`，SQL 硬带 `project_id = ANY(projectIds)`；
- 白名单：ADR 中逐表列出允许读取的跨域表（`app.tasks`、`app.change_records`、`app.change_record_leftover_items`、`app.change_record_version_leftovers`、`app.modules`、`app.features`），**不得**读取其他域的业务写入表；
- 不参与写事务：聚合查询不得出现在任何命令的 `UnitOfWork` 内；
- 回归门禁：`check:deps` 需新增断言，禁止聚合域 import 其他域的 Repository 或写端口。

**★ `check:deps` 门禁能力的精确边界（实测 `scripts/check_dependencies.mjs`）**

现有脚本已有 11 类规则（`controller-database` / `backend-boundary` / `database-boundary` / `contract-boundary` / `web-layer` / `module-boundary` / `frontend-boundary` / `frontend-database` / `drizzle-orm` / `postgres` / `generated-client`）+ **自动循环检测 `findCycles`**。据此：

| 路线 | 现有 `check:deps` 能否拦住 |
| --- | --- |
| I（塞进 `TaskQueryPort`） | ⚠️ **只在依赖写成 Port 导入时能**：环由 `findCycles` 按**导入边**发现；若实现是 Tasks 内写裸 SQL 读 `change_records` / `task_group_members`，则既无导入边、也无表级规则，**同样查不出来**（与路线 III 的盲区相同） |
| II | — 无规则问题 |
| **III** | ❌ **不能**：`module-boundary` 只拦「访问其他模块的**内部实现**」（`target.local`）。聚合域只写裸 SQL、不 import B 的内部文件，因此**现行门禁查不出来** |
| IV | ✅ 投影表走公开写端口，天然合规 |

⇒ 路线 I 与路线 III 的机器可见性是**对称**的：`check:deps` 的 11 类规则与 `findCycles` 都只看导入边，**不检查 SQL 里出现哪张表**（已实测 `scripts/check_dependencies.mjs` 全文，无表级规则）。因此不推荐路线 I 的依据是它**本身违反 AGENTS.md §3 与系统设计 §6 的模块职责**，而不是「CI 必然变红」；同理，路线 III 的合规性靠**约定**而非**机器约束**，必须先立 ADR 并补 `check:deps` 断言，否则会成为长期架构债。

**★ 与工作书 F-32 步骤 1 的关系（需人工一并裁定）**：工作书 F-32 开发步骤 1 的原文是「通过 TasksModule 公开的只读 Port 提供服务端聚合与分页」，处方指向 B 的只读端口；只有 F-29 步骤 2 明确允许「按依赖方向放在聚合域或由对应领域提供只读 Port」。因此路线 III 对 F-29 是处方内选项，对 F-32 则**替代了工作书处方**：若人工批准由 C 聚合域承载 F-32，ADR 必须写明该替代关系与理由；若不批准，F-32 只能在路线 IV（投影）与「收窄到 B 域内可表达的筛选、把 `hasPublishedRecord` 移出 V1 范围」之间二选一。

**若人工裁定不允许路线 III**，则退路是：F-29 / F-32 降级为路线 IV（F-32 也可选择收窄筛选范围，见上条），并把两项功能的排期整体后移 ≥2.5 人日。

> **裁决回填（2026-09-10，A）**：§7.3 的四条路线中，**路线 I 与路线 III 均不被接受**；采纳的是「B 域单条 SQL 稳定只读端口 + C 聚合读服务组合」。冲突 A 的宿主模块由 B 在不产生 `TasksModule → ChangeRecordsModule` 反向依赖的前提下决定（现存依赖边是 `ChangeRecordsModule → TaskQueryPort`）；冲突 B 的排除集合由 C 从其自有 `task_group_members` 计算后作为端口入参，在 B 的 SQL 内先过滤后分页。工作书 F-32 步骤 1 的处方偏差按「同一域内的公开只读端口、宿主模块不同」记录，仍需非作者人工在实现 PR 中确认。路线 IV（投影）保留为后续性能优化，不在 V1。

### 7.5 在冲突裁定前，C 侧能先做的部分

即使冲突未裁定，以下工作**不受影响**，C 可立即开工：

- F-29 的**前端页面骨架**（统计卡片 + 最近迭代列表 + 遗留问题入口），数据源用 mock adapter 隔离；
- F-29 的「成员数 / 项目名 / 状态」——A 侧端口已齐，可直接落地；
- F-32 的**前端页面骨架 + URL 筛选状态**（F-30 规范：筛选状态由 URL 承载）；
- 契约层草案（`project-overview.zod.ts` / `my-tasks.zod.ts`），**不登记 Route Registry**（未实现路由不得提前登记）。

---

## 8. 工作量与排期建议

| 提案 | 提供方 | 人日 | 依赖 | 建议优先级 |
| --- | --- | --- | --- | --- |
| 1 `ModuleReadPort.count` | B | 0.1 | 无 | P1 |
| 2 `FeatureReadPort.count` | B | 0.1 | 无 | P1 |
| 3 `TaskQueryPort.list/count` | B | 0.3 | 无（`effectiveOnly` 只含 B 侧口径） | P1 |
| 4 `ChangeRecordReadPort` | B | 0.4 | 无（`listTaskIdsWithPublishedRecords` 可先实现） | P1 |
| 冲突 A/B 裁定 | **人工** | — | — | **P0 阻塞** |
| F-29 聚合域（路线 III 或 IV） | **C** | 1.0 | 裁定结果 + 端口 1/2/4 | P2 |
| F-32 聚合域（路线 III 或 IV） | **C** | 1.3 | 裁定结果 + 端口 3/4 | P2 |

**排期建议**

- **提案 1/2/3/4 合计 0.9 人日**，与冲突裁定**无耦合**，建议 B 立刻插队（这是 0.9 换 2.3 的杠杆）。
- 冲突 A/B 的裁定建议与 4 个端口提案**同批**提交人工，避免二次往返。
- C 侧在等待期按 §7.5 推进前端骨架，不阻塞。

---

## 9. 验收标准

### 9.1 端口层（B 侧）

| 检查 | 要求 |
| --- | --- |
| 真实 PostgreSQL 集成测试 | 每个新方法至少 1 条，覆盖：正常、空 `projectIds`、越权项目不返回、状态筛选边界 |
| `projectIds` 为空 | 返回 `[]` / `0`，**不得**全表扫描；用 `EXPLAIN` 断言无 `Seq Scan on tasks` |
| 排序稳定性 | V1 分页键是唯一列 `id`（`ORDER BY t.id DESC`），不存在并列键；连续两次分页无重复 / 丢行。若改按 `updated_at` 排序，必须补 `id` 兜底并按 §5.2 第 4 点新增复合索引 |
| 口径一致性 | `count` 与不分页 `list` 的 `items.length` 在同一 filter 下相等 |
| 只读性 | `pool` 断言无写语句；不取锁 |
| 依赖方向 | `check:deps` 通过，无新增环 |
| 契约完整性 | 若新增路由，`permissions:check` 必须 100% 登记；生成物无漂移 |

### 9.2 聚合层（C 侧）

| 检查 | 要求 |
| --- | --- |
| 授权 | 非成员项目的任务/记录/模块/功能**一个都不返回**；用「资源不存在」而非 403 |
| §29.1 口径 | 历史来源分支不计入「未完成任务」与完成率；活动来源分支计入（功能设计 §29.1/§29.2） |
| §29.4 口径 | 模块级记录在项目概览中只计 1 条；记录版本不增加迭代记录数 |
| §29.3 口径 | 模块级任务在项目概览计 1 个任务、1 条记录、N 个影响功能 |
| F-32 禁止事项 | 路由/服务中无「按项目循环请求」；一次请求只发一次数据库查询 |
| E2E | F-31 关键路径补 F-29 / F-32 用例（跨项目隔离、空态、分页、筛选组合） |

---

## 10. 附录：证据清单

| 依据 | 位置（已按 `origin/main` `935844b` 复核） |
| --- | --- |
| 接口责任表 | `开发工作书v1.0.md` §6.1 L457-466（`TaskQueryPort \| B \| C（F-23/F-24/F-32）`） |
| F-29 工作书 | `开发工作书v1.0.md` L406-431 |
| F-32 工作书 | `开发工作书v1.0.md` L441-449 |
| 项目概览展示内容 | `功能设计v1.1.md` §9.5（L887 起） |
| 统计口径 | `功能设计v1.1.md` §29（L3261 起） |
| 模块职责表 | `系统设计文档v1.0.2.md` §6（L707 起；模块职责表 L711 起，TasksModule L717、TaskGroupsModule L718、ChangeRecordsModule L719） |
| `TaskQueryPort` | `apps/api/src/modules/tasks/task-query.port.ts` |
| `ModuleReadPort` | `apps/api/src/modules/modules/module-read.port.ts` |
| `FeatureReadPort` | `apps/api/src/modules/features/feature-read.port.ts` |
| `ProjectAccessQueryPort` | `apps/api/src/modules/projects/project-access.port.ts` |
| `ProjectQueryPort.list` | `apps/api/src/modules/projects/postgres-project-query-port.ts`（`= ANY(projectIds::integer[])` 范式） |
| `ChangeRecords` 导出面 | `apps/api/src/modules/change-records/index.ts` |
| `change_records` 表 | `database/migrations/0000_initial.sql` |
| `task_group_members` 约束 | `database/migrations/0000_initial.sql`（`source_kind` CHECK、`_one_active_group_unique`） |
| 既有签名游标实现 | `apps/api/src/modules/search/search-cursor.ts` |
| 既有投影写端口范式 | `apps/api/src/modules/search/README.md` |
