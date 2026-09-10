# F-23 任务合并本地交审（2026-09-10）

分支 `codex/f23-task-groups-merge`，从 `origin/main` `ad6476b`（F-17 PR #79 合并后的主线）创建。本轮仅本地实现与验证：未提交、未推送、未创建 PR，由协调安排非作者审核与后续交付。

## 范围与非目标

交付 F-23 任务合并的服务端完整纵切片：`POST /api/v1/task-groups/merge` 把来源任务并入主任务所属聚合组。合并只建立 `task_groups` / `task_group_members` 关系与来源快照（原工作状态、原负责人），不修改任何任务字段：负责人、工作状态、生命周期、`row_version`、完成信息与 `task_status_history` 全部保持不变（集成测试逐条断言）。

非目标：F-24 解除合并、F-25 前端合并入口与聚合组视图均未包含在本次改动中；合并对话框与任务组详情页仍是 Required。

## 数据库

不新增迁移。`database/migrations/0000_initial.sql` 的 `task_groups` / `task_group_members` 已带全部约束，本次实现直接复用：

- `task_group_members_one_active_group_unique`、`task_group_members_group_task_unique`：一个任务至多一个活跃组、同组不重复；
- `task_group_members_one_active_main_unique`、`task_group_members_snapshot_check`：活跃组恰好一个 MAIN、SOURCE 必须具备快照；
- 形状触发器 `task_group_members_shape_check`（DEFERRABLE INITIALLY DEFERRED，提交时校验恰好一个 MAIN 与至少一个 SOURCE）；
- `task_groups_code_check`（`项目编码-TG-序号`）、`task_groups_project_code_unique`、`require_next_row_version` 触发器。

集成测试第 6 例直接向真实 PostgreSQL 写入违规行，验证 23505 / 23514 与约束名，证明业务不变量不依赖应用层。

## 契约与路由

唯一新路由 `mergeTaskGroup`：`POST /api/v1/task-groups/merge`，`session` + CSRF、`idempotencyRequired`（契约版本 1.0.0）、`versionPolicy: none`、`concurrencyPolicy.lockOrder` 为 project -> module -> feature -> task -> taskGroup、审计动作 `task.merge`。请求体 `TaskGroupMergeRequest` 只有 `sourceTaskId`、`mainTaskId`、`sourceKind`（ACTIVE/HISTORICAL）、`mergeNote`（≤5000，可空）；项目、聚合组编号、名称与快照全部由服务端在锁内推导，客户端提交归属字段一律 422。

生成物全部由 `pnpm contract:generate` 更新：`packages/api-contract/generated/openapi.json`、`route-contract-fingerprints.json` 与前端生成客户端，未手工修改。

## 事务与锁序

一个命令一个 `UnitOfWork`，所有写入共享同一 `TransactionContext`。`TaskGroupsService.execute` 的流程：

1. 预读任务解析归属项目（路由无 `projectId`），跨项目与不存在统一 404，不泄露他项目任务存在性；
2. 项目授权 + 项目/模块/影响功能按父到子、同级 ID 升序取 `FOR SHARE`；
3. source / main 按任务 ID 升序 `FOR UPDATE`，锁后各自重读；与预读不一致时回滚 SAVEPOINT 后从头有限重试（上限 3 次），超限 409 `TASK_GROUP_STATE_CONFLICT`；
4. 已有聚合组按组行 `FOR UPDATE`，重新校验 MAIN 未变化、组仍 ACTIVE、来源不与组内历史成员重复；
5. 同事务写审计（`task.merge`，TASK_GROUP）、活动、通知与搜索投影，最后返回 `TaskGroupItem`。

## 幂等与重放授权

路由声明固定契约版本与 18 个可缓存 body 叶子字段；执行结果在同事务内按 `idempotencyReplayPolicy` 精确校验，任何越界叶子都会拒绝缓存。重放前重新验证当前认证、CSRF、项目可写、聚合组仍 ACTIVE 与全部结果任务可读，任一门禁失败返回 404/409/401 且不泄露已存成功响应。摘要不同的同 Key 请求返回 409 `IDEMPOTENCY_REQUEST_MISMATCH`。

## 副作用

- 审计：`task.merge` / TASK_GROUP，含 before/after 组版本与成员数、来源与主任务快照、`mergeNote`，仅 `audit_reader` 可读；
- 活动：`task.merge`，来源链引用审计事件，`visibilityScope: MEMBER`；
- 通知：去重排序后的 主负责人/来源负责人/主创建人/来源创建人 四类接收人，标题 `任务合并：来源标题 并入 主标题`（≤500），正文为 `mergeNote` 或 `来源编号 -> 主编号`，`targetPath` 指向主任务深链（MODULE 任务或 FEATURE 任务两种形态）；
- 搜索：`TASK_GROUP` 投影 upsert，`source_row_version` 防旧写，标题为聚合组名（主任务标题 ≤500）。

