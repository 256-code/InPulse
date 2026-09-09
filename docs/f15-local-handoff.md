# F-15 模块级任务本地交审

2026-09-09，B。独立工作区 `C:\Users\10348\.codex\worktrees\610b\InPulse`，分支 `codex/f15-module-tasks`，fetch 后基线 `273b27319e7e5c251f32bd8d2b0022d40cfea823`（F-14 PR #71）。包含主线最终测试格式及 MFA 独立 fixture 修复，没有重复 cherry-pick F-14。未修改 `D:\InPulse`，未推送或合并。

## 用户结果

- 模块卡片提供“模块任务”入口 `/projects/:projectId/modules/:moduleId/tasks`；复用 F-14 的任务卡片/列表、创建、详情抽屉、负责人/优先级/截止时间编辑、三方冲突合并及同语义失败重试 Key。
- MODULE 任务只有一行，feature_id 为 NULL，选择当前模块零至多个影响功能，输入 ID 集合去重升序（最多 1000 个输入项）。任务号继续使用同一项目 TASK 序列；不复制成多个功能级任务。
- 功能页通过 EXISTS 当前影响关系显示模块任务引用，每个任务只出现一次，页面任务数按唯一任务行计数，不按关系条数计数。模块级引用显示标识和“打开模块任务”，功能页不直接编辑模块引用，归档功能页仍是历史只读入口。
- 模块任务可后续增删影响功能。表单明确提示：负责人、状态、验收、上线或回滚不同的工作建议拆分。通知按 F-14 规则仅在创建/真正改派时发给新负责人，直达真实模块任务路径。
- 不实现 F-16/F-19、任务组和记录读取/统计；没有假记录数、假数据或无效记录入口。

## 关系历史与归档语义

协调对话依据功能设计 §14.6（允许增删、必须审计）、§27.8 和现有 migrations/0000–0002 确认：task_feature_impacts 是当前影响集合；只删除本任务明确移除的关系，同事务不可变审计记录完整前后关系快照（task/project/module/feature ID、relation_type、created_at）以及 added/removed 差异。重新加入产生新的 created_at，过去的完整关系快照仍可追溯。任务、状态历史和审计不删除；此解释不泛化到任务组成员等要求保留原行的历史表。没有新增迁移/ADR，也没有修改历史迁移或数据库权限。

MODULE 任务的真实父级是项目/模块，影响功能是关系，不是 FEATURE 任务归属。新增影响（包括移除后重加）要求功能 ACTIVE；保留/移除既有 ARCHIVED 影响功能只验证同项目/模块身份。项目/模块及任务生命周期仍须可写。这是协调对现有设计的解释，不声称用户新增了架构决策。

## 事务与接口

复用同一 TaskManagementRepository、TasksManagementService、HTTP 服务与 Controller。新增五个 module operationId：listModuleTasks、getModuleTask、listModuleTaskAssignees、createModuleTask、updateModuleTask。集合 `/api/v1/projects/{projectId}/modules/{moduleId}/tasks`，详情/更新 `/{taskId}`，成员 `/assignees`。新 ModuleTaskItem/请求/路径/重放 Schema，与原 FEATURE 写入契约独立；原 listTasks 的读响应扩展为功能任务及模块引用的联合，原 FEATURE 写入语义不变。

所有写接口继续 CSRF、数据库幂等、If-Match（编辑）、同 tx 审计/活动/搜索/通知。新增模块重放上下文包含任务真实父级和成功响应中的全部影响功能 ID，重放前验证当前 actor、任务真实归属/父级可写性及这些功能的当前可读归属，不泄漏已存成功响应。

锁序：项目→模块 FOR SHARE；预读当前关系，将当前∪目标影响功能 ID 排序逐个 FOR SHARE；随后任务 FOR UPDATE 并重读关系。版本变化返回 409；版本没变但关系与预读不同，回滚到本次锁阶段 savepoint 释放新锁，从头重建集合，最多三次，禁止任务锁后追加功能锁。保存点属于同一 UnitOfWork/数据库事务，不引入第二事务。现有复合 FK、关系 PK 和 0002 的 MODULE scope 触发器继续兜底。ModuleReadPort 使用已有公开能力，没有访问其他领域内部 Repository。

## 实际验证

独享 PG18/PGroonga 环境仍是 `127.0.0.1:55424/inpulse_f14`，data 为 `%TEMP%\inpulse-f14-610b\data`。测试环境变量 TEST_DATABASE_URL/E2E_DATABASE_URL 使用该库的 cluster_bootstrap URL；未使用、停止或清理他人数据库。E2E 独享 API 3114/Web 4184，由 Playwright 管理退出。

| 命令 | 实际结果 |
|---|---|
| `pnpm --filter @inpulse/api exec vitest run --config vitest.integration.config.ts test/tasks-api.integration.test.ts` | 28/28（F-15 8 + F-14 20） |
| `pnpm --filter @inpulse/api-contract exec vitest run test/tasks.test.ts test/module-tasks.test.ts test/permissions.test.ts` | 18/18 |
| `pnpm --filter @inpulse/web exec vitest run src/features/tasks/TasksPanel.test.tsx src/features/modules/ModulesPageView.test.tsx src/features/features/FeaturesPageView.test.tsx` | 22/22（任务面板 7 + 模块/功能回归 15） |
| `pnpm contract:generate`、`pnpm contract:drift`、`pnpm contract:validate`、`pnpm permissions:check` | 5 个生成物由工具产生且无漂移；45 路由/操作完整性通过 |
| `pnpm --filter @inpulse/e2e exec playwright test tests/tasks.spec.ts tests/module-tasks.spec.ts --config .e2e-runtime/playwright.edge.config.ts --project=edge` | Edge 2/2，55.7 秒（F14/F15合跑）；两功能引用、唯一计数、关系增删/重加、刷新持久化、通知直达 |
| API-contract `tsc -p tsconfig.build.json`、API `tsc -p tsconfig.json` | E2E 必要局部编译通过 |
| API `tsc -p tsconfig.test.json --noEmit`、Web `tsc -p tsconfig.json --noEmit`、E2E `tsc --noEmit` | 局部类型检查通过 |

真库覆盖空关系、多关系去重、功能引用只返回一次、FEATURE/MODULE 共享编号；错误项目/模块拒绝、原生 FK/PK/MODULE scope trigger 拒绝；移除→重加新的时间戳与审计全快照、审计故障关系/版本整体回滚、并发更新一个成功一个 409 且不丢关系、归档影响保留/移除/新增拒绝、实际 pg_blocking_pids 锁等待与重查、模块路由匿名/非成员/失权重放拒绝。F-14 原有负责人/CSRF/版本/四类副作用回滚等 20 例同时回归通过。

只格式化本轮 TS/TSX，未执行全仓静态检查、全量构建、全量测试、依赖审计或本批 CI。默认 Chromium 未在本批运行；不以主线 PR #71 的 Chromium 结果替代本批。此前契约测试先因未实现 Schema 失败，再实现转绿；中间编辑脚本 const 重赋值失败已修正，不影响提交内容。

待非作者重点审核关系 DELETE 边界/完整快照、锁后重读与 savepoint 有限重试、归档关系解释、模块重放资源、功能引用以及新增页面/生成客户端。交审后按协调要求冻结本批分支，审核反馈在同分支修复，不自行推送或合并。
