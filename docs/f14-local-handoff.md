# F-14 功能级任务本地交审

2026-09-09，B；工作区 `C:\Users\10348\.codex\worktrees\610b\InPulse`，分支 `codex/f14-feature-tasks`，fetch 后基线 `1c2b5bf`（F-13 PR #70）。本批只交付 F-14，F-15 必须在本批合入并收到协调通知后开始。本地提交供 PR 对话取用，不自行推送或合并，不修改 `D:\InPulse`。

## 用户结果与范围

- 功能详情页提供功能级任务卡片/列表、新建、优先级/截止时间/项目成员指派和编辑；任务详情抽屉展示真实归属、编号、负责人、创建人、状态和说明。
- 任务默认 FEATURE/TODO/ACTIVE，项目内编号 `PROJECT-T-n` 不补零；初始状态历史同事务写入。归属、编号、创建人和状态不通过普通编辑变更。没有新增依赖、迁移或修改历史迁移。
- 负责人必选，不自动指派。创建或真正改派校验用户与项目成员 ACTIVE；普通编辑可以保留已移除/停用的历史负责人，前端显示 ID 作为历史引用，不把全局用户目录当项目成员。
- 创建或真正改派只通知新负责人，未改派不发通知；通知 targetPath 直达功能页并打开任务抽屉。任务完成、取消、重开仍属 F-16；未实现任务组写入、记录读取、F-15 模块级任务或 F-19。
- 记录域尚无公开读取能力，任务产生记录、功能最近三条记录和完整历史入口均待接入；不展示假 0、假数据或无效按钮。任务组关联入口同样不伪造。
- 编辑使用快照/草稿/最新值三方合并，同字段冲突必须选择；合并后才采用最新 If-Match。失败保留草稿，相同语义的不确定失败重用 Key，语义变化或成功后换 Key。功能归档只读，权限失败有反馈和重试。

## 接口及事务

集合路径 `/api/v1/projects/{projectId}/modules/{moduleId}/features/{featureId}/tasks`。五个 operationId：`listTasks`、`getTask`、`listTaskAssignees`、`createTask`、`updateTask`。资源详情/编辑使用 `/{taskId}`，成员列表使用 `/assignees`。统一成功 200 和 no-store；错误 ErrorResponse/X-Request-Id；Controller 使用 ADR-029 的 Operation/Contract 装饰器、全局响应校验与异常 Filter。Schema、Route Registry、OpenAPI/客户端和权限矩阵同步。

IdempotencyHttpService 创建一个外层事务，Session/CSRF、项目访问、父级锁、任务条件更新、编号、历史、审计、活动、搜索、通知和幂等记录显式共用 tx。项目→模块→功能 FOR SHARE，编辑随后任务 FOR UPDATE，再在真正指派时按用户→成员 FOR SHARE；触发器保持不变。重放重新验证当前权限、真实资源归属和父级可写性。修改历史负责人未变时，SQL SET 完全省略 assignee_id，避免触发新指派校验。

## 已协调的跨域公开能力

协调对话 `01a079ec-e08e-76d0-b558-4da45645b411` 于本轮授权 B 实现以下最小能力，交审重点列给 A/C；不等待另一个依赖 PR：

- ProjectsModule：ProjectCodePort.allocateTaskCode(tx, projectId)，复用 TASK 原子序列。
- ProjectsModule：ProjectMembersQueryPort.listActiveMembers 在 tx 内自行验证 actor 项目可读权限，只返回 id/name/avatarUrl；checkAssignableMember 要求调用方先授权，依次锁用户/成员并复查 ACTIVE。
- FeaturesModule：FeatureReadPort.find(tx, projectId, moduleId, featureId)，只读完整归属及归档历史。
- C 管辖的 app 装配/生成客户端及通知写端口消费需要 C 复核。没有访问 A/C 内部 Repository。

## 实际验证

独享 PG18/PGroonga 集群：`127.0.0.1:55424/inpulse_f14`，data 为 `%TEMP%\inpulse-f14-610b\data`，复用 `%TEMP%\inpulse-f12-pg18\pgsql` 程序包。启动前检查端口空闲，未停止/清理他人服务或 data。协调方已确认独享所有权。数据库测试设 `TEST_DATABASE_URL=postgresql://cluster_bootstrap@127.0.0.1:55424/inpulse_f14`；迁移设相同库的 app_migrator URL，NODE_ENV=test。

