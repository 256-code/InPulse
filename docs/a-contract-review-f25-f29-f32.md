# F-25 / F-29 / F-32 契约评审裁决（A 岗）

| 字段 | 内容 |
| --- | --- |
| 裁决方 | A 岗 / 平台与访问域（F-07、F-11 契约平台） |
| 裁决对象 | [F-25 / F-29 / F-32 聚合读接口候选 DTO 与路由](./c-aggregate-read-contract-proposal.md)（C 岗提交，经 PR #89 合入 `3ef5553`） |
| 配套输入 | [F-29 / F-32 跨域只读端口扩展提案](./c-port-extension-proposal.md)（C 岗交 B 岗；本裁决同时对其 §7 的两处架构冲突给出结论） |
| 上游编号 | C-003（聚合接口缺口）、C-010（候选接口尚未冻结） |
| 文档性质 | 契约评审裁决记录；不是 ADR，不替代功能设计、系统设计、技术设计、权限矩阵或测试矩阵 |
| 状态 | 已裁决：C-003 / C-010 与 Q-01 ~ Q-15 全部给出结论；三条候选路由进入正式契约，并按 Q-02 新增第 4 条子资源路由 |
| 基线 | `origin/main` `fc7bb68`（F-20 PR #88 之后）；本文引用的代码事实均按该提交复核 |
| 落库状态 | 尚未登记 Route Registry。`contract:validate` 要求每条登记路由都有 Controller 绑定（`packages/api-contract/src/controller-bindings.ts:213`），而四条路由的聚合读依赖 B 域尚不存在的只读端口；登记、权限矩阵、测试矩阵、OpenAPI 与生成客户端必须与实现同一个 PR 落库，见 §7 |
| 当前日期 | 2026-09-10 |

## 1. 结论摘要

| 编号 | A 结论 | 要点 |
| --- | --- | --- |
| C-003 | 已接受（转具体 Route） | 四条路由 R-1 ~ R-4 进入正式契约；聚合读只允许 A/B 的公开只读端口组合，不接受 C 直读他域业务表 |
| C-010 | 已接受（转具体 Route，登记后关闭） | 路径、operationId、状态码、策略与字段名在本记录冻结；登记与生成物随实现 PR |
| Q-01 | 保持全局路径 | `GET /api/v1/task-groups/{groupId}`，项目归属由服务端反查 |
| Q-02 | 采纳形态 B | 新增 `GET /api/v1/task-groups/{groupId}/records`，沿用 C-006 envelope |
| Q-03 | 不扩大任务基础 DTO | 组信息只出现在 R-1 成员项（`role`）与 R-3 项（`groupRole`） |
| Q-04 | 采用 §29.1 有效任务口径 | 排除历史来源分支，活动来源分支计入 |
| Q-05 | 按行自身 `status = ACTIVE` 计数 | 与项目是否归档无关 |
| Q-06 | 默认 3 / 2，允许收口参数 | 上限 10，越界 422 |
| Q-07 | 由 B 域单条 SQL 实现 | 先过滤后分页；不转 ADR |
| Q-08 | 固定「负责人 = 当前用户」 | 删除 `assigneeMe` 参数 |
| Q-09 | V1 只落 F-32 的 4 项筛选 | 其余筛选留给后续迭代 |
| Q-10 | 固定 `id DESC` | 不提供 `sort`；游标沿用 C-006 |
| Q-11 | 标记数据放 R-1 / R-3 | 与 Q-03 一致 |
| Q-12 | 拒绝路线 I 与路线 III | B 域单条 SQL 端口 + C 聚合服务组合 |
| Q-13 | `DRAFT` 不可见 | 只返回 `PUBLISHED` 与 `VOID` |
| Q-14 | 按快照语义标注 | 字段名保留 `Snapshot` 后缀 |
| Q-15 | 返回原始枚举 | 展示文案由前端映射 |

