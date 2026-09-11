# 测试矩阵

状态：已接受的验收基线。当前仓库处于阶段 0 实施中，尚无完整业务应用代码，数据库真实 PostgreSQL 测试与搜索服务/HTTP API 集成测试已部分落地；`已自动化` 表示该检查的脚本已落库并已纳入 `.github/workflows/ci.yml`（实际执行证据见各章节的状态说明），`Required` 表示对应阶段必须实现并由 CI 执行，不代表测试已经通过。

## F-09 数据安全专项（A，2026-09-10 本地实现）

数据安全专项第一个纵切片（对应技术设计 §7.5 与 [ADR-021](adr/ADR-021.md)，不降低安全基线）：
Vite 构建期在入口 HTML 的 script/style/modulepreload 标签与 `csp-nonce` bootstrap meta 写入
占位符 `__INPULSE_CSP_NONCE__`，生产 Nginx 用每个请求 16 随机字节的 `$request_id` 通过
`sub_filter` 逐响应替换，并在同一响应头下发同值 `script-src 'self' 'nonce-...'` 与
`style-src 'self' 'nonce-...'`（无 `unsafe-inline`）；HSTS、nosniff、X-Frame-Options、
Referrer-Policy 与 Permissions-Policy 收敛到 `deploy/docker/nginx-security-headers.conf`，
由每个声明了 `add_header` 的 location 显式 include；入口与 SPA 回退一律 `no-store`，并关闭
条件请求与 ETag，避免 304 复用旧 nonce 导致样式/脚本失效；哈希静态资源保持 `immutable`。
本地开发与 `vite preview` 走同一策略串，`INPULSE_WEB_CSP=off` 只作为本地对照开关，非法值
fail closed 到 enforce。

第二个纵切片补齐 SEC-004/SEC-006/SEC-007（同日本地实现、本地验证，GitHub Actions 待执行）：
未匹配路由的 404 由全局 `ApiExceptionFilter` 统一为固定文案，并在回归用例中锁定契约
（Nest 11.2.3 默认会把 `Cannot {method} {url}` 回显进响应体，[ADR-026](adr/ADR-026.md) 要求
直接修正异常过滤器，因此不引入 adapter 包装）；`database/src/config.ts` 把 Secret 文件权限
判定抽成 `isPrivateOwnerReadableFile`，生产模式仍是 `/run/secrets` 直接子项、非符号链接、
仅属主可读的 fail closed 策略；GitHub 外链按 [ADR-022](adr/ADR-022.md) 用标准 URL Parser
实现规范化，数据库最终防线沿用既有类型化关联模型。未交付：Markdown 白名单（前端当前没有
任何 Markdown 渲染落点，引入 react-markdown/rehype-sanitize 属新增生产依赖，必须独立 PR 由
人工确认）；外部链接的 HTTP 关联接口属 F-14 业务纵切片，新增路由必须同步 Schema、Route
Registry、权限矩阵、OpenAPI 与生成客户端。另见「审计与安全」表。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F09-CSP-UNIT-001 | Web 单元 | 策略串、nonce 与 HTML 改写 | `resolveWebCspMode` 对非法值 fail closed；策略串与设计 §7.5 一致且不含 `unsafe-inline`；`applyHtmlSecurityHeaders` 只对 HTML 响应写头；`rewriteHtmlBody` 替换全部占位符；nonce 为 32 位十六进制且逐响应用新 | 本地通过（`apps/web/tools/vite-csp.test.ts` 与 `AppProviders.test.tsx`） |
| F09-CSP-E2E-001 | 浏览器 E2E | 入口 nonce 一致性与强制模式零违规 | 同一入口两次响应的 nonce 不同，CSP 头 nonce 与 meta/script 标签一致，占位符无残留；登录、主题色、命令面板、通知弹层、懒加载与错误页在 CSP enforce 下 `securitypolicyviolation` 零违规；安全检查头齐全 | 本地通过（`apps/e2e/tests/csp.spec.ts` 2/2，2026-09-10） |
| F09-CSP-IMAGE-001 | 部署集成 | 真实镜像与 Nginx | HTTP 非 ACME 请求 308 跳同主机 HTTPS；入口/SPA 回退/代理路径逐项校验 nonce、`no-store` 与安全头；代理上游不可达时仍保留安全头；条件请求返回 200 而非带旧 nonce 的 304；哈希资源 `immutable` | 本地通过（`scripts/check-web-image-csp.sh inpulse/web:local`，2026-09-10；已加入 CI 生产镜像构建之后） |
| F09-CSP-GATE-001 | 部署预检 | Compose/资产结构 | `deploy/docker/nginx-security-headers.conf` 列入必需资产；`nginx.conf` 必须含 `sub_filter "__INPULSE_CSP_NONCE__" "$request_id"` 与安全头 include；两个 Nginx 文件的指令行不得出现 `unsafe-inline`；`web.Dockerfile` 必须拷贝两个配置文件 | 本地通过（`scripts/check_deploy_refs.mjs`，正例通过、`.env.deploy.example` 占位符拒绝） |
| F09-SEC006-API-001 | API 集成 | 未匹配路由净化 404 | 未知路径（含全局前缀外、根路径与 `/api/v1` 本身）返回 `application/json` 的统一 404：`code=NOT_FOUND`、`message` 为固定文案、`details` 为空，body 不回显 method、path、框架文案或 HTML；`X-Request-Id` 与 body 一致；已匹配路由（`/health/live` 200、匿名 `/me` 401）不受影响 | 本地通过（`apps/api/test/http-error-contract.integration.test.ts` 3 例，2026-09-10；修正点即全局异常过滤器，无需额外 adapter 包装；GitHub Actions 待执行） |
| F09-SEC007-DB-001 | 数据库单元 + 部署预检 | Secret 文件 fail closed | 权限矩阵只接受属主读位且无组/其他/执行位（`0600`/`0400` 通过，`0500`/`0700`/`0640`/`0604`/`0606`/`0000`/`0200` 拒绝）；生产 Secret 路径必须是 `/run/secrets` 直接子项（相对路径、`..`、嵌套目录与根目录本身均拒绝）；缺失文件变量不回退环境变量，生产模式直连 `DATABASE_URL`/`MIGRATION_DATABASE_URL` 同样被拒；空文件与纯空白内容拒绝，内容读取后去首尾空白；compose secret 声明（mode 0400、直接子项、uid/gid）由 `check:deploy` 校验 | 本地通过（`database/test/unit/config.test.ts` 15 例，2026-09-10；真实 POSIX 权限位无法在 Windows 本机复现，权限判定在函数级覆盖；GitHub Actions 待执行） |
| F09-SEC004-API-001 | API 单元 | GitHub URL 规范化 | 只接受规范化的 `https://github.com/...`：拒绝 http/ftp、用户信息、非默认端口、`api.github.com`、`github.com.evil.example` 混淆域名、编码伪段、超长输入与非 URL；query 只保留 `page/q/tab` 并排序、fragment 一律移除；ISSUE/PR 编号必须为正整数，COMMIT 必须为 7-64 位十六进制且规范化保存小写；不配置 Token、不发起远程请求 | 本地通过（`apps/api/test/github-url.test.ts` 16 例，2026-09-10；GitHub Actions 待执行） |
| F09-SEC004-DB-001 | PostgreSQL 集成 | ExternalLinks 数据库防线 | 同项目规范化 URL 唯一（23505）且并发写入只成一条；非 https、混淆域名与带 fragment 的 URL 被 CHECK 拒绝（23514）；任务/功能/记录/项目四类类型化关联的跨项目串联与归属错配均被复合外键拒绝（23503）；四类关联重复关联同一链接均 23505；`normalized_url` 不可变 | 本地通过（`database/test/integration/external-links.test.ts` 13 例，PostgreSQL 18.6 + PGroonga，2026-09-10 落库 7 例、2026-09-11 补齐项目/功能/记录关联的复合外键用例；GitHub Actions 待执行） |

## F-23 任务合并（C，2026-09-10 本地实现）

`POST /api/v1/task-groups/merge` 把来源任务并入主任务所属聚合组：服务端按请求体的任务 ID 解析归属项目（路由不含 `projectId`），在项目 -> 模块 -> 影响功能 `FOR SHARE`、任务 ID 升序 `FOR UPDATE` 后建立或复用聚合组，并保存来源任务的原工作状态与原负责人快照；来源已属活跃组、主任务在组内不是 MAIN、组已关闭或主任务在锁内变化统一 409，跨项目与非成员统一 404。合并不修改任何任务字段，审计 `task.merge`、活动、通知与搜索投影在同一事务提交，幂等重放前重新验证当前认证与结果资源可读性。不新增数据库迁移（约束已存在于 `0000_initial.sql`），无权限放宽。范围、锁序与未运行项见 [F-23 交审说明](f23-local-handoff.md)。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F23-CONTRACT-001 | 契约与 CI | Schema、Route Registry、生成物与权限矩阵 | `TaskGroupMergeRequest`、`TaskGroupItem`、`TaskGroupMergeHeaders`、`TaskGroupMergeReplayContext` 登记；唯一路由声明 Session/CSRF、数据库幂等、重放策略与锁序；OpenAPI 与生成客户端由生成工具更新 | 本地通过（`contract:drift`、`contract:validate` 73 条、`permissions:check` 73/73）；10 文件 75/75 契约单测 |
| F23-MERGE-API-001 | HTTP + PostgreSQL | 新建聚合组合并 | 200 返回 `TaskGroupItem`：编号 `项目编码-TG-1`、名称为主任务标题、主成员无快照、来源成员带 `HISTORICAL` 快照；两个任务的行版本与字段不变；审计/活动/通知（3 接收人）/搜索各恰一条；同 Key 同摘要重放返回同一响应，摘要不同 409，再合并 409，成员被移除后重放 404 | 本地通过（`task-groups-merge.integration.test.ts` 6/6） |
| F23-MERGE-API-002 | HTTP + PostgreSQL | 追加来源到既有组 | 第二次合并复用同一聚合组并返回 3 名成员、`rowVersion` 递增为 2，`ACTIVE` 分支来源记录当前快照；搜索投影 `source_row_version` 同步为 2，审计与活动各 2 条 | 同上 |
| F23-MERGE-API-003 | HTTP + PostgreSQL | 拒绝路径 | 自合并 422；未知任务、跨项目任务、非成员与已移除成员 404；归档项目 409 `TASK_MERGE_PARENT_ARCHIVED` 且零成员写入 | 同上 |
| F23-MERGE-API-004 | HTTP + PostgreSQL | HTTP 边界与零副作用 | 跨源与缺 Origin 403、CSRF 失效与匿名 401；空 CSRF 头、非 JSON 内容类型、非法请求体、未知字段、查询参数 422；缺/短幂等键 400；全部拒绝路径审计、活动、通知、投影为零 | 同上（处理器内 400 内容类型分支以直接调用覆盖） |
| F23-MERGE-API-005 | HTTP + PostgreSQL 并发 | 并发合并同一对任务 | 两个并发请求得到 200 与 409 `TASK_ALREADY_MERGED`，聚合组、成员与副作用计数与单次成功一致 | 同上 |
| F23-HTTP-UNIT-001 | API 单元 | HTTP 边界与错误映射 | 同源/缺 Origin 403、非 JSON 400、空 CSRF 头与未知字段/查询参数 422、幂等键缺失与过短 400、匿名 401、业务错误与唯一约束 409、越界可重放字段拒绝缓存 | 本地通过（`task-groups-http.service.test.ts` 10 例） |
| F23-INVARIANT-001 | PostgreSQL | 直接约束探针 | 同组第二个活跃 MAIN 23505 `task_group_members_one_active_main_unique`；活跃组缺 SOURCE 23514 形状约束；任务加入两组 23505 `task_group_members_one_active_group_unique`；SOURCE 缺快照 23514 `task_group_members_snapshot_check` | 同上 |
| F23-UI-001 | 前端 / Playwright | 合并入口与任务组视图 | 前端合并对话框、任务组详情与解除入口 | 本地通过（`MergeIntoMainTaskModal` 5 例、`TasksPanel` 合并入口 1 例、`TaskGroupPageView` 8 例、`TaskGroupPage` 4 例、E2E `task-groups.spec.ts` 合并与聚合组页路径，2026-09-11） |

本轮真实 PostgreSQL 集成全量 37 文件 232 例、API 单测 61 文件 291 例（含 HTTP 边界 10 例）、契约 10 文件 75 例、前端 35 文件 120 例（并行负载下两个既有计时敏感用例偶发失败，单跑通过）；`pnpm lint`、`format:check`、`typecheck`、`build`、`check:deps`、`check:frontend:boundaries`、`check:secrets`、`check:deploy:test`、`db:migrations:check` 与公共 registry 审计均通过。未运行 `pnpm test:e2e`（无前端改动）、GitHub Actions 与镜像构建扫描。

## F-24 解除合并（C，2026-09-10 本地实现）

`POST /api/v1/task-groups/unmerge` 解除来源任务与聚合组的合并关系：服务端按请求体的来源任务 ID 解析归属项目（路由不含 `projectId`），在项目 -> 模块 -> 影响功能 `FOR SHARE`、任务 ID 升序 `FOR UPDATE`、聚合组行 `FOR UPDATE` 并重读成员后，仅允许解除活跃 SOURCE；来源已不是活跃成员 404，来源是 MAIN、组已关闭或锁内关系变化 409。解除只把成员关系标记为 `DETACHED`（记录时间与原因）并在最后一个来源解除时同事务关闭聚合组、解除 MAIN，不修改任务工作状态、负责人、迭代记录与行版本；审计 `task.unmerge`、活动、通知与搜索投影在同一事务提交，幂等重放前重新验证当前认证与结果资源可读性（组可为 `CLOSED`）。不新增数据库迁移（约束已存在于 `0000_initial.sql`），无权限放宽。范围、锁序与未运行项见 [F-24 交审说明](f24-local-handoff.md)。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F24-CONTRACT-001 | 契约与 CI | Schema、Route Registry、生成物与权限矩阵 | `TaskGroupUnmergeRequest`、`TaskGroupUnmergeResponse`、`TaskGroupUnmergeHeaders`、`TaskGroupUnmergeReplayContext` 登记；唯一路由声明 Session/CSRF、数据库幂等、重放策略与锁序；OpenAPI 与生成客户端由生成工具更新 | 本地通过（`contract:drift`、`contract:validate` 80 条、`permissions:check` 80/80） |
| F24-UNMERGE-API-001 | HTTP + PostgreSQL | 解除两个来源之一 | 200 返回 `TaskGroupUnmergeResponse`：组保持 `ACTIVE`、`rowVersion` 递增、`detachedMembers` 含来源快照与解除原因/时间；来源任务工作状态、负责人、生命周期与行版本不变；审计/活动/投影各恰一条、通知按去重接收人逐条深链来源任务；同 Key 同摘要重放返回同一响应，摘要不同 409，重复解除 409，同组再合并 409，成员被移除后重放 404 | 本地通过（`task-group-unmerge.integration.test.ts` 8/8） |
| F24-UNMERGE-API-002 | HTTP + PostgreSQL | 解除最后一个来源 | 组转为 `CLOSED` 且 `closedAt` 非空、MAIN 一并解除；CLOSED 组无活跃成员；随后可成功创建新的 `项目编码-TG-2` 聚合组 | 同上 |
| F24-UNMERGE-API-003 | HTTP + PostgreSQL | 未填写原因与拒绝路径 | 缺失/空白原因回落到固定文案（关系/审计“未填写解除原因”，通知正文 `<编号> 已恢复独立`）；解除 MAIN 409、未知任务/非成员/已移除成员 404、归档项目 409 且零写入 | 同上 |
| F24-UNMERGE-API-004 | HTTP + PostgreSQL | HTTP 边界与零副作用 | 跨源与缺 Origin 403、CSRF 失效与匿名 401；空 CSRF 头、非 JSON 内容类型、非法请求体、未知字段、查询参数 422；缺/短幂等键 400；全部拒绝路径审计、活动、通知、投影为零 | 同上（处理器内 400 内容类型分支以直接调用覆盖） |
| F24-UNMERGE-API-005 | HTTP + PostgreSQL 并发 | 并发解除与解除/新增来源竞态 | 同一来源并发解除得到 200 与 409 `TASK_NOT_MERGED`，组与副作用计数与单次成功一致；解除最后一个来源与合并新来源并发后不存在“CLOSED 组仍含活跃成员”，两分支均满足不变量 | 同上 |
| F24-HTTP-UNIT-001 | API 单元 | HTTP 边界与错误映射 | 同源/缺 Origin 403、非 JSON 400、空 CSRF 头与未知字段/查询参数 422、幂等键缺失与过短 400、匿名 401、业务错误直通与幂等冲突 409、越界可重放字段拒绝缓存、重放授权上下文登记项目/组/任务 | 本地通过（`task-group-unmerge-http.service.test.ts` 10 例） |
| F24-INVARIANT-001 | PostgreSQL | 直接约束探针 | 解除元数据不合法（缺 `detached_at`/`detached_by`/原因、`detached_at < joined_at`）23514 `task_group_members_detach_state_check`/`task_group_members_detach_time_check`；关闭组缺 `closed_at` 23514 `task_groups_close_state_check` | 同上 |
| F24-UI-001 | 前端 / Playwright | 解除入口与二次确认 | 任务组视图内的解除入口、二次确认对话框与解除原因输入 | 本地通过（`UnmergeTaskGroupButton` 5 例：二次确认、CSRF/幂等头、空原因、409 恢复、closesGroup 警告；E2E 解除路径含「已解除」与「聚合组已关闭」断言，2026-09-11） |

本轮真实 PostgreSQL 集成全量 40 文件 260 例（两轮各 1 例既有偶发失败：`project-member-management-api` 与 `preauth-session`，单文件复跑分别 8/8 与 4/4 通过）、解除文件 8/8、API 单测 63 文件 303 例（含 HTTP 边界 10 例）、契约 11 文件 81 例、前端 37 文件 124 例（并行负载下两个既有计时敏感用例偶发失败，单跑 4/4 通过）；`pnpm lint`、`format:check`、`typecheck`、`build`、`check:deps`、`check:frontend:boundaries`、`check:secrets`、`check:deploy:test`、`db:migrations:check` 与公共 registry 审计均通过。未运行 `pnpm test:e2e`（无前端改动）、GitHub Actions 与镜像构建扫描。

## F-06 项目编辑与归档/恢复（A，2026-09-10 本地实现）

阶段 1 A 域项目编辑/归档/恢复纵切片：`PATCH /api/v1/projects/{projectId}` 由项目活跃成员或
系统管理员整笔替换 `name` 与 `description`；编码创建后不可修改；父项目必须 ACTIVE，归档
项目返回 409 `PROJECT_ARCHIVED`；CSRF、`Idempotency-Key` 与 `If-Match` 必填，版本冲突
409；名称/描述、审计 `project.update`、活动 `PROJECT_UPDATED` 与搜索投影在同一事务内提交；
重放前重新验证当前成员关系与项目可写性。`GET /api/v1/projects/{projectId}/archive-preview`
为管理员只读路径，统计未完成（TODO + ACTIVE）任务数用于归档提醒；`POST
/api/v1/projects/{projectId}/archive` 与 `restore` 要求完整管理员 Session 与 5 分钟内双因子
重认证，原因、CSRF、`Idempotency-Key`、`If-Match` 必填，状态不符返回 409
`PROJECT_STATE_CONFLICT`，归档后全部下级只读而历史仍可读，恢复只恢复项目自身状态，审计、
活动与搜索投影同一事务。复用现有 `projects.status/archived_at/row_version` 约束，无数据库
迁移；前端编辑/归档/恢复入口与未完成任务提醒已接入项目页。E2E 已覆盖归档/恢复关键路径（`apps/e2e/tests/project-archive.spec.ts`，2026-09-11 本地 1/1 通过）。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F06-CONTRACT-001 | 契约与 CI | Schema、Route Registry 与生成客户端 | `ProjectEditRequest`、`ProjectArchiveRequest`、`ProjectArchivePreviewResponse`、`ProjectMutationHeaders`、`ProjectVersionHeaders`、`ProjectReplayContext` 登记；四条路由声明 Session/管理员重认证、CSRF、数据库幂等、`If-Match` 行为头与资源型重放授权；OpenAPI 与前端客户端由生成工具更新 | 本地通过（`contract:drift`、`contract:validate`、`permissions:check`，61/61 条路由） |
| F06-EDIT-API-001 | API 单元 | 服务端编排 | 写前实时校验成员关系与用户状态；归档 409、缺失 404、版本冲突 409 均不写审计；成功时审计前后快照、活动与搜索同一事务；重放上下文严格校验 | 本地通过（`project-management.service.test.ts` 7 例） |
| F06-EDIT-API-002 | HTTP + PostgreSQL | 编辑、审计与投影 | 活跃成员编辑返回 200 与递增 `rowVersion`；`app.audit_logs` 恰一条 `project.update`；`PROJECT_UPDATED` 活动与搜索投影同步；同 Key 同摘要重放返回相同响应 | 本地通过（`project-management-api.integration.test.ts` 9/9，PostgreSQL 18.6 + PGroonga） |
| F06-EDIT-API-003 | HTTP + PostgreSQL | 拒绝与边界 | 匿名 401；非成员/已移除 404；版本冲突与归档项目 409；缺 CSRF、缺/非法 `If-Match`、非法名称 422；非 JSON 400；缺幂等键 400；错误体不泄露数据库细节 | 同上 |
| F06-EDIT-API-004 | HTTP + PostgreSQL | 重放授权复核 | 成员被移除后同 Key 重放 404；项目归档后编辑重放 409，均不返回已存成功响应 | 同上 |
| F06-ARCHIVE-API-001 | HTTP + PostgreSQL | 归档与影响预览 | 管理员归档返回 200、`archived_at` 非空、`rowVersion` 递增；审计 `project.archive`、活动 `PROJECT_ARCHIVED` 与搜索投影 `source_status = 'ARCHIVED'` 同事务；归档后成员编辑 409、重复归档 409；预览只统计 TODO + ACTIVE 任务，匿名 401、非管理员成员 403、非成员 404、重认证过期 403，且 GET 不要求 CSRF | 本地通过（同上 9/9） |
| F06-ARCHIVE-API-002 | HTTP + PostgreSQL | 恢复与状态门禁 | 恢复返回 200、`archived_at` 置空、`rowVersion` 递增，审计 `project.restore`、活动 `PROJECT_RESTORED` 与搜索投影 `source_status = 'ACTIVE'` 同事务；恢复后成员可再次编辑；未归档恢复 409 `PROJECT_STATE_CONFLICT`；非管理员 403、非成员 404、重认证过期 403 | 同上 |
| F06-ARCHIVE-API-003 | HTTP + PostgreSQL | 幂等重放 | 归档/恢复成功后同 Key 同摘要重放返回相同 200 响应（归档态重放不因只读被拒）；会话被撤销后同 Key 重放 401，不返回已存成功响应 | 同上 |
| F06-ARCHIVE-UI-001 | 前端 | 编辑/归档/恢复入口 | 项目卡片提供编辑入口（活跃成员）、归档/恢复入口（管理员）；编辑提交携带 CSRF、`If-Match`、`Idempotency-Key`，版本冲突展示重新加载提示；归档弹窗展示未完成任务提醒并要求原因，403 `ADMIN_REAUTH_REQUIRED` 打开管理员安全验证；恢复弹窗要求原因并说明不改动下级归档状态 | 本地通过（`project-management-modals.test.tsx` 6 例、`ProjectsPage.test.tsx` 归档入口 1 例） |
| F06-ARCHIVE-E2E-001 | Playwright | 归档→只读→恢复关键路径 | 管理员 TOTP 登录后创建项目/功能/任务；归档预览提示“仍有 1 个未完成任务”；归档后徽标“已归档”、编辑被拒“项目已归档，项目只读…”且名称未落库；5 分钟窗口内恢复“正常”后可改名成功、原任务保留 | 本地 1/1（2.6 分钟；E2E_API_PORT=3131 / E2E_WEB_PORT=4191） |