| 命令 | 实际结果 |
|---|---|
| `pnpm install --frozen-lockfile` | 成功；未修改 manifest/lockfile |
| `pnpm db:migrate` | 空库应用既有 0000–0005 六条迁移成功 |
| `pnpm --filter @inpulse/api exec vitest run --config vitest.integration.config.ts test/tasks-api.integration.test.ts test/write-query-ports.integration.test.ts` | 26/26（F-14 20、既有公开 Port 回归 6） |
| `pnpm --filter @inpulse/web exec vitest run src/features/tasks/TasksPanel.test.tsx src/features/features/FeaturesPageView.test.tsx` | 13/13（F-14 5、F-13 回归 8） |
| `pnpm --filter @inpulse/api-contract exec vitest run test/tasks.test.ts test/permissions.test.ts` | 16/16（五路由策略及 Controller/权限回归） |
| `pnpm contract:generate`、`pnpm contract:drift`、`pnpm contract:validate`、`pnpm permissions:check` | 5 个生成物由工具生成且无漂移，40 条路由策略/Controller 绑定和权限矩阵通过 |
| `pnpm --filter @inpulse/e2e exec playwright test tests/tasks.spec.ts --config .e2e-runtime/playwright.edge.config.ts --project=edge` | Edge 1/1，26.2 秒；真实登录、项目/成员/功能/任务创建、双页面两类冲突、刷新列表和通知直达 |
| API-contract/database `tsc -p tsconfig.build.json`、API `tsc -p tsconfig.json` | E2E 必要局部编译通过 |
| API `tsc -p tsconfig.test.json --noEmit`、Web `tsc -p tsconfig.json --noEmit`、E2E `tsc --noEmit` | 局部检查通过 |

真库覆盖失败路径：匿名/停用/非成员/已移除及真实归属错误，空/非成员负责人，历史负责人保留，管理员指派仍受成员限制，CSRF/Key/If-Match，版本/编号冲突，幂等输入变化与失权重放，12 个并发编号，四类副作用故障整体回滚、改派通知故障回滚、归档历史读取及重放拒绝。五类真实锁竞争（项目/模块/功能归档、负责人移除/停用）通过 pg_blocking_pids 确认等待，再释放并验证重查拒绝。

通知标题上限回归：合法 500 字任务标题加通知前缀时曾触发 500，真库先复现失败；改为仅截短通知标题到 500，完整任务标题不变，并补充回归。

早期失败已修复：契约测试先因 Schema 缺失失败；测试 fixture 曾误用 joined_by/idempotency_keys，按既有 Schema 修正；Controller 扫描期望按实际文件顺序补入五路由；jsdom 中 Ant Design 的固定 test-id 导致隐藏抽屉标题与编辑弹窗冲突，改为关闭后卸载抽屉。首次 E2E 配置同时选中 Chromium/Edge，Chromium 缺少本机安装而失败，Edge 已通过；最终显式 `--project=edge` 全命令成功，不冒充默认 Chromium 通过。

只格式化本轮 TS/TSX。未执行全仓静态检查、全量构建、全量测试、依赖审计或 CI；默认 Chromium 未验证。没有声称生产状态机/记录域/模块级任务已实现。剩余交付事项为审核反馈、PR/CI 及合并，交付期间按协调要求冻结分支。

## PR #71 交付增量：MFA 测试隔离

最新交付 HEAD `ff85898` 的 [CI 34340424204](https://github.com/256-code/InPulse/actions/runs/34340424204) 完成真库集成、契约、应用/四生产镜像构建与扫描，Browser E2E 为 16 passed / 1 failed；F-14 Chromium 任务路径通过（31 秒），既有 MFA 用例两次在登录 TOTP 提交后等待“系统管理员”失败（10 秒）。未取得受浏览器限制的 trace/截图，不能将该次失败断言为验证码重放。代码确认 features/mfa 原先共用管理员和因子，前一用例重认证消费未来一步，后一用例可能进入同一已消费步；这是已确认的测试状态耦合，生产防重放实现未在本 PR 修改。

协调授权新增 test-scoped `helpers/mfa-fixture.ts`：每用例/每次重试创建随机独立管理员，通过既有真实 API 注册因子；用例继续走真实 UI 登录和重认证。注册流程从 global setup 原样提取并参数化 API URL；不清零 `last_accepted_step`、不改变窗口、断言或等待。移除 global setup/runtime 中共享管理员及对应全局清理，fixture finally 只清理本次账号的 Session/恢复码/因子，保留用户与审计历史。

交付复跑独享 PostgreSQL 18/PGroonga：`127.0.0.1:55425/inpulse_f14_pr`；未使用实现者 55424。空库应用既有六迁移、E2E 必要 api-contract/database/API 局部编译通过；修复前 features/mfa 顺序 3/3（36.2 秒），未复现该次 CI 失败。修复后执行 `pnpm --filter @inpulse/e2e exec playwright test tests/features.spec.ts tests/mfa.spec.ts --config .e2e-runtime/playwright.edge.config.ts --project=edge --repeat-each=2`，6/6（1.2 分钟），查询确认四次管理员业务用例创建四个不同账号，结束后因子与 Session 均为 0。repeat-each 不是失败重试实测；重试隔离由 Playwright test-scoped fixture 生命周期保证。E2E 局部 `tsc --noEmit`、六个变更 TS 文件的 Prettier/ESLint 和 diff 空白检查通过。未全仓构建、静态检查或无关审计；修复版 Chromium 与完整 CI 待推送后运行，增量待协调审核。