本轮不修改任何契约源与生成物：`packages/api-contract`、`apps/web/src/generated` 与 OpenAPI 均保持现状，避免出现「未实现却已登记」的正式契约。

## 2. 路由裁决

| 编号 | 方法 | 路径 | operationId | 状态码 | A 裁决 |
| --- | --- | --- | --- | --- | --- |
| R-1 | `GET` | `/api/v1/task-groups/{groupId}` | `getTaskGroup` | `200` / `401` / `404` / `500` | 接受全局路径；只返回组与成员，不内嵌记录 |
| R-2 | `GET` | `/api/v1/projects/{projectId}/overview` | `getProjectOverview` | `200` / `401` / `404` / `422` / `500` | 接受；新增两个可选收口参数（Q-06） |
| R-3 | `GET` | `/api/v1/me/tasks` | `listMyTasks` | `200` / `401` / `422` / `500` | 接受并收敛查询参数（Q-08、Q-09、Q-10） |
| R-4 | `GET` | `/api/v1/task-groups/{groupId}/records` | `listTaskGroupRecords` | `200` / `401` / `404` / `422` / `500` | 按 Q-02 新增；超出上游 §4.8.1 已登记的三条 |

四条都不登记 `403`：非成员项目或跨项目资源统一按「资源不存在」返回 `404`（AGENTS.md §7），`403` 只保留给「已登录但缺少全局权限」的场景，本组路由不涉及。

## 3. 策略登记（四条共用）

```ts
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
```

四条均为只读 `GET`、无 body、无版本头、无幂等键、无并发要求；策略按 `packages/api-contract/src/route-definition.ts` 的要求逐项显式声明，不使用隐式默认值。


## 4. Q-01 ~ Q-15 裁决