## 测试与验证

| 命令 / 范围 | 实际结果 |
| --- | --- |
| API 集成 `pnpm --filter @inpulse/api test:integration task-groups-merge` | 1 文件 6/6 通过（约 3 秒，PostgreSQL 18.6 + PGroonga 本地实例） |
| API 集成全量 `pnpm --filter @inpulse/api test:integration` | 37 文件 232/232 通过（56.9 秒） |
| API 单测 `pnpm --filter @inpulse/api test:unit` | 61 文件 291/291 通过（含本轮新增 `task-groups-http.service.test.ts` 10 例） |
| 契约单测 `pnpm --filter @inpulse/api-contract test:unit` | 10 文件 75/75 通过 |
| 前端单测 `pnpm test:unit`（web 35 文件 120 例） | 完整串行运行通过；随后两次单独复跑在并行负载下出现既有计时敏感用例偶发失败（SimilarFeatures debounce、MfaForms 超时），单文件复跑均通过，与本次改动无关 |
| `pnpm contract:drift` / `pnpm contract:validate` / `pnpm permissions:check` | 5 个生成物无漂移；73 条路由策略与 73/73 权限矩阵通过 |
| `pnpm lint` / `pnpm format:check` / `pnpm typecheck` / `pnpm build` | 全部通过 |
| `pnpm db:migrations:check` | 6 个迁移校验通过 |
| `pnpm check:deps` / `pnpm check:frontend:boundaries` / `pnpm check:secrets` / `pnpm check:deploy:test` | 431 源文件无循环与越界依赖；前端 136 模块 573 依赖无违规；Secret 扫描 666 文件通过；4 个镜像 ref 与 compose 结构预检通过 |
| `pnpm audit --registry=https://registry.npmjs.org --audit-level=high` | No known vulnerabilities found（本地镜像缺 audit endpoint，按既有约定改用公共 registry） |

F-23 单元测试覆盖 HTTP 边界：同源 403 不进入幂等与业务层、非 JSON 内容类型 400、空 CSRF 头与未知字段请求体 422、查询参数 422、幂等键缺失/过短 400、匿名 401、业务错误与两类唯一约束映射 409、幂等冲突 409、结果越出可重放字段白名单时拒绝缓存且不泄露字段值。

F-23 集成测试用例：新建聚合组合并与全量副作用/重放；追加来源并递增 `row_version`；拒绝自合并 422、未知任务 404、跨项目 404、非成员与已移除成员 404、来源已在组内 409、项目归档 409；HTTP 边界同源 403、CSRF 失效 401、匿名 401、缺/短幂等键 400、查询参数 422、非 JSON 内容类型、非法请求体与未知字段 422 且零副作用；并发合并同一对任务得到 200 + 409 且计数不变；直接对 PostgreSQL 施加 5 类违规写入验证约束名与 SQLSTATE。

## 本轮发现并修复

1. `TaskGroupRepository.findGroupItem` 原先调用 `createdAt.toISOString()`，但 postgres-js 在本仓库配置下把 `timestamptz` 解析为字符串，HTTP 路径因此返回 500；改为与仓库既有约定一致的 `new Date(...)` 后修复。
2. 集成测试 fixture 原先只插入 `app.tasks`，延迟约束触发器 `tasks_status_history_complete` 在提交时报错；改为同事务写入初始 `task_status_history`。
3. HTTP 边界用例初版与框架实际顺序不符：`@ContractBody` / `@ContractHeaders` 在控制器的处理器之前运行，非 JSON 内容类型拿到的是 422 `VALIDATION_FAILED`，空 `x-csrf-token` 同样是 422。测试改为断言真实框架行为，处理器内的 400 `TASK_MERGE_CONTENT_TYPE_INVALID` 分支用直接调用 `handle()` 覆盖。

## 未运行与后续

- 未运行 `pnpm test:e2e`：F-23 没有前端改动，合并入口属于 F-25；Playwright 尚未覆盖合并路径。
- 未执行 GitHub Actions、生产镜像构建与扫描：本轮未推送。
- F-24 解除合并、F-25 前端入口、任务组读取接口（列表/详情）仍未交付；聚合组关闭流程同样未实现。
- 已知设计对齐点：`task_groups` 目前只用于合并关系，尚无向用户暴露的读取路径，故本轮没有新增权限矩阵之外的角色或读取端。
