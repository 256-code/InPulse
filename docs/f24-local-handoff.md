# F-24 解除合并本地交审（2026-09-10）

分支 `codex/f24-task-groups-unmerge`，从 `origin/main` `3995cd0`（F-23 PR #81 与成员 E2E 之后的本地主线）创建。本轮仅本地实现与验证：未提交、未推送、未创建 PR，由协调安排非作者审核与后续交付。

## 范围与非目标

交付 F-24 解除合并的服务端完整纵切片：`POST /api/v1/task-groups/unmerge` 把来源任务从聚合组解除，恢复独立展示。解除只更新 `task_group_members` 的成员关系（`DETACHED` + 解除时间 + 原因）与 `task_groups` 状态/版本：来源任务的工作状态、负责人、生命周期、`row_version`、完成信息、迭代记录与 `task_status_history` 全部保持不变（集成测试逐条断言）。解除不使用"回滚"表述，代码、审计与通知文案统一为"解除合并"。

非目标：F-25 聚合组视图与前端解除入口（含二次确认对话框与解除原因输入）未包含在本次改动中；任务组读取接口（列表/详情）仍未交付。

## 数据库

不新增迁移。`database/migrations/0000_initial.sql` 的 `task_groups` / `task_group_members` 已带全部约束，本次实现直接复用：

- `task_group_members_detach_state_check`：`DETACHED` 必须同时具备 `detached_at`、`detached_by` 与 1..10000 字符的去空白原因；`ACTIVE` 必须全部为空；
- `task_group_members_detach_time_check`：`detached_at >= joined_at`；
- `task_groups_close_state_check`：`CLOSED` 必须带 `closed_at`，`ACTIVE` 必须为空；
- 形状触发器 `task_group_members_shape_check`（DEFERRABLE INITIALLY DEFERRED，提交时校验恰好一个 MAIN 与至少一个 SOURCE）与 `require_next_row_version` 触发器。

集成测试最后一例直接向真实 PostgreSQL 写入违规行，验证 23514 与约束名，证明不变量不依赖应用层。

## 契约与路由

唯一新路由 `unmergeTaskGroup`：`POST /api/v1/task-groups/unmerge`，`session` + CSRF、`idempotencyRequired`（契约版本 1.0.0，20 个可缓存 body 叶子字段）、`versionPolicy: none`、`concurrencyPolicy.lockOrder` 为 project -> module -> feature -> task -> taskGroup、审计动作 `task.unmerge`。请求体 `TaskGroupUnmergeRequest` 只有 `sourceTaskId` 与 `unmergeReason`（≤10000，可空，strict）；项目、聚合组编号与成员快照全部由服务端在锁内推导，客户端提交归属字段一律 422。响应 `TaskGroupUnmergeResponse` 为 `{ group, detachedMembers[1..2] }`：`group.status` 为 `ACTIVE`（仍有其他活跃来源、组版本递增）或 `CLOSED`（关闭组时 `closedAt` 非空，`mainTaskId` 仍可读），`detachedMembers` 携带成员 ID、角色、分支类型、原工作状态、原负责人、加入时间、解除时间与解除原因。

并发控制：`versionPolicy: none`，由任务/聚合组行锁与锁后重读实现等价并发控制，不使用 `If-Match`；409 `TASK_NOT_MERGED`、`TASK_GROUP_STATE_CONFLICT` 覆盖状态与竞态冲突，422 `TASK_UNMERGE_VALIDATION_FAILED` 覆盖请求校验。

生成物全部由 `pnpm contract:generate` 更新：`packages/api-contract/generated/openapi.json`、`route-contract-fingerprints.json` 与前端生成客户端，未手工修改。

## 事务与锁序

一个命令一个 `UnitOfWork`，所有写入共享同一 `TransactionContext`。`TaskGroupsService.unmerge` 的流程：

1. 预读来源任务解析归属项目（路由无 `projectId`），跨项目与不存在统一 404，不泄露他项目任务存在性；
2. 项目授权 + 项目/模块/影响功能按父到子、同级 ID 升序取 `FOR SHARE`；
3. `SAVEPOINT task_unmerge_attempt` 内：预读来源的活跃成员关系、聚合组与全部成员；无活跃关系 404 `TASK_NOT_MERGED`，来源是 MAIN 409；
4. source / main 按任务 ID 升序 `FOR UPDATE`，锁后与预读快照逐字段比较；不一致或组内 MAIN 在等待锁期间变化时回滚到保存点，从头有限重试（上限 3 次），超限 409 `TASK_GROUP_STATE_CONFLICT`；
5. 锁聚合组行 `FOR UPDATE` 后重读成员（成员变更必须先持有组锁，因此锁后成员读取即最终状态）：成员已非活跃 404，来源是 MAIN 409，组已关闭 409；仅允许解除活跃 SOURCE；
6. 同事务写成员解除、组关闭/版本递增、审计（`task.unmerge`，TASK_GROUP）、活动、通知与搜索投影；
7. 已无其他活跃 SOURCE 时先解除 MAIN 再 `closeGroup`（`CLOSED` + `closed_at` + 版本递增）；否则 `touchGroup` 仅递增组版本。

## 幂等与重放授权