| 编号 | A 裁决 | 依据 | 落库动作 |
| --- | --- | --- | --- |
| Q-01 | 保持全局路径 `/api/v1/task-groups/{groupId}`，不改项目前缀 | 上游 §4.8.1 已登记该形态；已落库的 `POST /api/v1/task-groups/unmerge` 同样由服务端按任务 ID 全局解析归属；组 ID 全局唯一，加项目前缀会让「查看主任务」入口多一次归属查询 | 路径与 operationId 不变；服务端由 groupId 反查 project_id 后按实时成员关系授权，非成员与不存在统一 `404` |
| Q-02 | 采纳形态 B：新增子资源分页路由，R-1 不内嵌记录 | 聚合组记录数没有业务上限，形态 A 的响应体会随历史无限增长；「按成员任务筛选」必须服务端过滤；C-006 的 `{ items, nextCursor, hasMore }` 已定案 | 新增 R-4：查询参数 `memberTaskId?` / `cursor?` / `limit?`，`limit` 默认 20、上限 100 |
| Q-03 | 不扩大任务基础 DTO | `packages/api-contract/src/contracts/tasks.zod.ts` 已被 F-13 ~ F-20 多条路由与幂等重放叶子清单消费，扩大它需要同步全部消费方、权限矩阵与重放策略；F-25 步骤 3 的标记在聚合页内即可满足 | `role` 与 `publishedRecordCount` 只在 R-1 成员项、`groupRole` 只在 R-3 项；若后续要在模块任务列表展示标记，另开契约变更 |
| Q-04 | 采用功能设计 §29.1「有效任务」口径，排除历史来源分支 | §29.1 原文加上工作书 F-29 验收要求「统计口径与功能设计 §29 一致」；活动来源分支计入当前工作量 | 排除集合由 C 从其自有 `task_group_members` 计算后作为端口入参（见 Q-07、§6），不得在应用层过滤 |
| Q-05 | 是：按行自身 `status = 'ACTIVE'` 计数 | `module-read.port.ts` / `feature-read.port.ts` 的 `status` 取值与 `0000_initial.sql` 的 CHECK 一致；计数与项目是否归档无关，项目状态由 `project.status` 单独表达 | 由 B 的 `ModuleReadPort.count` / `FeatureReadPort.count` 按 project_id 提供 |
| Q-06 | 接受默认 3 / 2，并提供收口参数 | 功能设计只给出示例条数，正式契约需要确定值与确定上限 | R-2 新增 `recentRecordLimit`（1..10，默认 3）与 `activeLeftoverLimit`（1..10，默认 2）；越界或非整数返回 `422` |
| Q-07 | 由 B 域在单条 SQL 内实现，不经 C 只读适配器 | AGENTS.md §3 规定跨域读只允许通过稳定 QueryPort；技术设计 §5.3 明确 TasksModule 不反向持有记录外键；C 端口提案 §7.1 已实测 `ChangeRecordsModule → TaskQueryPort` 依赖边 | B 新增承载该查询的只读端口（宿主模块见 §6）；查询先过滤后分页；不转 ADR |
| Q-08 | 固定为「负责人 = 当前用户」，删除该参数 | `/me` 语义不应接受他人身份；AGENTS.md §7 禁止用客户端提交的 `projectId` / 身份证明资源归属 | R-3 参数不含 `assigneeMe` / `userId` / `assigneeId` / `projectIds`；查看他人任务继续用已落库的 `listProjectMemberUnfinishedTasks` |
| Q-09 | V1 只落 F-32 要求的 4 项筛选 | 工作书 F-32 步骤 3；功能设计 §24.3 的其余 9 项没有当前消费场景，登记未实现参数会污染正式契约 | R-3 参数固定为 `cursor` / `limit` / `projectId` / `scopeType` / `workStatus` / `hasPublishedRecord`；其余筛选留待后续迭代 |
| Q-10 | 固定 `ORDER BY t.id DESC`，不提供 `sort` | 现有索引可命中 `ORDER BY t.id DESC`，`updated_at` 无可用索引（C 端口提案 §1.4）；游标约定沿用 C-006 | R-3 的 `limit` 默认 20、上限 100；游标签名绑定 actor 与筛选条件，TTL 15 分钟；无效、过期或越界返回 `422` |
| Q-11 | 与 Q-03 一致：标记数据放在 R-1 成员项与 R-3 项 | 既满足 F-25 步骤 3 的展示要求，又避免扩大被多条路由复用的任务基础 DTO | R-1 成员项保留 `role` 与 `publishedRecordCount`；R-3 项保留 `groupRole` |
| Q-12 | 拒绝路线 I 与路线 III；采用 B 域单条 SQL 端口加 C 聚合读服务组合 | AGENTS.md §3 的跨域读约束、系统设计 §6 模块职责表、工作书 F-29 步骤 2 的处方 | 见 §6；路线 IV（投影）保留为后续性能优化，不在 V1 |
| Q-13 | 不可见：只返回 `PUBLISHED` 与 `VOID` | 功能设计 §29.4 只把正式记录计入迭代历史；`change_records.status` 是详情、统计、搜索与时间线可见性的唯一真相（ADR-024） | R-4 响应不含 `DRAFT`；`code` 在非 `PUBLISHED` 场景按提案置空 |
| Q-14 | 接受，并在契约字段说明中标注快照语义 | `external_links` 保存的是关联时刻快照，不是远程实时状态 | 字段名保留 `titleSnapshot` / `stateSnapshot`，说明中标注「关联时刻快照」；前端不得用于实时状态判断 |
| Q-15 | 返回原始枚举 `ACTIVE \| ARCHIVED` | 功能设计 §9.5 的「正常」是展示文案；契约只承载数据，不承载文案 | 展示文案映射由前端负责；错误体 `message` 的交互语义属于上游 C-008，本轮不裁决 |


## 5. 对 C 提案 §6 三点评审请求的答复

