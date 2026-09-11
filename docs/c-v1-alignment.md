# F-32 / F-29 与冻结聚合读契约的对齐（C 岗）

| 字段 | 内容 |
| --- | --- |
| 状态 | 本地已接线：R-1 ~ R-4 契约、后端与生成客户端随 [PR #97](https://github.com/256-code/InPulse/pull/97) 落库，F-29 / F-32 页面默认注入 server adapter（mock 仅保留测试与降级），专属 Playwright 关键路径已落库并以 [PR #98](https://github.com/256-code/InPulse/pull/98) 交付（全量 E2E 42/42）；GitHub Actions（CI push / PR 与 Documentation）已通过，待非作者评审 |
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

V1 无法表达的筛选（`listMyTasksV1Gaps` 返回）：`scope=created`、`scope=all`、`scope=project` 未选项目、`priority`、`relation`、`github`、`q`（关键词），以及 `status=open` 叠加「包含已取消」（`workStatus` 单值无法表达 TODO 与 CANCELED 的并集）。

响应与列表项缺口：R-3 只返回 `items` / `nextCursor` / `hasMore`；骨架的统计卡片、各范围计数与遗留问题入口没有契约来源。列表项缺 `priority`、`dueAt`、`completedAt`、`description`、`creatorId`、`githubLinkCount`。

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

缺口：设计师稿的「待处理遗留问题」计数没有契约来源（响应只有列表，默认 2 条）；骨架遗留问题行使用 `recordTitle`，冻结 DTO 没有该字段。

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

C 侧待办（2026-09-11 第二轮契约扩展落库后更新）：R-5 前端接线（F-25 步骤 3 任务卡片徽章与任务详情抽屉「查看主任务」按页面一次批量调用，`groupRole === null` 隐藏入口、`groupId` 导航 `/task-groups/{groupId}`）；F-29 / F-32 适配器对 `activeLeftoverTotal` / `recordTitle` / 新条目字段 / `stats` / `leftoverCount` / `leftoverSample` 与 `priority` / `includeCanceled` 筛选的接线；降级项清零并同步 `my-tasks-types.ts` 与 `project-overview-v1.ts` 的缺口注释；对应 Playwright 关键路径。在这些完成前，前端降级保持有效。既有页面视觉与 mock 数据集本身的调整仍未做。PR #98 的三次 GitHub Actions（CI push / pull_request 与 Documentation）已通过。
2026-09-11 F-20 遗留问题页与任务中心聚合组区块落库：`/issues` 由 `WorkspacePlaceholder` 换成按设计师稿实现的遗留问题页（未闭环 / 已闭环分桶、服务端签名游标分页、行内来源记录与来源 / 跟进任务入口、未闭环项「转为任务」复用已发布记录页的转换弹窗）；任务中心补上设计师稿的「任务聚合组」区块（组卡、分支行徽章与负责人、页脚「查看主任务」直达任务详情）。两条页面所需的「列遗留项 / 列聚合组」服务端读能力在既有契约中不存在，因此新增 `GET /api/v1/leftover-items`（`listLeftoverItems`）与 `GET /api/v1/task-groups`（`listTaskGroups`），Schema、Route Registry 全策略、权限矩阵、OpenAPI、生成客户端与真实 PostgreSQL / E2E 用例随实现同一个 PR 落库；两条路由按服务端 `AuthorizedProjectScope` 跨项目过滤，非成员与不存在返回空页而不是 404（与 `listMyTasks` 同族）。测试证据见[测试矩阵](./test-matrix.md) 的 F-20 页面与聚合组区块条目；全量 `pnpm test:e2e` 45/45。新增 E2E 用例需非作者人工评审。

编号说明（需 A 裁决）：A 于 2026-09-11 冻结的 R-5 是 `listTaskGroupMemberships`（[PR #102](https://github.com/256-code/InPulse/pull/102)）；本批两条新路由在实现注释与 OpenAPI summary 中沿用了 R-5 / R-6，其中 R-5 与之冲突，正式编号需 A 指定（建议顺延为 R-6 / R-7），确定后同步修订路由 summary、Schema Registry 描述与实现注释。

未做：§4 待裁定项的契约扩展（遗留问题总数、来源记录标题、优先级 / 截止时间等仍无字段来源，保持降级）；既有页面视觉与 mock 数据集本身的调整。PR #98 的三次 GitHub Actions（CI push / pull_request 与 Documentation）已通过。
