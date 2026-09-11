# F-32 / F-29 与冻结聚合读契约的对齐（C 岗）

| 字段 | 内容 |
| --- | --- |
| 状态 | 本地已接线：R-1 ~ R-4 契约、后端与生成客户端随 [PR #97](https://github.com/256-code/InPulse/pull/97) 落库，F-29 / F-32 页面默认注入 server adapter（mock 仅保留测试与降级），专属 Playwright 关键路径已落库并以 [PR #98](https://github.com/256-code/InPulse/pull/98) 交付（全量 E2E 42/42）；2026-09-11 C-2 第二轮字段接线与降级清零已本地落库（R-2 / R-3 扩展全量接线，E2E 45/45，见 §2 / §3 / §5），GitHub Actions 尚未对本批执行 |
| 冻结依据 | [F-25 / F-29 / F-32 契约评审裁决](./a-contract-review-f25-f29-f32.md)（A 岗，`5563bcf`） |
| 落库状态 | 四条路由已登记（Route Registry 全策略、权限矩阵、OpenAPI 与生成客户端随实现同一 PR）；所依赖的 B 侧只读端口扩展（`TaskQueryPort` 列表/计数、`ChangeRecordReadPort`、`ModuleReadPort.count`、`FeatureReadPort.count`）已由 C 代 B 落库（PR #96），见[端口扩展提案的回填](./c-port-extension-proposal.md)；C 侧接线与测试证据见[测试矩阵](./test-matrix.md) 的 2026-09-11 增量段 |
| 当前日期 | 2026-09-11 |

## 1. 目的与边界

把设计师稿与前端骨架的筛选面、字段面与 A 已冻结的 R-2 / R-3 契约做显式对照，落成可执行映射与缺口清单，避免接线时出现「UI 有筛选但请求发不出去」或「字段没有来源」的静默分歧。

本文不是契约来源：路径、参数、状态码与字段名一律以裁决文档与 `packages/api-contract` 为准；本文只记录 C 侧的映射与缺口。2026-09-11 起登记、实现与生成物已按裁决 §7 在同一 PR 落库，本文保留映射与缺口清单作为对照。

## 2. R-3 `listMyTasks` 与 F-32 任务中心

冻结事实（裁决 §2、§3、Q-08 ~ Q-10）：`GET /api/v1/me/tasks`，参数只有 `cursor` / `limit` / `projectId` / `scopeType` / `workStatus` / `hasPublishedRecord`；负责人固定为当前用户；排序固定 `id DESC`；`limit` 默认 20、上限 100。

可执行映射见 `apps/web/src/features/my-tasks/my-tasks-v1-query.ts`：

| UI 筛选 | 冻结参数 | 说明 |
| --- | --- | --- |
| `scope=mine` | 无参数 | `/me` 语义即负责人=当前用户 |
| `scope=project` 且带 `project=<id>` | `projectId` | 服务端仍按实时成员关系复验归属 |
| `level` | `scopeType` | 同名枚举 `FEATURE` / `MODULE` |
| `status=open` / `done` | `workStatus=TODO` / `DONE` | 单值映射 |
| `status=all` | 不发送 `workStatus` | 返回全部状态 |
| `record=yes` / `no` | `hasPublishedRecord=true` / `false` | 记录筛选 |
| `limit` | `limit` | 非正整数回退 20，超过 100 收口到 100 |

第二轮扩展后 `priority`（单值）与 `includeCanceled`（与 `workStatus=TODO` 组合表达「未完成并含已取消」）已可表达；`listMyTasksV1Gaps` 仍返回 `scope=created`、`scope=all`、`scope=project` 未选项目、`relation`、`github`、`q`（关键词）6 项，UI 按 `MY_TASKS_V1_FILTER_SUPPORT`（`filter:priority` 与 `filter:canceled-with-open` 已翻为 true）显式禁用并标注。

响应与列表项缺口（C-2 后）：`stats` / `leftoverCount` / `leftoverSample` 与列表项 `priority` / `dueAt` / `completedAt` / `creatorId` / `githubLinkCount` / `groupId` 已接线；仅 `description`（A 裁决拒绝）与 `scopeCounts`（§10.3 延后）保留缺口常量 `MY_TASKS_V1_MISSING_ITEM_FIELDS` / `MY_TASKS_V1_MISSING_RESPONSE_PARTS` 作为入口，范围计数不渲染。

## 3. R-2 `getProjectOverview` 与 F-29 项目概览

冻结事实（裁决 §2、§3、Q-06、Q-13 ~ Q-15）：`GET /api/v1/projects/{projectId}/overview`；`recentRecordLimit` 默认 3、`activeLeftoverLimit` 默认 2，均为 1..10，越界或非整数返回 422；响应为 `project` / `memberCount` / `stats`（4 项）/ `recentRecords` / `activeLeftovers`；记录只含 `PUBLISHED` 与 `VOID`，不含 `DRAFT`。

可执行映射见 `apps/web/src/features/project-overview/project-overview-v1.ts`：

| 骨架内容 | 冻结来源 | 说明 |
| --- | --- | --- |
| 项目名、状态 | `project.name` / `project.status` | `status` 是 `ACTIVE` / `ARCHIVED` 原始枚举，展示文案由前端映射（Q-15） |
| 成员数 | `memberCount` | 也可继续走 A 的既有项目端口 |
| 活跃模块 / 活跃功能 / 未完成任务 / 迭代记录 | `stats.activeModuleCount` / `activeFeatureCount` / `openTaskCount` / `publishedRecordCount` | 口径见功能设计 §29.1 的有效任务 |
| 最近迭代 | `recentRecords` | 无损映射为骨架视图字段（`moduleId` / `featureId` 不进入视图） |
| 待处理遗留问题（列表） | `activeLeftovers` | 字段为 `leftoverItemId` / `recordId` / `recordCode` / `content` / `createdAt` |

缺口（C-2 后清零）：`activeLeftoverTotal` 与 `activeLeftovers[].recordTitle` 已由第二轮扩展提供，指标卡与遗留行均渲染服务端实时值；`PROJECT_OVERVIEW_V1_MISSING_METRICS` / `PROJECT_OVERVIEW_V1_MISSING_FIELDS` 清空保留为入口，恢复缺口时必须同步补回。

## 4. 待裁定项与接线顺序

| 项 | 影响 | 处置 | A 裁决（2026-09-11） |
| --- | --- | --- | --- |
| 优先级徽章、截止时间、记录数 | 设计稿的卡片元素在 R-3 没有字段来源 | 等 A / 人工裁定：扩展 R-3，或 V1 降级展示 | 已裁决（§10.3）：R-3 列表项扩展 `priority` / `dueAt` / `completedAt` / `creatorId` / `githubLinkCount` / `groupId`；`description` 被拒绝，确需摘要另立迭代 | |
| 任务中心统计卡片与遗留问题入口 | R-3 没有统计口径 | 同上；不得用前端全量拉取后计算（工作书 F-32 禁止事项） | 已裁决（§10.3）：新增 `stats`（`myOpen` / `dueToday` / `overdue` / `completedThisMonth`）、`leftoverCount` 与 `leftoverSample`；`scopeCounts` 延后 | |
| 待处理遗留问题计数 | R-2 没有计数 | 同上 | 已裁决（§10.2）：R-2 新增 `activeLeftoverTotal`，口径与 `activeLeftovers` 同一过滤 | |
| `scope=created` / `all`、关键词、GitHub、来源任务筛选 | 冻结参数不含 | V1 在 UI 侧隐藏或标注「后续迭代」，不得静默忽略 | 部分裁决（§10.3）：接受 `priority` 与 `includeCanceled`；`relation` / `query` / `scope=created` / `all` 延后，UI 继续显式降级 | |
| 遗留问题行 `recordTitle` | 冻结 DTO 没有该字段 | 接线时改用 `recordCode` 组合展示，或申请扩展 | 已裁决（§10.2）：接受 `recordTitle`，`recordCode` 保留；不再用 `recordCode` 组合降级 | |

接线顺序（裁决 §7）：B 交付只读端口 → A 登记契约并再生成 OpenAPI 与客户端（与实现同一个 PR）→ C 用生成的客户端替换 mock adapter 并补 Playwright 关键路径。三步均已于 2026-09-11 完成：端口扩展 PR #96 代 B 落库；契约、实现与生成物同一 PR；C 侧 F-29 / F-32 专属 Playwright 关键路径见 §5。

## 5. 接线记录与未做

2026-09-11 接线落库：R-1 `getTaskGroup`、R-2 `getProjectOverview`、R-3 `listMyTasks`、R-4 `listTaskGroupRecords` 四条路由连同 Schema、Route Registry、权限矩阵、OpenAPI、生成客户端与 NestJS 实现（三个 Controller、三个查询服务、签名游标）同一 PR 落库；F-29 页面默认使用 `project-overview-server.ts`，F-32 页面默认使用 `my-tasks-server.ts`，契约缺口按 `null` / 全 false 显式降级；测试证据见[测试矩阵](./test-matrix.md) 的 2026-09-11 增量段。

2026-09-11 F-29 / F-32 专属 Playwright 关键路径落库：`apps/e2e/tests/aggregate-views.spec.ts` 两例。F-32 先在 fixture 项目经真实 UI 创建功能并把任务指派给当前用户，再在 `/tasks` 验证：服务端适配器说明、统计卡「—」、搜索 / 优先级与「我创建的」范围禁用并标注、默认「我负责的 + 未完成」返回该任务且不显示无契约来源的优先级徽章，以及 F-30 的 URL 筛选状态（`status=done`、`view=list`、`more=1`）与「遗留问题」入口跳转 `/issues`。F-29 在 `/projects/{projectId}/overview` 验证：标题为服务端项目名、活跃模块数与成员数为服务端真实值、遗留问题总数「—」、最近迭代与待处理遗留问题两块面板及空态，以及「查看全部 / 查看模块 / 全部项目」三条导航。`global-setup` 增补 `projectName` 到 runtime 供概览标题断言使用。本地 `@inpulse/e2e` typecheck 与全量 `pnpm test:e2e` 42/42（约 5.3 分钟）通过；证据见[测试矩阵](./test-matrix.md) 的 2026-09-11 E2E 增量段。

2026-09-11 F-23 / F-24 / F-25 前端交付落库：功能页任务抽屉新增「合并到主任务」入口（全局搜索同项目任务、排除自身、≥2 字符、350ms 防抖、来源分支类型单选、说明 ≤5000 字），成功后由合并响应携带的 `groupId` 跳转 `/task-groups/{groupId}`；新增聚合组详情页（主任务/来源分支成员、角色徽章、记录筛选由 URL 承载（F-30）、签名游标加载更多、外部链接快照字段按 `Snapshot` 后缀标注「关联时刻快照」、遗留问题总数与来源记录标题等契约缺口保持显式降级）；来源分支「解除合并」二次确认（原因选填、最后一个活跃来源关闭聚合组的警告），成功提示与关系「已解除」、组关闭状态可见。测试证据见[测试矩阵](./test-matrix.md) 的 F-23 / F-24 / F-25 前端增量段（前端 23 例 + E2E `task-groups.spec.ts`）。同时修复 #98 引入的两处 E2E 问题：F-29 指标竞态改 `expect.poll`、新用例未处理创建任务后自动打开的详情抽屉；全量 `pnpm test:e2e` 43/43。新增 E2E 用例需非作者人工评审。

2026-09-11 第二轮裁决契约扩展落库（A）：R-2 `activeLeftoverTotal` / `recordTitle`、R-3 列表项 6 字段与 `stats` / `leftoverCount` / `leftoverSample`、筛选 `priority` / `includeCanceled` 与新增 R-5 `listTaskGroupMemberships` 的 Schema、Route Registry、权限矩阵、OpenAPI 与生成客户端随服务端实现同一 PR 落库；真实 PostgreSQL 集成测试覆盖 R-2 / R-3 新字段与 R-5 批量查询（聚合读 19/19），`priority` / `includeCanceled` 的 `EXPLAIN` 证据见[测试矩阵](./test-matrix.md) 增量段。

C 侧待办（2026-09-11 C-2 落库后更新）：F-29 / F-32 适配器接线、降级清零、缺口注释同步与对应 Playwright 关键路径已随 C-2 本地落库（见下条；`scopeCounts` 与 `description` 为 A 裁决延后项，保持缺口常量）。R-5 前端接线已于 2026-09-11 随工作书 C-1 本地落库（新增 `apps/web/src/features/tasks/task-marks.ts`：页面级一次批量调用 R-5，任务列表、卡片与任务详情显示「主任务 / 来源任务」徽章、「迭代记录 n 条」，`groupRole` 为 `null` 隐藏入口、`groupId` 导航 `/task-groups/{groupId}`；任务详情同时由 Drawer 改为居中弹窗并对齐设计师稿；证据见[测试矩阵](./test-matrix.md) C-1 章节）；C-3 既有页面视觉与 mock 数据集本身的调整已随本批完成（弹窗 tabs、`CalmTabs`、任务状态面板与全站视觉收尾；证据见[测试矩阵](./test-matrix.md) C-3 / C-4 章节）。PR #98 的三次 GitHub Actions（CI push / pull_request 与 Documentation）已通过。R-5 契约已随 [PR #102](https://github.com/256-code/InPulse/pull/102) 落库并按顺延冻结编号（本批两条新路由为 R-6 / R-7），前端接线可直接开始。
2026-09-11 C-2 第二轮字段接线与降级清零落库（工作书 C-2）：`apps/web/src/features/my-tasks/*` 与 `apps/web/src/features/project-overview/*` 完成接线——`my-tasks-server.ts` 改为透传 `stats` / `leftoverCount` / `leftoverSample`（仅 `scopeCounts` 保持 null），`MY_TASKS_V1_FILTER_SUPPORT` 翻 `filter:priority` 与 `filter:canceled-with-open` 为 true，`toMyTasksV1Query` 增加 `priority` / `includeCanceled` 映射，`fromV1MyTaskItem` 映射 6 个新字段并收紧 `MyTaskListItem`（null 语义即契约定义，`description` 仍可选）；`project-overview-v1.ts` 改为 `openLeftovers = activeLeftoverTotal`、`recordTitle` 直取服务端字段，`PROJECT_OVERVIEW_V1_MISSING_*` 清空；两页视图移除「—」与禁用降级：统计卡渲染服务端数字、卡片/表格始终渲染优先级徽章与截止文案、遗留指标卡与遗留行渲染真实数据。`apps/e2e/tests/aggregate-views.spec.ts` 两例由降级断言翻转为接线断言（统计卡数字轮询、优先级筛选选中写 URL、任务卡含「普通优先级」与「未设置截止」、显示已取消开关可用、遗留指标为数字、notice 断言更新）。新增/更新的单测见[测试矩阵](./test-matrix.md) 的 C-2 增量段；本地 `pnpm --filter @inpulse/web test` 64 文件 293 例、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm check:frontend:boundaries`（207 模块 946 依赖）与全量 `pnpm test:e2e` 45/45（约 6.1 分钟）通过。排障记录：本地 `app` 库缺 `0006_leftover_search_entity.sql` 导致所有带遗留问题的发布 500（`search_projection_entity_type_check` 不含 LEFTOVER），以 `MIGRATION_DATABASE_URL` 执行 `pnpm db:migrate` 应用 0006 后 10/10 复跑通过；该失败与 C-2 无关，CI 一次性建库不受影响。新增/更新的 E2E 用例需非作者人工评审。

2026-09-11 F-20 遗留问题页与任务中心聚合组区块落库：`/issues` 由 `WorkspacePlaceholder` 换成按设计师稿实现的遗留问题页（未闭环 / 已闭环分桶、服务端签名游标分页、行内来源记录与来源 / 跟进任务入口、未闭环项「转为任务」复用已发布记录页的转换弹窗）；任务中心补上设计师稿的「任务聚合组」区块（组卡、分支行徽章与负责人、页脚「查看主任务」直达任务详情）。两条页面所需的「列遗留项 / 列聚合组」服务端读能力在既有契约中不存在，因此新增 `GET /api/v1/leftover-items`（`listLeftoverItems`）与 `GET /api/v1/task-groups`（`listTaskGroups`），Schema、Route Registry 全策略、权限矩阵、OpenAPI、生成客户端与真实 PostgreSQL / E2E 用例随实现同一个 PR 落库；两条路由按服务端 `AuthorizedProjectScope` 跨项目过滤，非成员与不存在返回空页而不是 404（与 `listMyTasks` 同族）。测试证据见[测试矩阵](./test-matrix.md) 的 F-20 页面与聚合组区块条目；全量 `pnpm test:e2e` 45/45。新增 E2E 用例需非作者人工评审。

编号说明（已按建议顺延）：A 于 2026-09-11 冻结的 R-5 是 `listTaskGroupMemberships`（[PR #102](https://github.com/256-code/InPulse/pull/102)）；本批两条新路由原沿用的 R-5 / R-6 与其冲突，已按建议顺延落库为 **R-6 `listLeftoverItems`（`GET /api/v1/leftover-items`）** 与 **R-7 `listTaskGroups`（`GET /api/v1/task-groups`）**；Route Registry、Schema、Schema Registry 描述、实现注释、前端接线、集成测试与 E2E 用例、OpenAPI 与生成客户端已同步，冲突编号不再存在。

未做：§4 的延后项（`scopeCounts`、`description`、`scope=created|all`、`relation` / `github` / `q` 筛选）保持显式降级；C-3 既有页面视觉与 mock 数据集本身的调整已于 2026-09-11 随 dev/c 完成（弹窗 tabs、`CalmTabs`、任务状态面板与全站视觉收尾；证据见[测试矩阵](./test-matrix.md) C-3 / C-4 章节）。`/records` 单页结构改造（会改动 F-17 / F-18 / F-19 已交付视图）经产品 2026-09-11 定案为**暂缓**并归属 B，登记为工作书 B-3；恢复开工需先定案跨项目记录读路由（现有 `listChangeRecords` 与 `listRecordDrafts` 均先选项目，`RecordListQuery` 只有 `status`），按独立契约纵切片排期。PR #98 的三次 GitHub Actions（CI push / pull_request 与 Documentation）已通过。
