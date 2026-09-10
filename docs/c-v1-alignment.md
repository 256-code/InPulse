# F-32 / F-29 与冻结聚合读契约的对齐（C 岗）

| 字段 | 内容 |
| --- | --- |
| 状态 | 本地实施中：骨架数据仍由 mock adapter 提供，未接线 |
| 冻结依据 | [F-25 / F-29 / F-32 契约评审裁决](./a-contract-review-f25-f29-f32.md)（A 岗，`5563bcf`） |
| 落库状态 | 路由未登记。按裁决 §7，登记、权限矩阵、测试矩阵、OpenAPI 与生成客户端必须与实现同一个 PR 落库；所依赖的 B 侧只读端口扩展（`TaskQueryPort` 列表/计数、`ChangeRecordReadPort`、`ModuleReadPort.count`、`FeatureReadPort.count`）已由 C 代 B 落库，见[端口扩展提案的回填](./c-port-extension-proposal.md)，C 侧聚合读接线仍未开始 |
| 当前日期 | 2026-09-10 |

## 1. 目的与边界

把设计师稿与前端骨架的筛选面、字段面与 A 已冻结的 R-2 / R-3 契约做显式对照，落成可执行映射与缺口清单，避免接线时出现「UI 有筛选但请求发不出去」或「字段没有来源」的静默分歧。

本文不是契约来源：路径、参数、状态码与字段名一律以裁决文档为准；本文只记录 C 侧的映射与缺口，不改契约源、不登记路由、不新增生成客户端。

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

| 项 | 影响 | 处置 |
| --- | --- | --- |
| 优先级徽章、截止时间、记录数 | 设计稿的卡片元素在 R-3 没有字段来源 | 等 A / 人工裁定：扩展 R-3，或 V1 降级展示 |
| 任务中心统计卡片与遗留问题入口 | R-3 没有统计口径 | 同上；不得用前端全量拉取后计算（工作书 F-32 禁止事项） |
| 待处理遗留问题计数 | R-2 没有计数 | 同上 |
| `scope=created` / `all`、关键词、GitHub、来源任务筛选 | 冻结参数不含 | V1 在 UI 侧隐藏或标注「后续迭代」，不得静默忽略 |
| 遗留问题行 `recordTitle` | 冻结 DTO 没有该字段 | 接线时改用 `recordCode` 组合展示，或申请扩展 |

接线顺序（裁决 §7）：B 交付只读端口 → A 登记契约并再生成 OpenAPI 与客户端（与实现同一个 PR）→ C 用生成的客户端替换 mock adapter 并补 Playwright 关键路径。在此之前页面保持骨架，不代表已实现能力。

## 5. 本次未做

未改契约源、Route Registry、权限矩阵与生成物；未登记路由；未引入生成客户端依赖；未改动 UI 与 mock 数据；未运行 API 单测、真实 PostgreSQL 集成与 Playwright E2E。
