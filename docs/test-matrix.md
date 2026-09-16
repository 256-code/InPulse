# 测试矩阵

状态：已接受的验收基线。当前仓库处于阶段 0 实施中，尚无完整业务应用代码，数据库真实 PostgreSQL 测试与搜索服务/HTTP API 集成测试已部分落地；`已自动化` 表示该检查的脚本已落库并已纳入 `.github/workflows/ci.yml`（实际执行证据见各章节的状态说明），`Required` 表示对应阶段必须实现并由 CI 执行，不代表测试已经通过。

2026-09-12 清账：main `4141e1d` 的 `CI / workspace`（[run 34620173140](https://github.com/256-code/InPulse/actions/runs/34620173140)，含五个生产镜像构建与 Trivy 扫描、Browser E2E 50 passed / 6.3 分钟）与 `Documentation / docs`（[run 34620173112](https://github.com/256-code/InPulse/actions/runs/34620173112)）已通过；下列历史小节按当时事实保留，其中「GitHub Actions 待执行 / 尚未执行」为当日本地交审时点的描述，实际 CI 结果已在行内回填。

2026-09-15 修订（[ADR-031](adr/ADR-031.md) 移除 TOTP）：下表所有「TOTP / 双因子 / 管理员重认证 / 恢复码」表述均已被 ADR-031 取代——7 条 MFA 路由（注册、验证、重认证、恢复码轮换与消费、管理员 MFA 重置）、前后端实现与对应单元 / 集成 / E2E 用例已删除；登录只保留口令因素并直接签发 `AUTHENTICATED` Session；管理员高风险操作门禁改为「当前有效的完整管理员 Session（`is_admin`）+ 写操作同步 CSRF + 数据库幂等 + 审计留痕」，不再校验 `reauthenticated_at` / `mfa_verified_at`，最后一名保护改为 `LAST_ACTIVE_ADMIN_REQUIRED`。SEC-010 至 SEC-014、FE-011 与 CI-017 的 MFA 部分为已被取代的历史覆盖记录；`user_totp_factors`、`mfa_recovery_codes` 与 `user_sessions` 的历史 MFA 列按本期决定「只停用不删除」。

2026-09-15 修订（[ADR-032](adr/ADR-032.md) 接入立镖 Casdoor OIDC 单点登录）：`/login` 默认整页跳转到 `GET /api/v1/auth/sso/start`，回调 `GET /api/v1/auth/sso/callback` 校验 state（URL + `__Host-sso-state` Cookie 双绑定）与 id_token 后，复用与口令登录同一实现签发本地 Session；首次登录 JIT 开通账号（`is_admin=false`、`password_hash=NULL`、无项目权限），映射优先级为 `sso_subject` → 登录名 + 邮箱一致绑定 → JIT；`SSO_ENABLED` 未配置或配置非法时 fail closed 回落 `/login?local=1&sso=disabled`。本地会话空闲有效期由 8 小时收紧为 30 分钟（口令与 SSO 共用，`SESSION_IDLE_MAX_AGE_SECONDS` 可覆盖）。新增 SEC-016 至 SEC-020 与 FE-012 覆盖本片；`securityFlow` allowlist 由三条（ADR-031 后）扩为五条；迁移 `0014_sso_backup_grants.sql` 为 `app_backup` 补齐 `app.sso_login_attempts` 的 pg_dump 只读授权，该表数据经 `--exclude-table-data` 排除（见 BACKUP-001）。
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

第二个纵切片补齐 SEC-004/SEC-006/SEC-007（同日本地实现、本地验证；CI 已通过，PR #86 / run 34451420820）：
未匹配路由的 404 由全局 `ApiExceptionFilter` 统一为固定文案，并在回归用例中锁定契约
（Nest 11.2.3 默认会把 `Cannot {method} {url}` 回显进响应体，[ADR-026](adr/ADR-026.md) 要求
直接修正异常过滤器，因此不引入 adapter 包装）；`database/src/config.ts` 把 Secret 文件权限
判定抽成 `isPrivateOwnerReadableFile`，生产模式仍是 `/run/secrets` 直接子项、非符号链接、
仅属主可读的 fail closed 策略；GitHub 外链按 [ADR-022](adr/ADR-022.md) 用标准 URL Parser
实现规范化，数据库最终防线沿用既有类型化关联模型。Markdown 白名单渲染当时列为未交付（前端
没有任何 Markdown 渲染落点，引入 react-markdown/rehype-sanitize 属新增生产依赖，必须独立 PR
由人工确认）：依赖已由 [PR #127](https://github.com/256-code/InPulse/pull/127) 合入，白名单渲染
已由 B-5 落库，见本文件「B-5 迭代记录 Markdown 白名单渲染」章节。外部链接的 HTTP 关联接口属
F-14 业务纵切片，新增路由必须同步 Schema、Route Registry、权限矩阵、OpenAPI 与生成客户端。
另见「审计与安全」表。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F09-CSP-UNIT-001 | Web 单元 | 策略串、nonce 与 HTML 改写 | `resolveWebCspMode` 对非法值 fail closed；策略串与设计 §7.5 一致且不含 `unsafe-inline`；`applyHtmlSecurityHeaders` 只对 HTML 响应写头；`rewriteHtmlBody` 替换全部占位符；nonce 为 32 位十六进制且逐响应用新；`/api/**` 命名空间不会被 dev/preview 中间件短路（ADR-032 的整页导航入口必须拿到 API 的 302） | 本地通过（`apps/web/tools/vite-csp.test.ts` 17 例与 `AppProviders.test.tsx`） |
| F09-CSP-E2E-001 | 浏览器 E2E | 入口 nonce 一致性与强制模式零违规 | 同一入口两次响应的 nonce 不同，CSP 头 nonce 与 meta/script 标签一致，占位符无残留；登录、主题色、命令面板、通知弹层、懒加载与错误页在 CSP enforce 下 `securitypolicyviolation` 零违规；安全检查头齐全 | 本地通过（`apps/e2e/tests/csp.spec.ts` 2/2，2026-09-10） |
| F09-CSP-IMAGE-001 | 部署集成 | 真实镜像与 Nginx | HTTP 非 ACME 请求 308 跳同主机 HTTPS；入口/SPA 回退/代理路径逐项校验 nonce、`no-store` 与安全头；代理上游不可达时仍保留安全头；条件请求返回 200 而非带旧 nonce 的 304；哈希资源 `immutable` | 本地通过（`scripts/check-web-image-csp.sh inpulse/web:local`，2026-09-10；已加入 CI 生产镜像构建之后） |
| F09-CSP-GATE-001 | 部署预检 | Compose/资产结构 | `deploy/docker/nginx-security-headers.conf` 列入必需资产；`nginx.conf` 必须含 `sub_filter "__INPULSE_CSP_NONCE__" "$request_id"` 与安全头 include；两个 Nginx 文件的指令行不得出现 `unsafe-inline`；`web.Dockerfile` 必须拷贝两个配置文件 | 本地通过（`scripts/check_deploy_refs.mjs`，正例通过、`.env.deploy.example` 占位符拒绝） |
| F09-SEC006-API-001 | API 集成 | 未匹配路由净化 404 | 未知路径（含全局前缀外、根路径与 `/api/v1` 本身）返回 `application/json` 的统一 404：`code=NOT_FOUND`、`message` 为固定文案、`details` 为空，body 不回显 method、path、框架文案或 HTML；`X-Request-Id` 与 body 一致；已匹配路由（`/health/live` 200、匿名 `/me` 401）不受影响 | 本地通过（`apps/api/test/http-error-contract.integration.test.ts` 3 例，2026-09-10；修正点即全局异常过滤器，无需额外 adapter 包装；CI 已通过，PR #86 / run 34451420820） |
| F09-SEC007-DB-001 | 数据库单元 + 部署预检 | Secret 文件 fail closed | 权限矩阵只接受属主读位且无组/其他/执行位（`0600`/`0400` 通过，`0500`/`0700`/`0640`/`0604`/`0606`/`0000`/`0200` 拒绝）；生产 Secret 路径必须是 `/run/secrets` 直接子项（相对路径、`..`、嵌套目录与根目录本身均拒绝）；缺失文件变量不回退环境变量，生产模式直连 `DATABASE_URL`/`MIGRATION_DATABASE_URL` 同样被拒；空文件与纯空白内容拒绝，内容读取后去首尾空白；compose secret 声明（mode 0400、直接子项、uid/gid）由 `check:deploy` 校验 | 本地通过（`database/test/unit/config.test.ts` 15 例，2026-09-10；真实 POSIX 权限位无法在 Windows 本机复现，权限判定在函数级覆盖；CI 已通过，PR #86 / run 34451420820） |
| F09-SEC004-API-001 | API 单元 | GitHub URL 规范化 | 只接受规范化的 `https://github.com/...`：拒绝 http/ftp、用户信息、非默认端口、`api.github.com`、`github.com.evil.example` 混淆域名、编码伪段、超长输入与非 URL；query 只保留 `page/q/tab` 并排序、fragment 一律移除；ISSUE/PR 编号必须为正整数，COMMIT 必须为 7-64 位十六进制且规范化保存小写；不配置 Token、不发起远程请求 | 本地通过（`apps/api/test/github-url.test.ts` 16 例，2026-09-10；CI 已通过，PR #86 / run 34451420820） |
| F09-SEC004-DB-001 | PostgreSQL 集成 | ExternalLinks 数据库防线 | 同项目规范化 URL 唯一（23505）且并发写入只成一条；非 https、混淆域名与带 fragment 的 URL 被 CHECK 拒绝（23514）；任务/功能/记录/项目四类类型化关联的跨项目串联与归属错配均被复合外键拒绝（23503）；四类关联重复关联同一链接均 23505；`normalized_url` 不可变 | 本地通过（`database/test/integration/external-links.test.ts` 13 例，PostgreSQL 18.6 + PGroonga，2026-09-10 落库 7 例、2026-09-11 补齐项目/功能/记录关联的复合外键用例；CI 已通过，PR #103 / run 34556627765） |

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

本轮真实 PostgreSQL 集成全量 37 文件 232 例、API 单测 61 文件 291 例（含 HTTP 边界 10 例）、契约 10 文件 75 例、前端 35 文件 120 例（并行负载下两个既有计时敏感用例偶发失败，单跑通过）；`pnpm lint`、`format:check`、`typecheck`、`build`、`check:deps`、`check:frontend:boundaries`、`check:secrets`、`check:deploy:test`、`db:migrations:check` 与公共 registry 审计均通过。未运行 `pnpm test:e2e`（无前端改动）、GitHub Actions 与镜像构建扫描（本地时点；F-23 由 PR #81 合入，CI 已通过 run 34436623939）。

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

本轮真实 PostgreSQL 集成全量 40 文件 260 例（两轮各 1 例既有偶发失败：`project-member-management-api` 与 `preauth-session`，单文件复跑分别 8/8 与 4/4 通过）、解除文件 8/8、API 单测 63 文件 303 例（含 HTTP 边界 10 例）、契约 11 文件 81 例、前端 37 文件 124 例（并行负载下两个既有计时敏感用例偶发失败，单跑 4/4 通过）；`pnpm lint`、`format:check`、`typecheck`、`build`、`check:deps`、`check:frontend:boundaries`、`check:secrets`、`check:deploy:test`、`db:migrations:check` 与公共 registry 审计均通过。未运行 `pnpm test:e2e`（无前端改动）、GitHub Actions 与镜像构建扫描（本地时点；F-24 由 PR #87 合入，CI 已通过 run 34453066198）。

## F-06 项目编辑与归档/恢复（A，2026-09-10 本地实现）

阶段 1 A 域项目编辑/归档/恢复纵切片：`PATCH /api/v1/projects/{projectId}` 由项目活跃成员或
系统管理员整笔替换 `name` 与 `description`；编码创建后不可修改；父项目必须 ACTIVE，归档
项目返回 409 `PROJECT_ARCHIVED`；CSRF、`Idempotency-Key` 与 `If-Match` 必填，版本冲突
409；名称/描述、审计 `project.update`、活动 `PROJECT_UPDATED` 与搜索投影在同一事务内提交；
重放前重新验证当前成员关系与项目可写性。`GET /api/v1/projects/{projectId}/archive-preview`
为管理员只读路径，统计未完成（TODO + ACTIVE）任务数用于归档提醒；`POST
/api/v1/projects/{projectId}/archive` 与 `restore` 要求完整管理员 Session（[ADR-031](adr/ADR-031.md) 起不再要求 TOTP 重认证）
，原因、CSRF、`Idempotency-Key`、`If-Match` 必填，状态不符返回 409
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
| F06-ARCHIVE-API-001 | HTTP + PostgreSQL | 归档与影响预览 | 管理员归档返回 200、`archived_at` 非空、`rowVersion` 递增；审计 `project.archive`、活动 `PROJECT_ARCHIVED` 与搜索投影 `source_status = 'ARCHIVED'` 同事务；归档后成员编辑 409、重复归档 409；预览只统计 TODO + ACTIVE 任务，匿名 401、非管理员成员 403、非成员 404、管理员身份失效 403，且 GET 不要求 CSRF | 本地通过（同上 9/9） |
| F06-ARCHIVE-API-002 | HTTP + PostgreSQL | 恢复与状态门禁 | 恢复返回 200、`archived_at` 置空、`rowVersion` 递增，审计 `project.restore`、活动 `PROJECT_RESTORED` 与搜索投影 `source_status = 'ACTIVE'` 同事务；恢复后成员可再次编辑；未归档恢复 409 `PROJECT_STATE_CONFLICT`；非管理员 403、非成员 404 | 同上 |
| F06-ARCHIVE-API-003 | HTTP + PostgreSQL | 幂等重放 | 归档/恢复成功后同 Key 同摘要重放返回相同 200 响应（归档态重放不因只读被拒）；会话被撤销后同 Key 重放 401，不返回已存成功响应 | 同上 |
| F06-ARCHIVE-UI-001 | 前端 | 编辑/归档/恢复入口 | 项目卡片提供编辑入口（活跃成员）、归档/恢复入口（管理员）；编辑提交携带 CSRF、`If-Match`、`Idempotency-Key`，版本冲突展示重新加载提示；归档弹窗展示未完成任务提醒并要求原因，403 `ADMIN_REAUTH_REQUIRED` 打开管理员安全验证；恢复弹窗要求原因并说明不改动下级归档状态 | 本地通过（`project-management-modals.test.tsx` 6 例、`ProjectsPage.test.tsx` 归档入口 1 例） |
| F06-ARCHIVE-E2E-001 | Playwright | 归档→只读→恢复关键路径 | 管理员登录后创建项目/功能/任务；归档预览提示“仍有 1 个未完成任务”；归档后徽标“已归档”、编辑被拒“项目已归档，项目只读…”且名称未落库；恢复“正常”后可改名成功、原任务保留 | 本地 1/1（2.6 分钟；E2E_API_PORT=3131 / E2E_WEB_PORT=4191） |

## F-12 未分类模块编辑（2026-09-09 人工确认）

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| MOD-EDIT-UNCLASSIFIED-001 | HTTP + PostgreSQL + 前端 | 编辑未分类名称、描述 | 活跃成员和管理员在父级及模块可写时允许编辑；kind 保持 UNCLASSIFIED；名称冲突、旧版本、无权限均拒绝；失败时保留表单输入；不提供物理删除 | 本地前端与真实 HTTP/PostgreSQL 已通过，见 F-12 交审说明 |

## F-12 模块完整纵切片（B，2026-09-09 本地交审）

接口、边界与命令见 [F-12 本地交审](f12-local-handoff.md)。以下新增用例独立验证业务行为，不替代原 Port 的证据；2026-09-09 在临时 PostgreSQL 18.6 + PGroonga 4.0.8 实测通过。

| ID | 层级 | 场景 | 通过标准 | 当前证据 |
| --- | --- | --- | --- | --- |
| MOD-HTTP-001 | HTTP + PostgreSQL | listModules/createModule/updateModule 允许与拒绝 | 匿名 401，其他项目/已移除成员 404；管理员可读；普通创建固定 NORMAL；未分类可改名，输入身份字段拒绝 | modules-api.integration.test.ts 10/10 本地通过 |
| MOD-HTTP-002 | HTTP + PostgreSQL | archiveModule/restoreModule 允许与拒绝 | 成员 403，管理员需完整管理员 Session（ADR-031 起不再要求 TOTP 重认证）及原因；状态/版本冲突 409；归档父级拒绝写但允许历史读取 | 同上，已通过 |
| MOD-IDEM-001 | HTTP + PostgreSQL | 幂等与重放权限 | Schema 解析后等价输入重放；不同输入 409；成员移除或管理员身份失效拒绝返回缓存 | 同上，已通过；modules-http.test.ts 管理员门禁回调单元验证通过 |
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

新增文件：`contract-validation.pipe.test.ts`、`contract-response.interceptor.test.ts`、`api-exception.filter.test.ts`、`contract-runtime.http.test.ts`。API 单测合计 52 文件 243 例通过；GitHub Actions 已通过（F-11 随 PR #66 合入，run 34328573647）。

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
GitHub Actions 已通过（F-04 后端 PR #53，run 34247563039）。

## F-05 项目读取与成员管理（A，2026-09-09 本地实现）

阶段 1 A 域项目纵切片：`GET /api/v1/projects`、`GET /api/v1/projects/{projectId}`
提供服务端 `AuthorizedProjectScope` 授权与响应 `no-store`；系统管理员新增
`listProjectMembers`、`listProjectMemberUnfinishedTasks`、`addProjectMember`、
`removeProjectMember` 四条成员管理路由。成员写操作要求完整管理员 Session（ADR-031 起不再要求 TOTP 重认证）
、CSRF 与数据库级幂等；项目编辑已由 F-06.1 实现，归档/恢复（F-06.2/F-06.3）
与概览统计仍未实现。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F05-READ-CONTRACT-001 | 契约与 CI | Schema、Route Registry 与生成客户端 | `ProjectPath`、`ProjectItem`、`ProjectListResponse`、`ProjectDetailResponse` 登记；两条 GET 路由声明 Session 认证、CSRF/幂等 `none`、只读状态码与精确权限矩阵；OpenAPI 和前端客户端由生成工具更新 | 本地通过（`contract:drift`、`contract:validate`、`permissions:check`，57/57 条路由；`permissions.test.ts` 14 例） |
| F05-READ-API-001 | API 单元 | 服务端授权编排 | 从 Session 解析 actor，列表/详情只使用服务端 `AuthorizedProjectScope`；无权限与不存在统一 404；匿名 401；异常不泄露数据库细节 | 本地通过（`projects-read.service.test.ts` 3 例、`projects-read.controller.test.ts` 3 例；API 单测 59 文件 274 例） |
| F05-READ-API-002 | HTTP + PostgreSQL | 真实权限与归档读取 | 系统管理员可见全部项目；普通成员只返回 ACTIVE 成员项目；非成员/已移除成员详情 404；匿名与停用 401；非法路径 422；归档后详情仍为 `ARCHIVED` | 本地通过（`projects-read-api.integration.test.ts` 2 例；API 集成 34 文件 190/190，PostgreSQL 18.6 + PGroonga） |
| F05-READ-UI-001 | 前端单元 | 项目列表与创建后刷新 | 列表经生成客户端读取并按卡片展示名称/状态/编码/成员数/描述；创建成功后失效 `["projects"]` 查询并保留原有成功入口 | 本地通过（`project-query.test.tsx`、`ProjectsPage.test.tsx` 等，Web 33 文件 104 例） |
| F05-MEMBER-CONTRACT-001 | 契约与 CI | 四条成员路由登记 | 成员列表/未完成任务、添加、移除均登记 Schema、Route Registry、OpenAPI 与 Web 客户端；声明管理员门禁、CSRF、幂等及重放策略；权限矩阵按 operationId 拆分 | 本地通过（`contract:drift`、`contract:validate`、`permissions:check`，57/57） |
| F05-MEMBER-API-001 | API 单元 | 成员管理编排 | 读路径独立事务；写路径由幂等 runner 持有单事务；管理员解析、管理员门禁、CSRF、Content-Type、路径/Query 与响应 Schema 均被检验；归档后重放重新检查项目可写性 | 本地通过（`project-member-management-http.service.test.ts` 与 `project-member-management.service.test.ts` 12 例；API 单测 59 文件 274 例） |
| F05-MEMBER-API-002 | HTTP + PostgreSQL | 添加与移除生命周期 | 添加 ACTIVE 成员同事务写审计、活动、通知与成员历史；重复活跃成员 409；无效/停用用户 422；移除可真实改派并保留未改派任务原负责人；移除创建者不改 `projects.created_by` | 本地通过（`project-member-management-api.integration.test.ts` 8/8；API 集成 34 文件 190/190） |
| F05-MEMBER-API-003 | HTTP + PostgreSQL | 拒绝与边界 | 匿名/停用 401；非管理员、CSRF 失败 403；非成员/不存在 404；重复活跃或状态冲突 409；非法字段 422；非 JSON 请求 400；统一返回 `{ code, message, details, requestId }` | 本地通过（同集成 8/8；HTTP 单测覆盖 400 与脱敏） |
| F05-MEMBER-TX-001 | PostgreSQL 集成 | 同事务与幂等 | 审计失败时成员写、通知、活动或任务改派整体回滚；同 Key、同摘要、同契约版本重放不重复写；项目归档后旧 Key 拒绝返回缓存 | 本地通过（集成 8/8 覆盖回滚与重放；归档后重放已由服务单测覆盖） |
| F05-MEMBER-UI-001 | 前端单元 | 成员管理页面 | 管理员入口仅系统管理员可见；成员历史、添加、移除、未完成任务提示、改派、CSRF/幂等键与成功后缓存失效均经生成客户端调用 | 本地通过（`ProjectMembersPageView.test.tsx`、`project-member-query.test.tsx` 等，Web 33 文件 104 例） |
| F05-MEMBER-E2E-001 | Playwright | 成员管理页面关键路径 | 普通成员访问 `/projects/:id/members` 由 `RequireAdmin` 拦截并显示 403 空态；管理员登录后直接展示成员历史（ADR-031 起不再要求 TOTP 重认证）；通过页面添加成员出现成功提示与「活跃成员」徽标；移除成员出现确认对话框与「该成员没有未完成任务。」，确认后保留历史记录卡并标记「已移除」「历史记录已保留」；不存在的项目返回前端映射的读取失败空态 | 本地通过（`apps/e2e/tests/project-members.spec.ts` 2/2；全量 `pnpm test:e2e` 29/29，4.7m，基线 `5020c0a`） |
| F05-READ-E2E-001 | Playwright | 项目页面回归 | 项目创建关键路径与全量 E2E 结果如实记录 | 本地通过（`pnpm test:e2e` 29/29，4.7m，含本 diff 新增的成员管理 2 例与既有 F-18 记录发布、搜索/动态/通知/任务用例） |

2026-09-09 本地验证说明：`pnpm test:unit` 数据库 5 例、api-contract 67 例、Web 33 文件
104 例、API 59 文件 274 例；`pnpm test:integration` 数据库 13 例、API 34 文件 190 例。
临时 PostgreSQL 18.6 + PGroonga 4.0.8 曾因 `max_connections=100` 初始化不足，已改为
`max_connections=200` 后完整通过；成员管理页面 Playwright E2E 已于 2026-09-10 由
`apps/e2e/tests/project-members.spec.ts` 补齐（本地 2/2；该分支 rebase 到 `origin/main` `5020c0a` 后全量 29/29 通过）。

## ADR-033 项目内角色（组长与项目管理员，A，2026-09-16 本地落库）

[ADR-033](adr/ADR-033.md) 扩展 [ADR-012](adr/ADR-012.md)：项目创建者默认回填为 `LEADER`，
可在**被赋予的项目内**添加/移除成员、归档/恢复模块、任命或撤销 `PROJECT_ADMIN`；`PROJECT_ADMIN`
可管理成员与归档/恢复模块，但不能任命角色；系统管理员可任命/转移/撤销全部角色（含组长转移）。
角色只存在于 `project_members.role`（迁移 `0015`），成员被移除即失去角色，重新加入从 `MEMBER` 开始；
受影响路由 `authPolicy` 由 `adminSession` 调整为 `session`，角色门禁由 `ProjectRoleGateService`
在同一事务内实时校验，并登记为权限矩阵 `conditional` 条目。新增路由 `setProjectMemberRole`
（Session + CSRF + 数据库幂等，锁序 `["project"]`，审计 `project.member.role.set`，活动 `PROJECT_MEMBER_ROLE_CHANGED`）。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| ADR033-CONTRACT-001 | 契约与 CI | Schema、Route Registry 与生成客户端 | `projectMemberRoleSchema`、`ProjectMemberRecordItem.role`、`ProjectMemberItem.role`、`SetProjectMemberRoleRequest/Response`、`ProjectDetailResponse.currentUserRole` 登记；`setProjectMemberRole` 完整登记策略；`add/remove/archiveModule/restoreModule/listProjectMembers/listProjectMemberUnfinishedTasks` 的 `authPolicy` 由 `adminSession` 调整为 `session`；幂等契约版本按重放字段变化升级 | 本地通过（`contract:drift` 5 产物、`contract:validate` 98 条、`permissions:check` 98/98） |
| ADR033-DB-001 | PostgreSQL | 迁移 0015 列、约束、唯一索引与回填 | `role` 默认 `MEMBER`；`project_members_role_check` 固定枚举；`project_members_one_leader` 保证每项目至多一条 ACTIVE+LEADER；`project_members_removed_role_check` 保证 REMOVED 行 role=MEMBER；创建者活跃成员行回填为 LEADER；`app_runtime` 授权不变 | 本地通过（`db:migrate` 应用 0015；`migrations:check` 16 迁移；`database.test.ts` 不可变清单含 0015；database 单测 15/15、集成 26/26） |
| ADR033-API-001 | API 单元 | 角色门禁与 setRole 编排 | `ProjectRoleGateService.manageRole` 返回 SYSTEM_ADMIN/LEADER/PROJECT_ADMIN/MEMBER/NOT_MEMBER；`roleSetterRole` 把 PROJECT_ADMIN 降级为 MEMBER（不能任命角色）；`setRole` 门禁 NOT_MEMBER→404、MEMBER→403 `PROJECT_MEMBER_ROLE_FORBIDDEN`、LEADER 设 LEADER→403 `PROJECT_MEMBER_LEADER_ASSIGN_FORBIDDEN`、唯一冲突→409 `PROJECT_MEMBER_LEADER_CONFLICT`；移除 LEADER→409 `PROJECT_MEMBER_LEADER_PROTECTED`；读/写路径经 `requireManageRole` | 本地通过（`project-member-management.service.test.ts`、`project-member-management-http.service.test.ts`；API 单测 64 文件 351 例） |
| ADR033-API-002 | HTTP + PostgreSQL | 组长/项目管理员管理成员，跨项目与非成员隐藏 | 组长（非系统管理员）可查看成员列表、添加成员；普通成员管理成员 403 `PROJECT_MEMBER_MANAGE_FORBIDDEN`；非成员/已移除成员统一 404；PROJECT_ADMIN 可管理成员但任命角色 403 `PROJECT_MEMBER_ROLE_FORBIDDEN` | 本地通过（`project-member-management-api.integration.test.ts` 14/14，PostgreSQL 18.6 + PGroonga） |
| ADR033-API-003 | HTTP + PostgreSQL | 角色任命、组长保护、转移与审计 | 组长任命 PROJECT_ADMIN 200 且写审计 `project.member.role.set` + 活动 `PROJECT_MEMBER_ROLE_CHANGED`；组长任命/转移 LEADER 403；移除 LEADER 409；系统管理员转移组长后目标 LEADER、原组长自动降级 MEMBER；非成员/已移除成员 404 | 本地通过（同上集成 14/14） |
| ADR033-API-004 | HTTP + PostgreSQL | 组长归档/恢复模块与普通成员拒绝 | 组长（非系统管理员）可 archiveModule/restoreModule（200，状态/版本推进）；普通成员归档模块 403 `MODULE_MANAGE_FORBIDDEN` | 本地通过（`modules-api.integration.test.ts` 11/11） |
| ADR033-IDEM-001 | HTTP + PostgreSQL | 角色写重放的角色门禁 | 同 Key、同 body 重放返回缓存响应；操作者被降级为普通成员后，新任命 403 `PROJECT_MEMBER_ROLE_FORBIDDEN`，原 Key 重放被重放授权器拒绝 403 `PROJECT_MEMBER_MANAGE_FORBIDDEN`，不泄露已存响应 | 本地通过（`project-member-management-api.integration.test.ts` 重放用例） |
| ADR033-REMOVE-001 | HTTP + PostgreSQL | 移除重置角色（removed_role_check） | 移除 PROJECT_ADMIN/LEADER 成员时同事务把 role 重置为 MEMBER，不触发 `project_members_removed_role_check` 约束；已移除成员的角色不复活 | 本地通过（成员管理集成 + `database.helpers.removeMember` 与 `postgres-projects-write-port.removeMember` 均重置 role） |
| ADR033-UI-001 | 前端单元 | 成员页角色入口与只读视图 | `getProject.currentUserRole` 驱动入口：系统管理员/组长/项目管理员进入管理视图，其余成员进入只读 `ActiveProjectMembers`；成员卡片显示角色徽标；组长/项目管理员显示移除入口（组长行不显示移除）；系统管理员与组长显示「设置角色」，组长仅 MEMBER/PROJECT_ADMIN 可选、系统管理员含 LEADER；`setProjectMemberRole` 经生成客户端携带 CSRF + Idempotency-Key | 本地通过（`ProjectMembersPageView.test.tsx` 6/6、`project-member-query.test.tsx` 5/5、`ModulesPageView.test.tsx` 8/8；Web 76 文件 425 例） |

2026-09-16 本地验证说明：`contract:drift`（5 产物）、`contract:validate`（98 条路由）、
`permissions:check`（98/98）、`lint`、`format:check`、`check:deps`（173 文件/173 模块）、
`check:frontend:boundaries`（248 模块/1160 依赖）、`db:migrations:check`（16 迁移）、
`check:secrets`（1002 文件）、API 单测 64 文件 351 例、Web 单测 76 文件 425 例、
全 workspace typecheck、web/api 生产构建均通过；真实 PostgreSQL 18.6 + PGroonga 下
API 集成 48 文件 444 例、database 单测 15/15 + 集成 26/26 通过。本机 `@node-rs/argon2`
原生模块曾因缺少 VC++ 运行库（`vcruntime140.dll` 等系统目录缺失）无法加载，已在本地
补齐运行库 DLL 后 API 单测/集成全绿；Playwright E2E 与 GitHub Actions 未运行。
推送前已把工作区中与本任务无关的 SSO/ADR-032 回退改动（`AppLayout` 整页跳转、本文件 ADR-032 覆盖行、`开发日志.md` 两条 2026-09-16 条目）恢复为已合并内容，未纳入本批交付。

## F-03 用户管理（A，2026-09-09 本地交付）

阶段 1 A 域用户管理纵切片：`/api/v1/admin/users` 六条路由，覆盖管理员列表、新增、编辑、
启停、启用与强制退出；无新数据库迁移，复用现有 `users`/`user_sessions`/审计与密钥机制。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F03-CONTRACT-001 | 契约与 CI | 六条路由登记 | Schema Registry、Route Registry、Controller 绑定、OpenAPI、Web 客户端与权限矩阵一致；41 条路由全部由 `contract:drift`/`contract:validate`/`permissions:check` 覆盖 | 本地通过（`contract:drift`、`contract:validate`、`permissions:check`，41/41） |
| F03-API-001 | 单元 | HTTP 编排 | `listAdminUsers` 允许管理员、普通用户 403、匿名 401；create 的事务外 Argon2id 哈希、CSRF/幂等键/`If-Match` 传递、失败映射与幂等回放授权回调 | 本地通过（`admin-users-http.test.ts`，API 单测 55 文件 256 例） |
| F03-API-002 | HTTP + PostgreSQL | 完整生命周期 | 管理员创建用户后同 Key 重放不重复；编辑、停用、启用、强退分别递增版本；停用/强退同事务递增 `auth_version` 并撤销 Session；停用后旧 Session 请求 401；五类审计事件齐全；审计失败时创建整体回滚 | 本地通过（`admin-users-api.integration.test.ts`；API 集成 31 文件 152 例，PostgreSQL 18.6 + PGroonga） |
| F03-API-003 | 权限与边界 | 拒绝与保护 | 缺管理员身份 403、缺幂等键 400、非法字段 422、旧版本/状态冲突与自停用/最后一名可用管理员 409（`LAST_ACTIVE_ADMIN_REQUIRED`）；错误响应不泄露 SQL 或约束名；普通成员访问管理页 403 | 本地通过（HTTP 单元、真实 PostgreSQL 与权限矩阵） |
| F03-UI-001 | 前端单元 | 管理页关键交互 | 列表展示、隐藏当前管理员停用/强退入口；新增/编辑携带 CSRF、幂等键和 `If-Match`；写失败后保留同一幂等键；错误文案统一映射 | 本地通过（`admin-user-query.test.tsx` 3 例、`AdminUsersPageView.test.tsx` 5 例；Web 30 文件 87 例） |
| F03-E2E-001 | Playwright | 领域 E2E | 普通成员访问 `/settings` 显示 403；管理员完成新增（首次写携带 CSRF 与幂等键）→ 编辑 → 停用 → 启用 → 强制退出真实 UI 链路 | 本地 18/18 通过（新增 2 例，Playwright 全量含 F-13、MFA、搜索、项目创建等既有用例） |

2026-09-09 本地实际通过（已合并 `origin/main` `8386b29`）：`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、
`pnpm test:unit`（database 5、api-contract 63、web 87、api 256）、`pnpm test:web`（30 文件 87 例）、`pnpm test:integration`（database 13、API 31 文件 152 例）、`pnpm build`、
`pnpm contract:drift`、`pnpm contract:validate`、`pnpm permissions:check`、
`pnpm db:migrations:check`、`pnpm check:deps`、`pnpm check:frontend:boundaries`、
`pnpm check:secrets`、`pnpm check:deploy:test`、`pnpm test:e2e`（18/18）、
公共 registry 的 `pnpm audit --registry=https://registry.npmjs.org --audit-level=high`
（No known vulnerabilities found）。生成客户端已重新生成并通过 `pnpm contract:drift`；
GitHub Actions 已通过（F-03 PR #72，run 34345191090）。

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
| CI-017 | E2E | Playwright 关键路径 | 登录、项目创建（含选择第二成员）到动态/搜索/创建者与成员通知关键路径通过；F-05 成员管理添加/移除与 403 边界通过；任务完成、合并/解除任务组、遗留项转任务、记录作废/恢复等路径已覆盖 | 本地全量 45/45 通过（2026-09-11，5.1 分钟）；CI Browser E2E（默认 Chromium）已在 main 最新运行 [34620173140](https://github.com/256-code/InPulse/actions/runs/34620173140)（`4141e1d`，2026-09-11）50 passed（6.3 分钟），此前 push 运行 [34578707754](https://github.com/256-code/InPulse/actions/runs/34578707754)（`bff1972`）为 45 passed（5.6 分钟）；覆盖 F-03 用户管理、F-05 成员管理、MFA、项目创建、F-12 模块、F-13 功能档案、F-14 功能级任务、F-15 模块级任务、F-16 任务完成与状态闭环、F-17 草稿、F-18 记录发布、F-20 遗留项转任务、F-21 作废/恢复、F-22 外部链接、任务组合并/解除、搜索边界及 F-27/F-28 状态联动；其余完整关键路径 Required |
| CI-018 | CI | 容器镜像与 Compose | 镜像构建成功、`compose config` 渲染通过、全部运行与基础镜像为 exact-tag@sha256 digest、PostgreSQL 18 命名卷挂载 `/var/lib/postgresql`、容器非 root；生产 Dockerfile 与四镜像构建步骤已落库 | 已自动化（[run 34620173140](https://github.com/256-code/InPulse/actions/runs/34620173140) 实际构建 API/migration/web/db-bootstrap/ops 五个生产镜像成功；Compose/ref 预检由 `check:deploy:test` 覆盖；真实镜像 Tag/digest 绑定与签名发布清单仍属发布环节） |
| CI-019 | CI | 镜像扫描 | 运行与基础镜像漏洞扫描无 high 及以上未处置项；CI 已新增 Trivy 扫描步骤（CRITICAL/HIGH、`ignore-unfixed=true`、`exit-code=1`） | 已自动化（[run 34620173140](https://github.com/256-code/InPulse/actions/runs/34620173140) 对五个生产镜像的 Trivy 扫描全部 success，CRITICAL/HIGH 无未处置项；2026-09-13 上游集中公布 Debian 安全更新后同一门禁对 API 镜像报出 2 个 HIGH（`libpcre2-8-0`），已按「固定 digest 基础镜像内刷新 Debian 安全包」修复，见下方「演示数据库版本化种子」章节 §5；修复后 `CI / workspace`（[run 34766854573](https://github.com/256-code/InPulse/actions/runs/34766854573)）**46 步全部 success**，第 29-33 步五个镜像扫描全绿） |

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
> 运行本身其后已执行通过（main `4141e1d` 的 [run 34620173140](https://github.com/256-code/InPulse/actions/runs/34620173140) 全绿）。CI-017 的 Playwright 基座已于 2026-09-09 在本机 8/8 通过，其中项目创建与 MFA 挑战/重认证关键路径已覆盖；F-02 接入 TOTP KEK 环境后再次复跑 8/8，MFA UI 场景已加入；本 PR 的 GitHub Actions 已通过（workspace 10m2s，docs 通过）；CI-018 的 `compose config` 渲染、exact-tag@sha256
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
| AUTHZ-001 | API 集成 | 每条 Route Registry 操作 | 至少一条允许与一条拒绝用例，身份覆盖与[权限矩阵](permissions.md)一致 | 已自动化（`packages/api-contract/test/permissions.test.ts` 扫描需认证路由的允许/拒绝用例并与 Registry 一致，`pnpm permissions:check` 双向校验；CI 已执行） |
| AUTHZ-002 | PostgreSQL 集成 | 跨项目 IDOR | 其他项目成员和已移除成员均得到 404，SQL 不返回目标行 | 已自动化（`features-api.integration.test.ts` 跨项目/已移除成员 404 与 `project-member-management-api.integration.test.ts`；CI 已执行） |
| AUTHZ-003 | Workflow 集成 | 创建项目时取消创建者 | 请求被 Schema/业务规则拒绝；创建者必为初始成员 | 已自动化（`project-bootstrap.integration.test.ts` 创建者同事务写入与仅创建者用例；CI 已执行） |
| AUTHZ-004 | Workflow 集成 | 管理员移除普通成员身份的项目创建者 | ACTIVE 成员记录关闭；`projects.created_by` 值不变；创建者立即失去成员关系派生权限 | 已自动化（`project-member-management-api.integration.test.ts` 移除创建者：`created_by` 不变且权限消失；CI 已执行） |
| AUTHZ-005 | Workflow 集成 | 创建者重新加入 | 新增成员历史，不覆盖之前 `joined_at/removed_at` | Required（2026-09-12 清账核对：未找到「创建者移除后重新加入」的直接用例，保持待补） |
| AUTHZ-006 | API 集成 | 停用用户旧 Session | 所有受保护/业务路由及使用停用凭据的登录统一 401；`issueCsrfToken` 只能按匿名创建无身份预认证状态；同源 `logout` 仅清 Cookie 返回 204；其他用户不受影响 | 已自动化（`user-auth-invalidation.integration.test.ts` 与 `login.integration.test.ts` 停用用户 401 且不签发 Session；CI 已执行） |
| AUTHZ-007 | API 集成 | 项目、模块或功能归档/恢复 | 项目成员为 403；跨项目或已移除成员为 404；管理员须持有当前有效的完整管理员 Session（ADR-031 起不再要求 TOTP 重认证）并写审计 | 已自动化（`features-api.integration.test.ts` 归档/恢复与管理员门禁、`apps/e2e/tests/project-archive.spec.ts`；CI 已执行） |
| AUTHZ-008 | API 集成 | 管理员移除成员 | 缺少完整管理员 Session 或写操作 CSRF 时拒绝；管理员门禁满足时只关闭成员历史并写审计 | 已自动化（`project-member-management-api.integration.test.ts` 管理员门禁与审计用例；CI 已执行） |
| AUTHZ-009 | API 集成 | 作废 PUBLISHED / 恢复 VOID 迭代记录 | 项目成员为 403；管理员须持有当前有效完整管理员 Session、填写原因并写审计 | 已自动化（`record-lifecycle.integration.test.ts` 含管理员门禁与恢复；CI 已执行） |
| AUTHZ-010 | Workflow 集成 | 移除系统管理员身份的项目创建者成员记录 | ACTIVE 成员记录关闭且 `created_by` 不变；其成员权限消失，但全局管理员权限仍可访问项目 | 已自动化（`project-member-management-api.integration.test.ts` 移除系统管理员创建者分支；CI 已执行） |
| AUTHZ-011 | Registry + API 矩阵 | ADR-023 认证安全流程 | 三个 operationId（`issueCsrfToken`/`login`/`logout`）与权限矩阵精确对应（ADR-031 移除 7 条 MFA 路由）；每项覆盖允许、身份拒绝或前置状态拒绝与停用用户；已有认证 Session 调用 `login` 为 409，必须登出后重新建立预认证状态 | 已自动化（`permissions.test.ts` allowlist 精确相等、`validate.test.ts`、`preauth-session.integration.test.ts` 与登录/CSRF 集成；CI 已执行） |
| AUTHZ-012 | API + 投影集成 | VOID 迭代记录可见性 | 活跃成员的详情为 404，搜索及该记录全部既有/新增普通时间线项不返回；管理员可读且只有显式 VOID 搜索筛选才返回；恢复为 PUBLISHED 后成员详情、默认搜索及既有/新增时间线重新可见，Activity 不暴露原因 | 已自动化（`record-lifecycle.integration.test.ts` 搜索与时间线可见性断言；CI 已执行） |

## 幂等、版本与事务

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| IDEMP-001 | Registry CI | POST/PUT/PATCH/DELETE 默认策略 | 默认登记 `idempotencyRequired`；显式豁免同时登记原因并引用对应的 Accepted ADR | 已自动化（`packages/api-contract/test/validate.test.ts` 写方法不得 `none` 与豁免理由校验；CI 已执行） |
| IDEMP-002 | API 集成 | 相同 Key、相同请求重放 | 当前认证、权限及所需高风险管理员门禁（完整管理员 Session 与写操作 CSRF）均通过时只执行一次并重放原状态码和脱敏响应；任一门禁失败则拒绝且不泄露已存响应 | 已自动化（`idempotency-runner.integration.test.ts` 与 `idempotency-runner.test.ts` 重放与门禁用例；CI 已执行） |
| IDEMP-003 | API 集成 | 相同 Key、任一语义输入不同 | body、path 参数、query、Content-Type、适用的 `If-Match` 或 Registry 声明的行为头任一不同均返回 409，不改变业务数据 | 已自动化（`idempotency-http.test.ts` 与 runner 集成用例；CI 已执行） |
| IDEMP-004 | PostgreSQL 并发 | 两连接使用同一 Key | 只有一个业务事务成功执行；后继读取已提交结果 | 已自动化（`idempotency-runner.integration.test.ts` 并发同 Key 用例；CI 已执行） |
| IDEMP-005 | PostgreSQL 并发 | 先行事务回滚 | 幂等占位随事务回滚，后继请求可重新执行 | 已自动化（同上：业务失败回滚 `PENDING` 用例；CI 已执行） |
| IDEMP-006 | API 集成 | 幂等重放前门禁变化 | 权限被移除、用户停用、Session 失效、高风险管理员门禁失效，或结果资源不再可读时均拒绝且不泄露原响应；覆盖创建项目后移除创建者再重放、记录变为 VOID 后普通成员重放；恢复全部门禁后才可按协议重放 | 已自动化（runner 单测与集成：重放授权失败、版本冲突与门禁变化；CI 已执行） |
| IDEMP-007 | API 集成 | 规范化等价请求 | 仅 query 顺序、Header 名大小写或 JSON 成员顺序不同且 Schema 解析结果相同时摘要一致 | 已自动化（`idempotency-http.test.ts`：Header 名大小写与 query 顺序不影响摘要；CI 已执行） |
| IDEMP-008 | Registry CI | 幂等例外 | `securityFlow` operationId 集合与 ADR-023 allowlist 精确相等；每项声明 `idempotencyExceptionAdr`、单次消费机制和客户端恢复路径 | 已自动化（`validate.test.ts` 与 `permissions.test.ts` 的 ADR-023 allowlist 精确相等；CI 已执行） |
| IDEMP-009 | PostgreSQL + 部署集成 | 摘要 HMAC 密钥轮换 | 当前版本由非敏感 selector 选择 `/run/secrets/idempotency_fingerprint_keyring`；缺失/空 keyring fail closed；旧记录在 30 天窗口、部署与恢复后仍可比较，清理后才退役旧 key；普通 SHA-256 不能离线验证低熵凭据 | 已自动化（`idempotency-keyring.test.ts` fail closed 用例；30 天窗口与部署/恢复见审计与恢复章节；CI 已执行） |
| IDEMP-010 | Registry CI + API/数据库集成 | 安全响应重放 | 每个 `idempotencyRequired` 路由的全部 2xx 状态均登记带版本的互斥 `body`/`noBody` 及结果授权策略；body 保存精确 Schema ref 和穷尽安全字段，noBody 保存 false + SQL NULL 且重放无 body/Content-Type；任何响应头不存储或重放；数据库拒绝 SUCCEEDED 缺失/非对象授权上下文 | 已自动化（`idempotency-response-policy.test.ts` 与 `database/test/integration/database.test.ts` 授权上下文 CHECK；CI 已执行） |
| IDEMP-011 | Registry CI + API 集成 | 幂等契约跨部署变化 | 请求 Schema、摘要字段、响应 Schema、安全字段或结果资源授权策略变化必须升级幂等契约版本并进入摘要；旧 Key 在新契约下返回 409，不按旧策略重放 | 已自动化（runner 版本用例与响应策略测试；CI 已执行） |
| IDEMP-012 | API + PostgreSQL 集成 | 业务 4xx 或异常后的占位 | 校验/鉴权失败不插入占位；事务内业务 4xx、5xx 或异常回滚整个事务与 `PENDING` 行，同 Key 后续请求不会永久等待且可重新执行 | 已自动化（`idempotency-runner.integration.test.ts` 业务失败回滚与可重执行；CI 已执行） |
| CONC-001 | PostgreSQL 并发 | 多聚合锁序 | 按任务、任务组、记录、遗留项 ID 升序；变化后有限次从头重试 | 已自动化（`task-completion.integration.test.ts` 锁定并集与有限重试用例；CI 已执行） |
| CONC-002 | API 集成 | If-Match 版本冲突 | 返回 409；无部分更新 | 已自动化（tasks/modules/features 集成测试的 `If-Match` 409 用例；CI 已执行） |
| CONC-003 | PostgreSQL 并发 | 父级归档与子级写入 | 项目/模块/功能归档和代表性的子级 create/edit/publish 按父到子统一锁序串行；不能基于旧 ACTIVE 快照同时提交，且无死锁 | 已自动化（`modules-api.integration.test.ts` 与 `features-api.integration.test.ts` 父级归档锁序用例；CI 已执行） |
| TX-001 | Application / Workflow 集成 | 任一步骤失败 | 业务、审计、该命令契约规定的通知及投影全部回滚 | 已自动化（`task-completion.integration.test.ts`、`tasks-api.integration.test.ts` 与 `record-lifecycle.integration.test.ts` 回滚用例；CI 已执行） |
| STATE-001 | Application + PostgreSQL 集成 | 记录状态与字段不变量 | 只允许 ADR-024 三条迁移；拒绝空白原因、非法状态/字段组合和 MODULE/FEATURE 父级门禁失败；恢复只改 status、row_version、updated_at，其他聚合字段、版本、关联、外链与作废快照不变 | 已自动化（`record-lifecycle.integration.test.ts` 状态与字段不变量用例；CI 已执行） |
| STATE-002 | API + PostgreSQL 并发 | 作废/恢复幂等与竞争 | 当前认证、管理员权限及 5 分钟双时间戳门禁仍通过时，同 Key 同摘要重放原 2xx；否则拒绝且不泄露；双 Key 并发仅一次迁移和审计；父级归档与恢复按同一父到子锁序串行；新 Key 重复操作或 If-Match 冲突为 409 | 已自动化（`record-lifecycle.integration.test.ts` 幂等/并发与 `If-Match` 用例；CI 已执行） |
| STATE-003 | API + 投影集成 | 作废/恢复可见性 | 业务 `status` 是唯一真相；作废同事务把 Search 与该记录全部 Activity 设为 `ADMIN_ONLY/VOID`，成员排除、管理员仅显式 VOID 搜索可见；恢复同键 UPSERT Search、恢复既有 Activity 并追加脱敏恢复事件为 `MEMBER/PUBLISHED`，均不重复、不暴露原因 | 已自动化（`record-lifecycle.integration.test.ts` 投影可见性用例；CI 已执行） |
| STATE-004 | Workflow + PostgreSQL 集成 | 任务与迭代记录一对多 | 一条记录至多关联一个同项目任务；同一任务可关联多条独立记录，完成命令本次最多发布一条但不得被历史记录阻断；按 `(project_id, task_id)` 可索引查询 | 已自动化（`task-completion.integration.test.ts` 历史记录不被阻断用例；CI 已执行） |

## 审计与安全

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| AUDIT-001 | PostgreSQL 并发 | 至少 100 个同 scope 并发业务事务 | 链无分叉、无序号缺口，每个成功业务事件恰有一条审计；见 [ADR-008](adr/ADR-008.md) | 已自动化（阶段 0 数据库层：100 并发事务追加同一项目链；2026-09-09 已在 F-12 `createModule` 真实业务命令上以 100 笔并发事务重跑，序号连续且无分叉，见 MOD-AUDIT-CONC-001） |
| AUDIT-002 | PostgreSQL 并发 | 多 scope 与链头初始化竞争 | 按 UTF-8 scope 顺序加锁，无死锁或重复链头 | Required（2026-09-12 清账核对：未找到多 scope 链头竞争的并发用例，保持待补） |
| AUDIT-003 | PostgreSQL 集成 | 事务回滚 | 业务、审计行与链头同时回滚 | 已自动化（`audit-write.integration.test.ts` 4/4，2026-09-09；CI 已执行） |
| AUDIT-004 | 恢复演练 | 密钥轮换、备份与恢复 | 数据库链、链头、远端检查点和归档明细全部一致 | Required |
| AUDIT-005 | PostgreSQL 集成 | 审计密钥惰性轮换 | keyring 当前版本高于链头时，同一事务先写 `AUDIT_KEY_ROTATED`，再按新密钥写业务事件；旧/新版本均可用各自密钥验证 HMAC，链头版本同步递增 | 已自动化（`audit-write.integration.test.ts` 轮换用例，2026-09-09；CI 已执行） |
| SEC-001 | 权限集成 | 数据库角色 | runtime 无 DDL/原始审计 SELECT；writer 不能改历史；reader 只读 | 已自动化（阶段 0 数据库层，见 CI-008） |
| SEC-002 | 浏览器 E2E + 部署集成 | nonce CSP | 强制模式下核心页面可用，script/style 均无 `unsafe-inline`；生产镜像逐响应签发 nonce，CSP 头与入口 meta/script 标签一致且不复用 | 已自动化（`apps/e2e/tests/csp.spec.ts` 2/2；`scripts/check-web-image-csp.sh` 在真实镜像与 Nginx 上验证 200/308/502/静态资源 7 项断言，2026-09-10；CI 已执行：Browser E2E 50 passed 与 Web 镜像 CSP 校验步骤） |
| SEC-003 | API/浏览器 E2E | CSRF 生命周期 | 首登、轮换、刷新、多标签、过期和“仅未消费状态可最多重签一次”均符合 ADR-015；普通幂等路由保留 Key/If-Match，securityFlow 不发送业务幂等键 | 已自动化（`apps/api/test/csrf-lifecycle.integration.test.ts` 4 例：CSRF 失败不消费、重签后重试一次、单次消费、4 个上限淘汰最旧、Session 与预认证过期恢复、securityFlow 幂等例外；`apps/e2e/tests/csrf.spec.ts` 4 例：首登轮换、刷新、多标签、If-Match/CSRF/幂等键请求头；2026-09-11；CI 已执行） |
| SEC-004 | API 集成 | ExternalLinks | 只接受规范化的 `https://github.com/...`；拒绝 HTTP、用户信息、非默认端口、`api.github.com` 与混淆域名；不配置 Token、不发远程请求；跨项目关联失败且并发不重复 | 已自动化（规范化器 `apps/api/test/github-url.test.ts` 16 例 + 数据库防线 `database/test/integration/external-links.test.ts` 13 例（2026-09-11 补齐项目/功能/记录关联的复合外键用例），2026-09-10；F-22 已交付 HTTP 关联接口并在服务端复用同一规范化器（证据见本文件「F-22 当前 GitHub 关联」章节）；CI 已执行） |
| SEC-005 | API + PostgreSQL 并发/E2E | 一次性认证安全流程 | 登录签发路径显式赋 `AUTHENTICATED` 状态，不得依赖默认值成为完整态；同一 preauth+CSRF 只能成功登录一次；预认证消费、CSRF 轮换与停用/强退的 `auth_version` 失效只在对应条件更新成功时生效；重复 CSRF 签发允许，无效 Session 重复登出为 204；三个 securityFlow operationId（`issueCsrfToken`/`login`/`logout`）的响应丢失均按 ADR-023 路径恢复（enrollment / rotation / TOTP time-step / 恢复码相关单次消费语义已随 ADR-031 删除） | Required（2026-09-15 ADR-031 修订：登录单次消费已有用例（`login.service.test.ts`、`login.integration.test.ts`），其余单次消费语义分散在 SEC-003 与登录/会话用例；ADR-023 现行三个 operationId 逐项真库并发验证与每条响应丢失后的客户端 E2E 恢复路径仍未见完整证据，保持待补） |
| SEC-006 | API 集成 | 未匹配路由的错误契约净化 | 任意未匹配路径返回 `application/json` 的统一 404 `{ code, message, details, requestId }`，message 为固定文案且不回显 method、path 或框架内部文本，响应带 `X-Request-Id` 并保留应用 CSP，不返回框架或 Express 默认 HTML；已匹配路由不受影响；见 [ADR-026](adr/ADR-026.md) | 已自动化（`apps/api/test/http-error-contract.integration.test.ts` 3 例，2026-09-10；修正点在全局异常过滤器本身，未新增 adapter 包装；API 响应的 nosniff/CSP 由生产 Nginx `location /api/v1/` 下发，另见 F09-CSP-*；CI 已执行） |
| SEC-007 | 部署集成 | 数据库 Secret 文件缺失 | 生产模式 fail closed，不得回退到环境变量；缺失路径、越界路径、空值和权限不合规均拒绝连接串构造 | 已自动化（`database/test/unit/config.test.ts` 15 例，2026-09-10；真实 POSIX 权限位需 Linux 环境，Windows 本机不可复现，权限判定在函数级覆盖；compose secret 声明由 `check:deploy` 校验；CI 已执行） |
| SEC-008 | API + PostgreSQL 集成 | 登录爆破限流 | 登录失败按账号 + IP + 全局三层计数，任一桶达到候选阈值返回 429 并在 Argon2 前阻断；同一进程 Argon2 并发不超过候选上限；登录成功清除账号失败计数；桶维度只保存 HMAC-SHA-256 摘要 | 已自动化（单元与真实 PostgreSQL 用例已落库；CI 已执行） |
| SEC-009 | Application + PostgreSQL 集成 | 用户停用/改密/强退 Session 失效 | 同一事务递增 `users.auth_version`（并推进 `row_version`）后撤销该用户全部未撤销 Session；旧 Session 在下一请求因 `auth_version` 不一致或已撤销而返回 401 | 已自动化（单元与真实 PostgreSQL 用例已落库；CI 已执行） |
| SEC-010 | API + PostgreSQL 集成 | ~~管理员 MFA 注册（F-02.1）~~（2026-09-15 随 ADR-031 移除，实现与用例已删除，保留历史） | 管理员登录后显式签发 `MFA_ENROLLMENT`；`start` 按 user → factor → Session 锁序条件创建/替换 pending；`confirm` 在同一事务条件激活因子、签发 Argon2id 恢复码哈希、撤销受限 Session 并轮换为 `AUTHENTICATED` Session/新 CSRF；错误验证码不启用因子且写入持久化 MFA 限流；start-vs-start、start-vs-confirm、跨 Session 与同一 TOTP time-step 并发只有一个 2xx；数据库不保存 TOTP Secret、恢复码明文 | 已自动化到本地（API 单元 47 文件 224 例，真实 PostgreSQL 集成 26 文件 118 例，数据库单测 5 例与集成 13 例；`pnpm check` 全绿；Playwright 16/16；GitHub Actions 已通过，PR #63） |
| SEC-011 | API + PostgreSQL 集成 | ~~管理员 MFA 验证（F-02.2）~~（2026-09-15 随 ADR-031 移除，实现与用例已删除，保留历史） | 管理员登录后显式签发 `MFA_CHALLENGE`；`POST /auth/mfa/verify` 仅接受当前 time-step ±1 且未接受过的 TOTP；按 user → factor → Session 锁序条件验证；格式错误 422、CSRF 错误 401、非管理员 403、状态或验证码并发冲突 409；成功后同一事务将 Session 条件升级为 `AUTHENTICATED`、更新 `last_accepted_step` 并签发新 CSRF；错误验证码写入用户/IP/全局持久化限流，达到阈值 429；跨 Session 同一步长并发仅一个 2xx，通用幂等与日志不保存 TOTP/CSRF 明文 | 已自动化到本地（API 单元 47 文件 224 例，真实 PostgreSQL 集成 26 文件 118 例；`pnpm check` 全绿；Playwright 16/16；GitHub Actions 已通过，PR #63） |
| SEC-012 | API + PostgreSQL 集成 | ~~管理员高风险重认证（F-02.3）~~（2026-09-15 随 ADR-031 移除，实现与用例已删除，保留历史） | 完整管理员 Session + 密码 + 当前 TOTP time-step ±1 且未使用；同一事务原子刷新 `reauthenticated_at` 与 `mfa_verified_at` 并递增 rotation generation；错误密码/验证码返回 401 且不刷新时间戳，分别写登录/MFA 限流；MFA_CHALLENGE 受限 Session 403；同一 time-step 重放 401；达到 MFA 阈值 429 | 已自动化到本地（Controller 5 例；真实 PostgreSQL 6 例；`pnpm check` 全绿；Playwright 16/16；GitHub Actions 已通过，PR #63） |
| SEC-013 | API + PostgreSQL 集成 | ~~管理员恢复码（F-02.4）~~（2026-09-15 随 ADR-031 移除，实现与用例已删除，保留历史） | 轮换要求完整管理员 Session 且 5 分钟内完成双因子重认证，原子消费一次性 rotation generation、失效旧 Hash 并只返回一次新码；消费仅接受 `RECOVERY_CHALLENGE` 且密码阶段已成功，原子消费恢复码、失效旧代码集并升级为完整 Session；同一 rotation generation 或恢复码并发只有一个 2xx；错误恢复码 401 并写限流；非管理员 403 | 已自动化到本地（Controller 5 例；真实 PostgreSQL 6 例；`pnpm check` 全绿；Playwright 16/16；GitHub Actions 已通过，PR #63） |
| SEC-014 | API + PostgreSQL 集成 | ~~管理员 MFA 重置（F-02.5）~~（2026-09-15 随 ADR-031 移除，实现与用例已删除，保留历史） | 仅另一名完成 5 分钟双因子重认证的 ACTIVE 系统管理员可执行；目标必须是另一名 ACTIVE 且已启用 TOTP 的系统管理员，可用 MFA 管理员数必须大于 1；同一事务禁用目标因子、失效恢复码、递增 auth_version、撤销目标全部 Session 并写审计；自重置/仅剩一名 MFA 管理员返回 409，非管理员目标 403，缺少重认证 403；两个管理员互相重置时只有一个成功且至少保留一名 MFA 管理员 | 已自动化到本地（Controller 9 例；真实 PostgreSQL 6 例；`pnpm check` 全绿；Playwright 16/16；GitHub Actions 已通过，PR #63） |
| SEC-016 | API 单元 | 单点登录配置 fail closed（ADR-032） | `ssoEnabled` 只认真值；未启用时 `loadSsoConfig` 既不返回配置也不报错；启用后缺 issuer/client id/Secret 文件、issuer 非 https、回调地址不是 `/api/v1/auth/sso/callback` 或带查询串、Secret 文件不在 `/run/secrets/` 下、为空或不可读时返回分类原因且不返回配置；错误信息不回显 Secret 内容 | 已本地通过（`apps/api/test/sso.config.test.ts` 9 例，2026-09-15） |
| SEC-017 | API 单元 | id_token 验签与 JWKS 轮换 | RS256 签名与 `iss`/`aud`（含数组）/`exp`/`nbf`/`iat`/`nonce` 逐项校验；只提取 `subject/loginName/displayName/email`，Casdoor 的 `isAdmin` 等 claim 被丢弃；非 RS256、篡改载荷、未知 kid、非 JWT 一律 `SsoProtocolError`；kid 未命中时强制刷新一次 JWKS；discovery 结果按 TTL 缓存，issuer 不一致或端点非 https 时拒绝 | 已本地通过（`apps/api/test/sso-oidc.client.test.ts` 13 例，2026-09-15） |
| SEC-018 | API + PostgreSQL 集成 | 单点登录纵切片（桩 IdP） | start 只落库 state 的 HMAC 与 key version 并下发 `__Host-sso-state`；回调必须同时匹配 URL state 与 Cookie（缺失或不同即 `state-mismatch`）后一次性消费；JIT 开通写 `sso_subject`、`password_hash=NULL`、`is_admin=false`，二次登录按 subject 命中并同步展示名/邮箱；仅当登录名命中且邮箱一致才绑定，邮箱不一致或被占用为 `account-conflict`；停用账号 `account-disabled`；重放 `state-consumed`、过期 `state-expired`、未知 state `state-invalid`、nonce 不符 `token-invalid`、IdP 返回 error 为 `idp-error`；成功签发 `AUTHENTICATED` 会话（空闲 1800s、绝对 7 天、只存 Hash）并写 `auth.sso_account_provisioned`/`auth.sso_account_linked`/`auth.sso_login` 审计 | 已本地通过（`apps/api/test/sso-login.integration.test.ts` 13 例，真实 PostgreSQL + 桩 IdP，2026-09-15） |
| SEC-019 | API 单元 | SSO 302 导航与回落目标 | 未启用时 `start` 302 到 `/login?local=1&sso=disabled` 并保留规范化后的站内 `from`，外部地址被丢弃；启用时 302 携带 `Location`、`no-store` 与 state Cookie（HttpOnly/Secure/SameSite=Lax/Path=/）；成功回调同时下发清理 state 与 `__Host-session`；内部异常统一 302 到 `/login?sso_error=internal` 且不泄露内部原因 | 已本地通过（`sso.controller.test.ts` 6 例、`sso-return-to.test.ts` 6 例、`session-ttl.policy.test.ts` 3 例，2026-09-15） |
| SEC-020 | API + PostgreSQL 集成 | 无口令账号的本地登录 | SSO JIT 账号 `password_hash` 为 NULL 时，`PasswordService.verify` 对 `null`/`undefined`/非 Argon2id 编码一律走等时占位校验并返回 false（不抛错、不 500），`UserCredential.passwordHash` 允许为空，隐藏口令入口对这类账号必然 401 | 已本地通过（`sso-login.integration.test.ts` 内断言 + `apps/api/test/password.service.test.ts`，2026-09-15） |
| SEC-015 | PostgreSQL 集成 | Session 分批清理（F-01） | 按主键分批删除已撤销超过 30 天或绝对过期超过 7 天的 `user_sessions`、过期 `session_csrf_tokens` 以及过期/已消费 `preauth_sessions`；单事务内有限批次数、`FOR UPDATE SKIP LOCKED`，活跃 Session/CSRF/预认证 Session 保留 | 已自动化（`session-cleanup.integration.test.ts` 2 例，2026-09-09；CI 已执行） |

## 搜索、部署与恢复

| ID | 阶段 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| SEARCH-001 | 阶段 0 | 中文/标识符可行性金标 | ≥1,000 投影、≥100 查询、Recall@20 ≥90%，目标查询使用 PGroonga `pgroonga_text_full_text_search_ops_v2`，普通输入经 `pgroonga_query_escape`，跨项目 0 条 | 已自动化（`apps/api/test/search-query.integration.test.ts` 冻结 200 条金标与 Recall@20 ≥ 90% 断言（≥180/200）；101000 行规模、Recall 189/190 与容量证据见 SEARCH-002 与 A-5 章节，CI 已执行） |
| SEARCH-002 | 阶段 4 | 峰值容量 | ≥100,000 且 ≥五年峰值 1.2 倍；30 并发 10 分钟；预热 P95 <500ms/P99 <1s | 本地通过（2026-09-11：101000 行规模表、30 并发 × 600.8s、2,362,344 次 SQL、0 错误、P95 10.171ms / P99 13.284ms、Recall@20 189/190、行级跨项目越界 0、冷缓存 30 条单独记录；证据 [`pgroonga-capacity-report.json`](../database/poc/search-pgroonga/artifacts/pgroonga-capacity-report.json) 与本文件 A-5 章节；该门禁不进入 CI；5 年峰值模型未在设计中定稿，1.2 倍条件以上界形式记录） |
| SEARCH-003 | 阶段 0 | `GET /api/v1/search` API 契约纵切片 | Schema Registry、Route Registry、权限矩阵与 Controller 绑定一致；生成 OpenAPI 与客户端无漂移；`q/cursor/limit/includeVoid` 边界、`SearchItem` 判别字段、`SearchPage` 的 `items/nextCursor/hasMore` envelope、不透明游标的 HMAC 签名/篡改/过期/绑定验证与 `422` 映射由单元测试覆盖；真实 PostgreSQL 分页继续验证签名游标可用 | 已自动化（契约、游标、Controller 单测和真实 HTTP API 集成测试已落库；前端搜索页面单测已本地覆盖；Playwright E2E 已本地覆盖 13/13（跨项目隔离、空态、签名游标分页与中文短词/特殊标识符）；PR #68 CI 已通过（workspace 10m14s，docs 通过）） |
| SEARCH-004 | 阶段 0 | `SearchProjectionWritePort` | 显式接收同一 `TransactionContext`，规范化 `rawText` 后 upsert；同一 `(project_id,entity_type,entity_id)` 不重复；更新可同步 `visibility_scope/source_status/source_row_version`；旧 `source_row_version` 不覆盖较新状态；后续业务异常整体回滚 | 已自动化（`SearchProjectionModule` 注入单测 + 真实 PostgreSQL 4 例已本地通过；CI 已执行） |
| SEARCH-005 | 阶段 0 | 搜索结果「遗留问题」独立分类（F-26） | 迁移 `0006` 允许 `LEFTOVER` 投影；记录发布/修订、作废/恢复与遗留项转任务在同一事务内按最新版本快照刷新投影；`entityId` 为遗留项 ID、title 至多 500 字符、`summary` 标注处置状态与来源记录、可见性跟随父记录（PUBLISHED=MEMBER、VOID=ADMIN_ONLY）、`sourceStatus` 为遗留项状态；`GET /api/v1/search` 返回 `entityType: "LEFTOVER"` 且前端以「遗留问题」分组呈现，不再依赖父记录 rawText 命中 | 已自动化（真实 PostgreSQL 集成：`record-publication` 12 例、`record-lifecycle` 22 例、`search-api` 9 例含 LEFTOVER 分类命中与跨项目隔离；全量 API 集成 47 文件 408 例、Web 单测 58 文件 249 例、Playwright E2E 43/43，2026-09-11；CI 已执行） |

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
> 因本地 npm 镜像无 audit endpoint，改用公共 registry 验证为无漏洞。GitHub Actions 已执行（该批随 PR #68 的 CI 通过，run 34332842506）。
>
> 2026-09-11 阶段 4 金标扩集（C-5）：冻结金标 100→200，`GOLDEN_QUERY_VERSION=phase4-v1`（190 normal + 7 no-result + 3 edge），`assertGoldenQueryShape` 与 `apps/api/test/search-query.integration.test.ts` 召回断言同步 200 / ≥180（真实 PostgreSQL 通过）。PGroonga PoC 全流程重跑退出码 0：10 策略 `error=null`；default/bigram/ngram 系 base 1000 / scale 101000 均 190/190；`regexp-query` 182/190 仅诊断；升级 `0000-0002` → `0003-0006`（3 applied / 4 already present）；三份 artifact（`pgroonga-poc-v3` / `pgroonga-migration-v3` / `pgroonga-backup-restore-v2`）已重新生成。

| DEPLOY-001 | 阶段 0 | 空库迁移与角色 | 独立迁移任务成功，应用启动不迁移，runtime 无 DDL | 部分自动化（空库迁移与 runtime DDL 见 CI-007/CI-008；`apps/api` 启动不迁移尚无断言） |
| DEPLOY-002 | 上线前 | 可复现镜像 | 精确 Tag 与 digest、一致 lockfile、非 root 运行、健康检查通过 | Required |
| BACKUP-001 | 阶段 1（本地） | 备份角色授权与数据排除清单 | 迁移 0014 后 `app_backup` 对 `app.sso_login_attempts` 有表级 SELECT 与序列只读授权、无写权限；`pg_dump` 对 dump 范围全表成功，`--exclude-table-data` 覆盖四张表，恢复后会话表与一次性登录材料表为空、业务行与迁移记录存在；清单写入签名 manifest 的 `excludedTableData` | 已本地通过（2026-09-15：数据库集成 26 例、ops 集成 2 文件 7 例，真实 PostgreSQL + 真实 pg_dump/pg_restore） |
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
| FE-007 | 单元测试 | 真实认证上下文与登录表单 | `AuthProvider` 覆盖挂载恢复会话、匿名 CSRF bootstrap、登录、登出与匿名态；`LoginForm` 覆盖失败提示与成功回调 | 已自动化（本地前端 25 文件 63 例；PR #63 CI 已通过；覆盖已随 ADR-031 更新为不含 MFA 用例） |

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
| FE-011 | 单元测试 + Playwright E2E | ~~前端 MFA 注册、验证、恢复码与管理员重认证~~（2026-09-15 随 ADR-031 移除，实现与用例已删除，保留历史） | `AuthProvider` 保留受限 MFA Session，并在注册/验证/恢复码成功后轮换 CSRF Token；`LoginForm` 按安全文案映射 401/403/409/422/429；管理员账户菜单弹窗输入管理员密码与当前 TOTP 完成重认证；E2E 使用真实 TOTP 完成登录挑战与重认证 | 本地通过（Web 25 文件 63 例；Playwright 16/16；PR #63 CI 已通过） |
| CONTRACT-001 | 契约与权限 | F-27/F-28 与用户目录路由登记 | 16 条 Route Registry 与 Schema、OpenAPI、生成客户端、Controller 扫描、权限矩阵一一对应；`contract:drift`、`contract:validate`、`permissions:check` 均通过 | 本地通过；PR #63 CI 已通过 |

后端本阶段 F-27/F-28 与用户目录相关的真实 PostgreSQL 集成共 89 例（22 文件）；前端本阶段搜索、活动、通知、项目创建、视觉迁移与 MFA 认证相关单测共 63 例（25 文件）。F-04 项目创建 Workflow 已接入活动、通知与搜索投影；任务完成、记录作废/恢复、合并等业务 Workflow 尚未接入活动/通知写端口，因此这些业务事件尚未在生产侧生成（本地时点；2026-09-12 回填：此后任务域创建/编辑/状态流转、记录作废/恢复、任务组合并与解除、外部链接和遗留项转任务等已陆续接入活动/通知写端口，实现见 apps/api/src/modules/tasks/tasks-management.service.ts、apps/api/src/modules/change-records/record-lifecycle.service.ts、apps/api/src/modules/task-groups/task-groups.service.ts 与 apps/api/src/workflows/external-link.workflow.ts、apps/api/src/workflows/leftover-task.workflow.ts）。
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

本节记录镜像闭环门禁的落库与验证状态；2026-09-12 回填：五个生产镜像（API/migration/web/db-bootstrap/ops）已由 main `4141e1d` 的 CI（[run 34620173140](https://github.com/256-code/InPulse/actions/runs/34620173140)）实际构建并完成 Trivy 扫描；真实镜像 Tag/digest 绑定与签名发布清单仍属发布环节。

| 场景 | 自动化入口 | 验证状态 |
|---|---|---|
| 四个生产 Dockerfile 存在且每个 `FROM` 固定 `@sha256:<64hex>`；API/Web/Migration runtime 为数值非 root `USER`；Web 内置 `nginx.conf`；API 内置 `healthcheck.mjs` | `scripts/check_deploy_refs.mjs`（经 `pnpm check:deploy:test`） | 本地通过；`.env.deploy.example` 占位符负例被拒绝 |
| Compose 稳态拓扑渲染、`exact-tag@sha256` 格式、PostgreSQL 18 命名卷挂载、非 root/只读、独立迁移、健康检查、仅 Nginx 暴露 8080/8443 | `pnpm check:deploy:test` | 本地通过 |
| 每个服务级 secret 使用长语法且 `mode=0400`、`uid/gid` 与容器数值 user 一致、`target` 为 `/run/secrets` 直接子项 | `scripts/check_deploy_refs.mjs`（经 `pnpm check:deploy:test`） | 本地通过；短语法负例被拒绝 |
| API/Migration runtime 不保留基础镜像自带 npm/corepack | `scripts/check_deploy_refs.mjs`（经 `pnpm check:deploy:test`） | 本地通过（新增回归校验） |
| DB-bootstrap runtime 不保留官方 `gosu` 并升级 Debian OpenSSL 安全补丁 | `scripts/check_deploy_refs.mjs`（经 `pnpm check:deploy:test`） | 本地通过（新增回归校验） |
| 生产 API/Migration/Web/DB-bootstrap 镜像构建 | `CI / workspace` 新增 Build production * image 步骤 | CI 已通过（[run 34620173140](https://github.com/256-code/InPulse/actions/runs/34620173140) 构建 API/migration/web/db-bootstrap/ops 五个镜像成功，2026-09-11） |
| 生产镜像漏洞扫描 | `CI / workspace` 新增 Trivy 扫描步骤（CRITICAL/HIGH、`ignore-unfixed=true`、`exit-code=1`） | CI 已通过（[run 34620173140](https://github.com/256-code/InPulse/actions/runs/34620173140) 对五个镜像的扫描全部 success；此前的 API npm HIGH 与 DB-bootstrap `gosu`/OpenSSL HIGH/CRITICAL 已按 ADR-017 修复） |

本机当时未运行 Docker；镜像构建与扫描现已由 CI [run 34620173140](https://github.com/256-code/InPulse/actions/runs/34620173140) 实际执行通过（五个镜像构建与扫描全部 success）。真实 Tag/digest 绑定与签名发布仍属发布环节。

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
| F13-008 | Edge E2E | 模块入口→创建→详情→双页面冲突→刷新持久化；真实管理员登录→归档→成员只读→恢复 | `features.spec.ts` 2/2，最终合跑 34.7 秒；本机 Edge，非默认 Chromium/CI |

契约生成/漂移 5 个产物及 35 路由完整性通过；API/依赖包为 E2E 必要局部编译，API 测试/Web/E2E 局部类型检查通过。未执行全量构建、全仓静态检查、无关审计、全量测试及 GitHub Actions（本地交审时点；F-13 随后由 PR #70 合入，CI 已通过 run 34335321993）。未新增迁移；现有数据库约束与触发器未削弱。

## F-14 功能级任务（B，2026-09-09 本地交审）

PR #71 交付增量：features/mfa 的管理员 E2E 改用每用例/重试独立的 test-scoped 管理员和真实 API 注册因子，避免共享 `last_accepted_step`。生产认证行为及 UI 断言不变。交付独享库上修复前顺序 3/3，修复后两轮顺序 6/6（Edge），四个独立管理员、清理后 Session/因子为 0；未声称复现 CI 原失败，修复版 Chromium/完整 CI 待执行（本地时点；F-14 随后由 PR #71 合入，CI 已通过 run 34342585945），详见 [交审说明](f14-local-handoff.md#pr-71-交付增量mfa-测试隔离)。

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

首轮来源 fixture 的优先级误写 MEDIUM 导致约束拒绝，改为基线 NORMAL 后通过；首次启动测试未提供 TEST_DATABASE_URL 而 fail closed，配置后执行。首轮浏览器 FEATURE 返回链接多 `/tasks` 导致 404（合跑 4/5），修复后草稿三路径全部通过，未降低断言。未运行本批 CI/默认 Chromium、全量本地构建/测试/静态审计（本地时点；F-17 随后由 PR #79 合入，CI 已通过 run 34430811569）；F-18/F-19 尚未交付。详细复核入口见 [F-17 交审说明](f17-local-handoff.md)。

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

已通过受影响 API/契约编译及 API 测试/Web/E2E 局部类型检查。首次无遗留项 HTTP 发布因幂等安全字段遗漏 null 分支返回 500，补全后回归通过；未弱化测试。首次 Edge 期间生成客户端引发 Vite 热更新鉴权上下文错误日志，业务 2/2；停止源文件改动后的五路径合跑无该错误。未执行本批 CI、默认 Chromium、全仓静态/构建/测试/审计（本地时点；F-18 随后由 PR #82 合入，CI 已通过 run 34443392933）；F-19/F-20 入口未交付。完整命令、人工确认口径与风险见 [F-18 交审说明](f18-local-handoff.md)。

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

API/契约仅作 E2E 所需编译，API 测试/Web/E2E 局部类型检查通过。必要跨域检查 466 源文件无循环/越界，前端144模块边界通过。F16–F19浏览器四文件最终合跑 10/10（2.0分钟），详见 [F-19 交审说明](f19-local-handoff.md)。首轮草稿返回详情的测试 URL 缺 taskId 导致超时；F17旧按钮/提示入口断言在首次合跑两例失败，已同步当前实际流程及保留草稿直达，不降低保存草稿后任务仍待办、历史仍一条的业务断言。未运行全仓静态/构建/测试/无关审计、默认Chromium或本批CI（本地时点；F-19 随后由 PR #85 合入，CI 已通过 run 34449977136）；F20/F21入口未实现。

F-19 旧状态 API 兼容回归：两范围旧 COMPLETE 的响应与相关作者通知、原草稿不变；MAIN/ACTIVE SOURCE 成功、HISTORICAL 当前执行与变更后重放拒绝；旧 1.0.0 Key 在 2.0.0 下 409；REOPEN/CANCEL/RESTORE 及同 Key 重放保持原 DTO；新旧完成竞态仅一条成功、通知故障全部回滚。新增 task-completion 真库 30/30；原 tasks-api 41/41（测试模块同步实际兼容 Controller，原断言保留）。契约五文件 46/46，指纹保留 1.0.0 并追加 2.0.0。
## F-20 遗留项转换定向验证（2026-09-10）

新增leftover-task.integration.test.ts 21例，覆盖两范围成功/原文与版本不变/双向来源；MODULE混合及全归档影响继承；版本/ID/成员/伪造输入；三层真实父级归档；7种不同阶段故障整体回滚；HTTP同Key重放/不同Key并发唯一/当前撤权与已有任务引用保护；CONVERTED修订/清空/回填稳定链接和重放；ACTIVE解决/回填同ID；两范围归档锁等待及功能先于记录的锁序；预览与任务来源GET隔离。与record-publication、published-records、tasks-api真库四文件82/82。

ConvertLeftoverTask/PublishedRecordsView/TasksPanel前三端回归13/13，含未确定失败同Key重试、409显式最新预览确认、刷新再次失败仍阻止旧提交；契约leftover-task/published-records/permissions/validate 41/41，83条路由/权限及5生成物漂移通过。现有CSP build+preview Edge F20三例+F18两例5/5（51.3秒）；浏览器之后的刷新失败状态强化由Web回归验证，未重复E2E。完整21场景、实际命令及失败修复见[F-20交审说明](f20-local-handoff.md)。未声称本批GitHubCI、全仓静态/全量构建或无关审计通过（本地时点；F-20 随后由 PR #88 合入，CI 已通过 run 34456720227）。

F-20截止时间审核增量：ConvertLeftoverTask单文件4/4，覆盖本地时间→UTC、失败/409保留、同Key与改时间换Key、清空null和非法日期；现有FEATURE Edge增加截止时间落库回显检查，单例1/1（16.1秒）。本次仅前端增量，未重复真库/契约或扩大E2E范围。

## F-21 记录生命周期定向验证（2026-09-10）

| 验收点 | 自动化入口 |
| --- | --- |
| STATE-001：两轮作废恢复、行版本递增、最近快照与版本/遗留原文不变、CONVERTED 原任务链接和来源 TODO 保留 | record-lifecycle.integration.test.ts |
| STATE-002：双时间戳过期、同 Key 安全重放/不同原因409、不同 Key 竞争与同 Key 并发、项目/模块/功能归档实际锁等待、恢复投影提交前阻塞归档 | 同上，真实 PostgreSQL + Nest HTTP |
| STATE-003 / AUTHZ-012：成员 VOID 详情和版本404、管理员 VOID 列表/详情/全部版本、恢复保留快照但成员 DTO 无原因；默认搜索排除 VOID、管理员显式筛选返回、既有/新增 Activity 恢复 | 同上，实际 SearchQueryService / ActivityQueryService |
| 副作用故障：审计、活动可见性更新、追加活动、Search UPSERT 任一失败整体回滚 | 同上 |
| 前端原因必填、If-Match、失败保留原因/Key、409加载最新状态后再次明确确认、管理员门禁入口 | RecordLifecycleButton.test.tsx |
| 管理员真实登录→作废→VOID发现/历史→恢复→成员旧版本与搜索重新可读 | record-lifecycle.spec.ts |

数量、实际运行结果与首轮失败修复记录以 [F-21 交审说明](f21-local-handoff.md) 为准；未执行全仓静态检查、额外全量构建或本批 GitHub CI（本地时点；F-21 随后由 PR #91 合入，CI 已通过 run 34462058350）。

F-21父审核增量：RecordLifecycleButton新增409→刷新500→关闭重开→再次网络失败→刷新成功→显式确认新版本/Key回归，先红后绿，单文件4/4（3.04秒）；独立needsRefresh只有成功加载才解除，失败/关窗不能启用旧提交。父协调独立真库22/22、契约四文件42/42，数据库已再次核对目录后停库。详见F21交审增量，未重复数据库/E2E/构建。

F-21 组件侧修复增量（2026-09-11，issue #94）：RecordLifecycleButton 的确认按钮此前由 busy 驱动 antd loading，`useDelayState` 复位窗口内 `ant-btn-loading` 类仍保留（按钮此时已 enabled），而 antd `handleClick` 以 `innerLoading` 提前 return 静默吞掉点击；同一窗口内 loading 图标还把可访问名拼成「loading 确认作废记录」。修复：确认按钮显式设置固定 aria-label（记录动作名），可访问名不再随 loading 漂移；测试新增确定性回归 keeps the confirm accessible name stable while a reload is pending（手动挂起 reload Promise），修复前确定性红灯（TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "确认作废记录"），并把 8 处确认点击统一经 clickConfirm 等待 loading 类消失后再点击。证据：单文件 5/5 连续 30 次运行 0 失败；反事实（临时换回 HEAD 组件）确定性红灯后还原；`pnpm --filter @inpulse/web test:unit` 58 文件 248 例，`pnpm typecheck`（6 项目）、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`（193 模块 870 依赖）、`pnpm check:docs`（70 个 Markdown）与 `pnpm check:secrets`（844 文件）通过。未放宽断言、未 skip；未运行 `pnpm test:e2e` 与集成/数据库测试（无后端与行为变化，E2E 由 CI 覆盖；PR #100 的 CI 已通过 run 34525398751）。

## F-22 当前 GitHub 关联（2026-09-10 本地实施）

| 验收范围 | 自动化与实际结果 |
| --- | --- |
| 四目标CRUD/真实归属/If-Match/重复与幂等/跨项目/会话与成员/URL安全/Release OTHER映射 | external-links.integration.test.ts 共33条中的对应场景；全部通过 |
| 真实父级归档锁等待、4类目标异Key并发、添加/解除各3种副作用回滚 | 同一真库文件；未用Mock Repository替代锁/约束/事务 |
| 原始来源任务merge关联保留、正式不可变版本/遗留快照不变、VOID普通成员404/管理员只读/恢复和后续修订链接搜索 | 同一真库文件；与F21/F18相邻回归合计71/71 |
| 正文+URL容量、添加/后续修订安全422/整体回滚/解除释放容量 | 同一真库文件；超限红测曾返回500，修复后校验具体错误code |
| 前端未知失败同Key、409刷新失败与关闭重开不绕过、相邻五页面 | ExternalLinksPanel等5文件27/27 |
| 真实UI四类目标、多链接、Release/重复/危险host、刷新/解除、新窗口属性、草稿到发布/修订/旧版本/搜索 | external-links.spec.ts Edge最终2/2（23.2秒） |

URL/搜索模块单元17/17，契约三文件39/39；89路由/89权限/5生成物漂移通过，48个变更源码Prettier API check与局部类型通过。此前SEC-004条目的“外部链接HTTP未交付”属于旧阶段记录，本补充提供本批实际交付证据。未运行本批GitHub CI、全仓静态、全量测试或额外全量构建（本地时点；F-22 随后由 PR #93 合入，CI 已通过 run 34471109176）；详细失败历史/命令/端口见 [F-22 交审说明](f22-local-handoff.md)。

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
| F-29 指标与数据源：4 项指标卡（未完成任务/迭代记录/遗留问题来自 adapter，成员数来自项目端口 memberCount）、mock 指标口径、迭代按发布时间倒序、项目 id 在契约冻结前不参与过滤；2026-09-14 按用户确认，活跃模块与活跃功能从展示层取消（R-2 服务端口径与适配器返回值不变，页面不渲染对应卡片） | `ProjectOverviewPageView.test.tsx`（含「不再渲染活跃模块/活跃功能」反向断言）、`project-overview-mock.test.ts` 3 例 |
| F-29 交互与容错：最近迭代行与「查看全部」进入记录页、遗留问题行与「进入遗留问题」进入问题页、空态、adapter 错误态、项目错误重试 | `ProjectOverviewPageView.test.tsx` 7 例 |
| F-29 页面层：按路由 projectId 读取项目与概览、非法 projectId 错误态、遗留问题跳转、返回项目列表 | `ProjectOverviewPage.test.tsx` 4 例 |

本地实际执行：`pnpm --filter @inpulse/web exec vitest run src/features/project-overview src/pages/project-overview` 3 文件 14/14；`pnpm --filter @inpulse/web test:unit` 48 文件 195/195；`pnpm --filter @inpulse/web typecheck`、`pnpm --filter @inpulse/web build`、变更目录 ESLint 与 `pnpm check:frontend:boundaries`（167 模块）通过；2026-09-10 截图对比迁移后重跑定向 `src/features/my-tasks src/features/project-overview src/pages/tasks` 6 文件 45/45、`pnpm lint` 与 `pnpm format:check` 通过。rebase 到 `origin/main` `5087f0a` 后重跑上述门禁：`pnpm --filter @inpulse/web test:unit` 49 文件 199/199（含主线 F-21 新增用例）、`pnpm check:frontend:boundaries`（169 模块 753 依赖）、`pnpm check:docs`（68 个 Markdown）、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`（6 项目）与 `pnpm --filter @inpulse/web build` 通过。未运行 API/集成/数据库测试（无后端改动）、`pnpm test:e2e`（骨架路由尚无 E2E）与 GitHub Actions（PR #92 的 CI 后续已通过，run 34473214899）。骨架数据不代表已实现能力；F-32 补充字段（priority/dueAt/completedAt/description/creatorId）与 F-29 统计口径等待 A 对 C 域提案的裁定。


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
| F-32 关键路径：在 fixture 项目经真实 UI 创建功能并把任务指派给当前用户后，`/tasks` 默认「我负责的 + 未完成」返回该任务（卡片含负责人、不显示无契约来源的优先级徽章）；开发期「接口说明」黄条按设计师稿 `task-center.tsx` 移除，断言 `task-center-mock-notice` 计数为 0；统计卡 `stat-my-open` 为「—」；搜索任务 / 优先级 / 「我创建的」按契约缺口禁用；F-30 URL 状态 `status=done`、`view=list`、`more=1` 写回地址栏；「遗留问题」入口跳转 `/issues` | `apps/e2e/tests/aggregate-views.spec.ts` 例 1；定向 `playwright test aggregate-views` 2/2；落库当时全量 `pnpm test:e2e` 42/42；`接口说明` 断言于 2026-09-12 前端大改后改为计数 0（见文末「前端交互大改」条目） |
| F-29 关键路径：`/projects/{projectId}/overview` 标题为服务端项目名、成员数为服务端真实值且 > 0、任务/记录/遗留三项以数字形态渲染、已取消的 `overview-metric-modules` 与 `overview-metric-features` 计数为 0、最近迭代与待处理遗留问题面板及空态；「查看全部」→ `/records?view=published&projectId=`、「查看模块」→ 模块页、「全部项目」→ `/projects` | `apps/e2e/tests/aggregate-views.spec.ts` 例 2；同上 |
| fixture 扩展：`global-setup` 把 fixture 项目名以 `projectName` 写入 runtime（既有字段未变），供概览标题断言使用 | `apps/e2e/helpers/runtime.ts`、`apps/e2e/global-setup.ts` |

本地实际执行（2026-09-11）：`pnpm --filter @inpulse/e2e typecheck` 通过；定向 `pnpm --filter @inpulse/e2e exec playwright test aggregate-views` 2/2；全量 `pnpm test:e2e` 42/42（约 5.3 分钟）。推送后 GitHub Actions 已通过：`CI` push run [34508897744](https://github.com/256-code/InPulse/actions/runs/34508897744) 13m19s、`CI` pull_request run [34508916381](https://github.com/256-code/InPulse/actions/runs/34508916381) 13m43s、`Documentation` run [34508916277](https://github.com/256-code/InPulse/actions/runs/34508916277) 9s。

## F-23 / F-24 / F-25 前端交付（C，2026-09-11 本地落库）

F-23 合并到主任务 / F-24 解除合并 / F-25 聚合组详情页的前端纵切片落库：功能页任务抽屉新增「合并到主任务」入口（搜索同项目任务、排除自身、≥2 字符、350ms 防抖、来源分支类型单选、合并说明 ≤5000 字），成功后跳转 `/task-groups/{groupId}`；新增聚合组详情页（成员角色徽章、记录筛选 URL 状态、签名游标加载更多、外部链接快照与显式降级）；来源分支「解除合并」二次确认与组关闭警告。

| 验收点 | 实际证据 |
| --- | --- |
| F-23 前端：合并弹窗（搜索候选过滤、防抖、必选主任务、409 后重新搜索、提交携带 CSRF 与幂等键） | `MergeIntoMainTaskModal.test.tsx` 5 例；`TasksPanel.test.tsx` 合并入口 1 例 |
| F-25 前端：聚合组详情（成员排序与徽章、DETACHED/HISTORICAL 展示、记录筛选回调、非法 URL 回退、VOID 快照与游标、CLOSED 警告与空态） | `TaskGroupPageView.test.tsx` 8 例 |
| F-24 前端：解除合并（二次确认、原因 trim 空转 null、409 保留输入并可重新加载、422 文案、closesGroup 警告、成功失效相关查询） | `UnmergeTaskGroupButton.test.tsx` 5 例 |
| F-23/F-24/F-25 关键路径 E2E | `apps/e2e/tests/task-groups.spec.ts`：建功能与两个任务 → 来源任务抽屉合并 → 落聚合组页（主任务/来源分支/空态，开发期「接口说明」黄条断言为 0）→ 记录筛选写入 URL → 解除合并（组关闭警告）→ 「已解除」与组关闭提示；落库当时全量 `pnpm test:e2e` 43/43；`接口说明` 断言于 2026-09-12 前端大改后改为计数 0（见文末「前端交互大改」条目） |
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

本地实际执行（2026-09-11）：`pnpm contract:validate`、`pnpm contract:drift`、`pnpm permissions:check`、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`（6 项目）、API `test:unit` 66 文件 343 例、API `test:integration` 47 文件 407 例（真实 PostgreSQL）、`pnpm --filter @inpulse/web test` 58 文件 248 例、`pnpm db:test` 2 文件 20 例、`pnpm db:migrations:check`（6 个迁移）、`pnpm check:secrets`（855 文件）、`pnpm check:docs`（72 个 Markdown）、`pnpm check:deploy:test`、`pnpm check:deps`（579 文件）与 `pnpm check:frontend:boundaries` 通过；公共 registry `pnpm audit --registry=https://registry.npmjs.org --audit-level=high` 返回无已知漏洞。未运行：`pnpm test:e2e`（本轮未改 UI 页面行为）、`pnpm test:search:db` / `pnpm test`（要求 `max_connections >= 150`，按既定决定未纳入 CI）、GitHub Actions（PR #102 的 CI 后续已通过，run 34555834580）。前端适配器对新增字段的接线与降级项清零属 C 域交付（裁决 §10.5）；本轮仅把 C 侧测试夹具补到类型所需字段，未改适配器行为。

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

排障记录：本地 `app` 库缺 `0006_leftover_search_entity.sql`（PR #104 引入）导致所有带遗留内容的记录发布返回 500 `INTERNAL_ERROR`（`search_projection_entity_type_check` 不含 `LEFTOVER`）；以 `MIGRATION_DATABASE_URL=postgresql://cluster_bootstrap@127.0.0.1:55432/app` 执行 `pnpm db:migrate` 应用 0006 后，原先稳定失败的 9 例复跑 10/10 通过。该问题是本地环境迁移滞后，与 C-2 改动无关（CI 一次性建库执行全部迁移）。未运行：GitHub Actions（本地时点；PR #119 的 CI 后续已通过，run 34579633422）、`pnpm test:integration` 与 `pnpm test:search:db`（无后端与搜索改动；后者另要求 `max_connections >= 150`，按既定决定未纳入 CI）、`pnpm db:test` / `pnpm test`（同上）。新增 / 更新的 E2E 断言需非作者人工评审。

## F-08 原始审计读取留痕（A，2026-09-11 本地落库）

`GET /api/v1/audit-logs`（`getAuditLogs`）交付 F-08 步骤 4：原始审计读取必须留痕。要求当前有效的完整管理员 Session（ADR-031 起不再要求 TOTP 重认证；GET 只读路径不强制同步 CSRF、不使用幂等键）；不传 `projectId` 读 SYSTEM 链、传则读 `PROJECT:<id>` 链。查询经独立只读 `audit_reader` 连接（`AUDIT_DB_USER` 默认 `audit_reader`、`AUDIT_DATABASE_URL(_FILE)`，与业务连接分离，惰性建池、配置缺失或越界在首次读取 fail closed）。同一请求内先用业务连接向 SYSTEM 链追加 `AUDIT_LOG_READ` 留痕（含 filters/returnedCount/hasMore 与请求元数据，不含审计正文），留痕写失败则不返回读取结果。`cursor` 为服务端 HMAC 签名、绑定操作者与查询指纹（含链、过滤器与 limit）、TTL 15 分钟；`limit` 默认 50、最大 100；`from`/`to` 为半开区间 `[from, to)` 且必须带时区。远端 WORM 归档与每日加密明细导出（F-08 步骤 6）已由 A2 交付，见本节末尾的「F-08 审计远端归档」。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F08-READ-API-001 | HTTP + PostgreSQL | 管理员读取 SYSTEM 链并留痕 | 管理员返回 `AuditLogPage`（SYSTEM 链、64 位十六进制 `prevHash`/`recordHash`、ISO 时间）；同一请求后在 SYSTEM 链恰有一条 `AUDIT_LOG_READ`，`targetId=SYSTEM`，payload 含 `returnedCount`/`hasMore` 与 filters，不含审计正文 | 本地通过（`apps/api/test/audit-logs.integration.test.ts` 7/7，2026-09-11） |
| F08-READ-API-002 | HTTP + PostgreSQL | 身份与管理员门禁 | 匿名 401 `ADMIN_SESSION_REQUIRED`；普通成员 403 `ADMIN_REQUIRED` 且响应体不含任何审计内容；只读路径不强制同步 CSRF，完整管理员 Session 即可读取（ADR-031 起不再要求 TOTP 重认证） | 同上 |
| F08-READ-API-003 | HTTP + PostgreSQL | action 过滤与签名游标分页 | `action` 精确过滤 + `limit` 分页不重叠、无遗漏；游标跨查询（不同 action 或不同链）返回 422 `VALIDATION_FAILED`；非法游标、`from > to`、`limit=0` 均 422 | 同上 |
| F08-READ-API-004 | HTTP + PostgreSQL | 项目链隔离 | `projectId` 查询返回 `PROJECT:<id>` 链数据且不跨链（SYSTEM 链条目不出现在结果） | 同上 |
| F08-READ-WEB-001 | 前端单元（jsdom） | `/audit` 链选择、筛选与签名游标分页 | 默认读取 SYSTEM 链并渲染原始行（操作人、动作、对象、链序号与项目归属）；切换到项目链带 `projectId`；筛选只有点击「查询」才提交（动作码 trim、操作人 ID 必须正整数、`from/to` 由 `datetime-local` 换算为带时区 ISO，`from >= to` 与非法 ID 本地拦截且不发请求）；`hasMore` 时「加载更多」用上一页 `nextCursor` 续读并合并渲染 | 本地通过（`audit-query.test.tsx` 6 例、`AuditLogPageView.test.tsx` 8 例，2026-09-11） |
| F08-READ-WEB-002 | 前端单元（jsdom） | 错误映射 | 403 `ADMIN_REQUIRED` 展示管理员权限文案并保留重试入口；401/403/422/429 与未知失败映射为安全文案、不泄露服务端 `message`；行内「原始快照」展示 `eventPayload` JSON、前后哈希与请求元数据；`/audit` 路由 `requiresAdmin` 且侧栏入口仅管理员可见（`AppLayout.test.tsx`） | 同上 |

本地实际执行（2026-09-11）：API `test:unit` 66 文件 343 例、API `test:integration` 48 文件 415 例；`pnpm lint`、`format:check`、`typecheck`（6 项目）、`contract:drift`（5 生成物一致）、`contract:validate`（95 条路由）、`permissions:check`（95/95）、`check:deps`、`check:frontend:boundaries`、`check:secrets`、`check:deploy:test`、`db:migrations:check` 与公共 registry 高等级审计（无已知漏洞）均通过；GitHub Actions 已通过（PR #106，run 34560879433）。

B-4 前端本地执行（2026-09-11）：`pnpm --filter @inpulse/web test:unit` 66 文件 310 例通过（新增审计查询 6 例与审计页 8 例，含页内权限文案与游标分页）；未运行 `pnpm test:e2e`（本机无 PostgreSQL/Docker；PR #124 的 CI 已通过 run 34586112012，含 Browser E2E），`/audit` 浏览器 E2E 已由 C 于 2026-09-12 补齐（见本文件「F-08 `/audit` 审计页浏览器 E2E」章节）。

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

本地实际执行（2026-09-11）：`pnpm --filter @inpulse/ops test:unit` 7 文件 36 例、`pnpm --filter @inpulse/ops test:integration` 4/4（真实 PostgreSQL 18.6）；`pnpm check:deploy:test`（5 image refs）与 `pnpm check:deps`（604 源文件）通过。未运行：真实 S3/Object-Lock 端点联调、真实 systemd 安装、GitHub Actions（PR #107 的 CI 已通过，run 34564754475）。

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

未运行 / 已知偏差：① 本 PR 的 GitHub Actions 已通过（PR #108，run 34566748968 / 34566748947）；② 新增 E2E 用例与新增测试需非作者人工评审；③ 旧本地长跑库在整库全量集成时出现随机单文件 500，根因定位为客户端计算的过期 / 消费时间戳与 PostgreSQL `now()` 的毫秒级时钟抖动触发 `idempotency_records_retention_check` 与 `preauth_sessions_consumed_at_check` 的边界值，重复复跑不复现；换用与 CI 同构的新建库后两次全量 410/410 通过，该现象与本 PR 改动无关，但 CI 与本地时钟源差异值得后续确认；④ 旧本地库另有 `entityId` 整型溢出与项目编号序列耗尽等数据累积问题（非代码缺陷），不作为验收基线。⑤ 本机全量 `pnpm test:e2e` 三次运行各出现 1～3 个用例失败（42/45、43/45、44/45），失败集合每次不同且全部落在本批未改动的既有用例（features / task-status / leftover-task / record-publishing / search），单独重跑与差分重跑全部通过；⑥ 本机 `apps/web` 单测两次运行各出现 1 例超时抖动（防抖与弹窗用例，失败用例每次不同、单独重跑通过）。⑤⑥ 均判定为本机环境时延抖动（本机同时运行其它高负载桌面应用），非本批回归；CI 以 `retries: 1` 运行。

契约编号（已按建议顺延落库）：A 于 2026-09-11 的第二轮裁决（[A 的契约评审裁决](a-contract-review-f25-f29-f32.md) §10）把 **R-5 定义为 `GET /api/v1/task-groups/memberships`（`listTaskGroupMemberships`）**，并已由 [PR #102](https://github.com/256-code/InPulse/pull/102) 落库。本批新增的两条路由原按 R-5 / R-6 标注，与已冻结编号冲突；现按建议顺延为 **R-6 `listLeftoverItems`（`GET /api/v1/leftover-items`）** 与 **R-7 `listTaskGroups`（`GET /api/v1/task-groups`）**，路由 summary、Schema Registry 描述、实现注释与引用测试均已同步，冲突编号不再存在。

分工提示：A 的 §10 裁决同时把 F-25 步骤 3（功能页任务卡片 / 详情抽屉的「主任务 / 来源任务 / 迭代记录 n 条」标记与「查看主任务」）的落地方式定为页面级一次批量调用 R-5 `listTaskGroupMemberships`，并明确**不扩大任务基础 DTO**（不接受 `TaskItem.groupRole`）。该条不在本 PR 范围内，仍待实现；R-5 契约已由 [PR #102](https://github.com/256-code/InPulse/pull/102) 落库且编号已冻结，前端接线可直接开始。

## B-1 记录列表分页（F-17 / F-18，2026-09-11 本地落库）

`listRecordDrafts`（F-17）与 `listChangeRecords`（F-18）由单页数组改为 C-006 服务端签名游标分页：契约以 `RecordDraftPage` / `ReadableRecordPage`（items/nextCursor/hasMore）替换 `RecordDraftList` / `ReadableRecordList`，新增 `RecordDraftListQuery`，`RecordListQuery` 增补 `cursor` 与 `limit`（1～100、默认 20，越界或未知字段 422）。草稿按 `created_at DESC,id DESC`、正式记录按 `published_at DESC,id DESC` 取 `limit+1` 条判断 `hasMore`，服务端把本页最后一条位置编码为签名游标；游标绑定 actor、命名空间与项目，TTL 15 分钟，篡改 / 过期 / 跨项目 / 跨命名空间统一 422 `INVALID_CURSOR`。查询参数不改变可见性：无权限项目先收敛为 404，通过后才校验游标。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| B1-CONTRACT-001 | 契约 | 分页参数与 envelope | `RecordListQuery` / `RecordDraftListQuery` 接受 `cursor`+`limit`（字符串 “20” 归一为 20）并拒绝 0、101、非整数、超长游标与未知字段；`ReadableRecordPage` / `RecordDraftPage` 严格校验 `items`/`nextCursor`/`hasMore`，缺字段、空 `nextCursor`、未知字段均拒绝 | 本地通过（`packages/api-contract/test/published-records.test.ts`、`test/record-drafts.test.ts`；契约 15 文件 93 例通过） |
| B1-API-UNIT-001 | 单元 | 游标编码、解码与错误映射 | 第 1 页以本页最后一条位置编码 `nextCursor`，第 2 页以其为排他 keyset 边界；篡改、跨 actor、跨项目、跨命名空间 422 `INVALID_CURSOR`；无权限项目先 404 且不按游标状态区分；成员请求 VOID 列表 404；`limit` 1..100 透传、缺省 20 | 本地通过（`apps/api/test/record-list-pagination.test.ts` 4 例） |
| B1-WEB-001 | 前端单元 | 「加载更多」与签名游标 | 已发布记录与草稿列表点击「加载更多」后用服务端 `nextCursor` 请求下一页并追加渲染，第二次调用携带 `cursor`、`limit: 20` 与 AbortSignal；`hasMore=false` 后不再请求 | 本地通过（`apps/web/src/features/records/RecordsWorkspace.test.tsx`、`apps/web/src/features/record-drafts/RecordDraftsView.test.tsx`） |
| B1-INT-001 | PostgreSQL 集成 | keyset 不重不漏与游标校验 | 3 条草稿 / 正式记录以 `limit=2` 分两页取回：页内顺序为 `created_at DESC,id DESC` / `published_at DESC,id DESC`，两页无重叠无遗漏，`hasMore` 由 true 翻转为 false 且第二页 `nextCursor` 为 null；跨项目游标与损坏游标 422 `INVALID_CURSOR` | CI 已通过（PR #114，run 34571987936；本机当时无 PostgreSQL 实例与 Docker，用例由 CI 首次执行） |

本地实际执行（2026-09-11）：`pnpm lint`、`pnpm format:check`、`pnpm typecheck`（6 项目）、`pnpm test:unit`（database 15、api-contract 15 文件 93 例、canonical-json 5、web 64 文件 293 例、api 68 文件 350 例、ops 7 文件 36 例）、`pnpm build`、`pnpm contract:drift`（5 个产物）、`pnpm contract:validate`（97 条路由）、`pnpm permissions:check`（97 条操作 / 97 条路由）、`pnpm db:migrations:check`（7 个迁移）、`pnpm check:deps`（625 文件无环）、`pnpm check:frontend:boundaries`（209 模块 / 955 依赖）、`pnpm check:secrets`（921 文件）、`pnpm check:docs`（73 个 Markdown）、`pnpm deps:audit`（公共 registry 高等级审计无已知漏洞）均通过；lint 同时暴露并修复了「分页游标列被透传进严格响应 Schema」的缺陷。

未运行 / 已知偏差：① `pnpm test:integration` 未运行——本机没有 PostgreSQL 实例与 Docker，两个集成文件可正常收集（24 例），仅按设计因缺少 `TEST_DATABASE_URL` fail closed，新增的 B1-INT-001 用例已由 CI 首次执行通过（PR #114）；② `pnpm test:e2e` 未运行（依赖数据库与浏览器环境）；③ `pnpm check:deploy:test` 未通过——本机缺少 docker CLI，脚本报 `spawnSync docker ENOENT`，与本次改动无关，故 `pnpm check` 在该步骤中断；④ 本分支 GitHub Actions 已通过（PR #114 `3ce6773`，CI run 34571987936 / Documentation run 34571987921）；⑤ 新增集成用例与前端「加载更多」用例需非作者人工评审。

## B-7 记录侧发布计数映射（D-1 前置，2026-09-11 本地落库）

记录侧只读端口 `ChangeRecordReadPort` 删除「已发布任务 ID 集合」方法 `listTaskIdsWithPublishedRecords`，统一为「任务 → PUBLISHED 正式记录数」映射 `countPublishedByTask`（单条 SQL、按 `task_id` 升序、计数为 0 的任务缺席由消费端 `?? 0` 补齐，恒有 `hasPublishedRecord === (count > 0)`）。R-3 `MyTasksQueryService.list` 改为消费计数映射并由计数派生 `hasPublishedRecord`；存在性筛选仍在 `MyTaskQueryPort.list` 的同一分页 SQL 内以等价 EXISTS 先过滤后分页，不改锁序、不新增依赖边。R-3 的 `publishedRecordCount` 契约字段与 R-5 的「任务记录标记批量读」扩展属 A-7（裁决 §11.6），不在本批。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| B7-INT-001 | PostgreSQL 集成 | 计数口径与范围 | 同一任务 2 条 PUBLISHED 记录（其中 1 条含第 2 版）→ `count = 2`；仅 VOID / 仅草稿 / 无记录任务缺席（消费端补 0）；跨项目任务只在传入该项目 ID 时返回；空 `projectIds` / 空 `taskIds` 短路且不发出 SQL；越界 `taskIds`（超上限、非正整数）抛 `invalid-task-ids` 且不发出 SQL | CI 已通过（PR #116，run 34574310447；本机当时无 PostgreSQL 实例与 Docker，用例由 CI 首次执行） |
| B7-PLAN-001 | PostgreSQL 集成 | EXPLAIN (ANALYZE, BUFFERS) | R-3「先过滤后分页」SQL 与计数 SQL 均命中 `change_records` 既有索引（`change_records_project_task_idx` / `change_records_project_status_idx`），无 `Seq Scan on change_records` 与 `Seq Scan on tasks`；证明计数未破坏先过滤后分页、不需要新增迁移 | CI 已通过（PR #116，run 34574310447） |
| B7-API-UNIT-001 | 单元 | R-3 服务消费计数映射 | `MyTasksQueryService.list` 以本页 `taskIds` 调用 `countPublishedByTask(tx, pageProjectIds, taskIds)`；有条目 → `hasPublishedRecord: true`，缺席 → `false` | 本地通过（`apps/api/test/aggregate-read.service.test.ts`，22 例） |

本地实际执行（2026-09-11）：`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test:unit`（database 15、api-contract 15 文件 93 例、canonical-json 5、web 64 文件 293 例、api 68 文件 350 例、ops 7 文件 36 例）、`pnpm build`、`pnpm contract:drift`（5 个产物）、`pnpm contract:validate`（97 条路由）、`pnpm permissions:check`（97 条操作 / 97 条路由）、`pnpm db:migrations:check`（7 个迁移）、`pnpm check:deps`（625 文件无环）、`pnpm check:frontend:boundaries`（209 模块 / 955 依赖）、`pnpm check:secrets`（921 文件）、`pnpm check:docs`（73 个 Markdown）、`pnpm deps:audit`（无已知漏洞）均通过。

未运行 / 已知偏差：① `pnpm test:integration` 未运行——本机没有 PostgreSQL 实例与 Docker，`apps/api/test/aggregate-read-ports.integration.test.ts` 可正常收集（17 例），仅按设计因缺少 `TEST_DATABASE_URL` fail closed；B7-INT-001 与 B7-PLAN-001 已由 CI 首次执行通过（PR #116，EXPLAIN 断言依赖真库计划形状）；② `pnpm test:e2e` 未运行（依赖数据库与浏览器环境）；③ `pnpm check:deploy:test` 未通过——本机缺少 docker CLI（`spawnSync docker ENOENT`），与本次改动无关；④ 本分支 GitHub Actions 已通过（PR #116 `3b5fe90`，run 34574310447 / 34574310178）；⑤ 新增真库用例需非作者人工评审；⑥ A-7 未落库前 C-1 不得以条数实现标记（裁决 §11.6）。

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

未运行 / 已知偏差：① 本分支 GitHub Actions 已通过（PR #118 `361fdf9`，run 34579816992 / 34579816884）；② `pnpm test:e2e` 未运行（本次未改前端行为）；③ 前端消费（F-25 步骤 3 徽章与「查看主任务」）属 C-1，仍待落地；④ 新增真库用例与 R-5 破坏性契约变更需非作者人工评审。

## A-2 未裁决契约项定案（C-001 / C-004 / C-005 / C-007 / C-008，2026-09-11 本地落库）

按 [A 的契约评审裁决](a-contract-review-frontend-consumption.md)（对应 [C 的消费需求清单](frontend-generated-client-consumption-requirements.md) §6 五条开放项）：C-001 生成客户端输出位置冻结为 `apps/web/src/generated/api/`；C-004 `details` 保持开放对象并冻结保留键 `issues` / `reason`（判别联合延后，恢复条件见裁决 §3.2）；C-005 冻结 CSRF 四码族；C-007 生成客户端不做运行时 Schema 校验；C-008 `message` 为稳定诊断文案、前端只按 `code` 分支。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| A2-RULING-001 | 文档 | 五项裁决记录 | 五项全部定案并写入裁决文档；消费清单 §6 状态列与 §7 评审请求同步；技术设计仓库结构“客户端”修订为“客户端生成器” | 本地通过 |
| A2-CONTRACT-001 | 契约 | ErrorResponse 字段说明与生成物 | `error.zod.ts` 四字段补 `description`（含空对象约定与保留键）；`pnpm contract:generate` 重生成 5 个产物、`contract:drift` 无漂移、`contract:validate`（97 条路由）、`permissions:check`（97/97） | 本地通过 |
| A2-UNIT-001 | 单元 | 生成客户端不做运行时校验（C-007） | `generation.test.ts` 断言真实 Registry 的客户端与类型产物不含 `zod` / `safeParse`，错误解析走 `JSON.parse` 与 `response.ok` | 本地通过（api-contract 94 例） |
| A2-CODES-001 | 集成 / 单元 | CSRF 码族（C-005） | `CSRF_ORIGIN_REJECTED`（403，`reason` 为同源失败枚举）、`CSRF_TOKEN_INVALID`（403，`invalid-csrf`）、`ADMIN_CSRF_REJECTED`（401，管理员高风险 CSRF）与裁决一致，失败不使用 `FORBIDDEN` | 既有测试已覆盖（`logout.controller.test.ts`、`contract-runtime.http.test.ts`、`api-exception.filter.test.ts`、CONTRACT-009；本次未改实现） |
| A2-DETAILS-001 | 集成 | `details` wire 形状不变 | 既有 `{ issues: ... }` / `{ reason: ... }` / `{}` 断言（如 `http-error-contract.integration.test.ts`）保持通过 | 本地通过（`pnpm --filter @inpulse/api test:integration`） |

本地实际执行（2026-09-11）：`pnpm contract:generate`、`pnpm contract:drift`、`pnpm contract:validate`、`pnpm permissions:check`、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test:unit`、真库 `pnpm --filter @inpulse/api test:integration`、`pnpm check:docs`、`pnpm check:secrets` 均通过。

未运行 / 已知偏差：① 本分支 GitHub Actions 已通过（PR #121 `fff0c7e`，run 34583330490 / 34583330511）；② FC-031 判别联合与逐路由 `details` Schema ref 属延后项，恢复条件见裁决 §3.2，未在本批实现；③ 本次不改路由、状态码语义与权限矩阵。

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

未运行 / 已知偏差：① 本分支 GitHub Actions 已通过（PR #123 `6b1f5cc`，run 34587654943 / 34587654963）；② 真实主机恢复演练（RECOVERY-001 /
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

未运行 / 已知偏差：① 本分支 GitHub Actions 已通过（PR #123 `6b1f5cc`，run 34587654943 / 34587654963）；② CSRF Token 8 小时自然过期与后台
清理按真实时间推进，不在本批（过期失效语义以数据库时间回拨覆盖）；③ 除登录/登出外的其余
securityFlow（MFA 注册、验证、恢复码、管理员重认证）CSRF 路径已有控制器单测与 MFA E2E 覆盖，
本批不重复。

## C-1 F-25 步骤 3 入口标记与任务详情弹窗（2026-09-11 本地落库）

按[裁决](a-contract-review-f25-f29-f32.md) §10.4 与 §11 落地 F-25 步骤 3：任务中心的任务列表、任务卡片与任务详情新增「主任务 / 来源任务」关系徽章、「迭代记录 n 条」与「查看主任务」入口；数据源为 R-5 `GET /api/v1/task-groups/memberships` 的页面级一次批量调用（`taskIds` 1..100，常规页面单块即一次请求），禁止按任务逐个请求；「未入组」按条目本身（`groupId` / `groupRole` 为 `null`）判断而非按条目缺失，`groupRole` 为 `null` 时隐藏徽章与导航入口，`groupId` 导航 `/task-groups/{groupId}`；条数取自 D-1 落库的 `publishedRecordCount`，未扩展任务基础 DTO。任务详情由右侧抽屉改为居中弹窗（`Modal centered width={1000}` + `catalog-modal task-detail-modal`），视觉与交互对齐设计师稿（`D:\design\latest-version` 的任务卡片与任务弹窗）；弹窗内 tabs 属 C-3，不在本项范围。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| C1-UNIT-001 | 单元 | 批量标记 Hook | `useTaskMarks` 去重升序、按 `TASK_MARK_IDS_MAX=100` 分块、空集合不发请求（`enabled: key.length > 0`）、读取失败降级为空 Map 且不重试；`toTaskMarkMap` 按 taskId 建索引 | 本地通过（`apps/web/src/features/tasks/task-marks.test.tsx` 5 例） |
| C1-UNIT-002 | 单元 | 任务面板徽章、计数与入口 | 列表行与卡片按 `groupRole` 显示「主任务 / 来源任务」徽章、卡片页脚与详情显示「迭代记录 n 条」（0 条不渲染）、详情「查看主任务」仅 `SOURCE` 显示并导航 `/task-groups/{groupId}`、`MAIN` 自身隐藏入口；整页只发一次标记请求（`taskIds: [1, 2]`） | 本地通过（`apps/web/src/features/tasks/TasksPanel.test.tsx`，含 C-1 3 例） |
| C1-UNIT-003 | 单元 | 任务中心真实计数 | 任务中心卡片改读 `item.publishedRecordCount`（原写死「记录 1 条」），>0 显示「记录 n 条」且 `title` 为「n 条已发布迭代记录」，0 不渲染 | 本地通过（`apps/web/src/features/my-tasks/TaskCenterPageView.test.tsx`，期望「记录 3 条」） |
| C1-UNIT-004 | 单元 | 适配器与 mock 计数同形 | `MyTaskListItem.publishedRecordCount` 在类型、v1 查询映射、服务端适配器与 mock 数据集（10 条，3 条非零 3/2/1）同形状 | 本地通过（`my-tasks-v1-query.test.ts`、`my-tasks-server.test.ts`） |
| C1-E2E-001 | Playwright | 聚合组任务详情关系标记 | `task-groups.spec.ts`：合并后在任务详情弹窗（`.task-detail-modal`）看到「主任务 / 来源任务」（以 `getByText(..., { exact: true })` 断言，避免与卡片 h3 标题子串冲突）与「迭代记录 n 条」 | 本地通过 |
| C1-E2E-002 | Playwright | 遗留问题页与记录发布路径 | `issues.spec.ts` 由抽屉断言改为弹窗断言；`record-publishing.spec.ts` 末段断言详情「迭代记录 1 条」、筛选 DONE 后卡片计数与无关系徽章 | 本地通过 |

本地实际执行（2026-09-11）：`pnpm --filter @inpulse/web test` 65 文件 303 例、`pnpm test:unit`（api 68 文件 351 例，其余 workspace 通过）、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`（含 `apps/e2e`）、`pnpm build`、`pnpm check:frontend:boundaries`（211 模块 965 依赖）、`pnpm contract:validate`（97 条路由）、`pnpm contract:drift`（5 个产物）、`pnpm permissions:check`（97/97）、`pnpm db:migrations:check`（8 个迁移）、`pnpm check:deps`、`pnpm check:secrets`（930 文件）、`pnpm check:docs`（73 个 Markdown）、`pnpm check:deploy:test` 与公共 registry 审计（无已知漏洞）均通过。`pnpm test:e2e`（`E2E_API_PORT=3131` / `E2E_WEB_PORT=4191`）：改动三文件 5/5 通过；全量 46 例两轮为 44 过 + 2 偶发、45 过 + 1 偶发，失败集合每轮不同，均由下述幂等约束边界 500 引起（`project-archive.spec.ts` 单文件复跑 2/2、`module-tasks.spec.ts` F-15 单例复跑 1/1 通过）。

未运行 / 已知偏差：① 本批 GitHub Actions 已通过（PR #125 `5d00bb9`，run 34590026123 / 34590026131）；② `pnpm test:integration` 未运行（本批无服务端改动，R-5 服务端由 A-7 [PR #118](https://github.com/256-code/InPulse/pull/118) 覆盖）；③ 全量 E2E 的偶发失败按约定不得视为已修复（根因见下）；④ 新增 / 更新的 E2E 用例与前端用例需非作者人工评审；⑤ 任务详情弹窗内的 tabs 等 C-3 收尾项未做。

偶发 E2E 失败根因（2026-09-11 定位，未修复）：本机 Docker 日志（`inpulse-local-dev`）显示偶发 500 来自 `idempotency_records_retention_check`（`expires_at <= created_at + 30 days`）。实例：`2026-09-11 09:55:51` 行 `created_at 09:55:51.576903+00`、`expires_at 10:55:51.577+00` —— JS 宿主 `Date.now() + 30d` 比 Docker PostgreSQL `now()` 快约 0.1ms（Windows Docker Desktop VM 时钟偏差），差值超出 30 天上限 97µs 被拒，表现为写请求 500 与保存后弹窗不关闭；Linux / CI 单一时钟源不受影响。另：E2E 运行的是 `node apps/api/dist/main.js` 与 `packages/api-contract/dist`，契约或服务端改动后必须先执行 `pnpm --filter @inpulse/api-contract build` 与 `pnpm --filter @inpulse/api build`，否则会以旧构建启动并触发 `contract response validation failed`。

## C-3 / C-4 任务详情弹窗 tabs 与全站视觉复核（2026-09-11 本地落库）

按 C-3 完成 F-29 / F-32 页面视觉收尾，并为任务详情弹窗切换设计稿的标签页结构（页面不再使用抽屉，按用户 2026-09-11 指令）：`TasksPanel.tsx` 弹窗头部改为动作行（`TaskDueBadge` 截止徽章 + 完成任务 / 取消任务 / 合并到主任务 / 重新打开 / 恢复任务 / 编辑任务，`disabled={!taskWritable}`），中部新增 `CalmTabs`（`role=tablist/tab` + `aria-selected`）承载「任务信息 / 迭代记录 [n] / 合并与分支 [· #groupId]」三个标签页，右侧 facts 面板保留「影响功能：」等字段；`TaskStatusPanel.tsx` 重写为受控 `action` 面板（外层 `section.task-status-section`，保留 `.task-status-history` 时间线与完成 / 重开 / 取消 / 恢复弹窗、冲突重载与幂等键）；`Calm.tsx` 新增 `CalmTabs`、`InpulseIcon.tsx` 新增 `x` 图标；`inpulse-design.css` 新增 `.calm-task-actions` / `.calm-due`(+tone) / `.calm-tabs` / `.task-status-section` / `.task-status-published` / `.task-status-history`。C-4 对 `.page-content` 与 `.badge` 全局样式改动做全站人工视觉复核。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| C3-UNIT-001 | 单元 | 弹窗标签页与分支面板 | 任务详情弹窗标签页切换（任务信息 / 迭代记录 / 合并与分支）；SOURCE / MAIN / 未入组三种分支面板渲染；`TasksPanel.test.tsx` 新增 4 例 | 本地通过 |
| C3-E2E-001 | Playwright | 状态历史与动作行回归 | `task-status.spec.ts`（FEATURE / MODULE 两例）、`record-publishing.spec.ts`、`record-drafts.spec.ts`、`issues.spec.ts` 在弹窗 tabs 改造后仍通过（`.task-status-history` 计数、动作按钮、查看已发布记录链接） | 本地通过 |
| C3-E2E-002 | Playwright | 各页面弹窗 / 关系标记回归 | `tasks.spec.ts`、`module-tasks.spec.ts`、`external-links.spec.ts`、`task-groups.spec.ts`、`aggregate-views.spec.ts`、`leftover-task.spec.ts`、`task-completion.spec.ts` 随全量 `pnpm test:e2e` 通过 | 本地通过 |
| C4-REC-001 | 人工视觉 | 全站 `.page-content` / `.badge` 复核 | 17 张视图截图逐张核对（任务中心 1280 / 1680、任务详情弹窗三 tab、项目概览六指标 strip、功能档案、记录、遗留问题、活动、通知、搜索、设置与审计等），未发现需改代码的缺陷 | 本地通过 |

本地实际执行（2026-09-11）：`pnpm --filter @inpulse/web test` 67 文件 322 例；`pnpm check` 至 `deps:audit` 前全部通过（lint / format:check / typecheck / test:unit / db:migrations:check / contract:drift / contract:validate / build / check:deploy:test / check:deps / check:frontend:boundaries（215 模块 992 依赖）/ permissions:check（97/97）/ check:secrets / check:docs），`deps:audit` 因本地 npm 镜像无 audit endpoint 失败（非本批回归；公共 registry 审计无已知漏洞）；`pnpm contract:drift`（5 个产物）、`pnpm contract:validate`（97 条路由）、`pnpm permissions:check`（97/97）单独复跑通过。`pnpm test:e2e`（`E2E_API_PORT=3131` / `E2E_WEB_PORT=4191`）全量 50 例 49 过 + 1 偶发：`aggregate-views.spec.ts:14` 在「新建功能」弹窗保存后 `toBeHidden` 超时（与既有偶发同族），单文件复跑 2/2 通过，按约定不得视为已修复。

未运行 / 已知偏差：① 本批 GitHub Actions 已通过（[PR #126](https://github.com/256-code/InPulse/pull/126) run 34597046361 / 34597046383）；② `pnpm test:integration` 未运行（本批无服务端改动）；③ 新增 / 更新的单测与 E2E 用例需非作者人工评审；④ C-4 视觉复核用临时 Playwright spec 与 17 张截图仅本地产出（spec 已删除，截图未入库）。

## A-5 阶段 4 搜索容量门禁（2026-09-11 本地落库）

按[技术设计 §9.4](../技术设计v1.2.2.md#94-中文-poc-验收)（阶段 4 容量条目）与[系统设计 §1.6](../系统设计文档v1.0.2.md#16-搜索方案与验收指标)（阶段 4 容量与安全最终验收）落地：新增
[`database/poc/search-pgroonga/run-capacity.ts`](../database/poc/search-pgroonga/run-capacity.ts)，复用 PGroonga PoC 种子化的
`app.pgroonga_poc_scale`（101000 行）与默认全文索引，查询 SQL 与生产 `PostgresSearchProjectionReader`
同形状（`&@~ app.pgroonga_query_escape($1)`、项目与 visibility 过滤在 SQL 层、id keyset 分页）；
`poc-search-pgroonga-local.ps1` 新增 `-Capacity` / `-CapacityDurationSeconds`，在搜索 PoC 通过后追加容量步骤；
报告见 [`pgroonga-capacity-report.json`](../database/poc/search-pgroonga/artifacts/pgroonga-capacity-report.json)（`version: pgroonga-capacity-v1`，全部 gate 通过才以 0 退出）。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| SEARCH2-CAP-001 | 真实 PostgreSQL 压测 | 投影规模与冻结金标 | 规模表 ≥ 100,000 行（实测 101000）、冻结金标 200 条且版本 `phase4-v1`、预热 Recall@20 ≥ 90%（实测 189/190 = 99.47%，缺失 `G007:通知`） | 本地通过 |
| SEARCH2-CAP-002 | 真实 PostgreSQL 压测 | 30 并发 × 10 分钟 | 30 并发持续 ≥ 600s（实测 600.8s）、2,362,344 次 SQL、0 错误、P95 < 500ms（实测 10.171ms）、P99 < 1s（实测 13.284ms）、qps 3991.8 | 本地通过 |
| SEARCH2-CAP-003 | 真实 PostgreSQL 压测 | 跨项目隔离 | 行级断言任何越界 `project_id` 计违规（实测 0），持续压测前后各一次负向探针（`G043` 在非授权项目返回 0 行） | 本地通过 |
| SEARCH2-CAP-004 | 真实 PostgreSQL 压测 | 冷缓存单独记录 | `docker restart` 清空 PostgreSQL shared_buffers 后单并发执行首批查询（30 条，min 1.483ms / max 68.211ms），与预热后结果分开呈现 | 本地通过 |
| SEARCH2-CAP-005 | 脚本门禁 | 失败即非零退出 | 报告 `gates` 全部为 true 才以 0 退出，任一未达标写入报告并抛错 | 本地通过 |

本地实际执行（2026-09-11）：`powershell -NoProfile -ExecutionPolicy Bypass -File database/scripts/poc-search-pgroonga-local.ps1 -Image inpulse/pgroonga-pg18.6:repro -Port 55434 -RestorePort 55435 -Capacity` 一体化路径成功退出——8 个迁移校验与迁移、数据库单测 15 例、数据库集成 26 例、10 个 PGroonga 策略 PoC、容量门禁（30 并发 × 600.8s、2,398,317 次请求 / 2,362,344 次 SQL、0 错误、P95 10.171ms、P99 13.284ms、召回 189/190、冷缓存 30 条）、升级路径（`0000-0002` 手工应用后由 runner 应用 `0003`-`0007`，4 applied / 4 already present）与 `0003`/`0004`/`0005` 逐迁移事务内回滚、逻辑备份恢复验证；`database/package.json` 新增 `poc:search:capacity`，`database/scripts/poc-search-pgroonga-local.ps1` 新增 `-Capacity` 参数。

未运行 / 已知偏差：① 本批 [PR #128](https://github.com/256-code/InPulse/pull/128) 的 GitHub Actions 已通过（run 34612213457 / 34612213472）；② 容量门禁不进入 CI（含 10 分钟持续负载与容器重启），端到端 P95（Nginx / TLS / API 与鉴权开销）需在部署环境复测；③ 5 年容量模型峰值未在设计中定稿，1.2 倍条件以上界形式记录（峰值 ≤ 84166 时成立），定稿后需人工复核并按需复测；④ 冷缓存只清空 PostgreSQL shared_buffers，宿主页缓存与存储层缓存未清空；⑤ 30 并发由单进程发起，未覆盖真实成员关系变更并发；⑥ 本批三个既有 PoC artifact 由同一次脚本运行重生成后已还原，避免夹带与 A-5 无关的时序噪声。
## B-5 迭代记录 Markdown 白名单渲染（2026-09-11 本地落库）

按[技术设计 §7.5](../技术设计v1.2.2.md)与[系统设计 §3.6](../系统设计文档v1.0.2.md)：迭代记录
正文保存 Markdown 原文，渲染必须过白名单，不允许原始 HTML。依赖 `react-markdown@10.1.0` +
`rehype-sanitize@6.0.0` 已按第 4 节由独立依赖 [PR #127](https://github.com/256-code/InPulse/pull/127)
squash 合入 main `3e416a1`（外链口径沿用 [ADR-022](adr/ADR-022.md)）。渲染器
[`RecordMarkdown`](../apps/web/src/features/common/components/RecordMarkdown.tsx) 逐层收敛：
react-markdown 不启用原始 HTML；rehype-sanitize 使用显式完整 schema，只保留
`a/blockquote/br/code/em/h1-h6/hr/img/li/ol/p/pre/strong/ul` 标签与 `a.href`、`img.alt`
属性，`href` 协议只允许 https，并对 `id/name` 前缀转义；`urlTransform` 与 `a` 组件统一走
`recordLinkHref`（标准 URL Parser，禁止字符串前缀判断域名），只把规范化后的
`https://github.com/...` 渲染为 `target="_blank" rel="noopener noreferrer"` 外链，拒绝
http、非 `github.com` 域名、混淆域名、userinfo、非默认端口与畸形 URL；图片不加载远程资源，
只显示 `[图片：alt]`。接入点：已发布记录详情与版本对比、草稿详情、完成任务时的最新草稿与所选
草稿、遗留项转任务预览、版本冲突「最新内容」预览；编辑表单保持纯文本 textarea。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| B5-UNIT-001 | Web 单元 | CommonMark 结构渲染 | 标题 / 列表 / 引用 / 代码块 / 行内代码 / 粗斜体 / 分隔线按白名单渲染；行内代码中的 `<div>` 文本保留；空内容不产生节点并保留调用方类名 | 本地通过（`RecordMarkdown.test.tsx`） |
| B5-UNIT-002 | Web 单元 | 原始 HTML 惰性 | `<script>`、事件处理器与原始标签不进入 DOM（无 script/img/onerror 节点与全局探针赋值）；原始 HTML 文本按策略丢弃、历史纯文本换行保留 | 本地通过 |
| B5-UNIT-003 | Web 单元 | 协议与域名白名单 | `javascript:` / `data:` / `vbscript:` 不产出 href；`https://github.com/...` 产出安全外链且 autolink 同口径；http、非 GitHub 域名、混淆域名、userinfo、非默认端口、相对路径与畸形 URL 只保留文本 | 本地通过 |
| B5-UNIT-004 | Web 单元 | 图片与占位 | 图片不加载远程资源、只显示 `[图片：alt]`；详情「暂无已知遗留问题」与版本对比「（空）」占位保持 | 本地通过 |
| B5-UNIT-005 | Web 单元 | 视图接线回归 | 已发布记录 / 草稿 / 完成任务 / 遗留转任务用例在接入 `RecordMarkdown` 后通过；版本冲突断言改为标签「最新内容」与内容分别断言 | 本地通过 |

本地实际执行（2026-09-11）：`RecordMarkdown.test.tsx` 11 例；`pnpm --filter @inpulse/web test`
68 文件 333 例通过；`pnpm --filter @inpulse/web typecheck`、`pnpm lint`、`pnpm format:check`、
`pnpm build`（产物含 `RecordMarkdown-*.js`）、`pnpm check:frontend:boundaries`（220 模块
1005 依赖）、`pnpm check:docs` 与 `pnpm check:secrets`（944 个文件）通过；记录相关既有浏览器 E2E 定向复跑 11 例 10 过 + 1 偶发（`record-publishing.spec.ts:78` 新建功能弹窗未关，Docker 日志同时段 `idempotency_records_retention_check` 违约，属既有偶发同族；单文件复跑 2/2 通过）。推送 2（2026-09-11）：首轮 CI 的 Secret scan 命中测试内 userinfo 反例字面量（用户名与口令内嵌于 URL），已改为片段拼接，未放宽扫描规则。推送 3（2026-09-11）：推送 2 的 CI 又在本文档与 `开发日志.md` 正文命中同类 userinfo 字面量，本次改写为不含连接串形态的描述；`pnpm check:secrets`、`pnpm check:docs` 与本文件 `pnpm exec prettier --check` 重新通过，仍未放宽扫描规则。

未运行 / 已知偏差：① 本批 GitHub Actions 已通过（[PR #129](https://github.com/256-code/InPulse/pull/129) run 34618476646 / 34618476818）；
② 未新增浏览器 E2E，记录相关既有用例定向复跑见上（含 1 例既有偶发，按约定不得视为已修复）；
③ 新增单测需非
作者人工评审；④ 编辑表单仍为纯文本输入，白名单只作用于只读展示；⑤ 渲染 schema 是显式完整替换
（不与 rehype-sanitize 默认 schema 合并），后续升级依赖时必须同步复核本文件 schema 与测试。

## B-3a `/records` 前端单页重构（C，2026-09-12 本地落库，[PR #131](https://github.com/256-code/InPulse/pull/131)）

按产品 2026-09-12 定案，B-3 拆两片执行：本片只做前端单页重构（骨架与信息层级照设计师稿
`views/records.tsx`），项目仍必选、不新增后端路由；跨项目记录清单、我的草稿（全局）、名称回填、
跨项目索引与服务端 `q` 检索属 B-3b 独立契约纵切片，「全部项目」在 B-3b 落库前保持关闭。
实现为 `features/records/`（`RecordsWorkspace`、`PublishedRecordCard`、`record-timeline`、`records-timeline.css`）
加 `features/published-records/PublishedRecordDetail`：页头 CTA「记录一次迭代」→ 我的草稿条带 →
项目草稿与草稿详情 → 四项筛选 toolbar → 按发布日分组的 `record-card` 时间线 → 加载更多；
`PublishedRecordsView` 删除，`pages/records/RecordsPage` 降为薄包装，既有 URL 契约
（`projectId`/`status`/`publishedId`/`moduleId`/`taskId` 与 `view=published` 兼容忽略）与 E2E 依赖的可访问名保持不变。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| B3A-UNIT-001 | Web 单元 | 本地来源与关键词筛选 | 来源筛选覆盖「全部来源 / 任务来源 / 模块级影响 / 功能直接创建」（按 `taskId` 与 `scopeType` 判定）；关键词命中编号、标题、原因、改动、验证与遗留问题，大小写不敏感，空关键词不过滤 | 本地通过（`apps/web/src/features/records/RecordsWorkspace.test.tsx`） |
| B3A-UNIT-002 | Web 单元 | 按发布日分组 | 当前已加载页按 `publishedAt` 日期键分组，组内保持服务端 `published_at DESC` 顺序、组间按日期降序，并给出中文日期与条数 | 本地通过 |
| B3A-UNIT-003 | Web 单元 | 卡片展开、详情与生命周期 | `record-card` 摘要显示标题、编号、版本与状态徽标；展开状态由 URL `publishedId` 驱动，展开后渲染 `正式记录详情` region（版本对比、历史版本、GitHub 关联与管理员生命周期操作）；VOID 记录对成员只读 | 本地通过（`PublishedRecordDetail.test.tsx` 4 例 + `RecordsWorkspace.test.tsx`） |
| B3A-UNIT-004 | Web 单元 | 「加载更多」与签名游标 | 点击「加载更多」用服务端 `nextCursor` 请求下一页并追加渲染，第二次调用携带 `cursor`、`limit: 20` 与 AbortSignal；`hasMore=false` 后不再请求 | 本地通过 |
| B3A-UNIT-005 | Web 单元 | 我的草稿条带与页头 CTA | 条带只列当前登录用户草稿（项目草稿列表仍显示全部成员草稿），点击直接打开「编辑草稿」弹窗；页头 CTA 在未选项目或不可写时禁用，可写时打开对应模式的草稿弹窗；草稿详情与弹窗文案保持 | 本地通过（`RecordDraftsView.test.tsx` 与 `RecordsWorkspace.test.tsx`） |
| B3A-UNIT-006 | Web 单元 | 页面壳与降级提示 | `records-page` 壳保持，`RecordsPage` 只渲染工作区；出现筛选条件时显示 `.records-filter-note`，显式说明列表筛选只在当前已加载条数内生效 | 本地通过（`apps/web/src/pages/records/RecordsPage.test.tsx`） |
| B3A-E2E-001 | 浏览器 E2E | 记录生命周期断言迁移 | `record-lifecycle.spec.ts` 由「记录状态」分段控件内选「已作废」并展开 `record-card` 摘要，管理员作废、成员可见 VOID 与恢复路径保持通过 | 本地通过（全量 `pnpm test:e2e` 50 例） |
| B3A-E2E-002 | 浏览器 E2E | 记录相关既有路径回归 | 草稿（F-17）、发布（F-18）、完成任务（F-19）、遗留转任务（F-20）、外链（F-22）与聚合视图（F-29 / F-32）用例在单页重构后全部通过 | 本地通过 |

本地实际执行（2026-09-12）：`pnpm --filter @inpulse/web test:unit` 69 文件 339 例；`pnpm test:unit`
（database 15、canonical-json 5、api-contract 15 文件 94、web 69 文件 339、ops 8 文件 52、api 68 文件 351）；
`pnpm test:integration` 中 `apps/api` 50 文件 432 例通过，`database` 25/26（1 例为本机长跑库 projectId 增大后
fixture 计算 `project_id * 1_000_000 + 1` 超出 int4 的环境性失败，与本片改动无关）；`pnpm test:e2e` 全量 50 例通过；
`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm build`、`pnpm db:migrations:check`（8 条迁移）、
`pnpm contract:drift`（5 个产物）、`pnpm contract:validate`（97 条路由）、`pnpm permissions:check`（97 条操作 / 97 条路由）、
`pnpm check:deploy:test`、`pnpm check:deps`（646 文件）、`pnpm check:frontend:boundaries`（225 模块 1026 依赖）、
`pnpm check:secrets`（951 文件）与 `pnpm check:docs`（75 个 Markdown）通过；`pnpm deps:audit` 因本机 npm 镜像缺 audit
endpoint 失败，改用公共 registry `pnpm audit --registry=https://registry.npmjs.org --audit-level=high` 返回无已知漏洞。

未运行 / 已知偏差：① 本片 GitHub Actions 结果见 PR #131 检查记录；
② 搜索与来源筛选只作用于当前已加载页，正式记录列表没有服务端筛选与跨项目查询——这是 B-3b 的范围，
不得据此声称跨项目清单或服务端检索已可用；③ 状态筛选只有「已发布 / 已作废」（VOID 仅管理员），
契约 `RecordListQuery` 仍只有 `status`，未新增「全部」；④ 新增与迁移的前端用例需非作者人工评审。

## B-3b 跨项目记录清单与全局「我的草稿」（C，2026-09-12 本地落库，[PR #132](https://github.com/256-code/InPulse/pull/132)）

B-3 第二片（独立契约纵切片）：新增两条只读契约路由 `listRecordFeed`（`GET /api/v1/change-records`，跨项目正式记录清单，
`projectId` 可省略、`status` / `source` / `q` 可选、服务端签名游标分页，按 `AuthorizedProjectScope` 过滤并批量回填
项目 / 模块 / 功能名与作者引用）与 `listMyRecordDrafts`（`GET /api/v1/me/record-drafts`，当前 actor 的全局未发布草稿，
跨项目回填名称）；迁移 `0008_records_cross_project_indexes.sql` 增加跨项目读索引（`database/schema/change-records.ts` 同步）；
`/records` 据此打开「全部项目」（不传 `projectId` 即默认全量），B-3a 的本地降级筛选被服务端筛选与 `q` 取代。
| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| B3B-CONTRACT-001 | 契约 | Schema、路由与权限登记 | 6 个 Schema（`RecordFeedQueryRequest` / `RecordFeedItem` / `RecordFeedPage` / `MyRecordDraftItem` / `MyRecordDraftPage` / `MyRecordDraftListQuery`）与 2 条 GET 路由全策略显式登记；OpenAPI、生成客户端与 Registry 无漂移；`docs/permissions.md` 新增两行 | 本地通过（`packages/api-contract/test/record-feed.test.ts`；`pnpm contract:drift` 5 个产物、`pnpm contract:validate` 99 条路由、`pnpm permissions:check` 99 条操作 / 99 条路由） |
| B3B-API-001 | API 集成 | 鉴权与输入边界 | 匿名 401；`limit` 越界、归一化后不足 2 字的 `q` 与非法 `status` 返回 422；两条路由均不要求 CSRF 与幂等键 | 本地通过（`apps/api/test/record-feed-api.integration.test.ts`） |
| B3B-API-002 | API 集成 | 授权范围与状态口径 | 默认只返回成员项目 PUBLISHED 行并回填名称；非成员 `projectId` 收敛为空页（不返回 404）；非管理员请求 `VOID` / `ALL` 收敛为 PUBLISHED，管理员可读作废行 | 本地通过 |
| B3B-API-003 | API 集成 | 来源筛选与 `q` 检索 | 来源四档（主任务 / 来源任务 / 模块级 / 功能直接创建）分别命中；`q` 复用 `CHANGE_RECORD` 全文投影跨项目命中、作废行只对管理员可见、无匹配为空页 | 本地通过 |
| B3B-API-004 | API 集成 | 我的草稿全局读 | 只返回当前 actor 的草稿（他人草稿不可见）、跨项目、名称回填；被移出项目后该作者的草稿立即不再返回 | 本地通过 |
| B3B-API-005 | API 集成 | 游标稳定性与绑定 | keyset 分页稳定；游标绑定 actor、命名空间与筛选指纹（`filterKey`），跨筛选、跨接口与跨 actor 复用被拒 | 本地通过 |
| B3B-UNIT-001 | Web 单元 | 「全部项目」默认与名称回填 | 不选项目时请求不带 `projectId`；卡片按记录自身项目显示「归属 项目 / 模块 / 功能」与编号、版本、发布时间、作者；逐记录按自身项目判定可写 | 本地通过（`apps/web/src/features/records/RecordsWorkspace.test.tsx`） |
| B3B-UNIT-002 | Web 单元 | 来源 / 状态收敛与 `q` 防抖 | 来源五档与状态选项按角色收敛（非管理员只有「已发布」）；关键词 350ms 防抖后以 `q` 下发（不足 2 字不下发）；「加载更多」携带服务端游标 | 本地通过 |
| B3B-UNIT-003 | Web 单元 | 全局我的草稿条带 | 条带用全局查询列出跨项目本人草稿与「项目 / 模块」归属，点击回到所属项目的草稿详情，保存成功后失效刷新 | 本地通过（`apps/web/src/features/record-drafts/RecordDraftsView.test.tsx`） |
| B3B-E2E-001 | 浏览器 E2E | 跨项目清单闭环 | 创建第二个项目 → `/records` 选该项目建独立草稿（条带显示标题与「项目 / 未分类」）→ 发布 → 回到未选项目的 `/records` 看到卡片与「归属 项目 /」；`q` 检索无匹配空态与命中；展开摘要显示 `-CR-\d+ · v1 · 已发布` | 本地通过（`apps/e2e/tests/record-feed.spec.ts`；`pnpm test:e2e` 全量 51 例） |
本地实际执行（2026-09-12）：`pnpm --filter @inpulse/api-contract test` 16 文件 98 例；`pnpm test:unit`
（database 15、canonical-json 5、api-contract 16 文件 98、web 69 文件 340、ops 8 文件 52、api 68 文件 351）全部通过；
真库 `apps/api` 集成 51 文件 442 例（新增 `record-feed-api.integration.test.ts` 10 例），两次全量各出现无关文件 500 偶发
（首轮 `task-group-unmerge` 2 例、次轮 `external-links` 6 例 + `features-api` 3 例），逐文件复跑 3 文件 59 例通过；`database` 集成 26 例（25 通过，1 例为本机长跑库 `project_id` 越 int4 的环境性失败，与本片无关）；
`pnpm test:e2e` 全量 51 例通过（先定向复跑 `record-feed.spec.ts` 1 例）；`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、
`pnpm build`、`pnpm db:migrations:check`（9 条迁移）、`pnpm contract:drift`（5 个产物）、`pnpm contract:validate`（99 条路由）、
`pnpm permissions:check`（99 条操作 / 99 条路由）、`pnpm check:deploy:test`、`pnpm check:deps`（655 文件）、
`pnpm check:frontend:boundaries`（225 模块 1026 依赖）、`pnpm check:secrets`（960 文件）与 `pnpm check:docs` 通过；
`pnpm deps:audit` 因本机 npm 镜像缺 audit endpoint 失败，改用公共 registry
`pnpm audit --registry=https://registry.npmjs.org --audit-level=high` 返回无已知漏洞。

未运行 / 已知偏差：① 本片 GitHub Actions 结果见 PR #132 检查记录；② 真库两次全量的 500 偶发属既有
`idempotency_records_retention_check` 时钟偏差族（失败文件每次不同、单文件复跑全过），不得视为已修复；
③ 迁移 `0008`、新增权限行与新增集成 / E2E 用例需非作者人工评审；④ `q` 只覆盖既有 `CHANGE_RECORD` 投影内容，
不提供任意英文 / 代码子串或正则检索（V1 边界不变）；⑤ 记录写入仍走单项目视图与项目内 API，本片只扩展读路径；⑥ 迁移 `0008` 新增索引后，`aggregate-read-ports.integration.test.ts` 的 EXPLAIN 断言由绑定 `change_records_project_*_idx` 改为「命中 change_records 索引且不回落 Seq Scan」（CI 实测规划器改选 `change_records_status_published_idx`），属本片驱动的断言调整，A-7 的 `actual time` 与无 `Seq Scan` 证据不变，B7-PLAN-001 / A7-PLAN-001 的历史 CI 结论按当时索引集成立。

## F-08 `/audit` 审计页浏览器 E2E（C，2026-09-12 本地落库）

补齐 B-4 遗留的 `/audit` 浏览器 E2E：`apps/e2e/tests/audit.spec.ts` 两例覆盖普通成员 403 与管理员完整 Session 后的真实读取链路；E2E 基建同步为 API 进程注入 `AUDIT_DATABASE_URL`（由 `E2E_DATABASE_URL` 派生 `audit_reader` 只读账号，`apps/e2e/helpers/runtime.ts` 的 `auditDatabaseUrl()`）。此前 E2E API 进程只有 `DATABASE_URL`，审计读取按设计 fail closed 返回 500——本次是 E2E 环境配置补齐，生产配置、`apps/api/src/database/audit-reader.client.ts` 的 fail closed 行为、角色与鉴权均未放宽。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F08-E2E-001 | 浏览器 E2E | 普通成员访问审计页 | 普通成员打开 `/audit` 命中 `admin-forbidden` 空态与「无权访问」「此区域仅限系统管理员访问。」，页面不展示任何审计内容 | 本地通过（`apps/e2e/tests/audit.spec.ts` 2/2，2026-09-12） |
| F08-E2E-002 | 浏览器 E2E | 管理员读取原始审计 | 管理员进入 `/audit` 直接读取原始审计（ADR-031 起不再要求 TOTP 重认证）；动作码 `AUDIT_LOG_READ` 过滤命中「链 SYSTEM / 用户 #id / 用户操作」；行内「原始快照」弹窗展示 `eventPayload`（含 `returnedCount`）并以 Escape 关闭；切到 `PROJECT:<id>` 链命中 `project.create` 行与 `PROJECT #id` 归属；操作人 ID 非正整数在本地被拦截且不发请求 | 同上 |

本地实际执行（2026-09-12，PostgreSQL 18.6 + PGroonga，`E2E_API_PORT=3111` / `E2E_WEB_PORT=4181`）：`pnpm --filter @inpulse/e2e typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm typecheck` 通过；`pnpm --filter @inpulse/api build` 后全量 `pnpm test:e2e` 53/53（9.3 分钟，其中 `audit.spec.ts` 两例 8.1s）通过；`pnpm test:unit`（database 15、canonical-json 5、api-contract 16 文件 98 例、web 69 文件 340 例、ops 8 文件 52 例、api 68 文件 351 例）与 `pnpm test:web`（69 文件 340 例）通过；`pnpm check:deps`（656 文件）、`pnpm check:secrets`（961 文件）、`pnpm check:docs`（75 个 Markdown）通过；公共 registry `pnpm audit --registry=https://registry.npmjs.org --audit-level=high` 返回无已知漏洞。

未运行 / 已知偏差：① 本片 GitHub Actions 结果见 PR #133 检查记录；② 未运行 `pnpm test:integration`、`pnpm db:test` 与整体 `pnpm check`（本片无后端、契约、迁移与角色改动；整体 `check` 的 `deps:audit` 在本机 npm 镜像必然失败，其余步骤已逐条执行）；③ 新增 E2E 用例与 E2E 基建配置需非作者人工评审；④ 既有真库集成 500 偶发（`idempotency_records_retention_check` 时钟偏差族）本次全量 E2E 未复现、未修复。

## 登录入口与登录页视觉（C，2026-09-12 本地落库，[PR #134](https://github.com/256-code/InPulse/pull/134)）

按产品要求把匿名入口改为直达登录页，并按设计师稿重做登录页视觉：`RequireAuth` 匿名分支不再渲染「需要登录」Result，改为 `<Navigate to="/login?from=...">`（`buildLoginRedirect` 对非 `/` 开头、`//` 开头或指向 `/login` 的目标回退 `/login`）；登录成功后按 `from` 回跳，页面侧 `resolveLoginTarget` 再次校验。`AppLayout` 在 `/login` 只渲染 `<Outlet />`；`LoginForm` 新增 `variant="brand"`（默认 `"default"` 行为不变），品牌样式收敛在 `apps/web/src/pages/login/login-page.css` 的 `.login-card` 作用域；新增素材 `apps/web/public/libiao-robotics-logo.png`。`status === "error"` 的 500「登录状态异常」Result 与 `RequireAdmin` 403 空态语义未变，仍由既有 E2E 约束。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| LOGIN-UI-001 | 浏览器 E2E | 匿名直达登录页 | 匿名访问 `/search` 与 `/projects` 均不再出现「需要登录」，`waitForURL(/\/login\?from=/)` 后 `from` 参数等于原目标，`login-page` 容器、`Libiao Robotics` 标志与「登录名 / 密码」两个可访问标签可见，「需要登录」不可见 | 本地通过（`apps/e2e/tests/auth.spec.ts` 5/5，2026-09-12） |
| LOGIN-UI-002 | 浏览器 E2E | 品牌表单与黄色主按钮 | 登录页提交按钮计算样式 `background-color` 为 `rgb(247, 200, 0)`，品牌表单与标志渲染 | 同上 |
| LOGIN-UI-003 | 浏览器 E2E | 登录后回跳 `from` | 匿名打开 `/projects` 被送到登录页，完成真实登录后落回 `/projects` 并看到「项目与功能」标题 | 同上 |
| LOGIN-UI-004 | 单元 | 登录跳转目标校验 | `buildLoginRedirect` 对 `/projects/7?tab=1` 生成 `/login?from=%2Fprojects%2F7%3Ftab%3D1`；对非 `/` 开头、`//` 开头、`/login`、`/login?from=x` 一律回退 `/login`；`RequireAuth` 匿名时不渲染 `auth-anonymous` 且携带 `replace` | 本地通过（`apps/web/src/app/auth/auth.test.tsx`） |
| LOGIN-UI-005 | 单元 | 品牌 variant 渲染 | `variant="brand"` 渲染 `form.login-form.login-form-brand`、提交按钮带 `login-submit`、无 `.ant-form-item-label`（`label` 由 `aria-label` 提供），提交仍调用 `client.login`；默认 variant 行为不变 | 本地通过（`apps/web/src/features/auth/LoginForm.test.tsx`） |

本地实际执行（2026-09-12，PostgreSQL 18.6 + PGroonga，`E2E_API_PORT=3111` / `E2E_WEB_PORT=4181`）：`pnpm --filter @inpulse/web test:unit` 69 文件 342 例、`pnpm --filter @inpulse/web typecheck`、`apps/e2e` `tsc --noEmit`、`pnpm lint`、`pnpm format:check`、`pnpm --filter @inpulse/api build`、`pnpm --filter @inpulse/web build` 通过；`pnpm check:frontend:boundaries`（226 模块 1029 依赖）、`pnpm check:deps`（656 文件）、`pnpm check:secrets`（963 文件）、`pnpm check:docs`（75 个 Markdown）通过；全量 `pnpm test:e2e` 53 通过 + 2 失败（9.5 分钟；`auth.spec.ts` 单独复跑 5/5 通过），失败为既有偶发族，见下；视觉按 1536×1024 与 414×896 两档截图逐项对照设计稿，移动端无横向溢出。

未运行 / 已知偏差：① 本片 GitHub Actions 结果见 PR #134 检查记录；② 未运行 `pnpm test:integration` 与整体 `pnpm check`（本片无后端、契约、迁移与角色改动；整体 `check` 的 `deps:audit` 在本机 npm 镜像必然失败，改以公共 registry `pnpm audit --registry=https://registry.npmjs.org --audit-level=high` 验证无已知漏洞）；③ 新增 E2E 用例与登录页视觉需非作者人工评审；④ 全量 E2E 本轮 2 例失败（`module-tasks` F-15 保存后弹窗 10 秒内未关闭、`notifications` 标记未读未生效）属既有偶发族（根因见 2026-09-11 条目），两文件单独复跑 2/2 通过、根因未定位，不得视为已修复。

## 前端交互大改与 e2e 超时真因定位（C，2026-09-12 本地落库）

按产品要求「UI 与交互完全对齐设计师稿 `D:\design\latest-version`、逐功能点核对前后端、数据用 Docker 容器 PostgreSQL」对前端做整体改造，并用 Playwright `trace.zip` 逐个定位此前只能在 `finally { context.close() }` 处报超时的用例。**登录页按产品要求保持不变。**

### 修复的 e2e 超时 / 失败真因

此前 `pnpm test:e2e` 全量 46 passed / 9 failed，其中数例报错位置全在 `finally` 的 `browserContext.close`（主体无断言错误，而是某步无限等待）。用「合并全部 `*-trace.trace` chunk 的 `before` / `after` 事件差集」定位到卡住的那一步后，确认为 4 个真实缺陷 / 定位器缺陷：

| # | 用例 | 卡住的选择器 | 真因 | 修复 |
|---|---|---|---|---|
| 1 | `module-tasks.spec.ts` | `.calm-feature-card >> has-text 模块名 >> link "模块任务"` | 「模块任务」链接在 `.calm-feature-card` 的**兄弟**节点 `span.catalog-edit-link` 内（`ModulesPageView.tsx`），而「查看功能」才在卡片内；同一 `moduleCard` 作用域既查卡片内又查卡片外，后者永久挂起 | 父范围改为两者共同的 `article.catalog-module-wrap`（变量名同步为 `moduleEntry`） |
| 2 | `audit.spec.ts`（4 处） | `button "查询"` / `button "重置"` | 审计页工具栏误挂 `.task-toolbar`，而 `design-system.css` 的 `.task-toolbar > .secondary-button { display: none }` 是设计稿**刻意隐藏**规则 → 两个按钮被隐藏；`applyFilters` 只以「查询」按钮为唯一入口（无 `form onSubmit`、无 Enter 处理）→ **审计筛选功能完全不可用** | 去掉 `task-toolbar` 类；在 `inpulse-design.css` 用 `.activity-toolbar.audit-toolbar > .secondary-button` 显式还原次级按钮外观并写死 `display: inline-flex`，防止再次被隐藏 |
| 3 | `record-publishing.spec.ts`、`task-groups.spec.ts`（3 处） | `role=dialog[name="任务详情"] >> button "关闭"` | `TasksPanel.tsx` 任务详情弹层只传 `label` 未传 `title` / `eyebrow`，而 `AppModal.tsx` 的 `hasHeader = eyebrow !== undefined \|\| title !== undefined` **不认 `label`** → 整个 `.drawer-header`（含关闭按钮）不渲染。正文另用 `.task-modal-header` 自渲标题区，造成「像有头部但没有任何关闭按钮」 | `.task-modal-header` 补回 `drawer-header` 类并内联关闭按钮（`aria-label="关闭任务详情"`），与设计稿 `task-modal.tsx:150` 一致；移除已无意义的 `closeLabel` |
| 4 | `task-groups.spec.ts` | `getByTestId("task-group-notice")` 期望含「接口说明：」 | 该黄条是开发期接口说明（含内部路由编号 R-1 / R-4），设计师稿的聚合组区块没有它；`aggregate-views.spec.ts` 已对 F-32 / F-29 做同样处理（断言 mock 提示计数为 0），任务聚合组页漏改 | 按同一约定从 `TaskGroupAdapter` 移除已无消费方的 `notice` 字段与 `TASK_GROUP_SERVER_NOTICE`；两处断言改为「`/接口说明/` 计数为 0」并写明依据 |

### 后端缺陷：幂等保留期零余量（500 偶发族根因）

`idempotency_records_retention_check` 是本次容器内**违反次数最多**的约束（183 次，第二名为 35 次），表现为写接口间歇 500（`INTERNAL_ERROR`）。

- `apps/api/src/idempotency/http-service.ts` 以应用进程时钟计算 `expiresAt = Date.now() + 30 天`（**恰好 30 天整、零余量**），而 `created_at` 取数据库 `now()`；实测本机 JS `Date.now()` **慢于容器 DB `clock_timestamp()` 44–50 ms**（5 次采样稳定）→ `expires_at <= created_at + INTERVAL '30 days'` 必然越界 → `23514` → 整事务回滚 → 500。
- 修复：`apps/api/src/idempotency/store.ts` 改为 SQL 侧 `least(${expiresAt}::timestamptz, now() + interval '30 days')` 夹取。选 `least` 而非「应用侧减 60s」，是为了在极限偏差下仍保留满 30 天窗口。
- 证据：`apps/api/test/idempotency-runner.integration.test.ts` 新增跨时钟偏差回归用例（4/4）；并做**负向对照**——临时改回直接传应用侧 `expiresAt` 立即复现 `violates check constraint`，恢复夹取后通过。
- 同类代码点评估后未改：`apps/api/src/auth/csrf.http.ts` 的 `PREAUTH_MAX_AGE_SECONDS = 9 * 60` 对 10 分钟上限留有 1 分钟余量。
- **修复有效性验证**（容器日志实测，非推断）：`idempotency_records_retention_check` 最后一次出现为 `2026-09-12 15:01:33`，此后至 23:36 共 8.5 小时内**零新增**，期间完成了 `pnpm build` 多次、全量集成与全量 E2E（55 例）等高写入负载；约束违反总数停在 184（修复前 183）。对照数据：`preauth_sessions_consumed_at_check` 3 次、`task_group_members_snapshot_check` 35 次、`external_links_*` 48 次、`search_projection_entity_type_check` 19 次——后三者为集成测试的**负向用例刻意触发**，非缺陷。

### 已取代的历史断言

- F-32 / F-29 / F-25 的「接口说明：」断言（本文档 L723、L738 行）由本次改为「开发期说明计数为 0」，行内已标注。
- `TaskGroupAdapter.notice` 与 `TASK_GROUP_SERVER_NOTICE` 已删除；`TaskGroupPageView.test.tsx`、`TaskGroupPage.test.tsx` 的 `notice` 夹具同步移除。

### 本轮定向验证（2026-09-12，PostgreSQL 18.6 + PGroonga，`E2E_API_PORT=3201` / `E2E_WEB_PORT=4173`）

`pnpm build` 全 workspace 通过后，定向 `pnpm test:e2e "audit.spec.ts" "module-tasks.spec.ts" "record-publishing.spec.ts" "task-groups.spec.ts"` 首轮 6/7（仅剩真因 4），补齐真因 4 后 `task-groups.spec.ts` 2/2；`task-groups.spec.ts` 首个用例耗时由 16.2 s（含 10 s 断言超时燃烧）降至 7.0 s。

**全量 `pnpm test:e2e` 结果：55 passed / 0 failed（5.1 分钟）**。对照基线为 46 passed / 9 failed（16.6 分钟）——即 5 个真因与幂等 500 修复后，既有的全部失败归零，总耗时约为基线的三分之一。其中此前只在全量运行时才复现的两例（`csrf.spec.ts:103` 多标签 CSRF、`features.spec.ts:95` 功能归档恢复）与另两例（`module-tasks.spec.ts:5` F-15 保存后弹窗未关、`notifications.spec.ts:17` 标记未读未生效）本轮全部通过。关键用例耗时：`audit.spec.ts:29` 4.9 s（基线 240 s 超时）、`module-tasks.spec.ts:5` 17.1 s（基线永久挂起）、`record-publishing.spec.ts:66` 7.8 s、`task-groups.spec.ts:14` 6.8 s（基线 16.2 s）、`task-groups.spec.ts:124` 9.9 s。

其余门禁：`pnpm --filter @inpulse/web typecheck`、`pnpm --filter @inpulse/e2e typecheck`、`pnpm --filter @inpulse/ops typecheck`、`pnpm check:frontend:boundaries`（235 模块 / 1107 依赖，0 违规）、`pnpm --filter @inpulse/web exec vitest run src/features/task-groups src/pages/task-groups`（4 文件 22 例）、`src/features/tasks`（4 文件 31 例）、`apps/api/test/idempotency-runner.integration.test.ts`（4/4，含负向对照）通过。

未运行 / 已知偏差：① 本节为前端交互大改的中间记录，`pnpm lint`、`pnpm check` 与 GitHub Actions 结果以随后条目为准；② 真因 2 的修复依赖 `inpulse-design.css` 补充层选择器，属仓库扩展（设计师稿没有审计页）；③ 真因 3 的修复影响全部任务详情弹层，需非作者人工评审；④ 后端 `idempotency/store.ts` 修复超出「前端大改」标题范围，但由 500 偶发族直接驱动，产品已授权「如果有问题你可以修改」；⑤ 视觉差异未归零，主因是内容量与页面高度不同（如 tasks 1099 vs 1337、records 2799 vs 1030），不属本次已修复缺陷范围；⑥ `pnpm check` 与 `pnpm test:web` 出现 `apps/web/src/features/auth/MfaForms.test.tsx` 的 `registers TOTP, shows recovery codes once and completes login` 超时（5159–5164 ms，vitest 默认 `testTimeout` 5000 ms），**属既有计时敏感偶发失败、本批未修复**，判定依据：该文件在本分支零改动（`git log` 最后修改为 `d2c5bbc`，PR #63）；其导入闭包（`LoginForm.tsx` 传递闭包 10 个文件）经脚本枚举**不含任何本分支改动文件**；该文件单独复跑 4/4 通过（4.92 s），全量 `pnpm test:web` 第二次运行 69 文件 360 例全通过，仅在并行负载下越过 5000 ms。同族先例见本文档 L833 第 ⑥ 条与本条 ⑤。**建议处置**（需非作者人工确认，本批未执行）：为该用例加显式 `timeout`，或为 `apps/web/vitest.config.ts` 设定 `testTimeout`；不得用 `skip`、降低断言或删用例规避。
⑦ 同类时钟偏差代码点 `apps/api/src/auth/preauth-session.repository.ts` 的 `consumedAt: Date = new Date()`（约束 `preauth_sessions_consumed_at_check`: `consumed_at IS NULL OR consumed_at >= created_at`）与已修复的幂等保留期为同一族零余量比较，但**本次未改**：容器日志 3 次出现集中在 `2026-09-10 07:31:54` / `2026-09-11 03:01:57` / `2026-09-11 03:04:37`，本批多次全量集成与全量 E2E 零复现；该处属鉴权路径，改动需人工评审，故仅登记为风险，不建议在无复现证据时修改。

### 任务中心工作状态分段控件：列表标题、计数、内容与空态未跟随（2026-09-13）

用户反馈「任务中心按项目视图不管怎么切换都是未完成 / 没有数据」。取证结论分两层：

1. **分段控件本身工作正常**：点击「已完成 / 全部」后 URL 与请求都正确变化（`status=done` → `workStatus=DONE`；`status=all` → 不带 `workStatus`）。
2. **视图渲染是缺陷**：`TaskCenterPageView.tsx` 的列表标题写死 `title="未完成"`、hint 恒取 `openItems.length`、空态写死「没有匹配的未完成任务」，且主列表恒取 `openItems`。因此 `done` / `all` 下虽然拿回了数据，页面仍显示「未完成 0 项」加空态，视觉上等于切换无效。

设计师稿 `D:\design\latest-version\apps\web\src\views\task-center.tsx` L319 存在**同一处硬编码**（`title="未完成"` + `openList`），本次按「列表跟随当前工作状态」的正当预期修复，属对设计师稿的增强，不改变其视觉基线（`.calm-section-title`、`.calm-empty-state`、`.calm-disclosure` 结构不变）。

| 用例 | 断言 | 结果 |
| --- | --- | --- |
| 列表标题随分段控件变化 | `status=all` → 标题「全部任务」且已完成任务直接可见、无空态 | `TaskCenterPageView.test.tsx` 通过 |
| 空态文案随分段控件变化 | `status=done` + 空结果 → 标题「已完成」、空态「没有匹配的已完成任务」 | 同上 |
| 未完成为空时自动展开已完成折叠面板 | `status=open` + 仅已完成 → 空态「没有匹配的未完成任务」且 `details[open]` 内可见该任务 | 同上 |
| 按项目空态说明服务端边界 | `scope=project` + 空结果 → 文案含「只返回你负责的任务」 | 同上 |
| 真实 UI 切换 | `aggregate-views.spec.ts` 切到「已完成」后 `.calm-section-title h3` 为「已完成」、旧文案计数为 0 | E2E 2/2 通过 |

浏览器实测（5199，已登录特哥，`/tasks?scope=project&project=1`）：`status=all` → 标题「全部任务」+ 卡片 `my-task-9`；`status=done` → 标题「已完成」+ 卡片 `my-task-9`；`status=open` → 标题「未完成」+ 空态与上述边界说明。

**数据量稀少的契约原因（非缺陷，不得自行放开）**：R-3 `listMyTasks` 的负责人固定为当前会话用户，特哥在 project 1 仅 1 个 DONE 任务（DB 实测：project 1 共 53 个任务，其中特哥仅 1 个）。「按项目看他人任务」需要新增归属参数与复合索引并经 A 裁决，仍属延后项。

本轮定向验证：`pnpm --filter @inpulse/web exec vitest run src/features/my-tasks`（5 文件 63 例）、`pnpm test:web`（69 文件 364 例）、`pnpm typecheck`、`pnpm build`、`pnpm --filter @inpulse/e2e exec playwright test tests/aggregate-views.spec.ts`（2/2）、全量 `pnpm test:e2e`（55 passed / 0 failed，4.5 分钟）、`pnpm lint`、`pnpm format:check`、`pnpm check:docs`（75 个 Markdown）全部通过。

### 任务中心「我创建的」tab 不可点：`ownership` 自指维度扩展（2026-09-13）

产品反馈「我创建的这个按钮点不了 在任务中心」。取证与裁决：

1. **现象**：`.task-view-tabs` 中「我创建的」tab 带 `disabled`，无法点击；`my-tasks-v1-query.ts` 的 `MY_TASKS_V1_FILTER_SUPPORT["scope:created"] = false` 是其唯一来源。
2. **后端能力已存在，只是未被使用**：`my-tasks-query.service.ts` 把自指维度硬编码为 `assigneeId: command.actorUserId`，而 `PostgresMyTaskQueryPort` 与 `app.tasks.creator_id` 早已具备 creator 维度；`listHistoricalSourceTaskIds` 的排除逻辑对两个维度同样适用。
3. **设计师稿语义**：`D:\design\latest-version\apps\web\src\views\task-center.tsx` 的「我创建的」判定为 `task.creatorId === data.currentUser.id`，与「负责人」维度相互独立。
4. **裁决**：新增契约参数 `ownership: "ASSIGNEE" | "CREATOR"`（缺省 `ASSIGNEE`，向后兼容），**不扩张授权范围**——两个取值都仍是「当前会话用户自指」维度，不引入跨用户查询；「按项目查看他人任务」与 `scope=all` 仍保持原有边界（见上一节）。
5. **统计口径**：`stats`（`myOpen` / `dueToday` / `overdue` / `completedThisMonth`）恒按负责人口径计算，与统计卡文案「我负责的」一致，避免列表切到 `CREATOR` 时统计数字与列表内容口径漂移。

随契约同步的产物：`packages/api-contract` 的 Schema 与 Route Registry、OpenAPI、生成指纹与生成客户端（`ownership?: ("ASSIGNEE" | "CREATOR")`）、权限矩阵、Controller / Service / Port、前端查询层与 tab 状态、测试与 E2E 断言——同一工作区一次性完成，无生成物漂移（`pnpm contract:drift`）。

**索引与迁移**：新增 `tasks_creator_status_idx(creator_id, work_status, id)`，迁移 `0009_tasks_creator_index.sql`（sha256 `18fa0b251609ef10`，`pnpm db:migrations:check` 校验 10 个迁移通过）。`database/schema/work.ts` 与 SQL 迁移同步。

| 用例 | 断言 | 结果 |
| --- | --- | --- |
| 契约接受 `ownership=CREATOR` 且拒绝非法值 | Schema `.strict()` 枚举校验；未传时按 `ASSIGNEE` | api-contract 单测通过 |
| 服务层按 `ownership` 分派过滤维度 | `CREATOR` → `{ creatorId: actorUserId }`，其余 → `{ assigneeId: actorUserId }` | `aggregate-read.service.test.ts`（24 例）通过 |
| 端口 SQL 支持 creator 维度并正确分页 | `list` / `stats` 均带 `AND (creatorId::integer IS NULL OR t.creator_id = creatorId)`；游标与 `hasMore` 语义不变 | `aggregate-read-ports.integration.test.ts`（19 例）通过 |
| `creator` 过滤命中索引且不回退 Seq Scan | `EXPLAIN (ANALYZE, BUFFERS)` 计划含 `tasks_creator_status_idx`，匹配 `Index Only Scan|Index Scan|Bitmap Heap Scan`，且**不含** `Seq Scan on tasks`（批量夹具 200 任务 + 单条 creator 记录） | 同上，通过 |
| HTTP 契约与授权 | `GET /api/v1/me/tasks?ownership=CREATOR` 200 且只返回当前用户创建的任务；跨用户不可见 | `aggregate-read-api.integration.test.ts`（20 例）通过 |
| 前端 tab 可用且请求携带 `ownership` | `scope=created` → tab `disabled:false`、URL 保留 `scope=created`、请求含 `ownership=CREATOR` | `my-tasks-v1-query.test.ts`、`my-tasks-server.test.ts`、`TaskCenterPageView.test.tsx` 通过 |
| 真实 UI | `aggregate-views.spec.ts`：「我创建的」断言由 `toBeDisabled()` 翻转为 `toBeEnabled()`，并校验切换后 URL 与列表渲染 | E2E 2/2 通过 |

**「我创建的」在本地数据下为空是数据现实，不是缺陷**：容器库 `app` 中用户 `xiaopan`（id 2）只创建了 `INPULSE-T-21`，而该任务已是聚合组 `TG-1` 的活跃 `SOURCE`（`task_group_members.detached_at IS NULL`），按设计被 `listHistoricalSourceTaskIds` 排除（与「我负责的」同一规则）；他在 project 1 的其余 15 个任务都是 `assignee` 而非 `creator`。因此该 tab 现在**可点击、会发请求、会正确渲染空态**，只是真实数据下没有可展示条目。

### `/records` 持续 500：dev 环境连接角色错误（非代码缺陷，2026-09-13 排障记录）

前置条件：dev 环境改为指向本工作区的最新构建（Vite dev `5199` 经 `VITE_API_PROXY_TARGET` 代理到新 API），登录小潘后 `/records` 稳定 500。

- 抓包：`GET /api/v1/change-records?status=PUBLISHED&source=ALL&limit=20` → `{"code":"INTERNAL_ERROR","message":"服务器无法完成迭代记录查询"}`；8 组筛选参数组合全部 500；`limit=200/201` 正常返回 422（契约上限 100）；同一会话的 `GET /api/v1/me/tasks` 与 `GET /api/v1/search` 均为 200。
- 定位：`record-feed.controller.ts` 的 500 分支 → `RecordFeedQueryService.list` → `PublishedRecordRepository.listFeedPage`；在容器内手工重放该 SQL 得到 **`ERROR: operator does not exist: text &@~ text`**（`sp.normalized_search_text &@~ app.pgroonga_query_escape($1)`）。
- 根因：PGroonga 扩展安装在 schema **`app`**，`&@~` 运算符族全部属于 `app` schema；而启动该 API 实例时 `DATABASE_URL` 用了 `cluster_bootstrap`，其角色级 `search_path` 是 `"$user", public`，无法解析该运算符。**该 SQL 无条件包含这段子查询（即使没有查询词），所以 `/records` 一打开必然 500。**
- 修复：dev API 改用 `DATABASE_URL=postgresql://app_runtime@127.0.0.1:55432/app`（`database/bootstrap/000_roles.sql` 为该角色设置 `SET search_path = app, pg_catalog`），审计读取链路用 `AUDIT_DATABASE_URL=postgresql://audit_reader@127.0.0.1:55432/app`。**这正是 `apps/e2e/helpers/runtime.ts` 与生产 Compose 一直使用的角色，因此 E2E 与 CI 从未暴露该问题，仅影响手工启动的 dev API。**
- 复验：`/records` → 200（20 条）、无 `role="alert"`；全站 8 个页面（`/tasks`、`/projects`、`/projects/1/overview`、`/records`、`/issues`、`/activity`、`/search`、`/settings`）无 alert、无 console error（`/settings` 对非管理员显示「无权访问」属正确行为；`/search` 仅一条 antd `Space direction` 弃用告警）。

本轮门禁（2026-09-13，工作区未提交）：`pnpm --filter @inpulse/api test:unit`（352 例）、`pnpm test:web`（69 文件 367 例）、全量 `pnpm test:e2e`（55 passed / 0 failed）、`pnpm check:deps`（660 文件）、`pnpm check:frontend:boundaries`（235 模块 / 1107 依赖）、`pnpm check:secrets`（975 文件）、`pnpm check:deploy:test`（5 refs）、`pnpm db:migrations:check`（10 迁移）、`git diff --check` 全部通过。

**待人工评审项**：迁移 `0009` 属数据库变更（新增索引），按仓库规则必须人工评审；`ownership` 为契约新增参数，虽缺省行为不变，仍需非作者复核。

### 项目/模块/功能卡整卡点击、卡片内 GitHub 区域与记录正文数据订正（C，2026-09-13）

产品反馈三条：①「迭代记录这个 inpulse 里面的内容太详细了 不像正常使用者总结的话语，请你全部修改数据库的内容，要精简一点，不要这样是看不懂的代码，尽量按照功能点去描述；另外迭代记录现在看不到 github 链接和设计师稿不一样」；②「项目与功能点、功能与项目的卡片不能直接点击卡片，和设计师稿还是不一样，卡片布局的效果也不一样，跳转逻辑不一样」；③「把这些测试账号清掉，这个 github 链接按钮不要放在这，而且有 bug，按这个链接也有按卡片的效果这是不对的，链接放在对应的卡片那里就好了」。

#### 1. 记录正文数据订正（容器库 `app`，正式记录 46 条 / 版本 47 条）

- **取证**：`app.change_records.current_payload` 与 `app.change_record_versions.payload` 的四个段落（`contextProblem` / `changeSolution` / `resultVerification` / `remainingIssues`）原文是迁移脚本与内部实现术语（表名、路由编号、幂等键、锁序），不是使用者能读懂的交付总结。
- **处置**：生成并执行 `rewrite-records.sql`（151101 B，逐记录逐版本按功能点重写四段，保留 `row_version` 递增与触发器约束），执行前用 `app-20260913-192231` 之外的记录级 JSON 备份 `records-backup-20260913-192231.json` 留档。
- **结果核对（容器库实测）**：正式记录 46 条、草稿 3 条、版本 47 条；`current_payload` 平均 654 B / 最大 925 B，版本 `payload` 平均 656 B / 最大 925 B；四段均为完整中文句子，例如记录 1 的 `changeSolution` 为「正式记录清单与草稿清单都改为分页加载，每页默认 20 条，可继续加载更多。翻页位置由服务端签名，客户端无法伪造，也无法跨项目翻页。……」。
- **同步**：`search_projection` 的 `CHANGE_RECORD` 行随之刷新（实测 46 行），标题与摘要与新正文一致。

#### 2. 记录详情的 GitHub 区域改为页内直接展示（`ExternalLinksPanel variant="inline"`）

设计师稿的迭代记录详情把 GitHub 证据直接排在正文下方，而仓库实现此前只给了一个「GitHub 链接」按钮 + 弹层。本次：

- `PublishedRecordDetail.tsx` 的 `.record-github` 区块改为 `<ExternalLinksPanel variant="inline" .../>`：直接列出已关联链接（类型徽章 + 新窗口链接 + 编号），下方是折叠式「＋ 添加 GitHub 链接」入口，展开后填 URL 并「确认添加」。（2026-09-16 按产品反馈再收一层：链接列表可能过长，「GitHub 关联」标题改为折叠开关，默认收起且不挂载面板、不发列表请求，点击展开后才就地渲染；`apps/e2e/tests/external-links.spec.ts` 在断言记录详情内链接前先点开该开关。）
- `RecordDraftsView.tsx` 的草稿详情同步为同一形态。

#### 3. 卡片整卡可点击（项目 / 模块 / 功能三层一致）

HTML 不允许按钮内嵌链接/按钮，因此三层卡片统一采用「容器 + 点击委托」：

- 新增 `apps/web/src/features/common/card-click.ts` 的 `isCardClick(event)`：已阻止默认、非左键、带修饰键、目标不在当前容器内、或目标命中 `a[href], button, summary, input, textarea, select, label` 时一律不触发整卡动作。
- 项目卡、模块卡、功能卡各自加 `onClick` / `onKeyDown` / `tabIndex`，并保留卡内操作按钮的独立行为。
- **未采用** `role="link"`：会让 `getByRole("link", { name: "查看功能" })` 产生歧义（实测否决）。

#### 4. 卡片内嵌弹层误触发整卡跳转（门控缺陷，已修 + 回归）

- **症状**：项目卡底部点「GitHub 链接」打开弹层后，点弹层里的普通段落文字会让 URL 从 `/projects` 跳到 `/projects/1/modules`。
- **真因**：antd Modal 经 `ReactDOM.createPortal` 渲染到 `document.body`，DOM 上已不在卡片内，但 React 合成事件仍沿 React 树冒泡到卡片 `onClick`；旧守卫只查 `closest("a[href], button, ...")`，`<p>` / `<code>` 不匹配 → 误判为整卡点击。
- **修法**：`isCardClick` 增加 DOM 包含关系判定（`event.currentTarget.contains(target)`），React 树与 DOM 树不一致时以 DOM 为准。
- **回归用例**：`apps/web/src/features/common/card-click.test.tsx` 4 例，含 portal 用例（已用「临时禁用守卫」反向验证该用例确实能捕获此缺陷）。

#### 5. 项目卡移除 GitHub 入口、改到项目详情页头部

- 设计师稿 `catalog.tsx` L367-383 的项目卡**只有两行 footer，没有任何操作行**，也没有 GitHub 相关代码；仓库此前多出的 actions 行本身即偏离设计稿。
- 本次从项目卡删除 `ExternalLinksPanel`（含 import），并按产品「链接放在对应的卡片那里就好了」的含义把入口放到**项目详情页头部动作区**（`ProjectOverviewPage.tsx` 的 `extraActions`，位于「成员与设置」与「新建任务」之间）。**此位置在设计师稿中没有对应元素，属有意扩展，需人工确认。**
- 回归用例：`ProjectsPageView.test.tsx` 新增「keeps GitHub links off the project card, matching the design reference」。

#### 6. 测试账号与测试项目清理（破坏性操作，已备份）

- 现象：容器库 `app.users` 共 504 行，其中 374 行为 `Test user_*`；`app.projects` 共 368 行，绝大多数为 Playwright / 集成测试每次运行新建的项目。这些数据把真实用户挤出用户目录的 300 条窗口（表现为迭代记录作者显示成「用户 #1」）。
- 处置：`pg_dump` 全库备份 → `cleanup-test-accounts.sql` dry-run → 正式执行。脚本只针对 `app.users.id >= 5` 与 `app.projects.id <> 1`，前置 `DO $$` 校验演示项目 1 不引用任何待删对象，删除前对 `app` schema 全表 `DISABLE TRIGGER USER`（否则 `protect_unclassified_module` 等触发器会阻止删除），按依赖序删除后 `ENABLE TRIGGER USER` 并自检 `projects = 1`、`users = 4`、`project_members(1) = 4`、`tasks / change_records / features(1)` 非空。
- 结果（实测）：`users` 4 行（`tege` 特哥 / `xiaopan` 小潘 / `xiaowu` 小吴 / `xiaoshao` 小邵）、`projects` 1 行（`INPULSE` / InPulse 研发交付平台）；演示数据完整保留 —— `tasks` 53、`change_records` 49、`activity_projection` 193、`notifications` 202。
- 备份位置（本机临时目录，不入库）：`%TEMP%\inpulse-local\db-backups\app-20260913-213018.dump`（970911 B）。
- **脚本可安全重跑**：只删 `id >= 5` 的账号与 `id <> 1` 的项目，即 E2E / 集成测试新造的数据；每次跑完全量 E2E 或集成测试后重跑即可恢复干净演示态。

#### 7. `external-links.spec.ts` 适配记录详情的内联形态（测试语义修正，非缺陷修复）

记录详情改内联后，`GitHub URL` 输入框默认**折叠**，必须先点「＋ 添加 GitHub 链接」。旧用例仍按「点 GitHub 链接按钮 → 弹层里填 URL」编写，因此在 `fill(... label="GitHub URL")` 处等待至 120 s 超时（trace 证据：该步耗时 17.1 s 后无后续事件）。

- 新增 `addInline(scope, url, label)` 辅助函数：展开 → 填 URL → 「确认添加」→ 断言链接可见并校验 `target="_blank"` / `rel="noopener noreferrer"`。
- 第二、三个断言段改为对 `detail` 区域内链接的直接断言，移除弹层交互与「关闭关联」。

#### 8. 本轮定向验证与门禁（2026-09-13，容器库 PostgreSQL 18.6 + PGroonga）

| 检查 | 结果 |
| --- | --- |
| `pnpm --filter @inpulse/e2e exec playwright test tests/external-links.spec.ts` | 2 passed（19.4 s） |
| `project-archive` / `modules` / `features` / `aggregate-views` / `visual-migration` 定向 | 7 passed（50.6 s） |
| 全量 `pnpm test:e2e` | 首次 `47 passed / 8 failed`（全部为断言漂移）→ 修正后 `55 passed / 0 failed`，见下节 §9 |
| `pnpm test:web` | 72 文件 388 例通过 |
| `pnpm lint` / `pnpm format:check` / `pnpm typecheck` | 通过 |
| `pnpm check:docs`（75 个 Markdown）/ `pnpm check:deps`（667 文件）/ `pnpm check:frontend:boundaries`（242 模块 / 1150 依赖） | 通过 |
| 浏览器实测（Vite dev `5199`） | 项目卡已无 GitHub 按钮；点卡片描述正确进入项目模块页；项目详情页头部出现「GitHub 链接」；弹层内点段落 URL 不再变化 |

未运行：`pnpm test:integration`、`pnpm check`（整链）、`pnpm build`、GitHub Actions。

**待人工评审项**：①「GitHub 链接」放在项目详情页头部是设计稿之外的扩展；②测试账号与测试项目清理属破坏性数据操作（已备份，脚本可重跑）；③`external-links.spec.ts` 的改动属测试语义同步，非产品缺陷修复；④记录正文批量改写（46 条正式记录 + 47 个版本）改变了演示数据内容，口径需人工确认（有记录级 JSON 备份）。

#### 9. 记录摘要行结构迁移引发的 8 个 e2e 断言漂移（测试语义修正，非缺陷修复，2026-09-13）

全量 `pnpm test:e2e` 在有本轮 UI 改动的工作区上跑出 `47 passed / 8 failed`。用 `apps/e2e/test-results/**/error-context.md` 逐个取证后确认：**8 个失败全部是断言过期，没有产品缺陷**，归为 3 类根因。

| 根因 | 涉及用例 | 真因 | 处置 |
| --- | --- | --- | --- |
| A. 编号/状态行移到卡片摘要行（5 个） | `leftover-task` 3 例、`record-feed` 2 例、`record-publishing` 4 处、`task-completion` 2 例 | 「记录编号 · 版本 · 状态」现在渲染在卡片外层 `<summary>`（`{code} · v{n} · 发布 {时间} · {作者}`），状态「已发布」是独立徽章，不存在「发布已发布」连写 | 改为在 `details.record-card` 的 `summary` 上断言 `/-CR-\d+ · v{n} · 发布/` 与 `.record-summary-badges` 含「已发布」 |
| B. 版本对比区按版本数条件渲染（1 个） | `record-lifecycle` | `history.length > 1` 才渲染版本对比区，单版本记录不再显示「较早版本 / 对照版本 / 版本差异」；设计师稿 `VersionHistory` 同样在 `versions.length < 2` 时返回空 | 删除单版本场景下对版本对比控件的断言，改为断言正文内容仍可读 |
| C. 记录标题移出详情区（2 个） | `task-completion` FEATURE / MODULE | `record-expanded-head`（含 `<h3>{title}</h3>`）只在独立详情形态（`standalone`）渲染；列表内展开的卡片把标题放在外层 `<summary>`，与设计师稿 `record-card.tsx` 一致 | 改为在卡片摘要行断言标题，详情区域内改断言「查看来源任务」链接 |

派生的一处补充取证：`record-lifecycle` 恢复记录后，记录离开「已作废」筛选列表，页面**回落为独立详情形态**（`error-context.md` 快照显示独立头部的 `-CR-1 · v1 · 已发布` 与 `<h3>` 标题），因此该处保留对独立详情头部文案的断言。

**新增回归用例**：`apps/web/src/features/published-records/PublishedRecordDetail.test.tsx` 增加 2 例 —— ① 非独立形态下详情区域内**不出现**记录标题与「编号 · 版本 · 状态」行（归属、作者等事实仍在）；② 单版本记录**不渲染**「较早版本」控件。

**同轮暴露并修复的一处测试环境脆弱性**：全量集成测试在清理测试数据后出现 1 例失败 —— `apps/api/test/aggregate-read-ports.integration.test.ts` 的「creator 归属过滤命中 `tasks_creator_status_idx`」断言拿到了走 `tasks_project_status_idx` 的计划。取证（`EXPLAIN (ANALYZE, BUFFERS)` 实际输出）显示规划器把刚插入 200 行的夹具项目估成 **2 行**（`Bitmap Index Scan on tasks_project_status_idx ... rows=2` / `Rows Removed by Filter: 200`），即清理演示数据后表规模骤降、统计信息严重滞后，规划器在两条等价索引间改选了当时估计更便宜的一条；`app_runtime` 无 MAINTAIN 权限，原本注释以「夹具库规模小、无法 ANALYZE」为由只关 `enable_seqscan`，无法覆盖这一情形。处置：该文件的 `explain()` helper 改由 `testUrls().bootstrap`（CI 与本地均为超级用户）先执行 `ANALYZE app.tasks, app.change_records` 再取计划，断言强度不变（仍要求命中 `tasks_creator_status_idx` 且无 `Seq Scan on tasks`）。修复后该文件 19/19、真实 PostgreSQL 集成全量 **51 文件 447 例全绿**（108 s）。

**定向验证**：`record-lifecycle` / `leftover-task` / `task-completion` 3 文件 7 例通过（59.5 s）；`record-publishing` / `record-feed` 2 文件 3 例通过。**全量**：`55 passed / 0 failed`（4.6 分钟，容器库 PostgreSQL 18.6 + PGroonga，`E2E_API_PORT=3201` / `E2E_WEB_PORT=4173`）。

**待人工评审项**：⑤ 上述 8 处 e2e 改动均为测试语义同步，需非作者确认「摘要行承载状态」的产品口径；⑥ 段落小标题已收敛，见下条。

### 迭代记录段落小标题收敛（C，2026-09-14 本地落库）

产品反馈设计师稿的段落小标题与仓库长版不一致（仓库为「为什么改、发现了什么问题 / 改了什么、怎么改的 / 改完效果如何、如何验证 / 还有什么问题」）。本轮统一为设计师稿短版：

| 字段（契约名不变） | 旧显示标签 | 新显示标签 |
| --- | --- | --- |
| `contextProblem` | 为什么改、发现了什么问题 | 改动原因 |
| `changeSolution` | 改了什么、怎么改的 | 具体改动 |
| `resultVerification` | 改完效果如何、如何验证 | 改动效果 |
| `remainingIssues` | 还有什么问题（选填） | 遗留问题（选填） |

范围与证据：

- 显示标签只在两处硬编码 —— `apps/web/src/features/record-drafts/record-content.ts` 的 `labels`（带「（选填）」后缀，供新建草稿、编辑草稿、完成任务、冲突选择弹层复用）与 `apps/web/src/features/published-records/PublishedRecordDetail.tsx` 的 `recordContentFields`（正式记录详情，无后缀）；`apps/web/src/features/issues/IssuesPageView.tsx` 的说明文案同步。契约字段名、Schema、OpenAPI、生成客户端与数据库列名**均未改动**（改契约名会触发迁移与生成物连锁变更，且不改变语义）。
- 断言同步：`CompleteWithRecord.test.tsx`、`PublishedRecordDetail.test.tsx`、`EditPublishedRecord.test.tsx`、`RecordDraftsView.test.tsx` 的标签文案断言改为新标签（含 `/具体改动冲突/` 正则）；`apps/e2e/tests/` 中 `external-links`、`leftover-task`、`issues`、`record-drafts`、`record-lifecycle`、`record-publishing`、`record-feed`、`task-completion` 8 个 spec 的 `getByLabel` 同步。
- 基线文档同步：`功能设计v1.1.md`（§16.7 字段表、§16.7 线框图、§16.8 填写示例、§19.4 展开示例、§30 字段表、§16.1/§17.1 说明）、`开发工作书v1.0.md`、`系统设计文档v1.0.2.md` 的标签文案改为新短版；线框图内四行重新对齐到该块的统一显示宽度 42 列。
- 验证：`pnpm test:web` 72 文件 390 例全通过；`apps/web` 与 `apps/e2e` 内旧标签零残留（`grep` 复核）。

### 记录小标题层级与任务成员加载提示（C，2026-09-14 本地落库）

产品在真实页面上截图反馈两处表现缺陷，均在同一个分支 `feature/record-section-labels` 修复。

**① 段落小标题与正文同级**：设计系统把全站 `h1`-`h6` 重置为 `font-weight: inherit`，记录详情的 `.record-expanded h4` 只有字号与颜色、没有字重，于是「改动原因 / 具体改动 / 改动效果 / 遗留问题 / GitHub 关联」与正文分不出层级。同时发现 `apps/web/src/styles/design-system.css` 与 `apps/web/src/features/records/records-timeline.css` **各有一份** `.record-expanded h4/h5` 规则，后者在样式表顺序上更靠后、实际生效，因此只改一处会视觉回退——两处同步改为 13px / 600 / `#314b65`（`h5` 为 12px / 600 / `#37566f`）。`apps/web/src/features/record-drafts/record-drafts.css` 的 `.draft-detail h3` 与 `apps/web/src/features/common/components/record-markdown.css` 的 `.record-field-label`（完成任务、编辑记录的字段名）同时补 600 字重与更深颜色。

**② 「正在加载项目成员…」永久显示**：`GlobalTaskCreateModal` 的成员查询带 `enabled: open && targetReady`，而 React Query 在查询被禁用时 `isPending` 恒为 `true`，用 `isPending` 驱动提示就会一直显示。`apps/web/src/features/tasks/task-query.ts` 新增 `isFirstLoad(query) = isPending && isFetching` 作为「还没有数据且确实在取数」的判据，`GlobalTaskCreateModal` 与 `TasksPanel` 两处提示改用它（后者成员查询没有 `enabled`，首个渲染仍匹配同一判据，不回归）。

| 验证项 | 结果 |
| --- | --- |
| `pnpm test:web` | **72 文件 391 例通过**（29.5 s）；`GlobalTaskCreateModal.test.tsx` 补 1 条断言 + 新增 1 个用例，先验证过反向条件会让用例失败 |
| `pnpm lint` / `pnpm format:check` / `pnpm typecheck` | 全部通过（typecheck 覆盖 8 个 workspace） |
| 真实浏览器 · 任务中心 | 归属未选全时成员框显示「请先选择任务归属」、页面上不再有加载提示；选完项目/模块/功能后成员填充「特哥 / 小潘 / 小吴 / 小邵」 |
| 真实浏览器 · 迭代记录 | 展开记录与草稿详情，小标题 `font-weight: 600` / `13px` / `rgb(49, 75, 101)`，正文 `400` / `13px` / `rgb(96, 118, 139)` |
| 未运行 | 整链 `pnpm check`（本机 npm 镜像缺 audit endpoint）、全量 `pnpm test:e2e`、GitHub Actions（按产品要求本次不触发；`feature/record-section-labels` 不在 `ci.yml`/`docs.yml` 的 `push` 白名单内且无开放 PR） |

**待人工评审项**：⑦ 给段落小标题加粗加深超出设计师稿基线（设计师稿该处同样没有字重），需非作者确认。

## 演示数据库版本化种子（C，2026-09-13 本地落库）

产品反馈「把数据库一并上传，我们要真实的数据库」「之前的数据库替换掉」：把本地容器演示库（`inpulse-local-dev`，`127.0.0.1:55432`）的真实演示数据作为版本化种子提交进仓库，替换仓库原先的占位演示数据。

#### 1. 方案与产物

| 产物 | 作用 |
| --- | --- |
| `scripts/export-demo-seed.mjs` | 维护者工具：从演示库 `pg_dump --data-only` 导出 27 张业务表，剔除测试痕迹、替换口令占位、统一文件头 |
| `database/seed/demo-data.sql` | 生成物（680265 B）：27 个 `COPY` 块 + `setval` 块，参与漂移检查 |
| `apps/api/scripts/seed-demo-data.mjs` | 载入器：单事务清空 + 载入 + 口令重置 + 回读校验 + 行数统计 |
| `pnpm db:seed:check` / `pnpm db:seed:demo` | 根级入口；`db:seed:check` 已插入 `pnpm check` 链、`README.md` 与 `AGENTS.md` §8 |

导出只含业务数据：**不含**登录会话、CSRF 材料、幂等记录、限流桶、MFA 恢复码与 TOTP 因子（承载运行痕迹的 7 张表在载入时也会被清空）。**含项目审计链**（`audit_chain_heads` + `audit_logs`），因为 `activity_projection_source_audit_fk` 指向 `audit_logs(chain_id, sequence_no)`，缺了项目动态无法载入；审计链里的测试痕迹行按 `SYSTEM_TEST` / `AUDIT_SEED_` 前缀在导出时剔除。口令列写固定占位值 `$argon2id$seed-demo-placeholder`（满足 `users.password_hash` 的 NOT NULL 与 `LIKE '$argon2id$%'` 约束、又不构成可用凭据），载入时由 `@node-rs/argon2` 统一重置为演示口令（默认 `Inpulse@2026`，可用 `SEED_DEMO_PASSWORD` 覆盖）并回读校验。

#### 2. 载入顺序约束（踩坑取证）

| 触发点 | 约束 |
| --- | --- |
| `require_active_task_assignee()` | 任务负责人必须是项目 `ACTIVE` 成员 ⇒ `project_members` 必须先于 `tasks` |
| `require_next_row_version()` | 核心聚合的 `row_version` 必须**恰好 +1** ⇒ 载入器重置口令的 `UPDATE` 也要带 `row_version = row_version + 1` |
| `activity_projection_source_audit_fk`（`DEFERRABLE INITIALLY DEFERRED`） | 项目动态指向审计记录 ⇒ 审计链必须随种子导出，且 `audit_chain_heads` 早于 `audit_logs` |
| `activity_projection_actor_id_users_id_fk` | `users` 必须最先载入 |
| Windows `psql --command` | 参数按控制台代码页转码，中文字面量会变成非法字节序列 ⇒ 统计 SQL 改为纯 ASCII，中文标签只在 Node 侧打印 |

#### 3. 端到端验证证据（2026-09-13，容器库 PostgreSQL 18.6 + PGroonga）

1. **全新库重建**：`CREATE DATABASE seedcheck` → `bootstrap/000_roles.sql` → `bootstrap/020_pgroonga.sql` → `MIGRATION_DATABASE_URL=…app_migrator@127.0.0.1:55433/seedcheck pnpm db:migrate`（**10 条迁移 0000-0009 全部 Applied**）→ `node apps/api/scripts/seed-demo-data.mjs` **成功**。
2. **逐表哈希比对**：对 27 张表执行 `md5(string_agg(to_jsonb(t)::text, '|' ORDER BY to_jsonb(t)::text))`，**26/27 与演示库完全一致**；`users` 差异仅来自口令占位被重置与 `tege.row_version` 由 2 递增到 3，去掉口令相关列后哈希一致（`d2df3615a9772c51117e401bed6a8573`）。
3. **真实 HTTP 读路径**：对该库以 `app_runtime` 启动真实 API（`PORT=3399`），用演示账号 `xiaopan` 完成 CSRF 签发 → 登录 → 22 条读路径，**0 失败**：当前用户（小潘）、项目列表（1）、项目详情、项目概览（含 `stats` / `recentRecords` / `activeLeftoverTotal`）、模块（8）、功能点（32，逐个模块遍历）、功能点详情、我的任务（15）、任务聚合组（1）、遗留问题（4）、迭代记录（20 + 下一页游标）、项目动态（20 + 下一页游标）、站内通知（20 + 下一页游标）、未读数量（3）、全局搜索（17）、用户目录（4）；项目成员接口对非管理员返回 403 属设计内权限行为。
4. **载入后行数**（与演示库一致）：账号 4、项目 1、项目成员 4、模块 8、功能点 32、任务 53、迭代记录 49、外部链接 268、项目动态 193、审计记录 198、站内通知 202。

#### 4. 定向门禁

| 检查 | 结果 |
| --- | --- |
| `pnpm db:seed:check` | 通过（27 张业务表，无口令哈希） |
| `pnpm lint` / `pnpm format:check` / `pnpm typecheck` | 通过 |
| `pnpm check:secrets`（983 文件）/ `pnpm check:docs`（75 个 Markdown） | 通过 |

| `pnpm test:integration`（Windows，CI 等价全新库） | 通过：database 2 文件 26 例、ops 2 文件 7 例、api 51 文件 447 例（113.6 s） |

未运行：`pnpm check`（整链，本机 npm 镜像缺 audit endpoint）、`pnpm test:e2e`、GitHub Actions。

#### 5. 附带修复

`database/test/integration/database.test.ts` 的迁移不可变断言在合并 `0009_tasks_creator_index.sql` 后未同步清单，导致 `CI / workspace` 在集成测试步骤失败；本轮补齐 `alreadyApplied` 清单。

`apps/api/test/aggregate-read-ports.integration.test.ts` 的「记录维度计数与先过滤后分页命中 `change_records` 索引」断言原为 `/Index (Only )?Scan using change_records_/`，只接受计划节点文本 `Index Scan using <idx>`。Windows 本机与 Linux CI 在同一 SQL、同一索引集下规划器各选一种访问方式（本机 `Index Scan using change_records_…`、Linux `Bitmap Index Scan on change_records_status_published_idx`，后者节点文本是 `on` 而非 `using`），该断言因此在 CI 上必失。放宽为 `/(?:Index (?:Only )?Scan using|Bitmap Index Scan on) change_records_/`，断言强度不变：仍要求命中 `change_records_` 前缀索引、仍保留 `expect(plan).not.toMatch(/Seq Scan on change_records/)` 与 `actual time`（ANALYZE 实测）要求。

**定位方式**：CI job logs 需要登录态，本机 `gh` 未登录无法读取，故用 `node:24.20.0-bookworm` 容器 + PGroonga 探针镜像（`max_connections=200`、trust）复刻同一套环境（`000_roles.sql` → `020_pgroonga.sql` → `db:migrate` 10 条 → `pnpm test:integration`），**exit 1 稳定复现**该例，修复后同一容器全量 **51 文件 447 例全绿**（71.2 s）。

五个生产镜像的 Trivy 门禁在上游集中公布 Debian 安全更新后转红，根因与处置如下（同批修复）：

- **根因不是 Node 依赖，也不是本分支引入**：`package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`deploy/docker/*`、各 workspace `package.json` 与本分支基点零差异；报出的漏洞都在镜像的 Debian 系统包层（API 镜像实测 `Total: 2 (HIGH: 2)`，均为 `libpcre2-8-0 10.42-1`，修复版本 `10.42-1+deb12u1`）。
- **换 digest 不可行**：`deploy/docker/*.Dockerfile` 固定的 `node:24.20.0-bookworm-slim@sha256:ba849c60…` 与当前同名 tag 的 digest 完全一致，上游未因 Debian 安全更新重建镜像；而镜像引用按 ADR-017 必须 exact-tag@digest，不能改指向未评审的新 digest。
- **处置方式**：按「固定 digest 基础镜像内刷新 Debian 安全包」在五个 Dockerfile 的 runtime 阶段引入一次刷新，并 `apt-get clean && rm -rf /var/lib/apt/lists/*`，避免 apt 缓存本身进入扫描报告。
- **两套清单差异（实测）**：`node:24.20.0-bookworm-slim`（Debian 12.15）内完整 `apt-get upgrade` 为空，只有 `libpcre2-8-0` 需要升级，且 `libsqlite3-0`、`libssh2-1t64`、`perl` 在该套件内**不存在**（`apt-get install --only-upgrade` 会 `E: Unable to locate package` 并 exit 100）；`nginxinc/nginx-unprivileged:1.30.4` 与 `postgres:18.6`（Debian 13.6 trixie）需要点名升级 `gzip libpcre2-8-0 libsqlite3-0 libssh2-1t64 perl perl-base libperl5.40 perl-modules-5.40`。
- **为什么 API/migration/ops 用整体 `upgrade`、web/db-bootstrap 用点名 `--only-upgrade`**：api/migration/ops 只带 Node，没有需要按版本确认的服务器二进制；web 与 db-bootstrap 必须把 nginx 停在 1.30.x、PostgreSQL 停在 18.6 评审基线（db-bootstrap 已配置 PGDG 源，整体 upgrade 会在 PGDG 发新补丁时带走 PostgreSQL 版本），故只点名升级 Debian 系统包。两者都只用 `upgrade`/`--only-upgrade`，不装新包、不删包、不改镜像基线。
- **本地验证**：五个镜像全部重建成功，逐镜像 `trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1` 全部 **exit 0**；复扫报告 `api` 的 Debian 层 0 漏洞、`web (debian 13.6)` 0、`db-bootstrap (debian 13.6)` 0；镜像内核验 `node 24.20.0`、`nginx/1.30.4`（uid 101）、`postgres 18.6`、`pg_dump/pg_restore 18.6`（uid 10002）、`/app/healthcheck.mjs` 与 entrypoint 初始化脚本均在位；包版本为 `libpcre2-8-0 10.42-1+deb12u1`（bookworm）/`10.46-1~deb13u2`（trixie）、`perl-base 5.40.1-6+deb13u1`、`gzip 1.13-1+deb13u1`、`libsqlite3-0 3.46.1-7+deb13u2`、`libssh2-1t64 1.11.1-1+deb13u2`；`pnpm check:deploy:test` 退出码 0（db-bootstrap 的 OpenSSL `--only-upgrade` 行保留）。
- **未运行**：CI 镜像扫描步骤结论以推送后的运行为准，本条不预称已通过。

**待人工评审项**：⑦ 把真实演示库（含审计链的 `ip_address` 与浏览器 User-Agent 字段，实测只有 `127.0.0.1` 与一个无头浏览器标识）作为数据资产提交进仓库，需要非作者确认存档范围；⑧ 演示口令是仓库内公开的固定值，仅适用于本地演示环境，生产部署不得载入该种子。

## F-32 任务中心点击卡片直达功能档案（C，2026-09-14 本地落库）

产品截图反馈：任务中心的任务卡片点开后是一个只读详情弹层（PR #136 引入的 `MyTaskDetailModal`），无法在里面完成任务编辑、生成迭代记录、合并到主任务、关联 GitHub 链接等写操作——这些写操作只在功能档案的任务详情弹窗里。只读弹层既不能操作又需要用户再点一次「在功能档案中查看」才能跳转，等于给同一份数据多套一层入口。本轮把任务中心收敛为纯定位入口：**删除 `MyTaskDetailModal`，卡片与列表行点击后经 `onOpenTask`（`TasksPage` → `taskDetailPath` 深链）直接跳转到功能档案的 `?taskId=` 深链，由 `TasksPanel` 打开承载全部写操作的任务详情弹窗，任务中心不再复制一份只读弹层**。

契约与后端口径不变：任务中心仍走 R-3 `listMyTasks` 与 R-5 `listTaskGroupMemberships`（关系徽章、「迭代记录 n 条」与「查看主任务」保留），`taskDetailPath` 与 `TasksPanel` 的 `?taskId=` 弹窗均为既有能力，本轮只是把点击目标从页内弹层换成深链导航。删除的 `MyTaskDetailModal.tsx` / `.test.tsx` 无其它消费者；`.task-modal*` 系列样式仍被功能档案的 `TasksPanel` 使用，未产生死代码。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F32-NAV-UNIT-001 | 单元 | 功能级卡片点击直达 | `TaskCenterPageView.test.tsx`：点击功能级任务卡片（项目 1 / 模块 11 / 功能 111 / 任务 101）后 `onOpenTask` 收到 `{ projectId:1, moduleId:11, featureId:111, taskId:101 }`，页面内**不出现** `role=dialog`、不出现「关闭」按钮（证明不再弹只读详情） | 本地通过 |
| F32-NAV-UNIT-002 | 单元 | 模块级已完成任务点击直达 | `TaskCenterPageView.test.tsx`：`serverLikeAdapterWith` + `filters:{status:"done"}` 下点击模块级 `doneTask`（任务 901，`featureId:null`）后 `onOpenTask` 收到 `{ projectId:1, moduleId:11, featureId:null, taskId:901 }` | 本地通过 |
| F32-NAV-PAGE-001 | 单元（页面层） | 功能级深链路径 | `TasksPage.test.tsx`：注入 `featureTask`（7 / 71 / 711 / 320），点击卡片后 `ArchiveProbe` 文本为 `/projects/7/modules/71/features/711?taskId=320` | 本地通过 |
| F32-NAV-PAGE-002 | 单元（页面层） | 模块级深链路径（`featureId` 为 null 时落到 `/tasks`） | `TasksPage.test.tsx`：注入 `moduleTask`（7 / 72 / null / 321），点击卡片后 `ArchiveProbe` 文本为 `/projects/7/modules/72/tasks?taskId=321` | 本地通过 |
| F32-NAV-E2E-001 | Playwright | 真实数据卡片直达功能档案并打开写操作弹窗 | `aggregate-views.spec.ts` 例 1：经真实 UI 建功能与任务后进入 `/tasks`（卡片视图），点击该任务卡片，URL 落到 `^/projects/{projectId}/modules/\d+/features/\d+$` 且带 `taskId`；功能档案弹出 `dialog[name=任务详情]`，内含任务标题、「编辑任务」与「完成任务」按钮；关闭后弹窗隐藏 | 本地通过 |

本地实际执行（2026-09-14，前端专项，无后端 / 契约 / 迁移改动）：

- 定向单测 `pnpm --filter @inpulse/web exec vitest run src/features/my-tasks src/pages/tasks` **6 文件 76 例通过**；
- 全量 `pnpm test:web` **73 文件 399 例通过**（删除 `MyTaskDetailModal.test.tsx` 后总数相应下降，无 skip / 弱化断言）；
- `pnpm --filter @inpulse/web typecheck`、`pnpm --filter @inpulse/e2e typecheck` 通过；
- 变更文件 ESLint（`TaskCenterPageView.tsx` / `TaskCenterPageView.test.tsx` / `TasksPage.test.tsx` / `aggregate-views.spec.ts`）与 `pnpm exec prettier --check` 通过；
- `pnpm check:frontend:boundaries` 无违规（244 模块 / 1146 依赖）、`pnpm --filter @inpulse/web build` 通过；
- 定向 Playwright `pnpm exec playwright test aggregate-views task-groups`（`E2E_API_PORT=3188` / `E2E_WEB_PORT=4188`，容器库 55432）**4 例全通过**（33.7 s），确认新增卡片直达块与聚合组区块「查看主任务」跳转功能档案后仍能打开 `dialog[name=任务详情]`；
- 真实浏览器人工复验（Vite 5301 → API 3199，真实演示数据与真实登录）：点击任务卡片 `INPULSE-T-55` 后落到 `/projects/1/modules/2/features/2?taskId=55`，功能档案弹出「任务详情」弹窗，含「编辑任务」「完成任务」「取消任务」「合并到主任务」「GitHub 链接」；
- 推送前全量门禁：`pnpm lint`、`pnpm format:check`、`pnpm check:docs`（75 个 Markdown）、`pnpm typecheck`（8 个 workspace）与 `pnpm build`（全 workspace）全部通过。

未运行 / 已知偏差：① 整链 `pnpm check`（本机 npm 镜像缺 audit endpoint）与全量 `pnpm test:e2e` 未执行，结论以推送后的门禁为准；② 无后端 / 契约 / 迁移改动，未运行 API 单测与真实 PostgreSQL 集成；③ 新增 / 更新的单元与 E2E 用例需非作者人工评审；④ 本条与同分支的目录树恢复、F-29 概览指标卡收敛同批推送。

## 项目主页目录树恢复（「系统目录」导航，C，2026-09-14 本地落库）

产品反馈（含截图）：上一轮目录改造在侧栏加出了「系统目录」树，但项目**主页面**「严重丢失了好多功能和效果」，产品澄清口径是「目录应该影响的是这个页面而不是新建页面」。该轮改造把项目卡片的入口让给了新建的只读复刻页（`/explorer` 重实现，从未进入任何提交），项目主页 `/projects/{projectId}/modules`（`ProjectOverviewPageView` + 模块卡片网格 + `ModuleEditorModal`）因此失去可达入口。

本轮修复口径是**目录只做导航，不新建页面**：

- `apps/web/src/features/project-tree/`（新增 4 文件）：`ProjectTree.tsx` 复用既有 `useProjectDetail` / `useModules` / `useFeatures` 查询钩子与生成客户端渲染「系统 → 模块 → 功能」三级树，点击经 `onNavigate` 交给既有路由；组件不含业务规则、不发写请求。
- `tree-selection.ts`：`treeScopeOf()` 由 `readCatalogScope` 的路径解析结果推导选中层级（系统 / 模块 / 功能；非项目路径返回 `null`），`treePath()` 把三级映射到既有页面——系统 → `/projects/{p}/modules`（项目主页）、模块 → `/projects/{p}/modules/{m}/features`（功能目录）、功能 → `/projects/{p}/modules/{m}/features/{f}`（功能档案）。
- `AppLayout.tsx`：在既有 `nav[aria-label="工作区导航"]` 内、「系统」分组之后新增「系统目录」分组，仅在项目目录路径范围内渲染（`treeScope === null` 时不渲染该分组）。
- 无新增路由、无 API / 契约 / 权限 / 迁移改动；项目卡片入口保持 `onOpenModules` → `/projects/{projectId}/modules`。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| CAT-NAV-UNIT-001 | 单元 | 树层级与既有页面映射 | `tree-selection.test.ts` 2 例：`treeScopeOf` 对 4 种路径形状分别返回 `null` / 系统 / 模块 / 功能；`treePath` 三级分别得到 `/projects/2/modules`、`/projects/2/modules/3/features`、`/projects/2/modules/3/features/5` | 本地通过 |
| CAT-NAV-UNIT-002 | 单元 | 树渲染、展开与选中态 | `ProjectTree.test.tsx` 5 例：根节点为系统名并加载模块；三级点击分别调用既有页面路径（并验证系统节点重复点击不收起模块列表）；模块分支在其功能列表加载期间保持 `aria-expanded=true`；功能行 `aria-current=true` 且所属模块保持 `in-path`；项目主页激活时系统节点 `aria-current=true`。**注**：本条「重复点击不收起」语义已被下方「系统目录并入『项目与功能』导航」章节的 NAV-TREE-UNIT-001 取代（项目节点改为与模块一致的点击开合） | 本地通过 |
| CAT-NAV-UNIT-003 | 单元（布局） | 目录树只在项目目录范围内出现，且与主导航同容器 | `AppLayout.test.tsx` 新增 2 例：项目主页下同一 `nav[name="工作区导航"]` 内既有「任务中心」也有「系统目录」分组，点模块 / 功能分别渲染功能目录 / 功能档案内容，且项目主页内容仍完整渲染；`/tasks` 下不出现「系统目录」分组与 `.project-tree` | 本地通过 |

真实浏览器复验（Vite 5301 → API 3199，真实演示数据与真实登录）：自项目列表进入 `/projects/1/modules`，项目概览与模块列表完整；目录树三级点分别落到 `/projects/1/modules`、`/projects/1/modules/{m}/features`、`/projects/1/modules/8/features/31`（功能「浏览器自动化测试基座」），功能档案完整渲染，树内该功能行高亮且所属模块保持展开。

本地实际执行（2026-09-14，前端专项，无后端 / 契约 / 迁移改动）：`pnpm test:web` **73 文件 399 例通过**（含 `project-tree` 2 文件 7 例与 `AppLayout.test.tsx` 新增 2 例）；`pnpm typecheck`（8 个 workspace）、`pnpm build`（全 workspace）与 `pnpm check:frontend:boundaries`（244 模块 / 1146 依赖，无违规）通过；`pnpm lint`、`pnpm format:check`、`pnpm check:docs`（75 个 Markdown）通过。

未运行 / 已知偏差：① **尚无目录树的 Playwright 用例**，树的行为目前只有单元层与人工浏览器复验，E2E 覆盖待补；② 整链 `pnpm check`（本机 npm 镜像缺 audit endpoint）与全量 `pnpm test:e2e` 未运行；③ 新增组件与测试需非作者人工评审；④ 本条与 F-29 概览指标卡收敛、F-32 任务中心点击直达同批推送。

## ADR-030 定向回归

| 变更 | 验收证据入口 |
|---|---|
| 空项目与创建者历史 | `apps/api/test/project-bootstrap.integration.test.ts`，零模块、成员/审计/投影同事务 |
| 业务编号与联合创建 | `apps/api/test/task-create.integration.test.ts`，真实 PostgreSQL 唯一编号、并发、无效指派回滚、幂等与撤销权限 |
| 成员隔离 | 同上，授权成员名单、外部项目用户、已移除成员 |
| 任务中心范围与逾期 | `apps/api/test/aggregate-read.service.test.ts`；`apps/web/src/features/my-tasks/my-tasks-server.test.ts`，scope/overdue 入查询、管理员约束、个人统计保持 |
| 验收标准 | `apps/api/test/features-api.integration.test.ts`；`apps/web/src/features/features/FeaturesPageView.test.tsx`，保存、读取、版本/审计与冲突合并 |
| 草稿详情 | `apps/api/test/record-drafts.integration.test.ts`；`apps/web/src/features/record-drafts/RecordDraftsView.test.tsx`，姓名/归属、弹窗、编辑返回 |
| 根仓库 | `apps/api/test/external-links.integration.test.ts`，明确设置、切换已有关联、审计、版本冲突、非法路径、跨项目拒绝；前端 `apps/web/src/features/external-links/ProjectRepositoryLink.test.tsx` 断言直达链接同时含「项目根仓库」文案与根仓库网址文本 |
| 自定义归属 UI | `apps/web/src/features/tasks/GlobalTaskCreateModal.test.tsx`，整笔提交、错误保留、链接失败不重复建任务 |

本次按用户限制仅执行相关行为测试，不执行全量构建、静态检查或依赖审计；未执行的门禁不能记为通过。

### 任务计划补齐（2026-09-14）

逾期统计下钻保留项目范围，切换完成状态清除逾期条件；对应任务中心、适配器、URL 回归已补。草稿详情使用统一滚动正文容器，根仓库未配置时显示明确提示。模块/功能任务区增加自定义归属入口，复用原子创建接口。局部前端回归覆盖上述交互，浏览器验收与远端 CI 结果另行记录。

任务完成回归补充：内部 findDraft 与 lockDraft 使用相同持久化数据，姓名回填仅发生在界面读取；真实 PostgreSQL 的 task-completion、modules-command、record-drafts 三文件 50 例通过，保留并发等待、失败回滚与外键约束断言。

### E2E 入口与成员验收同步（2026-09-14）

- 任务区原“新建任务”与新增“自定义归属新建任务”采用完整名称定位，保留后续创建、状态、发布、合并断言；模块新增用例定位项目操作区，避免与空态/列表入口混淆。
- 项目概览仅保留一个 GitHub 链接管理入口；页面组合回归检查入口唯一，外链 E2E 继续验证添加、去重与非法链接。
- 成员 E2E 按 ADR-030 验证本项目只读列表、无增删操作、非成员项目返回 404 且不显示成员姓名；管理员管理用例保持。
- 执行结果记录于本轮开发日志与 PR 检查，不把按钮定位修复等同于后续业务链路已通过。

补充实际进入后续流程暴露的旧预期：任务中心监听 `/api/v1/tasks?scope=created`；管理员成员页校验加载后的项目名称；多草稿切换先关闭详情弹窗；新项目任务指派前显式创建模块。普通链接重复使用普通关联提示，仅根仓库设置显示根仓库提示。

## 项目根仓库直达链接展示网址（C，2026-09-15 本地落库）

用户反馈概览头部根仓库入口「只有文字说明，没有网址」。`ProjectRepositoryLink` 的直达链接在「项目根仓库」文案后追加 `.project-repository-url` 网址文本（超长省略号截断，max-width 260px），链接 href 不变；`design-system.css` 为该容器与链接补充行内布局与配色。`ProjectRepositoryLink.test.tsx` 在既有「直达明确标记的根仓库」用例中追加 `textContent` 含网址断言。验证：目标文件 2/2、全量 web 单测 74 文件 403 例、web typecheck、改动文件 Prettier/ESLint 通过；浏览器实测头部同时显示「项目根仓库」与 `https://github.com/256-code/InPulse`。无契约 / 权限 / 迁移 / 路由改动。

## 迭代记录页来源草稿区头部卡片化（C，2026-09-15 本地落库）

用户反馈 `/records?projectId=&moduleId=&taskId=` 的来源草稿区「是什么、为什么没有 UI」：该区块是 `RecordDraftsView` 嵌在 `RecordsWorkspace` 顶部的任务来源草稿管理区，来源头部此前是无容器的裸文本（标题/说明/两个链接），「新建来源草稿」按钮孤悬右对齐，视觉上像未加样式。本轮把来源头部包进 `.draft-source-head` 白底圆角卡片，「新建来源草稿/新建独立草稿」按钮移入 `CalmSectionTitle` 右侧（与徽章同行，删除孤立的 `.draft-toolbar`），`record-drafts.css` 补卡片与标题行对齐样式。`RecordDraftsView.test.tsx` 补断言：来源标题位于 `.draft-source-head` 内、新建按钮位于 `.calm-section-title` 内。验证：目标文件 7 例、全量 web 单测 74 文件 406 例、web typecheck 退出码 0、改动文件 Prettier/ESLint 通过；浏览器实测（小邵登录，`/records?projectId=1&moduleId=5&taskId=5`）：头部卡片渲染、徽章与按钮同行右侧（实测 bounding box 同 top），截图确认。无契约 / 权限 / 迁移 / 路由改动。

## 任务创建人与状态历史操作人姓名解析（C，2026-09-15 本地落库）

用户反馈任务详情弹窗「创建人」与状态历史「操作人」显示裸编号（`#1` / `#3`）。`TasksPanel` 新增 `listActiveProjectMembers` 只读查询与 `personName` 解析（项目活跃成员 → 任务指派人候选 → 回退中性「用户 #id」，不冒充负责人语义），「创建人」改用 `personName(current.creatorId)`；`TaskStatusPanel` 新增可选 `nameOf` 属性，状态历史行「操作人」改用它解析姓名。迭代记录列表的处理人回退同步改用 `personName`。`TasksPanel.test.tsx` 基础 mock 补 `listActiveProjectMembers`，新增「创建人与历史操作人显示姓名而非裸编号」用例。验证：目标文件 19 例、全量 web 单测 74 文件 406 例、web typecheck 退出码 0、改动文件 Prettier/ESLint 通过；浏览器实测（小邵登录，功能 12 已完成任务）：创建人「特哥」、历史「操作人 特哥 / 操作人 小吴」。**未验证**：已移出项目或停用用户的回退形态（演示库无此数据，仅单测与代码路径覆盖）。无契约 / 权限 / 迁移 / 路由改动（`listActiveProjectMembers` 为既有成员只读路由）。

## 任务详情弹窗迭代记录列表（C，2026-09-15 本地落库）

用户反馈任务详情弹窗「迭代记录」标签不显示已有记录与草稿，要求按设计师稿（`https://256-code.github.io/latest-version/`）实现。`TasksPanel` 在详情弹窗打开时新增两个只读查询：`listChangeRecords(projectId, {limit:100})` 客户端按 `taskId` 过滤出本任务已发布记录（`listChangeRecords` 无 taskId 查询参数，不改契约），`getTaskRecordDrafts` 取本任务草稿；标签页按设计师稿渲染列表（标题 + 编号/日期/处理人 + 已发布/草稿徽章），已发布记录点击跳 `/records?projectId=&publishedId=` 打开详情，草稿跳 `/records?...&taskId=&recordId=` 打开草稿详情；两者皆空保留原空态。处理人姓名优先用响应回填字段，缺失时回退项目成员名单（`listChangeRecords` 不回填姓名）。`TasksPanel.test.tsx` 基础 mock 补两个只读接口，新增列表用例（含同项目他人任务记录不混入断言）。验证：目标文件 18 例、全量 web 单测 74 文件 405 例、web typecheck 退出码 0、改动文件 Prettier/ESLint 通过；浏览器实测：任务 22 的弹窗标签显示「迭代记录 1」并列出 `INPULSE-CR-9 · 2026/9/12 · 特哥 · 已发布`，点击跳转 `/records?projectId=1&publishedId=9` 且详情可见；无记录任务显示空态；演示库当前无任务级草稿，草稿条目仅单测覆盖（未验证）。无契约 / 权限 / 迁移 / 路由改动。

## GitHub 链接弹窗添加表单置顶（C，2026-09-15 本地落库）

用户要求「GitHub 链接」弹窗里的添加链接放在顶上。`ExternalLinksPanel` 把新增表单字段提取为 `addFormFields`（弹层与内联共用），弹层形态在 `data` 就绪且可写时先渲染 `.external-links-add`（下边框分隔）再渲染版本行与链接列表，弹窗底部只保留解除关联确认；内联形态交互不变。`ExternalLinksPanel.test.tsx` 新增「添加表单排在链接列表之前」DOM 顺序断言。验证：目标 2 文件 7 例、全量 web 单测 74 文件 404 例、web typecheck 退出码 0、改动文件 Prettier/ESLint 通过；浏览器实测弹窗内 `.external-links-add` 先于列表首项且输入框可见，截图确认顶部为 URL 输入 + 根仓库勾选 + 确认添加。无契约 / 权限 / 迁移 / 路由改动；`apps/e2e/tests/external-links.spec.ts` 的弹窗填写路径不受影响（未运行，argon2 环境问题未修复）。

## 冗余导航收敛与普通成员只读成员页（C，2026-09-15 本地落库）

用户确认：侧栏「系统目录」树（项目主页目录树恢复条目）已承担项目 → 模块 → 功能三级导航，页面内与之重叠的导航不再保留。本轮两项前端改动，均无后端 / 契约 / 权限 / 迁移 / 路由变化：

**一、冗余导航移除**

- 删除 `ProjectContextNav`（设计师稿 `.project-context-nav` 横条，「项目概览 + 模块」切换）及其组件文件与单测；移除 4 处使用点：`ProjectOverviewPageView`（含 `modules` / `onOpenModule` / `onOpenOverview` / `navActive` 四个仅为该导航服务的 props，接口同步收窄）、`ModulesPageView`、`FeaturesPageView`（功能目录态）、`ModuleTasksPage`。
- 删除功能档案页左栏 `feature-switcher`（「模块内功能」列表）：`FeaturesPageView` 详情态不再渲染 `.feature-workspace` 双栏，`.feature-document` 直接铺满；「返回功能列表 / 返回模块列表」入口由既有 `.feature-breadcrumbs` 保留。
- 保留：顶部面包屑（`AppLayout`）、「全部项目 / 返回模块列表」等寻路按钮、`/projects/:id/overview` 独立路由（活动深链 `activity-labels.ts`、成员页返回链接、E2E `aggregate-views.spec.ts` / `external-links.spec.ts` 直接引用）。
- 样式清理：`design-system.css` 移除 `.project-context-nav*`、`.feature-workspace`、`.feature-switcher`（含 1000px 媒体查询分支）；`inpulse-design.css` 移除 `.feature-switcher-label/-item` 系列与对应媒体查询。

**二、普通成员项目成员页只读视觉对齐（`ActiveProjectMembers`）**

- 原实现是 ADR-030（PR #137）落库的无样式占位（裸 `<ul>` 名单）；本轮重做为与管理员 `ProjectMembersPageView` 相同视觉语言的只读视图：`page-header`（项目名 + 状态徽章）、`panel settings-panel`、`project-facts`（编码 / 状态 / 创建人 / 创建时间 / 当前成员）、`member-editor` + `.calm-member-card` 成员卡片（头像、姓名、创建者标注、「活跃成员」徽章）、「刷新成员」与只读权限提示；**不含**添加 / 移除 / 任务改派 / 归档 / 项目切换任何写入口。
- 数据源不变：`getProject` + `listActiveProjectMembers`（只返回活跃成员 `id/name/avatarUrl`，无加入时间 / 历史状态，卡片按此裁剪字段）。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| NAV-CLEAN-UNIT-001 | 单元 | 概览视图收窄后的 props 与渲染 | `ProjectOverviewPageView.test.tsx` 8 例：删除 2 个「项目内导航」用例后其余（指标卡、面板、错误态、跳转）全通过；`ProjectOverviewPage.test.tsx` 6 例：2 个导航用例替换为「查看模块」入口用例 | 本地通过 |
| NAV-CLEAN-UNIT-002 | 单元 | 模块页 / 功能页移除横条与左栏后无回归 | `ModulesPageView.test.tsx` 8 例（删除「项目内导航」describe）、`FeaturesPageView.test.tsx` 10 例（删除「项目内导航」describe 与「module siblings」用例及其 `moduleRow`/`moduleClient` 辅助）全通过 | 本地通过 |
| MEMBER-RO-UNIT-001 | 单元 | 只读成员视图渲染与只读语义 | `ActiveProjectMembers.test.tsx` 5 例（新增）：复用管理员视觉（h1 项目名、`.panel.settings-panel`、`.calm-member-card` 数量）；无添加 / 移除 / 归档 / dialog、仅「刷新成员」；创建者标注且全员「活跃成员」；空态；加载失败出「项目成员加载失败」+ 重试 | 本地通过 |
| MEMBER-RO-E2E-001 | 浏览器 E2E | 普通成员只读成员页与隐藏项目 404 | `project-members.spec.ts` 例 1 选择器同步：`.project-members`/`listitem`/旧 h1 文案断言改为 `.settings-panel` + `.calm-member-card` + h1 项目名；「无添加 / 移除按钮」「隐藏项目 404 且不泄露成员姓名」断言语义不变；管理员用例（例 2）不受影响 | **未运行**（本机 `@node-rs/argon2` win32-x64-msvc 原生二进制加载失败 error 126，API 无法启动，属环境问题；`@inpulse/e2e` typecheck 通过） |

本地实际执行（2026-09-15，前端专项，无后端 / 契约 / 迁移改动）：`pnpm --filter @inpulse/web test` **74 文件 401 例通过**（新增 `ActiveProjectMembers.test.tsx` 5 例，删除导航相关 7 例、替换 2 例）；`pnpm --filter @inpulse/web typecheck`、`pnpm --filter @inpulse/e2e typecheck`、`pnpm --filter @inpulse/web build`、`pnpm --filter @inpulse/web check:boundaries`（246 模块 / 1171 依赖，无违规）、改动文件 ESLint 与 Prettier 检查通过；真实浏览器人工复验（Vite 5173，普通成员「小邵」登录）：`/projects/1/members` 渲染新只读视图（4 名成员、特哥标注创建者、无任何写入口）。

未运行 / 已知偏差：① `project-members.spec.ts` 因上述 argon2 环境问题未实跑，仅 typecheck；② 全量 `pnpm test:e2e`、整链 `pnpm check`（本机 npm 镜像缺 audit endpoint）、`pnpm check:docs` 未运行；③ 窄屏（侧栏折叠）下模块切换只剩面包屑与返回按钮，属本次收敛的已知取舍；④ `ProjectContextNav` 为设计师稿组件，本次删除属用户明确授权的设计偏离；⑤ 新增 / 修改测试需非作者人工评审。

## 系统目录并入「项目与功能」导航（C，2026-09-15 本地落库）

用户要求：侧栏不再单独渲染「系统目录」分组，目录树并入「项目与功能」导航项——点击该项（或其行尾 chevron）展开系统目录，**先罗列所有项目**，点击项目再罗列模块、点击模块再罗列功能（逐级展开）；并给罗列区域设置固定高度区间，过长时内部滚动。纯前端导航结构调整，无后端 / 契约 / 权限 / 迁移 / 路由变化：

- `ProjectTree` 重构为多项目渐进树：props 由 `projectId + selection` 改为 `activeScope: TreeScope | null`；根层用 `useProjects` 罗列全部项目，点击项目节点导航到项目主页并 toggle 该项目模块列表（再次点击收回；初版误实现为「只展开不收起」，已由用户反馈修正为与模块节点一致的开合语义），点击模块导航到功能目录并 toggle 功能列表；当前路由所在链路（项目 → 模块）仍自动展开、选中态与 `in-path` 高亮语义不变；加载 / 失败 / 空态提示按层级展示。
- `AppLayout`：删除独立「系统目录」`nav-section` 分组；「项目与功能」行改为 `.nav-item-row`（导航按钮 + 行尾 `.nav-tree-toggle` chevron，避免嵌套 button），`catalogOpen` 状态控制树开合，进入 `/projects*` 路由自动展开；树仅在展开时渲染。
- 罗列区间：新增 `.project-tree-scroll { max-height: 264px; overflow-y: auto }`（含细滚动条样式），目录过长时在固定高度内滚动，不再把侧栏导航撑出视口；项目层提示文案缩进与项目节点对齐。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| NAV-TREE-UNIT-001 | 单元 | 目录树多项目渐进展开 | `ProjectTree.test.tsx` 7 例：先罗列所有项目且未点击不加载模块；点击项目导航 `/projects/2/modules` 并展开模块；**再次点击项目节点收回模块列表（`aria-expanded` true→false、模块行消失）且仍导航项目主页**；模块 / 功能点击导航既有页面；activeScope 链路自动展开；模块分支 toggle；选中态与 in-path 高亮 | 本地通过 |
| NAV-TREE-UNIT-002 | 单元 | 目录树内嵌「项目与功能」导航项 | `AppLayout.test.tsx` 更新 2 例：项目路由下树渲染在「工作区导航」内且无独立「系统目录」分组标题，模块 / 功能节点点击驱动既有路由；非项目路由默认收起（无 `.project-tree`），点击「展开系统目录」chevron 可展开 / 收起 | 本地通过 |

本地实际执行（2026-09-15）：`pnpm --filter @inpulse/web test` **74 文件 403 例通过**；`typecheck`、`build`、`check:boundaries`（246 模块 / 1171 依赖，无违规）、改动文件 ESLint 与 Prettier 通过；真实浏览器人工复验（Vite 5173，普通成员「小邵」登录）：`/projects` 下树内嵌「项目与功能」行并罗列 2 个项目，点击「InPulse 研发交付平台」跳转 `/projects/1/modules` 且展开 9 个模块，**再次点击项目节点收回模块（9 → 0，`aria-expanded` false）、三击重新展开（0 → 9）**，罗列区 264px 限高生效（scrollHeight 374 > clientHeight 264，内部滚动），chevron 收起 / 展开正常。

未运行 / 已知偏差：① 全量 `pnpm test:e2e`（argon2 环境问题未修复）与整链 `pnpm check` 未运行；② 目录树相关 Playwright 用例仍缺失（沿袭上一轮已知项）；③ 修改测试需非作者人工评审。

## 前端 UI 缺陷修复批次（整体 UI 回归，2026-09-15 本地落库）

用户要求「修理」整体 UI 测试发现的缺陷。本批次为纯前端修复：不改路由契约、Route Registry、数据库不变量、迁移、鉴权与幂等策略，后端代码零改动，`docs/permissions.md` 与 `packages/api-contract` 不受影响。

- **P2-1 未匹配路由落到 React Router 开发者错误页**：新增 `apps/web/src/pages/not-found/route.ts`（`path: "*"` + `requiresAuth`）与 `NotFoundPage.tsx`，并在根路由挂 `errorElement: <RouteErrorPage />`（`apps/web/src/app/errors/RouteErrorPage.tsx`）。修复前访问 `/no-such-page-xyz` 或 `/projects/1/features`（真实路由是 `/projects/:projectId/modules/:moduleId/features/:featureId?`）整页渲染 `Unexpected Application Error! 404 Not Found` 与 `Hey developer` 开发者提示，且 `main`/`aside` 数量均为 0——应用外壳被一起替换；修复后外壳保留、内容区渲染品牌化 404，并提供「回到任务中心」与「返回上一页」。
- **P2-2 用户管理冲突文案错误**：服务端在登录名/邮箱冲突时返回 409 `ADMIN_USER_LOGIN_CONFLICT`/`ADMIN_USER_EMAIL_CONFLICT`（映射见 `apps/api/src/admin-users/admin-user-http.service.ts`），前端 `apps/web/src/features/users/admin-user-query.ts` 的 409 分支此前未处理这两个 code，落到兜底文案「用户当前状态不允许此操作，请检查列表后重试。」；现分别输出「登录名已存在，请更换后重试。」与「邮箱已被使用，请更换后重试。」。
- **P2-3 创建项目弹窗文案与 ADR-030 冲突**：删除「未分类模块 —— 创建成功后自动生成，可继续拆分」，改为「模块 —— 按需手动创建，项目也可以没有模块」，与 ADR-030 第 1 条和实际创建行为一致。
- **P2-4 普通成员侧栏页脚死链**：`AppLayout` 页脚「查看权限矩阵」改为仅对系统管理员渲染（该入口指向管理员专属的 `/settings`，普通成员只会看到「无权访问」）；「成员与设置」导航项保持设计师稿的系统组两项不变，普通成员访问 `/settings` 仍按既有 E2E 断言显示「无权访问 / 此区域仅限系统管理员访问。」。
- **P3-1 antd 弃用告警**：搜索页 3 处、通知页 2 处 `Space direction` 改为 `orientation`；两页的 `List`/`List.Item` 换成语义化 `ul`/`li`（保留 `data-testid="search-result-item"` 与 `notification-item-*`，12px 行距 + `var(--border)` 分隔线，末行无下边框），不再触发 `[antd: List]` 弃用告警。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| UI-BUG-NOTFOUND-UNIT-001 | Web 单元 | 未匹配路径兜底与外壳保留 | `NotFoundPage.test.tsx`：品牌化 404、无 `Hey developer`、点击「回到任务中心」跳到 `/tasks`；`route-error-page.test.tsx`：404 响应与未知异常分别渲染「页面不存在」「页面加载失败」；`app-router.test.tsx` 新增用例在 `/definitely-not-a-route` 下断言 `route-not-found` 可见且品牌图仍在（外壳未被替换） | 本地通过 |
| UI-BUG-ADMIN-CONFLICT-UNIT-001 | Web 单元 | 用户管理 409 冲突文案 | `admin-user-query.test.tsx` 新增用例：两个冲突 code 分别输出「登录名已存在」「邮箱已被使用」，不再落到状态兜底文案 | 本地通过 |
| UI-BUG-RULES-UNIT-001 | Web 单元 | 创建项目规则文案 | `CreateProjectModal.test.tsx` 新增用例：规则面板包含「模块」且不包含「未分类」 | 本地通过 |
| UI-BUG-SIDEBAR-UNIT-001 | Web 单元 | 页脚入口的身份可见性 | `AppLayout.test.tsx` 新增用例：系统管理员可见「查看权限矩阵」，普通成员不可见 | 本地通过 |
| UI-BUG-DEPRECATION-UNIT-001 | Web 单元 + 浏览器 | 弃用告警消除与列表渲染 | `SearchPageView.test.tsx`、`NotificationsPageView.test.tsx` 既有用例全通过；真实浏览器下普通成员与管理员在 `/notifications`、`/search` 控制台零 `deprecated` 告警，通知 20 行、搜索结果 20 行正常渲染且与修复前截图视觉一致 | 本地通过 |
| UI-BUG-REGRESSION-E2E-001 | 浏览器 E2E | 全量关键路径回归 | `pnpm test:e2e` 55 passed（4.1m），含 `notifications.spec.ts`、`search.spec.ts`、`admin-users.spec.ts`、`visual-migration.spec.ts` 与 CSP 错误态用例 | 本地通过 |

本地实际执行（2026-09-15）：`pnpm --filter @inpulse/web test` **76 文件 412 例通过**（修复前为 74 文件 405 例，新增 2 文件 7 例）；`pnpm check` 整链通过（`lint`、`format:check`、`typecheck`、`test:unit`、`db:migrations:check`、`db:seed:check`、`contract:drift`、`contract:validate`、`build`、`check:deploy:test`、`check:deps` 689 文件无循环/越界、`check:frontend:boundaries` 251 模块 1193 依赖无违规、`permissions:check` 102/102、`deps:audit` 无已知漏洞、`check:secrets` 1010 文件、`check:docs` 76 篇 Markdown），另有 `pnpm test:e2e` 55 passed；真实浏览器回归 10/10（脚本产物 `%TEMP%\\inpulse-ui-audit\\verify-report.json`）：未知路由与 `/projects/1/features` 均保留外壳渲染 404、成员页脚无「查看权限矩阵」、管理员可见、重复登录名提示已改为「登录名已存在，请更换后重试。」、创建项目规则文案已更新、双身份控制台零弃用告警。

未运行 / 已知偏差：① 本批次无依赖变更，`deps:audit` 由整链 `pnpm check` 执行并通过（No known vulnerabilities found）；GitHub Actions 未执行（本地时点）；② 「查看权限矩阵」对普通成员改为不可见是保守选择——若产品希望成员可读只读权限矩阵，需要新增成员可读页面，并同步修改 `admin-users.spec.ts` 中「普通成员访问 /settings 显示无权访问」的既有断言，本轮未改；③ 本批次新增/修改的测试需非作者人工评审。

## 优先级标签文案收敛（C，2026-09-15 本地落库）

用户反馈：任务中心的优先级文案太长，所有优先级标签都要 1～2 个字（卡片徽章曾显示「紧急优先级」「普通优先级」，筛选下拉首项为「全部优先级」）。纯前端文案调整，无契约 / 权限 / 数据库 / 后端变化：

- `apps/web/src/features/my-tasks/TaskCenterPageView.tsx` 卡片页脚徽章由 `{priorityLabels[priority]}优先级` 改为直接渲染 `priorityLabels[priority]`，即「低 / 普通 / 高 / 紧急」，并保留 `title="优先级：X"` 作为悬停与辅助技术补充；列表视图徽章、任务创建与遗留转任务下拉、筛选下拉的其余选项原本已是短标签。
- 同一筛选栏的优先级下拉首项由「全部优先级」改为「全部」，与该栏其它筛选（状态、任务范围）已用的「全部」保持一致。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| UI-PRIORITY-LABEL-UNIT-001 | Web 单元 | 卡片徽章与筛选选项长度 | `TaskCenterPageView.test.tsx`：高 / 紧急卡片徽章文本恰为「高」「紧急」且 `title` 为「优先级：高 / 紧急」；优先级筛选选项严格等于 `["全部","紧急","高","普通","低"]` 且每项不超过 2 个字符 | 本地通过 |
| UI-PRIORITY-LABEL-E2E-001 | 浏览器 E2E | 任务中心真实数据 | `aggregate-views.spec.ts` 2 passed：卡片徽章 `locator('[title="优先级：普通"]')` 文本为「普通」；优先级筛选仍可写入 / 清除 URL | 本地通过 |

本地实际执行（2026-09-15）：`pnpm test:web` **76 文件 413 例通过**；`pnpm lint`、`pnpm format:check`、`pnpm --filter @inpulse/web typecheck`、`pnpm --filter @inpulse/e2e typecheck`、`pnpm --filter @inpulse/e2e exec playwright test tests/aggregate-views.spec.ts`（2 passed）通过；真实浏览器复验（Vite 5173，普通成员 xiaopan，`/tasks?scope=created`）卡片徽章渲染「紧急」「普通」，优先级筛选选项读取为 `["全部","紧急","高","普通","低"]` 且默认显示「全部」。

未运行 / 已知偏差：① 本批次只改文案，未跑数据库 / 契约 / 权限门禁（无相关改动）；② 修改与新增测试需非作者人工评审。

## 面包屑模块导航 404 修复（整体 UI 回归续，2026-09-15 本地落库）

用户反馈：在功能页点击顶部面包屑里的「模块」会进入「页面不存在」。定位结论：`AppLayout` 面包屑的模块按钮生成了 `/projects/:projectId/modules/:moduleId`，而 `apps/web/src/pages` 下只注册了 `/projects/:projectId/modules`、`/projects/:projectId/modules/:moduleId/tasks` 与 `/projects/:projectId/modules/:moduleId/features/:featureId?`，因此该 URL 落到 `path: "*"` 兜底，渲染品牌化 404。侧栏系统目录（`treePath`）与后端通知 `targetPath`（如 `apps/api/src/modules/tasks/task-completion.port.ts`）都带 `/features` 或 `/tasks` 后缀，只有面包屑这一处漂移。

- 修复：`apps/web/src/app/layout/AppLayout.tsx` 面包屑模块按钮改为 `/projects/${catalogProjectId}/modules/${catalogScope.moduleId}/features`，与 `treePath`（模块 -> 功能目录）一致；未新增路由、未改契约，后端零改动。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| UI-BUG-MODULE-CRUMB-UNIT-001 | Web 单元 | 面包屑模块名落地页 | `AppLayout.test.tsx` 新增用例：在 `/projects/7/modules/3/features/5` 点击面包屑「调度模块」后渲染「功能目录内容」；把该行回退为无 `/features` 的路径后同一用例失败（已实测） | 本地通过 |

真实浏览器验证（临时 Playwright 用例，验证后已删除）：普通成员登录后进入功能详情页，点击面包屑中的模块名，修复后落在 `/projects/49/modules/44/features`、页面渲染功能目录且无「页面不存在」；把该行回退为无 `/features` 的路径后，同一步骤渲染「页面不存在」并留下失败截图，与用户反馈完全一致。

本地实际执行（2026-09-15）：`pnpm --filter @inpulse/web exec vitest run src/app/layout/AppLayout.test.tsx` 12 例通过，回退修复后同一用例失败（确认可挡住回归）；`pnpm test:web` **76 文件 414 例通过**；`pnpm format:check` 与 `pnpm typecheck`（全 workspace）通过。

未运行 / 已知偏差：① 本轮未重跑 `pnpm test:e2e` 与 `pnpm check` 整链，改动为单处路径字符串并有单元用例锁定；② 新增测试需非作者人工评审。
