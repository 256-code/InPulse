# F-12 模块管理本地交审

日期：2026-09-09；负责人 B；基线 `d2c5bbc`，分支 `dev/b`。409 覆盖他人修改的问题已修复；本地真库/HTTP 9/9、模块前端 7/7、浏览器 E2E 1/1 已通过，现交审核。没有提交、推送或创建 PR。本轮 fetch 已看到 `origin/main` 为 `9ca018e`，新增为上游验证说明，未覆盖当前未提交实现。

## PR 交付状态（2026-09-09）

本地代码复审已通过。独立审核对话再次执行前端 7/7、真实 PostgreSQL/HTTP 9/9、Edge E2E 1/1（包含双页面竞争），均通过；默认 Playwright 下载版 Chromium 与本 PR 的远端 CI 尚未验证。

本次交付先 fetch，将 dev/b 从 `d2c5bbc` 快进同步至实际 `origin/main` `9ca018e`，再创建 `codex/f12-modules-management`。开发日志冲突按双方记录合并；源码、测试和生成物与同步前备份逐文件哈希一致，未改变行为，复用已有验证。完整工作区目录备份与 include-untracked stash 均保留。README 原导航和未跟踪协作方案保留在原工作区，排除出 PR。功能提交 `f51ab0d` 已推送，[PR #65](https://github.com/256-code/InPulse/pull/65) 已创建，base 为 main，负责人 B（suikiiovo）。本段记录首次交付状态，CI 结果以 PR 最新提交的检查为准；跟踪既有 CI 后交 A/C 非作者评审，不自行合并。完整门禁由 CI 执行，本地不运行全量构建、全仓静态检查或无关审计。

以下为本地交审时点的实现和验证记录。

## 用户操作与入口

- `/projects/:projectId/modules` 提供模块列表、加载/空态/失败重试、创建、编辑、归档与恢复。
- 项目创建成功卡片提供“管理模块”；项目动态页提供“管理项目模块”。复用 pages 的 route.ts 自动注册，不新增项目列表服务。
- 普通成员可以创建/编辑；管理员可执行归档/恢复，并使用现有 `AdminReauthenticateModal` 完成密码/TOTP 验证，再确认原操作。没有功能/任务/记录假数据或无效操作入口。
- 未分类身份通过 kind 标识；按用户 2026-09-09 定案，允许修改名称与描述，继续遵循权限、状态、唯一性及版本规则。不能改变 kind/projectId/createdBy，不提供删除接口。现行设计没有单独禁止其归档/恢复，故适用普通模块管理员状态规则。
- 列表包含归档模块，排序为现有 sort_order、id 升序；不新增排序编辑。归档项目历史仍可读，写入返回 409。归档模块只读；恢复只改变本模块状态，不批量恢复下级资源。两种状态操作均需非空原因（最多 2000 字），进入不可变审计。
- 表单使用 React Hook Form；服务端状态使用 TanStack Query。提交期间禁止重复执行；409 保留编辑前快照和草稿，重新加载后按字段与服务端最新数据做三方合并：用户未改字段采用最新值，仅用户修改的字段保留草稿，双方修改且值不同的字段展示三份差异并要求逐项选择。所有冲突明确解决后才使用最新 rowVersion；重新提交仍受 If-Match 保护。归档或失去访问权时保留草稿并阻止提交。网络不确定失败可复用相同幂等 Key；修改输入或版本会使用新 Key。成功刷新模块列表、项目活动及搜索缓存。

## 契约与公开接口

统一前缀 `/api/v1`，五条接口成功均为 200，失败使用 ErrorResponse。

| operationId | method / path | 成功 Schema | 额外门禁 |
| --- | --- | --- | --- |
| listModules | GET /projects/{projectId}/modules | ModuleListResponse | 当前项目可读，含归档 |
| createModule | POST /projects/{projectId}/modules | ModuleItem | 项目 ACTIVE，服务端固定 NORMAL |
| updateModule | PATCH /projects/{projectId}/modules/{moduleId} | ModuleItem | 项目/模块 ACTIVE，If-Match |
| archiveModule | POST /projects/{projectId}/modules/{moduleId}/archive | ModuleItem | 管理员重认证、ACTIVE → ARCHIVED、原因、If-Match |
| restoreModule | POST /projects/{projectId}/modules/{moduleId}/restore | ModuleItem | 管理员重认证、ARCHIVED → ACTIVE、父项目 ACTIVE、原因、If-Match |

写接口要求同源、Session/CSRF、Idempotency-Key；If-Match 使用引号包围的正整数版本，如 `"2"`。编辑与创建只接受 name/description，状态操作只接受 reason。源定义位于 [modules.zod.ts](../packages/api-contract/src/contracts/modules.zod.ts) 和 [module-routes.ts](../packages/api-contract/src/module-routes.ts)，由现有生成器更新 OpenAPI/客户端及指纹，未手写生成物。首次开发过程中的未提交旧指纹曾与 If-Match 大小写修正冲突，恢复 HEAD 指纹基线后重新运行生成器，未改写已提交契约历史。

## 权限、事务与依赖

[ModulesController](../apps/api/src/modules/modules/modules.controller.ts) 委托本域 HTTP 应用服务，按 Registry 选择请求/响应 Schema；不读数据库。调用链为 HTTP 应用服务 → ModulesManagementService → 本域 Repository 和公开 Writer。

普通读取通过 A 的 `getAuthorizedSearchScope`，不复用 ACTIVE 写前检查。写入/重放由 `IdempotencyHttpService` 持有一个外层事务，事务内解析当前 Session/CSRF，调用 `checkProjectForWrite(tx, ...)`，按真实模块 id + project_id 校验归属，隐藏不存在/无权访问为 404。管理员操作调用 `AdminHighRiskAuthService.verify(tx, headers)`，重放再次检查，不能仅依赖 UI 按钮或外层 Guard。

父项目 FOR SHARE 先于模块 FOR UPDATE，模块归档使用排他锁，因而阻止下级 ModuleQueryPort 的 FOR SHARE 写前检查；项目归档的 FOR UPDATE 与父项目共享锁互斥。条件 UPDATE 附带 row_version 并递增，名称唯一约束为含归档行的 lower(btrim(name))；名称、版本、状态冲突分别返回安全 409。所有审计、活动、搜索及幂等记录使用同一个 tx；不调用别域内部 Repository，不修改历史迁移、依赖或公共认证设施。

审计动作 `module.create/update/archive/restore` 保存前后 DTO 快照及原因；活动来源使用审计 chainId/sequenceNo 去重，MODULE + MEMBER 可见，搜索 upsert 使用最新版本/状态并保留历史可读性。现行模块管理没有指定通知接收人或模块通知事件，本切片不凭空写通知。

## 验证记录

已通过：

- `pnpm --filter @inpulse/api-contract exec vitest run test/modules.test.ts test/permissions.test.ts`：2 文件 16 例；新增边界测试最初因尚无 Schema 失败，随后通过。显式路由绑定断言已新增五条模块路由。
- `pnpm --filter @inpulse/api exec vitest run test/modules-management.test.ts test/modules-http.test.ts`：2 文件 6 例；覆盖状态/版本、同 tx 传递、规范化摘要输入、认证拒绝、重放重认证、安全错误与响应校验。
- `pnpm --filter @inpulse/web exec vitest run src/features/modules/ModulesPageView.test.tsx`：1 文件 7 例；覆盖未分类编辑、409 三方合并、失败重试、管理员原因/版本传递及归档恢复入口。新增 3 例在旧实现上先失败，再于修复后全部通过：用户改名称/服务端改说明时保留最新说明；双方改说明分别选择草稿或最新值，解决前不能保存。相关 `src/pages/projects/ProjectsPage.test.tsx` 1 例此前已通过。
- `pnpm contract:generate`、`pnpm contract:drift`、`pnpm contract:validate`：生成物一致，28 条路由完整性通过。
- API `tsc -p tsconfig.json --noEmit`、`tsc -p tsconfig.test.json --noEmit` 与 Web `tsc -p tsconfig.json --noEmit` 局部包类型检查通过。仅格式化本切片涉及的 TypeScript 文件。
- `pnpm --filter @inpulse/api exec vitest run --config vitest.integration.config.ts test/modules-api.integration.test.ts`：2026-09-09 15:55，**9/9 通过**（2.26 秒），使用真实 Nest HTTP、PostgreSQL 18.6 + PGroonga 4.0.8、app_runtime/audit_reader 角色；覆盖创建/编辑、身份注入、权限、归档/恢复、重认证、父级只读、重放拒绝、审计/搜索故障整体回滚及真实 Lock 等待。首次加载因测试内装饰器语法失败（0 例执行），改为等价的 `Module(...)(TestModule)` 后复跑全部通过，未改变断言或业务逻辑。
- `pnpm --filter @inpulse/e2e exec playwright test tests/modules.spec.ts --config .e2e-runtime/playwright.edge.config.ts`：2026-09-09 15:56，**1/1 通过**（15.5 秒，用例 12.3 秒）。复用既有 global setup/teardown、真实登录、API 与 Vite 启动，使用本机 Edge 152.0.4191.66（Chromium）。单例覆盖创建/编辑/刷新持久化、成员无归档入口，以及两个真实页面竞争：名称草稿与他人说明自动合并、双方改说明明确选择最新值。没有 API 拦截或假数据替代。
- 本轮 Web 与 E2E 包类型检查、API 测试类型检查通过；对改动的模块页面、页面测试与 E2E 文件执行局部 ESLint，通过。为 E2E 启动单独执行 `pnpm --filter @inpulse/api-contract exec tsc -p tsconfig.build.json`、`pnpm --filter @inpulse/database exec tsc -p tsconfig.build.json`、`pnpm --filter @inpulse/api exec tsc -p tsconfig.json`，未运行根级全量构建。

前端测试出现 jsdom 不支持伪元素 getComputedStyle 的提示，不影响断言。弹窗测试关闭测试环境动画以验证真实可见性，没有删除失败断言。

测试环境与复跑：

- 经用户允许下载，从 [EDB 官方便携包页面](https://www.enterprisedb.com/download-postgresql-binaries) 获取 PostgreSQL 18.6-3 Windows x64，从 [PGroonga 官方 Windows 安装说明](https://pgroonga.github.io/install/windows.html) 获取匹配 PG18 的 4.0.8 包；PGroonga ZIP SHA256 与 GitHub 官方发布摘要 `bec0b318ea48204c02a0a50ab4fb9199422cb12dc9736c1fdd382c79b6efdc77` 一致。
- 工具和隔离库留在 `$env:TEMP\inpulse-f12-pg18`，不在仓库；无需系统服务或管理员安装。按仓库 `database/scripts/test-local.ps1` 的初始化步骤创建 UTF8/C、仅监听 127.0.0.1:55432、max_connections=150 的临时集群，执行 `000_roles.sql`、`020_pgroonga.sql`，以 app_migrator 运行 `pnpm db:migrate`，6 个迁移全部成功。没有修改迁移、依赖、生产配置或生产数据。
- 测试环境使用 `NODE_ENV=test`，`TEST_DATABASE_URL` / `E2E_DATABASE_URL` 指向该临时集群的 bootstrap 角色；各测试实际业务连接使用既有 runtime 角色。临时本地 trust 认证仅供此隔离库，不能用于部署。交审前停止数据库；复跑先用其 `pgsql/bin/pg_ctl.exe -D <临时目录>/data -l <临时目录>/postgresql.log -w start` 启动（端口沿用上次启动参数）。
- 原计划下载 Playwright Chromium，发现已有 Edge 后取消下载，改用忽略目录 `.e2e-runtime/playwright.edge.config.ts` 的临时覆盖配置：继承现行配置，只改浏览器为 `channel: msedge`、解析绝对测试路径、list reporter、关闭录像（本机未安装 FFmpeg）；保留失败截图和 trace。配置留在本地供审核复跑，未改仓库共用 E2E 配置。

未运行：默认下载版 Playwright Chromium 项目、CI、全量构建、全仓 lint/静态检查、无关审计或全量测试。本次不以 Edge 结果宣称其他浏览器或 CI 已通过。

## 交审关注与保留事项

无已知未提供的 A/C 接口或本机测试环境阻断。以上针对性验证已通过，仍需审核对话检查本次 diff，尤其三方合并、`app/` 装配、前端共享入口及鉴权/契约。没有新增生产基础设施或数据库迁移。

README 原导航增量保留；`docs/three-person-ai-delivery-plan-v2.md` 原文件内容保留。同步主线时开发日志冲突按双方记录合并；两个接入阶段的日志均保留，stash 安全副本暂留。旧 [接入阻断说明](f12-readiness-blockers.md) 属历史记录，当前以本文为准。