1. **接受方式**：候选 DTO 直接进入 Schema Registry，不需要 ADR——Q-07 / Q-12 的跨域读归属已按 AGENTS.md §3 收口（见 §6）。但「登记」必须与实现同一个 PR：`contract:validate` 要求每条登记路由都有匹配的 Controller（`packages/api-contract/src/controller-bindings.ts:213`），`permissions:check` 要求 100% 登记，`contract:drift` 要求生成物与契约源一致；三者都不允许「先登记、后实现」。
2. **与现有路由的关系**：R-3 与 `GET /projects/{projectId}/members/{userId}/unfinished-tasks` 不合并、不共用查询实现。两者筛选维度不同（跨项目按负责人加记录维度，相对单项目按指定成员且不含记录维度），可以共享 B 的 `TaskQueryPort` 基础能力，但禁止把「查询他人任务」塞进 `/me/tasks`。
3. **命名规范**：`getTaskGroup` / `getProjectOverview` / `listMyTasks` 符合现有 operationId 规范（单资源用 `get`、列表用 `list`，匹配 `^[a-z][A-Za-z0-9]*$`）；新增 R-4 沿用同一规范，命名 `listTaskGroupRecords`。

## 6. 跨域只读归属裁决（对应 C 端口提案 §7）

**冲突 A（`hasPublishedRecord` 的模块依赖环）**：不接受路线 I。承载该查询的端口必须落在 B 域内不产生 `TasksModule → ChangeRecordsModule` 反向依赖的一侧；现存依赖边是 `ChangeRecordsModule → TaskQueryPort`（`apps/api/src/modules/change-records/record-publication-access.ts:13`），实现放在记录侧（或 B 域内新增的只读查询模块）不需要反转任何方向。宿主模块由 B 在实现 PR 决定，但必须满足：单条 SQL、先过滤后分页、`check:deps` 无新增环，并在 PR 中写明选择理由与拒绝另一侧的理由。

**冲突 B（§29.1 历史来源分支口径跨域）**：`task_group_members` 是 C 域表，排除集合由 C 在只读事务内计算后作为端口入参传给 B，SQL 在 B 内以 `AND t.id <> ALL($excluded)` 形式应用，保证先过滤后分页；禁止在应用层过滤后分页。若排除集合存在无界风险，B 端口必须给出上限并在超限时返回 `422`，上限值与 `EXPLAIN (ANALYZE, BUFFERS)` 依据由 B 在实现 PR 提供。

**处方偏差（需非作者人工确认）**：工作书 F-32 步骤 1 要求「通过 TasksModule 公开的只读 Port 提供服务端聚合与分页」。本裁决把 my-tasks 查询端口的宿主放在 B 域记录侧，结果仍是同一域的公开只读端口、依赖方向不变，但宿主模块不同。该偏差按工作书 §6.3 的冲突顺序记录，需非作者人工在实现 PR 中确认；若人工不认可，退路是收窄 R-3 的 `hasPublishedRecord` 并在后续迭代按路线 IV 补投影。

**明确拒绝**：路线 III（C 聚合域直读 `tasks` / `change_records` 等 B 域业务表）违反 AGENTS.md §3，即使补 `check:deps` 表级断言也不采用。路线 IV（投影）正确但代价高于 V1 收益，保留为后续性能优化。

**附带要求**：C 的聚合读服务只允许调用 A 的 `ProjectAccessQueryPort` / `ProjectQueryPort` / `ProjectMembersQueryPort` 与 B 的公开 QueryPort，不导出 Repository、不进入任何命令的 `UnitOfWork`，查询前必须先取得 `AuthorizedProjectScope`。

## 7. 落库清单与依赖