## F-12 未分类模块编辑（2026-09-09 人工确认）

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| MOD-EDIT-UNCLASSIFIED-001 | HTTP + PostgreSQL + 前端 | 编辑未分类名称、描述 | 活跃成员和管理员在父级及模块可写时允许编辑；kind 保持 UNCLASSIFIED；名称冲突、旧版本、无权限均拒绝；失败时保留表单输入；不提供物理删除 | 本地前端与真实 HTTP/PostgreSQL 已通过，见 F-12 交审说明 |

## F-12 模块完整纵切片（B，2026-09-09 本地交审）

接口、边界与命令见 [F-12 本地交审](f12-local-handoff.md)。以下新增用例独立验证业务行为，不替代原 Port 的证据；2026-09-09 在临时 PostgreSQL 18.6 + PGroonga 4.0.8 实测通过。

| ID | 层级 | 场景 | 通过标准 | 当前证据 |
| --- | --- | --- | --- | --- |
| MOD-HTTP-001 | HTTP + PostgreSQL | listModules/createModule/updateModule 允许与拒绝 | 匿名 401，其他项目/已移除成员 404；管理员可读；普通创建固定 NORMAL；未分类可改名，输入身份字段拒绝 | modules-api.integration.test.ts 10/10 本地通过 |
| MOD-HTTP-002 | HTTP + PostgreSQL | archiveModule/restoreModule 允许与拒绝 | 成员 403，管理员需双时间戳重认证及原因；状态/版本冲突 409；归档父级拒绝写但允许历史读取 | 同上，已通过 |
| MOD-IDEM-001 | HTTP + PostgreSQL | 幂等与重放权限 | Schema 解析后等价输入重放；不同输入 409；成员移除或重认证过期拒绝返回缓存 | 同上，已通过；modules-http.test.ts 重认证回调单元验证通过 |
| MOD-TX-001 | PostgreSQL | 审计或搜索失败 | 业务、审计、活动、搜索、幂等同事务回滚；相同 Key 可在故障解除后重试 | 同上，2 个故障注入用例均通过 |
| MOD-LOCK-001 | PostgreSQL | 项目归档和模块创建竞争 | 真实 FOR UPDATE 阻塞子写，pg_stat_activity 观察 Lock 等待；父归档提交后子写拒绝 | 同上，已通过 |
| MOD-UI-001 | jsdom | 表单、权限入口、错误与 409 | 未分类可编辑；409 保留快照/草稿，未改字段取最新值，同字段冲突展示差异并显式选择后才更新版本；失败重试；管理员原因；归档恢复入口 | ModulesPageView.test.tsx 7/7 通过；新增 3 例先红后绿 |
| MOD-E2E-001 | Playwright | 成员模块页面关键路径 | 登录后创建/编辑、刷新持久化、成员无归档入口；双页面竞争验证不同字段自动合并、同字段选择最新值 | apps/e2e/tests/modules.spec.ts 1/1 本地 Edge（Chromium）通过；CI Browser E2E（默认 Chromium）已覆盖并通过（2026-09-09 dev/a、dev/b 运行含该步骤且成功，后续 main 运行全绿） |
| MOD-AUDIT-CONC-001 | PostgreSQL 并发 | 100 个真实 `createModule` 业务事务写同一项目审计链 | 业务、审计、活动与搜索同事务；链无分叉、无序号缺口、链头一致，每个业务命令恰有一条 `module.create`；见 [ADR-008](adr/ADR-008.md) | `modules-api.integration.test.ts` 10/10、全量 API 集成 29 文件 134/134 本地通过（2026-09-09，PostgreSQL 18.6 + PGroonga） |

## Modules 项目初始化 Port（B，本地交付 2026-09-08）

仅实现项目初始化的未分类模块步骤，未实现项目创建闭环；不改变 HTTP 权限矩阵。
接入说明见 [Modules CommandPort](../apps/api/src/modules/modules/README.md)。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| MOD-BOOT-001 | PostgreSQL 集成 | 成功初始化 | runtime 同事务写项目、创建者及初始成员、唯一未分类模块，默认字段与事务时间正确 | CI 已通过（e826483，见下方证据） |
| MOD-BOOT-002 | PostgreSQL 集成 | 后续步骤失败 | 外层抛错后，独立查询项目、成员、模块均为零 | 同上 |
| MOD-BOOT-003 | PostgreSQL 集成 | 同项目重复 | 同事务第二次创建冲突并整体回滚；已提交项目再次创建冲突且原数据不变 | 同上 |
| MOD-BOOT-004 | PostgreSQL 集成 | 项目不存在 | modules_project_fk 拒绝且无孤立模块 | 同上 |
| MOD-BOOT-005 | Nest 集成 | 公开 DI 绑定 | 独立 ModulesModule 可解析 ModulesCommandPort，无全局数据库依赖 | 本地 1/1 通过 |

实现文件：`apps/api/test/modules-command.integration.test.ts`（5 例，现有 API 集成测试配置可发现）
及 `apps/api/test/modules-module.test.ts`（1 例）。