路由声明固定契约版本与 20 个可缓存 body 叶子字段；执行结果在同事务内按 `idempotencyReplayPolicy` 精确校验，任何越界叶子都会拒绝缓存。重放上下文为 `{ projectId, groupId, taskIds }`（来源与主任务 ID 去重升序）。与合并不同，解除最后一个来源后聚合组合法变为 `CLOSED`，因此重放授权不要求组仍为 `ACTIVE`：重新验证当前认证、CSRF、项目可写、聚合组可读与全部结果任务可读，任一门禁失败返回 401/404/409 且不泄露已存成功响应。摘要不同的同 Key 请求返回 409 `IDEMPOTENCY_REQUEST_MISMATCH`。同一任务解除后可再次合并到其他/新建组，但再次加入同一历史组因 `UNIQUE(project_id, group_id, task_id)` 返回 409 `TASK_ALREADY_MERGED`（技术设计 §12.2 第 15 项）。

## 副作用

- 审计：`task.unmerge` / TASK_GROUP，before/after 含组状态与版本、来源成员 ID、`activeSourceCount` 变化与全部解除成员 ID，另存来源/主任务快照与解除原因，仅 `audit_reader` 可读；
- 活动：`task.unmerge`，来源链引用审计事件，`visibilityScope: MEMBER`，关闭组时摘要注明"聚合组 ... 已关闭"；
- 通知：去重升序后的 来源负责人/主任务负责人/来源创建人/主任务创建人 四类接收人，标题 `任务解除合并：<来源标题> 恢复独立`（≤500）；正文为解除原因，未填写或纯空白时回落为 `<来源编号> 已恢复独立`（关系与审计存固定文案 `未填写解除原因`）；`targetPath` 深链来源任务（MODULE 任务与 FEATURE 任务两种形态）；
- 搜索：`TASK_GROUP` 投影 upsert（`source_row_version` 防旧写），组名为标题，摘要在未填写原因时为空串。

## 测试与验证

| 命令 / 范围 | 实际结果 |
| --- | --- |
| API 集成 `pnpm --filter @inpulse/api test:integration task-group` | 2 文件 14/14 通过（合并 6 + 解除 8，约 6.4 秒，PostgreSQL 18.6 + PGroonga 本地实例） |
| API 集成全量 `pnpm --filter @inpulse/api test:integration` | 40 文件 260 例；本轮两轮全量各出现 1 例既有偶发失败（`project-member-management-api` 与 `preauth-session` 各一次，单文件复跑分别 8/8 与 4/4 通过，均与 F-24 无关：前者为并行负载下的既有偶发，后者为 JS 与 PostgreSQL 毫秒级时钟偏差触发 `preauth_sessions_consumed_at_check`） |
| API 单测 `pnpm --filter @inpulse/api test:unit` | 63 文件 303/303 通过（含本轮新增 `task-group-unmerge-http.service.test.ts` 10 例） |
| 契约单测 `pnpm --filter @inpulse/api-contract test:unit` | 11 文件 81/81 通过 |
| 前端单测 `pnpm test:web` | 完整并行运行两次 122/124 与 123/124（`SimilarFeatures` debounce 与 `CreateProjectModal` 超时两个既有计时敏感用例在负载下偶发失败，单文件复跑 4/4 通过，与本次改动无关）；`pnpm check` 门禁内的 `test:unit` 一次全绿 |
| `pnpm contract:drift` / `pnpm contract:validate` / `pnpm permissions:check` | 5 个生成物无漂移；80 条路由策略与 80/80 权限矩阵通过 |
| `pnpm lint` / `pnpm format:check` / `pnpm typecheck` / `pnpm build` | 全部通过 |
| `pnpm db:migrations:check` | 6 个迁移校验通过 |
| `pnpm check:deps` / `pnpm check:frontend:boundaries` / `pnpm check:secrets` / `pnpm check:deploy:test` | 461 源文件无循环与越界依赖；前端 142 模块 613 依赖无违规；Secret 扫描 698 文件通过；4 个镜像 ref 与 compose 结构预检通过 |
| `pnpm check` | 除 `deps:audit` 因本地 npm 镜像缺少 audit endpoint 外全部通过；随后按既有约定改用公共 registry 审计 |
| `pnpm audit --registry=https://registry.npmjs.org --audit-level=high` | 无已知漏洞 |

F-24 单元测试覆盖 HTTP 边界：同源/缺 Origin 403 不进入幂等与业务层、非 JSON 内容类型 400、空 CSRF 头与未知字段请求体 422、查询参数 422、幂等键缺失/过短 400、匿名 401、业务错误直通与幂等冲突 409、结果越出可重放字段白名单时拒绝缓存且不泄露字段值、重放授权上下文登记项目/聚合组/来源与主任务。

F-24 集成测试用例：解除两个来源之一（组保持 ACTIVE、组版本递增、来源任务字段与行版本不变、审计/活动/搜索各恰一条、通知按去重接收人逐条深链来源任务、同 Key 同摘要重放同一响应、摘要不同 409、重复解除 409、同组再合并 409、成员被移除后重放 404）；解除最后一个来源（组关闭且 MAIN 一并解除，随后再次合并创建新的 `TG-2`）；未填写原因回落固定文案；拒绝路径（解除 MAIN、未知任务、非成员、已移除成员、归档项目）；HTTP 安全/校验/幂等边界且零副作用；并发解除同一来源得到 200 + 409；解除最后一个来源与合并新来源并发后无"CLOSED 组残留活跃成员"且两分支均满足不变量；直接对 PostgreSQL 施加解除元数据与关闭组违规写入验证约束名与 SQLSTATE。

## 未运行与后续

- 未运行 `pnpm test:e2e`：F-24 没有前端改动，解除入口的"二次确认 + 解除原因"交互属于 F-25 前端范围；Playwright 尚未覆盖解除路径。
- 未执行 GitHub Actions、生产镜像构建与扫描：本轮未推送。
- F-25 聚合组视图、前端解除入口与任务组读取接口（列表/详情）仍未交付。