| 责任方 | 交付物 | 验收 |
| --- | --- | --- |
| B（阻塞项，先做） | `ModuleReadPort.count`、`FeatureReadPort.count`、`TaskQueryPort` 列表与计数扩展（含 `excludedTaskIds` 入参）、新增 `ChangeRecordReadPort`（`countPublished` / `listRecentPublished` / `listActiveLeftovers`）、Q-07 的 my-tasks 查询端口 | 每个方法至少 1 条真实 PostgreSQL 集成测试（正常、空 `projectIds`、越权不返回、状态边界）；`projectIds` 为空返回空集且 `EXPLAIN` 无 `Seq Scan on tasks`；`check:deps` 无新增环；`count` 与不分页 `list` 口径一致（C 端口提案 §9.1） |
| A | Schema Registry（R-1 ~ R-4 请求与响应、错误引用）、Route Registry 全策略登记、[权限矩阵](./permissions.md) 四条、[测试矩阵](./test-matrix.md) 对应行、OpenAPI 与生成客户端再生成、Controller 绑定（`@Operation` 加 `ContractBody` / `ContractQuery` / `ContractPath`） | `pnpm contract:generate`、`pnpm contract:validate`、`pnpm contract:drift`、`pnpm permissions:check`、API 单测与真实 PostgreSQL 集成测试通过；四条路由与实现同一 PR |
| C | 聚合读服务（只调公开端口）、F-25 / F-29 / F-32 前端页面与 URL 筛选状态、Playwright 关键路径 | 无权限项目不返回任何条目且按 `404` 语义；统计分类口径与功能设计 §29 一致；无「按项目循环请求」（工作书 F-32 禁止事项） |

本节完成前，四条路由仍不是实现依据。C 可按 C 端口提案 §7.5 推进前端骨架与 URL 筛选状态，但不得创建生成客户端依赖、不得手工生成 OpenAPI 或客户端文件、不得提前登记路由。

## 8. 未关闭项与后续

- 上游 C-001、C-004、C-005、C-007、C-008 仍未裁决，不在本轮范围；其中 C-008（错误 `message` 的交互语义）与 Q-15 的展示映射相关，建议同一轮收口。
- R-4 超出上游 §4.8.1 已登记的三条候选，属于按 Q-02 裁决新增，需同步修订上游 §4.8.1。
- [权限矩阵](./permissions.md)与[测试矩阵](./test-matrix.md)在本轮保持现状，不预登记未实现路由。
- 未运行的门禁一律不得声称通过；本轮为文档裁决，不涉及代码、迁移、契约源与生成物。

## 9. 依据清单

| 依据 | 位置 | 用途 |
| --- | --- | --- |
| 候选 DTO 与问题清单 | [c-aggregate-read-contract-proposal.md](./c-aggregate-read-contract-proposal.md) | 裁决对象 |
| 跨域端口与冲突分析 | [c-port-extension-proposal.md](./c-port-extension-proposal.md) | Q-07 / Q-12 的事实链 |
| 跨域读约束与鉴权 | [AGENTS.md](../AGENTS.md) §3、§7 | 拒绝路线 III、统一 `404`、不信任客户端归属 |
| 统计口径 | [功能设计v1.1.md](../功能设计v1.1.md) §9.5、§29.1 ~ §29.4 | Q-04、Q-05、Q-13、Q-15 |
| 工作书处方与验收 | [开发工作书v1.0.md](../开发工作书v1.0.md) F-25、F-29、F-32、§6.3 | 路由范围、处方偏差记录 |
| 任务不反向持有记录外键 | [技术设计v1.2.2.md](../技术设计v1.2.2.md) §5.3 | Q-07 的依赖方向依据 |
| 契约与生成物门禁 | `packages/api-contract/src/controller-bindings.ts`、`scripts/validate.ts` | 登记必须与实现同 PR |
| 现有只读端口 | `apps/api/src/modules/tasks/task-query.port.ts`、`modules/module-read.port.ts`、`features/feature-read.port.ts`、`projects/project-query.port.ts`、`projects/project-members-query.port.ts` | 需要扩展或复用的端口 |
| 依赖边实测 | `apps/api/src/modules/change-records/record-publication-access.ts` | 冲突 A 的方向事实 |
| 搜索契约范式 | [frontend-generated-client-consumption-requirements.md](./frontend-generated-client-consumption-requirements.md) C-006 | 游标 envelope 与 TTL 约定 |