2026-09-08，提交 `e826483` 的 [CI / workspace](https://github.com/256-code/InPulse/actions/runs/34200874889)
成功；[真实 PostgreSQL 日志](https://github.com/256-code/InPulse/actions/runs/34200874889/job/101979120660?pr=34#step:17:29)
记录 `modules-command.integration.test.ts` 5 tests、155 ms、全部通过，覆盖 MOD-BOOT-001～004。
环境为 PostgreSQL 18.6 + PGroonga，使用既有 bootstrap、迁移和 runtime 角色；
由根级 `pnpm test:integration` 进入同一 API 集成配置，未用 Mock 替代。

2026-09-08 14:29 +08:00 复跑指定数据库套件退出码 1，beforeAll 缺少
`TEST_DATABASE_URL`，5 例未执行，当时 MOD-BOOT-001～004 为**待验证**；现已由上述 CI 补齐。
未发现可用的本地 PostgreSQL/容器/WSL 测试入口；没有以 Mock 或注入测试替代。

## F-11 Nest Zod Pipe/Serializer 与统一错误模型（A，2026-09-09）

仅记录已被当前 API 实现消费的契约运行期组合；生成工具链见 [ADR-027](adr/ADR-027.md)，运行期定案见 [ADR-029](adr/ADR-029.md)。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| CONTRACT-001 | 单元 | Zod Pipe body | `ContractBody` 从 Route Registry + Schema Registry 解析；默认值生效；失败统一抛 `ContractValidationError` | 本地通过（`contract-validation.pipe.test.ts` 6 例，2026-09-09） |
| CONTRACT-002 | 单元 | path/query | path 数字字符串与 query `limit/includeVoid` 按契约 coerce；严格 Schema 拒绝未知字段 | 同上 |
| CONTRACT-003 | 单元 | headers | 只提取 Schema `shape` 声明字段，Express 附加头部不触发 422；缺 CSRF 拒绝 | 同上 |
| CONTRACT-004 | 单元 | 响应 Serializer | 按 `@Operation` + 实际状态选择 Schema，成功返回 `parsed.data` 并剔除未知字段 | `contract-response.interceptor.test.ts` 3 例通过 |
| CONTRACT-005 | 单元 | 响应违规 | 响应不满足契约时抛 `ContractResponseError`，不返回原 body | 同上 |
| CONTRACT-006 | HTTP 集成 | 请求 422 | 非法 body 返回 `{ code, message, details, requestId }` 与 `X-Request-Id`，不泄露 Zod 内部格式 | `contract-runtime.http.test.ts` 5 例通过 |
| CONTRACT-007 | HTTP 集成 | 响应 500 | 响应 Schema 违规统一 500 `INTERNAL_ERROR`，`details` 为空 | 同上 |
| CONTRACT-008 | HTTP 集成 | 未匹配路由 | Nest `NotFoundException` 映射为统一 404，不回显 method/path，返回 `X-Request-Id` | 同上 |
| CONTRACT-009 | HTTP 集成 | 同源顺序 | 非安全方法先执行 `StrictSameOriginGuard`，缺失 Origin/Referer 返回 403 `CSRF_ORIGIN_REJECTED` | 同上 |
| CONTRACT-010 | 契约扫描 | operationId 绑定 | 所有 Controller 均绑 `@Operation`，method/path/operationId 与 Route Registry 精确一致；`contract:drift`/`validate`/`permissions:check` 通过 | 本地通过（api-contract 4 文件 59 例；23 条路由） |

新增文件：`contract-validation.pipe.test.ts`、`contract-response.interceptor.test.ts`、`api-exception.filter.test.ts`、`contract-runtime.http.test.ts`。API 单测合计 52 文件 243 例通过；GitHub Actions 尚未执行。

## 项目创建 F-04（A 后端 2026-09-08；C 前端 2026-09-09）

单事务创建项目闭环：创建者与可选初始成员 ACTIVE 校验、唯一未分类模块、审计、搜索/活动
投影与通知；任一初始成员无效（停用/不存在）时整笔回滚，创建者始终以活跃成员写入。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| PROJ-CREATE-001 | PostgreSQL 集成 | 成功创建 | 同事务写入项目、创建者与初始成员（ACTIVE）、唯一 UNCLASSIFIED 模块、`project.create` 审计链、`PROJECT_CREATED` 活动投影、项目搜索投影与每成员一条通知；响应 200，`replayAuthContext` 携带项目与创建者 | 本机 PostgreSQL 4/4 通过（2026-09-08） |
| PROJ-CREATE-002 | PostgreSQL 集成 | 仅创建者 | 创建者为唯一 ACTIVE 成员；每个项目恰好一个 UNCLASSIFIED 模块 | 同上 |
| PROJ-CREATE-003 | PostgreSQL 集成 | 停用成员回滚 | 初始成员停用时整笔回滚，无残留项目 | 同上 |
| PROJ-CREATE-004 | PostgreSQL 集成 | 不存在成员回滚 | `memberIds` 含不存在用户时整笔回滚，无残留项目 | 同上 |
| PROJ-CREATE-005 | 单元 | 项目编码派生 | `deriveCode`/`resolveProjectCode` 覆盖中文归一、分隔符合并、数字前缀补 P、空名/全符号拒绝与显式编码校验 | 本机 7/7 通过（2026-09-08） |
| PROJ-CREATE-006 | 单元 | 项目创建控制器边界 | 浏览器完整同源请求头只提取 `x-csrf-token`，严格 Schema 不再因 Host/Origin/Sec-Fetch 等额外头误报 422；缺失 Token 仍返回 422 且不进入幂等事务 | 本地通过（`project-bootstrap.controller.test.ts` 2 例，2026-09-09） |
| PROJ-CREATE-007 | 单元 | 审计 HMAC keyring 测试路径 | `NODE_ENV=test` 且显式设置 `AUDIT_HMAC_KEYRING_TEST_PATH=1` 时才允许临时 keyring；生产仍限制 `/run/secrets/*` | 本地通过（`audit-keyring.test.ts` 3 例，2026-09-09） |
| PROJ-CREATE-008 | 前端单元 | 项目创建表单与页面 | RHF + Zod 校验、CSRF/幂等 Key、错误映射、创建成功与入口交互均通过生成客户端消费契约 | 本地通过（`project-query.test.tsx`、`CreateProjectModal.test.tsx`、`ProjectsPage.test.tsx` 等，前端 20 文件 48 例） |
| PROJ-CREATE-009 | Playwright E2E | 项目创建关键路径 | 登录 → `/projects` → 选择 ACTIVE 第二成员 → RHF 表单创建 → 项目动态 → 搜索到项目 → 创建者与成员站内通知 | 本地 16/16 通过（2026-09-09，新增 MFA、项目创建、搜索边界与 F-27/F-28 状态用例） |
| PROJ-CREATE-010 | API 单元 + PostgreSQL 集成 | 用户目录接口 | `GET /api/v1/users` 从 Session 解析身份，只返回 `id/name/avatarUrl/isAdmin`，过滤 DISABLED/`disabled_at` 用户，匿名或停用 Session 返回 401，不暴露登录名、邮箱或密码字段；响应 `no-store` | 本地通过（Controller 3 例；Service/Repository 2 例；API 集成 22 文件 89 例） |
| PROJ-CREATE-011 | 前端单元 | 成员选择 | 成员目录经生成客户端读取，创建者不可选择且被排除，选择结果去重排序后写入 `memberIds`，目录 401/429 错误不泄露内部信息 | 本地通过（`user-directory-query.test.tsx`、`CreateProjectModal.test.tsx`） |

实现文件：`apps/api/test/project-bootstrap.integration.test.ts`（4 例）与
`apps/api/test/project-code.test.ts`（7 例）。前者需 `TEST_DATABASE_URL` 指向已安装
PGroonga 的 PostgreSQL 18 实例并先执行 `pnpm db:migrate`，由 API 集成测试配置
（`vitest.integration.config.ts`）运行；本机已用 PostgreSQL 18.6 + PGroonga 实测通过，
GitHub Actions 的 CI 尚未就本 PR 执行。

## F-05 项目读取与成员管理（A，2026-09-09 本地实现）

阶段 1 A 域项目纵切片：`GET /api/v1/projects`、`GET /api/v1/projects/{projectId}`
提供服务端 `AuthorizedProjectScope` 授权与响应 `no-store`；系统管理员新增
`listProjectMembers`、`listProjectMemberUnfinishedTasks`、`addProjectMember`、
`removeProjectMember` 四条成员管理路由。成员写操作要求管理员密码与 TOTP 5 分钟
重认证、CSRF 与数据库级幂等；项目编辑已由 F-06.1 实现，归档/恢复（F-06.2/F-06.3）
与概览统计仍未实现。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F05-READ-CONTRACT-001 | 契约与 CI | Schema、Route Registry 与生成客户端 | `ProjectPath`、`ProjectItem`、`ProjectListResponse`、`ProjectDetailResponse` 登记；两条 GET 路由声明 Session 认证、CSRF/幂等 `none`、只读状态码与精确权限矩阵；OpenAPI 和前端客户端由生成工具更新 | 本地通过（`contract:drift`、`contract:validate`、`permissions:check`，57/57 条路由；`permissions.test.ts` 14 例） |
| F05-READ-API-001 | API 单元 | 服务端授权编排 | 从 Session 解析 actor，列表/详情只使用服务端 `AuthorizedProjectScope`；无权限与不存在统一 404；匿名 401；异常不泄露数据库细节 | 本地通过（`projects-read.service.test.ts` 3 例、`projects-read.controller.test.ts` 3 例；API 单测 59 文件 274 例） |
| F05-READ-API-002 | HTTP + PostgreSQL | 真实权限与归档读取 | 系统管理员可见全部项目；普通成员只返回 ACTIVE 成员项目；非成员/已移除成员详情 404；匿名与停用 401；非法路径 422；归档后详情仍为 `ARCHIVED` | 本地通过（`projects-read-api.integration.test.ts` 2 例；API 集成 34 文件 190/190，PostgreSQL 18.6 + PGroonga） |
| F05-READ-UI-001 | 前端单元 | 项目列表与创建后刷新 | 列表经生成客户端读取并按卡片展示名称/状态/编码/成员数/描述；创建成功后失效 `["projects"]` 查询并保留原有成功入口 | 本地通过（`project-query.test.tsx`、`ProjectsPage.test.tsx` 等，Web 33 文件 104 例） |
| F05-MEMBER-CONTRACT-001 | 契约与 CI | 四条成员路由登记 | 成员列表/未完成任务、添加、移除均登记 Schema、Route Registry、OpenAPI 与 Web 客户端；声明管理员重认证、CSRF、幂等及重放策略；权限矩阵按 operationId 拆分 | 本地通过（`contract:drift`、`contract:validate`、`permissions:check`，57/57） |
| F05-MEMBER-API-001 | API 单元 | 成员管理编排 | 读路径独立事务；写路径由幂等 runner 持有单事务；管理员解析、5 分钟重认证、CSRF、Content-Type、路径/Query 与响应 Schema 均被检验；归档后重放重新检查项目可写性 | 本地通过（`project-member-management-http.service.test.ts` 与 `project-member-management.service.test.ts` 12 例；API 单测 59 文件 274 例） |
| F05-MEMBER-API-002 | HTTP + PostgreSQL | 添加与移除生命周期 | 添加 ACTIVE 成员同事务写审计、活动、通知与成员历史；重复活跃成员 409；无效/停用用户 422；移除可真实改派并保留未改派任务原负责人；移除创建者不改 `projects.created_by` | 本地通过（`project-member-management-api.integration.test.ts` 8/8；API 集成 34 文件 190/190） |
| F05-MEMBER-API-003 | HTTP + PostgreSQL | 拒绝与边界 | 匿名/停用 401；非管理员、CSRF 失败、重认证过期 403；非成员/不存在 404；重复活跃或状态冲突 409；非法字段 422；非 JSON 请求 400；统一返回 `{ code, message, details, requestId }` | 本地通过（同集成 8/8；HTTP 单测覆盖 400 与脱敏） |
| F05-MEMBER-TX-001 | PostgreSQL 集成 | 同事务与幂等 | 审计失败时成员写、通知、活动或任务改派整体回滚；同 Key、同摘要、同契约版本重放不重复写；项目归档后旧 Key 拒绝返回缓存 | 本地通过（集成 8/8 覆盖回滚与重放；归档后重放已由服务单测覆盖） |
| F05-MEMBER-UI-001 | 前端单元 | 成员管理页面 | 管理员入口仅系统管理员可见；成员历史、添加、移除、未完成任务提示、改派、管理员重认证、CSRF/幂等键与成功后缓存失效均经生成客户端调用 | 本地通过（`ProjectMembersPageView.test.tsx`、`project-member-query.test.tsx` 等，Web 33 文件 104 例） |
| F05-MEMBER-E2E-001 | Playwright | 成员管理页面关键路径 | 普通成员访问 `/projects/:id/members` 由 `RequireAdmin` 拦截并显示 403 空态；管理员登录后首次进入触发管理员重认证，完成密码 + TOTP 后展示成员历史；通过页面添加成员出现成功提示与「活跃成员」徽标；移除成员出现确认对话框与「该成员没有未完成任务。」，确认后保留历史记录卡并标记「已移除」「历史记录已保留」；不存在的项目返回前端映射的读取失败空态 | 本地通过（`apps/e2e/tests/project-members.spec.ts` 2/2；全量 `pnpm test:e2e` 29/29，4.7m，基线 `5020c0a`） |
| F05-READ-E2E-001 | Playwright | 项目页面回归 | 项目创建关键路径与全量 E2E 结果如实记录 | 本地通过（`pnpm test:e2e` 29/29，4.7m，含本 diff 新增的成员管理 2 例与既有 F-18 记录发布、搜索/动态/通知/任务用例） |

2026-09-09 本地验证说明：`pnpm test:unit` 数据库 5 例、api-contract 67 例、Web 33 文件
104 例、API 59 文件 274 例；`pnpm test:integration` 数据库 13 例、API 34 文件 190 例。
临时 PostgreSQL 18.6 + PGroonga 4.0.8 曾因 `max_connections=100` 初始化不足，已改为
`max_connections=200` 后完整通过；成员管理页面 Playwright E2E 已于 2026-09-10 由
`apps/e2e/tests/project-members.spec.ts` 补齐（本地 2/2；该分支 rebase 到 `origin/main` `5020c0a` 后全量 29/29 通过）。

## F-03 用户管理（A，2026-09-09 本地交付）

阶段 1 A 域用户管理纵切片：`/api/v1/admin/users` 六条路由，覆盖管理员列表、新增、编辑、
启停、启用与强制退出；无新数据库迁移，复用现有 `users`/`user_sessions`/审计与密钥机制。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F03-CONTRACT-001 | 契约与 CI | 六条路由登记 | Schema Registry、Route Registry、Controller 绑定、OpenAPI、Web 客户端与权限矩阵一致；41 条路由全部由 `contract:drift`/`contract:validate`/`permissions:check` 覆盖 | 本地通过（`contract:drift`、`contract:validate`、`permissions:check`，41/41） |
| F03-API-001 | 单元 | HTTP 编排 | `listAdminUsers` 允许管理员、普通用户 403、匿名 401；create 的事务外 Argon2id 哈希、CSRF/幂等键/`If-Match` 传递、失败映射与幂等重认证回调 | 本地通过（`admin-users-http.test.ts`，API 单测 55 文件 256 例） |
| F03-API-002 | HTTP + PostgreSQL | 完整生命周期 | 管理员创建用户后同 Key 重放不重复；编辑、停用、启用、强退分别递增版本；停用/强退同事务递增 `auth_version` 并撤销 Session；停用后旧 Session 请求 401；五类审计事件齐全；审计失败时创建整体回滚 | 本地通过（`admin-users-api.integration.test.ts`；API 集成 31 文件 152 例，PostgreSQL 18.6 + PGroonga） |
| F03-API-003 | 权限与边界 | 拒绝与保护 | 缺重认证 403、缺幂等键 400、非法字段 422、旧版本/状态冲突与自停用/最后一名 MFA 管理员 409；错误响应不泄露 SQL 或约束名；普通成员访问管理页 403 | 本地通过（HTTP 单元、真实 PostgreSQL 与权限矩阵） |
| F03-UI-001 | 前端单元 | 管理页关键交互 | 列表展示、隐藏当前管理员停用/强退入口；新增/编辑携带 CSRF、幂等键和 `If-Match`；重认证失败自动打开、成功后保留同一幂等键；错误文案统一映射 | 本地通过（`admin-user-query.test.tsx` 3 例、`AdminUsersPageView.test.tsx` 5 例；Web 30 文件 87 例） |
| F03-E2E-001 | Playwright | 领域 E2E | 普通成员访问 `/settings` 显示 403；管理员完成新增（首次写触发重认证并重试）→ 编辑 → 停用 → 启用 → 强制退出真实 UI 链路 | 本地 18/18 通过（新增 2 例，Playwright 全量含 F-13、MFA、搜索、项目创建等既有用例） |

2026-09-09 本地实际通过（已合并 `origin/main` `8386b29`）：`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、
`pnpm test:unit`（database 5、api-contract 63、web 87、api 256）、`pnpm test:web`（30 文件 87 例）、`pnpm test:integration`（database 13、API 31 文件 152 例）、`pnpm build`、
`pnpm contract:drift`、`pnpm contract:validate`、`pnpm permissions:check`、
`pnpm db:migrations:check`、`pnpm check:deps`、`pnpm check:frontend:boundaries`、
`pnpm check:secrets`、`pnpm check:deploy:test`、`pnpm test:e2e`（18/18）、
公共 registry 的 `pnpm audit --registry=https://registry.npmjs.org --audit-level=high`
（No known vulnerabilities found）。生成客户端已重新生成并通过 `pnpm contract:drift`；
GitHub Actions 尚未对本 PR 执行。

## 文档与仓库治理

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| DOC-001 | CI | Git 文本、空白与冲突标记 | `node scripts/check_docs.mjs` 对 HEAD、暂存区、工作区及未忽略新文件无报错 | 已自动化 |
| DOC-002 | CI | Markdown 相对/引用式链接与本地锚点 | 不存在断链、未定义引用、危险 scheme、越界路径或缺失锚点 | 已自动化 |
| DOC-003 | Review | ADR 引用与编号 | 所有 ADR 编号唯一，设计只引用 `docs/adr` 权威记录 | Required |
| DOC-004 | Review | 规则与远程设置 | 文档只陈述已核验事实，目标配置明确标记为待管理员落实 | Required |

## 工程基座与 CI 门禁

下表按[技术设计 §12.4](../技术设计v1.2.2.md#124-ci-门禁)的执行顺序登记阶段 0 CI 最小链路。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| CI-001 | CI | frozen lockfile 安装 | `pnpm install --frozen-lockfile` 在 Node 24.20.0 / pnpm 11.19.0 下成功，且不修改 `pnpm-lock.yaml` | 已自动化 |
| CI-002 | CI | ESLint | `pnpm lint` 对全部工作区源码零错误 | 已自动化 |
| CI-003 | CI | Prettier 格式 | `pnpm format:check` 对 `.prettierignore` 之外的全部文件通过；Markdown、lockfile、迁移与生成物按 `.prettierignore` 排除 | 已自动化 |
| CI-004 | CI | TypeScript 严格模式 | `pnpm typecheck` 覆盖 database、api-contract 与 api/web 应用，零错误 | 已自动化 |
| CI-005 | 单元 | database 配置、契约生成器与前端基座 | `pnpm test:unit` 全部通过且不依赖数据库，覆盖 database 配置/Secret fail-closed、api-contract 契约与生成器、apps/web 路由/鉴权守卫/错误边界（jsdom） | 已自动化 |
| CI-006 | CI | 迁移文件一致性 | `pnpm db:migrations:check` 校验迁移顺序、命名与内容哈希，历史迁移不可重写 | 已自动化 |
| CI-007 | PostgreSQL 集成 | 空库迁移 | `pnpm db:migrate` 以 `app_migrator` 对空库应用全部迁移 `0000-0005`（`0003` 在缺少 PGroonga 时 fail closed）；重复执行只报告 already applied，不重复写入 | 已自动化 |
| CI-008 | PostgreSQL 集成 | 真实数据库集成测试 | `pnpm test:integration` 以 `cluster_bootstrap` 连接真实 PostgreSQL 18，验证复合外键与跨项目隔离、任务状态历史、记录版本不可变、幂等行、编号分配、任务组不变量、PGroonga bootstrap 与搜索投影索引、`pg_trgm` contract 清理、数据库角色边界与 100 并发审计链，禁止 mock 替代 | 已自动化 |
| CI-009 | CI | OpenAPI/客户端漂移 | `pnpm contract:drift` 逐字节比对 `generated/openapi.json`、契约指纹与 `apps/web/src/generated/api/*`，并拒绝生成目录内出现非生成器产出的文件 | 已自动化 |
| CI-010 | CI | Route Registry 完整性 | `pnpm contract:validate` 校验每条路由的策略显式登记（不适用也写 `none`）、`idempotencyReplayPolicy` 与 `replayAuthorizationPolicy` 的状态与叶子字段边界、Secret 字段与认证响应头重放禁令、响应 Schema 引用存在性，以及每个 operationId 恰好绑定一个 Controller 方法 | 已自动化 |
| CI-011 | CI | 权限矩阵一致性 | `pnpm permissions:check` 双向校验可执行权限矩阵与 `docs/permissions.md` 的身份集合、ADR-023 allowlist 精确相等、每条路由都有矩阵条目，并要求需认证路由同时登记允许与拒绝结果 | 已自动化 |
| CI-012 | CI | 生产构建 | `pnpm build` 完成 api（`tsc`）与 web（`vite`）生产构建 | 已自动化 |
| CI-013 | CI | 依赖边界 | `pnpm check:deps` 校验前端分层 `app -> pages -> features -> shared/generated`、`features` 不导入 `pages`、web 不导入 database、Controller 不直连数据库、模块只能经公开表面（`public/**`、模块 `index.ts`、`*.port.ts`）跨模块、无循环依赖、前端无裸 `fetch`/`axios`；并由 `pnpm check:frontend:boundaries`（dependency-cruiser）复核 `apps/web/src` 的分层规则 | 已自动化 |
| CI-014 | CI | 依赖漏洞审计 | `pnpm deps:audit`（`pnpm audit --audit-level=high`）无 high 及以上漏洞 | 已自动化（`ansi-regex` 与 `multer` 两处 high 已由 `overrides` 解决，见下方状态说明） |
| CI-015 | CI | Secret 扫描 | `pnpm check:secrets` 对受版本控制与待提交文件零命中；`.env.example` 只允许非敏感变量名 | 已自动化 |
| CI-016 | CI | 文档与链接 | `pnpm check:docs` 见 DOC-001 与 DOC-002 | 已自动化 |
| CI-017 | E2E | Playwright 关键路径 | 登录、MFA 挑战/重认证、项目创建（含选择第二成员）到动态/搜索/创建者与成员通知关键路径通过；F-05 成员管理添加/移除与 403 边界通过；任务完成、合并/解除任务组、遗留项转任务、记录作废/恢复等路径已覆盖 | 本地全量 45/45 通过（2026-09-11，5.1 分钟）；CI Browser E2E（默认 Chromium）已在 main 推送运行 [34578707754](https://github.com/256-code/InPulse/actions/runs/34578707754)（`bff1972`，2026-09-11）45 passed（5.6 分钟）；覆盖 F-03 用户管理、F-05 成员管理、MFA、项目创建、F-12 模块、F-13 功能档案、F-14 功能级任务、F-15 模块级任务、F-16 任务完成与状态闭环、F-17 草稿、F-18 记录发布、F-20 遗留项转任务、F-21 作废/恢复、F-22 外部链接、任务组合并/解除、搜索边界及 F-27/F-28 状态联动；其余完整关键路径 Required |
| CI-018 | CI | 容器镜像与 Compose | 镜像构建成功、`compose config` 渲染通过、全部运行与基础镜像为 exact-tag@sha256 digest、PostgreSQL 18 命名卷挂载 `/var/lib/postgresql`、容器非 root；生产 Dockerfile 与四镜像构建步骤已落库 | Required（Compose/ref 预检已自动化；真实镜像 digest 绑定与签名发布清单仍待发布环节） |
| CI-019 | CI | 镜像扫描 | 运行与基础镜像漏洞扫描无 high 及以上未处置项；CI 已新增 Trivy 扫描步骤（CRITICAL/HIGH、`ignore-unfixed=true`、`exit-code=1`） | Required（扫描步骤已落库，待 CI 实际执行） |

> 当前执行状态（2026-09-07，合并 `origin/main` PR #15/#16/#17/#18 之后）：
> CI-001～CI-006、CI-009～CI-013、CI-015、CI-016 的命令已在本地实测通过，其中
> CI-005 现覆盖 database 5 例、api-contract 50 例与 apps/web 15 例（共 70 例），
> CI-013 同时执行 `pnpm check:deps`（81 个源文件）与 `pnpm check:frontend:boundaries`
> （dependency-cruiser：33 个模块 / 69 条依赖，无违规）。
> **CI-014 已解决**：`pnpm audit --audit-level=high` 曾报 1 个 high —— `ansi-regex@5.0.0`
> （GHSA-93q8-gq69-wqmw，补丁版本 `>=5.0.1`），路径为
> `apps/web` 的 `@testing-library/{jest-dom,react,user-event}` -> `@testing-library/dom`
> -> `pretty-format@27.0.2` -> `ansi-regex@5.0.0`（由 `origin/main` PR #16 的 lockfile 带入）。
> 已在 `pnpm-workspace.yaml` 用 `overrides` 把 `ansi-regex` 固定到 `^5.0.1`（lockfile 落为
> `5.0.1`）解决，该依赖为 dev 工具链；本地 `pnpm deps:audit` 与 `pnpm check` 已通过。
> 按 `AGENTS.md` 第 4 节，该依赖变更仍须经独立 PR 与人工确认。
>
> **CI-014 补充（2026-09-09）**：`multer@2.2.0` 曾报 3 个 high ——
> GHSA-wc9g-mqfw-jrwm、GHSA-qfvm-cv95-jqjf、GHSA-535w-7cp7-47q4，路径为
> `@nestjs/platform-express@11.2.3` -> `multer@2.2.0`。先由
> A #56 在 `pnpm-workspace.yaml` 增加 `multer: "^2.3.0"` 并合入主线，随后
> C #57 将 override 收紧为精确版本 `2.3.0`（lockfile 同步更新）；
> `pnpm audit --registry=https://registry.npmjs.org --audit-level=high` 验证无漏洞。
> 该依赖为 NestJS 运行时传递依赖，已按第 4 节经独立 PR 与人工确认处理，不得调低阈值。
> CI-007 与 CI-008 曾在 `0000-0002` 上通过本机 PostgreSQL 18.6 实测；合并 `0003-0005`
> 后二者要求已安装 PGroonga 的 PostgreSQL 18 实例，本机 PostgreSQL 18.6 不含 PGroonga，
> `pnpm db:test:local` 现按预期以“必须提供 PGroonga 扩展”失败，因此改由 CI 用
> `database/poc/search-pgroonga/Dockerfile.pgroonga-pg18.6` 基于 digest 固定的
> `postgres:18.6` 构建的探针镜像覆盖，而 `.github/workflows/ci.yml` 的 GitHub Actions
> 运行本身尚未执行。CI-017 的 Playwright 基座已于 2026-09-09 在本机 8/8 通过，其中项目创建与 MFA 挑战/重认证关键路径已覆盖；F-02 接入 TOTP KEK 环境后再次复跑 8/8，MFA UI 场景已加入；本 PR 的 GitHub Actions 已通过（workspace 10m2s，docs 通过）；CI-018 的 `compose config` 渲染、exact-tag@sha256
> 格式、PostgreSQL 18 命名卷挂载、非 root/只读/资源限制/健康检查/端口检查已由
> `pnpm check:deploy:test` 落库（合成 ref，不代表受信镜像已构建），生产镜像构建与
> Trivy 扫描已按 §12.4 顺序插入 CI；真实镜像 digest 绑定与签名发布清单仍待发布环节。
> F-31 覆盖见“Playwright 浏览器测试基座”一节。


## 健康探针

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| OPS-001 | 单元 + API 集成 | `/health` 与 `/health/live` | 返回 200 `{"status":"ok"}`；`/health/live` 不访问数据库 | 单元已通过（controller 2 例）；2026-09-08 本地 PostgreSQL 18.6 + PGroonga 集成 2 例通过 |
| OPS-002 | 单元 + API 集成 | `/health/ready` 就绪 | 数据库可连接且迁移版本存在时返回 200 `{"status":"ok"}` | 单元已通过（controller 1 例 + service 1 例）；2026-09-08 本地真实 PG 集成 1 例通过 |
| OPS-003 | 单元 + API 集成 | `/health/ready` 未就绪 | 数据库不可连或迁移缺失时返回 503 统一错误体 `{code:"SERVICE_NOT_READY",message,details,requestId}`，不泄露连接串/版本/堆栈 | 单元已通过（controller 1 例 + service 2 例）；2026-09-08 本地无 DB 集成 2 例通过（不可达 DB URL） |

实现文件：`apps/api/test/health.controller.test.ts`（4 例）、`apps/api/test/health.service.test.ts`（3 例）、
`apps/api/test/health.integration.test.ts`（3 例；2026-09-08 本地 PostgreSQL 18.6 + PGroonga 实测通过）与 `apps/api/test/health-readiness-failure.integration.test.ts`（2 例；不可达 DB URL 验证 503）。

## 权限与成员关系

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| AUTHZ-001 | API 集成 | 每条 Route Registry 操作 | 至少一条允许与一条拒绝用例，身份覆盖与[权限矩阵](permissions.md)一致 | Required |
| AUTHZ-002 | PostgreSQL 集成 | 跨项目 IDOR | 其他项目成员和已移除成员均得到 404，SQL 不返回目标行 | Required |
| AUTHZ-003 | Workflow 集成 | 创建项目时取消创建者 | 请求被 Schema/业务规则拒绝；创建者必为初始成员 | Required |
| AUTHZ-004 | Workflow 集成 | 管理员移除普通成员身份的项目创建者 | ACTIVE 成员记录关闭；`projects.created_by` 值不变；创建者立即失去成员关系派生权限 | Required |
| AUTHZ-005 | Workflow 集成 | 创建者重新加入 | 新增成员历史，不覆盖之前 `joined_at/removed_at` | Required |
| AUTHZ-006 | API 集成 | 停用用户旧 Session | 所有受保护/业务路由及使用停用凭据的登录统一 401；`issueCsrfToken` 只能按匿名创建无身份预认证状态；同源 `logout` 仅清 Cookie 返回 204；其他用户不受影响 | Required |
| AUTHZ-007 | API 集成 | 项目、模块或功能归档/恢复 | 项目成员为 403；跨项目或已移除成员为 404；管理员须完成密码与当前 TOTP 重认证并写审计 | Required |
| AUTHZ-008 | API 集成 | 管理员移除成员 | 缺少密码或当前 TOTP 重认证时拒绝；双因子齐备时只关闭成员历史并写审计 | Required |
| AUTHZ-009 | API 集成 | 作废 PUBLISHED / 恢复 VOID 迭代记录 | 项目成员为 403；管理员须重认证、填写原因并写审计 | Required |
| AUTHZ-010 | Workflow 集成 | 移除系统管理员身份的项目创建者成员记录 | ACTIVE 成员记录关闭且 `created_by` 不变；其成员权限消失，但全局管理员权限仍可访问项目 | Required |
| AUTHZ-011 | Registry + API 矩阵 | ADR-023 认证安全流程 | 九个 operationId 与权限矩阵精确对应；每项覆盖允许、身份拒绝或前置状态拒绝、停用用户和受限 Session 越权；认证/受限 Session 调用 `login` 为 409，必须登出后重新建立预认证状态 | Required |
| AUTHZ-012 | API + 投影集成 | VOID 迭代记录可见性 | 活跃成员的详情为 404，搜索及该记录全部既有/新增普通时间线项不返回；管理员可读且只有显式 VOID 搜索筛选才返回；恢复为 PUBLISHED 后成员详情、默认搜索及既有/新增时间线重新可见，Activity 不暴露原因 | Required |

## 幂等、版本与事务

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| IDEMP-001 | Registry CI | POST/PUT/PATCH/DELETE 默认策略 | 默认登记 `idempotencyRequired`；显式豁免同时登记原因并引用对应的 Accepted ADR | Required |
| IDEMP-002 | API 集成 | 相同 Key、相同请求重放 | 当前认证、权限及所需高风险重认证新鲜度均通过时只执行一次并重放原状态码和脱敏响应；任一门禁失败则拒绝且不泄露已存响应 | Required |
| IDEMP-003 | API 集成 | 相同 Key、任一语义输入不同 | body、path 参数、query、Content-Type、适用的 `If-Match` 或 Registry 声明的行为头任一不同均返回 409，不改变业务数据 | Required |
| IDEMP-004 | PostgreSQL 并发 | 两连接使用同一 Key | 只有一个业务事务成功执行；后继读取已提交结果 | Required |
| IDEMP-005 | PostgreSQL 并发 | 先行事务回滚 | 幂等占位随事务回滚，后继请求可重新执行 | Required |
| IDEMP-006 | API 集成 | 幂等重放前门禁变化 | 权限被移除、用户停用、Session 失效、高风险重认证过期，或结果资源不再可读时均拒绝且不泄露原响应；覆盖创建项目后移除创建者再重放、记录变为 VOID 后普通成员重放；恢复全部门禁后才可按协议重放 | Required |
| IDEMP-007 | API 集成 | 规范化等价请求 | 仅 query 顺序、Header 名大小写或 JSON 成员顺序不同且 Schema 解析结果相同时摘要一致 | Required |
| IDEMP-008 | Registry CI | 幂等例外 | `securityFlow` operationId 集合与 ADR-023 allowlist 精确相等；每项声明 `idempotencyExceptionAdr`、单次消费机制和客户端恢复路径 | Required |
| IDEMP-009 | PostgreSQL + 部署集成 | 摘要 HMAC 密钥轮换 | 当前版本由非敏感 selector 选择 `/run/secrets/idempotency_fingerprint_keyring`；缺失/空 keyring fail closed；旧记录在 30 天窗口、部署与恢复后仍可比较，清理后才退役旧 key；普通 SHA-256 不能离线验证低熵凭据 | Required |
| IDEMP-010 | Registry CI + API/数据库集成 | 安全响应重放 | 每个 `idempotencyRequired` 路由的全部 2xx 状态均登记带版本的互斥 `body`/`noBody` 及结果授权策略；body 保存精确 Schema ref 和穷尽安全字段，noBody 保存 false + SQL NULL 且重放无 body/Content-Type；任何响应头不存储或重放；数据库拒绝 SUCCEEDED 缺失/非对象授权上下文 | Required |
| IDEMP-011 | Registry CI + API 集成 | 幂等契约跨部署变化 | 请求 Schema、摘要字段、响应 Schema、安全字段或结果资源授权策略变化必须升级幂等契约版本并进入摘要；旧 Key 在新契约下返回 409，不按旧策略重放 | Required |
| IDEMP-012 | API + PostgreSQL 集成 | 业务 4xx 或异常后的占位 | 校验/鉴权失败不插入占位；事务内业务 4xx、5xx 或异常回滚整个事务与 `PENDING` 行，同 Key 后续请求不会永久等待且可重新执行 | Required |
| CONC-001 | PostgreSQL 并发 | 多聚合锁序 | 按任务、任务组、记录、遗留项 ID 升序；变化后有限次从头重试 | Required |
| CONC-002 | API 集成 | If-Match 版本冲突 | 返回 409；无部分更新 | Required |
| CONC-003 | PostgreSQL 并发 | 父级归档与子级写入 | 项目/模块/功能归档和代表性的子级 create/edit/publish 按父到子统一锁序串行；不能基于旧 ACTIVE 快照同时提交，且无死锁 | Required |
| TX-001 | Application / Workflow 集成 | 任一步骤失败 | 业务、审计、该命令契约规定的通知及投影全部回滚 | Required |
| STATE-001 | Application + PostgreSQL 集成 | 记录状态与字段不变量 | 只允许 ADR-024 三条迁移；拒绝空白原因、非法状态/字段组合和 MODULE/FEATURE 父级门禁失败；恢复只改 status、row_version、updated_at，其他聚合字段、版本、关联、外链与作废快照不变 | Required |
| STATE-002 | API + PostgreSQL 并发 | 作废/恢复幂等与竞争 | 当前认证、管理员权限及 5 分钟双时间戳门禁仍通过时，同 Key 同摘要重放原 2xx；否则拒绝且不泄露；双 Key 并发仅一次迁移和审计；父级归档与恢复按同一父到子锁序串行；新 Key 重复操作或 If-Match 冲突为 409 | Required |
| STATE-003 | API + 投影集成 | 作废/恢复可见性 | 业务 `status` 是唯一真相；作废同事务把 Search 与该记录全部 Activity 设为 `ADMIN_ONLY/VOID`，成员排除、管理员仅显式 VOID 搜索可见；恢复同键 UPSERT Search、恢复既有 Activity 并追加脱敏恢复事件为 `MEMBER/PUBLISHED`，均不重复、不暴露原因 | Required |
| STATE-004 | Workflow + PostgreSQL 集成 | 任务与迭代记录一对多 | 一条记录至多关联一个同项目任务；同一任务可关联多条独立记录，完成命令本次最多发布一条但不得被历史记录阻断；按 `(project_id, task_id)` 可索引查询 | Required |

## 审计与安全

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| AUDIT-001 | PostgreSQL 并发 | 至少 100 个同 scope 并发业务事务 | 链无分叉、无序号缺口，每个成功业务事件恰有一条审计；见 [ADR-008](adr/ADR-008.md) | 已自动化（阶段 0 数据库层：100 并发事务追加同一项目链；2026-09-09 已在 F-12 `createModule` 真实业务命令上以 100 笔并发事务重跑，序号连续且无分叉，见 MOD-AUDIT-CONC-001） |
| AUDIT-002 | PostgreSQL 并发 | 多 scope 与链头初始化竞争 | 按 UTF-8 scope 顺序加锁，无死锁或重复链头 | Required |
| AUDIT-003 | PostgreSQL 集成 | 事务回滚 | 业务、审计行与链头同时回滚 | 本地通过（`audit-write.integration.test.ts` 4/4，2026-09-09；GitHub Actions 待执行） |
| AUDIT-004 | 恢复演练 | 密钥轮换、备份与恢复 | 数据库链、链头、远端检查点和归档明细全部一致 | Required |
| AUDIT-005 | PostgreSQL 集成 | 审计密钥惰性轮换 | keyring 当前版本高于链头时，同一事务先写 `AUDIT_KEY_ROTATED`，再按新密钥写业务事件；旧/新版本均可用各自密钥验证 HMAC，链头版本同步递增 | 本地通过（`audit-write.integration.test.ts` 轮换用例，2026-09-09；GitHub Actions 待执行） |
| SEC-001 | 权限集成 | 数据库角色 | runtime 无 DDL/原始审计 SELECT；writer 不能改历史；reader 只读 | 已自动化（阶段 0 数据库层，见 CI-008） |
| SEC-002 | 浏览器 E2E + 部署集成 | nonce CSP | 强制模式下核心页面可用，script/style 均无 `unsafe-inline`；生产镜像逐响应签发 nonce，CSP 头与入口 meta/script 标签一致且不复用 | 本地通过（`apps/e2e/tests/csp.spec.ts` 2/2；`scripts/check-web-image-csp.sh` 在真实镜像与 Nginx 上验证 200/308/502/静态资源 7 项断言，2026-09-10；GitHub Actions 待执行） |
| SEC-003 | API/浏览器 E2E | CSRF 生命周期 | 首登、轮换、刷新、多标签、过期和“仅未消费状态可最多重签一次”均符合 ADR-015；普通幂等路由保留 Key/If-Match，securityFlow 不发送业务幂等键 | 本地通过（`apps/api/test/csrf-lifecycle.integration.test.ts` 4 例：CSRF 失败不消费、重签后重试一次、单次消费、4 个上限淘汰最旧、Session 与预认证过期恢复、securityFlow 幂等例外；`apps/e2e/tests/csrf.spec.ts` 4 例：首登轮换、刷新、多标签、If-Match/CSRF/幂等键请求头；2026-09-11；GitHub Actions 待执行） |
| SEC-004 | API 集成 | ExternalLinks | 只接受规范化的 `https://github.com/...`；拒绝 HTTP、用户信息、非默认端口、`api.github.com` 与混淆域名；不配置 Token、不发远程请求；跨项目关联失败且并发不重复 | 本地通过（规范化器 `apps/api/test/github-url.test.ts` 16 例 + 数据库防线 `database/test/integration/external-links.test.ts` 13 例（2026-09-11 补齐项目/功能/记录关联的复合外键用例），2026-09-10；F-22 已交付 HTTP 关联接口并在服务端复用同一规范化器（证据见本文件「F-22 当前 GitHub 关联」章节）；GitHub Actions 待执行） |
| SEC-005 | API + PostgreSQL 并发/E2E | 一次性认证安全流程 | 管理员密码阶段显式签发受限态，绝不能因默认值成为完整态；同一 preauth+CSRF 只能成功登录一次；用户级 enrollment generation 在 start-vs-start、start-vs-confirm 及跨 Session 竞争中只有一个条件更新成功；同一 rotation generation、验证 Session、TOTP time-step 或恢复码只能被对应操作接受一次；确认注册原子轮换为完整 Session/新 CSRF，重认证原子刷新双时间戳；恢复码仅存 Argon2id 哈希；重复 CSRF 签发允许，无效 Session 重复登出为 204；九个 operationId 的响应丢失均按 ADR-023 路径恢复 | Required |
| SEC-006 | API 集成 | 未匹配路由的错误契约净化 | 任意未匹配路径返回 `application/json` 的统一 404 `{ code, message, details, requestId }`，message 为固定文案且不回显 method、path 或框架内部文本，响应带 `X-Request-Id` 并保留应用 CSP，不返回框架或 Express 默认 HTML；已匹配路由不受影响；见 [ADR-026](adr/ADR-026.md) | 本地通过（`apps/api/test/http-error-contract.integration.test.ts` 3 例，2026-09-10；修正点在全局异常过滤器本身，未新增 adapter 包装；API 响应的 nosniff/CSP 由生产 Nginx `location /api/v1/` 下发，另见 F09-CSP-*；GitHub Actions 待执行） |
| SEC-007 | 部署集成 | 数据库 Secret 文件缺失 | 生产模式 fail closed，不得回退到环境变量；缺失路径、越界路径、空值和权限不合规均拒绝连接串构造 | 本地通过（`database/test/unit/config.test.ts` 15 例，2026-09-10；真实 POSIX 权限位需 Linux 环境，Windows 本机不可复现，权限判定在函数级覆盖；compose secret 声明由 `check:deploy` 校验；GitHub Actions 待执行） |
| SEC-008 | API + PostgreSQL 集成 | 登录爆破限流 | 登录失败按账号 + IP + 全局三层计数，任一桶达到候选阈值返回 429 并在 Argon2 前阻断；同一进程 Argon2 并发不超过候选上限；登录成功清除账号失败计数；桶维度只保存 HMAC-SHA-256 摘要 | 已自动化（单元与真实 PostgreSQL 用例已落库，待 CI 执行） |
| SEC-009 | Application + PostgreSQL 集成 | 用户停用/改密/强退 Session 失效 | 同一事务递增 `users.auth_version`（并推进 `row_version`）后撤销该用户全部未撤销 Session；旧 Session 在下一请求因 `auth_version` 不一致或已撤销而返回 401 | 已自动化（单元与真实 PostgreSQL 用例已落库，待 CI 执行） |
| SEC-010 | API + PostgreSQL 集成 | 管理员 MFA 注册（F-02.1） | 管理员登录后显式签发 `MFA_ENROLLMENT`；`start` 按 user → factor → Session 锁序条件创建/替换 pending；`confirm` 在同一事务条件激活因子、签发 Argon2id 恢复码哈希、撤销受限 Session 并轮换为 `AUTHENTICATED` Session/新 CSRF；错误验证码不启用因子且写入持久化 MFA 限流；start-vs-start、start-vs-confirm、跨 Session 与同一 TOTP time-step 并发只有一个 2xx；数据库不保存 TOTP Secret、恢复码明文 | 已自动化到本地（API 单元 47 文件 224 例，真实 PostgreSQL 集成 26 文件 118 例，数据库单测 5 例与集成 13 例；`pnpm check` 全绿；Playwright 16/16；GitHub Actions 已通过，PR #63） |
| SEC-011 | API + PostgreSQL 集成 | 管理员 MFA 验证（F-02.2） | 管理员登录后显式签发 `MFA_CHALLENGE`；`POST /auth/mfa/verify` 仅接受当前 time-step ±1 且未接受过的 TOTP；按 user → factor → Session 锁序条件验证；格式错误 422、CSRF 错误 401、非管理员 403、状态或验证码并发冲突 409；成功后同一事务将 Session 条件升级为 `AUTHENTICATED`、更新 `last_accepted_step` 并签发新 CSRF；错误验证码写入用户/IP/全局持久化限流，达到阈值 429；跨 Session 同一步长并发仅一个 2xx，通用幂等与日志不保存 TOTP/CSRF 明文 | 已自动化到本地（API 单元 47 文件 224 例，真实 PostgreSQL 集成 26 文件 118 例；`pnpm check` 全绿；Playwright 16/16；GitHub Actions 已通过，PR #63） |
| SEC-012 | API + PostgreSQL 集成 | 管理员高风险重认证（F-02.3） | 完整管理员 Session + 密码 + 当前 TOTP time-step ±1 且未使用；同一事务原子刷新 `reauthenticated_at` 与 `mfa_verified_at` 并递增 rotation generation；错误密码/验证码返回 401 且不刷新时间戳，分别写登录/MFA 限流；MFA_CHALLENGE 受限 Session 403；同一 time-step 重放 401；达到 MFA 阈值 429 | 已自动化到本地（Controller 5 例；真实 PostgreSQL 6 例；`pnpm check` 全绿；Playwright 16/16；GitHub Actions 已通过，PR #63） |
| SEC-013 | API + PostgreSQL 集成 | 管理员恢复码（F-02.4） | 轮换要求完整管理员 Session 且 5 分钟内完成双因子重认证，原子消费一次性 rotation generation、失效旧 Hash 并只返回一次新码；消费仅接受 `RECOVERY_CHALLENGE` 且密码阶段已成功，原子消费恢复码、失效旧代码集并升级为完整 Session；同一 rotation generation 或恢复码并发只有一个 2xx；错误恢复码 401 并写限流；非管理员 403 | 已自动化到本地（Controller 5 例；真实 PostgreSQL 6 例；`pnpm check` 全绿；Playwright 16/16；GitHub Actions 已通过，PR #63） |
| SEC-014 | API + PostgreSQL 集成 | 管理员 MFA 重置（F-02.5） | 仅另一名完成 5 分钟双因子重认证的 ACTIVE 系统管理员可执行；目标必须是另一名 ACTIVE 且已启用 TOTP 的系统管理员，可用 MFA 管理员数必须大于 1；同一事务禁用目标因子、失效恢复码、递增 auth_version、撤销目标全部 Session 并写审计；自重置/仅剩一名 MFA 管理员返回 409，非管理员目标 403，缺少重认证 403；两个管理员互相重置时只有一个成功且至少保留一名 MFA 管理员 | 已自动化到本地（Controller 9 例；真实 PostgreSQL 6 例；`pnpm check` 全绿；Playwright 16/16；GitHub Actions 已通过，PR #63） |
| SEC-015 | PostgreSQL 集成 | Session 分批清理（F-01） | 按主键分批删除已撤销超过 30 天或绝对过期超过 7 天的 `user_sessions`、过期 `session_csrf_tokens` 以及过期/已消费 `preauth_sessions`；单事务内有限批次数、`FOR UPDATE SKIP LOCKED`，活跃 Session/CSRF/预认证 Session 保留 | 本地通过（`session-cleanup.integration.test.ts` 2 例，2026-09-09；GitHub Actions 待执行） |

## 搜索、部署与恢复

| ID | 阶段 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| SEARCH-001 | 阶段 0 | 中文/标识符可行性金标 | ≥1,000 投影、≥100 查询、Recall@20 ≥90%，目标查询使用 PGroonga `pgroonga_text_full_text_search_ops_v2`，普通输入经 `pgroonga_query_escape`，跨项目 0 条 | Required |
| SEARCH-002 | 阶段 4 | 峰值容量 | ≥100,000 且 ≥五年峰值 1.2 倍；30 并发 10 分钟；预热 P95 <500ms/P99 <1s | Required |
| SEARCH-003 | 阶段 0 | `GET /api/v1/search` API 契约纵切片 | Schema Registry、Route Registry、权限矩阵与 Controller 绑定一致；生成 OpenAPI 与客户端无漂移；`q/cursor/limit/includeVoid` 边界、`SearchItem` 判别字段、`SearchPage` 的 `items/nextCursor/hasMore` envelope、不透明游标的 HMAC 签名/篡改/过期/绑定验证与 `422` 映射由单元测试覆盖；真实 PostgreSQL 分页继续验证签名游标可用 | 已自动化（契约、游标、Controller 单测和真实 HTTP API 集成测试已落库；前端搜索页面单测已本地覆盖；Playwright E2E 已本地覆盖 13/13（跨项目隔离、空态、签名游标分页与中文短词/特殊标识符）；PR #68 CI 已通过（workspace 10m14s，docs 通过）） |
| SEARCH-004 | 阶段 0 | `SearchProjectionWritePort` | 显式接收同一 `TransactionContext`，规范化 `rawText` 后 upsert；同一 `(project_id,entity_type,entity_id)` 不重复；更新可同步 `visibility_scope/source_status/source_row_version`；旧 `source_row_version` 不覆盖较新状态；后续业务异常整体回滚 | 已自动化（`SearchProjectionModule` 注入单测 + 真实 PostgreSQL 4 例已本地通过；GitHub Actions 待执行） |
| SEARCH-005 | 阶段 0 | 搜索结果「遗留问题」独立分类（F-26） | 迁移 `0006` 允许 `LEFTOVER` 投影；记录发布/修订、作废/恢复与遗留项转任务在同一事务内按最新版本快照刷新投影；`entityId` 为遗留项 ID、title 至多 500 字符、`summary` 标注处置状态与来源记录、可见性跟随父记录（PUBLISHED=MEMBER、VOID=ADMIN_ONLY）、`sourceStatus` 为遗留项状态；`GET /api/v1/search` 返回 `entityType: "LEFTOVER"` 且前端以「遗留问题」分组呈现，不再依赖父记录 rawText 命中 | 已自动化（真实 PostgreSQL 集成：`record-publication` 12 例、`record-lifecycle` 22 例、`search-api` 9 例含 LEFTOVER 分类命中与跨项目隔离；全量 API 集成 47 文件 408 例、Web 单测 58 文件 249 例、Playwright E2E 43/43，2026-09-11；GitHub Actions 待执行） |

> 当前执行状态（2026-09-07）：PGroonga PoC 已通过 15 组 V1 语义探针、
> 101000 条仿真数据、90 条金标 Recall@20=100%、无结果/边界、特殊输入、
> 跨项目隔离，并在 PostgreSQL 18.6 探针镜像上通过构建、扩展安装、默认
> 查询计划的 `EXPLAIN (ANALYZE, BUFFERS)` 证据、`0000-0002 -> 0003-0005`
> 由 migration runner 完成（`0003`：1 applied / 3 already present；
> `0004/0005`：2 applied / 4 already present）及 `0003-0005` 逐迁移事务内
> 回滚，以及排除 Session 数据的逻辑恢复验证；旧 `pg_trgm` GIN 索引和
> 扩展已在 contract 确认后清理；原 `pg_trgm` 门禁失败记录
> 保留为决策证据，见
> [PGroonga PoC 报告](../database/poc/search-pgroonga/README.md) 与
> [原 pg_trgm PoC 报告](../database/poc/search/README.md)。
> 当前 SEARCH-001 的数据库层与搜索服务层验证已落地：`search_projection`
> PGroonga bootstrap 与 `0003-0005` 显式迁移已通过真实 PostgreSQL 集成
> 测试；SearchQueryService 与测试版 `ProjectAccessQueryPort` 已通过
> 参数化查询、权限 Scope、跨项目隔离、移除/停用成员、`ADMIN_ONLY/HIDDEN`、
> 分页、1000 条投影与 100 条金标中的普通用例 Recall@20 >= 90%，以及
> PGroonga 索引计划验证。生产 `ProjectAccessQueryPort` 适配器已由
> `ProjectsModule` 提供，并补充活跃成员、移除成员、停用用户、系统管理员
> 与不存在用户的真实 PostgreSQL 集成用例。搜索 API 契约纵切片已落地
> `getSearch`：Schema、Route Registry、权限矩阵、OpenAPI、生成客户端、
> 最小 `SearchController`、服务端签名游标与真实 `hasMore`。A 已于
> 2026-09-08 正式确认 envelope 与不透明游标方向并关闭 C-006；`getSearch`
> 已作为正式契约进入 Schema/Route Registry、OpenAPI 与生成客户端。2026-09-08
> 新增 `search-api.integration.test.ts`，通过真实 `AppModule`、真实 Session 与
> PostgreSQL 验证 401/422/200、成员 Scope、跨项目隔离、ADMIN_ONLY/HIDDEN、
> 签名游标分页和停用用户失效；本地 `pnpm --filter @inpulse/api test:search:db`
> 为 2 个文件 16 例通过，`pnpm --filter @inpulse/api test:integration` 为
> 14 个文件 60 例通过。C 已本地完成搜索页面与前端认证最小纵切片，前端单测覆盖查询、签名游标分页、短词与 401 错误、认证上下文、登录与登出；Playwright 搜索边界 E2E 已由 C 于 2026-09-09 本地补齐（13/13）；仍缺少生产备份恢复纵切片。
> 2026-09-08 新增 `SearchProjectionWritePort`：独立 `SearchProjectionModule`、
> PostgreSQL upsert 适配器、输入校验、NFKC/大小写/空白/标点规范化和
> `source_row_version` 防旧写；模块注入单测与真实 PostgreSQL 4 例已本地通过。
> 本次非数据库门禁已在本地通过：lint、格式、全 workspace typecheck、单元测试、
> 迁移/契约检查、构建、依赖边界、权限矩阵、Secret 与文档检查；`deps:audit`
> 因本地 npm 镜像无 audit endpoint，改用公共 registry 验证为无漏洞。GitHub Actions 尚未执行。
>
> 2026-09-11 阶段 4 金标扩集（C-5）：冻结金标 100→200，`GOLDEN_QUERY_VERSION=phase4-v1`（190 normal + 7 no-result + 3 edge），`assertGoldenQueryShape` 与 `apps/api/test/search-query.integration.test.ts` 召回断言同步 200 / ≥180（真实 PostgreSQL 通过）。PGroonga PoC 全流程重跑退出码 0：10 策略 `error=null`；default/bigram/ngram 系 base 1000 / scale 101000 均 190/190；`regexp-query` 182/190 仅诊断；升级 `0000-0002` → `0003-0006`（3 applied / 4 already present）；三份 artifact（`pgroonga-poc-v3` / `pgroonga-migration-v3` / `pgroonga-backup-restore-v2`）已重新生成。

| DEPLOY-001 | 阶段 0 | 空库迁移与角色 | 独立迁移任务成功，应用启动不迁移，runtime 无 DDL | 部分自动化（空库迁移与 runtime DDL 见 CI-007/CI-008；`apps/api` 启动不迁移尚无断言） |
| DEPLOY-002 | 上线前 | 可复现镜像 | 精确 Tag 与 digest、一致 lockfile、非 root 运行、健康检查通过 | Required |
| RECOVERY-001 | 上线前及演练 | 全新主机恢复 | 达到记录的 RPO/RTO；旧 Session 失效；审计链与检查点一致；恢复发布清单中的全部版本化 keyring，并保留仍被未过期幂等记录引用的 fingerprint key | Required（恢复 7 步与演练证据要求见 [备份与恢复 Runbook](runbooks/backup-restore.md)；备份包格式的本地恢复演练已由 `apps/ops` 集成测试覆盖——解密→`pg_restore` 临时库、会话表为空、迁移与业务行存在；真实全新主机恢复演练未执行） |
| DEPLOY-003 | 上线前 | 备份调度生效时机 | 上线前不部署、不运行定时备份（`operations` profile 未发布、无备份告警）；上线门禁要求启用宿主 12 小时调度、异机保留与失败告警，并在启用前完成一次完整全新主机恢复演练 | Required（宿主调度配置与启用流程见 DEPLOY-004 与 [备份与恢复 Runbook](runbooks/backup-restore.md)；真实启用、告警投递与恢复演练仍是上线门禁） |
| DEPLOY-004 | 上线前（静态门禁） | 备份调度配置与 Runbook | `deploy/backup/` 交付宿主控制器、5 个 systemd 单元与非敏感配置示例，`docs/runbooks/` 交付备份/恢复与升级/回滚 Runbook；`pnpm check:deploy:test` 静态校验：12 小时与每小时定时器节奏、`Persistent=true`、`flock` 并发锁、`--confirm-go-live` 与恢复演练证据前置、staleness 默认 18 小时与 `enabled-at` 启用基线、告警 Webhook 只从受限文件读取、禁止 `--profile operations up`，`backup`/`audit-archive` 服务若存在必须声明 `profiles: [operations]`，`deploy/docker/ops.Dockerfile` 存在且 runtime 声明非 root 数值 USER | 本地通过（`pnpm check:deploy:test` 退出码 0，2026-09-11；ops 镜像本地构建成功、容器内 `pg_dump 18.6` 与非 root 10002 已验证；真实 systemd 安装、真实告警投递与全新主机恢复演练未运行） |

## 前端基础框架与边界治理 (F-30)

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| FE-001 | 单元测试 | 动态路由聚合与防重 | `buildRouteObjects` 支持 `AppRouteModule` 转换，检测并拒绝重复路径，正确传递 `requiresAuth`/`requiresAdmin` | 已自动化 |
| FE-002 | 单元测试 | 声明式鉴权与管理员守卫 | `RequireAuth` / `RequireAdmin` 支持 `loading`、`anonymous`、`error` 提示，普通用户拦截及管理员放行 | 已自动化 |
| FE-003 | 单元测试 | 全局错误边界与恢复 | `AppErrorBoundary` 捕获 UI 渲染异常，展示 Ant Design 提示并支持重置重试 | 已自动化 |
| FE-004 | 单元测试 | 409 数据冲突交互规范 | `ConflictNotice` 保留本地未提交输入，提示冲突原因并提供重新加载最新数据回调 | 已自动化 |
| FE-005 | 架构门禁 | 前端分层依赖检查 | `dependency-cruiser` 确保单向依赖（`app -> pages -> features -> shared/generated`），禁止反向/跨层与循环依赖 | 已自动化 |
| FE-006 | 单元测试 | 全局搜索页面纵切片 | `SearchPageView` 通过生成客户端消费 `getSearch`，覆盖 `q`、签名游标分页、短词提示与 401 不泄露服务端细节；顶部搜索框提交导航 `/search?q=...` | 已自动化（本地前端 12 文件 32 例通过；PR #68 CI 已通过（workspace 10m14s，docs 通过）） |
| FE-007 | 单元测试 | 真实认证上下文与登录表单 | `AuthProvider` 覆盖挂载恢复会话、匿名 CSRF bootstrap、登录、登出与 MFA 不认证；`LoginForm` 覆盖失败提示与成功回调 | 已自动化（本地前端 25 文件 63 例，含 MFA；PR #63 CI 已通过） |

## 项目动态与站内通知（F-27 / F-28，C 本地交付 2026-09-08）

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| ACT-001 | PostgreSQL 集成 | 活动投影写入 | 同一 `TransactionContext` 写审计链与 `activity_projection`；同一来源事件不重复；派生可见性只向更高 `row_version` 推进并更新同一实体全部动态；后续步骤失败整体回滚 | 本地通过（`activity-projection.integration.test.ts` 4 例） |
| ACT-002 | PostgreSQL 集成 | 活动查询授权与分页 | 普通成员只读本人项目的 `MEMBER` 投影，`includeAdminOnly=true` 不扩大范围；系统管理员默认排除 `ADMIN_ONLY`、显式开启后可见；跨项目与已移除成员统一 404；签名游标绑定用户/项目且分页无重叠；响应只暴露脱敏白名单字段 | 本地通过（`activity-query.integration.test.ts` 4 例、`activity-notifications-api.integration.test.ts` 2 例） |
| ACT-003 | 单元测试 | 活动游标安全 | 签发并校验绑定用户、命名空间和项目的签名游标；拒绝篡改、过期、绑定其他用户/项目、畸形游标、未知 key 版本和错误命名空间 | 本地通过（`time-cursor.test.ts` 3 例） |
| ACT-004 | 单元测试 | 活动控制器边界 | 匿名 401；路径参数安全解析；非法路径/查询 422；无权限项目 404；游标错误 422；未知错误 500 | 本地通过（`activity.controller.test.ts` 4 例） |
| NOT-001 | PostgreSQL 集成 | 通知写入与事务 | 同一来源事件按 `(source_chain_id, source_sequence, recipient_id, notification_type)` 去重；不匹配项目链和非法目标路径在 SQL 前拒绝；同事务后续失败整体回滚 | 本地通过（`notification-state.integration.test.ts` 3 例） |
| NOT-002 | PostgreSQL 集成 | 通知读取与状态变更 | 只返回当前用户通知；未读过滤、签名游标和无重叠分页；标记已读/未读与全部已读只操作本人；非本人或不存在统一 404 | 本地通过（`notification-state.integration.test.ts` 3 例、`activity-notifications-api.integration.test.ts` 1 例） |
| NOT-003 | HTTP 集成 | 通知幂等与重放 | 三个写路由要求 CSRF 与 `Idempotency-Key`；缺失 Key/越权/read-all 行为符合契约；同 Key 重放不重复执行且不泄露他人资源 | 本地通过（`activity-notifications-api.integration.test.ts` 1 例） |
| NOT-004 | 单元测试 | 通知控制器与查询边界 | 匿名与 CSRF 失败映射 401/403；查询只使用当前用户；字符串通知 ID 正确转换；未读数与 422、404、500 均按统一错误模型返回 | 本地通过（`notifications.controller.test.ts` 4 例） |
| FE-008 | 单元测试 | 项目动态前端纵切片 | `features/activity` 通过生成客户端获取项目动态、传递服务端游标并展示脱敏项与项目范围 | 本地通过（`activity-query.test.tsx`、`ActivityPageView.test.tsx` 2 例） |
| FE-009 | 单元测试 | 通知前端纵切片 | 铃铛显示未读数并导航 `/notifications`；通知页通过生成客户端读取、按路径跳转、标记已读/未读，写操作带 CSRF 与幂等键 | 本地通过（`notification-query.test.tsx`、`NotificationsPageView.test.tsx`、`AppLayout.test.tsx` 共 8 例） |
| FE-010 | 单元测试 | 设计师最新视觉迁移 | 公共应用壳采用最新 token、深色侧栏、白色顶栏、面包屑与联合品牌图片；项目页与创建弹窗按设计师视觉呈现成员选择、创建规则与操作区；全局命令面板按类型分组并支持键盘导航；通知弹层支持未读、最近通知、全部已读与目标直达；活动页拆为项目选择入口与项目动态详情；不引入额外样式依赖 | 本地通过（Web 25 文件 63 例；Playwright 16/16；PR #63 CI 已通过） |
| FE-011 | 单元测试 + Playwright E2E | 前端 MFA 注册、验证、恢复码与管理员重认证 | `AuthProvider` 保留受限 MFA Session，并在注册/验证/恢复码成功后轮换 CSRF Token；`LoginForm` 按安全文案映射 401/403/409/422/429；管理员账户菜单弹窗输入管理员密码与当前 TOTP 完成重认证；E2E 使用真实 TOTP 完成登录挑战与重认证 | 本地通过（Web 25 文件 63 例；Playwright 16/16；PR #63 CI 已通过） |
| CONTRACT-001 | 契约与权限 | F-27/F-28 与用户目录路由登记 | 16 条 Route Registry 与 Schema、OpenAPI、生成客户端、Controller 扫描、权限矩阵一一对应；`contract:drift`、`contract:validate`、`permissions:check` 均通过 | 本地通过；PR #63 CI 已通过 |

后端本阶段 F-27/F-28 与用户目录相关的真实 PostgreSQL 集成共 89 例（22 文件）；前端本阶段搜索、活动、通知、项目创建、视觉迁移与 MFA 认证相关单测共 63 例（25 文件）。F-04 项目创建 Workflow 已接入活动、通知与搜索投影；任务完成、记录作废/恢复、合并等业务 Workflow 尚未接入活动/通知写端口，因此这些业务事件尚未在生产侧生成。
>
> 2026-09-09 更新：F-04 项目创建前端纵切片新增 `project-form.ts`、`project-query.ts`、`CreateProjectModal.tsx`、`ProjectsPageView.tsx`；`/projects` 改为 `requiresAuth`；Playwright 项目创建用例覆盖创建（含选择第二成员）→ 动态 → 搜索 → 创建者与成员通知。同一批次新增 `GET /api/v1/users` 用户目录、设计师最新公共应用壳/项目页、全局命令面板、通知弹层与活动页视觉迁移以及前端 MFA 注册、验证、恢复码与管理员重认证；活动页拆为项目选择入口和项目动态详情，通知点击直达项目动态。API 单测 47 文件 224 例、前端 25 文件 63 例、本次重跑 API 集成 22 文件 89 例、database 集成 13 例、Playwright 8/8 均本地通过；PR #63 GitHub Actions 已通过（workspace 10m2s，docs 通过）。

> 2026-09-09 搜索边界 E2E 新增：全局搜索覆盖无权限项目不返回、无匹配空态、服务端签名游标加载更多、中文短词与特殊标识符；`global-setup` 增加隐藏项目、25 条分页投影及语义查询 fixture，`global-teardown` 同步清理。本地 `pnpm test:e2e` 为 13/13，`apps/e2e` typecheck 与 API build 通过；PR #68 GitHub Actions 已通过（workspace 10m14s，docs 通过）。


> 2026-09-09 F-27/F-28 E2E 新增：`activity.spec.ts` 覆盖“创建项目 → 项目动态 → `project.create` 条目”专属路径；`notifications.spec.ts` 覆盖已读 ↔ 未读切换、全部已读与铃铛未读数联动；抽取 `createProjectViaUi` 复用项目创建。本分支已 rebase 到 `origin/main` `1c2b5bf`，本地 `pnpm build`、`pnpm test:e2e` 为 16/16（含搜索边界与 F-13 功能档案），`apps/e2e` typecheck、`pnpm format:check`、`pnpm check:docs` 与 `git diff --check` 通过；PR #67 首次 CI 已通过（workspace 9m58s，docs 通过）；rebase 到 1c2b5bf 后仅文档同步，未等待新 CI。

## 维护规则

- 新增 Route Registry 操作时，同一 PR 必须添加权限、幂等及错误契约用例。
- 修复竞态时必须保留能在真实 PostgreSQL 上复现旧缺陷的测试。
- 不得用 mock 数据库替代锁、唯一约束、迁移或事务测试。
- PR 中只报告实际执行过的测试；尚未具备运行条件的条目标记为 `Required`，不得写成通过。
## ModuleQueryPort / FeatureQueryPort 写前检查增量（2026-09-08）

本节仅记录事务内写前检查，不代表 CRUD、HTTP 或归档流程已完成。

| 场景 | 自动化入口 | 验证状态 |
|---|---|---|
| 两域活跃返回 ID/归属/状态/版本；归档返回 parent-not-active 摘要 | `apps/api/test/write-query-ports.integration.test.ts`，两域各 1 个结果用例 | CI 6/6 已通过（58acbe7），待人工评审 |
| 两域不存在、项目归属不匹配；功能模块归属不匹配；归档但归属错误不泄露 | 同上，使用精确结果断言 | CI 6/6 已通过（58acbe7），待人工评审 |
| 两域 FOR SHARE 阻塞另一连接的归档 UPDATE，提交后释放 | 同上，两域各 1 个提交用例，检查 pg_blocking_pids 与最终状态/版本 | CI 6/6 已通过（58acbe7），待人工评审 |
| 两域 FOR SHARE 阻塞归档 UPDATE，回滚后释放 | 同上，两域各 1 个回滚用例 | CI 6/6 已通过（58acbe7），待人工评审 |
| Nest 独立模块解析两个公开 token；原 CommandPort 注入回归 | `write-query-ports.test.ts`、`modules-module.test.ts` | 本地 2/2 通过 |

集成文件共 6 个用例，只允许在 PostgreSQL 18 + PGroonga 隔离库执行。
本机缺少测试库，未执行；Nest 测试不替代真实事务和锁验证。
接入及待执行命令见 [FeatureQueryPort 说明](../apps/api/src/modules/features/README.md)。

2026-09-08：[PR #42](https://github.com/256-code/InPulse/pull/42) 提交 `58acbe7` 的
[数据库日志](https://github.com/256-code/InPulse/actions/runs/34210258609/job/102009300977?pr=42#step:17:28) 确认本文件 6 tests 全部通过，334 ms；
CI / workspace 成功，API 集成合计 11 文件、46 用例通过。仅确认本切片数据库自动化验证，A/C 人工评审和业务 Workflow 验收仍待完成。

## F-10.1 生产镜像与部署门禁（2026-09-09）

本节仅记录镜像闭环门禁的落库与验证状态，不代表真实镜像已构建或扫描通过。

| 场景 | 自动化入口 | 验证状态 |
|---|---|---|
| 四个生产 Dockerfile 存在且每个 `FROM` 固定 `@sha256:<64hex>`；API/Web/Migration runtime 为数值非 root `USER`；Web 内置 `nginx.conf`；API 内置 `healthcheck.mjs` | `scripts/check_deploy_refs.mjs`（经 `pnpm check:deploy:test`） | 本地通过；`.env.deploy.example` 占位符负例被拒绝 |
| Compose 稳态拓扑渲染、`exact-tag@sha256` 格式、PostgreSQL 18 命名卷挂载、非 root/只读、独立迁移、健康检查、仅 Nginx 暴露 8080/8443 | `pnpm check:deploy:test` | 本地通过 |
| 每个服务级 secret 使用长语法且 `mode=0400`、`uid/gid` 与容器数值 user 一致、`target` 为 `/run/secrets` 直接子项 | `scripts/check_deploy_refs.mjs`（经 `pnpm check:deploy:test`） | 本地通过；短语法负例被拒绝 |
| API/Migration runtime 不保留基础镜像自带 npm/corepack | `scripts/check_deploy_refs.mjs`（经 `pnpm check:deploy:test`） | 本地通过（新增回归校验） |
| DB-bootstrap runtime 不保留官方 `gosu` 并升级 Debian OpenSSL 安全补丁 | `scripts/check_deploy_refs.mjs`（经 `pnpm check:deploy:test`） | 本地通过（新增回归校验） |
| 生产 API/Migration/Web/DB-bootstrap 镜像构建 | `CI / workspace` 新增 Build production * image 步骤 | 待 CI（本机 Docker daemon 未启动，未实际构建） |
| 生产镜像漏洞扫描 | `CI / workspace` 新增 Trivy 扫描步骤（CRITICAL/HIGH、`ignore-unfixed=true`、`exit-code=1`） | 首次实际执行因 API 镜像自带 npm HIGH 失败；修复后重跑又发现 DB-bootstrap 自带 `gosu` 与旧 OpenSSL HIGH/CRITICAL，已按 ADR-017 删除/升级后待重跑 CI |

本机未运行 Docker，因此镜像构建与扫描为 `Required`，不得据此宣称生产镜像已验证。

## F-13 功能档案（B，2026-09-09 本地交审）

范围与复跑环境详见 [F-13 交审说明](f13-local-handoff.md)。本轮没有提交、推送、PR 或 CI 结果。

| ID | 层级 | 场景 | 实际结果 |
|---|---|---|---|
| F13-001 | 契约 | 只允许名称/当前说明/标签；长度边界、身份注入拒绝；七路由安全/重放/版本策略及精确 Controller 绑定 | `features.test.ts` + `permissions.test.ts`，16/16 |
| F13-002 | PostgreSQL + HTTP | 创建、列表、详情、说明审计前后快照且不生成记录；同名提示不阻断；12 请求跨模块并发编号唯一；编号冲突安全 409 且回滚序列 | F-13 HTTP 真库文件 15/15 的对应场景通过 |
| F13-003 | PostgreSQL + HTTP | 匿名、停用、非成员、移除成员、完整归属错误；普通成员管理员操作拒绝；重认证过期拒绝状态命令与重放 | 同上 |
| F13-004 | PostgreSQL + HTTP | 同语义 Key 重放、变更输入/If-Match 拒绝、失权重放拒绝；CSRF、缺少 Key、旧版本 409 | 同上 |
| F13-005 | PostgreSQL + HTTP | 父项目/模块及功能归档写拒绝、历史可读；恢复只改功能自身，归档任务保留原状态/版本；审计/活动/搜索故障使业务/序列/幂等整体回滚 | 同上 |
| F13-006 | PostgreSQL 锁竞争 | 项目/模块归档持真实锁，功能创建实际等待，释放后重查 ACTIVE 并拒绝；既有下级功能写前 Port 回归 | F-13 15/15 + `write-query-ports.integration.test.ts` 6/6，共 21/21；检查 pg_blocking_pids |
| F13-007 | 前端 | 三方合并名称/说明/标签、同字段显式选择、错误重试、管理员原因/版本、归档恢复入口、不确定重试 Key、相似响应过期隔离 | F-13 两文件 9/9 + F-12 页面回归 7/7，共 16/16 |
| F13-008 | Edge E2E | 模块入口→创建→详情→双页面冲突→刷新持久化；真实管理员密码/TOTP 重认证→归档→成员只读→恢复 | `features.spec.ts` 2/2，最终合跑 34.7 秒；本机 Edge，非默认 Chromium/CI |

契约生成/漂移 5 个产物及 35 路由完整性通过；API/依赖包为 E2E 必要局部编译，API 测试/Web/E2E 局部类型检查通过。未执行全量构建、全仓静态检查、无关审计、全量测试及 GitHub Actions。未新增迁移；现有数据库约束与触发器未削弱。

## F-14 功能级任务（B，2026-09-09 本地交审）

PR #71 交付增量：features/mfa 的管理员 E2E 改用每用例/重试独立的 test-scoped 管理员和真实 API 注册因子，避免共享 `last_accepted_step`。生产认证行为及 UI 断言不变。交付独享库上修复前顺序 3/3，修复后两轮顺序 6/6（Edge），四个独立管理员、清理后 Session/因子为 0；未声称复现 CI 原失败，修复版 Chromium/完整 CI 待执行，详见 [交审说明](f14-local-handoff.md#pr-71-交付增量mfa-测试隔离)。

具体命令和独享数据库见 [F-14 交审说明](f14-local-handoff.md)。阶段 0 未完成，本批不含 F-15/F-16/F-19。

| ID | 层级 | 场景 | 实际结果 |
|---|---|---|---|
| F14-001 | 契约 | 字段边界、负责人必选、身份/状态注入拒绝；五路由 CSRF/幂等/重放/版本策略与真实 Controller 绑定 | tasks.test.ts / permissions.test.ts 16/16 |
| F14-002 | PostgreSQL + HTTP | 创建 FEATURE/TODO/ACTIVE 及初始历史、列表详情/项目成员、项目唯一编号、12 并发编号、导入冲突安全 409 | F-14 20/20 |
| F14-003 | PostgreSQL + HTTP | 匿名/停用/非成员/移除及错误项目模块功能；创建/改派非成员拒绝；管理员不能指派项目外用户；历史未变负责人可继续编辑 | 同上 |
| F14-004 | PostgreSQL + HTTP | CSRF/Key/If-Match，旧版本、输入变化、失权和归档后重放拒绝；四类副作用故障回滚业务/历史/序列/审计/活动/搜索/通知/幂等；改派失败回滚 | 同上 |
| F14-005 | PostgreSQL 锁竞争 | 项目/模块/功能归档和负责人移除/停用真实锁等待，pg_blocking_pids 确认后释放，创建重查并拒绝 | 同上；既有写检查 Port 6/6 回归，总26/26 |
| F14-006 | 前端 | 必选真实项目成员、错误重试/只读、三方字段合并、同字段明确选择、同语义失败 Key 保留 | TasksPanel.test.tsx 5/5 + F13 页面回归8/8 |
| F14-007 | Edge E2E | 真实 UI 创建项目/成员/功能/任务并指派，两页面不同/相同字段合并，列表刷新，收件人通知直达 | tasks.spec.ts 1/1（26.2 秒） |

记录相关真实读取/统计、任务组入口、完成/取消/重开和模块级任务仍待对应纵切片，不能以本批替代其验收。

## F-15 模块级任务（2026-09-09 本地交审）

| ID | 层级 | 场景 | 实际结果 |
|---|---|---|---|
| F15-001 | 契约 | MODULE/feature_id NULL，输入去重排序、空集合、字段边界；五模块路由与权限/Controller绑定 | 三契约文件18/18 |
| F15-002 | PostgreSQL+HTTP | 单份任务/多引用不重复，共用项目编号、空关系；错误归属、PK/FK/MODULE scope trigger拒绝 | tasks-api.integration 28/28（F15 8 + F14 20） |
| F15-003 | PostgreSQL+HTTP | 删除当前关系及完整不可变审计快照、重加新时间、审计故障整体回滚 | 同上 |
| F15-004 | PostgreSQL锁竞争 | 功能归档与新增影响互斥；归档已有关系保留/移除；并发更新一成功一409且关系不丢 | 同上 |
| F15-005 | PostgreSQL+HTTP | 模块路由匿名/非成员/失权重放拒绝；原F14 CSRF/幂等/版本/投影通知失败回滚回归 | 同上 |
| F15-006 | 前端 | 影响集合三方比较、模块引用唯一计数与真实编辑入口；模块/功能页面回归 | 22/22 |
| F15-007 | Edge E2E | 两功能引用、唯一计数、移除及重加关系、刷新与通知直达 | F14/F15合跑2/2（55.7秒） |

具体命令、环境与尚未覆盖的记录域边界见 [F15交审](f15-local-handoff.md)。未新增迁移，不以本批替代F16/F19验收。


## F-16 任务状态和历史（2026-09-10 本地交审）

| ID | 层级 | 场景 | 实际结果 |
|---|---|---|---|
| F16-001 | PostgreSQL+HTTP | FEATURE/MODULE 连续完成/重开/再次完成、取消恢复、快照与不可变历史 | tasks-api.integration 41/41（F16 13 + 原28） |
| F16-002 | PostgreSQL+HTTP | 非法状态/实际变化模式/字段、CSRF、真实归属、父级归档、权限撤销重放 | 同上 |
| F16-003 | PostgreSQL并发 | 完成/取消只成功一方、历史影响保留、旧起始事务重开时间不倒退 | 同上 |
| F16-004 | PostgreSQL事务 | 四类副作用故障全回滚后同Key重试、通知收件人及历史负责人保留 | 同上 |
| F16-005 | 前端 | 实际变化不提交、409保留输入与If-Match、状态筛选、包括无效任务的历史保留、不展示不完整完成率 | 任务面板9/9 |
| F16-006 | Edge E2E | FEATURE/MODULE 完成→重开→取消→恢复→完成，刷新历史和搜索 | 2/2，1.1分钟 |

契约/权限三个测试文件18/18，61路由策略和生成物无漂移。范围与未运行项见 [F16交审](f16-local-handoff.md)，不替代F17–F19验收。

## F-17 迭代记录草稿（2026-09-10 本地交审）

| 覆盖路径 | 实际定向证据 |
| --- | --- |
| 独立 FEATURE/MODULE 草稿、三段必填和服务端身份字段 | API `record-drafts.integration.test.ts` 与契约 `record-drafts.test.ts` |
| 来源多草稿显式创建/选择、同 Key 重放、不同 Key 新建、既有正式记录不阻塞 | 同一真实 PostgreSQL 用例，验证记录数量与独立身份、正式历史未变 |
| TODO/DONE/CANCELED 不变，处理人/作者/影响快照冻结 | 真库全行对比任务和历史；修改任务负责人/影响后编辑不追随；MODULE 归档历史影响保留 |
| Session/CSRF、成员移除、错误归属、归档父级与重放拒绝 | 真实 HTTP 统一错误体和 requestId；项目/模块/功能归属及版本门禁 |
| 并发编辑、审计回滚、父级归档竞争、来源更新竞争 | 真实 PG 锁等待、savepoint 重试；一个编辑成功一个 409；失败无半条草稿或影响关系 |
| 前端必填、独立保存、多来源选择、指定草稿继续编辑、409 合并 | `RecordDraftsView.test.tsx` 5/5，连同任务面板回归共 14/14 |
| 真库局部回归 | `record-drafts.integration.test.ts` 14/14 + `tasks-api.integration.test.ts` 41/41，共 55/55，6.17 秒 |
| 契约/权限 | 两个定向文件共 17/17，72 路由策略/权限与 5 个生成物无漂移 |
| 浏览器持久化和入口 | Edge `record-drafts.spec.ts` 3/3（37.0 秒）：独立、FEATURE 来源、MODULE 来源；选择第二条编辑/刷新/返回任务仍 TODO 且仅初始历史。F-16 状态两路径在此前同批合跑中均通过 |

首轮来源 fixture 的优先级误写 MEDIUM 导致约束拒绝，改为基线 NORMAL 后通过；首次启动测试未提供 TEST_DATABASE_URL 而 fail closed，配置后执行。首轮浏览器 FEATURE 返回链接多 `/tasks` 导致 404（合跑 4/5），修复后草稿三路径全部通过，未降低断言。未运行本批 CI/默认 Chromium、全量本地构建/测试/静态审计；F-18/F-19 尚未交付。详细复核入口见 [F-17 交审说明](f17-local-handoff.md)。

## F-18 正式发布与版本（2026-09-10 本地交审）

| 验收点 | 实际证据 |
| --- | --- |
| 编号/v1/时间、独立发布/来源 DONE、TODO/CANCELED 拒绝、真实锁等待重读 | `published-records.integration.test.ts` 8/8 |
| 稳定遗留 ID、ACTIVE 清空确认/RESOLVED 再填、CONVERTED 保留链接、版本不可变 | `record-publication.integration.test.ts` 12/12，含 HTTP 与真实数据库 |
| 四副作用失败回滚、并发发布及双版本条件更新、超限保留输入/编号回滚、当前通知权限与历史重开 | 同上；与 F-17 `record-drafts.integration.test.ts` 合跑三文件 34/34 |
| 原文/NFKC/UTF-16 搜索容量边界 | `record-publication-effects.test.ts` 2/2 |
| 修订确认、网络失败同键重试、409 逐字段合并、历史原文对比及草稿回归 | 三个前端文件 9/9 |
| 内容严格 DTO、正式遗留 10000/草稿 50000、双版本头、路由/权限 | 四个契约文件 43/43；78 路由、78 操作完整性通过 |
| 独立发布→修订→解决遗留→刷新→历史比较→搜索；已完成 FEATURE 来源发布；F-17 三路径 | Edge 两文件五路径 5/5（54.5 秒） |

已通过受影响 API/契约编译及 API 测试/Web/E2E 局部类型检查。首次无遗留项 HTTP 发布因幂等安全字段遗漏 null 分支返回 500，补全后回归通过；未弱化测试。首次 Edge 期间生成客户端引发 Vite 热更新鉴权上下文错误日志，业务 2/2；停止源文件改动后的五路径合跑无该错误。未执行本批 CI、默认 Chromium、全仓静态/构建/测试/审计；F-19/F-20 入口未交付。完整命令、人工确认口径与风险见 [F-18 交审说明](f18-local-handoff.md)。

## F-19 完成并发布组合事务（2026-09-10 本地交审）

| 验收点 | 实际证据 |
| --- | --- |
| FEATURE/MODULE、WITHOUT_RECORD/内联/草稿互斥、身份/影响冻结、已有多正式记录、相关作者通知 | task-completion.integration.test.ts 23/23 |
| 真实 HTTP 认证/同源/CSRF/双重任务版本、同 Key 并发/重放与不同 Key 竞争、撤权与后来重开 | 同上，真实 PostgreSQL/Nest HTTP |
| 任务阶段与发布后期四种副作用各自失败、全文容量失败，任务/草稿/编号/版本/投影均回滚 | 同上，8 条故障注入及容量回滚 |
| 合并/任务编辑/草稿编辑/父归档真实锁等待、独立发布竞争、MAIN/活动 SOURCE/历史 SOURCE | 同上；MODULE 历史影响等锁期间任务 NOWAIT 可取得，确认前序功能锁 |
| F-17/F-18/F-23 相邻真库 | 五文件合跑 63/63（11.54 秒） |
| 无记录完成、内联必填/失败同 Key、明确草稿选择及409最新全文确认，原草稿/正式历史回归 | 五个 Web 文件 20/20 |
| 严格请求/DTO、路由和权限、既有契约回归 | 五个契约文件 45/45，80 路由/操作与5个生成物无漂移通过 |

API/契约仅作 E2E 所需编译，API 测试/Web/E2E 局部类型检查通过。必要跨域检查 466 源文件无循环/越界，前端144模块边界通过。F16–F19浏览器四文件最终合跑 10/10（2.0分钟），详见 [F-19 交审说明](f19-local-handoff.md)。首轮草稿返回详情的测试 URL 缺 taskId 导致超时；F17旧按钮/提示入口断言在首次合跑两例失败，已同步当前实际流程及保留草稿直达，不降低保存草稿后任务仍待办、历史仍一条的业务断言。未运行全仓静态/构建/测试/无关审计、默认Chromium或本批CI；F20/F21入口未实现。

F-19 旧状态 API 兼容回归：两范围旧 COMPLETE 的响应与相关作者通知、原草稿不变；MAIN/ACTIVE SOURCE 成功、HISTORICAL 当前执行与变更后重放拒绝；旧 1.0.0 Key 在 2.0.0 下 409；REOPEN/CANCEL/RESTORE 及同 Key 重放保持原 DTO；新旧完成竞态仅一条成功、通知故障全部回滚。新增 task-completion 真库 30/30；原 tasks-api 41/41（测试模块同步实际兼容 Controller，原断言保留）。契约五文件 46/46，指纹保留 1.0.0 并追加 2.0.0。
## F-20 遗留项转换定向验证（2026-09-10）

新增leftover-task.integration.test.ts 21例，覆盖两范围成功/原文与版本不变/双向来源；MODULE混合及全归档影响继承；版本/ID/成员/伪造输入；三层真实父级归档；7种不同阶段故障整体回滚；HTTP同Key重放/不同Key并发唯一/当前撤权与已有任务引用保护；CONVERTED修订/清空/回填稳定链接和重放；ACTIVE解决/回填同ID；两范围归档锁等待及功能先于记录的锁序；预览与任务来源GET隔离。与record-publication、published-records、tasks-api真库四文件82/82。

ConvertLeftoverTask/PublishedRecordsView/TasksPanel前三端回归13/13，含未确定失败同Key重试、409显式最新预览确认、刷新再次失败仍阻止旧提交；契约leftover-task/published-records/permissions/validate 41/41，83条路由/权限及5生成物漂移通过。现有CSP build+preview Edge F20三例+F18两例5/5（51.3秒）；浏览器之后的刷新失败状态强化由Web回归验证，未重复E2E。完整21场景、实际命令及失败修复见[F-20交审说明](f20-local-handoff.md)。未声称本批GitHubCI、全仓静态/全量构建或无关审计通过。

F-20截止时间审核增量：ConvertLeftoverTask单文件4/4，覆盖本地时间→UTC、失败/409保留、同Key与改时间换Key、清空null和非法日期；现有FEATURE Edge增加截止时间落库回显检查，单例1/1（16.1秒）。本次仅前端增量，未重复真库/契约或扩大E2E范围。

## F-21 记录生命周期定向验证（2026-09-10）

| 验收点 | 自动化入口 |
| --- | --- |
| STATE-001：两轮作废恢复、行版本递增、最近快照与版本/遗留原文不变、CONVERTED 原任务链接和来源 TODO 保留 | record-lifecycle.integration.test.ts |
| STATE-002：双时间戳过期、同 Key 安全重放/不同原因409、不同 Key 竞争与同 Key 并发、项目/模块/功能归档实际锁等待、恢复投影提交前阻塞归档 | 同上，真实 PostgreSQL + Nest HTTP |
| STATE-003 / AUTHZ-012：成员 VOID 详情和版本404、管理员 VOID 列表/详情/全部版本、恢复保留快照但成员 DTO 无原因；默认搜索排除 VOID、管理员显式筛选返回、既有/新增 Activity 恢复 | 同上，实际 SearchQueryService / ActivityQueryService |
| 副作用故障：审计、活动可见性更新、追加活动、Search UPSERT 任一失败整体回滚 | 同上 |
| 前端原因必填、If-Match、失败保留原因/Key、409加载最新状态后再次明确确认、双因子入口 | RecordLifecycleButton.test.tsx |
| 管理员真实登录/重认证→作废→VOID发现/历史→恢复→成员旧版本与搜索重新可读 | record-lifecycle.spec.ts |

数量、实际运行结果与首轮失败修复记录以 [F-21 交审说明](f21-local-handoff.md) 为准；未执行全仓静态检查、额外全量构建或本批 GitHub CI。

F-21父审核增量：RecordLifecycleButton新增409→刷新500→关闭重开→再次网络失败→刷新成功→显式确认新版本/Key回归，先红后绿，单文件4/4（3.04秒）；独立needsRefresh只有成功加载才解除，失败/关窗不能启用旧提交。父协调独立真库22/22、契约四文件42/42，数据库已再次核对目录后停库。详见F21交审增量，未重复数据库/E2E/构建。

F-21 组件侧修复增量（2026-09-11，issue #94）：RecordLifecycleButton 的确认按钮此前由 busy 驱动 antd loading，`useDelayState` 复位窗口内 `ant-btn-loading` 类仍保留（按钮此时已 enabled），而 antd `handleClick` 以 `innerLoading` 提前 return 静默吞掉点击；同一窗口内 loading 图标还把可访问名拼成「loading 确认作废记录」。修复：确认按钮显式设置固定 aria-label（记录动作名），可访问名不再随 loading 漂移；测试新增确定性回归 keeps the confirm accessible name stable while a reload is pending（手动挂起 reload Promise），修复前确定性红灯（TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "确认作废记录"），并把 8 处确认点击统一经 clickConfirm 等待 loading 类消失后再点击。证据：单文件 5/5 连续 30 次运行 0 失败；反事实（临时换回 HEAD 组件）确定性红灯后还原；`pnpm --filter @inpulse/web test:unit` 58 文件 248 例，`pnpm typecheck`（6 项目）、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`（193 模块 870 依赖）、`pnpm check:docs`（70 个 Markdown）与 `pnpm check:secrets`（844 文件）通过。未放宽断言、未 skip；未运行 `pnpm test:e2e` 与集成/数据库测试（无后端与行为变化，E2E 由 CI 覆盖）。

## F-22 当前 GitHub 关联（2026-09-10 本地实施）

| 验收范围 | 自动化与实际结果 |
| --- | --- |
| 四目标CRUD/真实归属/If-Match/重复与幂等/跨项目/会话与成员/URL安全/Release OTHER映射 | external-links.integration.test.ts 共33条中的对应场景；全部通过 |
| 真实父级归档锁等待、4类目标异Key并发、添加/解除各3种副作用回滚 | 同一真库文件；未用Mock Repository替代锁/约束/事务 |
| 原始来源任务merge关联保留、正式不可变版本/遗留快照不变、VOID普通成员404/管理员只读/恢复和后续修订链接搜索 | 同一真库文件；与F21/F18相邻回归合计71/71 |
| 正文+URL容量、添加/后续修订安全422/整体回滚/解除释放容量 | 同一真库文件；超限红测曾返回500，修复后校验具体错误code |
| 前端未知失败同Key、409刷新失败与关闭重开不绕过、相邻五页面 | ExternalLinksPanel等5文件27/27 |
| 真实UI四类目标、多链接、Release/重复/危险host、刷新/解除、新窗口属性、草稿到发布/修订/旧版本/搜索 | external-links.spec.ts Edge最终2/2（23.2秒） |

URL/搜索模块单元17/17，契约三文件39/39；89路由/89权限/5生成物漂移通过，48个变更源码Prettier API check与局部类型通过。此前SEC-004条目的“外部链接HTTP未交付”属于旧阶段记录，本补充提供本批实际交付证据。未运行本批GitHub CI、全仓静态、全量测试或额外全量构建；详细失败历史/命令/端口见 [F-22 交审说明](f22-local-handoff.md)。

### F-22 父审核增量（2026-09-10 18:36）

新增GET/ADD_REPLAY/REMOVE_REPLAY三条真实PG父锁等待→F21作废提交竞态，修复前均200泄露、修复后普通成员404且无缓存/链接字段，管理员只读。四类CRUD另断言实际审计action等于Registry。最终增量F22真库36/36、契约2/2、局部类型/9个源码格式/89路由/5生成物漂移通过；其他测试本轮未重复。

初次冻结前误删仍在使用的fixture import，导致本轮最初beforeAll ReferenceError；已恢复后完成上述最终验证。原71/71在误删前执行，不能当作旧冻结SHA测试可运行的证据；更正与全部红测见[F22交审增量](f22-local-handoff.md)。

## F-32 任务中心 / F-29 项目概览前端骨架（C，2026-09-10 本地骨架，PR #92）

按 [C 域聚合读契约与端口提案](c-port-extension-proposal.md) §7.5：F-25/F-29/F-32 路由尚未由 A 冻结，不登记 Route Registry、不新增契约草案；两张页面先用注入式 mock adapter 隔离数据源，项目名/状态/成员数走 A 已有项目端口。F-32 页面 `/tasks`（改为登录保护）承载统计卡片、视图标签、高级筛选面板与任务明细表；F-29 页面 `/projects/:projectId/overview` 承载项目详情头部、6 项指标条、最近迭代与待处理遗留问题面板。2026-09-10 按设计师最新稿做截图对比迁移：项目概览头部改为纵向结构（返回、标题块、操作行）且操作行左对齐下移，指标条改 4 列网格（第 2 行 2 格后留灰底空位）；任务卡片顶部徽章改为「模块级 / 主任务或来源任务 / 工作状态」，页脚左侧为优先级全称徽章、右侧仅在有已发布记录时显示记录数，并移除未冻结路由的禁用「任务详情」占位。

| 验收点 | 实际证据 |
| --- | --- |
| F-32 URL 筛选状态：scope/project/status/priority/level/relation/record/github/canceled/q/view/more 的默认值省略、非法值回退、非管理员降级 mine、project 仅在 scope=project 时写入、查询词去空白 | `my-tasks-url.test.ts` 9 例 |
| F-32 mock 适配器口径：默认视图排除已完成与已取消、created 按创建者、project 按项目、全部范围跨项目、优先级/层级/关系/记录/GitHub 过滤、关键词跨编号与归属匹配、统计卡片与遗留问题事实 | `my-tasks-mock.test.ts` 10 例 |
| F-32 页面渲染与交互：骨架提示、统计卡片、scope 标签、项目名从项目端口解析、高级范围仅管理员、筛选变更回调、遗留问题入口与风险条、适配器错误态、卡片徽章（模块级 / 主任务）与页脚优先级全称、有已发布记录时才显示记录数 | `TaskCenterPageView.test.tsx` 10 例 |
| F-32 页面层：URL 读取筛选、筛选写回 URL、more 参数控制高级面板、跳转遗留问题、非管理员降级与管理员保留 | `pages/tasks/TasksPage.test.tsx` 6 例 |
| F-29 指标与数据源：6 项指标条（活跃模块/活跃功能/未完成任务/迭代记录/遗留问题来自 adapter，成员数来自项目端口 memberCount）、mock 指标口径、迭代按发布时间倒序、项目 id 在契约冻结前不参与过滤 | `ProjectOverviewPageView.test.tsx`、`project-overview-mock.test.ts` 3 例 |
| F-29 交互与容错：最近迭代行与「查看全部」进入记录页、遗留问题行与「进入遗留问题」进入问题页、空态、adapter 错误态、项目错误重试 | `ProjectOverviewPageView.test.tsx` 7 例 |
| F-29 页面层：按路由 projectId 读取项目与概览、非法 projectId 错误态、遗留问题跳转、返回项目列表 | `ProjectOverviewPage.test.tsx` 4 例 |

本地实际执行：`pnpm --filter @inpulse/web exec vitest run src/features/project-overview src/pages/project-overview` 3 文件 14/14；`pnpm --filter @inpulse/web test:unit` 48 文件 195/195；`pnpm --filter @inpulse/web typecheck`、`pnpm --filter @inpulse/web build`、变更目录 ESLint 与 `pnpm check:frontend:boundaries`（167 模块）通过；2026-09-10 截图对比迁移后重跑定向 `src/features/my-tasks src/features/project-overview src/pages/tasks` 6 文件 45/45、`pnpm lint` 与 `pnpm format:check` 通过。rebase 到 `origin/main` `5087f0a` 后重跑上述门禁：`pnpm --filter @inpulse/web test:unit` 49 文件 199/199（含主线 F-21 新增用例）、`pnpm check:frontend:boundaries`（169 模块 753 依赖）、`pnpm check:docs`（68 个 Markdown）、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`（6 项目）与 `pnpm --filter @inpulse/web build` 通过。未运行 API/集成/数据库测试（无后端改动）、`pnpm test:e2e`（骨架路由尚无 E2E）与 GitHub Actions。骨架数据不代表已实现能力；F-32 补充字段（priority/dueAt/completedAt/description/creatorId）与 F-29 统计口径等待 A 对 C 域提案的裁定。


## C 域聚合读 R-1 ~ R-4 契约、后端与 F-29 / F-32 接线（C，2026-09-11 本地落库，PR #97）

按 [F-25 / F-29 / F-32 契约评审裁决](a-contract-review-f25-f29-f32.md) 与 [C 域聚合读契约与端口提案](c-port-extension-proposal.md)：R-1 `getTaskGroup`（GET `/api/v1/task-groups/{groupId}`）、R-2 `getProjectOverview`（GET `/api/v1/projects/{projectId}/overview`）、R-3 `listMyTasks`（GET `/api/v1/me/tasks`）、R-4 `listTaskGroupRecords`（GET `/api/v1/task-groups/{groupId}/records`）四条路由连同 Schema、Route Registry 全策略登记、权限矩阵、OpenAPI、生成客户端与实现同一 PR 落库。上方 F-32 / F-29 骨架条目中「路由尚未冻结、mock adapter 隔离数据源」的描述由本条目取代；该条目内的 URL 筛选状态、卡片渲染与截图对比迁移验收点仍然有效。接线顺序按裁决 §7：B 侧只读端口扩展已由 C 代 B 落库（PR #96），A 冻结的 R-1 ~ R-4 契约、后端与前端 server adapter 随本 PR 落地。

| 验收点 | 实际证据 |
| --- | --- |
| 契约与登记：四条路由全 `authPolicy: session`，csrf / 幂等 / 版本 / 并发等策略逐条显式 `none`；非成员或不存在统一 404 不返回 403；错误码 404 `TASK_GROUP_NOT_FOUND` / `PROJECT_NOT_FOUND`，422 `INVALID_CURSOR` 与契约校验失败，500 `AGGREGATE_READ_INCONSISTENT` / `INTERNAL_ERROR`，401 `TASK_GROUP_UNAUTHENTICATED` / `PROJECT_OVERVIEW_UNAUTHENTICATED` / `MY_TASKS_UNAUTHENTICATED` | `packages/api-contract/test/permissions.test.ts` 路由扫描；`pnpm contract:drift`（5 生成物一致）、`pnpm contract:validate`（93 路由）、`pnpm permissions:check`（93 操作 / 93 路由） |
| 签名游标：绑定 actor / 命名空间 / 筛选哈希，拒绝篡改签名、过期、跨用户与跨筛选复用、畸形载荷与缺失 keyring 版本，签发拒绝非正整数 afterId | `aggregate-read-cursor.test.ts` 6 例 |
| 查询服务：R-1 组与成员（主任务优先排序、已解除成员、记录数按记录不按版本）、R-4 组内成员任务过滤与游标绑定、R-2 统计与列表条数收口、R-3 四项筛选与 filterKey、越权收敛 404 或空页、数据缺失映射 500 而非静默丢行 | `aggregate-read.service.test.ts` 14 例 |
| 真实 PostgreSQL 集成：匿名 401，非成员 / 跨项目成员 / 不存在 404，记录可见性只含 PUBLISHED 与 VOID（DRAFT 不出现），游标翻页不重不丢，R-2 条数越界 422，R-3 只返回本人负责任务并标注组角色，无效路径参数 422 | `aggregate-read-api.integration.test.ts` 12 例 |
| 端口扩展（随 PR #96）：模块 / 功能计数不跨项目，任务过滤与计数一致，分页不重不丢，excludedTaskIds 预过滤，空授权范围短路，记录与遗留项可见性，四种查询形状命中索引不回退 Seq Scan | `aggregate-read-ports.integration.test.ts` 16 例 |
| F-29 接线：页面默认注入 server adapter（经生成客户端调用 R-2，默认 `recentRecordLimit` 3 / `activeLeftoverLimit` 2）；契约缺口（遗留问题总数、来源记录标题）映射为 `null` 并由显示层显式降级「—」/ 记录编号 | `project-overview-server.test.ts` 2 例、`project-overview-v1.test.ts`、`ProjectOverviewPageView.test.tsx`、`ProjectOverviewPage.test.tsx` |
| F-32 接线：页面默认注入 server adapter（经生成客户端调用 R-3，默认 `limit` 20 与 `workStatus=TODO`）；统计、范围计数、遗留问题入口无契约来源时显式 `null`；`MY_TASKS_V1_FILTER_SUPPORT` 8 项全 false，UI 标注「后续迭代」而非静默忽略 | `my-tasks-server.test.ts` 3 例、`my-tasks-v1-query.test.ts`、`my-tasks-mock.test.ts`、`TaskCenterPageView.test.tsx`、`TasksPage.test.tsx` |

本地实际执行（2026-09-11）：聚合读四文件定向 `aggregate-read-cursor` / `aggregate-read.service` / `aggregate-read-ports` / `aggregate-read-api.integration` 48/48（6 + 14 + 16 + 12）；`pnpm test:unit` 全绿（web 54 文件 224 例、api 66 文件 339 例、contract 15 文件 89 例、database 1 文件 15 例）；`pnpm test:integration`（本地 PostgreSQL 18.6 + PGroonga 容器）database 20/20、api 47 文件 400/400；`pnpm test:e2e` 40/40（约 5.1 分钟）；`pnpm lint`、`pnpm typecheck`（6 项目）、`pnpm format:check`、`pnpm build`、`pnpm check:deps`（564 源文件无环无越界）、`pnpm check:frontend:boundaries`（179 模块 792 依赖）、`pnpm check:docs`（70 个 Markdown）、`pnpm check:secrets`（828 文件）、`pnpm check:deploy:test`、`pnpm db:migrations:check`（6 迁移）通过；`pnpm audit --registry=https://registry.npmjs.org --audit-level=high` 无已知漏洞（本地 npm 镜像无 audit endpoint）。未运行：F-29 / F-32 专属 Playwright 用例（裁决 §7 之 C 侧补测，尚未落库）、`pnpm test:search:db` 与 `pnpm test`（要求 `max_connections >= 150`，未纳入 CI）。推送后 GitHub Actions 已通过：`CI` push run [34504191298](https://github.com/256-code/InPulse/actions/runs/34504191298) 13m43s、`CI` pull_request run [34504227163](https://github.com/256-code/InPulse/actions/runs/34504227163) 13m7s、`Documentation` run [34504227104](https://github.com/256-code/InPulse/actions/runs/34504227104) 12s；其后仅本回填提交。

已知风险与限制：① 一次全量集成运行曾出现 20 个失败（task-completion / tasks-api），逐文件复跑（task-completion 30/30、tasks-api 3 次各 41/41）与全量重跑 400/400 均通过，未复现、未定位根因，不能视为已修复；② 本地 `app` 库因项目编号序列耗尽重建后重新加载角色 / 扩展并重放全部迁移，本地测试基线重置，不代表生产数据；③ 代 B 交付的处方偏差（my-tasks 查询端口宿主在记录侧）仍待非作者人工在 PR #96 确认；④ 遗留问题总数、来源记录标题、任务卡片优先级 / 截止时间等设计稿元素在 V1 契约无来源，保持显式降级。

## F-29 / F-32 专属 Playwright E2E（C，2026-09-11 本地落库，PR #98）

上一条目「未运行：F-29 / F-32 专属 Playwright 用例（裁决 §7 之 C 侧补测）」由本节补齐：新增 `apps/e2e/tests/aggregate-views.spec.ts` 两例，把 F-29 / F-32 页面在服务端适配器下的关键路径与契约缺口显式降级纳入 Playwright 回归。

| 验收点 | 实际证据 |
| --- | --- |
| F-32 关键路径：在 fixture 项目经真实 UI 创建功能并把任务指派给当前用户后，`/tasks` 默认「我负责的 + 未完成」返回该任务（卡片含负责人、不显示无契约来源的优先级徽章）；服务端说明含「接口说明：」与 `GET /api/v1/me/tasks`；统计卡 `stat-my-open` 为「—」；搜索任务 / 优先级 / 「我创建的」按契约缺口禁用；F-30 URL 状态 `status=done`、`view=list`、`more=1` 写回地址栏；「遗留问题」入口跳转 `/issues` | `apps/e2e/tests/aggregate-views.spec.ts` 例 1；定向 `playwright test aggregate-views` 2/2；全量 `pnpm test:e2e` 42/42 |
| F-29 关键路径：`/projects/{projectId}/overview` 标题为服务端项目名、活跃模块数与成员数为服务端真实值、遗留问题总数为「—」、最近迭代与待处理遗留问题面板及空态；「查看全部」→ `/records?view=published&projectId=`、「查看模块」→ 模块页、「全部项目」→ `/projects` | `apps/e2e/tests/aggregate-views.spec.ts` 例 2；同上 |
| fixture 扩展：`global-setup` 把 fixture 项目名以 `projectName` 写入 runtime（既有字段未变），供概览标题断言使用 | `apps/e2e/helpers/runtime.ts`、`apps/e2e/global-setup.ts` |

本地实际执行（2026-09-11）：`pnpm --filter @inpulse/e2e typecheck` 通过；定向 `pnpm --filter @inpulse/e2e exec playwright test aggregate-views` 2/2；全量 `pnpm test:e2e` 42/42（约 5.3 分钟）。推送后 GitHub Actions 已通过：`CI` push run [34508897744](https://github.com/256-code/InPulse/actions/runs/34508897744) 13m19s、`CI` pull_request run [34508916381](https://github.com/256-code/InPulse/actions/runs/34508916381) 13m43s、`Documentation` run [34508916277](https://github.com/256-code/InPulse/actions/runs/34508916277) 9s。

## F-23 / F-24 / F-25 前端交付（C，2026-09-11 本地落库）

F-23 合并到主任务 / F-24 解除合并 / F-25 聚合组详情页的前端纵切片落库：功能页任务抽屉新增「合并到主任务」入口（搜索同项目任务、排除自身、≥2 字符、350ms 防抖、来源分支类型单选、合并说明 ≤5000 字），成功后跳转 `/task-groups/{groupId}`；新增聚合组详情页（成员角色徽章、记录筛选 URL 状态、签名游标加载更多、外部链接快照与显式降级）；来源分支「解除合并」二次确认与组关闭警告。

| 验收点 | 实际证据 |
| --- | --- |
| F-23 前端：合并弹窗（搜索候选过滤、防抖、必选主任务、409 后重新搜索、提交携带 CSRF 与幂等键） | `MergeIntoMainTaskModal.test.tsx` 5 例；`TasksPanel.test.tsx` 合并入口 1 例 |
| F-25 前端：聚合组详情（成员排序与徽章、DETACHED/HISTORICAL 展示、记录筛选回调、非法 URL 回退、VOID 快照与游标、CLOSED 警告与空态） | `TaskGroupPageView.test.tsx` 8 例 |
| F-24 前端：解除合并（二次确认、原因 trim 空转 null、409 保留输入并可重新加载、422 文案、closesGroup 警告、成功失效相关查询） | `UnmergeTaskGroupButton.test.tsx` 5 例 |
| F-23/F-24/F-25 关键路径 E2E | `apps/e2e/tests/task-groups.spec.ts`：建功能与两个任务 → 来源任务抽屉合并 → 落聚合组页（主任务/来源分支/空态/接口说明）→ 记录筛选写入 URL → 解除合并（组关闭警告）→ 「已解除」与组关闭提示；全量 `pnpm test:e2e` 43/43 |
| E2E 稳定性修复 | `aggregate-views.spec.ts` F-29 指标断言改为 `expect.poll`（消除读取初始占位 0 的竞态）；`task-groups.spec.ts` 创建任务后关闭自动打开的详情抽屉，避免遮罩阻塞后续点击 |

本地实际执行（2026-09-11）：Web 单测 58 文件 247 例；`@inpulse/e2e` typecheck；全量 `pnpm test:e2e` 43/43（约 5.4 分钟）；`pnpm check` 除本地镜像 audit endpoint 外全部通过，公共 registry 审计无已知漏洞。E2E 首轮曾出现 1 例 `leftover-task` FEATURE `POST .../leftover-task` 500，未复现（单文件复跑 3/3），不能视为已修复。

## F-25 / F-29 / F-32 第二轮裁决：R-2 / R-3 Schema 扩展 + R-5 `listTaskGroupMemberships`（A，2026-09-11 本地落库，PR #102）

按 [A 的契约评审裁决](a-contract-review-f25-f29-f32.md) §10：R-2 `getProjectOverview` 增加 `activeLeftoverTotal` 与 `LeftoverItemSummary.recordTitle`；R-3 `listMyTasks` 列表项增加 `priority` / `dueAt` / `completedAt` / `creatorId` / `githubLinkCount` / `groupId`，响应增加 `stats` / `leftoverCount` / `leftoverSample`，筛选增加 `priority` / `includeCanceled`；新增 R-5 `GET /api/v1/task-groups/memberships`（`listTaskGroupMemberships`）。契约、Route Registry、权限矩阵、测试矩阵、OpenAPI、生成客户端与服务端实现同一 PR 落库；`description`、`scopeCounts`、`relation`、`query`、`scope=created|all` 按裁决保持拒绝与延后。

| 验收点 | 实际证据 |
| --- | --- |
| 契约登记与生成物：94 条路由全策略完整、5 个生成物与 Registry 一致、权限矩阵 94 操作与路由全覆盖 | `pnpm contract:validate`（94 条全部通过）、`pnpm contract:drift`（5 个产物一致）、`pnpm permissions:check`（94 条操作 / 94 条路由） |
| R-2 扩展：`activeLeftoverTotal` 与 `activeLeftovers` 同一过滤且不受 `activeLeftoverLimit` 影响；遗留行 `recordTitle` 为来源记录当前标题 | `aggregate-read-api.integration.test.ts`（真实 PostgreSQL，聚合读 19/19） |
| R-3 扩展：`priority` / `includeCanceled` 筛选、6 个新条目字段、`stats`（Asia/Shanghai 日/月界）/ `leftoverCount` / `leftoverSample`（200 字符截断追加 “…”） | `aggregate-read.service.test.ts` 18/18、`aggregate-read-api.integration.test.ts`（真实 PostgreSQL） |
| R-5：`taskIds` 逗号分隔 1..100 正整数（数量 / 格式 / 重复 422）、只返回授权项目内 `ACTIVE` 组关系、无权不入结果且不泄露存在性、匿名 401 | `aggregate-read-api.integration.test.ts` 3 例；权限矩阵扫描 `permissions.test.ts` 89/89 |
| R-5 路由顺序：`/task-groups/memberships` 不被 `/task-groups/{groupId}` 吞掉 | `aggregate-read-api.integration.test.ts` 实际断言（Controller 注册顺序） |
| `priority` / `includeCanceled` 的 `EXPLAIN (ANALYZE, BUFFERS)`（裁决 §10.3 验收要求）：30,481 行真实结构 `app.tasks` 下两条查询均走反向主键索引扫描，非顺序扫描 | 见下方计划文本 |

`EXPLAIN (ANALYZE, BUFFERS)` 关键输出（本地 PostgreSQL 18.6，`app.tasks` 30,481 行，含 `tasks_assignee_status_idx (assignee_id, work_status, id)` 与 `tasks_pkey`）：

- `priority = 'HIGH'` + 有效任务过滤 + `ORDER BY id DESC LIMIT 21`：`Index Scan Backward using tasks_pkey`，Rows Removed by Filter: 111，Buffers shared hit: 40，Execution Time: 0.149 ms。
- `work_status = ANY('{TODO,CANCELED}')`（`includeCanceled` 组合）+ 有效任务过滤 + `ORDER BY id DESC LIMIT 21`：`Index Scan Backward using tasks_pkey`，Rows Removed by Filter: 51，Buffers shared hit: 34，Execution Time: 0.058 ms。

两条均未退化为顺序扫描，现有索引可支撑，无需新索引（补索引属迁移，按裁决 §10.6 另行人工评审）。

本地实际执行（2026-09-11）：`pnpm contract:validate`、`pnpm contract:drift`、`pnpm permissions:check`、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`（6 项目）、API `test:unit` 66 文件 343 例、API `test:integration` 47 文件 407 例（真实 PostgreSQL）、`pnpm --filter @inpulse/web test` 58 文件 248 例、`pnpm db:test` 2 文件 20 例、`pnpm db:migrations:check`（6 个迁移）、`pnpm check:secrets`（855 文件）、`pnpm check:docs`（72 个 Markdown）、`pnpm check:deploy:test`、`pnpm check:deps`（579 文件）与 `pnpm check:frontend:boundaries` 通过；公共 registry `pnpm audit --registry=https://registry.npmjs.org --audit-level=high` 返回无已知漏洞。未运行：`pnpm test:e2e`（本轮未改 UI 页面行为）、`pnpm test:search:db` / `pnpm test`（要求 `max_connections >= 150`，按既定决定未纳入 CI）、GitHub Actions。前端适配器对新增字段的接线与降级项清零属 C 域交付（裁决 §10.5）；本轮仅把 C 侧测试夹具补到类型所需字段，未改适配器行为。

## F-29 / F-32 第二轮字段接线与降级清零（C，2026-09-11 本地落库，工作书 C-2）

按 [A 的契约评审裁决](a-contract-review-f25-f29-f32.md) §10 与工作书 C-2：F-32 任务中心与 F-29 项目概览的 server adapter 全量接线第二轮契约扩展并清零降级。`my-tasks-server.ts` 透传 `stats` / `leftoverCount` / `leftoverSample`（`scopeCounts` 为 §10.3 延后项保持 null）；`MY_TASKS_V1_FILTER_SUPPORT` 翻 `filter:priority` 与 `filter:canceled-with-open` 为 true；`toMyTasksV1Query` 增加 `priority` / `includeCanceled`；`fromV1MyTaskItem` 映射 `priority` / `dueAt` / `completedAt` / `creatorId` / `githubLinkCount` / `groupId`；`project-overview-v1.ts` 取 `activeLeftoverTotal` 与 `leftover.recordTitle`，`PROJECT_OVERVIEW_V1_MISSING_*` 清空为入口常量。视图移除统计「—」、优先级 / 截止缺失分支与遗留指标降级；`my-tasks-types.ts` 与 `project-overview-types.ts` 的 null 语义收紧为契约定义并同步注释。

| 验收点 | 实际证据 |
| --- | --- |
| R-3 映射：`priority` 单值与 `includeCanceled`（`status=open` 叠加）进入查询；6 个新条目字段无损映射（`dueAt` / `completedAt` / `groupId` 保留 null）；默认查询不变 | `my-tasks-v1-query.test.ts` 14 例（含新增 priority / includeCanceled 映射与 `fromV1MyTaskItem` 全字段断言） |
| R-3 适配器：`stats` / `leftoverCount` / `leftoverSample` 透传、`scopeCounts` 保持 null、`filterSupport` 两项为 true、notice 更新为「服务端实时数据」 | `my-tasks-server.test.ts` 5 例 |
| R-2 映射与适配器：`openLeftovers = activeLeftoverTotal`、`recordTitle` 直取、缺口常量为空、notice 不含「契约未提供」 | `project-overview-v1.test.ts`、`project-overview-server.test.ts` |
| 视图降级移除：任务卡 / 表格始终渲染优先级徽章与截止文案；统计卡渲染服务端数字；遗留指标与遗留行渲染服务端数据（含 `recordTitle`） | `TaskCenterPageView.test.tsx`、`ProjectOverviewPageView.test.tsx`、`my-tasks-mock.test.ts` 等 |
| 关键路径 E2E 翻转：统计卡为数字（轮询）、优先级筛选启用并写 URL（`priority=HIGH` → 清除）、任务卡含「普通优先级」与「未设置截止」、「显示已取消任务」开关启用、关键词搜索与「我创建的」保持禁用；F-29 遗留指标为数字、notice 含「待处理遗留问题总数」与「服务端实时数据」且不含「契约未提供」 | `apps/e2e/tests/aggregate-views.spec.ts` 两例；全量 `pnpm test:e2e` 45/45 |

本地实际执行（2026-09-11）：`pnpm --filter @inpulse/web test` 64 文件 293 例；`pnpm test:unit`（database 15、api-contract 89、canonical-json 5、web 293、api 346、ops 36）；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`（8 个 workspace 项目）、`pnpm build`、`pnpm contract:validate`（97 条路由）、`pnpm contract:drift`（5 个产物）、`pnpm permissions:check`（97 条操作 / 97 条路由）、`pnpm db:migrations:check`（7 个迁移）、`pnpm check:deps`（625 文件无环无越界）、`pnpm check:frontend:boundaries`（207 模块 946 依赖）、`pnpm check:deploy:test`、`pnpm check:secrets`（918 文件）、`pnpm check:docs` 通过；公共 registry `pnpm audit --registry=https://registry.npmjs.org --audit-level=high` 无已知漏洞。全量 `pnpm test:e2e` 45/45（约 6.1 分钟；同期并行线程的 `project-archive.spec.ts` 当时尚未完成、未计入本次 45/45，该文件已随 C-6 交付，见 F-06 段 `F06-ARCHIVE-E2E-001`）。

排障记录：本地 `app` 库缺 `0006_leftover_search_entity.sql`（PR #104 引入）导致所有带遗留内容的记录发布返回 500 `INTERNAL_ERROR`（`search_projection_entity_type_check` 不含 `LEFTOVER`）；以 `MIGRATION_DATABASE_URL=postgresql://cluster_bootstrap@127.0.0.1:55432/app` 执行 `pnpm db:migrate` 应用 0006 后，原先稳定失败的 9 例复跑 10/10 通过。该问题是本地环境迁移滞后，与 C-2 改动无关（CI 一次性建库执行全部迁移）。未运行：GitHub Actions（本批尚未推送 / 开 PR）、`pnpm test:integration` 与 `pnpm test:search:db`（无后端与搜索改动；后者另要求 `max_connections >= 150`，按既定决定未纳入 CI）、`pnpm db:test` / `pnpm test`（同上）。新增 / 更新的 E2E 断言需非作者人工评审。

## F-08 原始审计读取留痕（A，2026-09-11 本地落库）

`GET /api/v1/audit-logs`（`getAuditLogs`）交付 F-08 步骤 4：原始审计读取必须留痕。完整管理员 Session 且密码与当前 TOTP 双时间戳重认证均在 5 分钟内（GET 只读路径不强制同步 CSRF、不使用幂等键）；不传 `projectId` 读 SYSTEM 链、传则读 `PROJECT:<id>` 链。查询经独立只读 `audit_reader` 连接（`AUDIT_DB_USER` 默认 `audit_reader`、`AUDIT_DATABASE_URL(_FILE)`，与业务连接分离，惰性建池、配置缺失或越界在首次读取 fail closed）。同一请求内先用业务连接向 SYSTEM 链追加 `AUDIT_LOG_READ` 留痕（含 filters/returnedCount/hasMore 与请求元数据，不含审计正文），留痕写失败则不返回读取结果。`cursor` 为服务端 HMAC 签名、绑定操作者与查询指纹（含链、过滤器与 limit）、TTL 15 分钟；`limit` 默认 50、最大 100；`from`/`to` 为半开区间 `[from, to)` 且必须带时区。远端 WORM 归档与每日加密明细导出（F-08 步骤 6）已由 A2 交付，见本节末尾的「F-08 审计远端归档」。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F08-READ-API-001 | HTTP + PostgreSQL | 管理员读取 SYSTEM 链并留痕 | 重认证管理员返回 `AuditLogPage`（SYSTEM 链、64 位十六进制 `prevHash`/`recordHash`、ISO 时间）；同一请求后在 SYSTEM 链恰有一条 `AUDIT_LOG_READ`，`targetId=SYSTEM`，payload 含 `returnedCount`/`hasMore` 与 filters，不含审计正文 | 本地通过（`apps/api/test/audit-logs.integration.test.ts` 7/7，2026-09-11） |
| F08-READ-API-002 | HTTP + PostgreSQL | 身份与重认证门禁 | 匿名 401 `ADMIN_SESSION_REQUIRED`；普通成员 403 `ADMIN_REQUIRED` 且响应体不含任何审计内容；完整管理员未做 5 分钟内双因子重认证时 403 `ADMIN_REAUTH_REQUIRED` | 同上 |
| F08-READ-API-003 | HTTP + PostgreSQL | action 过滤与签名游标分页 | `action` 精确过滤 + `limit` 分页不重叠、无遗漏；游标跨查询（不同 action 或不同链）返回 422 `VALIDATION_FAILED`；非法游标、`from > to`、`limit=0` 均 422 | 同上 |
| F08-READ-API-004 | HTTP + PostgreSQL | 项目链隔离 | `projectId` 查询返回 `PROJECT:<id>` 链数据且不跨链（SYSTEM 链条目不出现在结果） | 同上 |

本地实际执行（2026-09-11）：API `test:unit` 66 文件 343 例、API `test:integration` 48 文件 415 例；`pnpm lint`、`format:check`、`typecheck`（6 项目）、`contract:drift`（5 生成物一致）、`contract:validate`（95 条路由）、`permissions:check`（95/95）、`check:deps`、`check:frontend:boundaries`、`check:secrets`、`check:deploy:test`、`db:migrations:check` 与公共 registry 高等级审计（无已知漏洞）均通过；GitHub Actions 尚未执行。

## F-08 审计远端归档（A，2026-09-11 本地落库）

`apps/ops` 交付 F-08 步骤 6：每小时把链头（`chain_id`/`last_sequence`/`last_hash`/`key_version`/`headUpdatedAt`）的签名检查点写入 WORM；每日导出前一 UTC 自然日的加密审计明细（AES-256-GCM，子密钥由归档签名密钥经 HKDF-SHA256 派生）与 HMAC-SHA256 签名清单。归档进程使用 `audit_archive_writer`（只读 `app.audit_logs` 与 `app.audit_chain_heads`），不挂载在线审计 HMAC；WORM PUT 携带对象锁（COMPLIANCE + 保留天数），409/412 按「对象已存在」幂等处理，不覆盖、不删除。宿主调度由 `deploy/backup/audit-archivectl.sh`（`flock` 并发锁、`--confirm-go-live` 门禁）与两个 timer 承担（每小时检查点、每日 UTC 00:20 导出），静态校验并入 `pnpm check:deploy:test`；操作步骤见[审计归档 Runbook](./runbooks/audit-archive.md)。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F08-ARCHIVE-UNIT-001 | 单元 | 检查点构造/编码/验签 | envelope 为 JCS 规范化 JSON + 末尾换行；篡改 payload 或未知签名密钥版本验签失败 | 本地通过（`checkpoint.test.ts` 3 例，2026-09-11） |
| F08-ARCHIVE-UNIT-002 | 单元 | 导出包加密、密钥派生与清单 | 加解密往返一致；明文哈希不符、密文截断、未知密钥版本抛错；空窗口导出可解密为空包 | 本地通过（`export.test.ts`、`crypto.test.ts`，2026-09-11） |
| F08-ARCHIVE-UNIT-003 | 单元 | SigV4 与 WORM 客户端 | AWS 官方向量 `get-vanilla` 通过；对象锁头、path/virtual-host URL、409/412 幂等、5xx 指数退避、4xx 不重试、GET 404 抛错 | 本地通过（`sigv4.test.ts`、`worm.test.ts`，2026-09-11） |
| F08-ARCHIVE-INT-001 | PostgreSQL + WORM 桩 | 检查点等于真实链头 | 以 `audit_archive_writer` 读取真实链头，检查点验签通过且 payload 与链头逐字段一致；PUT 带 `x-amz-object-lock-mode` | 本地通过（`audit-archive.integration.test.ts` 4/4，真实 PostgreSQL 18.6，2026-09-11） |
| F08-ARCHIVE-INT-002 | PostgreSQL + WORM 桩 | 明细导出与清单绑定 | 窗口 `rowCount` 与数据库 count 一致；解密后可定位种子行（`prevHash`/`recordHash`/`keyVersion`/`canonicalVersion`）；清单验签且 `ciphertextSha256` 与密文绑定 | 同上 |
| F08-ARCHIVE-INT-003 | PostgreSQL | 归档角色最小权限 | `audit_archive_writer` 可读 `app.audit_logs` 与 `app.audit_chain_heads`；INSERT/UPDATE/DELETE 与 `SET ROLE app_owner` 均 42501 | 同上 |
| DEPLOY-005 | 上线前（静态门禁） | 审计归档调度与 Runbook | `deploy/backup/` 交付 `audit-archivectl.sh`、两个 service/timer 与 `audit-archive.env.example`，`docs/runbooks/audit-archive.md` 交付操作步骤；`pnpm check:deploy:test` 校验 `--profile operations run --rm audit-archive`、`flock`、`--confirm-go-live`、每小时检查点与每日 00:20 导出节奏、`TimeoutStartSec`、`OnFailure` 告警与敏感键 `*_FILE` 化 | 本地通过（`pnpm check:deploy:test` 退出码 0，2026-09-11；真实 systemd 安装与真实 WORM 投递未运行） |

本地实际执行（2026-09-11）：`pnpm --filter @inpulse/ops test:unit` 7 文件 36 例、`pnpm --filter @inpulse/ops test:integration` 4/4（真实 PostgreSQL 18.6）；`pnpm check:deploy:test`（5 image refs）与 `pnpm check:deps`（604 源文件）通过。未运行：真实 S3/Object-Lock 端点联调、真实 systemd 安装、GitHub Actions（推送后由 CI 执行）。

## F-20 遗留问题页与任务中心聚合组区块（C，2026-09-11 本地落库）

按人工指令补齐两处缺口：`/issues` 由 `WorkspacePlaceholder` 改为按 `latest-version/views/issues.tsx` 实现的遗留问题页；任务中心按 `latest-version/views/task-center.tsx` 补上「任务聚合组」区块（组卡、分支行徽章、页脚「查看主任务」）。两条页面都需要「列遗留项 / 列聚合组」的服务端读能力，既有契约只有 `getTaskGroup`（按 groupId）与 `listTaskGroupRecords`，因此本 PR 新增两条只读路由 `GET /api/v1/leftover-items`（`listLeftoverItems`）与 `GET /api/v1/task-groups`（`listTaskGroups`），Schema、Route Registry、权限矩阵、OpenAPI 与生成客户端随实现同一个 PR 落库。

| 验收点 | 实际证据 |
| --- | --- |
| 遗留问题列表读路由：`bucket` 只切换 OPEN（ACTIVE）与 CLOSED（CONVERTED / RESOLVED）展示分桶、固定 `leftoverItemId DESC`、`limit` 1～100 默认 20、`projectId` 只收窄授权范围、内容取最新版本快照、来源 / 跟进任务只返回任务引用；跨项目范围读按 `AuthorizedProjectScope` 过滤，非成员与不存在返回空页而不是 404（与 `listMyTasks` 同族） | `LeftoverListQueryRequest` / `LeftoverListItem` / `LeftoverItemPage`（Schema Registry + Route Registry 全策略 + 权限矩阵 + OpenAPI + 生成客户端）；`apps/api/test/leftover-items.service.test.ts` 4 例；游标命名空间 `LEFTOVER_ITEMS`、TTL 15 分钟 |
| 聚合组列表读路由：只返回 ACTIVE 成员（已解除不进入摘要）、主任务在前、来源任务按加入顺序、`groupId DESC` 签名游标、返回原始 `groupRole` / `sourceKind` / `workStatus` 枚举 | `TaskGroupListQueryRequest` / `TaskGroupListBranch` / `TaskGroupListItem` / `TaskGroupListPage`；`apps/api/test/aggregate-read.service.test.ts` 18 例（含列表分支）；游标命名空间 `TASK_GROUPS` |
| 真实 PostgreSQL + 真实 HTTP：两个新路由的鉴权、跨项目隔离、分页边界、422 校验、响应 Schema 校验与未知字段剔除、非成员空页语义 | `apps/api/test/aggregate-read-list-api.integration.test.ts` 10 例（真实 PostgreSQL 18.6 + PGroonga） |
| 遗留问题页（F-20 前端）：未闭环 / 已闭环两桶各自签名游标分页与「加载更多」、「问题不是任务」提示、行内来源记录与来源任务入口、未闭环项「转为任务」、已闭环折叠区保留「查看跟进任务」、加载与错误态 | `apps/web/src/features/issues/IssuesPageView.test.tsx` 7 例、`issues-format.test.ts` 3 例；`apps/web/src/pages/issues/IssuesPage.tsx` 接线路由、返回迭代记录与任务深链 |
| 页内「转为任务」复用已发布记录页的转换弹窗（CSRF、`If-Match`、幂等键与 409 / 422 语义一致），成功后按应用统一模式打开新建跟进任务 | `apps/web/src/features/published-records/ConvertLeftoverTask.test.tsx` 4 例；`LeftoverTaskConvertModal` 改为受控导出供遗留问题页复用，`ConvertLeftoverTask` 包装器保留原调用点行为 |
| 任务中心「任务聚合组」区块：区块标题与说明、`N 个聚合组` 徽章、组卡（编号 / 名称 / 状态 / 项目名）、分支行（主分支 / 活动来源 / 历史来源徽章、任务编号与标题、工作状态、负责人）、页脚说明与「查看主任务」、加载更多与空态 | `apps/web/src/features/my-tasks/TaskCenterPageView.test.tsx` 14 例；`apps/web/src/pages/tasks/TasksPage.test.tsx` 6 例 |
| 适配器接线：`fetchTaskGroups` 在真实服务端适配器与 mock 适配器同一形状（项目名解析、分支角色与来源类型映射、未完成分支排序） | `my-tasks-server.test.ts` 4 例、`my-tasks-mock.test.ts` 11 例 |
| 关键路径 E2E：发布带「还有什么问题」的记录 → 遗留问题页待闭环行（来源记录与来源任务）→ 页内转为任务 → 自动打开跟进任务 → 回页后该条进入已闭环折叠区并保留跟进任务入口，原记录内容不被改写 | `apps/e2e/tests/issues.spec.ts` 1 例；全量 `pnpm test:e2e` 45/45 |
| 聚合组区块 E2E：建功能与主 / 来源任务 → 合并 → 任务中心区块出现组卡、主分支与活动来源分支、「查看主任务」直达主任务详情 | `apps/e2e/tests/task-groups.spec.ts` 第 2 例扩展 |
| 与设计师稿的截图比对：遗留问题页（页头、amber 提示、未闭环行、来源任务 / 转为任务按钮、已闭环折叠区）与任务中心聚合组区块（组卡、分支行徽章与负责人、页脚「查看主任务」）逐项一致 | 本地 Playwright 截图与设计师导出页同尺寸截屏对比；唯一差异是 `page-header` 描述行——设计师最终 CSS 以 `.page-header > div > p { display: none }` 全局隐藏该行，本仓既有页面（`/tasks`、项目动态等）同样保留该行，属既有横向差异，未在本 PR 单方面改动 |

本地实际执行（2026-09-11，含合并 `origin/main` `d737035` 与编号顺延后）：`pnpm install --frozen-lockfile`、`pnpm build`、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`（含新增 `apps/ops` 与 `packages/canonical-json`）、`pnpm check:deps`（631 文件无环）、`pnpm check:frontend:boundaries`（207 模块 / 946 依赖）、`pnpm contract:validate`（97 条路由）、`pnpm contract:drift`（5 个产物）、`pnpm permissions:check`（97 条操作 / 97 条路由）、`pnpm db:migrations:check`（7 个迁移）、`pnpm check:secrets`（919 文件）、`pnpm check:docs`（75 个 Markdown）、`pnpm check:deploy:test` 全部通过；公共 registry `pnpm audit --audit-level=high` 无已知漏洞。`pnpm test:unit`：database 15、api-contract 89、canonical-json 5、web 64 文件 291 例、api 67 文件 346 例、ops 7 文件 36 例；`pnpm test:integration`（与 CI 同构的新建库，合并 #107 前）：database 26/26、apps/api 49 文件 425 例；`pnpm test:e2e`（合并 #107 前）全量三次 42/45、43/45、44/45；合并 #107 后的整树由 CI 覆盖。

未运行 / 已知偏差：① 本 PR 的 GitHub Actions 尚未执行；② 新增 E2E 用例与新增测试需非作者人工评审；③ 旧本地长跑库在整库全量集成时出现随机单文件 500，根因定位为客户端计算的过期 / 消费时间戳与 PostgreSQL `now()` 的毫秒级时钟抖动触发 `idempotency_records_retention_check` 与 `preauth_sessions_consumed_at_check` 的边界值，重复复跑不复现；换用与 CI 同构的新建库后两次全量 410/410 通过，该现象与本 PR 改动无关，但 CI 与本地时钟源差异值得后续确认；④ 旧本地库另有 `entityId` 整型溢出与项目编号序列耗尽等数据累积问题（非代码缺陷），不作为验收基线。⑤ 本机全量 `pnpm test:e2e` 三次运行各出现 1～3 个用例失败（42/45、43/45、44/45），失败集合每次不同且全部落在本批未改动的既有用例（features / task-status / leftover-task / record-publishing / search），单独重跑与差分重跑全部通过；⑥ 本机 `apps/web` 单测两次运行各出现 1 例超时抖动（防抖与弹窗用例，失败用例每次不同、单独重跑通过）。⑤⑥ 均判定为本机环境时延抖动（本机同时运行其它高负载桌面应用），非本批回归；CI 以 `retries: 1` 运行。

契约编号（已按建议顺延落库）：A 于 2026-09-11 的第二轮裁决（[A 的契约评审裁决](a-contract-review-f25-f29-f32.md) §10）把 **R-5 定义为 `GET /api/v1/task-groups/memberships`（`listTaskGroupMemberships`）**，并已由 [PR #102](https://github.com/256-code/InPulse/pull/102) 落库。本批新增的两条路由原按 R-5 / R-6 标注，与已冻结编号冲突；现按建议顺延为 **R-6 `listLeftoverItems`（`GET /api/v1/leftover-items`）** 与 **R-7 `listTaskGroups`（`GET /api/v1/task-groups`）**，路由 summary、Schema Registry 描述、实现注释与引用测试均已同步，冲突编号不再存在。

分工提示：A 的 §10 裁决同时把 F-25 步骤 3（功能页任务卡片 / 详情抽屉的「主任务 / 来源任务 / 迭代记录 n 条」标记与「查看主任务」）的落地方式定为页面级一次批量调用 R-5 `listTaskGroupMemberships`，并明确**不扩大任务基础 DTO**（不接受 `TaskItem.groupRole`）。该条不在本 PR 范围内，仍待实现；R-5 契约已由 [PR #102](https://github.com/256-code/InPulse/pull/102) 落库且编号已冻结，前端接线可直接开始。

## B-1 记录列表分页（F-17 / F-18，2026-09-11 本地落库）

`listRecordDrafts`（F-17）与 `listChangeRecords`（F-18）由单页数组改为 C-006 服务端签名游标分页：契约以 `RecordDraftPage` / `ReadableRecordPage`（items/nextCursor/hasMore）替换 `RecordDraftList` / `ReadableRecordList`，新增 `RecordDraftListQuery`，`RecordListQuery` 增补 `cursor` 与 `limit`（1～100、默认 20，越界或未知字段 422）。草稿按 `created_at DESC,id DESC`、正式记录按 `published_at DESC,id DESC` 取 `limit+1` 条判断 `hasMore`，服务端把本页最后一条位置编码为签名游标；游标绑定 actor、命名空间与项目，TTL 15 分钟，篡改 / 过期 / 跨项目 / 跨命名空间统一 422 `INVALID_CURSOR`。查询参数不改变可见性：无权限项目先收敛为 404，通过后才校验游标。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| B1-CONTRACT-001 | 契约 | 分页参数与 envelope | `RecordListQuery` / `RecordDraftListQuery` 接受 `cursor`+`limit`（字符串 “20” 归一为 20）并拒绝 0、101、非整数、超长游标与未知字段；`ReadableRecordPage` / `RecordDraftPage` 严格校验 `items`/`nextCursor`/`hasMore`，缺字段、空 `nextCursor`、未知字段均拒绝 | 本地通过（`packages/api-contract/test/published-records.test.ts`、`test/record-drafts.test.ts`；契约 15 文件 93 例通过） |
| B1-API-UNIT-001 | 单元 | 游标编码、解码与错误映射 | 第 1 页以本页最后一条位置编码 `nextCursor`，第 2 页以其为排他 keyset 边界；篡改、跨 actor、跨项目、跨命名空间 422 `INVALID_CURSOR`；无权限项目先 404 且不按游标状态区分；成员请求 VOID 列表 404；`limit` 1..100 透传、缺省 20 | 本地通过（`apps/api/test/record-list-pagination.test.ts` 4 例） |
| B1-WEB-001 | 前端单元 | 「加载更多」与签名游标 | 已发布记录与草稿列表点击「加载更多」后用服务端 `nextCursor` 请求下一页并追加渲染，第二次调用携带 `cursor`、`limit: 20` 与 AbortSignal；`hasMore=false` 后不再请求 | 本地通过（`apps/web/src/features/published-records/PublishedRecordsView.test.tsx`、`apps/web/src/features/record-drafts/RecordDraftsView.test.tsx`） |
| B1-INT-001 | PostgreSQL 集成 | keyset 不重不漏与游标校验 | 3 条草稿 / 正式记录以 `limit=2` 分两页取回：页内顺序为 `created_at DESC,id DESC` / `published_at DESC,id DESC`，两页无重叠无遗漏，`hasMore` 由 true 翻转为 false 且第二页 `nextCursor` 为 null；跨项目游标与损坏游标 422 `INVALID_CURSOR` | 已落库待 CI（`apps/api/test/record-drafts.integration.test.ts`、`published-records.integration.test.ts`；本机无 PostgreSQL 实例与 Docker，未运行） |

本地实际执行（2026-09-11）：`pnpm lint`、`pnpm format:check`、`pnpm typecheck`（6 项目）、`pnpm test:unit`（database 15、api-contract 15 文件 93 例、canonical-json 5、web 64 文件 293 例、api 68 文件 350 例、ops 7 文件 36 例）、`pnpm build`、`pnpm contract:drift`（5 个产物）、`pnpm contract:validate`（97 条路由）、`pnpm permissions:check`（97 条操作 / 97 条路由）、`pnpm db:migrations:check`（7 个迁移）、`pnpm check:deps`（625 文件无环）、`pnpm check:frontend:boundaries`（209 模块 / 955 依赖）、`pnpm check:secrets`（921 文件）、`pnpm check:docs`（73 个 Markdown）、`pnpm deps:audit`（公共 registry 高等级审计无已知漏洞）均通过；lint 同时暴露并修复了「分页游标列被透传进严格响应 Schema」的缺陷。

未运行 / 已知偏差：① `pnpm test:integration` 未运行——本机没有 PostgreSQL 实例与 Docker，两个集成文件可正常收集（24 例），仅按设计因缺少 `TEST_DATABASE_URL` fail closed，新增的 B1-INT-001 用例需由 CI 首次执行；② `pnpm test:e2e` 未运行（依赖数据库与浏览器环境）；③ `pnpm check:deploy:test` 未通过——本机缺少 docker CLI，脚本报 `spawnSync docker ENOENT`，与本次改动无关，故 `pnpm check` 在该步骤中断；④ 本分支 GitHub Actions 尚未执行；⑤ 新增集成用例与前端「加载更多」用例需非作者人工评审。

## B-7 记录侧发布计数映射（D-1 前置，2026-09-11 本地落库）

记录侧只读端口 `ChangeRecordReadPort` 删除「已发布任务 ID 集合」方法 `listTaskIdsWithPublishedRecords`，统一为「任务 → PUBLISHED 正式记录数」映射 `countPublishedByTask`（单条 SQL、按 `task_id` 升序、计数为 0 的任务缺席由消费端 `?? 0` 补齐，恒有 `hasPublishedRecord === (count > 0)`）。R-3 `MyTasksQueryService.list` 改为消费计数映射并由计数派生 `hasPublishedRecord`；存在性筛选仍在 `MyTaskQueryPort.list` 的同一分页 SQL 内以等价 EXISTS 先过滤后分页，不改锁序、不新增依赖边。R-3 的 `publishedRecordCount` 契约字段与 R-5 的「任务记录标记批量读」扩展属 A-7（裁决 §11.6），不在本批。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| B7-INT-001 | PostgreSQL 集成 | 计数口径与范围 | 同一任务 2 条 PUBLISHED 记录（其中 1 条含第 2 版）→ `count = 2`；仅 VOID / 仅草稿 / 无记录任务缺席（消费端补 0）；跨项目任务只在传入该项目 ID 时返回；空 `projectIds` / 空 `taskIds` 短路且不发出 SQL；越界 `taskIds`（超上限、非正整数）抛 `invalid-task-ids` 且不发出 SQL | 已落库待 CI（`apps/api/test/aggregate-read-ports.integration.test.ts`；本机无 PostgreSQL 实例与 Docker，未运行） |
| B7-PLAN-001 | PostgreSQL 集成 | EXPLAIN (ANALYZE, BUFFERS) | R-3「先过滤后分页」SQL 与计数 SQL 均命中 `change_records` 既有索引（`change_records_project_task_idx` / `change_records_project_status_idx`），无 `Seq Scan on change_records` 与 `Seq Scan on tasks`；证明计数未破坏先过滤后分页、不需要新增迁移 | 已落库待 CI（同上） |
| B7-API-UNIT-001 | 单元 | R-3 服务消费计数映射 | `MyTasksQueryService.list` 以本页 `taskIds` 调用 `countPublishedByTask(tx, pageProjectIds, taskIds)`；有条目 → `hasPublishedRecord: true`，缺席 → `false` | 本地通过（`apps/api/test/aggregate-read.service.test.ts`，22 例） |

本地实际执行（2026-09-11）：`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test:unit`（database 15、api-contract 15 文件 93 例、canonical-json 5、web 64 文件 293 例、api 68 文件 350 例、ops 7 文件 36 例）、`pnpm build`、`pnpm contract:drift`（5 个产物）、`pnpm contract:validate`（97 条路由）、`pnpm permissions:check`（97 条操作 / 97 条路由）、`pnpm db:migrations:check`（7 个迁移）、`pnpm check:deps`（625 文件无环）、`pnpm check:frontend:boundaries`（209 模块 / 955 依赖）、`pnpm check:secrets`（921 文件）、`pnpm check:docs`（73 个 Markdown）、`pnpm deps:audit`（无已知漏洞）均通过。

未运行 / 已知偏差：① `pnpm test:integration` 未运行——本机没有 PostgreSQL 实例与 Docker，`apps/api/test/aggregate-read-ports.integration.test.ts` 可正常收集（17 例），仅按设计因缺少 `TEST_DATABASE_URL` fail closed；B7-INT-001 与 B7-PLAN-001 需由 CI 首次执行（EXPLAIN 断言依赖真库计划形状）；② `pnpm test:e2e` 未运行（依赖数据库与浏览器环境）；③ `pnpm check:deploy:test` 未通过——本机缺少 docker CLI（`spawnSync docker ENOENT`），与本次改动无关；④ 本分支 GitHub Actions 尚未执行；⑤ 新增真库用例需非作者人工评审；⑥ A-7 未落库前 C-1 不得以条数实现标记（裁决 §11.6）。

## A-7 R-3 / R-5 记录标记扩展（D-1，2026-09-11 本地落库）

按[裁决修订 D-1](a-contract-review-f25-f29-f32.md) §11：R-3 `MyTaskItem` 增加 `publishedRecordCount`（与 `hasPublishedRecord` 同源同口径，恒有 `hasPublishedRecord === (publishedRecordCount > 0)`）；R-5 由「聚合组成员关系」扩为「任务记录标记批量读」，条目为 `{ taskId, groupId, groupRole, publishedRecordCount }`，`groupId` / `groupRole` 可空，请求中每一个有权 taskId 都出现（未入组以 null 返回且计数照常），无权或不存在（含跨项目）仍不出现。B-7 记录侧计数端口不变，R-5 只消费既有 `countPublishedByTask`，不新增依赖边、不新增路由。本节取代上方向后兼容的旧 R-5 语义描述（PR #102 章节保留为历史记录）。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| A7-CONTRACT-001 | 契约 | Schema 与生成物 | R-3 `myTaskItemSchema` 增加 `publishedRecordCount`；R-5 条目 `groupId`/`groupRole` 可空并新增 `publishedRecordCount`；`pnpm contract:drift`（5 个产物）、`pnpm contract:validate`（97 条路由）、`pnpm permissions:check`（97/97）通过 | 本地通过 |
| A7-R3-INT-001 | PostgreSQL 集成 | R-3 计数与存在性同源 | `GET /api/v1/me/tasks` 条目计数：`tMain` = 1（草稿不计）、`tSource` = 5（作废记录不计）、`tDone` = 0；逐条满足 `hasPublishedRecord === (publishedRecordCount > 0)` | 本地通过（`apps/api/test/aggregate-read-api.integration.test.ts` 19/19） |
| A7-R5-INT-001 | PostgreSQL 集成 | R-5 覆盖 / 空值 / 授权 | 一次请求 6 个有权 taskId：全部出现且按 taskId 升序；未入组任务 `groupId`/`groupRole` 为 null（含带 1 条 PUBLISHED 记录者计数为 1、已解除 DETACHED 成员关系按未入组返回）；不存在的 `2147483647` 返回空集；跨项目任务对无权限用户不出现、对成员返回带计数的关系项 | 本地通过（同上，3 例） |
| A7-R5-UNIT-001 | 单元 | R-5 服务覆盖与短路 | 服务按 `TaskQueryPort.listByIds` 求有权集合、升序补齐未入组条目与计数；无权任务不出现；无授权项目时不调用 `listGroupRoles` / `countPublishedByTask` | 本地通过（`apps/api/test/aggregate-read.service.test.ts` 23 例） |
| A7-PLAN-001 | PostgreSQL 集成 | EXPLAIN (ANALYZE, BUFFERS) | R-3「先过滤后分页」SQL 与计数 SQL 均为 ANALYZE 实测输出（含 `actual time`）、命中 `change_records` 既有索引且无 `Seq Scan`；引用并加强 B7-PLAN-001 证据 | 本地通过（`apps/api/test/aggregate-read-ports.integration.test.ts` 17/17） |

本地实际执行（2026-09-11，本机 PostgreSQL 18.6 + PGroonga，`127.0.0.1:55436`）：`pnpm contract:drift`、`pnpm contract:validate`、`pnpm permissions:check`、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test:unit`（web 64 文件 293 例、api 68 文件 351 例、ops 8 文件 52 例，其余 workspace 通过）、`pnpm --filter @inpulse/api test:integration`（49 文件 428 例）均通过。

未运行 / 已知偏差：① 本分支 GitHub Actions 尚未执行；② `pnpm test:e2e` 未运行（本次未改前端行为）；③ 前端消费（F-25 步骤 3 徽章与「查看主任务」）属 C-1，仍待落地；④ 新增真库用例与 R-5 破坏性契约变更需非作者人工评审。

## A-2 未裁决契约项定案（C-001 / C-004 / C-005 / C-007 / C-008，2026-09-11 本地落库）

按 [A 的契约评审裁决](a-contract-review-frontend-consumption.md)（对应 [C 的消费需求清单](frontend-generated-client-consumption-requirements.md) §6 五条开放项）：C-001 生成客户端输出位置冻结为 `apps/web/src/generated/api/`；C-004 `details` 保持开放对象并冻结保留键 `issues` / `reason`（判别联合延后，恢复条件见裁决 §3.2）；C-005 冻结 CSRF 四码族；C-007 生成客户端不做运行时 Schema 校验；C-008 `message` 为稳定诊断文案、前端只按 `code` 分支。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| A2-RULING-001 | 文档 | 五项裁决记录 | 五项全部定案并写入裁决文档；消费清单 §6 状态列与 §7 评审请求同步；技术设计仓库结构“客户端”修订为“客户端生成器” | 本地通过 |
| A2-CONTRACT-001 | 契约 | ErrorResponse 字段说明与生成物 | `error.zod.ts` 四字段补 `description`（含空对象约定与保留键）；`pnpm contract:generate` 重生成 5 个产物、`contract:drift` 无漂移、`contract:validate`（97 条路由）、`permissions:check`（97/97） | 本地通过 |
| A2-UNIT-001 | 单元 | 生成客户端不做运行时校验（C-007） | `generation.test.ts` 断言真实 Registry 的客户端与类型产物不含 `zod` / `safeParse`，错误解析走 `JSON.parse` 与 `response.ok` | 本地通过（api-contract 94 例） |
| A2-CODES-001 | 集成 / 单元 | CSRF 码族（C-005） | `CSRF_ORIGIN_REJECTED`（403，`reason` 为同源失败枚举）、`CSRF_TOKEN_INVALID`（403，`invalid-csrf`）、`MFA_CSRF_REJECTED`（401）、`ADMIN_CSRF_REJECTED`（401）与裁决一致，失败不使用 `FORBIDDEN` | 既有测试已覆盖（`logout.controller.test.ts`、`contract-runtime.http.test.ts`、`api-exception.filter.test.ts`、CONTRACT-009；本次未改实现） |
| A2-DETAILS-001 | 集成 | `details` wire 形状不变 | 既有 `{ issues: ... }` / `{ reason: ... }` / `{}` 断言（如 `http-error-contract.integration.test.ts`）保持通过 | 本地通过（`pnpm --filter @inpulse/api test:integration`） |

本地实际执行（2026-09-11）：`pnpm contract:generate`、`pnpm contract:drift`、`pnpm contract:validate`、`pnpm permissions:check`、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test:unit`、真库 `pnpm --filter @inpulse/api test:integration`、`pnpm check:docs`、`pnpm check:secrets` 均通过。

未运行 / 已知偏差：① 本分支 GitHub Actions 尚未执行；② FC-031 判别联合与逐路由 `details` Schema ref 属延后项，恢复条件见裁决 §3.2，未在本批实现；③ 本次不改路由、状态码语义与权限矩阵。

## A-3 compose.init 首次建库纵切片与灾难恢复离线 Runbook（2026-09-11 本地落库）

按[技术设计 §11.2 / §11.2.1 / §11.5](../技术设计v1.2.2.md)：首次建库使用版本化一次性覆盖
[`deploy/compose.init.yaml`](../deploy/compose.init.yaml)——仅该次向 db 服务设置 `POSTGRES_DB=app`、
`POSTGRES_USER=cluster_bootstrap`、`POSTGRES_PASSWORD_FILE`，并只读挂载六份独立密码 Secret；稳态
db 容器不挂载任何登录密码，禁止把一次性覆盖用于日常 `up`。灾难恢复离线步骤见
[灾难恢复离线 Runbook](./runbooks/disaster-recovery.md)。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| A3-INIT-001 | 部署预检 | compose.init.yaml 结构与静态防线 | `pnpm check:deploy:test`：overlay 渲染出 db 的三个 POSTGRES_* 环境变量与六份 `db_*` Secret（target `/run/secrets/db_*`、mode 0400、uid/gid 999）；稳态渲染的 db 无 POSTGRES_* 且 db/migrate/api/web/backup/audit-archive 均不挂 `db_bootstrap_password`；负例（篡改 target、`.env.deploy.example` 占位符）被拒绝 | 本地通过 |
| A3-INIT-002 | 集成 / 容器 | 真实首次建库（db-bootstrap 镜像） | 本地 Docker 构建 `deploy/docker/db-bootstrap.Dockerfile` 后以 overlay 启动 db：initdb 与 `000_roles.sql` / `010_passwords.sql` / `020_pgroonga.sql` 依次执行无报错；容器 healthy | 本地通过（2026-09-11） |
| A3-INIT-003 | 集成 / 容器 | 角色与扩展探针 | 7 个角色：`app_owner` / `audit_writer` NOLOGIN，其余 5 个 LOGIN；全部非超级用户、无 CREATEDB/CREATEROLE；`app_runtime` 密码可登录且 `SET ROLE app_owner` 被拒（42501）；`pgroonga` 扩展存在 | 本地通过 |
| A3-INIT-004 | 集成 / 容器 | 稳态接管 | init 覆盖 `down` 后以稳态 compose 启动同一数据卷：db healthy（数据卷已初始化时稳态无需 POSTGRES_*） | 本地通过 |
| A3-RUNBOOK-001 | 文档 | 灾难恢复离线 Runbook | 交付 `docs/runbooks/disaster-recovery.md`：离线材料清单、镜像 digest 校验、compose.init 用法与角色探针、数据恢复、Session 处理、迁移与完整校验、RPO/RTO 门禁、故障处理；`backup-restore.md` §7 与 `database/README.md` 同步引用 | 本地通过（`pnpm check:docs` 75 个 Markdown） |

本地实际执行（2026-09-11）：`pnpm check:deploy:test`（正例，含 overlay 渲染与新断言）、
`pnpm check:deploy --env deploy/.env.deploy.example`（负例被拒）、篡改 overlay secret target 的
负例被拦截、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm check:docs`、
`pnpm check:secrets` 均通过；Docker 真实验证见 A3-INIT-002~004（独立 project 名，验证后已 `down -v`
清理，测试密码与本地 env 文件不在版本控制内）。

未运行 / 已知偏差：① 本分支 GitHub Actions 尚未执行；② 真实主机恢复演练（RECOVERY-001 /
DEPLOY-003）仍是上线门禁，未在本批执行；③ 六份密码、发布清单 digest 与 TLS 的离线保管流程由
运维在上线时落实，本批只交付 Runbook 与静态防线；④ 本地 Compose 对 secrets 的 uid/gid/mode
声明会给出「not supported」警告（属 Swarm 语法），实际文件权限由部署账户控制，静态声明仍由
`check:deploy` 校验；⑤ `010_passwords.sql` 的容器内路径已与稳态 secret 名对齐（`db_*`），
`database/.env.example` 同步更新。

## A-4 SEC-003 CSRF 完整生命周期 E2E（2026-09-11 本地落库）

按 [ADR-015](adr/ADR-015.md) 与 [ADR-023](adr/ADR-023.md)：浏览器侧首登、刷新、多标签与
普通/版本化写请求头由 [`apps/e2e/tests/csrf.spec.ts`](../apps/e2e/tests/csrf.spec.ts) 覆盖；
材料失效与恢复的服务端语义（单次消费、4 个上限、过期、重签恢复、securityFlow 幂等例外）由
[`apps/api/test/csrf-lifecycle.integration.test.ts`](../apps/api/test/csrf-lifecycle.integration.test.ts)
在真实 PostgreSQL 与真实 HTTP（完整 AppModule）上覆盖。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| SEC3-E2E-001 | 浏览器 E2E | 首登与轮换 | 登录请求带 43 字符 `x-csrf-token` 且不带 Idempotency-Key；`GET /auth/csrf` 不发送业务幂等键；登录成功后 `__Host-session` 为 HttpOnly/Secure/SameSite=Lax/Path=/ 且 `__Host-preauth` 被清除 | 本地通过（2026-09-11） |
| SEC3-E2E-002 | 浏览器 E2E | 刷新 | 登录后刷新页面仍为已认证；随后 `POST /projects` 重新签发 CSRF 并携带 `x-csrf-token` 与 `Idempotency-Key` | 本地通过 |
| SEC3-E2E-003 | 浏览器 E2E | 多标签 | 同一会话两个标签各自签发 CSRF 并分别完成项目创建；第二个标签签发后第一个标签仍能完成「全部已读」写操作 | 本地通过 |
| SEC3-E2E-004 | 浏览器 E2E | If-Match | 模块编辑 PATCH 携带 `If-Match: "rowVersion"`、`x-csrf-token` 与 `Idempotency-Key` | 本地通过 |
| SEC3-API-001 | API 集成 | 失败不消费与重试一次 | 错误 CSRF 登录 401 且预认证材料未被消费；重签后重试一次成功（200，签发 Session 与新 CSRF）；同一材料再登录：带有效 Session 409 `AUTH_SESSION_CONFLICT`、登出后 401；从未消费的原始材料仍可登录 | 本地通过 |
| SEC3-API-002 | API 集成 | 4 个上限与过期恢复 | 连续签发 5 次仅保留 4 个有效 Hash（DB 断言）；最旧 Token 写操作 401 `MODULE_SESSION_REQUIRED`，其余仍可用；全部过期后写操作 401，重签后恢复 200 | 本地通过 |
| SEC3-API-003 | API 集成 | 预认证过期 | 过期预认证材料登录 401；重签后成功签发 Session | 本地通过 |
| SEC3-API-004 | API 集成 | securityFlow 幂等例外 | 登录即使携带 Idempotency-Key 也不写入 `app.idempotency_records`（计数 0）；模块创建缺 Key 返回 400 `IDEMPOTENCY_KEY_REQUIRED`，带 Key 成功 | 本地通过 |

本地实际执行（2026-09-11）：`apps/api/test/csrf-lifecycle.integration.test.ts` 4/4（真实
PostgreSQL 与完整 AppModule HTTP）、`apps/e2e/tests/csrf.spec.ts` 4/4（Playwright chromium）、
`pnpm build`、`apps/e2e` typecheck、`pnpm format:check`、`pnpm check:docs` 均通过。

未运行 / 已知偏差：① 本分支 GitHub Actions 尚未执行；② CSRF Token 8 小时自然过期与后台
清理按真实时间推进，不在本批（过期失效语义以数据库时间回拨覆盖）；③ 除登录/登出外的其余
securityFlow（MFA 注册、验证、恢复码、管理员重认证）CSRF 路径已有控制器单测与 MFA E2E 覆盖，
本批不重复。
