# 测试矩阵

状态：已接受的验收基线。当前仓库处于阶段 0 实施中，尚无完整业务应用代码，数据库真实 PostgreSQL 测试与搜索服务/HTTP API 集成测试已部分落地；`已自动化` 表示该检查的脚本已落库并已纳入 `.github/workflows/ci.yml`（实际执行证据见各章节的状态说明），`Required` 表示对应阶段必须实现并由 CI 执行，不代表测试已经通过。

2026-09-12 清账：main `4141e1d` 的 `CI / workspace`（[run 34620173140](https://github.com/256-code/InPulse/actions/runs/34620173140)，含五个生产镜像构建与 Trivy 扫描、Browser E2E 50 passed / 6.3 分钟）与 `Documentation / docs`（[run 34620173112](https://github.com/256-code/InPulse/actions/runs/34620173112)）已通过；下列历史小节按当时事实保留，其中「GitHub Actions 待执行 / 尚未执行」为当日本地交审时点的描述，实际 CI 结果已在行内回填。

2026-09-15 修订（[ADR-031](adr/ADR-031.md) 移除 TOTP）：下表所有「TOTP / 双因子 / 管理员重认证 / 恢复码」表述均已被 ADR-031 取代——7 条 MFA 路由（注册、验证、重认证、恢复码轮换与消费、管理员 MFA 重置）、前后端实现与对应单元 / 集成 / E2E 用例已删除；登录只保留口令因素并直接签发 `AUTHENTICATED` Session；管理员高风险操作门禁改为「当前有效的完整管理员 Session（`is_admin`）+ 写操作同步 CSRF + 数据库幂等 + 审计留痕」，不再校验 `reauthenticated_at` / `mfa_verified_at`，最后一名保护改为 `LAST_ACTIVE_ADMIN_REQUIRED`。SEC-010 至 SEC-014、FE-011 与 CI-017 的 MFA 部分为已被取代的历史覆盖记录；`user_totp_factors`、`mfa_recovery_codes` 与 `user_sessions` 的历史 MFA 列按本期决定「只停用不删除」。

2026-09-15 修订（[ADR-032](adr/ADR-032.md) 接入立镖 Casdoor OIDC 单点登录）：`/login` 默认整页跳转到 `GET /api/v1/auth/sso/start`，回调 `GET /api/v1/auth/sso/callback` 校验 state（URL + `__Host-sso-state` Cookie 双绑定）与 id_token 后，复用与口令登录同一实现签发本地 Session；首次登录 JIT 开通账号（`is_admin=false`、`password_hash=NULL`、无项目权限），映射优先级为 `sso_subject` → 登录名 + 邮箱一致绑定 → JIT；`SSO_ENABLED` 未配置或配置非法时 fail closed 回落 `/login?local=1&sso=disabled`。本地会话空闲有效期由 8 小时收紧为 30 分钟（口令与 SSO 共用，`SESSION_IDLE_MAX_AGE_SECONDS` 可覆盖；2026-09-20 已由 [ADR-038](adr/ADR-038.md) 调整为默认 2 小时/7200 秒）。新增 SEC-016 至 SEC-020 与 FE-012 覆盖本片；`securityFlow` allowlist 由三条（ADR-031 后）扩为五条；迁移 `0014_sso_backup_grants.sql` 为 `app_backup` 补齐 `app.sso_login_attempts` 的 pg_dump 只读授权，该表数据经 `--exclude-table-data` 排除（见 BACKUP-001）。

2026-09-18 修订（[ADR-036](adr/ADR-036.md) 修订 ADR-032 前端入口）：`/login` 默认展示本地口令表单，不再自动整页跳转；登录框下方新增「或以统一身份认证登录」图标入口，点击后整页跳转 `/api/v1/auth/sso/start`（302 导航与 fail closed 回落不变：未启用时回落 `/login?local=1&sso=disabled` 并提示、隐藏入口）；`?sso_error=` 回落保留本地表单与可重试的 SSO 入口；退出登录与「前往登录」回 `/login`。登录页单测、`AppLayout` 退出用例与 E2E `auth.spec.ts` 的未配置回落用例已同步改写；服务端路由、契约与权限矩阵无改动。
2026-09-20 修订（[ADR-038](adr/ADR-038.md) 调整本地会话空闲时长）：本地会话空闲有效期由 30 分钟（1800 秒）改为默认 2 小时（7200 秒），口令与 SSO 共用 `SESSION_TTL_POLICY`，`SESSION_IDLE_MAX_AGE_SECONDS` 仍可覆盖；「自签发起固定计算、不随请求滑动续期」与绝对超时 7 天的语义不变。SEC-018 的期望窗口改为 7200 秒，`session-ttl.policy.test.ts` 与 `sso-login.integration.test.ts` 的断言同步更新；部署示例 `deploy/.env.deploy.example` 与 `deploy/.env.deploy.test` 写入 `SESSION_IDLE_MAX_AGE_SECONDS=7200`。无契约、权限矩阵与数据库改动。
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
| F06-ARCHIVE-E2E-001 | Playwright | 归档→只读→恢复关键路径 | 管理员登录后创建项目/功能/任务；归档预览提示“仍有 1 个未完成任务”；项目卡徽标“未开始”（新建项目从未开始起步）、归档后徽标“已归档”、编辑被拒“项目已归档，项目只读…”且名称未落库；恢复“进行中”后可改名成功、原任务保留 | 本地 1/1（2.6 分钟；E2E_API_PORT=3131 / E2E_WEB_PORT=4191） |

## F-12 未分类模块编辑（2026-09-09 人工确认）

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| MOD-EDIT-UNCLASSIFIED-001 | HTTP + PostgreSQL + 前端 | 编辑未分类名称、描述 | 活跃成员和管理员在父级及模块可写时允许编辑；kind 保持 UNCLASSIFIED；名称冲突、旧版本、无权限均拒绝；失败时保留表单输入；不提供物理删除 | 本地前端与真实 HTTP/PostgreSQL 已通过，见 F-12 交审说明 |

## F-12 模块完整纵切片（B，2026-09-09 本地交审）

接口、边界与命令见 [F-12 本地交审](f12-local-handoff.md)。以下新增用例独立验证业务行为，不替代原 Port 的证据；2026-09-09 在临时 PostgreSQL 18.6 + PGroonga 4.0.8 实测通过。

| ID | 层级 | 场景 | 通过标准 | 当前证据 |
| --- | --- | --- | --- | --- |
| MOD-HTTP-001 | HTTP + PostgreSQL | listModules/createModule/updateModule 允许与拒绝 | 匿名 401，其他项目/已移除成员 404；管理员可读；普通创建固定 NORMAL；未分类可改名，输入身份字段拒绝 | modules-api.integration.test.ts 10/10 本地通过 |
| MOD-HTTP-002 | HTTP + PostgreSQL | archiveModule/restoreModule 允许与拒绝 | 普通成员与组长同等允许（ADR-039）；匿名/停用 401、非成员 404；状态/版本冲突 409；归档父级拒绝写但允许历史读取 | 同上，已通过（ADR-039 后重写为正向断言） |
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
| F05-MEMBER-E2E-001 | Playwright | 成员管理页面关键路径 | 活跃成员访问 `/projects/:id/members` 直接展示管理视图（ADR-039；本行早期记录的 `RequireAdmin` 403 空态已在 ADR-033 后失效）；通过页面添加成员出现成功提示与「活跃成员」徽标；移除成员出现确认对话框与「该成员没有未完成任务。」，确认后保留历史记录卡并标记「已移除」「历史记录已保留」；不存在的项目返回前端映射的读取失败空态 | 本地通过（`apps/e2e/tests/project-members.spec.ts`；ADR-039 后断言已反转） |
| F05-READ-E2E-001 | Playwright | 项目页面回归 | 项目创建关键路径与全量 E2E 结果如实记录 | 本地通过（`pnpm test:e2e` 29/29，4.7m，含本 diff 新增的成员管理 2 例与既有 F-18 记录发布、搜索/动态/通知/任务用例） |

2026-09-09 本地验证说明：`pnpm test:unit` 数据库 5 例、api-contract 67 例、Web 33 文件
104 例、API 59 文件 274 例；`pnpm test:integration` 数据库 13 例、API 34 文件 190 例。
临时 PostgreSQL 18.6 + PGroonga 4.0.8 曾因 `max_connections=100` 初始化不足，已改为
`max_connections=200` 后完整通过；成员管理页面 Playwright E2E 已于 2026-09-10 由
`apps/e2e/tests/project-members.spec.ts` 补齐（本地 2/2；该分支 rebase 到 `origin/main` `5020c0a` 后全量 29/29 通过）。

## ADR-033 项目内角色（组长与项目管理员，A，2026-09-16 本地落库）

> 2026-09-22 跟进：[ADR-039](adr/ADR-039.md) 移除了 `PROJECT_ADMIN` 并把项目内管理权下发给全体活跃成员，
> 本节全部「通过标准」描述的是当时事实；与本节冲突时以本文末「ADR-039 移除项目管理员角色」章节为准。

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
| ADR033-API-001 | API 单元 | 角色门禁与 setRole 编排（~~已被 ADR-039 取代~~） | `ProjectRoleGateService.manageRole` 返回 SYSTEM_ADMIN/LEADER/PROJECT_ADMIN/MEMBER/NOT_MEMBER；`roleSetterRole` 把 PROJECT_ADMIN 降级为 MEMBER（不能任命角色）；`setRole` 门禁 NOT_MEMBER→404、MEMBER→403 `PROJECT_MEMBER_ROLE_FORBIDDEN`、LEADER 设 LEADER→403 `PROJECT_MEMBER_LEADER_ASSIGN_FORBIDDEN`、唯一冲突→409 `PROJECT_MEMBER_LEADER_CONFLICT`；移除 LEADER→409 `PROJECT_MEMBER_LEADER_PROTECTED`；读/写路径经 `requireManageRole` | 历史通过（当时 `project-member-management.service.test.ts`、`project-member-management-http.service.test.ts`；角色口径已由 ADR-039 取代） |
| ADR033-API-002 | HTTP + PostgreSQL | 组长/项目管理员管理成员，跨项目与非成员隐藏（~~已被 ADR-039 取代~~） | 组长（非系统管理员）可查看成员列表、添加成员；普通成员管理成员 403 `PROJECT_MEMBER_MANAGE_FORBIDDEN`；非成员/已移除成员统一 404；PROJECT_ADMIN 可管理成员但任命角色 403 `PROJECT_MEMBER_ROLE_FORBIDDEN` | 历史通过（当时 `project-member-management-api.integration.test.ts` 14/14；「普通成员 403」已由 ADR-039 取消） |
| ADR033-API-003 | HTTP + PostgreSQL | 角色任命、组长保护、转移与审计（~~已被 ADR-039 取代~~） | 组长任命 PROJECT_ADMIN 200 且写审计 `project.member.role.set` + 活动 `PROJECT_MEMBER_ROLE_CHANGED`；组长任命/转移 LEADER 403；移除 LEADER 409；系统管理员转移组长后目标 LEADER、原组长自动降级 MEMBER；非成员/已移除成员 404 | 历史通过（当时集成 14/14；ADR-039 后只有系统管理员能任命/转移角色） |
| ADR033-API-004 | HTTP + PostgreSQL | 组长归档/恢复模块与普通成员拒绝（~~已被 ADR-039 取代~~） | 组长（非系统管理员）可 archiveModule/restoreModule（200，状态/版本推进）；普通成员归档模块 403 `MODULE_MANAGE_FORBIDDEN` | 历史通过（当时 `modules-api.integration.test.ts` 11/11；ADR-039 后普通成员同样可归档） |
| ADR033-IDEM-001 | HTTP + PostgreSQL | 角色写重放的角色门禁（~~已被 ADR-039 取代~~） | 同 Key、同 body 重放返回缓存响应；操作者被降级为普通成员后，新任命 403 `PROJECT_MEMBER_ROLE_FORBIDDEN`，原 Key 重放被重放授权器拒绝 403 `PROJECT_MEMBER_MANAGE_FORBIDDEN`，不泄露已存响应 | 历史通过（ADR-039 后降级成员重放改用「被降级的系统管理员且非项目成员」→404） |
| ADR033-REMOVE-001 | HTTP + PostgreSQL | 移除重置角色（removed_role_check） | 移除 LEADER 成员时同事务把 role 重置为 MEMBER（ADR-039 后目标只能是 LEADER 或 MEMBER），不触发 `project_members_removed_role_check` 约束；已移除成员的角色不复活 | 本地通过（成员管理集成 + `database.helpers.removeMember` 与 `postgres-projects-write-port.removeMember` 均重置 role） |
| ADR033-UI-001 | 前端单元 | 成员页角色入口与只读视图（~~已被 ADR-039 取代~~） | `getProject.currentUserRole` 驱动入口：系统管理员进入管理视图，其余活跃成员同样可管理（ADR-039）；成员卡片只对 LEADER 显示角色徽标；「设置角色」只对系统管理员显示；`setProjectMemberRole` 经生成客户端携带 CSRF + Idempotency-Key | 历史通过（当时 `ProjectMembersPageView.test.tsx` 6/6、`project-member-query.test.tsx` 5/5；ADR-039 后已重写断言） |

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
| AUTHZ-007 | API 集成 | 项目、模块或功能归档/恢复 | 本项目任意活跃成员（含 LEADER，ADR-039）允许；跨项目或已移除成员为 404；非成员 404（ADR-039 起不再有成员 403 分支） | 已自动化（`features-api.integration.test.ts` 归档/恢复与成员门禁、`apps/e2e/tests/project-archive.spec.ts`；CI 已执行） |
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
| SEC-018 | API + PostgreSQL 集成 | 单点登录纵切片（桩 IdP） | start 只落库 state 的 HMAC 与 key version 并下发 `__Host-sso-state`；回调必须同时匹配 URL state 与 Cookie（缺失或不同即 `state-mismatch`）后一次性消费；JIT 开通写 `sso_subject`、`password_hash=NULL`、`is_admin=false`，二次登录按 subject 命中并同步展示名/邮箱；仅当登录名命中且邮箱一致才绑定，邮箱不一致或被占用为 `account-conflict`；停用账号 `account-disabled`；重放 `state-consumed`、过期 `state-expired`、未知 state `state-invalid`、nonce 不符 `token-invalid`、IdP 返回 error 为 `idp-error`；成功签发 `AUTHENTICATED` 会话（空闲 7200s、绝对 7 天、只存 Hash）并写 `auth.sso_account_provisioned`/`auth.sso_account_linked`/`auth.sso_login` 审计 | 已本地通过（`apps/api/test/sso-login.integration.test.ts` 13 例，真实 PostgreSQL + 桩 IdP，2026-09-15） |
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
| FE-012 | 单元测试 | 单点登录前端入口与会话失效恢复（[ADR-032](adr/ADR-032.md)） | `/login` 未带 `local=1` 时整页跳转 `GET /api/v1/auth/sso/start?returnTo=...`，`local=1` 或 `sso=disabled` 时显示本地口令入口与回落提示；账号菜单在已认证态退出、未认证态直接进入 SSO；**已认证会话下任何业务请求返回 401 时收敛为匿名并跳 `/login?from=...`**（由登录页静默重走 SSO），403/404/409/500 不触发跳转 | 本地通过（`sso-navigation.test.ts`、`LoginPage.test.tsx`、`AppLayout.test.tsx`；新增 `session-recovery.test.ts` 3 例、`AppProviders.test.tsx` 2 例，2026-09-18） |
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
| F-32 页面层：URL 读取筛选、筛选写回 URL、more 参数控制高级面板、遗留问题就地弹窗（2026-09-20 起不再跳转 `/issues`，见文末条目）、非管理员降级与管理员保留 | `pages/tasks/TasksPage.test.tsx`（当前 8 例） |
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
| F-32 关键路径：在 fixture 项目经真实 UI 创建功能并把任务指派给当前用户后，`/tasks` 默认「我负责的 + 未完成」返回该任务（卡片含负责人、不显示无契约来源的优先级徽章）；开发期「接口说明」黄条按设计师稿 `task-center.tsx` 移除，断言 `task-center-mock-notice` 计数为 0；统计卡 `stat-my-open` 为「—」；搜索任务 / 优先级 / 「我创建的」按契约缺口禁用；F-30 URL 状态 `status=done`、`view=list`、`more=1` 写回地址栏；「遗留问题」入口跳转 `/issues`（2026-09-20 起改为就地弹窗，见文末条目） | `apps/e2e/tests/aggregate-views.spec.ts` 例 1；定向 `playwright test aggregate-views` 2/2；落库当时全量 `pnpm test:e2e` 42/42；`接口说明` 断言于 2026-09-12 前端大改后改为计数 0（见文末「前端交互大改」条目） |
| F-29 关键路径：`/projects/{projectId}/overview` 标题为服务端项目名、成员数为服务端真实值且 > 0、任务/记录/遗留三项以数字形态渲染、已取消的 `overview-metric-modules` 与 `overview-metric-features` 计数为 0、最近迭代与待处理遗留问题面板及空态；「查看全部」→ `/records?view=published&projectId=`、「查看模块」→ 模块页（项目头「全部项目」入口已于 2026-09-19 按用户要求移除，返回项目列表改走侧栏） | `apps/e2e/tests/aggregate-views.spec.ts` 例 2；同上 |
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

`EXPLAIN (ANALYZE, BUFFERS)` 关键输出（本地 PostgreSQL 18.6，`app.tasks` 30,481 行，含 `tasks_assignee_status_idx (assignee_id, work_status, id)` 与 `tasks_pkey`；该索引已随 [ADR-040](adr/ADR-040.md) 的 `0021_contract_task_assignees.sql` 删除，下方为当时证据，现对应索引为 `task_assignees_user_idx (user_id, task_id)`）：

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

`GET /api/v1/audit-logs`（`getAuditLogs`）交付 F-08 步骤 4：原始审计读取必须留痕。要求当前有效的完整管理员 Session（ADR-031 起不再要求 TOTP 重认证；GET 只读路径不强制同步 CSRF、不使用幂等键）；不传 `projectId` 读 SYSTEM 链、传则读 `PROJECT:<id>` 链。查询经独立只读 `audit_reader` 连接（`AUDIT_DB_USER` 默认 `audit_reader`、`AUDIT_DATABASE_URL(_FILE)`，与业务连接分离，惰性建池、配置缺失或越界在首次读取 fail closed）。同一请求内先用业务连接向 SYSTEM 链追加 `AUDIT_LOG_READ` 留痕（含 filters/returnedCount/hasMore 与请求元数据，不含审计正文），留痕写失败则不返回读取结果。留痕按「查看」而不是「每次请求」计数（[ADR-042](adr/ADR-042.md)）：只有开启一次新查看的请求（进入审计页或切换审计对象）才写，同一次查看内的筛选、重置、重试与分页不写新留痕（带游标的分页由服务端排除，延续请求以 `readTrail=false` 声明）。`cursor` 为服务端 HMAC 签名、绑定操作者与查询指纹（含链、过滤器与 limit）、TTL 15 分钟；`limit` 默认 50、最大 100；`from`/`to` 为半开区间 `[from, to)` 且必须带时区。远端 WORM 归档与每日加密明细导出（F-08 步骤 6）已由 A2 交付，见本节末尾的「F-08 审计远端归档」。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F08-READ-API-001 | HTTP + PostgreSQL | 管理员读取 SYSTEM 链并留痕 | 管理员返回 `AuditLogPage`（SYSTEM 链、64 位十六进制 `prevHash`/`recordHash`、ISO 时间）；开启一次新查看的请求后在 SYSTEM 链恰有一条 `AUDIT_LOG_READ`，`targetId=SYSTEM`，payload 含 `returnedCount`/`hasMore` 与 filters，不含审计正文 | 本地通过（`apps/api/test/audit-logs.integration.test.ts` 7/7，2026-09-23 更新为「查看」粒度口径） |
| F08-READ-API-002 | HTTP + PostgreSQL | 身份与管理员门禁 | 匿名 401 `ADMIN_SESSION_REQUIRED`；普通成员 403 `ADMIN_REQUIRED` 且响应体不含任何审计内容；只读路径不强制同步 CSRF，完整管理员 Session 即可读取（ADR-031 起不再要求 TOTP 重认证） | 同上 |
| F08-READ-API-003 | HTTP + PostgreSQL | action 过滤与签名游标分页 | `action` 精确过滤 + `limit` 分页不重叠、无遗漏；游标跨查询（不同 action 或不同链）返回 422 `VALIDATION_FAILED`；非法游标、`from > to`、`limit=0` 均 422 | 同上 |
| F08-READ-API-004 | HTTP + PostgreSQL | 项目链隔离 | `projectId` 查询返回 `PROJECT:<id>` 链数据且不跨链（SYSTEM 链条目不出现在结果） | 同上 |
| F08-READ-API-005 | HTTP + PostgreSQL | 留痕按「查看」计数 | 带 `readTrail=false` 的筛选请求不写新留痕；非分页且未声明延续的请求恰写一条；带签名游标的分页即使显式传 `readTrail=true` 也不写；`readTrail` 取枚举外取值返回 422 | 本地通过（同上 7/7，2026-09-23） |
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

`listRecordDrafts`（F-17）与 `listChangeRecords`（F-18）由单页数组改为 C-006 服务端签名游标分页：契约以 `RecordDraftPage` / `ReadableRecordPage`（items/nextCursor/hasMore）替换 `RecordDraftList` / `ReadableRecordList`，新增 `RecordDraftListQuery`，`RecordListQuery` 增补 `cursor` 与 `limit`（1～100、默认 20，越界或未知字段 422）。草稿按 `created_at DESC,id DESC`、正式记录按 `published_at DESC,id DESC` 取 `limit+1` 条判断 `hasMore`，服务端把本页最后一条位置编码为签名游标；游标绑定 actor、命名空间与项目，TTL 15 分钟，篡改 / 过期 / 跨项目 / 跨命名空间统一 422 `INVALID_CURSOR`。查询参数不改变可见性：无权限项目先收敛为 404，通过后才校验游标。2026-09-16 起 `RecordDraftListQuery` 另接受可选 `authorId`（`z.coerce` 正整数，越界、非数字与未知字段 422），只返回该作者创建的草稿（前端项目草稿区传当前用户 id），并把作者过滤编入游标绑定 `filterKey`：同一游标换作者或去掉作者统一 422 `INVALID_CURSOR`，避免切换筛选后复用旧游标造成错位。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| B1-CONTRACT-001 | 契约 | 分页参数与 envelope | `RecordListQuery` / `RecordDraftListQuery` 接受 `cursor`+`limit`（字符串 “20” 归一为 20）并拒绝 0、101、非整数、超长游标与未知字段；`ReadableRecordPage` / `RecordDraftPage` 严格校验 `items`/`nextCursor`/`hasMore`，缺字段、空 `nextCursor`、未知字段均拒绝 | 本地通过（`packages/api-contract/test/published-records.test.ts`、`test/record-drafts.test.ts`；契约 15 文件 93 例通过） |
| B1-API-UNIT-001 | 单元 | 游标编码、解码与错误映射 | 第 1 页以本页最后一条位置编码 `nextCursor`，第 2 页以其为排他 keyset 边界；篡改、跨 actor、跨项目、跨命名空间 422 `INVALID_CURSOR`；无权限项目先 404 且不按游标状态区分；成员请求 VOID 列表 404；`limit` 1..100 透传、缺省 20 | 本地通过（`apps/api/test/record-list-pagination.test.ts` 4 例） |
| B1-WEB-001 | 前端单元 | 「加载更多」与签名游标 | 已发布记录与草稿列表点击「加载更多」后用服务端 `nextCursor` 请求下一页并追加渲染，第二次调用携带 `cursor`、`limit: 20` 与 AbortSignal；`hasMore=false` 后不再请求 | 本地通过（`apps/web/src/features/records/RecordsWorkspace.test.tsx`、`apps/web/src/features/record-drafts/RecordDraftsView.test.tsx`） |
| B1-INT-001 | PostgreSQL 集成 | keyset 不重不漏与游标校验 | 3 条草稿 / 正式记录以 `limit=2` 分两页取回：页内顺序为 `created_at DESC,id DESC` / `published_at DESC,id DESC`，两页无重叠无遗漏，`hasMore` 由 true 翻转为 false 且第二页 `nextCursor` 为 null；跨项目游标与损坏游标 422 `INVALID_CURSOR` | CI 已通过（PR #114，run 34571987936；本机当时无 PostgreSQL 实例与 Docker，用例由 CI 首次执行） |
| B1-INT-002 | PostgreSQL 集成 | 草稿列表按作者过滤与游标绑定（2026-09-16） | 两作者各建草稿：不传 `authorId` 返回全部；`authorId` 只返回该作者且 `hasMore`/`nextCursor` 分页正确；按作者过滤生成的游标换作者或去掉作者后复用统一 422 `INVALID_CURSOR`；HTTP 层 `authorId=abc` 与 `authorId=0` 422，合法参数未登录 401 | 本地通过（`apps/api/test/record-drafts.integration.test.ts` 16 例，含新增 1 例） |

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
| B3A-UNIT-005 | Web 单元 | 我的草稿条带与页头 CTA | 条带只列当前登录用户草稿，点击直接打开「编辑草稿」弹窗；页头 CTA 在不可写时禁用，可写时打开对应模式的草稿弹窗；「全部项目」视图下只要存在可写项目 CTA 即可用，全部项目都不可写时保持禁用；草稿详情与弹窗文案保持 | 本地通过（`RecordDraftsView.test.tsx` 与 `RecordsWorkspace.test.tsx`） |
| B3A-UNIT-007 | Web 单元 | 项目草稿区只看自己并可收起展开（2026-09-16） | 项目草稿查询携带 `authorId=当前用户`，任务来源草稿不变；区块标题行是可点击的展开/收起按钮（`aria-expanded` + `aria-controls`），收起后隐藏列表与「加载更多」，再次展开恢复原列表与分页状态 | 待人工确认（本地 76 文件 427 例通过，但该交互无自动化断言；`authorId` 请求参数已在浏览器网络面板确认为 `?limit=20&authorId=5`） |
| B3A-UNIT-008 | Web 单元 | 「全部项目」下记录一次迭代在弹窗内选项目（2026-09-16） | URL 无 `projectId` 时新建草稿弹窗在「所属模块」之上渲染「所属项目」下拉（可写项目可选、已归档项目 `disabled`），未选项目前不请求模块且「保存草稿」禁用；选定项目后按该项目请求模块并把所选项目 id 作为 `createIndependentRecordDraft` 第一个参数，成功后跳转 `/records?projectId=<所选项目>&recordId=<新草稿>`；URL 已带 `projectId` 时不渲染该下拉（项目自动沿用） | 本地通过（`RecordDraftsView.test.tsx` 新增 2 例 + `RecordsWorkspace.test.tsx`，本地 76 文件 429 例）；浏览器已复验：`/records` 全部项目视图点 `记录一次迭代` → 选「InPulse 研发交付平台」→ 模块列表加载 → 保存后 URL 变为 `/records?projectId=1&recordId=1245`；`/records?projectId=1` 打开弹窗无「所属项目」下拉且模块直接可选 |
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

> 2026-09-17 更新：本条的点击目标已被「任务中心卡片就地弹窗」条目取代——卡片、列表行与聚合组入口改为在当前页面就地打开同一个任务详情弹窗，不再深链跳转；「不复制只读弹层、写入口只有 `TasksPanel` 一处」的结论保持有效，下表的深链断言按新条目替换。

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
- 数据源：`getProject` + `listActiveProjectMembers`。2026-09-21 该只读路由的响应扩为专用契约 `ActiveProjectMembersResponse`（停留在活跃成员的 `id/name/avatarUrl/role/joinedAt`），卡片因此显示加入时间与项目内角色徽标；仍不返回移除时间等成员历史，也不提供任何写入口。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| NAV-CLEAN-UNIT-001 | 单元 | 概览视图收窄后的 props 与渲染 | `ProjectOverviewPageView.test.tsx` 8 例：删除 2 个「项目内导航」用例后其余（指标卡、面板、错误态、跳转）全通过；`ProjectOverviewPage.test.tsx` 6 例：2 个导航用例替换为「查看模块」入口用例 | 本地通过 |
| NAV-CLEAN-UNIT-002 | 单元 | 模块页 / 功能页移除横条与左栏后无回归 | `ModulesPageView.test.tsx` 8 例（删除「项目内导航」describe）、`FeaturesPageView.test.tsx` 10 例（删除「项目内导航」describe 与「module siblings」用例及其 `moduleRow`/`moduleClient` 辅助）全通过 | 本地通过 |
| MEMBER-RO-UNIT-001 | 单元 | 只读成员视图渲染与只读语义 | `ActiveProjectMembers.test.tsx` 6 例：复用管理员视觉（h1 项目名、`.panel.settings-panel`、`.calm-member-card` 数量）；无添加 / 移除 / 归档 / dialog、仅「刷新成员」；创建者标注且全员「活跃成员」；加入时间与角色徽标（LEADER 显「组长」、MEMBER 不显徽标、无「移除时间」、无「设置角色」）；空态；加载失败出「项目成员加载失败」+ 重试 | 本地通过 |
| MEMBER-RO-API-001 | 集成（真实 HTTP + PostgreSQL） | `listActiveProjectMembers` 响应契约与授权 | `projects-read-api.integration.test.ts` 2 例：200 且 `Cache-Control: no-store`，`ActiveProjectMembersResponse` strict parse 通过并返回 `[创建者 LEADER, 新成员 MEMBER]` 的 `{id, role}` 与 ISO `joinedAt`（ADR-039 后新成员不再写 `PROJECT_ADMIN`）；成员置 REMOVED 后从只读列表消失、历史行仍为 `REMOVED`；非成员 404 `PROJECT_NOT_FOUND`、匿名 401 `PROJECT_SESSION_REQUIRED`、不存在项目 404 | 本地通过（ADR-039 后已同步修复物） |
| MEMBER-RO-E2E-001 | 浏览器 E2E | 活跃成员成员页与隐藏项目 404 | `project-members.spec.ts` 例 1：活跃成员（ADR-039 起不再进入只读视图）可查看并管理本项目成员（「添加成员」「移除」可见），隐藏项目 404 且不泄露成员姓名；管理员用例（例 2）不受影响 | 待重跑（ADR-039 已反转断言；本机需先启动 E2E 环境） |

本地实际执行（2026-09-15，前端专项，无后端 / 契约 / 迁移改动）：`pnpm --filter @inpulse/web test` **74 文件 401 例通过**（新增 `ActiveProjectMembers.test.tsx` 5 例，删除导航相关 7 例、替换 2 例）；`pnpm --filter @inpulse/web typecheck`、`pnpm --filter @inpulse/e2e typecheck`、`pnpm --filter @inpulse/web build`、`pnpm --filter @inpulse/web check:boundaries`（246 模块 / 1171 依赖，无违规）、改动文件 ESLint 与 Prettier 检查通过；真实浏览器人工复验（Vite 5173，普通成员「小邵」登录）：`/projects/1/members` 渲染新只读视图（4 名成员、特哥标注创建者、无任何写入口）。

未运行 / 已知偏差：① `project-members.spec.ts` 因上述 argon2 环境问题未实跑，仅 typecheck；② 全量 `pnpm test:e2e`、整链 `pnpm check`（本机 npm 镜像缺 audit endpoint）、`pnpm check:docs` 未运行；③ 窄屏（侧栏折叠）下模块切换只剩面包屑与返回按钮，属本次收敛的已知取舍；④ `ProjectContextNav` 为设计师稿组件，本次删除属用户明确授权的设计偏离；⑤ 新增 / 修改测试需非作者人工评审。

**2026-09-21 补充：只读成员卡片补角色与加入时间（用户要求「和管理员视角一致，但没有写功能」）**

- 契约：新增 `ActiveProjectMemberItem` / `ActiveProjectMembersResponse`（`projects.zod.ts`，strict），`listActiveProjectMembers` 的 200 响应从借用 `TaskAssigneesResponse` 改为专用 Schema；任务指派人另两条路由（`listTaskAssignees` / `listModuleTaskAssignees`）继续返回 `TaskAssigneesResponse`。
- 服务端：`ProjectMembersQueryPort` 新增 `listActiveMemberProfiles`，`listActiveMembers` 改为从同一结果裁剪 `id/name/avatarUrl`（`TaskAssigneesResponse` 是 strict Schema，泄漏新字段会让任务指派人响应 500）。
- 前端：`ActiveProjectMembers` 成员卡改为「加入时间：…」+ 非 MEMBER 角色徽标（LEADER 蓝「组长」；`PROJECT_ADMIN` 紫「项目管理员」已在 [ADR-039](adr/ADR-039.md) 随角色移除），仍无任何写入口。
- 本地执行（2026-09-21）：契约 `drift`（5 产物）、`validate`、`permissions:check`（108/108）、`pnpm typecheck`、`ActiveProjectMembers.test.tsx` 6/6、真库 `projects-read-api.integration.test.ts` 6/6（含 MEMBER-RO-API-001 两例）、真库 `tasks-api.integration.test.ts` 45/45（回归任务指派人 strict 响应）。未运行：全量集成 / E2E / 整链 `pnpm check`（本机 npm 镜像缺 audit endpoint）。

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

## 模块弹窗底部归档入口（C，2026-09-16 本地落库）

用户要求在「点击模块弹出的窗口最下面」增加一个删除/归档入口，权限为系统管理员、项目管理员与项目创建者（普通组员没有）。按 [ADR-033](adr/ADR-033.md) 与 [功能设计 v1.1](../功能设计v1.1.md) BR-011（「项目、模块、功能只能归档；任务只能取消」），「删除模块」的唯一实现是逻辑归档，因此本轮只把既有的归档/恢复动作补到模块弹层底部：不新增接口、迁移或权限条目，也不引入模块物理删除。任务弹层对应的移除能力（取消任务）属于既有 F-16 状态流转，未在本轮改动。

- `apps/web/src/features/modules/ModuleEditorModal.tsx`：新增可选属性 `canArchive` 与 `onLifecycleRequest`；编辑既有模块时在 `.calm-action-footer` 左侧渲染「归档模块」（模块已归档时为「恢复模块」），点击后由宿主把弹层切到既有 `archive` / `restore` 流程，原因必填、`If-Match`、数据库幂等与服务端角色门禁全部沿用。
- `apps/web/src/features/modules/ModulesPageView.tsx` 与 `apps/web/src/features/features/FeaturesPageView.tsx`：传入 `canManageProjectResources(isAdmin, currentUserRole)` 与切换回调，弹层底部入口与列表页/模块详情页头部入口同源。
- `apps/web/src/styles/design-system.css`：新增 `.calm-action-footer > .footer-leading`，让底部归档入口靠左、与右侧「取消 / 保存」分离。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| ADR033-WEB-MODAL-ARCHIVE-UNIT-001 | Web 单元 | 组长在模块弹窗底部看到归档入口 | `ModulesPageView.test.tsx`：当前用户角色为 `LEADER` 时打开「编辑模块」，弹层 `.calm-action-footer` 内出现「归档模块」，点击后弹层切到「归档模块」并出现「操作原因」，填原因确认后以 `If-Match` 调用 `archiveModule` | 本地通过 |
| ADR033-WEB-MODAL-ARCHIVE-UNIT-002 | Web 单元 | 普通成员同样可见（ADR-039 修订） | 当前用户角色为 `MEMBER` 时弹层底部同样出现「归档模块」；`currentUserRole = null`（非成员）时不渲染 | 本地通过（ADR-039 后已重写） |
| ADR033-WEB-MODAL-ARCHIVE-UNIT-003 | Web 单元 | 普通成员不可见 | 当前用户角色为 `MEMBER` 时弹层底部既无「归档」也无「恢复」按钮 | 本地通过 |

本地实际执行（2026-09-16）：`pnpm --filter @inpulse/web exec vitest run src/features/modules/ModulesPageView.test.tsx` 14 例通过、同一命令跑 `src/features/features/FeaturesPageView.test.tsx` 12 例通过、`pnpm exec eslint`（4 个改动文件）无告警、`prettier --write` 已应用。未运行：`pnpm test:web` 全量、`pnpm test:e2e`、GitHub Actions；全 workspace `pnpm typecheck` 当前被拉取到的 `b35ba9e` 中 `apps/web/src/features/published-records/PublishedRecordDetail.tsx` 的 `InpulseIcon className` 类型错误阻断，与本次改动无关。

## 项目/模块「未开始」标签与按标签排序（C，2026-09-16 本地落库）

用户要求新增「未开始」标签（作用域内没有任何已完成任务），并让项目卡与模块卡默认按标签排序：进行中 → 未开始 → 已归档。项目侧的「未开始」在 2026-09-17 的四态改造中改为读存储状态（见下文《项目生命周期四态（ADR-035）》），模块与功能仍沿用本节的推导口径。本轮只改展示与排序口径，不改动任何归档/恢复权限与状态流转语义（[ADR-033](adr/ADR-033.md) 与功能设计 v1.1 §项目/模块归档规则不变）。

判定口径统一为：`status = 'ARCHIVED'` 一律最后一档；`ACTIVE` 且已完成任务数为 0 即「未开始」；否则「进行中」。已完成任务数沿用 `openTaskCount` 的「有效任务」口径（排除 `INVALID` 与仍挂在活跃聚合组下的历史来源分支），只把 `work_status` 由 `'TODO'` 换成 `'DONE'`。

- `packages/api-contract/src/contracts/modules.zod.ts` / `projects.zod.ts`：`ModuleStats` / `ProjectStats` 新增必填 `completedTaskCount`（非负整数）。
- `apps/api/src/stats/card-stat-columns.ts`：抽出 `effectiveTaskWhere`，新增 `completedTaskCountColumn` 与 `lifecycleRankExpression`（模块与功能的档位排序键，档位 0/1/2 与前端同规则；项目在四态改造后改用 `projectLifecycleRankExpression`，档位 0/1/2/3）。
- `apps/api/src/modules/modules/module-management.repository.ts`、`apps/api/src/modules/projects/postgres-project-query-port.ts`、`postgres-projects-write-port.ts`、`projects-write.port.ts`：返回新字段；项目列表与模块列表的 `ORDER BY` 改为「生命周期档位 → sort_order/id（项目为 id）」。
- `packages/api-contract/src/module-routes.ts` / `route-registry.ts`：`listModules` 与 `listProjects` 摘要同步新排序；4 条模块写路由与 3 条项目写路由的 `safeBodyFieldPaths` 补 `stats.completedTaskCount` / `project.stats.completedTaskCount`，并升 `idempotencyContractVersion`（模块 1.2.0→1.3.0、1.3.0→1.4.0；项目 1.2.0→1.3.0），旧 Key 在新契约下返回 409；OpenAPI 与生成客户端由 `pnpm contract:generate` 重生成。
- `apps/web/src/features/common/resource-lifecycle.ts`（新增）：标签与配色判定，规则与后端 `lifecycleRankExpression` 一致；未开始用 `cyan`，进行中沿用各页原有主色（项目蓝、模块灰；2026-09-20 起统一为蓝，见文末《生命周期与标签徽章同色》），已归档沿用琥珀。
- 项目标签接入：`ProjectsPageView` 卡片、`ProjectOverviewPageView` 头部、`ProjectMembersPageView` 头部与状态项、`ActiveProjectMembers` 头部与状态项；模块标签接入：`ModulesPageView` 卡片、`FeaturesPageView` 模块资料行、`ModuleTasksPage` 模块资料行。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| LIFECYCLE-WEB-UNIT-001 | Web 单元 | 三档判定与配色 | `resource-lifecycle.test.ts`：`ARCHIVED` 优先于未开始；`ACTIVE` + 0 已完成 = 未开始且配色为 `cyan`；`ACTIVE` + ≥1 已完成 = 进行中并沿用调用方主色 | 本地通过 |
| LIFECYCLE-WEB-UNIT-002 | Web 单元 | 模块卡标签 | `ModulesPageView.test.tsx`：`completedTaskCount = 0` 的活跃模块渲染「未开始」且 class 含 `badge-cyan`；有已完成任务的模块为「进行中」且 class 含 `badge-blue`（同色收敛前断言的是 `badge-gray`，见文末《生命周期与标签徽章同色》），已归档模块为「已归档」且 class 含 `badge-amber` | 本地通过 |
| LIFECYCLE-WEB-UNIT-003 | Web 单元 | 项目卡标签 | `ProjectsPageView.test.tsx`：`completedTaskCount = 0` 的项目渲染「未开始」，另一项目仍为「进行中」；该用例已在四态改造中改写为按存储状态断言，见下文《项目生命周期四态（ADR-035）》 | 本地通过 |
| LIFECYCLE-API-INT-001 | 真实 PostgreSQL | 模块列表按档位排序 | `modules-api.integration.test.ts`：同项目内「有已完成任务 / 无已完成任务 / 已归档」三个模块按 进行中→未开始→已归档 返回，`stats.completedTaskCount` 分别为 1/0/0 | 本地通过 |
| LIFECYCLE-API-INT-002 | 真实 PostgreSQL | 项目列表按档位排序 | `projects-read-api.integration.test.ts`：三个项目按 进行中→未开始→已归档 返回，`completedTaskCount` 为 1/0/0；该用例已在四态改造中改写为四个项目，见下文《项目生命周期四态（ADR-035）》 | 本地通过 |
| LIFECYCLE-API-INT-003 | 真实 PostgreSQL | 旧字段口径未变 | 既有 `projects-read-api` 统计夹具仍要求 `expectedStats`（含新的 `completedTaskCount: 1`）与 R-2 项目概览口径一致 | 本地通过 |

本地实际执行（2026-09-16）：`pnpm --filter @inpulse/api test:unit` 64 文件 351 例通过；`pnpm --filter @inpulse/api test:integration`（`TEST_DATABASE_URL` 指向本机 PGroonga 容器）48 文件 444 例通过；`pnpm test:web` 77 文件 436 例通过；`pnpm --filter @inpulse/api typecheck`（含 `tsconfig.test.json`）通过；`pnpm lint`、`pnpm format:check`、`pnpm contract:drift`、`pnpm contract:validate`（98 条路由）、`pnpm permissions:check`（98 条操作）、`pnpm check:frontend:boundaries` 通过。为在浏览器看到真实效果，另用仓库外临时 Dockerfile 重建并重启了本机 `inpulse-api` 容器（镜像 `inpulse/api:local`，未改动仓库内 Dockerfile）。

未运行 / 已知偏差：① 本轮未跑 `pnpm test:e2e` 与 `pnpm check` 整链、GitHub Actions；② 全 workspace `pnpm typecheck` 仍被拉取到的 `b35ba9e` 中 `apps/web/src/features/published-records/PublishedRecordDetail.tsx:286` 的 `InpulseIcon className` 类型错误阻断（与本次改动无关，也未修）；③ 功能设计 v1.1 未逐字列出项目卡/模块卡统计字段，本轮只同步了契约、Route Registry 摘要与测试矩阵，未改设计文档；④ 新增测试需非作者人工评审。

## 项目归档申请—审核与任务归档（C，2026-09-16 本地落库）

用户确认的口径：① 项目归档保留「双方同意」，但申请权与审批权分离——活跃成员（ADR-039 前为项目组长、项目管理员与系统管理员）可发起申请，只有总管理员（系统管理员）能批准真正归档；② 拦截口径只针对任务——项目归档的申请与批准、模块归档都要求作用域内任务均已收尾，功能不需要归档、也不参与任何一级的拦截。（该口径在 2026-09-16 第二轮按用户反馈修正：任务「完成」即算收尾，不再要求必须归档。）完整决策与边界见 [ADR-034](adr/ADR-034.md)。

- 迁移 `database/migrations/0016_project_archive_requests.sql`：新表 `app.project_archive_requests`（`status` 枚举 CHECK、`project_archive_requests_one_pending` 部分唯一索引、origin guard 触发器，`app_runtime` 授予 SELECT/INSERT/UPDATE）。该迁移尚未合并，初版用 `BIGINT` 主键导致 postgres.js 返回字符串并使响应 Schema 校验失败，改为 `integer` 后手动回退该迁移并重新 apply 验证通过。
- 契约与权限：新增 `requestProjectArchive`/`approveProjectArchive`/`rejectProjectArchive` 与 `archiveTask`/`restoreTask`/`archiveModuleTask`/`restoreModuleTask` 共 7 条路由（Route Registry 98 → 105 条）；`projectListItemSchema` 增加 `currentUserRole`/`pendingArchiveRequest`；`docs/permissions.md` 同步新增条目，`archiveModule` 行补充 409 说明。
- 后端：新增 `ProjectArchiveRequestService`/`Controller`/`Module` 与 PostgreSQL 仓储；`ProjectsWritePort.countUnarchivedTasks` 与 `ModuleManagementRepository.countUnarchivedTasks` 落实任务归档前置校验；`TasksManagementService` 新增 4 个生命周期命令并复用 `ProjectRoleGateService` 角色门禁。
- 前端：项目列表按角色区分「申请归档」「归档申请审核中」「批准归档」「驳回申请」入口；模块与任务弹窗底部归档入口；409 使用专用文案。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| ADR034-API-INT-001 | 真实 PostgreSQL | 归档申请角色矩阵（~~角色口径已被 ADR-039 修订~~） | `project-archive-request-api.integration.test.ts`：活跃成员（LEADER 或 MEMBER 同等）可发起申请，任务未收尾时 409 `PROJECT_ARCHIVE_TASKS_OPEN`；非成员与其他项目 404 | 本地通过（ADR-039 后已重写） |
| ADR034-API-INT-002 | 真实 PostgreSQL | 申请前置校验与幂等 | 项目下存在未完成且未归档的任务时申请 409 `PROJECT_ARCHIVE_TASKS_OPEN`；提交成功后同 Key 同摘要重放原响应，同一项目重复申请 409 | 本地通过 |
| ADR034-API-INT-003 | 真实 PostgreSQL | 只有系统管理员能审核 | 活跃成员（含 LEADER）审核 403 `ADMIN_REQUIRED`；不存在项目 404；驳回后项目仍为 ACTIVE 且 `row_version` 不变 | 本地通过 |
| ADR034-API-INT-004 | 真实 PostgreSQL | 批准按 If-Match 归档 | 版本不匹配 409 `PROJECT_VERSION_CONFLICT`；批准后项目 ARCHIVED、申请 APPROVED，重复批准 409 `PROJECT_STATE_CONFLICT` | 本地通过 |
| ADR034-API-INT-005 | 真实 PostgreSQL | 申请同事务副作用与列表字段 | 审计 `project.archive.request`、活动 `PROJECT_ARCHIVE_REQUESTED` 与发给系统管理员的站内通知同事务提交；项目列表返回 `currentUserRole` 与 `pendingArchiveRequest` | 本地通过 |
| ADR034-API-INT-006 | 真实 PostgreSQL | 任务归档与恢复 | `tasks-api.integration.test.ts`：只切换 `lifecycle_status` 且不写 `task_status_history`；审计 `task.archive`/`task.unarchive`、活动与搜索投影同事务；普通成员可在本项目内归档自己的任务（ADR-039）、跨项目 404、版本 409、状态 409 | 本地通过（ADR-039 后已重写） |
| ADR034-API-INT-007 | 真实 PostgreSQL | 模块归档前置校验 | `modules-api.integration.test.ts`：模块下仍有活跃任务时归档 409 `MODULE_ARCHIVE_TASKS_OPEN`，任务归档后可成功归档 | 本地通过 |
| ADR034-API-INT-008 | 真实 PostgreSQL | 直接归档取消待审申请 | `project-management-api.integration.test.ts`：系统管理员直接 `archiveProject` 时 PENDING 申请被置为 CANCELED，审计 payload 记录 `cancelledArchiveRequestIds` | 本地通过 |
| ADR034-WEB-UNIT-001 | Web 单元 | 项目列表归档入口 | `ProjectsPageView.test.tsx`：活跃成员（含 LEADER）可看到「申请归档」，待审时显示「归档申请审核中」，系统管理员看到「批准归档」「驳回申请」，非成员看不到入口 | 本地通过（ADR-039 后已重写） |
| ADR034-WEB-UNIT-002 | Web 单元 | 申请与审核弹窗 | `project-management-modals.test.tsx`：申请提交带 CSRF 与幂等键、409 冲突显示专用文案、批准携带 `If-Match`、驳回批注可空 | 本地通过 |

本地实际执行（2026-09-16）：`pnpm contract:generate`；`pnpm contract:validate`（105 条路由全部通过）；`pnpm permissions:check`（105 条操作 / 105 条路由）；`pnpm contract:drift`（5 个产物一致）；`pnpm lint`；`pnpm format:check`；`node scripts/check_docs.mjs`（80 个 Markdown 文件的链接与锚点）；真实 PostgreSQL 18.6 + PGroonga 下 `pnpm --filter @inpulse/api test:integration` 49 文件 453 例通过；`pnpm --filter @inpulse/api test:unit` 64 文件 351 例通过；`pnpm test:web` 77 文件 445 例通过。

未运行 / 已知偏差：① 未跑 `pnpm test:e2e`、`pnpm check` 整链与 GitHub Actions；② `pnpm deps:audit` 在本机 npm 镜像缺少 audit endpoint 时会失败，本轮未运行也未新增依赖；③ 全 workspace `pnpm typecheck` 仍被既有无关错误 `apps/web/src/features/published-records/PublishedRecordDetail.tsx:286` 阻断（未修）；④ 本地 `inpulse-api` 容器未按本轮重建，浏览器端验证依赖前端 Vite HMR；⑤ 新增测试需非作者人工评审。

## 功能归档权限与任务、模块对齐（C，2026-09-16 本地落库）

用户要求「功能应该也要有可以删除的按钮，删除权限与任务相同」。按 BR-011「项目、模块、功能只能归档」，「删除功能」的唯一实现是逻辑归档，因此本轮把功能归档/恢复的权限与任务、模块归档对齐（当时为系统管理员、本项目组长或项目管理员；[ADR-039](adr/ADR-039.md) 起改为本项目任意活跃成员），不新增物理删除、迁移或新路由。

- 契约：`archiveFeature`/`restoreFeature` 的 `authPolicy` 由 `adminSession` 调整为 `session`，权限矩阵 `活跃成员` 改为 ADR-034 的 conditional 条目；高风险管理路由幂等契约版本 1.2.0 → 1.3.0（旧 Key 409），OpenAPI 与生成客户端由 `pnpm contract:generate` 重生成。
- 后端：`FeaturesManagementService` 注入 `ProjectRoleGateService`，新增 `requireManageRole`（当时为：非成员 404、普通成员 403 `FEATURE_MANAGE_FORBIDDEN`；ADR-039 起只保留非成员 404），在 `execute` 与 `replay`（`requireManageRole: highRisk`）执行；`FeaturesHttpService` 移除管理员高风险 Session 门禁与 `AdminHighRiskAuthService` 依赖。
- 前端：`FeaturesPageView` 的列表行与详情页头归档/恢复入口由 `isAdmin` 改为 `canManageProjectResources(isAdmin, currentUserRole)`，入口加 `feature-lifecycle-{id}` / `feature-detail-lifecycle-{id}` 测试 id；`feature-query.ts` 对 403 `FEATURE_MANAGE_FORBIDDEN` 给出专用文案。
- 功能不参与任务归档前置校验：归档功能只要求项目与父模块 ACTIVE、功能自身 ACTIVE（恢复要求 ARCHIVED）。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| ADR034-API-INT-009 | 真实 PostgreSQL | 功能归档角色矩阵（~~角色口径已被 ADR-039 修订~~） | `features-api.integration.test.ts`：普通成员（显式题为 MEMBER）可归档（`ARCHIVED`、rowVersion 2）与恢复（`ACTIVE`、rowVersion 3）；组长无 `is_admin` 同样可归档 | 本地通过（ADR-039 后已重写为正向断言） |
| ADR034-API-INT-010 | 真实 PostgreSQL | 功能归档越权与移除成员 | 跨项目非成员归档 404 `FEATURE_NOT_FOUND`；被移除成员归档 404 | 本地通过 |
| ADR034-WEB-UNIT-003 | Web 单元 | 功能归档入口按角色显示（~~角色口径已被 ADR-039 修订~~） | `FeaturesPageView.test.tsx`：活跃成员（`MEMBER` 或 `LEADER`）可见 `feature-lifecycle-*` 与编辑弹层内的归档入口并可提交归档（携带原因）；`currentUserRole = null`（非成员）不显示入口 | 本地通过（ADR-039 后已重写） |

本地实际执行（2026-09-16）：`pnpm contract:generate`、`pnpm contract:validate`（105 条路由）、`pnpm permissions:check`（105/105）、`pnpm contract:drift`、`pnpm lint`、`pnpm format:check`、`node scripts/check_docs.mjs`（80 个 Markdown 文件）；`pnpm --filter @inpulse/api typecheck`；真实 PostgreSQL 18.6 + PGroonga：API 集成 49 文件 455 例、API 单测 64 文件 351 例、Web 单测 77 文件 448 例。

未运行 / 已知偏差：① 未跑 `pnpm test:e2e`、`pnpm check` 整链与 GitHub Actions；② 本地 `inpulse-api` 容器需按本轮重建后才能用浏览器验证（前端 Vite HMR 已生效）；③ 新增测试需非作者人工评审。

## 功能归档入口迁移到「编辑功能」弹窗（C，2026-09-16 本地落库）

用户要求「归档功能按钮和模块一样放在编辑弹窗里面」，随后进一步要求「把原来右上角的归档功能去掉，编辑里面的按钮把归档功能改为归档两字」。因此功能归档入口只保留在编辑弹窗底部左侧（按钮文案「归档」/「恢复」），功能卡片与功能详情页头不再提供归档按钮，仅对已归档功能保留「恢复功能」入口以避免恢复无路可走；权限与任务、模块归档一致（当时为系统管理员、本项目组长或项目管理员；[ADR-039](adr/ADR-039.md) 起为本项目任意活跃成员）。

- `apps/web/src/features/features/FeaturesPageView.tsx`：编辑弹窗 `.calm-action-footer` 增加 `footer-leading` 按钮（`data-testid="feature-modal-lifecycle"`），仅当处于 `update` 且 `canManageProjectResources(isAdmin, currentUserRole)` 为真时渲染，文案「归档」/「恢复」；点击后调用既有 `open("archive" | "restore", item)` 切到归档/恢复确认流程，原因必填、`If-Match`、CSRF 与幂等全部沿用。卡片与详情页头的归档按钮已删除，`feature-lifecycle-{id}` 只渲染已归档功能的「恢复功能」。
- 复用模块弹窗既有样式 `.calm-action-footer > .footer-leading`（`apps/web/src/styles/design-system.css`），未新增 CSS 或接口。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| ADR034-WEB-MODAL-ARCHIVE-UNIT-001 | Web 单元 | 组长在功能编辑弹窗底部归档 | `FeaturesPageView.test.tsx`：`currentUserRole = LEADER` 时点「编辑功能」，弹窗底部出现文案为「归档」的 `feature-modal-lifecycle`，点击后出现「操作原因」，填原因确认即以 `archiveFeature(2, 4, 3, { reason })` 调用 | 本地通过 |
| ADR034-WEB-MODAL-ARCHIVE-UNIT-002 | Web 单元 | 普通成员同样可见（ADR-039 修订） | `currentUserRole = MEMBER` 时打开同一编辑弹窗，`feature-modal-lifecycle` 同样存在且可提交归档；`currentUserRole = null`（非成员）时才不渲染 | 本地通过（ADR-039 后已重写） |
| ADR034-WEB-MODAL-ARCHIVE-UNIT-003 | Web 单元 | 页面不再有独立归档按钮 | ACTIVE 功能卡片与详情页头均无「归档功能」按钮；已归档功能卡片保留「恢复功能」，点击后走恢复确认并以 `restoreFeature` 调用 | 本地通过 |

本地实际执行（2026-09-16）：`pnpm --filter @inpulse/web exec vitest run src/features/features/FeaturesPageView.test.tsx` 17 例通过；`pnpm test:web` 77 文件 450 例通过；`pnpm lint`、`pnpm format:check`、`node scripts/check_docs.mjs` 通过；管理员一次性归档用例改为经「编辑功能」弹窗底部触发，仍断言未填原因不发请求且携带 `If-Match`。

未运行 / 已知偏差：① 未跑 `pnpm test:e2e`、`pnpm check` 整链与 GitHub Actions；② 本轮只改前端入口位置，后端权限与契约未变；③ 新增测试需非作者人工评审。

## 任务归档入口与「已归档父级仍可归档任务」修复（C，2026-09-16 本地落库）

用户反馈「模块下功能里任务都完成了但是模块不能归档」。排查确认根因是口径与入口的双重问题：任务「完成」（`work_status = DONE`）不等于「归档」（`lifecycle_status = ARCHIVED`），而功能一经归档，其下任务会被父级只读校验挡在归档之外，前端也没有任务归档入口，于是「归档功能 → 任务无法归档 → 模块下永远存在 ACTIVE 任务 → 模块无法归档」形成死锁。本轮按用户已确认的口径（模块/项目归档都要求下级任务已归档）修复死锁并补齐入口，未放宽归档前置校验。

- 后端：`TasksManagementService.authorize` 增加 `allowArchivedParents` 选项，归档命令（`archiveTask`/`archiveModuleTask`）在模块或功能已归档时仍放行；恢复命令与「项目已归档」保持严格拒绝。`TasksHttpService` 幂等解析阶段的 `authorize` 使用同一口径。
- 后端文案：`ModulesManagementService.assertAllTasksArchived` 的 409 `MODULE_ARCHIVE_TASKS_OPEN` 带未收尾任务数量；口径在同日第二轮修正为「完成即算收尾」，文案与前端 `module-query.ts`、`project-management-query.ts` 同步改为「完成或归档」。
- 前端：`TasksPanel` 新增 `isAdmin` 可选属性与 `canManageProjectResources(isAdmin, currentUserRole)` 判定，编辑弹窗 `.calm-action-footer` 左侧渲染 `data-testid=task-modal-lifecycle` 按钮（文案「归档」/「恢复」），点击后独立确认弹窗要求填写操作原因并经生成客户端携带 `If-Match` 与 `Idempotency-Key` 提交；`FeaturesPageView` 与 `ModuleTasksPage` 传入 `isAdmin`。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| ADR034-API-INT-011 | 真实 PostgreSQL | 功能已归档后归档其任务 | `tasks-api.integration.test.ts`：功能置为 ARCHIVED 后 `POST .../tasks/{taskId}/archive` 200 且 `lifecycleStatus = ARCHIVED`；随后 `restore` 仍 409 `TASK_PARENT_ARCHIVED` | 本地通过 |
| ADR034-WEB-UNIT-004 | Web 单元 | 任务编辑弹窗底部归档 | `TasksPanel.test.tsx`：`currentUserRole = LEADER` 时编辑弹窗出现 `task-modal-lifecycle`，未填原因先提示「请填写操作原因」，填原因确认后以 `archiveTask(2, 3, 4, 1, { reason })` 与 `If-Match: "1"` 调用 | 本地通过 |
| ADR034-WEB-UNIT-005 | Web 单元 | 普通成员看不到任务归档入口 | `currentUserRole = MEMBER` 时同一编辑弹窗内 `task-modal-lifecycle` 不存在 | 本地通过 |
| ADR034-WEB-UNIT-007 | Web 单元 | 父级已归档时入口仍可达 | `TasksPanel.test.tsx`：`writable = false` 且 `currentUserRole = LEADER` 时「编辑任务」按钮不再禁用，弹窗内出现 `task-modal-lifecycle` 与只读提示；`pnpm test:web` 77 文件 453 例 | 本地通过 |
| ADR034-WEB-UNIT-008 | Web 单元 | 无管理角色仍保持只读 | 既有用例继续要求 `writable = false` 且无项目角色时「编辑任务」禁用，避免只读场景被无条件放开 | 本地通过 |
| ADR034-WEB-UNIT-006 | Web 单元 | 归档冲突文案同步 | `project-management-modals.test.tsx` 断言 `PROJECT_ARCHIVE_TASKS_OPEN` 文案改为「任务完成不等于归档，请在任务弹窗底部先归档全部任务」 | 本地通过 |

本地实际执行（2026-09-16）：`pnpm --filter @inpulse/api test:integration tasks-api` 44 例通过；`pnpm --filter @inpulse/api test:integration modules-api tasks-api features-api` 3 文件 74 例通过；`pnpm --filter @inpulse/api typecheck`、`pnpm test:web` 77 文件 453 例通过；`pnpm lint`、`pnpm format:check`、`pnpm contract:validate`（105 条路由）、`pnpm permissions:check`（105/105）、`pnpm contract:drift` 通过。

未运行 / 已知偏差：① 未跑 `pnpm test:e2e`、`pnpm check` 整链与 GitHub Actions；② 全 workspace `pnpm typecheck` 仍被无关的 `apps/web/src/features/published-records/PublishedRecordDetail.tsx:286` 阻断（未修）；③ 本条随后被同日的「任务完成即算收尾」条目修正：模块归档不再要求任务必须归档，完成或取消即算收尾；④ 新增测试需非作者人工评审。

## 归档前置校验改为「任务已收尾」（C，2026-09-16 第二轮本地落库）

用户反馈「这个任务完成不同步啊导致上级不能归档」：任务「完成」后仍被上级归档拦截，体验上等于强制用户额外做一次「归档」动作。经确认把口径修正为「任务已收尾」——已完成（DONE）、已取消（CANCELED）或已归档都算收尾，只有仍未完成（TODO）且未归档的任务才阻塞模块归档与项目归档申请/批准；任务归档入口保留为可选的收尾动作。

- 后端：`ModuleManagementRepository.countUnarchivedTasks` 与 `PostgresProjectsWritePort.countUnarchivedTasks` 的 SQL 增加 `AND work_status NOT IN ('DONE', 'CANCELED')`；`ModulesManagementService` 与 `ProjectArchiveRequestService` 的 409 文案改为「未完成、也未归档的任务」，前端 `module-query.ts`、`project-management-query.ts` 同步。
- 文档：ADR-034 的决策与 §2 前置校验、`AGENTS.md` ADR-034 节、系统设计、技术设计、功能设计、开发工作书与 `docs/permissions.md` 的同一口径全部改为「已收尾」。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| ADR034-API-INT-012 | 真实 PostgreSQL | 任务完成即可归档模块 | `modules-api.integration.test.ts`：模块下任务 `work_status = DONE` 且未归档时 `POST /modules/{id}/archive` 200 且返回 `ARCHIVED` | 本地通过 |
| ADR034-API-INT-013 | 真实 PostgreSQL | 任务完成即可申请项目归档 | `project-archive-request-api.integration.test.ts`：项目下任务为 DONE 且未归档时组长提交申请 200 | 本地通过 |
| ADR034-WEB-UNIT-009 | Web 单元 | 409 文案同步 | `project-management-modals.test.tsx` 断言 `PROJECT_ARCHIVE_TASKS_OPEN` 文案为「项目下仍有未完成、也未归档的任务…」 | 本地通过 |

本地实际执行（2026-09-16）：`pnpm --filter @inpulse/api test:integration modules-api project-archive-request` 2 文件 18 例通过；`pnpm test:web` 77 文件 453 例通过；`pnpm lint`、`pnpm format:check`、`pnpm contract:validate`（105 条路由）、`pnpm permissions:check`（105/105）、`pnpm contract:drift`、`node scripts/check_docs.mjs` 通过。另注：全量 `pnpm --filter @inpulse/api test:integration` 本轮出现 1 例与本改动无关的不稳定失败（`preauth-session.integration.test.ts` 的 `preauth_sessions_consumed_at_check` 并发时钟边界），单独重跑该文件 4 例通过，未修改该测试。

未运行 / 已知偏差：① 未跑 `pnpm test:e2e`、`pnpm check` 整链与 GitHub Actions；② 已完成但未归档的任务在模块归档后仍保持 ACTIVE，用户如需从活跃视图移除可继续手动归档；③ 新增测试需非作者人工评审。

## 任务中心卡片就地弹窗（C，2026-09-17 本地落库）

产品反馈：任务中心的任务卡片点击后不应离开当前页面跳转到功能档案深链，而要就地弹出与功能档案一致的任务详情弹窗。本轮把 `/tasks` 的卡片、列表行与聚合组入口（「分支」/「查看主任务」）全部改为**当前页就地打开 `TasksPanel` 的任务详情弹窗**，URL 不再变化；写操作入口仍只有 `TasksPanel` 一处，不复制只读弹层。F-32 条目下表的深链断言按本条替换（原文保留为该轮事实）。

- 前端：`TasksPanel` 增加 `mode`（`panel` / `detail`）、`initialTaskId` 与 `onDetailClose`；新增 `TaskDetailOverlay`（按父模块与父功能是否 ACTIVE 决定可写性，数据未就绪按只读；`key={taskId}` 重挂载）并由 `TasksPage` 以 `React.lazy` + `Suspense` 懒加载——静态导入会把 `TasksPanel` 依赖图并入 `/tasks` 路由 chunk，导致 `app-router.test.tsx` 间歇性超时，故必须保持懒加载。
- 测试：`TasksPage.test.tsx` 的深链断言（`ArchiveProbe` 改为 `LocationProbe`）替换为就地断言（弹出 `关闭任务详情`、标题可达、URL 恒为 `/tasks`）；`aggregate-views.spec.ts` 断言点击卡片后弹窗可见且 `page.url()` 不变。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| F32-INPLACE-PAGE-001 | 单元（页面层） | 功能级任务就地弹窗 | `TasksPage.test.tsx`：点击功能级任务卡片（7 / 71 / 711 / 320）后弹出任务详情（`关闭任务详情` 与标题可见），`location-probe` 恒为 `/tasks` | 本地通过 |
| F32-INPLACE-PAGE-002 | 单元（页面层） | 模块级任务就地弹窗 | `TasksPage.test.tsx`：`moduleTask`（7 / 72 / null / 321）点击后就地弹窗，URL 不变 | 本地通过 |
| F32-INPLACE-E2E-001 | Playwright | 真实数据卡片就地弹窗 | `aggregate-views.spec.ts`：点击任务卡片后 `dialog[name=任务详情]` 可见（含标题、「编辑任务」「完成任务」），`page.url()` 仍为任务中心地址，关闭后仍在任务中心 | 本地通过 |

本地实际执行（2026-09-17）：`pnpm --filter @inpulse/web typecheck`；`pnpm --filter @inpulse/web exec vitest run src/pages/tasks/TasksPage.test.tsx`（8 例，连跑 3 次稳定）；`pnpm test:web`（77 文件 455 例）；`pnpm lint`（改动文件）；`prettier --check`（`apps/web/src`、`apps/e2e/tests`）；`pnpm check:frontend:boundaries`（251 模块 / 1189 依赖）；定向 Playwright `aggregate-views`、`task-groups` 各 2 例通过；全量 `pnpm test:e2e` 52 通过 / 4 失败（`features` 归档恢复、`leftover-task`、`project-archive`、`project-members` 超时，均不经任务中心卡片路径）。

未运行 / 已知偏差：① 按项目负责人 2026-09-17 指示，此后纯前端改动不再运行测试；② 上述 4 例 E2E 失败与本改动无关，未修复；③ 新增/更新的用例需非作者人工评审。

## E2E 夹具数据自动物理清理（2026-09-17 本地落库）

项目负责人指示「每次测试完的数据要删除」。本地 55432 开发库此前累积了 17 个夹具项目、13 个夹具账号与派生数据；旧 `global-teardown` 只清通知、活动、搜索投影、幂等记录与用户会话，按「未分类模块不可物理删除」的业务不变量保留项目与用户骨架。本轮完成一次性清理，并把 teardown 机制改为自动物理清理。

一次性清理（2026-09-17，`cluster_bootstrap`，事务内 `session_replication_role = replica`，先演练后提交）：删除夹具用户 13、夹具项目 17、业务行 314（任务 30、功能 18、记录 17、外链 6、通知 13、活动 4、搜索投影 19、成员 28、幂等 14、会话 3、序列 23 等）、`PROJECT:` 审计 157 条与链头 14 条；随后补删 8 条 `actor_id` 悬空的 SYSTEM 审计行；`users_id_seq` / `projects_id_seq` 回退到真实数据之后。清理前用 `pg_dump -Fc` 备份至宿主机临时目录（`inpulse-app-before-e2e-cleanup.dump`）。清理后复验：项目 1 与用户 1–5 完好、bootstrap 成员关系（`joined_at = created_at`）成立、无悬空外键、每项目唯一 UNCLASSIFIED 模块。

自动清理机制：`apps/e2e/helpers/fixture-cleanup.ts` 按 `e2e_` / `f03_`（Playwright）与 `user_` / `sso_` / `login_` / `invalidate_` / `csrf_` / `backup_` / `archive_`（集成测试）前缀识别夹具账号，再按 `created_by` 识别夹具项目，按依赖序物理删除全部业务数据与审计，删除后断言复核（夹具残留 0、无悬空审计 actor、bootstrap 完整、每项目唯一 UNCLASSIFIED 模块），失败回滚；`global-teardown.ts` 每次运行后自动调用，运行被中断时用 `pnpm --filter @inpulse/e2e cleanup` 手动补跑。SYSTEM 链夹具记录删除后链头回退到剩余最后一条；若夹具记录之后已有真实写入则留下一个可检测断点并打印提示。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| E2E-CLEANUP-SCRIPT-001 | 真实 PostgreSQL | 空库 no-op | 清理后库上执行 `pnpm --filter @inpulse/e2e cleanup` 输出「未发现 E2E 夹具数据」且无异常 | 本地通过 |
| E2E-CLEANUP-TEARDOWN-001 | Playwright | teardown 自动清理 | `project-create.spec.ts` 运行结束后 teardown 报告「删除用户 2、项目 3、业务行 56、审计行 1」，随后库内夹具残留为 0 | 本地通过 |

本地实际执行（2026-09-17）：一次性清理按上述清单执行并复验；`apps/e2e` typecheck、`prettier` 通过；`pnpm --filter @inpulse/api build` 后定向跑 `project-create.spec.ts` 1 例通过（10.0s）且 teardown 自动清理生效。

未运行 / 已知偏差：① 未跑全量 `pnpm test:e2e` 与其他落库测试来验证 teardown（机制已由定向用例覆盖）；② 一次性清理在 SYSTEM 链 385→386 之间留下一个已知断点（386 为真实用户 01:56 的 SSO 登录，晚于夹具记录，删除中段无法保持哈希链完整），teardown 已实现「夹具段位于链尾时回退链头」的安全路径，同类场景默认不留断点；③ `test-results/`、`playwright-report/` 等 Playwright 产物默认保留用于失败调试，本次已手动清理。

## 裁决修订 D-2：R-3 / R-5 增加 `hasLeftoverSource` 与「遗留问题」徽章（2026-09-17 本地落库）

按[裁决修订 D-2](a-contract-review-f25-f29-f32.md) §12：R-3 `MyTaskItem` 与 R-5 `TaskGroupMembershipItem` 各增加 `hasLeftoverSource: boolean`（按 `leftover_task_links` 存在链接行判定，与来源记录当前状态无关）；记录侧 `ChangeRecordReadPort` 新增只读映射 `listLeftoverSourceTaskIds`（单条 SQL、按 task_id 升序、无链接缺席由消费端补 false，越界与空集短路与 `countPublishedByTask` 同口径）；R-3 `MyTasksQueryService` 与 R-5 `TaskGroupMembershipQueryService` 在同一只读事务内消费该映射。前端：任务中心卡片与列表行（R-3）、功能档案任务卡片、列表行与详情弹窗（R-5 页面级一次批量）显示「遗留问题」徽章（amber）。契约、Route Registry summary、Schema Registry 描述、权限矩阵、OpenAPI 与生成客户端同一批再生成（105 条路由，5 产物漂移检查通过）。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| D2-CONTRACT-001 | 契约 | Schema 与生成物 | R-3 / R-5 条目增加 `hasLeftoverSource`；`contract:drift`（5 产物）、`contract:validate`（105 条）、`permissions:check`（105/105）通过 | 本地通过 |
| D2-PORT-INT-001 | 真实 PostgreSQL | 端口映射 | `listLeftoverSourceTaskIds` 只返回存在链接行的任务（升序）；`projectIds` 收窄后他项目链接行不返回；无链接任务缺席；`taskIds` 超 `CHANGE_RECORD_TASK_IDS_MAX` 或含非正整数抛 `ChangeRecordReadInputError` 且不发 SQL；`projectIds`/`taskIds` 为空短路 | 本地通过（`apps/api/test/aggregate-read-ports.integration.test.ts`） |
| D2-R3-INT-001 | 真实 PostgreSQL | R-3 条目映射 | `GET /api/v1/me/tasks` 中有 `leftover_task_links` 链接行的任务（CONVERTED 遗留项转换夹具）`hasLeftoverSource=true`，其余任务 false | 本地通过（`apps/api/test/aggregate-read-api.integration.test.ts`） |
| D2-R5-INT-001 | 真实 PostgreSQL | R-5 批量标记 | `GET /api/v1/task-groups/memberships` 条目含 `hasLeftoverSource`；未入组、无权项目与既有覆盖/隐藏语义不变 | 本地通过（同上） |
| D2-UNIT-API-001 | 单元 | R-3 / R-5 服务 | `MyTasksQueryService` 与 `TaskGroupMembershipQueryService` 经 `listLeftoverSourceTaskIds` 补齐标记；空授权范围不发后续 SQL | 本地通过（`apps/api/test/aggregate-read.service.test.ts`） |
| D2-UNIT-WEB-001 | 单元 | 前端映射与徽章 | `fromV1MyTaskItem` / `toTaskMarkMap` / `useTaskMarks` 透传 `hasLeftoverSource`；`TasksPanel` 卡片与详情弹窗按标记渲染「遗留问题」徽章、无标记不渲染；mock 数据集 10 条同形 | 本地通过（`task-marks.test.tsx`、`TasksPanel.test.tsx`、`my-tasks-*.test.*`） |

本地实际执行（2026-09-17）：API 单测 64 文件 351 例、Web 77 文件 455 例、契约 98 例、真库集成（aggregate-read-api / aggregate-read-ports / aggregate-read-list-api）3 文件 50 例、全 workspace typecheck、`eslint`（改动文件）、`prettier`（改动文件）、`check:frontend:boundaries`（251 模块 / 1189 依赖）、`permissions:check`（105/105）、`contract:drift`（5 产物）与 `contract:validate`（105 条）通过。真库集成测试的 `user_` 前缀夹具（database.helpers 的 createUser/createProject）不由测试生命周期自动清理：本轮测试后已用一次性事务脚本按依赖序物理删除夹具用户 35、夹具项目 30 与派生业务行 1266（聚合读测试只读、审计行为 0，SYSTEM 链未触碰），删除后复核剩余 6 个真实用户与 2 个真实项目、无悬空审计 actor、bootstrap 成员关系完整、无悬空任务；真实数据的既有异常（project 2 历史遗留 0 个 UNCLASSIFIED 模块）不在清理范围、清理前后不变。

未运行 / 已知偏差：① 未跑全量 `pnpm test:integration`、`pnpm test:e2e` 与 `pnpm check` 整链（deps:audit 本机镜像无 audit endpoint 属已知限制）；② GitHub Actions 未执行；③ 新增/更新用例需非作者人工评审；④ 遗留问题页（`/issues`）与已发布记录页的既有「查看跟进任务」入口不变，本批只新增任务侧徽章。

## 项目生命周期四态（ADR-035，2026-09-17 本地落库）

用户要求把项目状态从「库里只有 ACTIVE / ARCHIVED 两态、前端按已完成任务数推导未开始」改为四个存储状态：未开始（`NOT_STARTED`）/ 进行中（`ACTIVE`）/ 维护中（`MAINTENANCE`）/ 已归档（`ARCHIVED`）。「维护中」表示主体已完成、只做小修小补且不打算归档，是纯标签、不限制任何操作。完整决策与边界见 [ADR-035](adr/ADR-035.md)。

锁定口径：

- 可改状态的角色（ADR-039 修订）：本项目任意活跃成员（`MEMBER` 或 `LEADER`，[ADR-039](adr/ADR-039.md) 起角色不再区分管理权）与系统管理员；非成员与不存在的项目 404；创建者身份本身不额外授权，只看当前成员身份。
- 存量迁移（`0017_project_status_lifecycle.sql`）：项目内出现过已完成任务（`app.task_status_history.to_work_status = 'DONE'`）→ 进行中，其余原 ACTIVE 项目 → 未开始，展示标签与改造前完全一致；迁移不递增 `row_version`、不写审计。 回填期间临时关闭 `projects_row_version` 触发器（该触发器要求每次 UPDATE 恰好 +1），并用 `SET CONSTRAINTS ALL IMMEDIATE` 结算挂起的延迟约束触发器事件后再恢复，空库上是空操作。
- 禁止越级：未开始 ⇄ 维护中双向 409 `PROJECT_STATUS_LEVEL_SKIP`，必须先经过进行中。
- 粘性锁：`app.projects.first_task_completed_at` 取最早一次任务完成时间且永不回落，有值后回退未开始 409 `PROJECT_STATUS_NOT_STARTED_LOCKED`；数据库兜底约束 `projects_not_started_lock_check` 拒绝同一组合。
- 自动升级：任务完成写路径（`PostgresTaskCompletionCommandPort`）在同一事务内置位粘性标记，并把仍处于未开始的项目升级为进行中；粘性标记已置位且项目不再是未开始时整条语句不写任何行，因此后续任务完成不会反复推高项目版本。
- 通知：只有「未开始 → 进行中」（手动切换或任务完成自动升级）写 `project.status.change` 通知全体活跃成员；维护中与其它迁移都不通知。
- 写入口径：只有 `ARCHIVED` 拦截下级写入，未开始 / 进行中 / 维护中都是活跃态。除 `ProjectAccessQueryPort.checkProjectForWrite` 外，外部链接工作流的目标可写判定同样从「目标 ACTIVE」改为「目标不是已归档」。
- 归档与恢复：三个未归档状态都能直接归档；恢复一律回到进行中，不保留归档前状态。
- 模块、功能、任务的状态语义不变，只把展示文案「正常」改称「进行中」。
- 排序：项目列表与项目概览按 进行中 → 未开始 → 维护中 → 已归档 分档，组内按 id 升序。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| ADR035-WEB-UNIT-001 | Web 单元 | 四态标签与配色 | `resource-lifecycle.test.ts`：`projectLifecycleLabel` 四态分别为未开始 / 进行中 / 维护中 / 已归档；`projectLifecycleTone` 为 cyan / violet / amber，进行中沿用调用方主色；`projectLifecycleKind` 直接透传存储状态 | 本地通过 |
| ADR035-WEB-UNIT-002 | Web 单元 | 项目卡渲染四态 | `ProjectsPageView.test.tsx`：`NOT_STARTED` 渲染「未开始」+ `badge-cyan`、`ACTIVE` 渲染「进行中」+ `badge-blue`、`MAINTENANCE` 渲染「维护中」+ `badge-violet`；`completedTaskCount` 不再影响项目标签 | 本地通过 |
| ADR035-WEB-UNIT-003 | Web 单元 | 编辑弹窗状态栏 | `project-management-modals.test.tsx`：点「保存状态」以 CSRF + `Idempotency-Key` + `If-Match` 调 `PATCH /projects/{id}/status`，成功后不关闭弹窗并回调 `onStatusChanged`；已有完成任务时「未开始」置灰并带原因 title；未开始 → 维护中、维护中 → 未开始同样置灰；非成员时只读展示标签 | 本地通过 |
| ADR035-API-INT-001 | 真实 PostgreSQL | 手动开工 | `project-management-api.integration.test.ts`：组长把未开始改为进行中返回 200 且 `hasCompletedTask: false`；审计 `project.status.change`、活动 `PROJECT_STATUS_CHANGED`、搜索投影与发给全体活跃成员的 `project.status.change` 通知同事务提交 | 本地通过 |
| ADR035-API-INT-002 | 真实 PostgreSQL | 越级与成员门禁（~~角色口径已被 ADR-039 修订~~） | 同上：未开始 → 维护中与维护中 → 未开始都 409 `PROJECT_STATUS_LEVEL_SKIP`（且不发通知）；普通成员同样可改状态（200）、非成员 404、版本冲突 409 `PROJECT_VERSION_CONFLICT`、同态 409 `PROJECT_STATE_CONFLICT`、目标态 `ARCHIVED` 422 `PROJECT_VALIDATION_FAILED` | 本地通过（ADR-039 后已重写为正向断言） |
| ADR035-API-INT-003 | 真实 PostgreSQL | 粘性锁与已归档只读 | 同上：项目出现过已完成任务后回退未开始 409 `PROJECT_STATUS_NOT_STARTED_LOCKED`，切到维护中仍放行且 `hasCompletedTask: true`；已归档项目改状态 409 `PROJECT_ARCHIVED` | 本地通过 |
| ADR035-API-INT-004 | 真实 PostgreSQL | 任务完成自动开工 | `task-completion.integration.test.ts`：首个任务完成后项目由未开始变为进行中、`first_task_completed_at` 置位、`row_version` 递增，审计 `project.status.change`（`automatic: true` / `trigger: TASK_COMPLETED`）、活动、搜索投影与开工通知同事务；第二个任务完成不重复升级、不再推高项目版本 | 本地通过 |
| ADR035-API-INT-005 | 真实 PostgreSQL | 写入口径 | `project-access.integration.test.ts`：进行中与维护中都是 `allowed`，只有已归档返回 `parent-not-active`；`external-links.integration.test.ts` 的 PROJECT / FEATURE / TASK 目标在未开始项目下恢复可写 | 本地通过 |
| ADR035-API-INT-006 | 真实 PostgreSQL | 四态列表排序 | `projects-read-api.integration.test.ts`：四个项目按 进行中 → 未开始 → 维护中 → 已归档 返回，`completedTaskCount` 为 1/0/0/0 | 本地通过 |
| ADR035-E2E-001 | Playwright | 归档→只读→恢复关键路径 | `project-archive.spec.ts`：新建项目项目卡渲染「未开始」，归档后「已归档」且编辑被拒，恢复成功后提示「已恢复为进行中状态」并渲染「进行中」 | 本地 1/1（40.0 秒；E2E_API_PORT=3131 / E2E_WEB_PORT=4191） |
| ADR035-CONTRACT-001 | 契约与数据 | 契约、权限矩阵与迁移 | `pnpm contract:validate`（106 条路由）、`pnpm permissions:check`（106/106）、`pnpm contract:drift`、`pnpm db:migrations:check`（18 个迁移）、`pnpm db:seed:check` 通过；`ProjectStatus` / `ProjectStatusChangeRequest` 入库 Schema Registry，`createProject` 幂等契约版本升 2.2.0（响应 `project.status` 由 ACTIVE 改为 NOT_STARTED） | 本地通过 |

本地实际执行（2026-09-17，Windows + PowerShell + Docker PostgreSQL 18.6，新建独立库 `app_it`，`pnpm db:migrate` 应用全部 18 个迁移）：

- 存量库实盘验证：在本机长期开发库（`app`，2179 个原 ACTIVE + 148 个已归档项目）上执行 `pnpm db:migrate` 成功，结果为 进行中 449 / 未开始 1730 / 已归档 148，粘性标记覆盖全部 470 个出现过已完成任务的项目（449 进行中 + 21 已归档），`projects_row_version` 触发器已恢复为启用；该次执行暴露并修复了迁移在有存量行时被 `row_version` 触发器拒绝的缺陷。
- 单元与集成：`pnpm --filter @inpulse/api test:integration`（`TEST_DATABASE_URL` 指向 `app_it`）49 个文件 465 例全部通过；该套件在本轮之前的一次运行中曾出现 1 例失败（`preauth-session.integration.test.ts` 的「同一预认证 Session 只能原子消费一次」，`preauth_sessions_consumed_at_check` 并发时钟边界），单独重跑该文件 4 例通过、复跑全量 465/465 通过，属既有不稳定用例，与本次改动无关。`pnpm test:web` 77 个文件 461 例通过；`pnpm test:unit` 全 workspace 通过（api-contract 98 / api 351 / web 461 / ops 52 / database 15 / canonical-json 5）。
- 静态与契约：`pnpm lint`、`pnpm format:check`、`node scripts/check_docs.mjs`（81 个 Markdown）、`pnpm check:frontend:boundaries`、`pnpm contract:drift`、`pnpm contract:validate`（106 条路由）、`pnpm permissions:check`（106 操作 / 106 路由）、`pnpm db:migrations:check`（18 个迁移）、`pnpm db:seed:check`、`pnpm build`、`pnpm check:deps`、`pnpm check:secrets`、`pnpm check:deploy:test` 全部通过。
- 类型检查：`pnpm typecheck` 仅剩既有基线错误 `apps/web/src/features/published-records/PublishedRecordDetail.tsx:286`（本次改动之前就已存在，未修）；`pnpm --filter @inpulse/api typecheck` 干净通过。
- Playwright：`tests/project-archive.spec.ts` 1/1 通过（40.0 秒，`E2E_API_PORT=3131` / `E2E_WEB_PORT=4191`）；全量套件 53 通过 / 3 失败，3 例失败均与本次改动无关，并已在推送中的 `test` 分支提交 `77d7beb` 与更早的 `b35ba9e` 上复现同样的失败：① `tests/features.spec.ts:93` 仍在点击详情页头的「归档功能」按钮，而该入口已被 `4c0d2c3` 移入「编辑功能」弹窗，属过期断言；② `tests/project-members.spec.ts:10` 的只读成员页在不可见项目下持续重挂死循环（60 秒内对 `/api/v1/projects/{id}` 与 `/api/v1/projects/{id}/active-members` 各发出 5000 余次被中止的请求，页面停在「正在确认项目内角色」），属存量前端缺陷；③ `tests/search.spec.ts` 的失败在长期累积库上随机出现，本轮 5 例全部通过。

未运行 / 已知偏差：① 未跑 `pnpm check` 整链与 GitHub Actions（`.github/workflows/ci.yml` 只在 PR 与 `main` / `dev/*` 推送时触发，`test` 分支推送不产生 CI 运行）；② 上述 3 例 E2E 失败为存量问题，本次未修复，需单独排期；③ 本次改动尚未提交、未推送，新增测试需非作者人工评审。

## 迭代记录多条遗留问题与快捷追加（F-18 多条化，2026-09-17 本地落库）

用户反馈三点：① 一个迭代记录只能产生一条遗留问题；② 在已有记录上补记遗留问题必须重写整段正文；③ 已有遗留问题的记录不能再追加。本条把 `remainingIssues` 从单段文本改为条目数组，并新增不改写正文的「追加遗留问题」写入路径。

锁定口径：

- 条目结构 `{ id?: number, content: string }`，`content` 1..10000 字符、单个字段最多 50 条；带 `id` 表示沿用既有遗留项（转任务绑定与历史内容都挂在它上面），缺省表示新建。
- 历史记录的单段文本在读取时归一化为一条（`normalizedLeftoverEntries`），稳定 `id` 由当前版本快照取回，旧记录第一次修订后即获得稳定标识。
- 移除一条已有遗留问题等价于标记为已解决，必须显式勾选「确认移除的遗留问题已解决」，否则 422 `LEFTOVER_RESOLUTION_CONFIRMATION_REQUIRED`；被移除条目保留历史内容，不进入新版本快照。
- 已转任务（`CONVERTED`）条目保留原任务关联，不提供移除入口，修订正文不会创建第二个任务。
- 详情页「追加遗留问题」是独立路由 `addChangeRecordLeftover`，服务端在不改写正文的前提下追加一条并生成新版本，进入版本历史并按修订规则通知。
- 转任务必须携带显式 `leftoverItemId`：记录有多条活跃遗留项而缺 id 返回 409 `LEFTOVER_SELECTION_REQUIRED`（`details.leftoverItemIds`），已解决条目 409 `LEFTOVER_NOT_ACTIVE`。
- 提交条目带 `id` 但不在当前版本快照里返回 409 `RECORD_LEFTOVER_CONFLICT`，避免把已移除条目静默复活。
- 发布容量：标题 + 三段正文 + 全部遗留问题条目正文合并后的搜索文本超过 100000 字符返回 422 `RECORD_SEARCH_CAPACITY_EXCEEDED`，草稿与输入保留。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| F18-MULTI-CONTRACT-001 | 契约与权限 | 条目数组与追加路由 | `remainingIssues` 为条目数组（`id` 可选 + 1..10000 字符、≤50 条）、`leftovers`（`id`/`status`/`rowVersion`/`content`/`linkedTaskId`）进入正式记录与版本快照、`confirmLeftoverResolved` 为正文必填项；新增 `POST /api/v1/projects/{projectId}/change-records/{recordId}/leftovers`（`addChangeRecordLeftover`，幂等契约 1.0.0，审计 `record.leftover.add`），`recordPublicationRoutes` 升 1.2.0；`contract:validate`（107 条路由）、`permissions:check`（107 操作 / 107 路由）、`contract:drift`（5 产物）通过 | 本地通过 |
| F18-MULTI-API-INT-001 | 真实 PostgreSQL | 多条发布、快捷追加与稳定 id 复用 | `record-publication.integration.test.ts`：发布两条遗留问题后再追加一条形成 v4，按稳定 `id` 解除与复活，清空后重填保留 `CONVERTED` 身份与任务链接 | 本地通过 |
| F18-MULTI-API-INT-002 | 真实 PostgreSQL | 冲突、容量与 HTTP 重放 | 同上：带 `id` 但不在当前版本快照 409 `RECORD_LEFTOVER_CONFLICT`；超长条目与搜索容量溢出 422 且不改写正文、不消耗记录编号；追加路径校验 CSRF、双版本头（`If-Match` + `X-Record-Version`）与数据库幂等重放，撤回权限后重放返回 404 | 本地通过 |
| F18-MULTI-API-INT-003 | 真实 PostgreSQL | 转任务选择与条目状态 | `leftover-task.integration.test.ts`：多条活跃条目缺 `leftoverItemId` 409 `LEFTOVER_SELECTION_REQUIRED`（`details.leftoverItemIds`）、已解决条目 409 `LEFTOVER_NOT_ACTIVE`、带显式 id 转任务后仅该条变 `CONVERTED` 并保留正文 | 本地通过 |
| F18-MULTI-WEB-UNIT-001 | Web 单元 | 多条条目字段 | `LeftoverEntriesField.test.tsx` 4 例：逐条渲染且「添加遗留问题」追加空条目、就地编辑并只移除被点击的一行、已转任务条目只展示「已转任务，保留关联」且没有移除入口、空态与 50 条上限 | 本地通过 |
| F18-MULTI-WEB-UNIT-002 | Web 单元 | 草稿、「完成任务并记录」与修订三条路径 | `RecordDraftsView.test.tsx`、`CompleteWithRecord.test.tsx`、`EditPublishedRecord.test.tsx`：三条路径共用条目字段，已有条目被移除时才出现确认勾选且未勾选不能保存 | 本地通过 |
| F18-MULTI-E2E-001 | Playwright | 多条录入、快捷追加与历史保留 | `record-publishing.spec.ts`：发布带多条遗留问题的记录后，详情页「追加遗留问题」不改正文形成 v4、新条目可见、版本差异仍保留原条目；`task-completion.spec.ts` 覆盖「完成任务并记录」的多条路径与容量 422 提示 | 本地通过（定向 4 文件 11 例） |

本轮同时修复的本地缺陷：

- `PublishedRecordDetail.tsx` 的「已标记解决的遗留问题…」提示此前按当前条目状态判定，而当前版本快照本来就不保留被移除条目，属于永不触发的死代码；改为按相邻版本条目数差计算 `removedLeftovers`，对应 E2E 断言改为验证快捷追加路径。
- `task-completion.spec.ts` 的容量用例原先用 CJK 字符填满三段正文（约 450KB，超过 Express 默认 100KB 请求体上限），实测触发的是 500 `request entity too large` 而不是 422；改用单字节字符（33600×3 ≈ 100.9KB 请求体 < 102.4KB，搜索文本 100840 > 100000）后「超出发布容量」422 断言才真正生效。

本地实际执行（2026-09-17，Windows + PowerShell + 本机 PostgreSQL 18.6 + PGroonga 4.0.8）：

- 契约与权限：`contract:validate`（107 条路由）、`contract:drift`（5 产物一致）、`permissions:check`（107 操作 / 107 路由）通过。
- 单元与集成：API 单测 64 文件 351 例、契约 16 文件 100 例、Web 78 文件 469 例、真实 PostgreSQL API 集成 49 文件 468 例（连续两轮全绿）、database 15 例、ops 8 文件 52 例。
- 静态门禁：`lint`、`format:check`、`typecheck`（8 个 workspace）、`build`、`check:deps`、`check:frontend:boundaries`、`check:secrets`、`check:deploy:test` 与公共 registry 依赖审计（No known vulnerabilities found）通过。
- Playwright：定向 4 文件 11 例通过（1.3 分钟，`E2E_API_PORT=3158` / `E2E_WEB_PORT=4188`，teardown 清理用户 2 / 项目 2 / 业务行 391 / 审计行 58）；全量 53 通过 / 3 失败（7.6 分钟，`E2E_API_PORT=3159` / `E2E_WEB_PORT=4189`），3 例均为存量问题（`features.spec.ts:93` 过期断言、`project-members.spec.ts:10` 只读成员页重挂死循环、`search.spec.ts` 长期累积库随机失败），`search.spec.ts` 单文件复跑 5/5 通过；全量结束后手工补跑夹具清理报告「未发现 E2E 夹具数据」。
- 浏览器人工复验：本地 dev 服务（API 3000 / Vite 5173）打开 `INPULSE-CR-7`（历史单段文本记录）确认详情页正常、修订弹窗把旧文本渲染为一条可移除条目且「添加遗留问题」能追加第二条；`INPULSE-CR-4` 的 `CONVERTED` 条目显示「已转任务，保留关联」且无移除入口。

未运行 / 已知偏差：① 未跑 `pnpm check` 整链（`check:docs` 被仓库根目录 8 个未跟踪 `.tmp-*` 文件阻断）、`db:migrations:check`、`db:seed:check` 与 GitHub Actions；② Web 单测首次复跑出现 2 例失败（与后台全量 E2E 同机并发），随后连续两轮 78 文件 469 例全绿，失败用例名未记录，再复现需单独排查；③ 上一条的 3 例存量 E2E 失败本次未修复，需单独排期；④ 本地开发服务器曾因 API 进程未重启（旧代码返回字符串、新前端按数组消费）导致「点开迭代记录即报错」，重建并重启 `scripts/dev-start.mjs` 后恢复，`remainingIssues` 属破坏性响应变更、API 与 Web 必须同批发布；⑤ 本轮改动尚未提交、未推送，新增与改写的测试需非作者人工评审。

## R-8 项目任务看板（任务看板，2026-09-18 本地落库）

用户要求为项目增加「展现完成程度」的任务看板，定稿取舍是信息密度高、点击与下拉少，并且顶部统计恒为项目全量口径：筛选只在本地过滤卡片与泳道，图表区显示「筛选结果 N / 总数」而不是把筛选结果误读成项目完成率。

锁定口径：

- 新增只读路由 `GET /api/v1/projects/{projectId}/task-board`（`getProjectTaskBoard`，全部策略显式 `none` + `authPolicy: session`），经生成客户端调用，前端不裸写 `fetch`。
- 看板集合 = 项目内 `lifecycle_status = ACTIVE` 的任务（不含已归档与无效），排除任务组历史来源分支；已取消任务保留为历史标记。
- 完成率 = 已完成 ÷（已完成 + 未完成），已取消与历史来源分支不计入分母，分母为 0 取 0（功能设计 §29.2）。
- 排序固定「逾期 → 未完成 → 已完成（完成时间倒序）→ 已取消」；未完成桶内先按优先级 紧急 → 高 → 普通 → 低，再按截止时间升序（NULL 最后），已完成与已取消不参与优先级排序（2026-09-21 按项目负责人反馈纳入）。末键 taskId 升序；单项目上限 1000 条，超出置 `truncated = true` 并在页面上说明，统计不受截断影响。
- 遗留问题来源标记不在看板契约里：页面按 R-5 `listTaskGroupMemberships` 页面级一次批量读取 `hasLeftoverSource`（裁决修订 D-2），在卡片右上角标记组与列表行标题前显示「遗留问题」徽章，读取失败按缺席隐藏；标题省略号只作用于标题文本，徽章不参与截断。
- 逾期、今日到期、本周完成与卡片 `dueState` 全部由 SQL 按 Asia/Shanghai 与 `now()` 计算，前端只做展示映射，不按客户端时钟重算。
- 页面按模块分泳道；筛选覆盖状态、时间、优先级、负责人与关键词，视图切换（看板 / 列表）与全部筛选由 URL 承载（`view` / `status` / `time` / `priority` / `owner` / `q`），默认值不写入 URL。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| R8-CONTRACT-001 | 契约与权限 | Schema、路由与生成物 | `task-board.zod.ts` 六个 Schema（项目 / 统计 / 卡片 / 模块统计 / 泳道 / 响应）登记进 Schema Registry；路由全策略显式 `none` 且登记在权限矩阵；OpenAPI、fingerprints 与生成客户端由生成工具更新 | 本地通过（`contract:validate` 108 条路由、`permissions:check` 108 操作 / 108 路由） |
| R8-SERVICE-UNIT-001 | API 单元 | 授权、口径与不一致防线 | `task-board-query.service.test.ts` 8 例：非成员与项目缺失统一 404 且零读取、历史来源分支在 LIMIT 前排除并透传 `truncated`、按模块组装泳道与卡片、完成率分母为 0 取 0、泳道头像去重并截断到 24、缺模块名与缺负责人按 `AGGREGATE_READ_INCONSISTENT` 500、覆盖功能数按项目级 + 逐模块计数 | 本地通过 |
| R8-WEB-UNIT-001 | Web 单元 | URL 状态与本地筛选 | `task-board-filters.test.ts` 11 例：非法与缺失参数回退默认、默认值不写入 URL、读写往返一致、空白查询不算筛选、状态 / 时间 / 优先级 / 负责人 / 关键词匹配、空泳道隐藏且不改动入参、负责人选项按姓名排序去重 | 本地通过 |
| R8-WEB-UNIT-002 | Web 单元 | 展示映射 | `task-board-format.test.ts` 16 例：跨日时间按上海时区落到次日、`dueLabelOf` / `dueListLabelOf` 各分支、优先级与工作状态文案色调、三段构成条百分比与分母为 0、环形进度 dashoffset 裁剪、头像与泳道色调按 ID 稳定分配 | 本地通过 |
| R8-WEB-UNIT-003 | Web 单元 | 页面渲染与交互 | `TaskBoardPageView.test.tsx` 9 例：泳道与统计渲染、筛选后完成率仍为全量口径且显示「筛选结果 N / 42」、列表切换写回筛选状态、列表视图分组表格行、检索无命中与空项目两种空态、截断提示、遗留问题来源任务在卡片上显示「遗留问题」徽章且整页 ID 一次请求（`taskIds: [1, 2, 3]`）、列表视图在标题前显示徽章；`task-board-server.test.ts` 2 例：经生成客户端调用并原样抛出错误 | 本地通过 |
| R8-LAYOUT-UNIT-001 | Web 单元 | 侧栏与面包屑 | `AppLayout.test.tsx` 16 例（新增 3 例）：项目路由渲染「当前项目」分组且「任务看板」子项为当前页并有 `sub` 样式、非项目路由隐藏该分组、任务看板面包屑为 项目列表 → 项目名 → 任务看板；原有系统目录、计数与退出登录用例保持通过 | 本地通过 |
| R8-PG-INT-001 | 真实 PostgreSQL | 看板读端口 | `task-board-ports.integration.test.ts` 6 例：`dueState` 按 Asia/Shanghai 日界分类（今日零点前 1 秒与 `now() - 2 days` 为 OVERDUE、严格落在 `(now(), 明日 00:00)` 内为 TODAY、明日 00:00 与 `now() + 10 days` 为 SCHEDULED、未设截止与 DONE / CANCELED 一律 NONE）且列表按「逾期 → 未完成（先优先级 紧急 → 高 → 普通 → 低，再截止升序 NULL 最后）→ 已完成（完成时间倒序）→ 已取消」排序，优先级压过截止时间的反例（高优昨日末尾排在普通逾期之前、十日后到期的紧急排在明日零点之前）与「已完成只看完成时间不看优先级」的反例均被断言；`boardStats` 项目级总计等于各模块分组之和、空项目为零值、无任务模块不产生分组行；ARCHIVED / INVALID 不进看板而 CANCELED 保留在列表与统计；插入 1001 条时列表截断为 1000 且 `truncated = true`，把可见的 1000 个 ID 作为 `excludedTaskIds` 传回后只剩 1 条且不再截断（过滤在 LIMIT 之前）；跨项目隔离；两条查询在 `enable_seqscan = off` 下都不回退 `Seq Scan on tasks` | 本地通过（临时 PostgreSQL 18.6 + PGroonga 集群；时间相关用例的夹具与读取同事务，`now()` 固定，测试不落库） |
| R8-E2E-001 | Playwright | 看板关键路径 | `task-board.spec.ts`：打开看板看到完成率环与「已完成 X / Y」→ 从看板新建任务后 `task-board` 查询自动失效并出现卡片、详情弹窗可打开 → 看板 / 列表视图切换（URL `view=list`）→ 状态 chip、时间 chip、优先级下拉与关键词搜索逐项过滤并写回 URL → 无命中空态「清除筛选」恢复 → 列表行点击就地打开任务详情 | 本地通过（完整套件 53 passed / 4 failed，4 项均为既有问题，见下） |

本地实际执行（2026-09-18，Windows + PowerShell + 新建的临时 PostgreSQL 18.6 集群）：`apps/api` 集成 50 文件 474 例（含本轮新增 6 例）、`apps/api` 单元 65 文件 359 例、Web 单元 82 文件 507 例、`apps/ops` 单元 8 文件 52 例、`lint` / `typecheck` / `build` / `contract:drift`（5 个产物与 Registry 一致）/ `contract:validate`（108 条路由）/ `permissions:check`（108 操作 / 108 路由）/ `check:frontend:boundaries` / `check:deps` / `check:secrets` 全部通过。两条看板查询与统计在同一事务内执行，共用同一个 `now()`，不存在日界漂移。

未运行 / 已知偏差：① 完整 Playwright 套件 53 passed / 4 failed：`features.spec.ts:93`（管理员归档并恢复功能）与 `project-members.spec.ts:10`（普通成员只读成员页）在同一数据库上失败，且在未包含本改动的 HEAD 对照 worktree 上以完全相同的方式失败，属分支既有问题；`search.spec.ts:6` 与 `project-members.spec.ts:56` 在长期开发库（55432）通过、在新建空库失败，属夹具 / 数据依赖的既有环境问题。② `format:check` 仍失败于四个存量文件（`apps/e2e/helpers/record-leftovers.ts`、`apps/e2e/tests/leftover-task.spec.ts`、`apps/web/src/features/common/components/LeftoverEntriesField.test.tsx`、`apps/web/src/features/published-records/AppendLeftoverForm.tsx`）。③ `check:docs` 已通过（2026-09-18 清理后复跑，82 个 Markdown）：仓库根 8 个未跟踪 `.tmp-*` 文件与 `.design-preview/` 任务看板静态预览（1 个 HTML 页面 + 5 张截图，均未跟踪）已删除，页面对 CSS 注释的唯一引用同步改写，全仓无残留引用。④ 侧栏改为 首页 / 任务中心 / 项目列表 / 迭代记录 / 遗留问题 +「当前项目」分组（项目概览 / 模块与功能 / 任务看板 / 项目成员）+「全局」分组（项目动态 / 站内通知 / 全局搜索 / 成员与设置 / 审计日志仅管理员），侧栏新增的「站内通知」与顶栏铃铛同名，让 `csp.spec.ts` 与 `visual-migration.spec.ts` 的通知定位出现歧义，已改为 `exact` 名称消歧；任务写操作（新建 / 编辑 / 状态流转 / 完成并记录 / 合并与解除合并）同时失效 `task-board` 查询。

未运行 / 已知偏差：① 完整 Playwright 套件 53 passed / 4 failed：`features.spec.ts:93`（管理员归档并恢复功能）与 `project-members.spec.ts:10`（普通成员只读成员页）在同一数据库上失败，且在未包含本改动的 HEAD 对照 worktree 上以完全相同的方式失败，属分支既有问题；`search.spec.ts:6` 与 `project-members.spec.ts:56` 在长期开发库（55432）通过、在新建空库失败，属夹具 / 数据依赖的既有环境问题。② `format:check` 仍失败于四个存量文件（`apps/e2e/helpers/record-leftovers.ts`、`apps/e2e/tests/leftover-task.spec.ts`、`apps/web/src/features/common/components/LeftoverEntriesField.test.tsx`、`apps/web/src/features/published-records/AppendLeftoverForm.tsx`）。③ `check:docs` 仍失败于仓库根未跟踪的 `.tmp-*` 存量文件（本轮未清理）。④ 侧栏改为 首页 / 任务中心 / 项目列表 / 迭代记录 / 遗留问题 +「当前项目」分组（项目概览 / 模块与功能 / 任务看板 / 项目成员）+「全局」分组（项目动态 / 站内通知 / 全局搜索 / 成员与设置 / 审计日志仅管理员），侧栏新增的「站内通知」与顶栏铃铛同名，让 `csp.spec.ts` 与 `visual-migration.spec.ts` 的通知定位出现歧义，已改为 `exact` 名称消歧；任务写操作（新建 / 编辑 / 状态流转 / 完成并记录 / 合并与解除合并）同时失效 `task-board` 查询。

## 列表默认状态与排序（2026-09-18 本地落库）

用户确认：功能页与模块任务页的任务面板进入时默认显示「全部状态」，任务列表按 未完成 → 已完成 → 已取消 分组、未完成组内按优先级 紧急 → 高 → 普通 → 低 排序；项目、模块与功能列表按生命周期档位排序。（2026-09-23 更新：「低」档位已整体下线，未完成组内排序为 紧急 → 高 → 普通，见末节《删除「低」（LOW）优先级档位》。）

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| LIST-ORDER-001 | 真实 PostgreSQL | 功能列表按生命周期档位排序 | `features-api.integration.test.ts`：同一模块下按「未开始、进行中、已归档」的相反顺序建库（进行中 = 作用域内存在 `work_status = 'DONE'` 的有效任务）后，`GET .../features` 返回 进行中 → 未开始 → 已归档；反事实验证把排序退回 `f.id` 时该用例失败（`expected [609, 610, 611] to deeply equal [610, 609, 611]`） | 本地通过（`app_it`，2026-09-18） |
| LIST-ORDER-002 | 真实 PostgreSQL | 任务面板列表按状态分组与优先级排序 | `tasks-api.integration.test.ts`：5 条任务按打乱顺序经真实 HTTP 登记后，一条改为 DONE、一条改为 CANCELED（同事务补 `task_status_history`），`GET .../tasks` 返回 未完成（紧急 → 普通 → 低）→ 已完成 → 已取消（2026-09-23 起该用例改判 紧急 → 高 → 普通，见末节）；反事实验证把排序退回 `id` 时该用例失败（`expected [915, 916, 917, 918, 919] to deeply equal [917, 918, 916, 915, 919]`） | 本地通过（`app_it`，2026-09-18） |
| LIST-ORDER-003 | Web 单元 | 任务面板默认全部状态 | `TasksPanel.test.tsx`：进入面板时 `任务状态筛选` 的值为 `ALL`，TODO / DONE / CANCELED / INVALID 四种行一次列出（此前默认 `TODO`） | 本地通过 |

本地实际执行（2026-09-18，Windows + PowerShell + docker `inpulse-pg` 的独立集成库 `app_it`）：`pnpm --filter @inpulse/api test:integration tasks-api features-api` 2 文件 63 例通过，全量 `pnpm --filter @inpulse/api test:integration` 50 文件 476 例通过（首次全量运行 `preauth-session.integration.test.ts` 的「同一预认证 Session 只能原子消费一次」抖动失败 1 例，该文件单独复跑 4/4、全量复跑 476/476 通过，与本轮改动无关）；`pnpm --filter @inpulse/api test:unit` 65 文件 359 例通过；`pnpm --filter @inpulse/web exec vitest run src/features/tasks/TasksPanel.test.tsx` 23 例通过；`pnpm --filter @inpulse/api typecheck`、`pnpm --filter @inpulse/e2e tsc --noEmit`、`pnpm lint`、`pnpm check:frontend:boundaries`、`pnpm check:docs` 通过；功能与模块列表排序另在临时脚本里用「建夹具 + 事务回滚」在真实 PostgreSQL 上复核（回滚后 `app.projects` / `app.modules` / `app.tasks` 零残留）。

未运行 / 已知偏差：① 未跑 `pnpm test:e2e`（避免把 E2E 夹具写进共享开发库 `app`）与 GitHub Actions；② `pnpm --filter @inpulse/web test` 复跑为 503 passed / 7 failed，失败全部落在既有的 `ProjectTree.test.tsx`（另有一次全量并行运行额外出现 `src/pages/tasks/TasksPage.test.tsx` 1 例失败，该文件单独运行 8/8 通过，判定为并行负载下的既有抖动，与本轮改动无关）；③ `format:check` 仍失败于存量文件（`apps/e2e/tests/leftover-task.spec.ts`、`apps/web/src/features/published-records/AppendLeftoverForm.tsx`）；④ 新增集成测试与 e2e 断言需非作者人工评审。

## 任务列表统一排序与多列游标（ADR-037，2026-09-18 本地落库，待人工批准）

用户确认：任务中心与任务面板共用同一排序键 —— 状态分组 未完成 → 已完成 → 已取消；未完成内部按紧急桶 已逾期 → 遗留问题来源 → 标记紧急 → 今/明日截止 → 其余（命中第一个即定桶，按 `Asia/Shanghai` 日历日）；随后优先级 紧急 → 高 → 普通 → 低、截止时间升序（无截止最后）、任务 ID 升序兜底。任务中心的游标随之由单列 `afterId` 扩展为多列 keyset。（2026-09-23 更新：优先级只剩 紧急 → 高 → 普通 三档；游标版本由 3 升到 4，见末节。）

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| ADR037-ORDER-001 | 真实 PostgreSQL | 5 个紧急桶 × 3 个状态分组的排序 | `aggregate-read-ports.integration.test.ts`：每个状态分组各造 已逾期（今天 00:00 前）/ 遗留问题来源（`leftover_task_links` 链接）/ 标记紧急（URGENT，无截止）/ 今日截止（今天 00:00 后）/ 其余 + 2 条完全并列，共 21 条；`MyTaskQueryPort.list` 返回顺序严格等于「未完成桶 0→4、已完成 / 已取消 URGENT 优先且无截止最后」，`TaskQueryPort.list` 同序；链接查询反证来源桶由 `leftover_task_links` 决定。反事实验证把 `taskListOrderBy` 退回 `t.id DESC` 时本用例与 6 个既有顺序用例一起失败（`expected [ 10872, 10871, … ] to deeply equal [ 10866, 10867, … ]`），恢复后 22/22 通过 | 本地通过（`app_it`，2026-09-18） |
| ADR037-CURSOR-001 | 真实 PostgreSQL | 多列 keyset 分页不漏不重 | `aggregate-read-ports.integration.test.ts`：逾期 + URGENT + 今日截止 + 5 条完全并列（无截止）共 8 条，按 `limit=2` 用 `next` 逐页走完，拼接顺序与不分页结果一致且无重复；反事实验证同上（退回 `t.id DESC` 时该用例失败） | 本地通过（2026-09-18） |
| ADR037-CURSOR-002 | API 单元 | 游标排序键载荷 | `aggregate-read-cursor.test.ts` 8 例（新增 2 例）：`MY_TASKS` 游标带 `k` 时 `decodeKey(..., requireSortKey: true)` 返回 `{ afterId, sortKey }`；其它命名空间仍返回 `sortKey: null`；缺少 `k` 的旧载荷按 `version` 拒绝（422 语义）；改写 `k` 后重放按 `signature` 拒绝（排序键确实在 HMAC 载荷内） | 本地通过 |
| ADR037-HTTP-001 | 真实 PostgreSQL / HTTP | 任务中心 HTTP 顺序与筛选 | `aggregate-read-api.integration.test.ts` 20 例：主列表、`scopeType=FEATURE&workStatus=TODO`、`hasPublishedRecord`、`projectId` 全量与 `limit=3` 游标遍历的期望顺序全部改为 ADR-037 口径（遗留问题来源任务 `tSource` 提到未完成首位）；统计卡片用例改为 已逾期 → 今日截止 → 已完成 → 已取消 | 本地通过（`app_it`，2026-09-18） |
| ADR037-FIX-001 | 真实 PostgreSQL | 原生 `sql` 绑定 `Date` 的前置缺陷 | 现象：drizzle-orm 构造时把 `client.options.serializers` 的 timestamptz 编码器改写为恒等函数，而 postgres.js 连接、原生 `sql` 与 Drizzle 共用同一 options 对象，原生 `sql` 传 `Date` 在 Bind 阶段抛 `Received an instance of Date`；修复为 `createDrizzleDb(sql)` 构造后只还原 1184 编码器（JSON 不还原，避免二次编码）。证据：事务内 `SELECT COALESCE($1::timestamptz, ```infinity```::timestamptz)` 修复前抛错、修复后返回 `2026-09-18 03:00:00+00`；全量集成 50 文件 476 例通过 | 本地通过（2026-09-18） |

本地实际执行（2026-09-18，Windows + PowerShell + docker `inpulse-pg` 的独立集成库 `app_it`）：`pnpm --filter @inpulse/api test:integration` 50 文件 476 例通过（含本轮新增 2 例）；`pnpm --filter @inpulse/api test:unit aggregate-read-cursor` 8 例通过；`pnpm --filter @inpulse/api typecheck`（含测试 tsconfig）通过。反事实验证在真实 PostgreSQL 上执行：把 `taskListOrderBy` 临时替换为 `t.id DESC` 后 7 例失败，恢复后 22/22 通过。

未运行 / 已知偏差：① 未跑 Web 单元与 `pnpm test:e2e`（任务中心前端只消费服务端顺序，本轮未改前端代码）、未跑 GitHub Actions；② ADR-037 仍为 `Proposed`，需人工批准；③ 新增集成与单元用例需非作者人工评审。
## 项目头部移除「全部项目」返回入口（C，2026-09-19 本地落库）

用户要求删掉项目头左上角的「← 全部项目」。`ProjectOverviewPageView` 移除 `.project-detail-head` 内的 `.back-button` 与该组件唯一的 `onBackToProjects` 属性（接口同步收窄），调用方 `ModulesPageView` 去掉传参；返回项目列表改由公共侧栏「项目列表」承担。`ProjectOverviewPageView.test.tsx` 基础渲染参数同步去掉该 handler；E2E `apps/e2e/tests/aggregate-views.spec.ts` 例 2 删除「`全部项目` → `/projects`」断言（保留「查看全部」「查看模块」与旧地址重定向断言），上表 F-29 行已同步。

本地实际执行（2026-09-19）：`pnpm --filter @inpulse/web typecheck` 与 `pnpm --filter @inpulse/e2e typecheck` 通过；定向 `vitest run src/features/project-overview/ProjectOverviewPageView.test.tsx src/features/modules` 2 文件 24 例通过；全量 web 单测 82 文件通过、仅 `ProjectTree.test.tsx` 7 例既有失败；`pnpm lint`、改动文件 `prettier --check` 与 `pnpm check:docs` 通过；无头浏览器复验 `/projects/3/modules` 项目头内已无 `.back-button`（head 盒 270/27/1136×122），截图 `.data/project-head-no-back.png`。未运行：Playwright 全量、`pnpm check` 整链、后端测试。

## 任务中心统计卡改四张与「今日待办」筛选（2026-09-20 本地落库）

用户定案：任务中心顶部四张统计卡改为「今日待办 / 未完成 / 已完成 / 我创建的」。今日待办 = 未完成且命中 逾期 ∪ 遗留来源（`leftover_task_links` 存在链接行）∪ 标记紧急（`priority = 'URGENT'`）∪ 距截止 7 个日历日内 之一；今日待办 / 未完成 / 已完成按负责人维度（assignee = 当前用户），我创建的按创建人维度（creator = 当前用户，无论指派给谁）。今日待办卡另外用一行灰字展示四个来源子计数（逾期 n · 遗留 n · 紧急 n · 7 天内 n）。

锁定口径：

- `MyTaskStats` 由 `myOpen`/`dueToday`/`overdue`/`completedThisMonth` 重定为 `todayTodo` + `todayTodoBreakdown`（`overdue`/`leftover`/`urgent`/`dueWithinDays`）+ `myOpen` + `completed` + `created`；四个子项各自独立计数、可以重叠，其并集即 `todayTodo`，不保证四项之和等于 `todayTodo`；`completed` 不再限制在本月。
- 基准集合排除 `INVALID` / `CANCELED` 与历史来源分支，与筛选、分页、游标正交；日界与 7 天窗口全部由 SQL 按 Asia/Shanghai 计算，客户端不自行推导。
- `todayTodo` 作为新增查询参数进入 `MyTasksQueryRequest`（`TaskCenterQuery` 继承同一扩展），布尔筛选，缺省不产生额外过滤；`todayTodo=true` 只返回未完成且命中上述四类之一的任务，服务端在分页 SQL 内先过滤后分页。
- 前端 `MyTaskFilters` 增加 `todayTodo`，URL 参数 `today=1`（服务端适配器经生成客户端 `listTaskCenter` 透传，`projectId` 已选定时同样收窄）；四张卡分别切到 `mine+open+todayTodo`、`mine+open`、`mine+done`、`created+all`；切换状态分段或点击风险横幅时清除今日待办筛选。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| F32-STATS-CONTRACT-001 | 契约与权限 | Schema 与生成物 | `myTaskStatsSchema`、新增 `myTaskTodayTodoBreakdownSchema`（`MyTaskTodayTodoBreakdown`）与 `myTasksQueryRequestSchema.todayTodo` 登记进 Schema Registry；OpenAPI、fingerprints 与生成客户端由生成工具更新；`contract:drift`、`contract:validate`（108 条路由）与 `permissions:check`（108 操作 / 108 路由）通过 | 本地通过 |
| F32-STATS-UNIT-001 | API 单元 | 筛选进入端口与游标 | `aggregate-read.service.test.ts` 29 例：`todayTodo` 进入 `MyTaskQueryPort.list` 入参与游标 `filterKey`；统计与遗留问题样本不随 `ownership` 变化 | 本地通过 |
| F32-STATS-DB-001 | 真实 PostgreSQL | 统计口径与筛选同源 | `aggregate-read-api.integration.test.ts` 20 例：`projectId` 收窄后 `todayTodo = 2`（逾期 + 今天到期），`todayTodoBreakdown` 四个子项分别为 1 / 1 / 1 / 1，`myOpen = 2`、`completed = 1`、`created = 3`（已取消任务不计入）；`todayTodo=true` 只返回该 2 条且 `items.length === stats.todayTodo`；`todayTodo=maybe` 返回 422；无成员身份返回全零统计 | 本地通过（`app_it`，2026-09-20） |
| F32-STATS-WEB-UNIT-001 | Web 单元 | URL、映射、适配器与视图 | `my-tasks-mock.test.ts`（`todayTodo = 3`、四个子项 1/1/1/2、`created = 8` 且与 scope 无关）、`my-tasks-server.test.ts`、`TaskCenterPageView.test.tsx`（四张卡与来源行渲染、点击「已完成」卡清 `overdue`、点击风险横幅保留项目）、`TasksPage.test.tsx`、`AppLayout.test.tsx` 夹具同步 | 本地通过 |

本地实际执行（2026-09-20）：`pnpm --filter @inpulse/api-contract typecheck`、`pnpm contract:generate`、`contract:drift`、`contract:validate`、`permissions:check` 通过；`pnpm --filter @inpulse/api typecheck`（含测试 tsconfig）与 `test:unit` 65 文件 362 例通过；`pnpm --filter @inpulse/api test:integration`（`app_it`）50 文件 478 例通过；`pnpm --filter @inpulse/web typecheck` 与定向 `vitest run src/features/my-tasks src/pages/tasks` 6 文件 82 例通过；全量 web 单测 82 文件 499 例中仅 `ProjectTree.test.tsx` 7 例存量失败（改动前即失败）；`pnpm lint`、`pnpm build` 通过；`pnpm --filter @inpulse/e2e exec playwright test aggregate-views` 2/2 通过（12.4s，夹具清理删除用户 2 / 项目 2 / 业务行 62 / 审计行 2）。

未运行 / 已知偏差：① 未跑 Playwright 全量、`pnpm check` 整链、`db:migrations:check` / `db:seed:check` 与 GitHub Actions（`ci.yml` 只在 PR 与 push `main` / `dev/*` 触发）；② 上文 2026-09-11 增量段第 5 条「统计口径」与 [C 域对齐表](c-v1-alignment.md) 第 57 行表格中的 `stats` 字段列表由本段取代，`docs/a-contract-review-f25-f29-f32.md` §10.3 的历史裁决文本保留不改写；③ 本轮改动尚未提交、未推送，新增与改写的测试需非作者人工评审。

## 任务中心移除范围分段行、项目筛选移入工具栏（C，2026-09-20 本地落库）

用户定案（承接同日的统计卡改四张与「今日待办」筛选）：任务中心顶部范围分段行（「我负责的 / 我创建的 / 按项目」）**整体删除** —— 今日待办 / 未完成 / 已完成 三张卡就是「我负责的」口径，我创建的由第 4 张卡承担；原「按项目」能力改为工具栏里的常驻**项目筛选**；同一条工具栏里的「未完成 / 已完成 / 全部」状态滑块一并删除（工作状态改由统计卡设定）。

落地口径：

- 范围仍由 URL `scope`（`mine|created|project|all`）承载，非管理员 `scope=all` 回落 `mine` 的降级语义不变；页面不再渲染任何范围 tab，`scopeOrder` / `scopeLabels` / `scopeHints` / `scopeTitles` / `scopeDisabledTitles` / `isScopeFilterSupported` / `handleScopeChange` 与 `scopeCounts` 渲染一并移除。
- 工具栏新增常驻「项目」`CalmSelect`（`appearance="rich"`）：首项「全部项目」（value `""`），其余项复用 `projectSelectOption`（图标块 + 名称 + 「n 名活跃成员」+ 生命周期徽标 + 选中对勾），与遗留问题页 `/issues` 同口径；视觉新增 `.task-toolbar-field`（标签 + 下拉靠左排版）。
- `filters.projectId` 由「仅 `scope=project` 或逾期钻取时保留」改为常驻条件：`writeMyTaskFilters` 只要 `projectId !== null` 就写 `project`；`toMyTasksV1Query` 只要选定项目就下发 `projectId`（与 `ownership` / `scopeType` / `workStatus` 组合收窄）；`my-tasks-server.ts` 删除重复的 `projectId` 拼装。
- 连带行为（均在视图层，无服务端改动）：任务聚合组区块（R-7 `listTaskGroups`）跟随项目筛选；四张统计卡随项目收窄（R-3 统计基准集合本就只受 `projectId` 影响，`todayTodo` / `myOpen` / `completed` / `created` 口径不变）；新建任务弹窗在项目筛选选定即预填 `preset.projectId`；`TaskCenterPageView` 的 `isAdmin` 属性随之删除（唯一用途是范围 tab 的显示条件）。
- 样式清理：删除 `.task-view-tabs` 相关规则（`design-system.css` 5 条 + `inpulse-design.css` 2 条）。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| F32-PROJECT-FILTER-WEB-001 | Web 单元 | 范围分段行与状态滑块移除 | `TaskCenterPageView.test.tsx`：`queryByRole("tablist")` 与 `queryByRole("group", { name: "工作状态" })` 均为 null；工具栏仍渲染「搜索任务」与项目筛选，项目触发器默认显示「全部项目」 | 本地通过 |
| F32-PROJECT-FILTER-WEB-002 | Web 单元 | 项目筛选回调与「范围由卡片设定」 | 同文件：打开项目下拉选「订单中台」→ `onFiltersChange({ projectId: 5 })`；点 `stat-created` → `{ scope: "created", status: "all" }`、点 `stat-my-open` → `{ scope: "mine", status: "open" }`；URL `scope=created&status=all` 下列表标题为「全部任务」且页面无任何 tab；`projectId=1` 时点逾期风险横幅 → `{ scope: "mine", projectId: 1, overdue: true }`（项目筛选不被钻取清掉） | 本地通过 |
| F32-PROJECT-FILTER-URL-001 | Web 单元 | `project` 参数成为常驻条件 | `my-tasks-url.test.ts`：`scope=mine + projectId=9` 写出 `project=9` 并读回，`projectId=null` 不写参数；`my-tasks-v1-query.test.ts`：`mine + projectId=7` → `{ limit: 20, projectId: 7 }`，`created + projectId=7` → 追加 `ownership: "CREATOR"` | 本地通过 |
| F32-PROJECT-FILTER-PAGE-001 | Web 单元 / 路由 | 页面接线与管理员范围 | `TasksPage.test.tsx`：点 `stat-created` 写入 `scope=created`；`scope=all` 在非管理员回落 `mine`、管理员保持 `all` 且页面无 tablist | 本地通过 |
| F32-PROJECT-FILTER-E2E-001 | 真实 UI / API | 项目筛选端到端 | `apps/e2e/tests/aggregate-views.spec.ts` 例 1：工具栏项目字段默认「全部项目」；选 fixture 项目 → URL `project=<id>` 且刚创建的任务仍在列表；回到「全部项目」→ 参数移除；`stat-created` 写 `scope=created`、`stat-completed` 写 `status=done` 且列表标题变「已完成」 | 本地通过（2/2，12.1s） |
| F32-PROJECT-FILTER-NOTICE-001 | Web 单元 | 适配器说明同步 | `my-tasks-server.test.ts`：`MY_TASKS_SERVER_NOTICE` 断言改为含「统计卡片」「项目筛选」「我创建的」 | 本地通过 |

本地实际执行（2026-09-20）：`pnpm --filter @inpulse/web typecheck` 通过；定向 `vitest run src/features/my-tasks src/pages/tasks/TasksPage.test.tsx` 6 文件 83 例通过；全量 `pnpm --filter @inpulse/web test` 82 文件 499 例中仅 `ProjectTree.test.tsx` 7 例存量失败（改动前即失败，与本轮无关）；`pnpm lint`、`pnpm format:check`、`pnpm build`、`pnpm check:frontend:boundaries`（275 模块 1337 依赖，无违规）与 `pnpm --filter @inpulse/e2e typecheck` 通过；`pnpm --filter @inpulse/e2e exec playwright test aggregate-views` 2/2 通过（12.1s，夹具清理删除用户 2 / 项目 2 / 业务行 62 / 审计行 2）。浏览器实测（无头 Chromium，本地 `http://127.0.0.1:5173/tasks`）：范围 tablist 与「工作状态」分段计数均为 0，项目下拉展开后呈现「全部项目 + 4 个项目（图标块 / 名称 / n 名活跃成员 / 进行中徽标 / 对勾）」；选项目后 URL 变为 `?scope=created&project=2&status=all`；旧地址 `?scope=project&project=2&status=all` 仍显示「项目1」并列出该项目全员任务。截图证据：`.data/tasks-toolbar.png`、`.data/tasks-project-dropdown.png`、`.data/tasks-legacy-project.png`（`.data/` 已 gitignore）。

未运行 / 已知偏差：① 未跑 Playwright 全量、`pnpm check` 整链与 GitHub Actions；② 本轮是纯前端改动，未跑 API 单测 / 集成测试（服务端未改）；③ 项目筛选会同时收窄统计卡与任务聚合组区块，若产品希望「统计卡只看全局」需再定案；④ 新增与改写的用例需非作者人工评审。

## 任务中心统计卡选中态、默认落地「今日待办」与列表标题行删除（C，2026-09-20 本地落库）

用户定案：① 任务中心打开即落在「今日待办」，因此今日待办卡必须是选中态；点其余三张卡后对应卡片选中、未选中的保持普通态。② 列表区块不再重复「未完成 / n 项 · 服务端按任务编号倒序」两行文字——工作状态由上方统计卡的选中态表达。③ 工具栏项目筛选去掉与下拉内容重复的「项目」文字标签（无障碍定位仍由 `aria-label="项目"` 提供）。

锁定口径：

- 「今日待办」只在工作状态为「未完成」时有意义（服务端 `todayTodo` 与 `DONE` / `CANCELED` 求交恒为空）。URL 规则：`today=1` → 今日待办；`today=0` → 未完成但不限今日；不带 `today` 且 `status=open` → 今日待办（默认落地）；`status=done|all` → 该筛选不存在。`DEFAULT_MY_TASK_FILTERS.todayTodo = true`，`writeMyTaskFilters` 只在「未完成 + 显式关闭」时写 `today=0`；读 URL 与写 URL 使用同一推断，因此 `?status=done` 这类旧链接不会被静默套上今日筛选而变空。
- `toMyTasksV1Query` 与 mock 适配器只在 `status === "open"` 时套用 `todayTodo`，不发出必然为空的组合（已完成 / 全部视图不下发该参数）。
- 统计卡选中态由筛选反推（`selectedStatCardKey`）：`created+all` → 我创建的；`mine+done` → 已完成；`mine+open`（`todayTodo !== false`）→ 今日待办；`mine+open`（`todayTodo === false`）→ 未完成；组合对不上（如 URL 直接给 `scope=all`）时不选中任何卡。选中态同时写 `aria-pressed`。
- 列表区块只保留展示方式图标（`.task-list-mark`）与空态；今日待办空态改说「今天没有待办任务」，不再沿用「没有匹配的未完成任务」——今日待办是未完成的子集，沿用会让空态看起来像漏了任务。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| F32-STAT-CARD-SELECTED-WEB-001 | Web 单元 | 四张卡选中态唯一命中 | `TaskCenterPageView.test.tsx`：默认（未完成 + 今日待办）下 `stat-today-todo` 同时具备 `aria-pressed="true"` 与 `stat-card-selected`，其余三张为 `false` 且无该类；`todayTodo:false` → `stat-my-open`、`status=done` → `stat-completed`、`scope=created&status=all` → `stat-created` | 本地通过 |
| F32-STAT-CARD-SELECTED-WEB-002 | Web 单元 | 今日待办空态 | 同文件：默认视图空态为「今天没有待办任务」，且不再出现「没有匹配的未完成任务」 | 本地通过 |
| F32-LIST-TITLE-REMOVED-WEB-001 | Web 单元 | 列表标题与计数行删除 | 同文件：`status=all` 下列表仍渲染任务，且 `queryByText("1 项 · 服务端按任务编号倒序")` 与 `queryByRole("heading", { name: "全部任务" })` 均为 null；`status=done` 时只剩空态文案与统计卡选中态 | 本地通过 |
| F32-TODAY-DEFAULT-URL-001 | Web 单元 | 默认落地与 `today` 往返 | `my-tasks-url.test.ts`：空 URL 读出 `DEFAULT_MY_TASK_FILTERS`（含 `todayTodo: true`）；`todayTodo:false` 经 `status=all` 往返一致；`writeMyTaskFilters(DEFAULT_MY_TASK_FILTERS)` 仍写出空串 | 本地通过 |
| F32-TODAY-DEFAULT-QUERY-001 | Web 单元 | 适配器只在未完成视图下发今日待办 | `my-tasks-v1-query.test.ts`（默认请求含 `todayTodo: true`，`status=done|all` 不带该参数）、`my-tasks-server.test.ts`（默认请求与「未完成 + 优先级 + 含已取消」请求含 `todayTodo: true`）、`my-tasks-mock.test.ts`（默认视图为 T-101 / T-102 / T-103；T-108 在 20 天后到期、非紧急无遗留，不在今日待办） | 本地通过 |
| F32-TODAY-DEFAULT-E2E-001 | 真实 UI / API | 默认选中态与工具栏标签 | `apps/e2e/tests/aggregate-views.spec.ts` 例 1：`/tasks` 默认 `stat-today-todo` 为 `aria-pressed="true"`、`stat-my-open` 为 `false`；点未完成卡写 `today=0`；项目字段改为断言 `calmSelectTrigger(page, "项目")` 含「全部项目」；`stat-completed` 后 `.task-list-mark` 计数为 1 | 本地通过（2/2，13.6s） |

本地实际执行（2026-09-20）：`pnpm --filter @inpulse/web typecheck`、`pnpm --filter @inpulse/e2e typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm build`、`pnpm check:frontend:boundaries`（275 模块 1337 依赖，无违规）与 `pnpm check:docs`（83 个 Markdown 文件链接与锚点有效）通过；定向 `vitest run src/features/my-tasks src/pages/tasks` 6 文件 88 例通过；全量 `pnpm --filter @inpulse/web test` 82 文件 505 例中仅 `ProjectTree.test.tsx` 7 例存量失败（改动前即失败，与本轮无关）；`pnpm --filter @inpulse/e2e exec playwright test aggregate-views` 2/2 通过（13.6s，夹具清理删除用户 2 / 项目 2 / 业务行 62 / 审计行 2）。浏览器实测（无头 Chromium，本地 `http://127.0.0.1:5173/tasks`）：默认恰好 1 张卡选中且为今日待办；点「未完成」→ `?today=0`、点「已完成」→ `?status=done`、点「我创建的」→ `?scope=created&status=all`、点「今日待办」→ 回到 `/tasks`，每步选中卡随之切换；旧链接 `?status=done` 仍列出已完成任务（未被今日筛选清空）；`.task-toolbar-field` 计数 0、`.task-list-mark` 计数 1。

未运行 / 已知偏差：① 未跑 Playwright 全量、`pnpm check` 整链与 GitHub Actions；② 本轮为纯前端改动，未跑 API 单测 / 集成测试（服务端契约与行为未改）；③ 默认落地由「未完成」改为「今日待办」是本次唯一行为变化，历史收藏链接 `?status=done|all` 按新规则推断为无今日筛选，已由 URL 单测与 E2E 覆盖；④ `/issues` 仍是「项目 + 文字标签」写法，本次只改任务中心；⑤ 新增与改写的用例需非作者人工评审。

## 生命周期与标签徽章同色（C，2026-09-20 本地落库）

用户定案：同一个文案的徽章无论出现在哪个页面、哪张卡片上都必须同色，且应当是彩色而不是灰色。

锁定口径：

- 「进行中」全站统一项目蓝（`blue`）。原先配色由各调用点各自决定：模块卡经 `resourceLifecycleTone(..., "gray")` 得到灰、功能列表卡写死 `"gray"`，而项目卡、功能详情页头、任务聚合组列表卡写死蓝，同一个「进行中」在四处出现三种颜色；本轮全部收敛为 `blue`，并在 `resource-lifecycle.ts` 注释里写明第三个参数必须传 `blue`。
- 「未开始」保持 `cyan`、「维护中」保持 `violet`、「已归档」保持 `amber`，项目四态（ADR-035）口径不变。
- 功能自定义标签在两个呈现位置（功能列表卡、功能详情页头）统一 `violet`；标签色只表达「这是标签」，不按标签名派生颜色，避免与状态、优先级、角色等语义色冲突。
- 任务聚合组详情弹层的「进行中」由 `violet` 改为 `blue`，与聚合组列表卡一致。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| LIFECYCLE-TONE-WEB-001 | Web 单元 | 模块卡「进行中」同色 | `ModulesPageView.test.tsx`：有已完成任务的模块渲染「进行中」且 class 含 `badge-blue`；`completedTaskCount = 0` 的模块仍为 `badge-cyan` | 本地通过 |
| LIFECYCLE-TONE-WEB-002 | Web 单元 | 列表卡与详情页头同色 | `FeaturesPageView.test.tsx`：功能卡的「进行中」为 `badge-blue`、自定义标签为 `badge-violet`，且详情页头前几个徽章的 `badge-*` 序列与该卡片完全一致 | 本地通过 |

本地实际执行（2026-09-20）：`pnpm --filter @inpulse/web exec tsc --noEmit -p tsconfig.json` 无输出、`pnpm lint` 通过、改动过的 6 个文件 `pnpm --filter @inpulse/web exec prettier --check` 通过；定向 `vitest run src/features/features src/features/modules src/features/common src/features/task-groups src/features/my-tasks` 15 文件 156 例通过。浏览器实测（无头 Chromium 1440×950，本地 dev 服务）：项目 1 模块卡 8 个「进行中」全为 `badge-blue`、项目 3 模块卡「未开始」为 `badge-cyan`、项目 2 模块卡「已归档」为 `badge-amber`；功能列表卡（`/projects/3/modules/3843/features`）为 `badge-blue` + `badge-violet`；功能 1783 与 1786 的详情页头同为 `badge-blue` + `badge-violet`。

未运行 / 已知偏差：① 未跑 `pnpm build`、`pnpm format:check` 整仓、`pnpm check:docs`、`check:frontend:boundaries`、全量 web 单测、Playwright E2E 与 API 测试（本轮为纯前端展示改动，服务端未改）；② 功能列表卡的「进行中」仍不区分「未开始」（卡片只按 `status` 判定，与模块卡的 `completedTaskCount` 口径不同），本轮未动；③ 聚合组成员行的「已归档」仍为 `badge-gray`，迭代记录的「已作废」为灰、`VOID` 为红，未纳入本轮统一；④ 新增与改写的用例需非作者人工评审。

## 任务中心列表列宽重排（C，2026-09-20 本地落库）

用户定案：任务中心的列表视图里「编号」没那么重要，「任务」列要能放下更长的标题。

锁定口径：

- 「编号」不再是独立列，并进任务标题下方的小字，与归属类型拼成一行（`K123-T-5 · 独立任务`，模块级 / 遗留问题继续追加在后面）；列表视图的表头顺序固定为 任务 → 项目 → 归属 → 负责人 → 优先级 → 截止 → 迭代 → 状态。
- 表格改用 `table-layout: fixed` 并显式分配列宽（32% / 12% / 18% / 8% / 8% / 9% / 5% / 8%），单元格左右内边距由 20px 收到 14px。此前 8 列在自动布局下互相抢宽，`th:first-child { width: 48% }` 实际只落到实处约 19%，标题被挤成窄条。
- 「任务」列允许折行（长标题最多按内容换行）、标题下方小字用满列宽；「归属」列不够宽时折行而不是截断；其余列保持不换行并以省略号收尾。
- 列宽按 1440px 视口标定：8 列实测 363 / 136 / 204 / 91 / 91 / 102 / 57 / 91px，全部单元格 `scrollWidth == clientWidth`（无截断、无溢出）。窄视口由 `.feature-list-scroll` 横向滚动兜底。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| F32-TASK-TABLE-LAYOUT-WEB-001 | Web 单元 | 列序与编号归位 | `TaskCenterPageView.test.tsx`「列表视图：标题领衔、编号并入标题下方小字」：表头顺序为 任务/项目/归属/负责人/优先级/截止/迭代/状态（`编号` 已不在表头），首行标题下方小字为 `INP-901 · 独立任务 · 模块级` 且落在该行第一个 `td` | 本地通过 |
| F32-TASK-TABLE-LAYOUT-BROWSER-001 | 浏览器实测 | 列宽与不截断 | 真实 dev 页面 `/tasks?scope=created&status=all&view=list`：表头顺序为 任务/项目/归属/负责人/优先级/截止/迭代/状态，列宽 363/136/204/91/91/102/57/91px，`tbody td` 溢出数 0；`/tasks?scope=mine&status=done&view=list` 同宽同序 | 本地通过 |

本地实际执行（2026-09-20）：`pnpm --filter @inpulse/web exec vitest run src/features/my-tasks src/pages/tasks` 6 文件 89 例通过（含新增用例「列表视图：标题领衔、编号并入标题下方小字」）、`pnpm --filter @inpulse/web exec tsc --noEmit -p tsconfig.json` 无输出、`pnpm lint` 通过、改动文件 `prettier --check` 通过。浏览器实测（无头 Chromium 1440×950，本地 dev）：见上表 F32-TASK-TABLE-LAYOUT-BROWSER-001；另注入一条超长标题确认标题按列宽换行（`td` 高度 83px → 104px，`white-space: normal`），注入仅改 DOM、未写库。

未运行 / 已知偏差：① 未跑 `pnpm build`、`pnpm check:docs`、`check:frontend:boundaries`、Playwright E2E 与全量 web 单测；② 项目任务面板（`TasksPanel` 列表视图，列序为 范围 → 编号 → 任务 → …）本轮未动，仍沿用旧列序与 48% 首列宽；③ 窄视口（<700px）下表格仍是横向滚动，未做列折叠；④ 新增与改写的用例需非作者人工评审。

## 取消重复的详情入口（整卡即入口，C，2026-09-20 本地落库）

用户定案：取消所有「任务详情」链接，整卡点击就等于查看任务详情；功能卡上「编辑功能」仍打开编辑弹窗，点卡片其余位置等于查看详情。

锁定口径：

- 卡片整块是唯一主入口，同义文字入口一律删除：功能列表卡不再渲染「查看详情」链接；功能详情页的任务卡不再渲染「任务详情」按钮。
- 任务卡容器由 `article` 改为 `button.calm-task-card`，带 `aria-haspopup="dialog"` 与无障碍名「查看任务详情：<标题>」，点击就地打开任务详情弹窗（不跳页）；`Enter`/`Space` 与点击等价。
- 功能卡保留 `catalog-edit-link` 里的「编辑功能」（`ACTIVE`）与「恢复功能」（`ARCHIVED`），点击打开对应弹窗且不触发整卡导航；判定沿用 `card-click.ts` 的 `isCardClick`（排除 `a[href]`、`button`、`summary`、`input`、`textarea`、`select`、`label`）。
- 任务面板列表视图的副标题不再写死「查看任务详情」，只留归属提示（「主任务 / 来源任务」·「遗留问题」）；两者都没有时整行不渲染。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| TASK-CARD-ENTRY-WEB-001 | Web 单元 | 任务卡整卡即入口 | `TasksPanel.test.tsx` 及 `TasksPage.test.tsx`：卡片以无障碍名匹配 `/^查看任务详情/` 取到且 `.calm-task-card` 可点，点击后任务详情弹窗可见；卡片内不再存在名为「任务详情」的按钮 | 本地通过 |
| TASK-CARD-ENTRY-WEB-002 | Web 单元 | 功能卡不再有同义入口 | `FeaturesPageView.test.tsx`：卡片容器内 `queryByRole("link")` 与 `queryByRole("button")`（限定在 `.calm-feature-card` 内）均为 `null`；「编辑功能」仍在 `catalog-edit-link` 中 | 本地通过 |
| TASK-CARD-ENTRY-E2E-001 | E2E | 12 个受影响关键路径回归 | `aggregate-views`、`external-links`、`features`、`leftover-task`、`module-tasks`、`project-archive`、`record-drafts`、`record-publishing`、`task-completion`、`task-groups`、`task-status`、`tasks`：24 passed | 本地通过 |
| TASK-CARD-ENTRY-BROWSER-001 | 浏览器实测 | 点击行为分流 | 真实 dev 页面 `/projects/3/modules/3843/features/1783`：页面内「任务详情 / 查看详情」文字入口数为 0，点击 `.calm-task-card` 就地在当前 URL 打开 `role=dialog`；`/projects/3/modules/3843/features`：无「查看详情」，点「编辑功能」弹出「编辑功能」弹窗且 URL 不变，点卡片内容区跳转 `/projects/3/modules/3843/features/1783` | 本地通过 |

本地实际执行（2026-09-20）：`pnpm --filter @inpulse/web exec vitest run src/features/tasks src/features/features src/features/task-groups src/pages` 14 文件 91 例通过；全量 `pnpm --filter @inpulse/web exec vitest run` 82 文件 508 例中 501 通过、7 失败（全部为 `src/features/project-tree/ProjectTree.test.tsx` 存量失败，该目录本轮未改动）；`pnpm --filter @inpulse/web exec tsc --noEmit -p tsconfig.json` 退出码 0；`pnpm lint` 退出码 0；`pnpm --filter @inpulse/e2e typecheck` 通过；Playwright 12 个 spec 24 passed (2.9m)；浏览器实测见 TASK-CARD-ENTRY-BROWSER-001（无头 Chromium 1440×900）。

未运行 / 已知偏差：① 未跑 `pnpm build`、整仓 `pnpm format:check`、`pnpm check:docs`、`check:frontend:boundaries` 与 API 测试；② 同类重复入口只在用户指定范围收敛（任务卡、功能卡），项目卡 / 项目概述的「查看模块」、模块卡的「查看功能」、聚合组卡的「查看详情 / 解除合并」仍在，两处口径暂不一致；③ `ProjectTree.test.tsx` 7 例存量失败未修，与本轮无关；④ 新增与改写的用例需非作者人工评审。

## 模块卡动作收敛与页头返回按钮统一（C，2026-09-20 本地落库）

用户定案：模块卡去掉「查看功能」「模块任务」「归档模块」，把「编辑模块」放到原「查看功能」的位置并压矮卡片；页头返回入口全站保持同一种样式，不要再一页一页找差异。

锁定口径：

- 模块卡页脚固定为「N 个功能 · N 项待办」在左、单个动作在右：`ACTIVE` 模块是「编辑模块」（打开编辑弹窗），`ARCHIVED` 模块且当前用户有归档权限时是「恢复模块」，两者互斥，卡内不再有第二个控件。
- 「查看功能」由整卡点击承担（`isCardClick` 放行卡片本身），「模块任务」在模块页「模块级任务」页签，「归档模块」在「编辑模块」弹窗底部（与 ADR-034 的功能卡口径一致）。
- `.catalog-module-wrap > .calm-feature-card.module-card` 不再预留 58px 外挂动作行留白，改为常规 22px；模块卡的 `h2` 上下边距 23/10 → 14/8、描述行 `min-height` 44 → 20 且下边距 25 → 16。1440px 视口、卡片宽 365px 实测 310px → 232px。功能卡（`FeaturesPageView`）保持原样，`catalog-edit-link` 仅由功能卡使用。
- 页面级返回入口统一为 32px 圆形折角箭头（`.title-back-button` + `chevronLeft` 20、描边 3），紧贴标题构成 `.page-title-row`，可见文本为空、无障碍名保留「返回模块列表 / 返回功能列表」。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| MODULE-CARD-ACTIONS-WEB-001 | Web 单元 | 卡内只剩一个动作 | `ModulesPageView.test.tsx`「keeps 编辑模块 as the only control inside the card」：卡内 `queryByRole("link")` 为 `null`、`getAllByRole("button")` 长度为 1 且名为「编辑模块」、`queryByText("模块任务")` 与 `queryByText("归档模块")` 均为 `null`，卡容器无 `role` | 本地通过 |
| MODULE-CARD-ACTIONS-WEB-002 | Web 单元 | 归档走弹窗底部 | 同文件「requires an archive reason…」与「shows archive entries for a project leader…」：卡片阶段 `queryByRole("button", { name: /归档/ })` 为 `null`，打开「编辑模块」后 `.calm-action-footer` 内可见「归档模块」，点它进入归档流程并仍按原因必填校验 | 本地通过 |
| MODULE-CARD-ACTIONS-WEB-003 | Web 单元 | 已归档卡只留恢复 | 同文件「offers restore instead of edit for archived modules」：卡片有「恢复模块」，无「编辑模块」与「归档模块」 | 本地通过 |
| MODULE-CARD-ACTIONS-BROWSER-001 | 浏览器实测 | 卡片几何与点击分流 | 真实 dev 页面 `/projects/3/modules`：卡内 `button/a` 仅 `["编辑模块"]`、`.catalog-edit-link` 计数 0，卡片高 310px → 232px（同宽度 365px 下注入旧规则对照）；点卡片中心进入 `/projects/3/modules/3843/features`，点「编辑模块」不改变 URL 且弹窗底部为 `归档模块/取消/保存`；`/projects/2/modules` 的两个已归档模块卡只渲染「恢复模块」 | 本地通过 |
| PAGE-BACK-UNIFY-BROWSER-001 | 浏览器实测 | 页头返回入口一致 | 16 条真实路由逐一扫描页头：`/projects/2/modules/9/features`、`/projects/2/modules/9/features/33`、`/projects/2/modules/9/tasks` 三处返回按钮均为 `title-back-button`、`border-radius: 50%`、32×32、可见文本为空；除完成任务弹层内按设计稿保留的「上一步 / 返回任务」外，无其它页面级文字返回入口 | 本地通过 |
| MODULE-CARD-ACTIONS-E2E-001 | E2E | 受影响关键路径回归 | `modules`、`aggregate-views`、`external-links`、`features`、`leftover-task`、`module-tasks`、`project-archive`、`record-drafts`、`record-publishing`、`task-completion`、`task-groups`、`task-status`、`tasks`、`issues`：26 passed | 本地通过 |

本地实际执行（2026-09-20）：`pnpm --filter @inpulse/web exec vitest run src/features/modules` 16 例通过；全量 `pnpm --filter @inpulse/web exec vitest run` 82 文件 508 例中 501 通过、7 失败（全部为 `ProjectTree.test.tsx` 存量失败）；`pnpm --filter @inpulse/web exec tsc --noEmit -p tsconfig.json` 退出码 0；`pnpm --filter @inpulse/e2e typecheck` 通过；`pnpm lint`、`pnpm format:check` 通过；Playwright 14 个 spec 26 passed (2.8m)；浏览器实测见上表。

未运行 / 已知偏差：① 未跑 `pnpm build`、`pnpm check:docs`、`check:frontend:boundaries` 与 API 测试；② 13 个 E2E spec 的进入模块方式由链接改为点卡片（需要模块级任务页的用例再点「模块级任务」页签），`record-drafts` / `task-status` 的 `if/else` 同步补了大括号，需非作者人工评审；③ `/projects/:id/modules/:moduleId/tasks` 页头的「查看功能目录」按钮与同页「功能目录」页签目的地相同，属同类重复入口，本轮按用户指定范围保留；④ 项目卡的「查看模块 ›」是非交互 `span`，未动；⑤ `ProjectTree.test.tsx` 7 例存量失败未修，与本轮无关。

## 「新增模块」淡蓝色按钮（C，2026-09-20 本地落库）

用户定案：页头动作行里的「新增模块」给一个淡蓝色，不要再用白底描边。

锁定口径：

- 新增 `.soft-blue-button`：淡蓝底 `#e6f2ff`、蓝字 `#2472c3`、淡蓝描边 `#cfe4fa`，hover 变 `#d7e9fd` / 描边 `#b6d4f4` / 字色 `#1d5fa8`。色值取自既有 `.badge-blue` 同族，不新增设计 token。
- 页头动作行、模块区块标题行、无模块空态三处「新增模块」共用该类名，同一动作在同一页只有一种外观，并与实心 `--primary` 的「新建任务」拉开层级。
- `.soft-blue-button` 同时进入 `design-system.css` 中 `.primary-button/.secondary-button/.small-button` 的几何基线组，非 antd 场景（原生 `button`）也能直接使用。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| SOFT-BLUE-BUTTON-BROWSER-001 | 浏览器实测 | 计算样式与三处一致 | 真实 dev 页面 `/projects/2/modules`：两个可见「新增模块」按钮（页头动作行 y≈114、模块区块标题行 y≈566）类名均为 `soft-blue-button`，`backgroundColor: rgb(230, 242, 255)`、`color: rgb(36, 114, 195)`、`borderColor: rgb(207, 228, 250)`，尺寸 102×35 | 本地通过 |
| SOFT-BLUE-BUTTON-BROWSER-002 | 浏览器实测 | 空态同色 | 用 Playwright 路由拦截 `GET /api/v1/projects/2/modules` 返回 `{"items":[]}`（不写库）复现空态：页面出现「暂无模块」，空态按钮类名为 `soft-blue-button`、底色 `rgb(230, 242, 255)` | 本地通过 |
| SOFT-BLUE-BUTTON-E2E-001 | E2E | 点「新增模块」的路径不回归 | `modules`、`tasks`、`task-groups`、`aggregate-views`、`project-archive` 5 个 spec 全部通过（按 role+name 定位，不依赖类名） | 本地通过 |

本地实际执行（2026-09-20）：`pnpm --filter @inpulse/web exec tsc --noEmit -p tsconfig.json` 退出码 0；`pnpm lint`、`pnpm format:check` 通过；`pnpm --filter @inpulse/web exec vitest run src/features/modules` 16 例通过；Playwright 5 个 spec 通过；浏览器实测见上表。

未运行 / 已知偏差：① 未跑 `pnpm build`、`pnpm check:docs`、`check:frontend:boundaries`、全量 web 单测与 API 测试；② 空态按钮也是淡蓝色（与另两处一致），若产品认为空态应保留实心主色需另行改回；③ 色值为写死的十六进制，未收进 `:root` 变量；④ 改动的类名与配色需非作者人工评审。

## 任务聚合组与任务卡网格对齐（C，2026-09-20 本地落库）

用户定案：任务聚合组这一块要跟上面的任务卡对齐；「任务聚合组」标题与说明再往右一点点（先在浏览器按 18px 落库，产品复核后定为 10px）。

锁定口径：

- `.group-panel` 横向不再内缩：`padding: 20px` → `padding: 20px 0`，标题块与卡片左沿都回到页面内容基准线 270px，与任务卡网格、工具栏、统计卡同一条线。
- `.group-list` 固定两列：`repeat(auto-fill, minmax(360px, 1fr))` + `gap: 14px` → `repeat(2, minmax(0, 1fr))` + `gap: 20px`。容器 1136px 时 auto-fill 会算出 3 列、卡片宽掉到 369px，任务编号被折断、页脚说明折成 3 行（卡片高度 253px → 462px）；1000px 以下沿用既有单列回落规则。
- `.group-panel > .calm-section-title` 增加 `padding-left: 10px`：标题与说明整体落在 280px；右侧计数走 `justify-content: space-between`，位置不受左内边距影响。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| TASKGROUP-ALIGN-BROWSER-001 | 浏览器实测 | 左右边界与任务卡一致 | 真实 dev 页面 `/tasks?status=done`：`.calm-task-grid` 与 `.group-panel` 同为 `x=270, w=1136`；`.group-card` `x=270, w=558`；`.group-panel > .calm-section-title h3` 与说明 `x=280`，右侧计数仍为 `x=1333` | 本地通过 |
| TASKGROUP-ALIGN-BROWSER-002 | 浏览器实测 | 三列方案被否 | 注入 3 列样式复现：卡片宽 369px、任务编号折行、卡片高度 253px → 462px，确认不采用 | 本地通过 |
| TASKGROUP-ALIGN-E2E-001 | E2E | 聚合组关键路径不回归 | `aggregate-views.spec.ts`（F-32、F-29）与 `task-groups.spec.ts`（F-23/F-24/F-25、F-25）：4 passed | 本地通过 |
| TASKGROUP-ALIGN-WEB-001 | Web 单元 | 任务中心渲染不回归 | `pnpm --filter @inpulse/web exec vitest run src/features/my-tasks src/pages/tasks`：6 文件 89 例通过 | 本地通过 |

本地实际执行（2026-09-20）：`pnpm --filter @inpulse/web exec tsc --noEmit -p tsconfig.json` 退出码 0；`pnpm lint`、`pnpm format:check` 通过；web 单测 6 文件 89 例；Playwright 4 passed；浏览器实测见上表。

未运行 / 已知偏差：① 未跑 `pnpm build`、`pnpm check:docs`、`check:frontend:boundaries`、全量 web 单测与 API 测试；② 标题内缩 10px 只作用于任务聚合组，模块页/功能页/记录页的区块标题仍是与卡片外沿齐平（实测 `/projects/2/modules` 的「模块」标题 `x=270`），全站是否统一待定；③ 聚合组列表在 1000px 断点以上固定两列，不再随宽度自动增列；④ 样式改动需非作者人工评审。

> 2026-09-21 更新：产品定案把「任务聚合组」改为任务卡片与任务卡片同网格混排（见文末「任务聚合组改为任务卡片混排」章节），本章节的 `.group-panel` / `.group-list` / `.group-card` 区块、标题内缩 10px 与固定两列口径随之作废；`.calm-section-title` 的其它样式不受影响。

## 任务中心统计卡标签对齐与字号（C，2026-09-20 本地落库）

用户定案：四张统计卡的标签（今日待办 / 未完成 / 已完成 / 我创建的）先对齐，再加大加粗；对照模拟后选中 16px/700，并要求文案块整体「往右下挪一点点」，最终定案右 3px / 下 3px。

锁定口径：

- 病根是垂直居中而不是字号：`.stat-card` 原为 `align-items: center`，第一张卡的提示文案（逾期 0 · 遗留 0 · 紧急 0 · 7 天内 0）在窄窗口折成两行，这一卡的文案块变高 16.5px，整块被居中顶上去 8px —— 四张卡的标签因此不在同一水平线上。
- 修法：`inpulse-design.css` 的 `.stat-card` 改为 `align-items: flex-start`（文案块顶部锚定，提示折几行都不再影响标签行）；`.stat-card .stat-icon { align-self: center }` 让彩色图标块仍垂直居中。
- 字号：`.stat-card .stat-body > span` 由 11px/400 `#79899b` 改为 16px/700 `#3b4d61`；数字仍 25px、提示仍 11px。
- 位移：`.stat-body { position: relative; left: 3px; top: 3px }`，相对位移不改变卡片高度、也不影响图标居中。
- 选择器必须写成 `.stat-card .stat-body > span`：design-system.css 的 `.stat-card span:not(.stat-icon)` 特异性为 (0,2,1)，低特异性写法（`.stat-body > span`，(0,1,1)）会被它盖掉。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| STATCARD-ALIGN-BROWSER-001 | 浏览器实测 | 复现对齐问题 | 1300px 视口 `/tasks?view=list&today=0`：今日待办标签卡内 y=19（提示 2 行），未完成 / 已完成 / 我创建的均为 y=27（提示 1 行） | 本地通过 |
| STATCARD-ALIGN-BROWSER-002 | 浏览器实测 | 改动后四卡对齐 | 同页 1300px：四卡标签均 x=71 / y=22，卡高 143px；1780px：四卡标签均 x=71 / y=22，卡高 126px；标签计算样式 `16px/700 rgb(59, 77, 97)` | 本地通过 |
| STATCARD-ALIGN-WEB-001 | Web 单元 | 任务中心渲染不回归 | `pnpm --filter @inpulse/web exec vitest run src/features/my-tasks`：5 文件 81 例通过 | 本地通过 |
| STATCARD-ALIGN-GATE-001 | 静态门禁 | 类型与格式 | `pnpm --filter @inpulse/web exec tsc --noEmit -p tsconfig.json` 退出码 0；`pnpm lint`、`pnpm format:check` 通过 | 本地通过 |

本地实际执行（2026-09-20）：`pnpm format:check`、`pnpm lint` 通过；web 单测 5 文件 81 例通过；浏览器实测见上表（无头 Chromium，本地 dev `5173`，用本机测试账号登录）。

未运行 / 已知偏差：① 未跑 `pnpm build`、`pnpm check:docs`、`check:frontend:boundaries`、Playwright E2E 与 API 测试（本次只改 CSS，未动 TSX、文案与接口）；② 「今日待办」的提示文案在窄窗口仍折成两行，只是折行不再影响对齐，是否缩短文案待产品确认；③ 「今日待办」标签左起实测 69px、其余三卡 71px，2px 差来自「今」字自身的字形左侧边距，未做补偿；④ 图标仍是垂直居中（未改成与文案块顶部对齐）；⑤ 样式改动需非作者人工评审。

## 模块卡图标居中与旧版遗留规则清理（C，2026-09-20 本地落库）

产品反馈：模块页卡片左上角紫色方块里的图标没居中（贴左上角）。

锁定口径：

- 根因不是图标本身，而是 design-system.css 里旧版模块卡的 `.module-card div/strong/span/small` 元素选择器仍在：`.module-card span { display: block; color: #8493a3; font-size: 10px }` 的特异性 (0,1,1) 高于 `.feature-symbol`（(0,1,0)）的 `display: inline-flex` + `justify-content/align-items: center`，图标容器被降级为 `block`，21×21 的 svg 因此落在 43×43 方块的左上角。
- 这 5 条规则针对的旧结构（`.module-card` 的直接子 `strong/span/small` 与文本 `div`）在新的 `.calm-feature-card.module-card` 里已不存在，仅剩泄漏作用，因此整块删除并在原位留注释；`.module-card` 类名本身保留（`.catalog-module-wrap > .calm-feature-card.module-card` 仍按它定位）。
- 一并被修掉的泄漏：徽章（`10px` 灰字 → `11px` 琥珀字）、`.task-id` 编号色（`#8493a3` → `#788ea6`），两者均恢复到与功能卡一致的计算样式。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| MODULE-ICON-CENTER-001 | 浏览器实测 | 影响面预演 | 运行时用 CSSOM 删除这 5 条规则：`.feature-symbol` 由 `display:block`（svg 偏移 0,0）变为 `flex`（11,11）；徽章 `10px / rgb(132,147,163)` → `11px / rgb(134,91,13)`；`.task-id` `rgb(132,147,163)` → `rgb(120,144,166)` | 本地通过 |
| MODULE-ICON-CENTER-002 | 浏览器实测 | 落库后模块卡图标居中 | `/projects/2/modules` 两张模块卡：图标容器 `display:flex`、svg 相对方块偏移 `11,11`（方块 43×43），卡高 237px | 本地通过 |
| MODULE-ICON-CENTER-003 | 浏览器实测 | 与功能卡一致 | `/projects/2/modules/9/features` 同类容器同为 `display:flex`、偏移 `11,11`；徽章与编号色两页逐项一致 | 本地通过 |
| MODULE-ICON-CENTER-WEB-001 | Web 单元 | 模块页渲染不回归 | `pnpm --filter @inpulse/web exec vitest run src/features/modules`：1 文件 16 例通过 | 本地通过 |

本地实际执行（2026-09-20）：`pnpm format:check` 通过；web 单测 `src/features/modules` 16 例通过；浏览器实测见上表（无头 Chromium，本地 dev `5173`）。

未运行 / 已知偏差：① 未跑 `pnpm build`、`pnpm check:docs`、`check:frontend:boundaries`、`pnpm lint`、`tsc`、Playwright E2E 与 API 测试（本次只删 CSS 规则、未动 TSX 与文案）；② 模块卡标题仍是蓝色 `#317abd`（同一旧规则块里保留的 `.module-card { color: #317abd }` 继承到 `h2`），功能卡标题为深色 `#132238`，是否统一已给对照图待产品确认；③ 模块卡高度由 232px 变为 237px，来自徽章恢复 11px 字号；④ 样式改动需非作者人工评审。

## 模块卡与功能卡标题统一为深色（C，2026-09-20 本地落库）

产品定案：上一节遗留的「模块卡标题蓝 `#317abd` / 功能卡标题深色 `#132238`」需要统一。先按「统一蓝色」实现并给过真实渲染对照，产品看过后改判为深色，最终统一到 `#132238`。

锁定口径：

- 差异来源只有一处：`.module-card { color: #317abd }` 这份旧版遗留声明被卡内 `h2` 继承；功能卡的 `.calm-feature-card h2` 没有自己的颜色，落到全局 `--card-foreground: #132238`。
- 处理方式：删掉 `.module-card` 上这份会被继承的 `color`，让模块卡与功能卡标题一起走全局前景色；改完 `#317abd` 在应用代码里不再出现（仅 `.module-card` 上方注释留档说明）。
- `.calm-feature-card` 全仓只用于模块卡与功能卡两处（`ModulesPageView.tsx`、`FeaturesPageView.tsx`），本次不额外给 `h2` 写颜色，因此项目卡标题与任务卡标题（`.calm-task-card h3` 的 `#243d54`）保持原样。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| CARDTITLE-DARK-001 | 浏览器实测 | 改动前基线 | `/projects/3/modules` 模块卡 `h2` = `rgb(49, 122, 189)`；`/projects/3/modules/3843/features` 功能卡 `h2` = `rgb(19, 34, 56)` | 本地通过 |
| CARDTITLE-DARK-002 | 浏览器实测 | 改动后四处一致 | 模块卡 `h2`、功能列表页功能卡 `h2`、模块详情页（`/projects/2/modules/9/features`）功能卡 `h2`、项目卡 `h2` 全部为 `rgb(19, 34, 56)` | 本地通过 |
| CARDTITLE-DARK-003 | 浏览器实测 | 卡内其它文字不受影响 | 逐元素比对改动前后的计算颜色：编号 `rgb(120,144,166)`、说明 `rgb(100,124,146)`、页脚 `rgb(132,146,161)`、徽章与图标块颜色全部未变；仅模块卡容器自身继承色由 `rgb(49,122,189)` 回落为 `rgb(19,34,56)`，其子元素各有显式颜色故无视觉影响 | 本地通过 |
| CARDTITLE-DARK-WEB-001 | Web 单元 | 相关页面渲染不回归 | `pnpm --filter @inpulse/web exec vitest run src/features/modules src/features/features src/features/my-tasks src/features/tasks`：12 文件 164 例通过 | 本地通过 |
| CARDTITLE-DARK-GATE-001 | 静态门禁 | 类型、风格与文档 | `pnpm typecheck`（8 个 workspace）、`pnpm lint`、`pnpm format:check`、`pnpm check:docs` 通过 | 本地通过 |

本地实际执行（2026-09-20）：`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm check:docs` 通过；web 单测 12 文件 164 例通过；浏览器实测见上表（无头 Chromium，本地 dev `5173`，用本机测试账号登录）。

未运行 / 已知偏差：① 未跑 `pnpm build`、`check:frontend:boundaries`、Playwright E2E 与真实 PostgreSQL 集成测试（本次只改 CSS 一条声明，未动 TSX、文案与接口）；② 上一节《模块卡图标居中与旧版遗留规则清理》「未运行 / 已知偏差」第 ② 条的待确认项已由本次定案关闭，该历史条目按日志规则不改写；③ 卡片标题颜色现在依赖全局 `--card-foreground` 继承，若后续有卡片需要标题异色，应显式声明而不是复用 `.module-card` 这类容器级 `color`；④ 样式改动需非作者人工评审。

## 任务中心「遗留问题」入口改为就地弹窗（C，2026-09-20 本地落库）

产品反馈：任务中心页头的「遗留问题」入口点击后整页跳到 `/issues`，要求与项目主页一样就地弹窗。

锁定口径：

- 入口只有一处：`TasksPage` 的 `onOpenIssues` 同时供页头按钮与「N 条遗留问题尚未闭环」风险条使用，因此改成弹窗后两处同时生效，`TaskCenterPageView` 的 props 契约与视图代码不变。
- 弹窗复用项目主页同一套模式：`AppModal size="xl"` + `.project-workspace-modal` / `.project-workspace-modal-body` + `SearchParamsScope` 包住按需加载的 `IssuesPageView embedded`——与 `/issues` 整页是同一份 F-20 视图（含「转为任务」的 CSRF、`If-Match` 与幂等语义），不另写一份。
- 项目筛选跟随任务中心当前筛选（打开时把 `filters.projectId` 写进弹窗作用域的初始地址），与页头计数同口径：R-3 的 `leftoverCount` 本身就按 `projectId` 收窄。弹窗内切项目只改弹窗本地作用域，不写浏览器地址栏。
- 弹窗内的来源 / 跟进任务入口继续走 `handleOpenTask`，与任务卡片同一路径：在当前页面叠开功能档案同款任务详情弹窗，不跳转；两层都是 `AppModal`，Esc 只关栈顶。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| F32-ISSUES-MODAL-WEB-001 | Web 单元 | 入口就地弹窗且地址不变 | `pages/tasks/TasksPage.test.tsx`：点击「遗留问题」后出现 `role=dialog` 且无障碍名称为「遗留问题」的弹窗（内含 `issues-page`），`location-probe` 的 pathname + search 与点击前完全一致；测试路由表不再声明 `/issues` 占位路由 | 本地通过（该文件 8 例） |
| F32-ISSUES-MODAL-E2E-001 | Playwright | 真实浏览器关键路径 | `apps/e2e/tests/aggregate-views.spec.ts` 例 1：`/tasks` 点击「遗留问题」→ 弹窗可见且 `issues-page` 在弹窗内可见 → 地址栏与点击前完全相同 → 点「关闭遗留问题」后弹窗消失、仍在任务中心 | 本地通过（定向 1 例；`vite build && vite preview` 的生产构建，非 dev server） |

本地实际执行（2026-09-20）：`corepack pnpm --filter @inpulse/web exec vitest run src/pages/tasks/TasksPage.test.tsx` 8/8（4.5s）；`$env:E2E_DATABASE_URL=postgresql://cluster_bootstrap@127.0.0.1:55432/app; corepack pnpm --filter @inpulse/e2e exec playwright test aggregate-views.spec.ts -g "F-32"` 1 passed（10.7s），`global-teardown` 已清理夹具（删除用户 2、项目 2、业务行 60、审计行 2）；`corepack pnpm exec prettier --check`（本文档、`开发日志.md` 与三个改动文件）通过；`corepack pnpm exec eslint`（三个改动文件）退出码 0；`corepack pnpm --filter @inpulse/web exec tsc --noEmit` 与 `corepack pnpm --filter @inpulse/e2e exec tsc --noEmit` 均退出码 0；`pnpm check:docs`（84 个 Markdown）通过。

未运行 / 已知偏差：① 未跑 `pnpm test:web` 全量、`pnpm build`、`pnpm typecheck`（全 workspace）、`check:frontend:boundaries` 与 API / 集成测试（本次只改 `apps/web` 页面容器、`TasksPage.test.tsx` 与 E2E 断言，未动契约、权限与数据库）；② `/issues` 整页路由与侧栏「遗留问题」入口保持不变，仍可整页访问；③ 弹窗内不显示项目选择器（沿用 `IssuesPageView embedded` 的既有口径，与项目主页弹窗一致），换项目需关闭弹窗后在任务中心改筛选；④ 弹窗内视图为懒加载 chunk，单测需 `findByTestId` 等到 chunk 就绪后再断言；⑤ 前端改动需非作者人工评审。

## 添加项目成员改为可搜索下拉（C，2026-09-20 本地落库）

产品反馈（附「添加项目成员」弹窗与「指派给」下拉两张截图）：添加新成员原来是复选框候选列表，要求改成下拉框加搜索，样式对齐「指派给」的成员选择器。本轮为纯前端交互替换，未改契约、权限、数据库与后端。

锁定口径：

- 控件换成既有 `CalmSelect appearance="member"`（与「指派给」同一个组件）：`appearance="member"` 按组件既有规则默认开启搜索（`withSearch = searchable ?? appearance === "member"`），过滤匹配 `label + " " + description`，因此按姓名与身份说明都能搜到；头像、说明与选中对勾由组件统一渲染，不新写样式。
- 候选来自原有 `addCandidates`（用户目录减去当前活跃成员），不再改口径：`options` 为 `{ value: user.id, label: user.name, avatarUrl, description: user.isAdmin ? "系统管理员" : "启用用户" }`——身份说明由原先拼接在姓名后的「· 系统管理员 / · 启用用户」改为选项副标题。
- 选中态与提交链路不变：仍用 `selectedUserId` 单一状态，底部「添加成员」仍按 `selectedUserId === null` 禁用，`submitAdd()` 仍先签发 CSRF Token 再带 `x-csrf-token` 与幂等键调用 `addProjectMember`；加载中 / 目录错误 / 无可添加用户三个分支的文案与顺序保持原样。
- 只替换添加成员弹窗：同页「设置项目角色」弹窗仍用 `.member-candidate-list` + `.check-list` 单选列表；`创建项目` 弹窗的初始成员当时仍是 `选择成员：<姓名>` 复选框，已在后续批次一并换成同款多选下拉（见下一节）。
- 无障碍名从复选框的 `选择成员：<姓名>` 改为下拉触发器的 `ariaLabel="选择要添加的用户"`；`<label htmlFor="project-member-candidate">选择用户</label>` 提供可见标签。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| F05-MEMBER-ADD-SELECT-WEB-001 | Web 单元 | 下拉可搜索并提交正确 userId | `ProjectMembersPageView.test.tsx`：打开「添加项目成员」后在「选择要添加的用户」下拉中输入「新」→ 不匹配的候选「旧同事」不再可定位（`queryByTitle` 为 null）→ 点选「新成员」→ 点「添加成员」→ `addProjectMember(7, { userId: 3 })` 仅调用一次且带 `x-csrf-token` 与 `project-member-add-` 前缀的 `Idempotency-Key`，随后出现「成员已添加，项目成员列表已更新。」 | 本地通过（该文件 6 例） |
| F05-MEMBER-ADD-SELECT-E2E-001 | Playwright | 真实浏览器成员添加关键路径 | `apps/e2e/tests/project-members.spec.ts` 例 2：管理员登录 → `/projects/:id/members` 点「添加成员」→ 在「添加项目成员」弹窗内用 `pickCalmSelectOption` 打开「选择要添加的用户」下拉并按姓名点选 → 点「添加成员」→ 出现成功提示与「活跃成员」徽标；后续移除流程与不存在项目读取边界断言不变 | 本地通过（该文件 2/2，8.0s） |

本地实际执行（2026-09-20）：`corepack pnpm --filter @inpulse/web exec vitest run src/features/projects/ProjectMembersPageView.test.tsx` 6/6（3.10s）；`$env:E2E_DATABASE_URL=postgresql://cluster_bootstrap@127.0.0.1:55432/app; corepack pnpm --filter @inpulse/e2e exec playwright test project-members.spec.ts` 2 passed（8.0s，`vite build && vite preview` 的生产构建），`global-teardown` 已清理夹具（删除用户 3、项目 2、业务行 53、审计行 2）；`corepack pnpm exec prettier --check`（3 个改动文件）与 `corepack pnpm exec eslint`（3 个改动文件）均退出码 0；`corepack pnpm --filter @inpulse/web exec tsc --noEmit -p tsconfig.json` 与 `corepack pnpm --filter @inpulse/e2e exec tsc --noEmit -p tsconfig.json` 均退出码 0。

未运行 / 已知偏差：① 未跑 `pnpm test:web` 全量、`pnpm build`、全 workspace `pnpm typecheck`、`check:frontend:boundaries` 与 API / 集成测试（本次只改 `apps/web` 一个页面文件、其单测与 E2E 交互方式，未动契约、权限、数据库与后端）；② `ProjectMembersPageView` 上仍保留 `.member-candidate-list` / `.check-list` 样式（「设置项目角色」弹窗继续使用），本轮只删除添加成员弹窗对这两个类的使用；③ 未在浏览器手工登录复验界面外观（本地 dev 会话被并发操作影响，登录返回「登录请求与当前浏览器不匹配」），外观结论来自真实浏览器 E2E 通过而非人工截图比对，配色/间距若需像素级对齐设计师稿仍需产品确认；④ 前端改动需非作者人工评审。

## 创建项目初始成员改为可搜索多选下拉（C，2026-09-20 本地落库）

承接上一节：产品要求「新建项目里面初始成员也要改」，因此「新建项目」弹窗的初始成员选择由逐人复选框（`选择成员：<姓名>`）换成与「添加项目成员」「指派给」同一个 `CalmSelect`。纯前端交互替换，未改契约、权限、数据库与后端。

锁定口径：

- 组件形态为 `multiple`：`CalmSelect` 增加判别联合的 `multiple: true` 分支（数组 `value`、`maxTagCount` 默认 2、根节点加 `calm-select-multiple`），每段标签仍走 `labelRender`（头像 + 姓名），触发器内保留原生搜索 input（`.ant-select-input`）以支持输入过滤；`calm-select.css` 为此复位该 input 在宿主表单里的边框、内边距与聚焦光环。
- 弹窗内的候选、排除创建者、受控状态与提交链路全部不变：候选仍是用户目录里的启用用户（选项说明沿用「系统管理员 / 项目成员」），创建者仍自动成为活跃成员且在创建流程中不可取消，提交仍复用既有 `memberIds` 字段，底部提示仍是「已选择 N 位其他成员」。
- 无障碍名从 `选择成员：<姓名>` 改为触发器的 `ariaLabel="选择初始成员"`，可见标签为 `<label htmlFor="project-member-candidates">选择成员</label>`。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| F04-CREATE-MEMBER-MULTISELECT-WEB-001 | Web 单元 | 多选回调、标签折叠与提交载荷 | `CalmSelect.test.tsx` 新增 `multiple` 用例：连续点选按数组回调（`[5]` → `[5,7]` → `[5,7,9]`）、`.calm-select-multiple` 就位、`.ant-select-selection-item` 共 3 个且其中 1 个是 `+N` 折叠计数、原生搜索 input 保留；`CreateProjectModal.test.tsx`「sends several selected active members while excluding the creator」：展开「选择初始成员」→ 点选「开发者 B」「管理员 A」→ 出现「已选择 2 位其他成员」→ `createProject` 仅调用一次且 `memberIds` 为 `[2, 3]`（创建者 `1` 被排除）→ `onCreated` / `onClose` 各一次 | 本地通过（4 文件 22 例，4.78s；`CalmSelect.test.tsx` 单文件 6 例） |
| F04-CREATE-MEMBER-MULTISELECT-E2E-001 | Playwright | 真实浏览器创建项目关键路径 | `apps/e2e/helpers/calm-select.ts` 新增 `pickCalmSelectOptions`（按选项 title 依次点选后收起弹层），`helpers/project-create.ts`、`tests/project-create.spec.ts`、`tests/tasks.spec.ts` 由旧的 `getByLabel('选择成员：…').check()` 改为该辅助；`project-create.spec.ts` 在选中后仍断言「已选择 1 位其他成员」 | 本地通过：`tests/project-members.spec.ts`、`tests/project-create.spec.ts`、`tests/tasks.spec.ts` 共 4 passed（26.5s） |
| F04-CREATE-MEMBER-MULTISELECT-E2E-002 | Playwright | 复用 `createProjectViaUi` 的其余关键路径无回归 | `tests/activity.spec.ts`、`tests/audit.spec.ts`（2 例）、`tests/csrf.spec.ts`（4 例）、`tests/notifications.spec.ts`、`tests/project-archive.spec.ts`、`tests/record-feed.spec.ts` 全部经同一辅助创建项目 | 本地通过：10 passed（39.0s） |

多选弹层的收起方式与约束（`pickCalmSelectOptions` 收尾步骤）：

- Esc 不可用：`AppModal` 在 `document` 上以**捕获阶段**接管 Esc「只关栈顶弹层」，连整个弹窗一起关闭，表单输入一并丢弃；
- Tab 不可用：焦点会落进弹层自身，被 rc-select 的 `cancelFun`（`isInside`）判定为「仍在选择器内」而取消收起；
- 真实点击也不可用：弹层按空间向上翻转时会覆盖弹窗标题等候选落点，Playwright 判为「被 `<div class="ant-select-item-option-content">` 拦截 pointer events」并重试到超时（实测 `project-members.spec.ts` 例 2 卡到 180s 超时）；
- 因此改为把 `mousedown` 派发到作用域本身（antd Modal 外壳与 AppModal 盒子都带 `role="dialog"`，需 `.first()` 消除严格模式歧义）：目标在选择器之外，rc-select 的 `useSelectTriggerControl` 立即收起；`AppModal` 的「点盒子留白关闭」走的是 `click` 且判 `event.target === boxRef.current`，不受该派发影响。

本地实际执行（2026-09-20）：`corepack pnpm --filter @inpulse/web exec vitest run src/features/common/components/CalmSelect.test.tsx src/features/projects/CreateProjectModal.test.tsx src/features/projects/ProjectMembersPageView.test.tsx src/features/projects/project-member-query.test.tsx` 4 文件 22 例通过（4.78s）；`$env:E2E_DATABASE_URL=postgresql://cluster_bootstrap@127.0.0.1:55432/app; $env:E2E_API_PORT=3188; $env:E2E_WEB_PORT=4188; corepack pnpm --filter @inpulse/e2e exec playwright test tests/project-members.spec.ts tests/project-create.spec.ts tests/tasks.spec.ts --reporter=line` 4 passed（26.5s），随后 `playwright test tests/activity.spec.ts tests/audit.spec.ts tests/csrf.spec.ts tests/notifications.spec.ts tests/project-archive.spec.ts tests/record-feed.spec.ts --reporter=line` 10 passed（39.0s），`global-teardown` 已清理夹具（删除用户 4、项目 10、业务行 216、审计行 22）；`corepack pnpm --filter @inpulse/e2e exec tsc --noEmit -p tsconfig.json` 退出码 0。

未运行 / 已知偏差：① 未跑 `pnpm test:web` 全量、`pnpm build`、全 workspace `pnpm typecheck`、`check:frontend:boundaries`、API / 集成测试与 `pnpm check`（本批只改 `apps/web` 前端与 `apps/e2e`，未动契约、权限、数据库与后端）；② 同页「设置项目角色」弹窗仍是 `.member-candidate-list` + `.check-list` 单选列表；③ 本批未做浏览器手工外观复验，外观结论来自真实浏览器 E2E 通过；④ 夹具清理报告 SYSTEM 审计链在夹具记录之后已有真实写入，删除中段会留下可检测断点（夹具清理既有行为，非本批改动）；⑤ 前端与 E2E 改动需非作者人工评审。

## 侧栏与账户菜单的「成员与设置」入口改为系统管理员专属（产品要求，2026-09-21 本地落库）

产品要求（附侧栏截图，指向「全局」分组下的「成员与设置」）：「普通使用者也就是非系统管理员把这个成员与设置隐藏吧」。本批为前端可见性收敛：不改路由契约、Route Registry、数据库不变量、迁移、鉴权与幂等策略，后端零改动，`docs/permissions.md` 与 `packages/api-contract` 不受影响。

锁定口径：

- `AppLayout` 的 `NavigationItem` 新增 `adminOnly` 标记，「成员与设置」与「审计日志」两项都标记为 `adminOnly: true`；侧栏可见性过滤由 `item.key !== "audit"` 改为 `item.adminOnly !== true`，对「审计日志」行为等价，并覆盖新增的管理员专属项。
- 账户菜单内的「成员与权限」（同指 `/settings`）只在 `user.isAdmin` 为真时渲染；`CommandPalette` 新增 `isAdmin` 属性，「打开成员与设置」快捷命令对非管理员过滤，避免仅隐藏侧栏后仍可从命令面板直达。
- `/settings` 的既有门禁不变：路由保留 `requiresAuth` + 系统管理员守卫，普通成员用 URL 直达仍渲染「无权访问 / 此区域仅限系统管理员访问。」，`apps/e2e/tests/admin-users.spec.ts` 的既有断言（例 1）继续有效。
- 侧栏「当前项目」分组下的项目成员入口（`/projects/:projectId/members`）与项目主页的成员入口不受影响，那是项目级只读成员视图，普通成员按既有规则可访问。
- 面包屑 `sections` 中 `/settings → 成员与设置` 保留，管理员访问时仍显示。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| SHELL-ADMIN-ONLY-SETTINGS-UNIT-001 | Web 单元 | 侧栏对普通成员隐藏「成员与设置」 | `AppLayout.test.tsx`：默认（非管理员）渲染时 `queryByText("成员与设置")` 为空；管理员用例断言「审计日志」与「成员与设置」都可见，非管理员分支断言两者都不可见 | 本地通过 |
| SHELL-ADMIN-ONLY-SETTINGS-UNIT-002 | Web 单元 | 账户菜单不显示「成员与权限」 | `AppLayout.test.tsx` 新增用例：非管理员打开账户菜单后 `queryByRole("button", { name: /成员与权限/ })` 为空，「退出登录」仍可见 | 本地通过 |
| SHELL-ADMIN-ONLY-SETTINGS-UNIT-003 | Web 单元 | 命令面板按身份过滤快捷命令 | `CommandPalette.test.tsx` 新增用例：非管理员无「打开成员与设置」而仍有「打开任务中心」；`isAdmin` 为真时该命令出现 | 本地通过 |
| SHELL-ADMIN-ONLY-SETTINGS-E2E-001 | Playwright | 普通成员侧栏不出现该入口 | 未新增断言；既有 `admin-users.spec.ts` 例 1 仍覆盖「普通成员 `goto /settings` 显示无权访问」 | 未运行 |

本地实际执行（2026-09-21）：`corepack pnpm --filter @inpulse/web exec vitest run src/app/layout/AppLayout.test.tsx src/features/command-palette/CommandPalette.test.tsx` 2 文件 16 例通过（2.09s）；`corepack pnpm --filter @inpulse/web test` 83 文件 525 例通过（24.27s）；`corepack pnpm exec eslint`（4 个改动文件）退出码 0；4 个改动文件已 `prettier --write`。

未运行 / 已知偏差：① 未跑全 workspace `pnpm typecheck`：`apps/web` 的 `tsc -p tsconfig.json --noEmit` 在当前远端 `test` 提交上因 `apps/web/src/features/common/components/CalmSelect.tsx` 的 `mode={multiple ? "multiple" : undefined}` 与 `exactOptionalPropertyTypes` 冲突失败，经 `git show da80dbc:apps/web/src/features/common/components/CalmSelect.tsx` 对照确认该行由远端 `f8d3712` 引入，与本批改动无关，本批未修改；② 未跑 `pnpm build`、`check:frontend:boundaries`、API / 集成测试与整链 `pnpm check`；③ 未运行 Playwright E2E，本批未新增 E2E 断言；④ 本批改动尚未提交、推送，位于为启动远端最新 `test` 创建的干净检出 worktree；⑤ 前端改动需非作者人工评审。

## 草稿详情弹层标题排版对齐正式记录详情（产品要求，2026-09-21 本地落库）

产品要求（附草稿详情弹窗截图）：「这个草稿详情标题排版改一下」。本批为纯前端排版与标题层级收敛：不改路由契约、Route Registry、权限矩阵、数据库不变量、迁移、鉴权与幂等策略，后端零改动。

锁定口径：

- 根因一：设计系统里 `.drawer-header` 默认没有内边距，弹层头部排版由各弹层盒自己补（`.catalog-modal`、`.record-detail-modal`、`.project-picker-modal`、`.task-group-detail-modal` 各自补 `padding` 与 `border-bottom`）。草稿详情弹层此前没有给自己加类，所以「草稿详情」标题与关闭按钮顶到盒子边缘。
- 根因二：正文里还有一个与弹层标题同级的 `<h2>{记录标题}</h2>`，同一个弹层出现两个 h2，语义与视觉都在互相打架。
- 收敛方式对齐同页「正式记录详情」（`RecordDetailModal`）与任务详情（`TasksPanel` 的 `label="任务详情"`）：草稿详情弹层改为 `className="draft-detail-modal"` + `eyebrow="草稿"` + `title={记录标题}`，并用 `label="草稿详情"` 继续提供弹层无障碍名；正文去掉重复标题，首个区块直接是元信息（处理人 / 记录作者、项目 / 模块 / 功能），小节标题仍是 h3。
- CSS：新增 `.draft-detail-modal > .drawer-header { padding: 24px 28px 18px; border-bottom: 1px solid #e8eef5; flex-shrink: 0 }`，与 `.record-detail-modal > .drawer-header` 同值；删除只服务旧正文标题的 `.draft-detail h2` 规则（删除后用户 Markdown 里的 `## 标题` 回归 `.record-markdown h2`，不再被 17px 覆盖）。
- 既有无障碍名与 E2E 触点不变：弹层名仍是「草稿详情」，正文 `region 草稿详情` 与关闭按钮「关闭」都保留；只有 `record-feed.spec.ts` 里「标题在 region 内」的断言改为「标题在 dialog 内」，因为标题现在属于弹层头部。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| DRAFT-DETAIL-HEADER-WEB-001 | Web 单元 | 记录标题只在弹层头部出现一次 | `RecordDraftsView.test.tsx` 新增用例：以 `/records?projectId=1&recordId=7` 打开 `dialog 草稿详情` 后，头部有 `heading 支付修正 level 2` 与 `.detail-label` 文本「草稿」；正文 `region 草稿详情` 内 `queryByRole("heading", { name: "支付修正" })` 为 null，「改动原因」仍是 `level 3` | 本地通过（把该文件回写成 HEAD 旧实现重跑为 1 failed，确认用例能捕获旧排版） |
| DRAFT-DETAIL-HEADER-E2E-001 | Playwright | 真实浏览器下草稿详情与既有流程不回归 | `record-feed.spec.ts` 1 passed（11.8s）；`record-drafts.spec.ts` + `external-links.spec.ts` 5 passed（31.4s） | 本地通过 |

本地实际执行（2026-09-21）：`pnpm --filter @inpulse/web exec vitest run src/features/record-drafts/RecordDraftsView.test.tsx` 10/10（3.63s）；`pnpm --filter @inpulse/web test` 83 文件 526 例通过（25.11s）；`pnpm exec eslint`（2 个改动文件）退出码 0，`prettier --write`（3 个改动文件）已执行；真实浏览器核对用仓库内 Playwright 的 chromium 登录本地 dev（web :5173 + API :3000）打开 `/records?projectId=1&recordId=47`，读到的计算样式为头部 padding `24px 28px 18px`、`border-bottom 1px rgb(232, 238, 245)`、眉标「草稿」、h2 = 记录标题（18px）、正文只剩 h3 小节，`dialog 草稿详情` 计数 1 且包含标题文本，`region 草稿详情` 与关闭按钮「关闭」都在；`E2E_DATABASE_URL=postgresql://cluster_bootstrap@127.0.0.1:55432/app; pnpm --filter @inpulse/e2e exec playwright test record-feed.spec.ts --reporter=line` 1 passed（11.8s，夹具清理：删除用户 2、项目 3、业务行 72、审计行 4）；同法 `playwright test record-drafts.spec.ts external-links.spec.ts` 5 passed（31.4s，夹具清理：删除用户 2、项目 2、业务行 167、审计行 23）。

未运行 / 已知偏差：① 未跑全 workspace `pnpm typecheck`：`apps/web` 的 `tsc -p tsconfig.json --noEmit` 在当前远端 `test` 提交上因 `apps/web/src/features/common/components/CalmSelect.tsx` 的 `mode={multiple ? "multiple" : undefined}` 与 `exactOptionalPropertyTypes` 冲突失败，该行由远端 `f8d3712` 引入，与本批改动无关，本批未修改；② 未跑 `pnpm build`、`check:frontend:boundaries`、`pnpm check`、API 与数据库集成测试（本批只改 `apps/web` 的样式与标题层级、其单测和一条 E2E 断言）；③ 未做像素级设计师稿比对，间距与分隔线颜色直接沿用 `.record-detail-modal > .drawer-header` 同值；④ 本批改动尚未提交、推送，位于为启动远端最新 `test` 创建的干净检出 worktree；⑤ 前端与 E2E 改动需非作者人工评审。

## 草稿编辑器入口改名与影响功能改多选下拉（产品要求，2026-09-21 本地落库）

产品要求（附「新建独立草稿」弹窗与影响功能勾选区两张截图）：「新建独立草稿改为新建迭代记录」「影响功能改成类似选择成员那样的多选」。本批为纯前端改动：不改契约、Route Registry、权限矩阵、数据库不变量、迁移、鉴权与幂等策略，后端零改动。

锁定口径：

- 改名范围只有「新建独立草稿」这一处：`RecordDraftsView` 的页头 CTA 文案与 `RecordDraftEditorModal` 的弹层 `title` 同时改为「新建迭代记录」。「新建来源草稿」「编辑草稿」「我的草稿」「草稿详情」等其它草稿文案与来源任务分支都不动。
- 弹层无障碍名沿用 `title`，因此同步改名；受影响的是 1 个 Web 单测文件与 5 个 Playwright 规格里的定位器（`新建独立草稿` → `新建迭代记录`）。
- 「影响功能」由原生复选框列表改为 `CalmSelect` 多选：`multiple` + `searchable` + `appearance="rich"` + `width="100%"`，`value` 仍是既有的 `impacts: number[]`，`onChange` 走 `next.map(Number)`，选项沿用 `disabled: f.status !== "ACTIVE"`。
- 原实现的缺陷：字段直接渲染 `<label><input type="checkbox"/>{名称}</label>`，`.calm-form input` 的 `width: 100%; min-height: 34px` 把复选框拉成整行 34px 高、复选框图形漂到行中间，7 个功能占 419px。改后 fieldset 高度 52px。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| DRAFT-IMPACT-SELECT-WEB-001 | Web 单元 | 入口改名后仍能打开弹层并保存草稿 | `RecordDraftsView.test.tsx`：`new-iteration` 名称下 `findByRole("button", { name: "新建迭代记录" })` 与 `findByRole("dialog", { name: "新建迭代记录" })` 均可定位，原有校验与创建用例保持通过（该文件 10 例） | 本地通过 |
| DRAFT-IMPACT-SELECT-E2E-001 | Playwright | 真实浏览器下改名与多选不影响既有流程 | `record-drafts.spec.ts`、`record-feed.spec.ts`、`record-publishing.spec.ts`、`record-lifecycle.spec.ts`、`external-links.spec.ts` 共 9 passed（58.2s） | 本地通过 |

本地实际执行（2026-09-21）：`pnpm --filter @inpulse/web exec vitest run src/features/record-drafts` 10/10（3.56s）；`pnpm --filter @inpulse/web test` 83 文件 526 例通过（24.06s）；`pnpm exec eslint`（2 个改动文件）退出码 0，`prettier --write`（改动文件）已执行；真实浏览器（仓库内 Playwright chromium + 本地 dev web :5173 / API :3000）：`/records?projectId=1` → 「新建迭代记录」→ 所属模块「平台与访问」，实测弹层标题「新建迭代记录」、影响功能全宽多选框 782×32、fieldset 高度 419px → 52px、未选占位「输入功能名称搜索，可多选」、连选 3 项后标签「用 用户登录与会话管理」「数 数据安全专项（数据库角色、CSP、SSRF、Secrets）」「+ 1 ...」、下拉项右侧对已选项显示勾、触发器内搜索 input 边框与内边距为 0；`E2E_DATABASE_URL=postgresql://cluster_bootstrap@127.0.0.1:55432/app; pnpm --filter @inpulse/e2e exec playwright test record-drafts.spec.ts record-feed.spec.ts record-publishing.spec.ts record-lifecycle.spec.ts external-links.spec.ts --reporter=line` 9 passed（58.2s，夹具清理：删除用户 3、项目 3、业务行 291、审计行 42）。

未运行 / 已知偏差：① 未跑全 workspace `pnpm typecheck`：`apps/web` 的 `tsc` 在当前远端提交上因 `CalmSelect.tsx` 的 `mode={multiple ? "multiple" : undefined}` 与 `exactOptionalPropertyTypes` 冲突失败（`f8d3712` 引入，与本批无关）；② 未跑 `pnpm build`、`check:frontend:boundaries`、`pnpm check`、API 与数据库集成测试（本批只改 `apps/web` 的一个弹层与文案、其单测和 5 个 E2E 定位器）；③ `pnpm format:check` 在当前分支对 8 个与本批无关的文件报格式问题（`apps/e2e/tests/tasks.spec.ts`、`apps/web/src/features/common/components/calm-select.css`、`CalmSelect.tsx`、`task-tone.ts`、`CreateProjectModal.test.tsx`、`project-member-query.test.tsx`、`ProjectMembersPageView.test.tsx`、`ProjectMembersPageView.tsx`），`git log` 确认全部由 `f8d3712` 引入，本批未修改；④ 任务侧的同名影响功能勾选区（`TasksPanel`、`GlobalTaskCreateModal` 的 `.task-impact-features`）本批未改，仍是原生复选框；⑤ 前端与 E2E 改动需非作者人工评审。

## CalmSelect 多选下拉的重复选中勾修复（产品要求，2026-09-21 本地落库）

产品要求（附「影响功能」多选下拉截图）：「这张图和上张图不知道为甚，末尾都是两个打勾，只要一个就行了可以稍微粗一点」。本批为纯前端选中态修复：不改契约、Route Registry、权限矩阵、数据库不变量、迁移、鉴权与幂等策略，后端零改动。

锁定口径：

- 根因：`CalmSelect` 用 `optionRender` 自己渲染选中勾（`.calm-select-check`），而 antd 6 在 `multiple` 模式下经 `useIcons` 额外渲染自带 `CheckOutlined`（`mergedItemIcon = fallbackProp(menuItemSelectedIcon, contextMenuItemSelectedIcon, multiple ? <CheckOutlined/> : null)`），两个勾叠加成一个选项两个勾。antd 的 `fallbackProp` 取第一个非 `undefined` 的值，因此显式传 `menuItemSelectedIcon={null}` 才会覆盖默认值（传 `undefined` 会退回默认图标）。关掉后选中态统一由 `.calm-select-check` 表达；单选形态本来就拿 `null`，行为不变。
- 加粗：`.calm-select-check` 增加 `stroke-width: 2.6`。勾是 `InpulseIcon`，SVG 上的 `strokeWidth={1.7}` 是表现属性，优先级低于任何作者 CSS 规则，因此该声明生效、内部 `path` 通过继承得到 `2.6px`；尺寸不变（14×14），只是「稍微粗一点」。
- 影响面：`CalmSelect` 是共用组件，所有 `multiple` 形态（影响功能、成员多选等）都会少掉重复的勾；menu / rich / member / notion 单选形态渲染结果不变。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| CALM-SELECT-SINGLE-CHECK-UNIT-001 | Web 单元 | 多选已选项只剩一个勾 | `CalmSelect.test.tsx` 的 multiple 用例：3 个已选项各自 `.calm-select-check` 计 1，且 `.ant-select-item-option-state` 的 `innerHTML` 为 `""`（antd 自带图标已关） | 本地通过 |
| CALM-SELECT-SINGLE-CHECK-UNIT-002 | Web 单元（回归验证） | 断言能拦住重复勾 | 临时移除 `menuItemSelectedIcon={null}` 后同用例失败（1 failed / 5 passed），恢复后 6 例通过 | 本地通过 |
| CALM-SELECT-SINGLE-CHECK-E2E-001 | Playwright | 多选下拉的真实交互未回归 | `project-create.spec.ts`（选择初始成员）、`project-members.spec.ts`（选择要添加的用户）、`record-drafts.spec.ts`（影响功能 + 入口改名）6 passed（30.0s） | 本地通过 |
| CALM-SELECT-SINGLE-CHECK-BROWSER-001 | 真实浏览器实测 | 下拉里只剩一个勾且更粗 | Playwright chromium 登录本地 dev，`/records?projectId=1` → 新建迭代记录 → 所属模块「平台与访问」→ 影响功能连选 3 项：3 个已选项各 `checkCount = 1`、自带图标容器 `innerHTML` 为空、`.calm-select-check` 与其内部 `path` 的 `getComputedStyle(...).strokeWidth` 均为 `2.6px`、勾仍是 14×14，截图确认 | 本地通过 |

本地实际执行（2026-09-21）：`pnpm --filter @inpulse/web exec vitest run src/features/common/components/CalmSelect.test.tsx` 6/6（1.95s）；`pnpm --filter @inpulse/web test` 83 文件 526 例通过（23.83s）；`pnpm exec prettier --check apps/web/src/features/common/components/CalmSelect.test.tsx` 通过；把当前 `calm-select.css` 交给 prettier 格式化后，本批新增的注释与 `stroke-width: 2.6;` 逐字保持；`pnpm check:frontend:boundaries` 通过（279 模块 / 1363 依赖，无越界）；`pnpm check:docs` 通过（84 个 Markdown 文件）；真实浏览器实测见上表第 4 行（临时脚本与截图已删除，`git status` 无未跟踪残留）；`E2E_DATABASE_URL=postgresql://cluster_bootstrap@127.0.0.1:55432/app pnpm --filter @inpulse/e2e exec playwright test project-create.spec.ts record-drafts.spec.ts project-members.spec.ts --reporter=line` 6 passed（30.0s，夹具清理：删除用户 3、项目 3、业务行 124、审计行 14）。

未运行 / 已知偏差：① 未跑全 workspace `pnpm typecheck`：`apps/web` 的 `tsc` 在当前远端提交上只报 `CalmSelect.tsx(307,6)` 的 `mode={multiple ? "multiple" : undefined}` 与 `exactOptionalPropertyTypes` 冲突（`f8d3712` 引入，与本批无关），本批新增行无报错；② 未跑 `pnpm build`、`pnpm check`、Playwright E2E 全套（只跑了用到多选下拉的 3 个规格，其余规格未跑）与 API / 数据库集成测试（本批只改共用组件的一行属性、一条 CSS 声明与其单测）；③ `pnpm format:check` 在当前分支对 8 个与本批无关的文件报格式问题（`f8d3712` 引入），其中 `calm-select.css` 与 `CalmSelect.tsx` 含本批改动，为避免把既有格式问题混进本批 diff 未顺手重排；④ 本批只修 `CalmSelect` 多选下拉；任务侧的 `.task-impact-features` 仍是原生复选框，不存在重复勾；⑤ 前端改动需非作者人工评审。

## 侧栏目录树：展开项目不再遮挡其它项目（产品要求，2026-09-21 本地落库）

产品要求（附侧栏「当前项目」截图）：「我希望这个下拉条只属于其中一个项目，理想状态是点击项目列表下方展示所有项目，打开其中一个项目会展开项目的模块列表，但是即使展开状态所有项目依旧是展示的不会被隐藏」。本批为纯样式改动：只改 `apps/web/src/styles/design-system.css` 的项目树罗列区与展开内框，不改契约、Route Registry、权限矩阵、数据库不变量、迁移、鉴权与幂等策略，TS 组件与后端零改动。

锁定口径：

- 症状：`.project-tree-scroll` 原先整块 `max-height: 264px; overflow-y: auto`，展开一个项目后模块列表把其它项目行推到 264px 之外，只能在罗列区里滚动才能看见，观感上等于「被隐藏」。实测 `/projects/1/modules`：罗列区可视区 233–497px，项目 1 行 233–265px，其它两个项目行在 630–662 / 677–709px，`scrollHeight 478 > clientHeight 264`。
- 改法：罗列区不再整块限高（`.project-tree-scroll { overflow: visible }`），所有项目行始终完整展示；滚动下沉到被展开项目自己的内框（`.project-tree-scroll > .tree-project > .tree-children { max-height: 260px; overflow-y: auto }`），因此滚动条只属于被打开的那个项目，其它项目行不会被展开内容顶走。
- 展开高度的取值：产品反馈「展开太高」后先由 42vh 收矮到 32vh（900px 视口 288px），再按像素值定为 260px；子树内容超出时在项目内框里滚动（项目 1 的模块层 344px、展开模块看功能时 464px，内框固定 260px）。
- 手风琴语义不变：同一时刻只展开一个项目，`ProjectTree` 的既有展开副作用与 `ProjectTree.accordion.test.tsx` 未改。
- 取代 2026-09-15 章节的「罗列区 264px 限高」实现说明：该章节记录的是当时的实现与实测，本批按产品要求把限高下沉到项目内框。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| SIDEBAR-TREE-VISIBLE-UNIT-001 | Web 单元 | 展开一个项目后其它项目行仍在树里 | `ProjectTree.test.tsx` 新增用例：展开 AGV 并铺开模块后 WMS 行仍在、AGV 行仍只有一份 | 本地通过 |
| SIDEBAR-TREE-VISIBLE-E2E-001 | Playwright | 展开项目不遮挡其它项目 | `visual-migration.spec.ts` 在项目页断言 `.project-tree-scroll` 里的项目行全部完整落在 `.nav-tree-panel` 盒内，且罗列区 `overflow-y` 为 `visible`、`scrollHeight === clientHeight` | 本地通过 |
| SIDEBAR-TREE-VISIBLE-E2E-002 | Playwright（回归验证） | 断言能拦住回退到整块限高 | 临时把 CSS 改回 `max-height: 264px; overflow-y: auto` 后同用例失败（`Expected "visible"` / `Received "auto"`），恢复后通过 | 本地通过 |

本地实际执行（2026-09-21）：`pnpm --filter @inpulse/web exec vitest run src/features/project-tree` 3 文件 12 例通过（1.50s）；`pnpm --filter @inpulse/web test` 83 文件 527 例通过（25.04s）；`pnpm --filter @inpulse/e2e typecheck` 退出码 0，改动文件的 `prettier --check` 与 `eslint` 通过；`E2E_DATABASE_URL=postgresql://cluster_bootstrap@127.0.0.1:55432/app pnpm --filter @inpulse/e2e exec playwright test visual-migration.spec.ts project-create.spec.ts aggregate-views.spec.ts --reporter=line` 4 passed（19.8s，夹具清理：删除用户 2、项目 4、业务行 90、审计行 4）；真实浏览器量测（Vite :5173，1220×900）：`/projects` 罗列区 128px 无滚动、三个项目行 233/280/327px 全可见；`/projects/1/modules` 面板 227–633px（406px 高）、罗列区 394px，三个项目行 233–265 / 546–578 / 593–625px 全部落在面板内，子树内框 260px（内容 344px）、`/projects/1/modules/3/features` 内框同样 260px（内容 464px，在框内滚动）。

未运行 / 已知偏差：① 未跑全 workspace `pnpm typecheck`（`apps/web` 只报远端 `f8d3712` 引入的 `CalmSelect.tsx(307,6)` 既有错误）、`pnpm build`、`pnpm check`、Playwright 全套与 API / 数据库集成测试；② 项目数量很多时罗列区会随内容变长、侧栏整体高度随之增加，超出视口时靠页面滚动，本批按「项目行优先完整展示」取舍，未改侧栏整体滚动结构；③ 260px 为本地量测并按产品反馈定下的固定值（不随视口变化），未做设计师稿比对；④ 前端与 E2E 改动需非作者人工评审。

## 侧栏项目树：滚动区收进模块列表并降到 200px（C，2026-09-21 本地落库）

产品在 11:01 那版（罗列区不再整块限高、滚动下沉到项目内框 260px）上复核后提两点：滚动区只该属于被展开的那一个项目；高度由 260px 改为 200px。

锁定口径：

- 滚动范围：`.project-tree-scroll > .tree-project > .tree-children` 去掉 `max-height: 260px` 与 `overflow-y: auto`，滚动下移到只包模块列表的 `.tree-modules`（`max-height: 200px`，并以 `flex: none` 防止模块分支被压扁）；两个子页行「任务看板 / 模块与功能」留在滚动区之外。
- 与上一版的关系：外层罗列区 `overflow: visible`（项目行全部展示）的口径不变，11:01 章节里「内框 260px」的口径由本章节取代。
- `ProjectBranch` 把 `<ModuleList>` 包进 `<div className="tree-modules">`，作为上述 CSS 的 DOM 契约。
- 手风琴语义（同一时刻只铺开一个项目）、接口、契约、数据库与权限矩阵均未改。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| SIDEBAR-TREE-MODULES-001 | Web 单元 | 滚动区 DOM 契约 | `ProjectTree.test.tsx` 新增用例：模块列表位于 `.project-tree-scroll > .tree-project > .tree-children > .tree-modules` 内，且「模块与功能」子页行不在该滚动区内 | 本地通过 |
| SIDEBAR-TREE-MODULES-002 | 浏览器实测 | 模块区高度与滚动 | `/projects/1/modules`：`.tree-modules` 高 200px、内容 272px 自行滚动，8 个模块里 5 个完整可见；`/projects/1/modules/2/features/2` 内容 482px 时同样 200px | 本地通过 |
| SIDEBAR-TREE-MODULES-003 | 浏览器实测 | 子页行与项目行不被滚走 | 同一页：罗列区 `406x406`、`overflow-y: visible`、无外层滚动；三个项目行都落在 `.nav-tree-panel` 内；子页行 y 271–303 / 305–337 在模块区之外 | 本地通过 |
| SIDEBAR-TREE-MODULES-004 | Web 单元 | 全量前端不回归 | `pnpm --filter @inpulse/web test`：83 文件 528 例通过 | 本地通过 |
| SIDEBAR-TREE-MODULES-GATE-001 | 静态门禁 | 类型与风格 | `pnpm --filter @inpulse/web typecheck`、改动文件 `prettier --check` 与 `eslint` 通过 | 本地通过 |

本地实际执行（2026-09-21，干净检出 worktree detached 于 `a3ee0ce`）：`pnpm --filter @inpulse/web exec vitest run src/features/project-tree` 3 文件 13 例通过；`pnpm --filter @inpulse/web test` 83 文件 528 例通过；`pnpm --filter @inpulse/web typecheck` 退出码 0；改动文件 `prettier --check`、`eslint` 通过；浏览器量测用本工作树自带的 Vite（:5199，代理到既有 API :3000）与无头 Chromium 完成，未新增或修改业务数据。

未运行 / 已知偏差：① 未跑 `pnpm build`、`pnpm check`、`check:deps`、`permissions:check`、Playwright 全套与 API / 数据库集成测试；② 项目很多时罗列区随内容变长、超出视口靠页面滚动（沿用上一版取舍）；③ 200px 为产品在浏览器里复核的值，未与设计稿标注逐项比对；④ 模块展开后的功能行也在同一 200px 区内滚动，功能层独立限高需另开需求；⑤ 前端与单测改动需非作者人工评审。

## 迭代记录草稿箱去重与卡片尺寸对齐任务卡（C，2026-09-21 本地落库）

产品截图反馈 `/records` 草稿区「有点重复、太占位置」，要求「草稿箱里的稿件是展现的而不是折叠的，每个草稿展示的大小参考任务卡，不太占位置但信息密度也不低」。

锁定口径：

- 去重：删掉顶部 `draft-strip`「我的草稿」条带（与下方卡片同源、同一批草稿渲染两遍）、删掉区块标题里的 `CalmBadge` 与第二个新建按钮、统一条带「继续编辑 →」与卡片「查看草稿」两套说法。
- 不折叠：`CalmSectionTitle` 不再传 `collapsible`，`draftsOpen` state 与 `{draftsOpen && …}` 包裹一起删除，`#record-draft-list` 始终渲染。
- 卡片尺寸：`calm-task-grid` / `calm-task-card` 换成 `draft-card-grid` / `draft-card`，三列网格、`min-height: 96px`、左侧琥珀竖条；卡片本身是 `button`，整卡可点。
- 入口唯一：页头 CTA 文案由「记录一次迭代」改为「新建迭代记录」；`taskId > 0` 的「来源草稿」语境保留区块内「新建来源草稿」按钮。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| RECORD-DRAFTS-CARD-001 | 浏览器实测 | 草稿箱默认平铺 | `/records?projectId=1`：`.draft-strip` 0 个、标题无折叠箭头、`.calm-section-title .badge` 0 个、区块内按钮 0 个 | 本地通过 |
| RECORD-DRAFTS-CARD-002 | 浏览器实测 | 卡片尺寸 | `.draft-card` 1 张：高 100px、宽 371px（三列之一），`#record-draft-list` 高 100px（改前单列大卡 270px） | 本地通过 |
| RECORD-DRAFTS-CARD-003 | 浏览器实测 | 整卡可点 | 点击 `.draft-card` 后 URL 带 `recordId`，「草稿详情」弹层可见 | 本地通过 |
| RECORD-DRAFTS-CARD-004 | 浏览器实测 | 入口唯一 | 页头「新建迭代记录」按钮 1 个、旧文案「记录一次迭代」0 个；`/records`（全部项目）草稿区不渲染而 CTA 可用 | 本地通过 |
| RECORD-DRAFTS-CARD-UNIT-001 | Web 单元 | 平铺与打开 | `RecordDraftsView.test.tsx`：`findAllByRole` 匹配 `/继续编辑/` 得到 1 张，点击后出现「草稿详情」弹层 | 本地通过 |
| RECORD-DRAFTS-CARD-UNIT-002 | Web 单元 | 新建入口走页头令牌 | 两个独立草稿用例改为 `createToken` 0→1 触发弹窗（等 `onCanCreateChange(true)` 后再推进） | 本地通过 |
| RECORD-DRAFTS-CARD-WEB-001 | Web 单元 | 全量前端不回归 | `pnpm --filter @inpulse/web test`：84 文件 539 例通过 | 本地通过 |
| RECORD-DRAFTS-CARD-GATE-001 | 静态门禁 | 类型与风格 | `pnpm --filter @inpulse/web typecheck`、`pnpm exec eslint`（改动目录）、`pnpm exec prettier --write`（9 文件）通过 | 本地通过 |

本地实际执行（2026-09-21）：`pnpm --filter @inpulse/web test`（84 文件 539 例）、`pnpm --filter @inpulse/web typecheck`、`pnpm exec eslint`、`pnpm exec prettier --write` 通过；浏览器实测见上表（无头 Chromium 指向本地 dev 5173，管理员账号在既有项目 1 的 `/records?projectId=1` 量测，未新增或修改业务数据）。

未运行 / 已知偏差：① 删掉条带后跨项目草稿没有入口，待定是否在「全部项目」视图补跨项目草稿区；② 未跑 `pnpm build`、`check:deps`、`permissions:check`、Playwright E2E 与真实 PostgreSQL 集成测试；③ 五个 E2E 规格（`record-drafts`、`record-feed`、`record-publishing`、`record-lifecycle`、`external-links`）同步了定位字符串但未实跑；④ 用例「lists my drafts across projects through the global query and opens the owning project」是随条带功能一并移除，替代用例为「lists project drafts as flat cards and opens one straight away」；⑤ 卡片视觉与文案需非作者人工评审。

## 全部项目视图草稿箱与草稿区位置（C，2026-09-21 本地落库）

产品截图反馈：「为什么点进迭代记录草稿被隐藏了，我希望把草稿放在筛选条下方，点击进迭代记录就要展示」。

锁定口径：

- 入口恢复：`RecordDraftsView` 不再用 `{projectId > 0 && …}` 把整块包起来；全部项目视图（URL 不带 `projectId`）改走 `useMyRecordDraftsQuery`（`listMyRecordDrafts`，服务端只返回当前 actor 的草稿并回填项目名），区块标题变为「我的草稿」，卡片前缀补 `项目名 / `。
- 两种来源归一：新增 `DraftCardItem { draft, projectName, moduleName, featureName, authorName }` 与 `toDraftCard()`，来源任务 / 项目草稿 / 全部项目三种来源产出同一张卡片模型；分页只对草稿列表生效（来源任务草稿是单页读取）。
- 打开语义：`openDraft` 改用 `item.draft.projectId`（原实现写 URL 里的 `projectId`，全部项目视图下恒为 0），跨项目点卡片先切到草稿自己的项目再打开详情。
- 位置：`RecordsWorkspace` 里 `<div className="record-drafts-block">` 从「页头 CTA 之下、筛选条之上」整块移到筛选条 `records-toolbar` 之后，两个视图都生效。
- 名称回填：`/me/record-drafts` 不返回作者名（`authorName` 由项目草稿列表服务回填，跨项目列表没有这一步），全部项目视图用登录用户名兜底，不再显示「名称暂不可用」。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| RECORD-DRAFTS-ALLPROJ-001 | 浏览器实测 | 全部项目视图展示草稿箱 | `/records`：`.calm-section-title h3` = 「我的草稿」，`.draft-card` 1 张，卡片文案含「InPulse 研发交付平台 / 平台与访问」与登录用户名「特哥」 | 本地通过 |
| RECORD-DRAFTS-ALLPROJ-002 | 浏览器实测 | 草稿区位于筛选条下方 | `/records` 与 `/records?projectId=1` 两个视图：`.record-drafts-block` 顶边（164）≥ `.records-toolbar` 底边（154） | 本地通过 |
| RECORD-DRAFTS-ALLPROJ-003 | 浏览器实测 | 跨项目点卡片落到草稿自己的项目 | `/records` 点卡片后 URL = `/records?projectId=1&recordId=1135`，弹层显示「项目 InPulse 研发交付平台 / 模块 平台与访问」 | 本地通过 |
| RECORD-DRAFTS-ALLPROJ-004 | 浏览器实测 | 项目内视图不改口径 | `/records?projectId=1`：标题仍是「项目草稿」，卡片 371×100 | 本地通过 |
| RECORD-DRAFTS-ALLPROJ-UNIT-001 | Web 单元 | 全部项目视图列表与打开 | `RecordDraftsView.test.tsx`：`listMyRecordDrafts` 以 `{ limit: 20 }` 调用、「我的草稿」标题可见、卡片显示「风控项目 / 风控模块」、点开后 `getRecordDraft(5, 21)` | 本地通过 |
| RECORD-DRAFTS-ALLPROJ-UNIT-002 | Web 单元 | 草稿区在筛选条之后 | `RecordsWorkspace.test.tsx`：`.records-toolbar` 相对 `[data-testid=drafts-block]` 为 `DOCUMENT_POSITION_FOLLOWING` | 本地通过 |
| RECORD-DRAFTS-ALLPROJ-WEB-001 | Web 单元 | 全量前端不回归 | `pnpm --filter @inpulse/web test`：84 文件 539 例通过 | 本地通过 |
| RECORD-DRAFTS-ALLPROJ-GATE-001 | 静态门禁 | 类型、风格与依赖边界 | `pnpm --filter @inpulse/web typecheck`、`pnpm exec eslint`（改动目录）、`pnpm check:frontend:boundaries`（279 模块 1359 依赖）通过 | 本地通过 |

本地实际执行（2026-09-21）：`pnpm --filter @inpulse/web test`（84 文件 539 例）、`pnpm --filter @inpulse/web typecheck`、`pnpm exec eslint`（改动目录）、`pnpm check:frontend:boundaries`、`pnpm exec prettier --write` 通过；浏览器实测见上表（无头 Chromium 指向本地 dev 5173，管理员账号在既有项目 1 上只读量测，未新增或修改业务数据）。

未运行 / 已知偏差：① 未跑 `pnpm build`、`check:deps`、`permissions:check`、Playwright E2E 与真实 PostgreSQL 集成测试；② 全部项目视图在没有任何草稿时会渲染「暂无草稿」空态，占位是否可接受待产品确认；③ 全部视图卡片的作者名用登录用户名兜底，`/me/record-drafts` 服务端仍未回填 `authorName`（要让该接口独立正确需另开后端契约变更）；④ 跨项目卡片仍复用 `recordId` 打开详情、不回填 `moduleId`，与项目内视图一致；⑤ 视觉与文案需非作者人工评审。

## 弹窗页脚「新建迭代」（保存并发布，C，2026-09-21 本地落库）

产品截图反馈：在「新建迭代记录」弹窗页脚原来「保存草稿」的位置增加一个按钮「新建迭代」，原本的「保存草稿」改成淡蓝色并位于「新建迭代」左侧。

锁定口径：

- 语义：「新建迭代」= 保存草稿后立刻发布成正式 v1（`publishChangeRecord`），调用方式与草稿详情的 `PublishRecordButton` 同构（CSRF + `If-Match` 用创建响应的 `rowVersion` + 独立 `Idempotency-Key`）；「保存草稿」语义不变，仍是只写草稿。
- 文案：新建时主按钮为「新建迭代」；编辑一条未发布的独立草稿时同一动作为「保存并发布」。
- 位置与配色：页脚两键右对齐，「保存草稿」在左、用既有淡蓝 `.soft-blue-button`（`#e6f2ff` / `#2472c3`），主按钮在右、用 `.primary-button`（`#1466d8` / 白字），两键同为 35px 高。
- 来源任务的草稿不给发布入口：带 `taskId` 的记录必须由任务完成流程（F-19）在同一事务里发布，服务端也会因为任务不是 DONE 而拒绝，因此 `canPublish = !source && (item ? item.taskId === null : true)`，这种情况页脚维持单个主按钮「保存草稿」。
- 发布失败不丢内容、不重复建：先建草稿再发布，发布失败时把弹窗切到刚建出来的那条草稿的编辑态并刷新草稿列表，重试是更新同一条而不是又建一条；错误仍走既有 `mutation.error` 提示。
- 成功后跳转：`onSaved(draft, published)` 增加第二个参数，`RecordDraftsView` 在 `published` 非空时用 `publishedId` 落 URL（正式记录详情），否则维持原来的 `recordId`（草稿详情）。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| DRAFT-FOOTER-PUBLISH-UNIT-001 | Web 单元 | 新建并发布 | 填好四项后点「新建迭代」：`createIndependentRecordDraft(1, 2, body)` 与 `publishChangeRecord(1, 12, {}, init)` 各调用一次，`init.headers["If-Match"]` 为创建响应的 `"1"`、`x-csrf-token` 为签发的 token、`Idempotency-Key` 为字符串 | 本地通过 |
| DRAFT-FOOTER-PUBLISH-UNIT-002 | Web 单元 | 成功后落到正式记录 | 发布成功后编辑弹窗关闭，且不再打开「草稿详情」（URL 用 `publishedId` 而不是 `recordId`） | 本地通过 |
| DRAFT-FOOTER-PUBLISH-UNIT-003 | Web 单元 | 按钮层级 | 新建弹窗：「保存草稿」类名含 `soft-blue-button`、「新建迭代」类名含 `primary-button` | 本地通过 |
| DRAFT-FOOTER-PUBLISH-UNIT-005 | Web 单元 | 发布失败不重复建草稿 | `publishChangeRecord` 以 422 失败后弹窗留在原地并切到该草稿的编辑态（按钮变「保存并发布」、标题输入仍是原值），再点一次走 `updateIndependentRecordDraft(1, 12, …)` 且 `createIndependentRecordDraft` 仍只调用一次 | 本地通过 |
| DRAFT-FOOTER-PUBLISH-UNIT-004 | Web 单元 | 来源草稿不给发布入口 | 打开「新建来源草稿」弹窗：无「新建迭代」按钮，「保存草稿」类名含 `primary-button` | 本地通过 |
| DRAFT-FOOTER-PUBLISH-BROWSER-001 | 浏览器实测 | 位置与配色 | `/records?projectId=1` 打开「新建迭代记录」：页脚两键高 35px，「保存草稿」`rgb(230,242,255)` / `rgb(36,114,195)` 在 x=941，「新建迭代」`rgb(20,103,216)` / 白字在 x=1031（右端） | 本地通过 |
| DRAFT-FOOTER-PUBLISH-BROWSER-002 | 浏览器实测 | 编辑态文案 | 草稿详情「继续编辑」：页脚为「保存草稿」（淡蓝）+「保存并发布」（蓝），提示语同步为「保存草稿可继续编辑；「保存并发布」会立即生成正式编号与 v1，之后只能新增版本或作废。」 | 本地通过 |
| DRAFT-FOOTER-PUBLISH-WEB-001 | Web 单元 | 全量前端不回归 | `pnpm --filter @inpulse/web test`：84 文件 539 例通过 | 本地通过 |
| DRAFT-FOOTER-PUBLISH-GATE-001 | 静态门禁 | 类型、风格与依赖边界 | `pnpm --filter @inpulse/web typecheck`、`pnpm exec eslint`（改动目录）、`pnpm check:frontend:boundaries`（279 模块 1359 依赖）通过 | 本地通过 |

本地实际执行（2026-09-21）：`pnpm --filter @inpulse/web test`（84 文件 539 例）、`pnpm --filter @inpulse/web typecheck`、`pnpm exec eslint`（改动目录）、`pnpm check:frontend:boundaries`、`pnpm exec prettier --write` 通过；浏览器实测见上表（无头 Chromium 指向本地 dev 5173，管理员账号只读量测，未点「新建迭代」本身，未新增或修改业务数据）。

未运行 / 已知偏差：① 未跑 `pnpm build`、`check:deps`、`permissions:check`、Playwright E2E 与真实 PostgreSQL 集成测试；② 刻意没有在浏览器里实点「新建迭代」——发布不可撤销（只能作废），为避免在演示库生成真实正式记录，发布链路现由单测与和 `PublishRecordButton` 同构的调用保证；③ 带来源任务的草稿为什么没有发布入口是产品口径问题，若要求补上需先确认 F-19 任务完成事务的边界；④ 新建态叫「新建迭代」、编辑态叫「保存并发布」，是否统一文案待产品确认；⑤ 未改契约与 OpenAPI，`record-drafts.zod.ts` 摘要仍写「独立草稿」；⑥ 文案与视觉需非作者人工评审。

## 任务中心删除统计卡与「未完成 / 已完成」筛选（C，2026-09-21 本地落库）

产品截图反馈：① 任务中心头部的逾期风险条与四张统计卡（今日待办 / 未完成 / 已完成 / 我创建的）整块删除；② 筛选行新增「未完成 / 已完成」筛选；③ 登录当前网站默认进入任务中心，且默认呈现未完成任务卡片。

锁定口径：

- 工作状态筛选：工具栏新增 `CalmSegmented`（`role=group`，无障碍名称为「工作状态」）两档「未完成 / 已完成」，位置在搜索框之后、项目下拉之前；选中档写 URL `status=open|done`（`open` 是默认值因此省略）。
- 删除面：`risk-strip`（逾期红条 + 遗留问题黄条）、`stats-grid`（四张 `stat-card`）、`selectedStatCardKey` 与 `statCards` 一起删除；服务端仍返回 `stats` / `leftoverSample`，前端不再读取（契约未改）。遗留问题入口保留在页头「遗留问题 n」按钮。
- 默认口径变化：`DEFAULT_MY_TASK_FILTERS.todayTodo` 由 `true` 改为 `false`。今日待办不再是落地视图（它原来的唯一 UI 入口就是被删掉的统计卡），因此缺省是「我负责的全部未完成任务」，请求不再下发 `todayTodo`。
- `today=1` 仍然可用（URL 直达时收窄到今日待办），`writeMyTaskFilters` 只在显式打开该筛选时写 `today=1`，不再写噪音参数 `today=0`。
- 登录落地：`LoginPage` 的默认目标是 `/`，`AppRouter` 的 index 路由 `Navigate to=/tasks`，因此登录后默认进任务中心；本次只改默认筛选，不改路由。
- 页头间距：原本 `.page-header { margin-bottom: 27px }` 与 `.task-toolbar { margin-top: 30px }` 折叠后取 30px，而 `.page-header h1` 行高 40.5px 里表意文字只占 27px（上下各 6.75px 半行距），所以视觉上标题到筛选行约 44px、筛选行到卡片只有 30px。新增 `.task-center .page-header { margin-bottom: 15px }` 与 `.task-center .task-toolbar { margin-top: 15px }`，把标题墨迹到筛选行对齐到约 30px；只作用于任务中心，活动 / 迭代记录 / 遗留问题页共用 `.task-toolbar` 的 30px 上间距不变。
- 样式：`design-system.css` 删除 `.stats-grid` / `.stat-card*` / `.stat-icon*` / `.stat-body*` / `.risk-banner*` / `.risk-strip` 死规则（含两处媒体查询与一处合并选择器），`inpulse-design.css` 删除对应的统计卡调优块，共 222 行。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| TASK-CENTER-STATS-UNIT-001 | Web 单元 | 统计卡与风险条整体消失 | `TaskCenterPageView.test.tsx`：默认渲染下 `stat-my-open` 查询为空，`document.querySelector` 取 `.stats-grid` 与 `.risk-strip` 均为 null | 本地通过 |
| TASK-CENTER-STATS-UNIT-002 | Web 单元 | 工作状态筛选默认与切换 | 同一用例断言「工作状态」组内「未完成」`aria-pressed` 为 `true`、「已完成」为 `false`；「reports the work-status change from the toolbar filter」点「已完成」发出 `status=done` 并清 `overdue` / `todayTodo`，点「未完成」回到 `status=open` | 本地通过 |
| TASK-CENTER-STATS-UNIT-003 | Web 单元 | 空态跟随档位 | `status=done` 空集合给出「没有匹配的已完成任务」且「已完成」档选中；`status=all`（URL 直达）两档都不选中；缺省空态是「没有匹配的未完成任务」，不再出现「今天没有待办任务」；`todayTodo: true` 时仍给出更窄的今日待办空态 | 本地通过 |
| TASK-CENTER-STATS-UNIT-004 | Web 单元 | URL 与请求的默认口径 | `my-tasks-url.test.ts`：空 URL 得 `todayTodo` 为 `false`、`?today=1` 得 `true`、显式 `todayTodo: true` 写出 `today=1`、缺省不写 `today`；`my-tasks-v1-query.test.ts` 与 `my-tasks-server.test.ts`：缺省请求不再带 `todayTodo`，只有显式 `todayTodo` 才下发 | 本地通过 |
| TASK-CENTER-STATS-UNIT-005 | Web 单元 | 页面级写回 | `TasksPage.test.tsx` 改断言：点「已完成」后地址探针含 `status=done`，同时 `fetchMyTasks` 收到 `status: done` | 本地通过 |
| TASK-CENTER-STATS-MOCK-001 | Web 单元 | mock 数据集口径 | `my-tasks-mock.test.ts`：缺省视图含 T-101 / T-102 / T-103 / T-108（20 天后到期也在内）；`created` 与管理员 `all` 视图补上 T-108 / T-110；搜索 T-108 时显式 `todayTodo: true` 命中为空 | 本地通过 |
| TASK-CENTER-STATS-BROWSER-001 | 浏览器实测 | 登录默认落地 + 默认未完成 | 本地 dev 5173 登录（成员账号）：落地 URL 为 `/tasks`，`.task-toolbar .segmented` 两组（工作状态、展示方式），工作状态为「未完成 true / 已完成 false」，`.calm-task-card` 4 张，`.stats-grid` 与 `.risk-strip` 均为 0 个 | 本地通过 |
| TASK-CENTER-STATS-BROWSER-002 | 浏览器实测 | 切换已完成 | 点「已完成」后 URL 变为 `/tasks?status=done`，列表换成已完成任务卡片（绿色完成态） | 本地通过 |
| TASK-CENTER-STATS-BROWSER-003 | 浏览器实测 | 管理员视角无残留 | 系统管理员账号登录落地 `/tasks`：`.stats-grid` 0、`.risk-strip` 0，工作状态默认落在「未完成」 | 本地通过 |
| TASK-CENTER-STATS-E2E-001 | Playwright | 关键路径改写 | `apps/e2e/tests/aggregate-views.spec.ts`：断言无统计卡 / 无风险条、工作状态分段可控、默认 URL 不带 `today`、`scope=created` 经 URL 直达仍下发 `ownership`（本地未实跑） | 已改写未实跑 |
| TASK-CENTER-STATS-BROWSER-004 | 浏览器实测 | 页头间距与列表节奏一致 | 无头 Chromium 1440×900：标题墨迹底边到工具栏顶 29px、工具栏盒底边到卡片顶 30px、搜索框底边到卡片顶 32px（改前为 44px 对 30px） | 本地通过 |
| TASK-CENTER-STATS-E2E-002 | Playwright | 间距回归断言 | `aggregate-views.spec.ts` 用 `page.evaluate` 按计算样式的行高与字号算出标题墨迹底边，断言「标题→工具栏」与「工具栏→卡片」两段间距相差不超过 4px（本地未实跑） | 已改写未实跑 |
| TASK-CENTER-STATS-WEB-001 | Web 单元 | 全量前端不回归 | `pnpm --filter @inpulse/web test`：84 文件 534 例通过 | 本地通过 |
| TASK-CENTER-STATS-GATE-001 | 静态门禁 | 类型、风格、依赖边界与文档 | `pnpm typecheck`（8 个 workspace）、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`（280 模块 1368 依赖）、`pnpm check:docs`（84 个 Markdown 文件）通过 | 本地通过 |

本地实际执行（2026-09-21）：`pnpm --filter @inpulse/web test`（84 文件 534 例）、`pnpm typecheck`（8 个 workspace）、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`、`pnpm check:docs`；浏览器实测见上表（无头 Chromium 指向本地 dev 5173，只用既有演示数据只读浏览，未新增或修改业务数据）。

未运行 / 已知偏差：⓪ 页头间距的 Playwright 断言（`TASK-CENTER-STATS-E2E-002`）只改写未实跑，本地没有独立 E2E 数据库（`E2E_DATABASE_URL`），未拿演示库代替；① 未跑 `pnpm build`、`check:deps`、`permissions:check`、`pnpm test:e2e` 实跑与真实 PostgreSQL 集成测试，GitHub Actions 未执行；② 删除统计卡后「今日待办」「我创建的」不再有 UI 入口（`?today=1`、`?scope=created` 仍可直达），「逾期钻取」入口消失但 `overdue` 参数与「仅显示已逾期任务」提示条保留，若产品需要找回入口需先确认位置；③ 服务端仍返回 `stats` / `leftoverSample` / `todayTodoBreakdown`，前端不再读取，契约与 OpenAPI 未动；④ `.view-description` 与「更多筛选」触发按钮仍是 `display:none` 的历史约定，本次未动；⑤ 视觉与文案需非作者人工评审。

## 任务聚合组改为任务卡片混排（产品要求，2026-09-21 本地落库）

产品截图反馈（`/tasks` 任务卡片网格下方的「任务聚合组」区块）：「把任务聚合组也改成任务卡片，和其他任务卡片一起呈现」。本批为纯前端呈现改动：不改契约、Route Registry、权限矩阵、数据库不变量、迁移、鉴权与幂等策略，后端零改动。

> 2026-09-21 更新：已并入 ACTIVE 聚合组的任务不再单独渲染卡片、列表行与折叠明细，去重判据、例外与覆盖范围见下一节「聚合成员的重复卡片下线」；本节组卡的外观与交互不变。

> 2026-09-21 二次更新：组卡整卡配色改为跟随派生的组优先级（复用任务卡片的 `.tone-prio-*`），本节「色调」与「卡片信息取舍」两处描述以末节「聚合组优先级派生、完成态与整卡配色」为准：`.tone-group` 紫色降为「已关闭且无分支」组卡的兜底色，R-7 分支已扩 `priority` 并由组卡显示派生优先级。

> 2026-09-22 更新（产品要求「聚合任务不会切换列表」，C 本地落库）：列表视图下聚合组不再以卡片追加在表格之后，改为与任务行同一张 `.task-center-table` 的组行（`.task-group-grid` 规则删除）。本节「呈现方式」中「列表视图下任务表格保持原样，聚合组仍以同款卡片追加在表格之后（`.task-group-grid`）」按本行修订；卡片视图不变。组行的渲染与断言见末节「聚合组跟随卡片 / 列表切换」。

> 2026-09-22 二次更新（产品要求「组合任务取消紫色，按合并任务以内部未完成任务中的最高优先级显示颜色」）：组卡与组行整卡底色回到与任务卡片同一套 `.tone-prio-*`，`.tone-group` 浅紫兜底、`.tone-group-open` 靛蓝与 `.tone-group-done` 青碧三支组专用色连同配套整卡反白一并删除。本节「色调」中「`.tone-group` 变量组」的描述作废，以末节《聚合组优先级派生、完成态与整卡配色》的 2026-09-22 更新说明与《任务卡片实色配色》的 CARD-COLOR-UNIT-007 / CARD-COLOR-BROWSER-019 为准。2026-09-22 三次更新（产品口径「没有任何任务完成就显示未开始，有任意任务完成了就是进行中，所有任务都完成了就归到已完成那边」+「组合任务的排版和单个任务排版对齐统一」）：组卡状态徽章改为三态并归入工具栏两档，右上角计数行与底部「N 条分支」删除，底部那一排改为「三枚徽章 + 右下角截止」，见 CARD-COLOR-UNIT-008 / CARD-COLOR-BROWSER-020 / CARD-COLOR-BROWSER-021。同日另按「这个卡片的布局要和 P2 一样」把组卡排版改成与任务卡同构（顶部「编号 + 徽章」行与卡上编号下线），再按「把左下角已完成放到右上角、取消提示、直接点卡片看详情」把分支完成计数移到卡片右上角、删除页脚与「查看详情 / 解除合并」提示；本节「卡片信息取舍」中「编号（`TG-*`）上卡」与「页脚提示」两处描述按此修订，实测见 CARD-COLOR-BROWSER-020。

锁定口径：

> 2026-09-22 更新（产品口径「（它们）同样是一个优先级的，按照截止日期从近到远排序」，C 本地落库）：本节「排列顺序：任务在前、聚合组在后」已作废，改为与任务卡共用 `gridEntries` 一把尺子混排；组卡外观、同网格呈现、弹窗入口与分页语义不变。用例与实测见本文件末节「组卡与任务卡同一顺序」与 [任务卡片配色规范](task-card-colors.md)。

- 呈现方式：聚合组不再有独立区块（`section.group-panel`、`.group-list`、`article.group-card`、分支行 `.branch-task` 与页脚「查看主任务」全部删除），改渲染为 `.calm-task-card.task-group-card.tone-group`，与任务卡片同一 `.calm-task-grid` 混排；列表视图下任务表格保持原样，聚合组仍以同款卡片追加在表格之后（`.task-group-grid`）。
- 排列顺序：2026-09-21 定为「任务在前、聚合组在后」；2026-09-22 产品要求「（它们）同样是一个优先级的，按照截止日期从近到远排序」后改为混排——组卡与任务卡共用 `gridEntries` 一把尺子（状态分组 → 紧急桶 → 优先级 → 截止时间近到远，组卡的三项都从「未完成分支」派生）。两侧仍是各自签名游标分页（R-3 / R-7），前端只在已加载页内按同一把尺子合并，不伪造跨页完整顺序；同键保持稳定次序（任务在前、组保持 R-7 顺序）。
- 卡片信息取舍：按冻结的 R-7 契约，`TaskGroupListItem` 只有 `{ groupId, projectId, projectName, code, name, status, mainTask, branches }`，分支不带 priority / dueAt / 模块名 / 记录数，因此组卡**不伪造**这些字段，只显示：编号（`TG-*`）、「聚合组」+「进行中 / 已关闭」徽章、组名、项目名、主分支负责人、`N 条分支`、`已完成 n/N`（分支数 > 0 时）与「查看详情 / 解除合并」（CLOSED 组为「查看聚合历史」）。
- 卡片交互：整卡是 `<button>`（`data-testid="my-task-group-{groupId}"`），点击就地打开既有 `TaskGroupDetailModal`（不离开页面、不改地址栏）；分支明细、来源类型徽章、解除合并与主任务直达都只在弹窗里提供一份，不在卡片上复制。CLOSED 组按服务端口径返回空 `branches` 与 `null mainTask`，卡片退化为组名 + 状态 + 「—」。
- 空态与错误态：`hasListContent = 任务卡片数 > 0 || 聚合组数 > 0`；两者都空才显示任务空态（原「还没有聚合组」独立空态删除——聚合组现在只是列表的一部分）。聚合组读取失败时任务卡片照常渲染，错误 Alert 移到列表下方就地提示；任务为空且聚合组仍在加载时先给加载态，避免空态一闪再被组卡顶掉。
- 分页：两侧「加载更多」合并到同一行 `.task-more-row`（主按钮「加载更多任务」+ 次级按钮「加载更多聚合组」），R-7 游标语义不变。
- 色调：新增 `.tone-group` 变量组（紫色条 `#7c6bd0` / 底 `#f8f6ff` / 描边 `#e2ddf4`），与聚合组「主任务」「聚合组」徽章同一色系；外框、内边距、色条几何全部复用 `.calm-task-card`，不新写卡片骨架。
- 取代关系：本节取代 2026-09-20「任务聚合组与任务卡网格对齐」章节（`.group-panel` 标题内缩 10px、`.group-list` 固定两列随区块一并作废，聚合组卡片改为跟随 `.calm-task-grid` 的响应式：3 列 / ≤1100px 两列 / ≤700px 单列），也取代 F-20 章节（2026-09-11）与 2026-09-17「任务中心卡片就地弹窗」章节里对聚合组区块、分支行与「查看主任务」按钮的描述；`TaskGroupDetailModal`、R-7 路由与弹窗内成员标题入口（`task-group-member-title`）均未改。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| TASKGROUP-AS-CARD-WEB-001 | Web 单元 | 组卡与任务卡同网格、同排版 | `TaskCenterPageView.test.tsx`「renders task groups as cards inside the task grid」：`my-task-group-501` 可见，卡内组名 / 项目名 / `.calm-card-bottom > .task-card-badges` 里的「聚合组」「进行中」/「4 条分支」可定位，完成计数「已完成 1/4」在 `.task-group-card-top` 且该行是卡片第一个子元素（`.task-group-card-open` 与 `.task-card-footer` 均为 null、卡上无「查看详情 / 解除合并」文案）；`card.closest(".calm-task-grid")` 非空、`document.querySelector(".group-panel")` 为 null；`.calm-card-top` 与 `.task-id` 均为 null、`TG-001` 不在卡片上（编号只在列表视图与弹窗）；`.calm-card-assignee` 的 `nextElementSibling` 是 `.calm-card-bottom` | 本地通过（2026-09-22 改口径后重跑） |
| TASKGROUP-AS-CARD-WEB-002 | Web 单元 | 组卡就地打开弹窗 | 同文件「opens the task group detail dialog from the group card」：点击组卡后 `onOpenTask` 未被调用、出现名称含「聚合组」的 `dialog` | 本地通过（2026-09-21 同批补跑） |
| TASKGROUP-AS-CARD-WEB-003 | Web 单元 | 空聚合组不占位 | 同文件「keeps task cards visible without a group empty state when there are no groups」：任务卡 `my-task-101` 可见，无 `my-task-group-501`，无「还没有聚合组」 | 本地通过（2026-09-21 同批补跑） |
| TASKGROUP-AS-CARD-WEB-004 | Web 单元 | 聚合组失败不遮任务 | 同文件「keeps the task list visible with an error alert when groups fail」：任务卡可见且「任务列表暂时不可用，请稍后重试。」可定位 | 本地通过（2026-09-21 同批补跑） |
| TASKGROUP-AS-CARD-E2E-001 | Playwright | 真实浏览器关键路径 | `task-groups.spec.ts` 第 2 例：`/tasks` 组卡（`.calm-task-grid .task-group-card`，含主任务标题）可见且「聚合组」「进行中」「普通」徽章、项目名、分支负责人齐备，`toHaveClass(/tone-prio-normal/)`，`.task-id` 与 `.calm-card-top` 的 `toHaveCount(0)`；点击后 `.task-group-detail-modal` 打开、地址栏不含 `/task-groups/`；弹窗内主分支行含「主任务」与负责人、来源分支行含「活动来源分支」；点成员标题就地打开「任务详情」弹窗 | 本地通过（2026-09-22 改口径后重跑 2/2） |

本地实际执行（2026-09-21）：按 2026-09-17 项目负责人指示「只改前端（`apps/web`）且不涉及后端、契约、权限与数据库时，不再运行任何测试与门禁命令」，本批未运行任何测试与门禁；改动文件经 IDE 静态诊断确认无类型与语法错误，删除的 `.group-panel` / `.group-card` / `.branch-task` 样式经全仓检索确认已无消费方（`.branch-list` / `.merge-panel` / `.task-group-panels` 属其它弹窗使用，未动）。

后续同批（优先级派生批次，见末节）补跑：定向 Web 单测 2 文件 53 例、Playwright `task-groups.spec.ts` 2/2 均通过，本节 5 条用例随之转为「本地通过」。

未运行 / 已知偏差：① 4 例改写的 Web 单测与 `task-groups.spec.ts` 第 2 例已于 2026-09-21 同批补跑通过；全量 `pnpm test:web` / `pnpm test:e2e`、`pnpm build`、`check:frontend:boundaries`、`pnpm check` 与 API / 集成全量测试仍未运行；② 组卡不显示截止时间与迭代记录数，原因是冻结的 R-7 契约分支不带这些字段（要显示需再扩契约，属 A 域；2026-09-21 二次更新：`priority` 已扩并由组卡用于派生显示）；③ 两侧「加载更多」合到同一行，若同时还有下一页会并排出现两个按钮；④ 任务与聚合组两个数据源无法跨源排序，2026-09-21 把网格顺序固定为「任务在前、聚合组在后」（2026-09-22 修订：改为在已加载页内按同一把尺子混排，见上方「排列顺序」）；⑤ 卡片类名、强调色与信息密度需非作者人工评审（2026-09-21 二次更新：组卡强调色已改为跟随派生优先级）。

## 聚合成员的重复卡片下线（产品要求，2026-09-21 本地落库）

产品截图反馈（`/tasks` 任务卡片网格里，已合并的任务仍以独立任务卡片出现）：「我要求就是，如果两个任务合并成了一个任务聚合组，那么那两个任务卡片就不需要显示了，就只显示任务聚合组的任务卡片」。本批为纯前端呈现改动，后端零改动；上一节「任务聚合组改为任务卡片混排」的组卡外观、同网格混排、弹窗入口与分页语义全部保留。

锁定口径：

- 去重判据取任务侧字段：`item.groupRole !== null` 即「已并入 ACTIVE 聚合组」。R-3 的 `groupRole` / `groupId` 由 `MyTasksQueryService` 经 `TaskGroupMembershipReadPort.listGroupRoles` 映射，服务端只对 `g.status = 'ACTIVE' AND m.status = 'ACTIVE'` 的成员返回，解除合并（成员标记 `DETACHED`）或组关闭后自动回 `null`。判据因此不依赖聚合组列表的分页与读取结果，也不需要新增契约字段。
- 一次收敛三处：过滤点放在 `TaskCenterPageView` 的 `visibleItems` 派生处（本地筛选之后，`openItems` / `doneItems` / `canceledItems` / `primaryItems` 之前），卡片网格、列表视图表格与「已完成 n 项」「已取消」折叠明细共用同一份数据，三种形态不会各显各的。
- 例外（显式筛选）：`filters.relation` 为 `MAIN` 或 `SOURCE` 时不做去重。合并关系是 R-3 已冻结的筛选维度，无条件隐藏会让这两个选项永远筛不出结果；该路径下卡片照常显示「主任务 / 来源任务」徽章。
- 聚合组卡片是唯一入口：成员任务不再出卡片后，分支明细、负责人、来源类型、解除合并与主任务直达仍只在组卡打开的 `TaskGroupDetailModal` 里提供一份，网格与列表行不补副本。
- 统计卡不变：`stats`（今日待办 / 未完成 / 已完成 / 我创建的）与遗留问题入口仍是服务端口径，已合并任务继续计入统计数字；列表去重是呈现层行为，不按可见卡片数改写数字（列表本身分页，改数字反而失真）。
- 未覆盖界面：任务看板（[ADR-037](adr/ADR-037.md) 口径不变）、功能档案与模块任务面板（那里的卡片必须带「主任务 / 来源任务」徽章并就地提供合并 / 解除合并）、全局搜索、项目动态与站内通知。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| TASKGROUP-MERGE-HIDE-WEB-001 | Web 单元 | 已合并任务不再出卡片 | `TaskCenterPageView.test.tsx` 新增「hides the card of a task that is already merged into a group」：默认视图下未入组的 `my-task-103` 与 `my-task-group-501` 可见、组 501 主任务 `my-task-102` 为 null | 本地通过（2026-09-21 同批补跑） |
| TASKGROUP-MERGE-HIDE-WEB-002 | Web 单元 | 合并关系筛选仍可看成员本身 | 同文件「marks module scope, merge role and priority on member cards opened by the merge filter」：`relation=MAIN` 视图下 `my-task-102` 可见且「模块级」/「主任务」/「高」/`优先级：高`/「记录 3 条」齐备 | 本地通过（2026-09-21 同批补跑） |
| TASKGROUP-MERGE-HIDE-WEB-003 | Web 单元 | 独立任务卡不带记录徽章 | 同文件「marks priority and omits the record badge on a standalone card」：`my-task-103` 显示「普通」与 `优先级：普通`，无「记录」徽章（承接原用例被替换掉的独立卡断言） | 本地通过（2026-09-21 同批补跑） |
| TASKGROUP-MERGE-HIDE-E2E-001 | Playwright | 真实浏览器关键路径 | `task-groups.spec.ts` 第 2 例：合并后进 `/tasks?today=0`（该口径本身包含这两个任务）并等 `/api/v1/tasks` 响应返回，`.calm-task-grid .task-group-card` 组卡可见；`.calm-task-card` 中来源任务标题 0 张、非组卡中主任务标题 0 张 | 本地通过（2026-09-21 同批补跑） |
| TASKGROUP-MERGE-HIDE-BROWSER-001 | 浏览器实测 | 默认视图只剩组卡 | `/tasks`（今日待办）：任务网格里唯一卡片是 `INPULSE-TG-1`（聚合组 · 进行中 · 3 条分支 · 已完成 2/3 · 查看详情 / 解除合并），已合并的紧急任务 `INPULSE-T-59` 不再出卡片，且没有闪出任务空态 | 本地通过 |
| TASKGROUP-MERGE-HIDE-BROWSER-002 | 浏览器实测 | 「未完成」口径同样去重 | `/tasks?today=0`：卡片为 `INPULSE-T-62`、`INPULSE-T-60` 与组卡 `INPULSE-TG-1`，`INPULSE-T-59`（已合并、负责人为当前用户）不再出现 | 本地通过 |

本地实际执行（2026-09-21）：浏览器实测见上表（本地 dev 5173，登录账号在既有项目 1 的真实数据上只读查看，未新增、修改或删除任何数据）；按 2026-09-17 项目负责人指示「只改前端（`apps/web`）且不涉及后端、契约、权限与数据库时，不再运行任何测试与门禁命令」，本批未运行任何测试与门禁命令；改动文件经 IDE 静态诊断确认无类型与语法错误，去重判据的服务端口径在阅读 `TaskGroupMembershipReadPort.listGroupRoles` 与 `MyTasksQueryService` 后确认（未改后端）。

后续同批（优先级派生批次，见下节）补跑：定向 Web 单测 2 文件 53 例、Playwright `task-groups.spec.ts` 2/2 均通过，本节 4 条用例随之转为「本地通过」。

未运行 / 已知偏差：① 3 例 Web 单测（2 例新增 + 1 例拆分改写）与 `task-groups.spec.ts` 第 2 例已于 2026-09-21 同批补跑通过；全量 `pnpm test:web` / `pnpm test:e2e`、`pnpm build`、`check:frontend:boundaries`、`pnpm check` 与 API / 集成全量测试仍未运行；② `my-tasks-mock.ts` 的夹具自相矛盾（既有问题）：任务侧只有 `T-102`（MAIN）与 `T-105`（SOURCE，但属项目 2、不在任何组的 `branches` 里）带聚合组标注，而组 501 的 `MOCK_GROUP_BRANCH_SEEDS` 列出 `T-102` / `T-101` / `T-104` / `T-107`，两边不一致；生产数据同源于 `task_group_members` 不会出现该情况。本次按任务侧字段实现且未改夹具，因此 mock 数据下 `T-101` / `T-104` / `T-107` 仍会出卡片（与组卡列出的分支重复），是否把夹具改成一致并同步受影响的用例属独立决定；③ 统计卡与服务端统计仍是服务端口径：实测 `/tasks` 显示「今日待办 1」（紧急 1）而网格里只有组卡，这个 1 就是被合并的那个任务，现在由组卡代表；「未完成 3」同理比可见任务卡片多 1，数字不按可见卡片数改写（列表分页，改数字反而失真）；④ 逾期风险条的样本任务取自当前可见集合，若唯一的逾期任务已合并则退化为「切换到我的任务查看明细」文案；⑤ 聚合组读取失败时成员任务仍被隐藏（判据在任务侧），页面只留错误 Alert；⑥ 组卡与任务卡同网格、成员默认隐藏的视觉与信息密度需非作者人工评审。

## 聚合组卡片列出全部负责人（产品要求，2026-09-21 本地落库）

产品要求（聚合组卡片当时只显示主任务负责人）：「如果任务聚合组里的任务是不同人负责的，那么卡片上的任务负责人也都要加上去」。本批只调聚合组卡片的负责人展示，属纯前端改动，后端、契约、权限与迁移零改动；上一节「聚合成员的重复卡片下线」的去重口径不变，组卡现在同时承担「成员卡已下线」与「负责人全列出」两件事。

锁定口径：

- 数据源用 R-7 已冻结的分支字段，不扩契约：`TaskGroupListItem.branches[].assignee`（`userRef`）。服务端按 [A 的契约评审裁决](a-contract-review-f25-f29-f32.md) 的 R-7 口径返回分支（主任务在前、来源任务按 `joinedAt` 与 `taskId` 升序，只含 ACTIVE 成员），保持服务端顺序即可让主任务负责人在最前，不需要另读 `mainTask` 引用。
- 按 `assignee.userId` 去重：同一人同时挂主任务与多个来源分支时只出现一次；全部分支同一人时卡片外观与改动前一致（仍是单个名字，tooltip 仍是「主任务负责人：X」）。
- 多人时以「、」连接列出全部负责人，不做人数截断：卡片宽度不足时由 CSS 省略号收敛（`.task-group-assignees` / `.task-group-assignee-names`），完整名单在 `title` 中给出——「各分支负责人：a、b、c（含主任务与全部来源分支）」。
- CLOSED 组按服务端口径 `branches` 为空，保持「—」与「已关闭的聚合组：负责人保留在详情中」，不虚构名单。
- 卡片其余信息不变：分支明细、来源类型、已发布记录数、解除合并与主任务直达仍在组卡打开的 `TaskGroupDetailModal` 里，卡片仍只列负责人、分支数与完成情况。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| TASKGROUP-OWNERS-WEB-001 | Web 单元 | 同人分支仍是单名 | `TaskCenterPageView.test.tsx`「renders task groups as cards inside the task grid」追加断言：组 501 四条分支同一人（陈晓）时卡片出现「陈晓」且不重复 | 本地通过（2026-09-21 同批补跑） |
| TASKGROUP-OWNERS-WEB-002 | Web 单元 | 不同人分支全部列出且去重 | 同文件新增「lists every branch owner on the group card when members differ」：把第 2 条分支换成王敏后，组卡文本为 `陈晓、王敏`（主任务负责人在前、按 userId 去重） | 本地通过（2026-09-21 同批补跑） |
| TASKGROUP-OWNERS-E2E-001 | Playwright | 真实浏览器关键路径 | `task-groups.spec.ts` 第 2 例：任务中心 `groupCard` 增加 `toContainText(runtime.user.name)`（本例两条分支同一人负责，去重后只出现一次） | 本地通过（2026-09-21 同批补跑） |
| TASKGROUP-OWNERS-BROWSER-001 | 浏览器实测 | 真实数据多负责人 | `/tasks` 的 `INPULSE-TG-1`（3 条分支：主任务 T-20 小潘、历史来源 T-21 小潘、活动来源 T-59 邵晨宇）组卡显示「小潘、邵晨宇」，tooltip 为「各分支负责人：小潘、邵晨宇（含主任务与全部来源分支）」；同弹窗成员列表口径一致 | 本地通过 |

本地实际执行（2026-09-21）：浏览器实测见上表（本地 dev 5173，在既有项目 1 的真实数据上只读查看，未新增、修改或删除任何数据；打开组卡弹窗后已关闭，未提交任何写操作）；按 2026-09-17 项目负责人指示「只改前端（`apps/web`）且不涉及后端、契约、权限与数据库时，不再运行任何测试与门禁命令」，本批未运行任何测试与门禁命令；改动文件经 IDE 静态诊断确认无类型与语法错误。

后续同批（优先级派生批次，见下节）补跑：定向 Web 单测 2 文件 53 例、Playwright `task-groups.spec.ts` 2/2 均通过，本节 3 条用例随之转为「本地通过」。

未运行 / 已知偏差：① 1 例新增 Web 单测与 2 例扩展（Web 单测、`task-groups.spec.ts` 第 2 例）已于 2026-09-21 同批补跑通过；全量 `pnpm test:web` / `pnpm test:e2e`、`pnpm build`、`check:frontend:boundaries`、`pnpm check` 与 API / 集成全量测试仍未运行；② `my-tasks-mock.ts` 的演示组四条分支都是同一人（陈晓），因此 mock 模式看不出多负责人效果，只有真实数据会出现多名；未改夹具（见上一节偏差 ②）；③ 负责人数量不设上限，极端情况下（大量分支分属不同人）名单会以省略号收敛，需要悬停 `title` 才能看到全量，是否符合设计师预期需非作者人工评审；④ 卡片不区分「谁是主任务负责人」，仅按服务端顺序把主任务负责人排在首位。

## 聚合组优先级派生、完成态与整卡配色（产品要求，2026-09-21 本地落库）

产品要求（原文）：「任务聚合组的优先级按未完成任务中优先级最高的来，如果那个任务完成了就按第二高的来，如果全部任务都完成就，任务聚合组就算完成」；追加要求：「卡片颜色也按优先级的来」。本批从纯前端呈现跨出到契约与后端：R-7 分支 DTO 原本没有优先级字段，而组优先级必须覆盖他人负责的分支（当前用户视角的 R-3 读不到），因此按仓库规则同步 Schema、Route Registry 摘要、OpenAPI 与生成客户端，需非作者人工评审。

> 2026-09-22 更新（产品要求「组合任务取消紫色，按合并任务以内部未完成任务中的最高优先级显示颜色」）：本节 2026-09-21 的锁定口径当天一度被「按组状态定色」（`.tone-group-open` 实色靛蓝 / `.tone-group-done` 青碧 / `.tone-group` 实色紫）取代，同日再按本条要求回退——组卡与组行重新只吃 `.tone-prio-*`，三支组专用色与配套整卡反白一并删除。下表 TASKGROUP-PRIORITY-* 的类名断言与本条一致；TASKGROUP-PRIORITY-BROWSER-001 的实拍色值改为实色卡口径（`tone-prio-urgent` 底 `rgb(206, 52, 43)`），完整实测见《任务卡片实色配色》的 CARD-COLOR-BROWSER-019。

锁定口径：

- 组优先级 = 未完成（`workStatus === "TODO"`）分支中最高一档（紧急 > 高 > 普通 > 低）；分支状态变化后自动重算，不写库、不新增派生字段。
- 已取消（CANCELED）与已完成一样算收尾、不参与组优先级——否则被取消的分支会永久压住组优先级；口径与 [ADR-034](adr/ADR-034.md) 的「已收尾」一致。
- 全部分支收尾且 `branches` 非空 ⇒ 组卡按「已完成」呈现：绿色状态徽章、整卡 `tone-prio-done` 配色、标题转完成绿，优先级徽章隐藏。组自身仍是 ACTIVE（`status` 不变、解除合并入口保留），不写任何数据。
- 已关闭组（`status=CLOSED`，服务端 `branches` 为空）没有事实可派生，整卡走中性灰 `tone-prio-canceled`（2026-09-22 更新，原为聚合组紫色 `tone-group`），状态仍「已关闭」。
- 整卡配色与任务卡片共用 `@features/common/task-tone` 的 `.tone-prio-*` 一套色值：底色、左侧色条、边框与页脚「查看详情 / 解除合并」文字色（`var(--task-fg)`）同步；聚合组不再有紫 / 靛蓝 / 青碧等组专用色，也不再有固定身份色（2026-09-22 更新）。
- 「已完成 n/N」只计 DONE：已取消算收尾但不计入分子（计入分母 N=分支总数），与任务中心统计口径一致。
- 服务端只透传事实字段：R-7 `taskGroupListBranchSchema` 新增 `priority`（`TASK_PRIORITIES` 枚举），`TaskReadModel` 补 `priority` 并同步 `findByTaskId` / `find` / `listByIds` 三处查询；派生逻辑在客户端，服务端不做组优先级计算。拒绝方案：前端与 R-3 联表——R-3 只返回当前用户可见任务，他人负责的分支会拿不到优先级而算错组优先级。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| TASKGROUP-PRIORITY-CONTRACT-001 | 契约 | R-7 分支新增 `priority` | `contract:validate`（108 条路由）全过、`contract:drift`（5 产物一致）、`permissions:check`（108/108） | 本地通过 |
| TASKGROUP-PRIORITY-API-001 | API 单测 | 分支优先级透传 | `aggregate-read.service.test.ts` R-7 以 `(TODO,HIGH)` / `(DONE,URGENT)` / `(CANCELED,LOW)` 三条分支断言元组含 `priority`；定向 2 文件 32 例通过（2026-09-23 起第三条分支改判 `(CANCELED,NORMAL)`，见末节） | 本地通过 |
| TASKGROUP-PRIORITY-API-002 | 真库集成 | 查询层与 HTTP 全链 | `aggregate-read-list-api.integration.test.ts`（主任务 HIGH、历史来源 LOW、活动来源 NORMAL）分支元组断言成功；10/10 通过（真实 PostgreSQL 18.6 + PGroonga）（2026-09-23 起「历史来源」改判 NORMAL，见末节） | 本地通过 |
| TASKGROUP-PRIORITY-WEB-001 | Web 单元 | 最高档优先级与整卡配色 | `TaskCenterPageView.test.tsx`「renders task groups as cards inside the task grid」：紧急徽章 + `优先级：紧急（未完成分支中最高）` + `toHaveClass("tone-prio-urgent")` | 本地通过 |
| TASKGROUP-PRIORITY-WEB-002 | Web 单元 | 完成后落到第二高 | 同文件「falls back to the next highest branch priority after the urgent branch is done」：T-101 置 DONE 后显示「高」、无「紧急」、仍「进行中」、`已完成 2/4`、`tone-prio-high` | 本地通过 |
| TASKGROUP-PRIORITY-WEB-003 | Web 单元 | 全部收尾即完成 | 同文件「marks the group complete when every branch is wound up」：TODO 分支全置 DONE 后显示「已完成」、无「进行中」与优先级徽章、`已完成 3/4`、`tone-prio-done` | 本地通过 |
| TASKGROUP-PRIORITY-WEB-004 | Web 单元 | mock 夹具带优先级 | `my-tasks-mock.test.ts` 分支元组升级为含 `priority`（101 紧急 / 102 高 / 104 普通 / 107 普通） | 本地通过 |
| TASKGROUP-PRIORITY-E2E-001 | Playwright | 真实浏览器关键路径 | `task-groups.spec.ts` 第 2 例：两条默认「普通」且均未完成的分支 ⇒ 组卡显示「普通」徽章且 `toHaveClass(/tone-prio-normal/)`；2/2 通过 | 本地通过 |
| TASKGROUP-PRIORITY-BROWSER-001 | 浏览器实测 | 真实数据整卡配色 | `/tasks` 的 `INPULSE-TG-1`（未完成分支 T-59 紧急）：`className=calm-task-card task-group-card tone-prio-urgent`，底色 `rgb(253,242,241)`、左侧色条 `rgb(192,69,63)`、徽章「紧急」+ `优先级：紧急（未完成分支中最高）`，状态「进行中」、`已完成 2/3` | 本地通过 |

本地实际执行（2026-09-21）：`contract:generate`（5 产物重生成）/ `contract:drift`（5 产物一致）/ `contract:validate`（108 条路由）/ `permissions:check`（108/108）；Web 全量单测 84 文件 544 例（含定向 2 文件 53 例）、API 定向单测 2 文件 32 例、真实 PostgreSQL 集成 3 文件 52 例（`aggregate-read-api` / `aggregate-read-ports` / `aggregate-read-list-api`，其中目标文件 10/10）、Playwright `task-groups.spec.ts` 2/2 全部通过；Web `tsc --noEmit`、`check:boundaries`（280 模块 / 1368 依赖）与生产构建、改动文件 ESLint 与 Prettier 检查通过；浏览器实测见上表。真库测试后已按 2026-09-17 指示运行 `apps/e2e/helpers/fixture-cleanup.ts` 清理夹具（删除夹具账号 3、项目 2、业务行 76、审计行 0，复核残留为 0）。

未运行 / 已知偏差：① `pnpm test:unit` / `test:integration` / `test:e2e` 全量与 `pnpm check` 整链、`check:deps` / `check:secrets` / `check:deploy:test` 与 GitHub Actions 未运行（定向与全量 Web 单测、聚合读三文件集成与目标 E2E 已跑，见上）；② 本批含契约与后端改动，不适用 2026-09-17 的纯前端免测试指示，须非作者人工评审（契约新增字段、`TaskReadModel` 扩字段与三处 SQL 是重点）；③ 已关闭组退回中性灰 `tone-prio-canceled` 的兜底缺少真实数据样本（夹具组已清理，真实数据暂无 CLOSED 组），仅由实现与代码路径保证（2026-09-22 起原紫色兜底改为中性灰）；④ 组优先级派生只在任务中心组卡生效，任务看板、功能档案与模块任务面板的聚合组呈现未改；⑤ 「已完成」是呈现层完成态，组 `status` 仍 ACTIVE，关闭聚合组仍只由解除合并最后一个活跃来源触发。

## 聚合组详情弹窗布局、分支优先级与功能名称（产品要求，2026-09-21 本地落库）

产品要求（附聚合组详情弹窗截图，指向分支行的「负责人 小潘 · 已发布记录 1 条 · 合并于 9月12日 · 功能 #1」）：「这里布局和优先级还有颜色需要修改，然后功能怎么是编号#1，要改成名称」。经确认的两项口径：布局按「分支卡片对齐任务卡片（编号/徽章/标题/元信息分行，解除合并按钮不单独占行）」；优先级按「分支卡片显示优先级徽章并按优先级上色（与任务卡片同一套色调）」。本批从纯前端呈现跨出到契约与后端：R-1 / R-4 的成员与记录 DTO 原本只有 `featureId` 数字，解析名称必须由服务端按归属项目批量查功能表，因此同步 Schema、Route Registry 摘要、OpenAPI 与生成客户端，需非作者人工评审。

锁定口径：

- 布局：分支行的「编号 → 角色徽章 → 工作状态徽章 → 优先级徽章」与动作按钮同在 `.task-group-member-head` 一行（解除合并按钮 `margin-left: auto` 靠右），标题与元信息在下方分行；原独立占行的 `.task-group-member-actions` 包装层删除，`.task-group-member-head .secondary-button` 样式取而代之。
- 分支卡片沿用任务卡片的 `.tone-prio-*` 一套色值（`@features/common/task-tone`）：`li` 类名为 `task-group-member tone-prio-<派生>`，底色取 `--task-bg`、左侧 3px 色条取 `--task-c`，标题色取 `--task-fg`；派生规则与任务卡一致（已完成/已取消 → done、否则按优先级），DETACHED 分支保持历史灰（`.task-group-member.detached`、底色 `#fafbfd`、无色条），不参与优先级上色。
- 优先级徽章复用共享 helper：`taskPriorityLabel`（紧急 / 高 / 普通 / 低）与 `taskPriorityBadgeTone`（`CalmBadgeTone`：紧急 red、高 amber、普通 blue、低 gray），`title` 为「优先级：X」。任务卡、组卡、列表行、优先级筛选选项与分支行改用同一份实现，删除 `TaskCenterPageView` 内的本地 `priorityLabels` / `priorityTone`。
- 功能名称由服务端解析：`taskGroupMemberDetailSchema` 与 `taskGroupRecordItemSchema` 均新增可空 `featureName`（`string().min(1).max(500).nullable()`，紧跟 `featureId`）；`TaskGroupQueryService` 经既有的 `FeatureReadPort.listNames(tx, { projectIds, featureIds })` 按归属项目批量取名称（R-1 用该组 `projectId` + 成员任务去重后的非空 `featureId`；R-4 用当页记录的 `featureId`），服务端只透传事实字段。
- fail loudly：`featureId` 非空但解析不到名称时抛 `AGGREGATE_READ_INCONSISTENT`（500，message 分别为「任务缺少功能 N」/「记录缺少功能 N」），不回落显示编号——与其它聚合读服务同一策略，避免「编号又冒出来」。
- 模块级任务与模块级记录的 `featureId` 为 `null` ⇒ `featureName` 为 `null`，元信息不渲染「功能 …」；前端两处元信息分别为「… · 功能 <名称>」与「<日期> 发布 · 功能 <名称>」。
- Route Registry 摘要（R-1 增加「任务原数据、任务优先级、所属功能名称与每任务 PUBLISHED 记录数」；R-4 增加「并附记录所属功能名称与记录上的 GitHub 链接快照」）与 OpenAPI、生成客户端同一批再生成，5 产物无漂移。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| TASKGROUP-MODAL-CONTRACT-001 | 契约 | R-1 / R-4 新增 `priority` 与 `featureName` | `contract:generate` 重生成 5 产物、`contract:drift` 一致、`contract:validate`（108 条路由）、`permissions:check`（108/108）全过；生成类型含 `TaskGroupMemberDetail.priority` / `.featureName` 与 `TaskGroupRecordItem.featureName` | 本地通过 |
| TASKGROUP-MODAL-API-001 | API 单测 | 名称解析与 fail loudly | `aggregate-read.service.test.ts` 定向 29/29：成员 `featureName: "登录页"`、`priority: "NORMAL"`、`listNames` 入参断言、`featureId = null` 用例，以及新增「已归属功能解析不到名称时以 500 失败而不是回退编号」（`AGGREGATE_READ_INCONSISTENT` + `任务缺少功能 4`） | 本地通过 |
| TASKGROUP-MODAL-API-002 | 真库集成 | R-1 / R-4 HTTP 全链 | `aggregate-read-api.integration.test.ts` 20/20（真实 PostgreSQL 18.6 + PGroonga）：R-1 成员元组 `featureName` 齐全且与功能 A/B 对齐、R-4 当页记录 `featureName` 顺序逐个匹配 | 本地通过 |
| TASKGROUP-MODAL-WEB-001 | Web 单元 | 共享优先级 helper | Web 全量单测 84 文件 544 例通过（含 `TaskCenterPageView.test.tsx` 既有优先级用例改用共享 helper 后仍绿） | 本地通过 |
| TASKGROUP-MODAL-WEB-002 | Web 单元 | 分支行徽章与配色（无独立 actions 行） | 上一批 `TaskCenterPageView.test.tsx` / `my-tasks-mock.test.ts` 断言不变；本批未新增分支行单测（`TaskGroupDetailPanels` 无组件测试），DOM 结构变化由浏览器实测与 E2E 覆盖 | 本地通过（E2E + 浏览器实测） |
| TASKGROUP-MODAL-E2E-001 | Playwright | 真实浏览器关键路径 | `task-groups.spec.ts` 2/2（16.3s）：弹窗内 `.task-group-member` 行、`.task-group-member-title` 与行内「解除合并」按钮按 role 定位仍成立，`global-teardown` 清理夹具（账号 2、项目 2、业务行 113、审计行 9） | 本地通过 |
| TASKGROUP-MODAL-BROWSER-001 | 浏览器实测 | 分支行布局、徽章、配色与功能名 | `/tasks` 打开 `INPULSE-TG-1`：T-20 `task-group-member tone-prio-done`（底 `rgb(238,248,243)`、条 `rgb(52,129,93) 3px inset`）徽章「INPULSE-T-20 / 主任务 / 已完成 / 紧急」、无解除合并；T-21 同色系「历史来源分支 / 已完成 / 低 / 解除合并」；T-59 `tone-prio-urgent`（底 `rgb(253,242,241)`、条 `rgb(192,69,63)`）「活动来源分支 / 未完成 / 紧急 / 解除合并」；三行 `unmergeInHead` 为 true/false/true 且均无 `.task-group-member-actions`；元信息「负责人 X · 已发布记录 N 条 · 合并于 M月D日 · 功能 用户登录与会话管理」 | 本地通过 |
| TASKGROUP-MODAL-BROWSER-002 | 浏览器实测 | 记录侧功能名称 | 打开「聚合读接口聚合组」：记录元信息为「9月21日 发布 · 功能 聚合读接口功能B / 功能 聚合读接口功能A」，成员名称为「功能 聚合读接口功能A / B」；`INPULSE-TG-1` 的记录 `INPULSE-CR-8` 为模块级（`featureId: null`）故只显示「9月12日 发布」，与契约的「模块级不渲染功能名」一致 | 本地通过 |

本地实际执行（2026-09-21）：契约 `contract:generate`（5 产物）/ `contract:drift` / `contract:validate`（108 条）/ `permissions:check`（108/108）；API 定向单测 `aggregate-read.service.test.ts` 29/29 与真库 `aggregate-read-api.integration.test.ts` 20/20；Web 全量单测 84 文件 544 例、`tsc --noEmit`、`check:boundaries`（280 模块 / 1370 依赖）与生产构建、API `tsc --noEmit`；改动文件 ESLint、全仓 `prettier --check .`（All matched files）与 `check:docs`（84 个 Markdown）通过；Playwright `task-groups.spec.ts` 2/2；浏览器实测见上表（本地 dev 5173，登录账号在既有项目 1 与夹具项目上只读查看，记录侧名称样例取自当次夹具组，未提交任何写操作）。真库与 E2E 测试后已按 2026-09-17 指示运行 `apps/e2e/helpers/fixture-cleanup.ts`（删除夹具账号 4、项目 3、业务行 119、审计行 0）与 Playwright `global-teardown` 清理。

未运行 / 已知偏差：① `pnpm test:unit` / `test:integration` / `test:e2e` 全量与 `pnpm check` 整链、`check:deps` / `check:secrets` / `check:deploy:test` 与 GitHub Actions 未运行；② 本批含契约与后端改动，不适用 2026-09-17 的纯前端免测试指示，须非作者人工评审（契约新增字段、`FeatureReadPort` 注入与两处名称解析、Route Registry 摘要变更是重点）；③ DETACHED 分支保持灰色历史样式（不按优先级上色）是刻意保留的状态区分，如产品希望历史分支也上色需再改；④ 分支行仍不显示截止时间与工作量等字段，R-1 未扩；⑤ 记录侧只显示功能名称，模块级记录不显示功能名与模块名（`featureId` 为 null），如需显示模块名需再扩契约；⑥ 浏览器实测的「记录侧功能名称（非空分支）」样例来自当次夹具数据，清理后真实数据只剩模块级记录样例。

## 任务卡片实色配色（D2，2026-09-21 本地落库）

产品反馈「任务卡片不够醒目」。先按真实页面渲染了 7 套候选方案（含「紧急 / 高 / 普通 / 低 / 已完成 / 已取消」六色全展示），产品选定 D2「实色更艳」：卡片整卡铺优先级实色 + 白字，只有「低 / 已取消」保持浅底深字（「低」后改为白底）。

锁定口径：

- 卡片实色写在 `design-system.css` 末尾新增的「任务卡片醒目配色」块，选择器为 `:is(.calm-task-card, .tb-card).tone-prio-*`（比 `.tone-prio-*` 高一级，因此不影响列表行 / 表格行）：紧急 `#ce342b`（2026-09-22 红档取中，原 `#e84138`）、高 `#ffdb4d`（明黄底 + 深棕字 `#3f2d00`）、普通 `#337ee6`、已完成 `#e1f2f2`（青碧底 + 深青字 `#1d5b62`，描边 `#bcdddf` / 悬停 `#d6edee`；2026-09-22 末轮按样板 D「青碧」定案，三处表面同值，上一版的看板覆盖块已删除）。
- 「低」`#ffffff` 白底、「已取消」`#f2f5f8` 浅灰底，均保留深色正文，低优先级不抢注意力；`.tone-prio-*` 的原有浅色值本次未改，继续供列表行与表格行使用。
- 「已完成」与「高」同属浅底卡：深字组颜色由 `--task-ink-*` 变量统一驱动，两张卡只在各自色值块里赋值，改底色只需改一处（「已完成」2026-09-22 只保留一处色值块，见下）。
- 2026-09-22 「已完成」改 D 青碧（产品要求「这个改成这个颜色 **D** 青碧 #e1f2f2 / #bcdddf，这个排序按照完成时间，越晚越排前面」）：基础块 `:is(.calm-task-card, .tb-card).tone-prio-done` 改为 `#e1f2f2` / `#bcdddf` / `#d6edee` + 深青字 `#1d5b62`（对比度 6.67:1），`.tb-card.tone-prio-done` 覆盖块**删除**，任务中心、项目任务面板与任务看板回到同一套值；列表行 `.tone-prio-done` 与看板表格行 `.tb-row--done` 同步换值。上一版「任务中心 `#cdf1d3`、看板 `#eef8f3`」的分色作废（历史见 CARD-COLOR-BROWSER-014 ~ 017）。
- 2026-09-22 「已完成」排序改为按完成时间倒序：服务端统一排序键在状态分组之后新增 `COALESCE(completed_at, '-infinity') DESC` 一级，`TASK_LIST_SORT_KEY_VERSION` 由 2 升到 3（载荷 6 段 → 7 段），前端 `gridEntries` 同步插入 `completedRankOf`，见 CARD-COLOR-UNIT-012 / CARD-COLOR-API-003。
- 卡片描边统一 2px；卡片不再显示左侧色条（`::before { display: none }`）——整卡底色已表达优先级，多一条深色边在实色卡上显得脏（产品 2026-09-21 反馈「这个边边不要了」后去掉）。
- 实色卡反白范围：标题、正文、归属行、负责人行、底部标签组 / 截止行、`.badge`（半透明白底）、`.tb-date`、`.tb-dot-sep`、`.tb-check`；卡内不再有编号（只有列表视图显示编号）与页脚徽章，原先两条「页脚徽章反相成白底深字」的规则已随页脚徽章一并删除。
- 不改列表行 / 表格行：`.feature-list-table tbody tr`（项目任务面板列表）与 `.tb-row--tone-*`（看板列表视图）继续用浅色底与色条——表格里深底配深字不可读。
- 优先级圆点（`priority-select-option.ts`）同步为卡片实色同值：URGENT `#ce342b`、HIGH `#8a6e00`、NORMAL `#337ee6`，LOW 保持中性灰 `#a0adb9`；`task-tone.ts` 的注释同步说明色值分两处维护。（2026-09-23 更新：「低」档位与它的 `#a0adb9` 圆点一并删除，未知优先级改按「普通」的 `#337ee6` 兜底；同日二次定案又把「高」的圆点由 `#8a6e00` 改成 `#337ee6`、「普通」的圆点由 `#337ee6` 改成中性灰 `#a0adb9`、未知兜底同改 `#a0adb9`，见末节。）
- 已知对比度（WCAG AA 正常文字要求 4.5:1，实测计算值）：2026-09-22 定色口径后普通白字 3.99:1；同日红档取中把紧急白字由 4.00:1 提到 5.09:1（已达标），已逾期 / 马上到期两档随整卡色一起退出（见下条）—— 仍是「普通 3.99:1 略低于 AA 门槛，16px 标题没问题、11–12px 小字严格说未达标」（产品已知悉并选择先定观感）；已完成深青字 6.67:1（`#e1f2f2` + `#1d5b62`，三处表面同值）、高（明黄底 `#ffdb4d` + 深棕字 `#3f2d00`）9.8:1（`#ffdb4d` 与 `#3f2d00` 的计算值为 9.76:1，此处按 9.8:1 记）。「高」原用土黄 `#c47b00` + 白字只有 3.4:1 未达 AA，按产品反馈换成明黄深棕字后已达标，不再保留已知取舍。（2026-09-23 二次定案后：明黄 9.8:1 随本轮退出，「高」接原「普通」的蓝、白字 3.99:1 的取舍随之转移到「高」上；「普通」改白底深字后不再有对比度取舍，见末节。）
- 2026-09-22 一度追加「三档整卡红」（紧急 `#e84138` / 已逾期 `#b3261e` / 马上到期 `#d9541b`，全部整卡铺色 + 白字）；同日三次定案后**已作废**，见本章末尾的「红档收敛成一支」。
- 2026-09-22 聚合组卡片按「组状态」定色（产品在候选样板上逐状态选定，`describeTaskGroup` 派生）：进行中 `tone-group-open` 实色靛蓝 `#5b6fd6` / 描边 `#4c5ebf` / 悬停 `#5467cb` + 白字（4.48:1）、已完成 `tone-group-done` 青碧 `#e1f2f2` / `#bcdddf` / `#d6edee` + 深青字 `#1d5b62`（6.67:1）、已关闭 `tone-group` 实色紫 `#7c6bd0` / `#6a58c0` / `#7361c8` + 白字（4.31:1）。此前组卡跟随分支的派生优先级（复用 `.tone-prio-*`、兜底浅紫 `#f8f6ff`），本轮起优先级只由页脚徽章表达。实色只加在 `.calm-task-card.task-group-card` 上（普通任务卡片与看板卡片不受影响），列表视图的组行继续用三支类名的浅色变量（左侧 3px 色条 + 浅色底）。
- 2026-09-22 卡片布局：任务编号与「未完成」徽章从卡片移除（编号只留在列表视图的标题下方）；`.calm-card-top` 整行删除，标签组（优先级 + 模块级 / 主任务 / 来源任务 / 遗留问题 / 已办结）落到分隔线以下的左下角，负责人拆成独立的 `.calm-card-assignee` 贴在分隔线上方并右对齐，截止时间仍在右下角。`h3` 成为卡片首行后上边距收到 `4px`。已完成 / 已取消仍保留状态徽章。
- 2026-09-22 「遗留问题」徽章：由遗留项转换而来的任务（`hasLeftoverSource`）在卡片与列表行固定用深锈红 `#8a2b06` 实底 + 白字（白字对比度 8.6:1），对应 `CalmBadgeTone` 的 `leftover` 档与 `.badge-leftover`；实色卡上「卡内所有 `.badge` 一律半透明白」的统一反白不再覆盖它，浅底卡同样取这条色值，四处（任务中心卡片、项目任务面板卡片与详情、任务看板卡片、看板列表行）同一文案同一底色。
- 2026-09-22 「遗留问题」整卡锈红（产品要求「遗留问题整个卡片都要是红色的」）：由遗留项转换而来的任务（`hasLeftoverSource`）整卡铺 `#8a2b06` / 描边 `#772505` / 悬停 `#7c2705` + 白字（8.65:1），列表行与表格行浅锈红 `#fbeee9` + `#8a2b06`，看板列表视图新增 `.tb-row--leftover`；`taskToneOf(priority, workStatus, hasLeftoverSource)` 的覆盖次序为完成态 → 已取消 → 紧急 → 遗留问题 → 优先级（2026-09-22 三次定案后只剩三个参数），因此遗留项来源的卡片恒为红系两档（紧急红 / 锈红）之一。卡片本身已是锈红时「遗留问题」徽章走半透明白底（`:is(.calm-task-card, .tb-card).tone-prio-leftover .badge-leftover`），其余四档实色卡上仍是深锈红实底。
- 2026-09-22 聚合组排序口径：未完成组按「未完成分支最高一档」排序（紧急 → 高 → 普通 → 低，同档保持 R-7 服务端顺序，卡片与列表共用）。同日一度落过「组卡底走日期档（未完成分支最早一条已逾期 → `tone-prio-overdue`、今天到期 → `tone-prio-soon`）」，该口径已按「红档收敛成一支」作废。
- 2026-09-22 三次定案「红档收敛成一支」（产品要求「`#CE342B` 紧急用这个颜色，然后逾期的不搞特殊了，原本的优先级是什么就呈现什么颜色，只是排序靠前，比紧急低一档」）：
  - 紧急由 `#e84138` 改为 `#ce342b`（描边 `#b12c25`、悬停 `#b92e27`，白字对比度 4.00:1 → 5.09:1），`priority-select-option.ts` 的 URGENT 圆点同步。
  - 已逾期 / 马上到期退出卡片配色：`TaskToneName` 的 `overdue` / `soon`、`.tone-prio-overdue` / `.tone-prio-soon` 两块实色、白字组里的两个选择器与 `due-tiers*.png` 样图全部删除；`taskToneOf` / `taskToneClassName` 从四个参数回到三个（`hasLeftoverSource` 升为第三个）。卡片一律按任务自己的优先级取色，「高」逾期仍是明黄、「普通」逾期仍是普通蓝（2026-09-23 二次定案后改为「高」蓝 `#337ee6`、「普通」白 `#ffffff`，见末节）；组卡同理（`K123-TG-1` 由逾期砖红回到派生优先级的普通蓝）。
  - 逾期改为只保留两处体现：① 排序——服务端 `apps/api/src/modules/tasks/task-list-order.ts` 的紧急桶重排为「遗留问题来源(0) → 标记紧急(1) → 已逾期(2) → 今/明日截止(3) → 其余(4)」，`TASK_LIST_SORT_KEY_VERSION` 由 1 升到 2（旧游标按无效游标拒绝）；② 日期文案——卡片右下角「已逾期 9月16日」/「今天截止」跟随卡内统一取色，白底表面（任务中心表格、项目任务面板列表、详情弹窗徽章、看板日期）仍用文字色 `#b3261e` / `#c9472c` 加粗。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| CARD-COLOR-UNIT-001 | Web 单元 | 优先级圆点与卡片实色同值 | `priority-select-option.test.ts`：URGENT / HIGH / NORMAL / LOW 分别返回 `#ce342b` / `#8a6e00` / `#337ee6` / `#a0adb9`，未知优先级回退低灰（2026-09-22 红档取中：紧急由 `#e84138` 改为 `#ce342b`）（2026-09-23 起该用例改判三档 + 「LOW / 未知值回退 `#337ee6`」，见末节；同日二次定案再改判 HIGH `#337ee6` / NORMAL `#a0adb9`、未知回退 `#a0adb9`，见末节） | 本地通过 |
| CARD-COLOR-BROWSER-001 | 浏览器实测 | 任务中心卡片实色 | 无头 Chromium 1440 宽（成员账号 `/tasks`）：`.calm-task-card.tone-prio-normal` 背景 `rgb(51, 126, 230)`、文字 `rgb(255, 255, 255)`（普通档 2026-09-22 随定色口径重测，见 CARD-COLOR-BROWSER-018）；`.tone-prio-high` 背景 `rgb(255, 219, 77)`、标题 `rgb(63, 45, 0)` | 本地通过 |
| CARD-COLOR-BROWSER-002 | 浏览器实测 | 看板卡片实色与卡内文字 | `/projects/1/task-board`：`.tb-card.tone-prio-high` 背景 `rgb(255, 219, 77)`，标题 / 编号 / meta / 日期 / 分隔符 / 徽章的计算色为 `#3f2d00` 或其透明变体；`.tone-prio-done` 背景 `rgb(238, 248, 243)`、描边 `rgb(212, 232, 221)`、卡内文字 `#2f4031` 系（分色定案后看板仍取该值，见 CARD-COLOR-BROWSER-016）（2026-09-23 二次定案后 `.tone-prio-high` 为蓝底 `rgb(51, 126, 230)` + 白字，见末节） | 本地通过 |
| CARD-COLOR-BROWSER-003 | 浏览器实测 | 项目任务面板卡片 | `/projects/1/modules/2/features/2` 的 `.calm-task-card.tone-prio-done`：背景 `rgb(205, 241, 211)`、描边 `rgb(163, 217, 176)`（任务中心档，分色见 CARD-COLOR-BROWSER-016、描边加深见 CARD-COLOR-BROWSER-017）、标题 `rgb(47, 64, 49)`、正文与底部行 `rgba(47, 64, 49, 0.8)`、优先级徽章白底深字 | 本地通过 |
| CARD-COLOR-BROWSER-004 | 浏览器实测 | 列表 / 表格行不被实色污染 | `/tasks` 切「列表」视图：`.task-center-table` 各行仍是浅色底深字（普通浅蓝、高浅橙），未出现深底深字 | 本地通过 |
| CARD-COLOR-BROWSER-005 | 浏览器实测 | 卡片不再出现左侧深色色条 | 无头 Chromium 1440 宽 `/tasks`：`.calm-task-card` 的 `::before` 计算 `display: none`，实拍黄卡（`.tone-prio-high`）与蓝卡左缘均无深色竖条 | 本地通过 |
| CARD-COLOR-UNIT-002 | Web 单元 | 任务中心卡片按优先级上色 + 列表文字色 | `TaskCenterPageView.test.tsx`：逾期卡 `my-task-801` 与今天到期卡 `my-task-802` 都不再改色，各自按优先级得 `calm-task-card tone-prio-normal`（2026-09-22 前是 `tone-prio-overdue` / `tone-prio-soon`，随「逾期的不搞特殊了」作废），两卡卡内仍保留「已逾期 …」「今天截止」文案；已完成卡 `my-task-803` 得 `tone-prio-done` 且卡内截止元素不带任何 `due-*` 类；列表视图里同三条分别落在 `td.due-overdue` / `td.due-soon` / 无色类 | 本地通过（2026-09-22 重跑） |
| CARD-COLOR-UNIT-003 | Web 单元 | 项目任务面板卡片与表格的截止判定 | `TasksPanel.test.tsx`：卡片视图的三张卡（已逾期 / 今天到期 / 明天到期）现在一律 `tone-prio-normal`——整卡底色只由优先级决定，日期不再改色；已完成卡仍 `tone-prio-done`；列表视图截止列逾期 `due-overdue`、今天到期 `due-soon`、更远日期与已完成逾期任务不上色（回归原先写死 `due-overdue` 的问题，该列是日期紧迫度唯一的颜色出口） | 本地通过（2026-09-22 重跑） |
| CARD-COLOR-UNIT-004 | Web 单元 | tone 映射：完成态优先、日期档退出配色 | `task-tone.test.ts`：`taskToneOf` 按优先级返回 `urgent` / `high` / `normal` / `low`，已完成 / 已取消覆盖优先级返回 `done` / `canceled`，遗留来源覆盖为 `leftover`（紧急与完成态仍优先），未知优先级按 `low` 兜底；`taskToneClassName` 输出 `tone-prio-*`，并断言不再产出 `tone-prio-overdue` / `tone-prio-soon`（逾期任务按自己的优先级取色） | 本地通过（2026-09-22 重跑） |
| CARD-COLOR-BROWSER-006 | 浏览器实测 | 任务中心卡片的整卡红（2026-09-22 已作废） | 随产品口径「逾期的不搞特殊了」作废：`.tone-prio-overdue` 整卡红已从样式表删除，逾期任务卡改为按自身优先级上色（新实测见 CARD-COLOR-BROWSER-024）。作废前记录：无头 Chromium 1500 宽（成员账号 `/tasks`）逾期卡 `.calm-task-card.tone-prio-overdue` 背景 `rgb(179, 38, 30)`、描边 `rgb(154, 33, 26)`、文字 `rgb(255, 255, 255)`；卡内截止文案是反白文字、无底色 | 已作废 |
| CARD-COLOR-BROWSER-007 | 浏览器实测 | 看板卡片的整卡红（2026-09-22 已作废） | 同 CARD-COLOR-BROWSER-006 一并作废：看板卡片不再有整卡红档，逾期分支卡只按优先级上色。作废前记录：`/projects/1/task-board` 的 `INPULSE-T-18` `.tb-card.tone-prio-overdue` 背景 `rgb(179, 38, 30)`，日期文案 `09-19 逾期` 随反白组变白 | 已作废 |
| CARD-COLOR-BROWSER-008 | 浏览器实测 | 白底表面只改文字色 | `/tasks` 切「列表」视图：`td.due-overdue` 为 `#b3261e` 加粗且无底色；任务详情弹窗 `.calm-due.due-red`（已逾期 6天）为 `rgb(179, 38, 30)`、底透明 | 本地通过 |
| CARD-COLOR-BROWSER-009 | 浏览器实测 | 已完成 / 已取消不参与红档 | `/projects/1/task-board`：48 张已完成卡全部保持 `rgb(238, 248, 243)` 底与 `rgb(47, 64, 49)` 文字，没有一张因日期变红 | 本地通过 |
| CARD-COLOR-UNIT-005 | Web 单元 | 卡片纵向排版：标签在左下角、负责人在分隔线上方（任务卡与聚合组卡同构） | `TaskCenterPageView.test.tsx` / `TasksPanel.test.tsx` 的对应用例：卡片不含 `.calm-card-top` 与 `.task-id`、TODO 卡片不渲染「未完成」徽章、`.task-card-badges` 是 `.calm-card-bottom` 的首个子元素（内含优先级与其他标签）、`.calm-card-assignee` 紧接在 `.calm-card-bottom` 之前且带「负责人：」标题；任务中心无迭代记录时 `.task-card-footer` 整块不渲染，已完成卡片仍保留「已完成」徽章 | 本地通过 |
| CARD-COLOR-BROWSER-010 | 浏览器实测 | 卡片纵向排版与顶部空档 | 无头 Chromium 1500 宽 `/tasks`：四张卡 `.calm-card-top` 与 `.task-id` 全为 null，标签组左缩进 24px（贴左）、负责人右缩进 24px（贴右）且位于分隔线上方 15px、截止时间在右下角；同页注入旧 `20px` 上边距复现改前态，测得标题上方空档 `44px → 28px`、卡片高度 `227px → 211px`；`/tasks?status=done` 与项目任务面板同款卡片一致 | 本地通过 |
| CARD-COLOR-UNIT-006 | Web 单元 | 遗留问题徽章取色 | `TaskCenterPageView.test.tsx` 与 `TasksPanel.test.tsx` 的用例断言「遗留问题」徽章带 `badge-leftover` 类（不再与优先级标签同款）；`task-board-format.ts` 的 `LEFTOVER_SOURCE_BADGE.className` 为 `badge badge-leftover`，看板卡片与列表行共用 | 本地通过 |
| CARD-COLOR-BROWSER-011 | 浏览器实测 | 遗留问题徽章在可承载卡片底色上的取值 | 无头 Chromium 1440 宽（本地 dev 5173，把遗留项卡片上的 tone 类逐档替换后读徽章计算值）：同一枚「遗留问题」徽章在 `tone-prio-urgent` / `normal` / `high` / `done` / `canceled` 五档卡片上恒为 `background rgb(138, 43, 6)` + `color rgb(255, 255, 255)`；卡片自身是 `tone-prio-leftover` 时，卡内所有 `.badge`（含「普通」「遗留问题」）统一转 `rgba(255, 255, 255, 0.18)` 底 + 白字。取样集合由旧八档收敛为五档——已逾期 / 马上到期两档卡片随整卡红一并作废 | 本地通过（2026-09-22 重测） |
| CARD-COLOR-BROWSER-012 | 浏览器实测 | 任务中心卡片网格宽屏四列 | 无头 Chromium（本地 dev 5173，成员账号 `/tasks`，只读浏览既有演示数据）依次取视口 1280 / 1360 / 1439 / 1440 / 1536 / 1680 / 1920：`1440px` 起首行四张、网格宽度自 1680px 起封顶 `1352px`；卡片宽度四列时为 `272px`（1440）/ `296px`（1536）/ `326px`（1680、1920），三列时为 `312px`（1280）/ `339px`（1360）/ `365px`（1439） | 本地通过 |
| CARD-COLOR-BROWSER-013 | Playwright E2E | 网格列数随视口切换 | `apps/e2e/tests/aggregate-views.spec.ts` 的 F-32 任务中心用例新增断言：`getComputedStyle(.calm-task-grid).gridTemplateColumns` 的拆分项数在 1439px 视口为 3、在 1440px 与 1680px 视口为 4，断言后把视口恢复 Desktop Chrome 缺省值 | 本地通过（`pnpm --filter @inpulse/e2e exec playwright test tests/aggregate-views.spec.ts --grep F-32`：1 passed / 15.3s） |
| CARD-COLOR-BROWSER-014 | 浏览器实测 | 「已完成」绿色第四轮放淡 | 无头 Chromium 1500 宽（本地 dev 5173 `/tasks?status=done`）：`.calm-task-card.tone-prio-done` 底色由 `rgb(168, 230, 176)` 变为 `rgb(205, 241, 211)`、描边 `rgb(221, 244, 225)`，悬停 `#c0ebc7`，深绿字 `#2f4031` 不动（对比度 7.7:1 → 9.0:1）；同轮另出五档候选实拍（`#a8e6b0` / `#bcebc4` / `#cdf1d3` / `#dcf6e1` / `#eaf9ee`）供人工挑选 | 本地通过 |
| CARD-COLOR-BROWSER-015 | 浏览器实测 | 「已完成」绿色定稿（按产品截图取色） | 无头 Chromium 1500 宽（本地 dev 5173）：产品给的截图卡片底色实测为 `#eef8f3`（原只用于列表行的浅色），据此把 `.calm-task-card.tone-prio-done` 与 `.tb-card.tone-prio-done` 改为底色 `rgb(238, 248, 243)`、描边 `rgb(212, 232, 221)`、悬停 `#ddf0e5`；深绿字 `#2f4031` 不变（对比度 10.2:1），任务中心与看板实测同款；该口径当天被分色定案回调（见 CARD-COLOR-BROWSER-016）：任务中心 / 项目任务面板回到 `#cdf1d3`，只有任务看板保留 `#eef8f3` | 本地通过 |
| CARD-COLOR-BROWSER-016 | 浏览器实测 | 「已完成」分色：任务中心 vs 任务看板 | 按产品要求「任务中心的颜色改为原来的，任务看板的用当前这个颜色」落地后，无头 Chromium 1500 宽（本地 dev 5173，成员账号，只读浏览既有演示数据）：`/tasks?status=done` 的 `.calm-task-card.tone-prio-done` 计算底色 `rgb(205, 241, 211)`（「原来的」`#cdf1d3`，9.0:1；描边当天由 `#ddf4e1` 加深为 `#a3d9b0`，见 CARD-COLOR-BROWSER-017）；`/projects/1/task-board` 的 `.tb-card.tone-prio-done` 计算底色 `rgb(238, 248, 243)`、描边 `rgb(212, 232, 221)`（保留 `#eef8f3` / `#d4e8dd`，10.2:1）；深绿字 `rgb(47, 64, 49)` 两处相同 | 本地通过（2026-09-22 末轮被 D 青碧统一取代，见 CARD-COLOR-BROWSER-026） |
| CARD-COLOR-BROWSER-017 | 浏览器实测 | 「已完成」卡描边加深 | 产品看落地卡后问「这个要不也加个边框」。实测确认 `.calm-task-card.tone-prio-done` 的默认描边 `#ddf4e1` 比底色 `#cdf1d3` 还浅、视觉上等于没有边框（产品截图里那张带边的卡是 hover 态的 `--task-ink-edge`），改为与其余实色卡同口径的「描边比底色深一档」`#a3d9b0`（对底色对比度 1.31:1，「紧急」为 1.32:1）；无头 Chromium 1500 宽复测 `/tasks?status=done` 与项目任务面板 `.calm-task-card.tone-prio-done` 计算描边 `rgb(163, 217, 176)`、底色 `rgb(205, 241, 211)`、标题 `rgb(47, 64, 49)`，任务看板 `.tb-card.tone-prio-done` 仍是 `rgb(238, 248, 243)` / `rgb(212, 232, 221)` | 本地通过（2026-09-22 末轮被 D 青碧统一取代，见 CARD-COLOR-BROWSER-026） |
| CARD-COLOR-BROWSER-018 | 浏览器实测 | 卡片实色按「全色样板」定色口径重定（2026-09-22，紧急色同日再取中） | 无头 Chromium 1440 宽（本地 dev 5173，真实样式表，逐个注入 tone 类读计算值）：任务中心卡片 urgent 底 `rgb(206, 52, 43)` / 边 `rgb(177, 44, 37)`（`#ce342b` / `#b12c25`，2026-09-22 红档取中，旧 `#e84138` / `#c83830`）、normal 底 `rgb(51, 126, 230)` / 边 `rgb(44, 108, 198)`（`#337ee6` / `#2c6cc6`）、high 底 `rgb(255, 219, 77)` / 边 `rgb(214, 184, 65)` / 字 `rgb(63, 45, 0)`（2026-09-23 二次定案后为底 `rgb(51, 126, 230)` / 边 `rgb(44, 108, 198)` / 白字，见末节）、low 底 `rgb(255, 255, 255)`、done 底 `rgb(205, 241, 211)` / 边 `rgb(163, 217, 176)`、canceled 底 `rgb(242, 245, 248)`、leftover 底 `rgb(138, 43, 6)`；已逾期 `#b3261e` 与马上到期 `#d9541b` 两档随「逾期不搞特殊」整档删除，页面内 `.tone-prio-overdue` / `.tone-prio-soon` 节点数为 0；任务看板 `.tb-card` 同值，其中 `tone-prio-done` 当日仍为底 `rgb(238, 248, 243)` / 边 `rgb(212, 232, 221)`（2026-09-22 末轮统一为 `rgb(225, 242, 242)` / `rgb(188, 221, 223)`，见 CARD-COLOR-BROWSER-026）；列表行 / 表格行的浅色 `.tone-prio-*` 块未被污染 | 本地通过（2026-09-22 重测） |
| CARD-COLOR-UNIT-007 | Web 单元 | 聚合组卡片按未完成分支的最高优先级取色 | `TaskCenterPageView.test.tsx` 的聚合组用例：仍有未完成分支的组卡与组行得 `tone-prio-urgent`（优先级徽章与整卡底色同源）、紧急分支完成后落到 `tone-prio-high`、分支全部收尾后转 `tone-prio-done` 且不再渲染优先级徽章；组卡无 `.calm-card-top` 与 `.task-id`、标签组在 `.calm-card-bottom > .task-card-badges`、负责人是底部行的前一个兄弟节点 | 本地通过（2026-09-22 改口径后重跑） |
| CARD-COLOR-BROWSER-019 | 浏览器实测 | 聚合组卡片按派生优先级的实际取色 | 无头 Chromium 1440 宽（本地 dev 5173，真实样式表，把六支 tone 类逐档注入真实组卡后读计算值）：`tone-prio-urgent` 底 `rgb(206, 52, 43)` / 边 `rgb(177, 44, 37)` / 标题白字、`tone-prio-high` 底 `rgb(255, 219, 77)` / 边 `rgb(214, 184, 65)` / 标题 `rgb(63, 45, 0)`、`tone-prio-normal` 底 `rgb(51, 126, 230)` / 边 `rgb(44, 108, 198)` / 标题白字、`tone-prio-low` 底 `rgb(255, 255, 255)` / 边 `rgb(217, 224, 231)`、`tone-prio-done` 底 `rgb(205, 241, 211)` / 边 `rgb(163, 217, 176)` / 标题 `rgb(47, 64, 49)`、`tone-prio-canceled` 底 `rgb(242, 245, 248)` / 边 `rgb(213, 221, 228)`；真实数据 `K123-TG-1` 组卡为 `tone-prio-normal`；三支旧组状态类（`tone-group-open` / `tone-group-done` / `tone-group`）已随规则删除，注入后不再产生任何底色（2026-09-23 更新：`tone-prio-low` 已随「低」档位删除，现只剩五支 tone 类，本行为当日测量事实，见末节） | 本地通过（2026-09-22） |
| CARD-COLOR-BROWSER-020 | 浏览器实测 | 聚合组卡片排版与任务卡逐行同构 | 无头 Chromium 1440 宽 `/tasks`（本地 dev 5173，真实数据只读，`K123-TG-1`）：`className=calm-task-card task-group-card tone-prio-normal`；子元素序列为 `H3 → P.task-belonging → DIV.calm-card-assignee → DIV.calm-card-bottom`，与相邻任务卡逐项相同；`.task-group-card-top`、`.calm-card-top`、`.task-id` 均为 null（右上角计数行已删除，编号只留在列表视图与弹窗）；`.calm-card-assignee` 的 `justify-content: flex-end` 且 `nextElementSibling` 是 `.calm-card-bottom`；标签组在 `.calm-card-bottom > .task-card-badges` 内、顺序为「普通 / 聚合组 / 未开始」（徽章 title 为「聚合组：包含 2 条分支（主分支与全部来源分支）」「0 / 2 条分支任务已完成」）；底部行右侧是时钟图标 + 截止文案（该组取未完成分支中最早的一条）；`.task-card-footer` 与 `.task-group-card-open` 均为 null；组卡与相邻任务卡实测高度同为 241px | 本地通过（2026-09-22） |
| CARD-COLOR-API-001 | 真实 PostgreSQL 集成 + 浏览器 E2E | 聚合组三态依赖的 R-7 分支事实字段 | `apps/api/test/aggregate-read-ports.integration.test.ts` 新增用例：`TaskQueryPort.listByIds` 的 `dueAt` 必须是 `Date`（时间列在驱动层以文本返回，读取边界还原）、优先级透传、无截止为 `null`；`apps/e2e/tests/task-groups.spec.ts` 两例通过，任务中心组卡断言「未开始」+「聚合组」+「普通」徽章 + `tone-prio-normal` 类名 + `.task-group-card-top` 数量为 0（真实 PostgreSQL + 新 API dist + 生产构建） | 本地通过 |
| CARD-COLOR-UNIT-008 | Web 单元 | 聚合组状态三态与「已完成」档归属 | `TaskCenterPageView.test.tsx`：无分支完成的组卡状态徽章为「未开始」（`badge-gray`、title「0 / 4 条分支任务已完成」、整卡仍是未完成分支最高一档的 `tone-prio-urgent`）、有分支完成为「进行中」（title「1 / 4 条分支任务已完成」）、全部分支收尾为「已完成」（`tone-prio-done`、title「3 / 4 条分支任务已完成」，已取消分支算收尾但不计入完成数）；同一条用例断言全部分支收尾的组在 `status=open` 档位下不再渲染组卡（未入组的任务卡照常出现），在 `status=done` 档位下可见 | 本地通过（2026-09-22） |
| CARD-COLOR-BROWSER-021 | 浏览器实测 | 组卡跟随「未完成 / 已完成」档位 | 无头 Chromium 1440 宽（本地 dev 5173，真实数据只读）：默认 `/tasks` 的 `K123-TG-1`（2 条分支都未完成）出现在「未完成」档、状态徽章「未开始」；`/tasks?status=done` 下 `.task-group-card` 数量为 0（该组仍有未完成分支，不归「已完成」档） | 本地通过（2026-09-22） |
| CARD-COLOR-UNIT-009 | Web 单元 | 「遗留问题」来源的 tone 映射与卡片 / 行类名 | `task-tone.test.ts`：普通 / 高 / 低的遗留项来源都返回 `leftover`（`taskToneClassName` 输出 `tone-prio-leftover`）、紧急仍返回 `urgent`、已完成 / 已取消仍 `done` / `canceled`、非遗留项不受影响（已逾期 / 今天到期不再改变 tone，随「逾期不搞特殊」作废）；`TaskCenterPageView.test.tsx`：遗留项卡片得 `calm-task-card tone-prio-leftover`、卡内「遗留问题」徽章带 `badge-leftover`、列表视图同一行的 `tr` 也是 `tone-prio-leftover`；`TasksPanel.test.tsx`：遗留项来源卡片得 `tone-prio-leftover`，同页非遗留项卡片仍是 `tone-prio-normal` | 本地通过（2026-09-22 重跑） |
| CARD-COLOR-UNIT-010 | Web 单元 | 未完成组按未完成分支最高优先级排序 + 组卡不吃日期档 | `TaskCenterPageView.test.tsx`：mock 三条未完成组（903 普通 / 902 紧急 / 901 高，R-7 按 id 倒序返回）渲染顺序收敛为 902 → 901 → 903，分别断言 `tone-prio-urgent` / `tone-prio-high` / `tone-prio-normal`，说明排序键是「未完成分支最高一档」（2026-09-23 更新：第三条组由「低」改判 `HIGH`，期望顺序与断言同步为 902 → 901 → 903，见末节）；组卡不再走日期档——分支 T-101 已逾期时组卡仍是派生优先级的 `tone-prio-urgent`，逾期只体现在右下角「已逾期 …」文案，紧急分支完成后落到 `tone-prio-high`，全部分支收尾转 `tone-prio-done`；同日追加「（它们）同样是一个优先级的，按照截止日期从近到远排序」后，组卡不再固定追加在网格尾部，见 CARD-COLOR-UNIT-011 | 本地通过（2026-09-22 重跑） |
| CARD-COLOR-BROWSER-022 | 浏览器实测 | 「遗留问题」整卡锈红与列表行同源 | 无头 Chromium 1440 宽（本地 dev 5173，真实数据只读）：`/tasks` 的 `A-5 残余：5 年峰值模型定稿与 1.2 倍条件人工复核`（`hasLeftoverSource`、普通、未逾期）得 `calm-task-card tone-prio-leftover`、背景 `rgb(138, 43, 6)`、描边 `rgb(119, 37, 5)`、文字 `rgb(255, 255, 255)`，卡内「普通」与「遗留问题」徽章均为 `rgba(255, 255, 255, 0.18)` 底 + 白字；同页相邻 `A-6` 仍 `rgb(255, 219, 77)`、`呈现出` 仍 `rgb(51, 126, 230)`、逾期组卡仍 `rgb(179, 38, 30)`；切「列表」视图后该行类名 `tone-prio-leftover`、底色 `rgb(251, 238, 233)`、标题 `rgb(138, 43, 6)` | 本地通过（2026-09-22） |
| CARD-COLOR-BROWSER-023 | 浏览器实测 | 组卡不吃日期档：含已逾期分支的组卡按派生优先级取色 | 无头 Chromium 1440 宽（本地 dev 5173，真实数据只读）：`K123-TG-1`（2 条分支都未完成、最早截止已逾期）为 `calm-task-card task-group-card tone-prio-normal`、背景 `rgb(51, 126, 230)`、描边 `rgb(44, 108, 198)`、白字，状态徽章仍是「未开始」，右下角仍是「已逾期 9月16日」；上一版「组卡底走日期档、整卡转红」的实测已作废 | 本地通过（2026-09-22 重测） |
| CARD-COLOR-BROWSER-024 | 浏览器实测 | 红档取中 + 逾期退出整卡色（2026-09-22 三次定案） | 无头 Chromium 1440 宽（本地 dev 5173，成员账号，真实数据只读）：`/tasks` 卡片顺序为「A-5 残余…」遗留问题（底 `rgb(138, 43, 6)` / 边 `rgb(119, 37, 5)`）→ `222` 紧急（底 `rgb(206, 52, 43)` / 边 `rgb(177, 44, 37)` / 白字）→ `A-6` 高（底 `rgb(255, 219, 77)` / 字 `rgb(63, 45, 0)`）→ `呈现出` 普通（底 `rgb(51, 126, 230)`）→ 组卡 `啊J`（`tone-prio-normal`、底 `rgb(51, 126, 230)`、右下角「已逾期 9月16日」）；逐档注入得 urgent `rgb(206, 52, 43)` / `rgb(177, 44, 37)`、normal `rgb(51, 126, 230)`、high `rgb(255, 219, 77)` + `rgb(63, 45, 0)`、low `rgb(255, 255, 255)`、done `rgb(205, 241, 211)` + `rgb(47, 64, 49)`、canceled `rgb(242, 245, 248)`、leftover `rgb(138, 43, 6)`；页面内 `.tone-prio-overdue` / `.tone-prio-soon` 节点数均为 0；列表视图 `tone-prio-leftover` 行底 `rgb(251, 238, 233)`（只走浅色变量，未受实色改动影响） | 本地通过（2026-09-22） |
| CARD-COLOR-API-002 | 真实 PostgreSQL 集成 | 逾期降到紧急下一档的排序与游标 | `apps/api/test/aggregate-read-ports.integration.test.ts`（真实 PostgreSQL 18 + PGroonga，23 例通过）：紧急桶用例断言同状态分组内顺序为 `leftover → urgent → overdue → dueSoon → other → tieA → tieB`，已完成 / 已取消分组不参与紧急桶；keyset 分页用例按新序造数后跨页取回不漏不重；`apps/api/src/modules/tasks/task-list-order.ts` 的 `TASK_LIST_SORT_KEY_VERSION` 由 1 升到 2，版本不符的旧游标由 `parseTaskListSortKey` 返回 null 后按无效游标拒绝；`aggregate-read.service.test.ts` / `aggregate-read-cursor.test.ts` 的游标断言同步为 `2|0|4|2||501`（2026-09-22 末轮版本再升到 3、载荷 7 段，断言为 `3|0||4|2||501`，见 CARD-COLOR-API-003） | 本地通过（2026-09-22） |

| CARD-COLOR-WEB-001 | Web 单元 | 前端不回归 | `pnpm --filter @inpulse/web test`：85 文件 560 例通过（含卡片纵向排版、聚合组状态三态、「遗留问题」整卡锈红与「逾期不再整卡换色」用例；2026-09-22 本轮改动后重跑为该值，此前一版为 558 例） | 本地通过（2026-09-22 重跑） |
| CARD-COLOR-DOC-001 | 文档同步 | 六种程度配色可查阅 | 新增 `docs/task-card-colors.md`《任务卡片配色规范》：六种程度的卡片底色 / 描边 / 悬停 / 文字 / 对比度、卡内元素取色、看板卡片、列表行浅色对照、下拉圆点色、实现位置与变更历史；`README.md` 文档索引已登记；`pnpm check:docs` 通过（85 个 Markdown） | 本地通过 |
| CARD-COLOR-GATE-001 | 静态门禁 | 类型、风格、依赖边界与文档 | 历史：整链 `pnpm typecheck`（8 个 workspace）、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`（281 模块 1370 依赖）、`pnpm check:docs`（85 个 Markdown 文件）通过。2026-09-22 本轮定向执行：`pnpm --filter @inpulse/web exec tsc --noEmit`、`pnpm exec prettier --write`（15 个改动文件）、`pnpm exec eslint`（11 个改动文件，无输出）、`pnpm format:check`、`pnpm check:docs`（86 个 Markdown 文件，链接与锚点有效）通过；未运行整链 `pnpm typecheck` / `pnpm lint` / `pnpm build` / `pnpm check` 与 GitHub Actions（`apps/api` 仍有 3 处与本轮无关的 `PROJECT_ADMIN` 类型错误） | 本地部分通过 |

本地实际执行（2026-09-22 三档整卡红 + 卡片布局两次调整）：「三档整卡红」的浏览器实测见 CARD-COLOR-BROWSER-006 / 007 / 008 / 009，卡片纵向排版与顶部空档见 CARD-COLOR-BROWSER-010；`pnpm --filter @inpulse/web test`（85 文件 544 例）、`pnpm typecheck`（8 个 workspace）、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`、`pnpm check:docs`（85 个 Markdown）通过；「遗留问题」徽章取色见 CARD-COLOR-UNIT-006 / CARD-COLOR-BROWSER-011；`docs/task-card-colors.md` 的《逾期与马上到期：三档整卡红》《卡片纵向排版》两节与两张配图 `due-tiers.png` / `due-tiers-board.png` 同步。宽屏网格列数见 CARD-COLOR-BROWSER-012 / CARD-COLOR-BROWSER-013，`docs/task-card-colors.md` 新增《宽屏网格列数》一节。「已完成」绿色第四轮放淡见 CARD-COLOR-BROWSER-014。定稿（按产品截图取 `#eef8f3`、取消中间档）见 CARD-COLOR-BROWSER-015，随后按产品要求分色（任务中心 / 项目任务面板回到 `#cdf1d3`、只有看板保留 `#eef8f3`）见 CARD-COLOR-BROWSER-016；`docs/task-card-colors.md` 新增《「已完成」：任务中心与看板分色》一节。「已完成」卡描边加深见 CARD-COLOR-BROWSER-017。

本地实际执行（2026-09-22 聚合组卡片口径回退与排版对齐）：`pnpm --filter @inpulse/web test`（85 文件 552 例）、`pnpm --filter @inpulse/web typecheck`、`pnpm exec prettier --write`（改动文件无变化）通过；浏览器实测见 CARD-COLOR-BROWSER-019 / 020（无头 Chromium 1440 宽指向本地 dev 5173，只读浏览既有演示数据，未新增或修改业务数据）；Playwright 定向 `apps/e2e/tests/task-groups.spec.ts` 2/2 通过（本地 PostgreSQL 18 + PGroonga、生产构建 + `vite preview`、端口 3188/4188）；`docs/task-card-colors.md` 的《聚合组卡片》章节按新口径重写并重出配图 `group-states.png`。

本地实际执行（2026-09-22 聚合组状态三态与组卡排版对齐统一）：`pnpm --filter @inpulse/web test`（85 文件 554 例）、`pnpm --filter @inpulse/web typecheck`、`pnpm exec prettier --write`（改动文件无变化）通过；浏览器实测见 CARD-COLOR-BROWSER-020 / 021（无头 Chromium 1440 宽指向本地 dev 5173，只读浏览既有演示数据，未新增或修改业务数据）；`pnpm exec eslint`（改动的 web 两个文件与 e2e 规格）、`pnpm format:check`、`pnpm check:docs`（86 个 Markdown，链接与锚点有效）通过；Playwright 定向 `apps/e2e/tests/task-groups.spec.ts` 2/2 通过（本地 PostgreSQL 18 + PGroonga、生产构建 + `vite preview`、端口 3188/4188）；`docs/task-card-colors.md` 的《聚合组卡片》章节与配图 `group-states.png` 按新结构（无右上角计数行、三枚徽章 + 右下角截止）重出。
本地实际执行（2026-09-22 红档取中与逾期退出整卡色）：`pnpm --filter @inpulse/web test`（85 文件 557 例）、`pnpm --filter @inpulse/web exec vitest run`（5 个定向文件 91 例）、`pnpm --filter @inpulse/api exec vitest run test/aggregate-read.service.test.ts test/aggregate-read-cursor.test.ts`（37 例）、真实 PostgreSQL 集成 `--config vitest.integration.config.ts test/aggregate-read-ports.integration.test.ts`（23 例；首次因 keyset 用例造数顺序与新排序不符失败 1 例，修正后通过）、`pnpm --filter @inpulse/web exec tsc --noEmit`、`pnpm exec prettier --write`（15 个改动文件）、`pnpm exec eslint`（11 个改动文件）、`pnpm format:check`、`pnpm check:docs`（86 个 Markdown 文件，链接与锚点有效）通过；浏览器实测见 CARD-COLOR-BROWSER-024（无头 Chromium 1440 宽指向本地 dev 5173，只读浏览既有演示数据，未新增或修改业务数据）；`docs/task-card-colors.md` 的《逾期与马上到期》一节改写为「不再整卡换色」，配图 `due-tiers.png` / `due-tiers-board.png` 一并删除。未运行：整链 `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm check`、`pnpm test:e2e`（Playwright；`apps/e2e/tests/task-groups.spec.ts` 的断言已按新口径同步但本轮未跑）、GitHub Actions；`apps/api` 的 3 处 `PROJECT_ADMIN` 类型错误与本轮无关，未修。

本地实际执行（2026-09-22 聚合组排序与逾期底色 + 「遗留问题」整卡锈红）：`pnpm --filter @inpulse/web test`（85 文件 558 例，含新增的 `task-tone.test.ts` 遗留项覆盖次序用例、`TaskCenterPageView.test.tsx` 的遗留项卡片 / 列表行用例与未完成组排序用例、`TasksPanel.test.tsx` 的遗留项卡片取色断言更新；本轮首次全量运行时 `src/app/router/app-router.test.tsx` 因并跑负载超时失败一次，单跑与再次全量均通过）、`pnpm --filter @inpulse/web exec tsc --noEmit`、`pnpm exec eslint`（改动的 8 个 web 文件，无告警）、`pnpm exec prettier --write`（5 个文件格式化）通过；浏览器实测见 CARD-COLOR-BROWSER-022 / 023（无头 Chromium 1440 宽指向本地 dev 5173，只读浏览既有演示数据，未新增或修改业务数据）；Playwright 定向 `apps/e2e/tests/task-groups.spec.ts` 2/2 通过（本地 PostgreSQL 18 + PGroonga、既有 `apps/api/dist` + 生产构建与 `vite preview`、端口 3188/4188，夹具在 teardown 清理）；`docs/task-card-colors.md` 新增《「遗留问题」：整卡锈红》一节、列表行表格补一行、聚合组章节补排序与日期档两条、实现位置与变更历史同步。未运行：`pnpm lint` 整链、`pnpm format:check`、`pnpm check:docs`、`pnpm check:frontend:boundaries`、`pnpm build`（`apps/api` 有与本轮无关的 3 处 `PROJECT_ADMIN` 类型错误）、`pnpm test:e2e` 全量、真实 PostgreSQL 集成测试与 GitHub Actions。

本地实际执行（2026-09-21）：`pnpm --filter @inpulse/web test`（85 文件 536 例）、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`、`pnpm check:docs`；浏览器实测见上表（无头 Chromium 指向本地 dev 5173，只读浏览既有演示数据，未新增或修改业务数据）。

未运行 / 已知偏差：① 未新增 Playwright 配色断言，`pnpm test:e2e` 未实跑（本地没有独立 E2E 数据库 `E2E_DATABASE_URL`，未拿演示库代替）；② 「高」已由土黄 `#c47b00` 换成明黄 `#ffdb4d` + 深棕字 `#3f2d00`（9.8:1），对比度不再有未达标项（2026-09-23 二次定案后「高」改蓝、白字 3.99:1，对比度取舍回到「高」上，见末节）；③ 实色配色目前只覆盖卡片，看板 / 任务中心的列表行仍是浅色底，两者并存是刻意选择；④ 配色属视觉主观项，需非作者人工评审；⑤ 未跑 `pnpm build`、`check:deps`、`permissions:check`、真实 PostgreSQL 集成测试与 GitHub Actions。

## ADR-039 移除项目管理员角色、项目内管理权下放全体活跃成员（A，2026-09-22 本地落库）

用户要求：「项目里面不需要有项目管理员，并且所有项目的成员所拥有的管理权限都和组长一样」。经确认锁定三条口径：
① 保留组长（`LEADER`）身份但管理权全员等同；② 存量 `PROJECT_ADMIN` 成员降级为 `MEMBER`；③ 整体移除「任命项目管理员」入口。
完整决策与边界见 [ADR-039](adr/ADR-039.md)；[ADR-033](adr/ADR-033.md)/[ADR-034](adr/ADR-034.md)/[ADR-035](adr/ADR-035.md) 的角色口径由本节修订。

锁定口径：

- 角色枚举收窄到 `MEMBER | LEADER`。`LEADER` 只是创建者/组长身份标识，不再附带任何额外管理权；`PROJECT_ADMIN` 从枚举、契约、权限矩阵与数据库中一并移除（迁移 `0019_drop_project_admin_role.sql`：先把存量 `PROJECT_ADMIN` 降级为 `MEMBER`，`SET CONSTRAINTS ALL IMMEDIATE` 结算 `project_members_bootstrap_complete` 延迟约束触发器事件后再收紧 `project_members_role_check` 为 `role IN ('MEMBER','LEADER')`；不改列定义、不递增 `row_version`、不写审计）。
- 13 条项目内管理操作的门禁统一放宽为「本项目任意活跃成员」：成员增删查、成员未完成任务读取、`archiveModule`/`restoreModule`、`archiveFeature`/`restoreFeature`、`archiveTask`/`restoreTask`、`archiveModuleTask`/`restoreModuleTask`、`changeProjectStatus`、`requestProjectArchive`。非成员/跨项目/已移除成员统一 404。
- 移除 7 个不再可达的错误码：`PROJECT_MEMBER_MANAGE_FORBIDDEN`、`PROJECT_MEMBER_LEADER_ASSIGN_FORBIDDEN`、`MODULE_MANAGE_FORBIDDEN`、`FEATURE_MANAGE_FORBIDDEN`、`TASK_ARCHIVE_FORBIDDEN`、`PROJECT_STATUS_FORBIDDEN`、`PROJECT_ARCHIVE_REQUEST_FORBIDDEN`（对 `apps/api/src` 全量 grep 已无残留）。
- `setProjectMemberRole` 路由保留但收窄为**系统管理员专属**：本项目成员（含 `LEADER`）调用返回 403 `PROJECT_MEMBER_ROLE_FORBIDDEN`，非成员 404，`role` 只接受 `MEMBER`/`LEADER`，其他值 422 `PROJECT_MEMBER_VALIDATION_FAILED`。
- 保留不变量：`project_members_one_leader` 部分唯一索引、`project_members_removed_role_check`（REMOVED 行 role=MEMBER）、移除/撤销 `LEADER` 时的 409 `PROJECT_MEMBER_LEADER_PROTECTED`、`PROJECT_MEMBER_LEADER_CONFLICT`、审计 `project.member.role.set` 与活动 `PROJECT_MEMBER_ROLE_CHANGED`。
- 幂等契约版本：只有重放响应体携带 `role`/`currentUserRole` 的操作才升版（`setProjectMemberRole` 1.0.0→2.0.0；`addProjectMember`/`removeProjectMember` 1.1.0→1.2.0；`updateProject`/`archiveProject`/`restoreProject` 1.4.0→1.5.0；`changeProjectStatus` 1.0.0→1.1.0；`createProject` 2.2.0→2.3.0），模块/功能/任务归档恢复与 `requestProjectArchive` 不变。
- 前端：`canManageProjectResources` 改为「系统管理员或本项目 `MEMBER`/`LEADER`」；成员页角色徽标只剩「组长」，「设置角色」仅系统管理员可见；「归档模块」「归档功能」入口对全体活跃成员可见。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| ADR039-DB-001 | PostgreSQL | 迁移 0019 收窄角色枚举 | 存量 `PROJECT_ADMIN` 全部降级为 `MEMBER`；`project_members_role_check` 变为 `role IN ('MEMBER','LEADER')`；`project_members_one_leader` 与 `project_members_removed_role_check` 不变；`database.test.ts` 不可变迁移清单新增 `0019_drop_project_admin_role.sql` | 本地通过（`db:migrate` 应用 0019，输出 `Migration complete: 1 applied, 19 already present.`） |
| ADR039-CONTRACT-001 | 契约与数据 | Schema、路由摘要与权限矩阵 | `projectMemberRoleSchema` 收窄为 `MEMBER`/`LEADER` 并传播到 `currentUserRole`、`ProjectMemberRecordItem.role`、`ActiveProjectMemberItem.role`、`setProjectMemberRoleRequest`；7 条 `permission-matrix.ts` 条目改为「活跃成员」口径；`pnpm contract:generate` 重生成 5 产物且生成客户端与 OpenAPI 内已无 `PROJECT_ADMIN` | 本地通过（`contract:generate`；`apps/web/src/generated/**` 已核对无残留） |
| ADR039-API-UNIT-001 | API 单元 | 角色门禁收窄与重放授权 | `ProjectRoleGateService.manageRole` 返回 `SYSTEM_ADMIN`/`MEMBER`/`LEADER`/`NOT_MEMBER`（不再有 `PROJECT_ADMIN`）；`roleSetterRole` 把 `LEADER` 与 `MEMBER` 一起折叠为 `MEMBER`（→403）；`setRole` 门禁非成员 404、非系统管理员 403 `PROJECT_MEMBER_ROLE_FORBIDDEN`、唯一冲突 409、移除 `LEADER` 409；HTTP 层 `{ role: "PROJECT_ADMIN" }` 422 | 本地通过（API 单测 65 文件 364 例） |
| ADR039-API-INT-001 | 真实 PostgreSQL | 成员管理全员可写 | `project-member-management-api.integration.test.ts`：普通成员查看成员列表、添加成员、移除成员均 200；非成员与已移除成员 404；`LEADER` 或普通成员调 `setProjectMemberRole` 403；`PROJECT_MEMBER_LEADER_PROTECTED` 与组长转移自动降级不变量保留 | 本地通过 |
| ADR039-API-INT-002 | 真实 PostgreSQL | 模块与功能归档全员可写 | `modules-api.integration.test.ts`：显式降级为 `MEMBER` 的成员创建模块并归档 → 200 / `ARCHIVED` / `rowVersion 2`；`features-api.integration.test.ts`：同样由 `MEMBER` 创建功能并归档 → 200 / `ARCHIVED` / `rowVersion 2`；组长路径用例不受影响 | 本地通过 |
| ADR039-API-INT-003 | 真实 PostgreSQL | 任务归档与项目状态全员可写 | `tasks-api.integration.test.ts`：`MEMBER` 归档自己创建的任务 → 200 / `ARCHIVED` / `rowVersion +1`；`project-management-api.integration.test.ts`：`MEMBER` `PATCH /projects/{id}/status` → 200 / `{ status: "ACTIVE", rowVersion: 2 }`，非成员 404、版本冲突与同态 409 | 本地通过 |
| ADR039-API-INT-004 | 真实 PostgreSQL | 归档申请门禁与任务前置校验分层 | `project-archive-request-api.integration.test.ts`：普通成员不再被角色拒绝，而是被状态门禁拦下 409 `PROJECT_ARCHIVE_TASKS_OPEN`（证明拒绝原因已不是权限）；组长提交与重放仍成功 | 本地通过 |
| ADR039-API-INT-005 | 真实 PostgreSQL | 读接口角色口径 | `projects-read-api.integration.test.ts`：活跃成员列表的 `role` 为 `LEADER`/`MEMBER`（夹具由 `PROJECT_ADMIN` 改为 `MEMBER`） | 本地通过 |
| ADR039-WEB-UNIT-001 | Web 单元 | 管理入口按成员身份显示 | `ProjectMembersPageView.test.tsx`：活跃成员可见「添加成员」与行内「移除」，「设置角色」只对系统管理员渲染；`ProjectsPageView`/`ModulesPageView`/`FeaturesPageView` 归档入口对 `MEMBER` 与 `LEADER` 均可见、对 `currentUserRole: null` 不可见；`TasksPanel.test.tsx` 生命周期入口同理 | 本地通过（Web 单测 84 文件 539 例） |
| ADR039-WEB-UNIT-002 | Web 单元 | 文案与错误码收敛 | `project-management-modals.test.tsx` 状态栏提示为「只有本项目活跃成员或系统管理员可以更改项目状态。」；`project-member-query.ts` 的 403 分支改写；`project-management-query.ts` 移除 `PROJECT_STATUS_FORBIDDEN` 与 `PROJECT_ARCHIVE_REQUEST_FORBIDDEN` 专用分支 | 本地通过 |
| ADR039-E2E-001 | Playwright | 成员视角关键路径 | `features.spec.ts` 在编辑弹层断言 `feature-modal-lifecycle` 可见（原「看不到归档功能」断言反转）；`modules.spec.ts` 断言编辑弹层「归档模块」可见；`project-members.spec.ts` 断言活跃成员可见「添加成员」与成员卡「移除」 | 本地通过（定向与全量分别执行，见下） |

本地实际执行（2026-09-22，Windows + PowerShell；真实 PostgreSQL 18.6 + PGroonga，集成库 `app` @ 127.0.0.1:55432）：
`pnpm contract:generate`（5 产物）、`pnpm contract:drift`（5 产物无漂移）、`pnpm contract:validate`（108 条路由）、`pnpm permissions:check`（108 操作 / 108 路由）通过；
`pnpm typecheck`（8 个 workspace 项目）、`pnpm lint`、`pnpm build`（web + api 生产构建）通过；
`pnpm test:unit` 通过：api 65 文件 364 例、web 84 文件 539 例、api-contract 16 文件 100 例、ops 8 文件 52 例、database 1 文件 15 例、canonical-json 1 文件 5 例；
`pnpm --filter @inpulse/api test:integration` 50 文件 480 例通过、`pnpm db:test` 通过（数据库单测 15 例 + 集成 2 文件 26 例）、`pnpm --filter @inpulse/e2e typecheck` 通过（迁移 0019 已先应用）；
`pnpm db:migrations:check`（20 个迁移）、`pnpm db:seed:check`、`pnpm check:deploy:test`、`pnpm check:deps`、`pnpm check:frontend:boundaries`（281 模块）、`pnpm check:secrets`（1057 文件）、`pnpm check:docs`（85 个 Markdown）通过；
`pnpm test:e2e` 全量 46 passed / 11 failed，其中本批改写的 `features.spec.ts`、`modules.spec.ts`、`project-members.spec.ts` 全部通过（`project-members.spec.ts` 单跑 2 passed / 10.3s），11 例失败全部落在与本批无关的既有用例（`record-drafts` ×3、`record-feed` ×1、`record-publishing` ×1、`task-completion` ×1、`search` ×1、`aggregate-views`/`external-links`/`leftover-task`/`module-tasks` 各 ×1），形态为 `[role="listbox"]` 选择器 strict-mode 命中 2 元素、`继续编辑` 按钮 strict-mode 冲突与 `browserContext.close` 竞态，均未触及项目成员 / 模块 / 功能 / 任务归档权限路径。

未运行 / 已知偏差：① `pnpm check` 整链与 GitHub Actions 未运行（各分项门禁已逐条单独执行，见上）；② `pnpm test:integration` 全包执行时 `@inpulse/ops` 2 例失败（`Error: pg_dump exited with code null`，本机未安装 `pg_dump`；`@inpulse/ops` 与 ADR-039 无关，API 与 database 集成测试单独执行全部通过）；③ 11 例 E2E 失败待单独定位，不属于本批改动范围；④ 存量 `PROJECT_ADMIN` 成员的降级是数据迁移，本地库已执行，远端环境需按运维流程应用 0019（不可逆：降级后原任命信息不再保留）；⑤ 本批含契约、迁移与后端改动，不适用 2026-09-17 的纯前端免测试指示，须非作者人工评审（迁移顺序、幂等版本升版范围与 7 个已删错误码是重点）。

## 2026-09-22 任务中心聚合组卡可见性收窄（R-7）

产品要求（原文）：「需要完成聚合组的任务卡只有所属负责的人可以看到，而不是所有人都可以看到未完成，没关系的人不需要看到」。本批采用的口径（记录为本次裁决，未另立 ADR：只收窄可见性，不改 ADR-030/037 的聚合组语义）：**「所属负责人」= 该聚合组任一 `status = 'ACTIVE'` 分支任务的负责人**；系统管理员不开例外；已解除（`DETACHED`）分支不参与判定，因此组关闭（成员全部解除）后对所有人不再返回。R-1 详情（`getTaskGroup`）不受影响，仍是项目成员可读，历史成员不丢。

- 收窄固定在服务端执行（AGENTS.md §7：鉴权不得依赖客户端）：`TaskGroupListReadInput` 新增 `actorUserId`，`TaskGroupRepository.listGroupsPage` 在 `project_id = ANY(...)` 之外追加 `EXISTS (SELECT 1 FROM app.task_group_members m JOIN app.tasks t ON t.id = m.task_id AND t.project_id = m.project_id WHERE m.project_id = tg.project_id AND m.group_id = tg.id AND m.status = 'ACTIVE' AND t.assignee_id = $actor)`；`task_group_members` 没有 `assignee_id` 列，判定必须回落到任务表的实时负责人。
- 前端零改动：`TaskCenterPageView` 的 `groups` 与 `hasListContent` 直接消费服务端结果，收窄后「与我无关的组」不会到达渲染层。
- 游标 `filterKey` 保持 `JSON.stringify([projectId ?? null])` 不变：可见性已由 actor 绑定承载（游标本就绑定 `actorUserId`），同一用户口径不变，未升版、未让已签发游标失效。
- 契约表面无新增参数：只有 R-7 `summary`（Route Registry → OpenAPI）与 [权限矩阵](permissions.md) 聚合组列表行同步口径；`permission-matrix.ts` 条目仍是「活跃成员 allow」（可调用性不变，返回集合收窄）。

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| TASKGROUP-VISIBILITY-CONTRACT-001 | 契约 | R-7 摘要与 OpenAPI 同步可见性口径 | `contract:generate`（5 产物）、`contract:drift`（5 产物一致）、`contract:validate`（108 条路由）、`permissions:check`（108/108）全过；OpenAPI `listTaskGroups` summary 含「与自己无关的组不返回」 | 本地通过 |
| TASKGROUP-VISIBILITY-API-UNIT-001 | API 单元 | 端口入参携带 `actorUserId` | `aggregate-read.service.test.ts` R-7 断言 `listGroups` 收到 `{ actorUserId, projectIds, limit }`（含 `projectIds` 收敛为空页路径）；定向 1 文件 29 例 | 本地通过 |
| TASKGROUP-VISIBILITY-API-INT-001 | 真实 PostgreSQL | 只返回本人负责的活跃组 | `aggregate-read-list-api.integration.test.ts` 新增用例：同一项目内 `memberUser` 只见 `[groupSourceOnly, groupOwnSecond, groupActive]`、`foreignUser` 只见 `[groupSourceOnly, groupForeign]`（`projectId` 收窄后一致）；他人负责的 `groupForeign` 与已关闭的 `groupClosed` 对双方都不返回；`groupSourceOnly` 同时证明「只作为来源分支负责人也可见」、`groupActive` 证明「主任务负责人可见」 | 本地通过（该文件 11 例） |
| TASKGROUP-VISIBILITY-API-INT-002 | 真实 PostgreSQL | 关闭组不再返回但详情不丢 | 同文件：`memberCookie` 与 `foreignCookie` 的列表都不含 `groupClosed`；`GET /task-groups/{groupId}` 仍 200 且 `status = CLOSED`、成员 `memberStatus = DETACHED` | 本地通过 |
| TASKGROUP-VISIBILITY-API-INT-003 | 真实 PostgreSQL | 分页与游标语义不变 | 同文件：`limit=1` 三页依次 `groupSourceOnly` → `groupOwnSecond` → `groupActive`，`hasMore` / `nextCursor` 递进正确；跨 `projectId` 或跨用户复用游标仍 422 `INVALID_CURSOR` | 本地通过 |

本地实际执行（2026-09-22，Windows + PowerShell；真实 PostgreSQL 18.6 + PGroonga，集成库 `app` @ 127.0.0.1:55432）：
`pnpm typecheck`（8 个 workspace 项目）、`pnpm lint`、`pnpm build`、`pnpm check:deps`、`pnpm check:frontend:boundaries`（281 模块 / 1376 依赖）、`pnpm check:secrets`（1057 文件）、`pnpm check:docs`（85 个 Markdown）通过；
`pnpm --filter @inpulse/api test:unit` 65 文件 364 例、`pnpm --filter @inpulse/api test:integration` 50 文件 481 例（含本批新增的可见性用例）全部通过；契约四项门禁见上表。

未运行 / 已知偏差：① `pnpm check` 整链、`pnpm test:e2e` 与 GitHub Actions 未运行（本批未改前端，E2E 无对应断言）；② `pnpm db:test` 与 `@inpulse/ops` 集成未跑（无迁移、无 ops 改动）；③ `EXPLAIN` 证据未采集：`EXISTS` 子查询在本地夹具规模下由规划器自行选择访问方式，本批以真库可见性矩阵为通过标准，索引使用未作为门禁（若后续数据量增长出现回退，再补 `EXPLAIN (ANALYZE, BUFFERS)` 证据）；④ 本批含契约摘要与后端行为改动，不适用 2026-09-17 的纯前端免测试指示，须非作者人工评审（可见性口径、关闭组处理与游标 `filterKey` 不变的理由）。

## 聚合组跟随卡片 / 列表切换（产品要求，2026-09-22 本地落库）

产品反馈（原文）：「聚合任务不会切换列表」（附 `/tasks?view=list` 截图：任务已是表格，聚合组仍以整块卡片追加在表格下方）。本批为纯前端呈现改动：不改契约、Route Registry、权限矩阵、数据库不变量、迁移、鉴权与幂等策略，后端零改动，适用 2026-09-17 的纯前端免测试指示（仍按验证要求跑了组件定向单测与真实浏览器实测）。

锁定口径：

> 2026-09-22 更新（产品口径「（它们）同样是一个优先级的，按照截止日期从近到远排序」）：本章节「追加在任务行之后」改为与任务行同一顺序混排（组行与任务行共用 `gridEntries` 的尺子），其余不变。

- 列表视图（`filters.display === "list"`）下聚合组渲染为与任务行同一张 `.feature-list-table.task-center-table` 的 `<tr>`（`data-testid="my-task-group-{groupId}"`、行类名取派生 tone），与任务行按同一顺序混排（2026-09-22 修订：此前只是「追加在任务行之后」）；`.task-group-grid` 规则与「卡片网格追加在表格后」的写法删除。
- 列语义与任务行一致（任务 / 项目 / 归属 / 负责人 / 优先级 / 截止 / 迭代 / 状态）：任务列 = 组名 + 「编号 · 聚合组 · N 条分支」，项目 = 项目名，负责人 = 去重后的分支负责人名单（`title` 区分「主任务负责人」与「各分支负责人」），优先级 = 派生优先级徽章（无未完成分支时隐藏，与卡片一致），状态 = 已完成 / 进行中 / 已关闭徽章（`title` 给「已完成 n/N 条分支任务」）。归属 / 截止 / 迭代三列显示按事实派生的真实值（无对应事实时按列回退：截止回退为与任务行同文案的「未设置截止」，只有无分支的 CLOSED 组与无主任务才用「—」；详见下一节）：迭代 = 组内全部分支的 PUBLISHED 迭代记录数合计（与任务行同口径），截止 = 未完成分支中最早的截止时间（该条完成后顺延到下一条次早的），归属 = 主任务的模块名 +（有功能时）` / 功能名`；派生规则、契约字段与实测见下一节。
- 组行是弹窗入口，与卡片一致：任务列的 `<button class="feature-list-open">` 打开既有 `TaskGroupDetailModal`，不回调 `onOpenTask`。
- 卡片视图（`display === "cards"`）行为不变：组卡仍在 `.calm-task-grid` 里与任务卡混排（2026-09-22 修订：混排顺序改为与任务卡共用一把尺子，见末节「组卡与任务卡同一顺序」）。
- 派生逻辑抽成 `describeTaskGroup`，卡片与组行共用同一份事实（负责人名单、完成计数、组优先级、完成态与 tone），避免两处判定漂移。

| ID | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| TASKGROUP-LISTVIEW-WEB-001 | Web 单元 | 列表视图下聚合组为同表组行 | `TaskCenterPageView.test.tsx` 新增「lists aggregate groups in the same table when the list display mode is active」：`data-testid="my-task-group-501"` 为 `TR` 且 `closest("table")` 是「跨项目任务列表」，`.task-group-grid` 不存在；八列断言（组名 + `TG-001 · 聚合组 · 4 条分支` / 项目名 / 三列「—」/ 陈晓 / 紧急 / 进行中）；行类名 `tone-prio-urgent`；点击任务列按钮打开组详情弹窗且不回调 `onOpenTask` | 本地通过 |
| TASKGROUP-LISTVIEW-WEB-002 | Web 单元 | 卡片视图不回归 | 同文件既有组卡用例（`renders task groups as cards inside the task grid` 等）保持通过；定向文件 39/39 | 本地通过 |
| TASKGROUP-LISTVIEW-BROWSER-001 | 浏览器实测 | 真实数据两种视图 | `/tasks?view=list`：表格 3 行（T-62 / T-60 / `INPULSE-TG-1`），组行为 `TR`、类名 `tone-prio-urgent`、八列文本与小字「INPULSE-TG-1 · 聚合组 · 3 条分支」符合预期，`.task-group-grid` 与 `.calm-task-grid` 计数均为 0；点击组行按钮弹出「匿名入口直达登录页 + 登录页视觉重做」组详情；切回「卡片」后组仍是 `BUTTON.calm-task-card.task-group-card`、`.calm-task-grid` 计数 1、表格计数 0 | 本地通过 |

本地实际执行（2026-09-22）：`pnpm --filter @inpulse/web exec vitest run src/features/my-tasks/TaskCenterPageView.test.tsx` 39 例通过；浏览器实测见上表（开发实例 `127.0.0.1:5173` + API `127.0.0.1:3000`）。

未运行 / 已知偏差：① 按 2026-09-17 的纯前端免测试指示未跑 `pnpm test:web` 全量、`pnpm check` 整链、Playwright E2E 与 GitHub Actions（组件定向单测与浏览器实测已跑）；② 组行不复制卡片页脚的「已完成 n/N」与「查看详情 / 解除合并」文案（等价信息由状态徽章 `title` 与行点击承担），若产品要求在列表里直读完成计数需另开呈现改动；③ 列表视图下 CLOSED 组（无分支）行归属与截止为「—」、迭代为 0，并带「已关闭」徽章；真实数据暂无 CLOSED 组样本。

## 聚合组列表行的归属 / 截止 / 迭代按事实派生（产品要求，2026-09-22 二次落库）

产品反馈（原文）：「这里迭代数据就是任务组里面的所有迭代数，截至时间就按哪个任务时间快截至了，按哪个任务来，任务完成了就按第二个快截至的，归属就按主任务来」（附 `/tasks?view=list` 截图：组行三列只有「—」）。本批跨契约、API 与前端，属破坏性契约变更，不适用 2026-09-17 的纯前端免测试指示。

锁定口径（服务端只传事实，派生展示值由客户端唯一计算，避免卡片视图与列表视图各算一套）：

- 迭代 = 组内全部分支（主任务、来源分支与历史分支）的 PUBLISHED 迭代记录数合计，与任务行 `publishedRecordCount` 同口径；无分支的组显示 0。
- 截止 = 未完成（`TODO`）分支中最早的截止时间；最早那条完成后自动改取下一个次早的（下文 WEB-002 覆盖该顺延）；未完成分支都没有设置截止时间时显示「未设置截止」（与任务行同文案，下文 WEB-003 覆盖该回退）。
- 归属 = 主任务（`role = MAIN`）的模块名 +（有功能时）` / 功能名`；主任务缺失时显示「—」。
- 三列都带 `title` 说明取值来源（如「未完成分支中最早的截止」），不伪造数值。

服务端只新增事实字段，不计算派生值：R-7 `listTaskGroups` 的分支项新增 `moduleName`、`featureId`、`featureName`、`dueAt`、`publishedRecordCount`（源定义 `packages/api-contract/src/contracts/aggregate-read.zod.ts`、`packages/api-contract/src/aggregate-read-routes.ts`，Route Registry summary 同步说明「派生展示值由客户端按事实计算」）。`TaskReadModel` 新增 `dueAt`，并新增 `TaskReadModelRaw` + `mapTaskReadModel` 边界映射（postgres-js 把 `timestamptz` 返回为文本，避免直接断言 `Date`）；`TaskGroupQueryService` 在同一只读事务内批量取模块名、功能名与 PUBLISHED 记录数，任务缺模块时按既有口径 500 `AGGREGATE_READ_INCONSISTENT`。

| 编号 | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| TASKGROUP-GROUPROW-FACTS-WEB-001 | Web 单元 | 组行三列按事实派生 | `TaskCenterPageView.test.tsx`：组行显示归属「任务与聚合 / 任务合并」、截止「已逾期 …」（带逾期色调与来源 `title`）、迭代「5」；点击行仍打开组详情弹窗且不回调 `onOpenTask` | 本地通过 |
| TASKGROUP-GROUPROW-FACTS-WEB-002 | Web 单元 | 最快截止完成后顺延 | 同文件新增用例：把最早未完成分支改为 DONE 后，截止改取下一个次早的（「今天截止」+ 即将到期色调），迭代合计不变 | 本地通过 |
| TASKGROUP-GROUPROW-FACTS-WEB-003 | Web 单元 | 未完成分支都没设截止 | 同文件新增用例：两个未完成分支都收尾后截止列显示「未设置截止」（与任务行同文案）、`title` 说明原因、不带逾期 / 即将到期文字色，迭代合计不变 | 本地通过 |
| TASKGROUP-GROUPROW-FACTS-API-UNIT-001 | API 单元 | 分支事实字段装配 | `aggregate-read.service.test.ts`：R-7 分支项字段断言含 `moduleName` / `featureName` / `dueAt` / `publishedRecordCount`，并断言模块名、功能名、记录数三个只读端口的调用参数；任务缺模块返回 500 `AGGREGATE_READ_INCONSISTENT` | 本地通过 |
| TASKGROUP-GROUPROW-FACTS-API-INT-001 | API 集成（真实 PostgreSQL） | 分支事实字段落库回读 | `aggregate-read-list-api.integration.test.ts` 11/11：三个分支分别返回自身模块名、功能名、各自 `dueAt` 与 `publishedRecordCount` | 本地通过 |
| TASKGROUP-GROUPROW-FACTS-BROWSER-001 | 浏览器实测 | 真实组行三列 | 开发实例 `/tasks?view=list`（`127.0.0.1:5173` + API `127.0.0.1:3000`）：`INPULSE-TG-1` 行归属「平台与访问 / 用户登录与会话管理」、迭代 1、截止「未设置截止」（唯一未完成分支 `INPULSE-T-59` 未设置截止时间，与组详情内分支明细一致） | 本地通过 |

本地实际执行（2026-09-22 二次改动）：`pnpm contract:generate`（5 产物）→ `contract:drift` → `contract:validate`（108 条）→ `permissions:check`（108/108）；`pnpm --filter @inpulse/api exec vitest run src/modules/aggregate-read` 11 例；`pnpm test:unit`（api 65 文件 364 例）、`pnpm test:web`（85 文件 550 例，其中 `TaskCenterPageView.test.tsx` 41 例通过；另有 4 例失败于用户正在编辑的 `TasksPanel.test.tsx` 与 `app-router.test.tsx`，与本批 diff 无交集）；真实 PostgreSQL 集成 `aggregate-read-list-api` 11/11 与 `aggregate-read-api` + `aggregate-read-ports` 42 例；`pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。

未运行 / 已知偏差：① 分支项新增字段改变 `strict()` 契约，按仓库规则需非作者人工评审后才能合入；② 未跑 `pnpm check` 整链、Playwright E2E 与 GitHub Actions，`pnpm format:check` 仅因工作区既有未提交文件 `apps/web/src/features/tasks/task-origin.tsx` 报错（用户 WIP，本批未改动）；③ 列表行不展开分支级明细，仍按上一节口径由组详情弹窗承担。

## 2026-09-22 组卡与任务卡同一顺序（产品要求，C 本地落库）

产品反馈（原文）：「这个同样是一个优先级的，按照截止日期从近到远排序」（`/tasks` 卡片视图：普通优先级的聚合组卡 `啊J`（未完成分支中最早的截止 9月16日 已逾期）被固定追加在网格尾部，排在普通优先级、未设置截止的任务卡 `呈现出` 之后）。本批为纯前端排序改动：不改契约、Route Registry、权限矩阵、数据库不变量、迁移、鉴权与幂等策略，后端零改动。

口径：组卡与任务卡共用一份网格顺序 `gridEntries`，逐级比较「状态分组（未完成 0 / 已完成 1 / 已取消 2）→ 紧急桶（遗留问题来源 0 / 标记紧急 1 / 已逾期 2 / 今-明日截止 3 / 其余 4）→ 优先级档位 → 截止时间近到远（未设置截止排最后）」；前三级取自服务端 `apps/api/src/modules/tasks/task-list-order.ts` 的排序键，组卡的三项都从「未完成分支」派生（最高一档 / 最早一条截止），没有未完成分支的已完成组落在优先级末档。`visibleGroups` 只保留「未完成 / 已完成」归属筛选，排序只此一处，卡片视图与列表视图同一顺序；两侧仍各自签名游标分页，前端只在已加载页内合并，不伪造跨页完整顺序。

| 编号 | 类型 | 覆盖点 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| CARD-COLOR-UNIT-011 | Web 单元 | 组卡与任务卡同一顺序 | `TaskCenterPageView.test.tsx`「组卡与任务卡同一顺序：同优先级按截止日期从近到远」：夹具为高优先级任务卡（10月15日）+ 普通优先级组卡（4 条分支都未完成、最早截止已逾期）+ 普通优先级任务卡（未设置截止），断言网格 `data-testid` 顺序为 组卡 → 高任务卡 → 普通任务卡（组卡的已逾期落紧急桶 2，排在未逾期的紧急桶 4 之前）；「同优先级内按截止日期从近到远，未设截止排最后」：三张普通优先级卡（+8 天 / +3 天 / 未设置截止，乱序传入）收敛为 +3 天 → +8 天 → 未设置截止 | 本地通过（2026-09-22） |
| CARD-COLOR-BROWSER-025 | 浏览器实测 | 真实数据下的组卡落位 | 无头 Chromium 1440 宽（本地 dev 5173，真实数据只读）：`/tasks` 卡片顺序为 `A-5 残余`（普通 · 遗留问题，9月30日）→ `222`（紧急，未设置截止）→ `啊J` 组卡（普通 · 聚合组 · 未开始，已逾期 9月16日）→ `A-6`（高 · 模块级，10月15日）→ `呈现出`（普通，未设置截止）；切「列表」视图为同一顺序（组行 `my-task-group-174` 排在 `A-6` 行之前）。改动前 `啊J` 固定在第 5 位（网格与表格尾部） | 本地通过（2026-09-22） |

本地实际执行（2026-09-22 组卡与任务卡同一顺序）：`pnpm --filter @inpulse/web test`（85 文件 559 例；本轮新增 2 例后为该值）、`pnpm --filter @inpulse/web exec vitest run src/features/my-tasks/TaskCenterPageView.test.tsx`（49 例）、`pnpm --filter @inpulse/web exec tsc --noEmit`、`pnpm exec prettier --write`（2 个改动文件）、`pnpm exec eslint`、`pnpm format:check`、`pnpm check:docs` 通过；浏览器实测见 CARD-COLOR-BROWSER-025（无头 Chromium 1440 宽指向本地 dev 5173，只读浏览既有演示数据，未新增或修改业务数据）。

未运行：整链 `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm check`、`pnpm test:e2e`（Playwright；`apps/e2e/tests/task-groups.spec.ts` 未断言卡片位置，本轮未跑）、GitHub Actions；`apps/api` 的 3 处 `PROJECT_ADMIN` 类型错误与本轮无关，未修。组卡跨优先级靠前（已逾期的普通组卡排在高优先级任务卡之前）沿用服务端「逾期只比紧急低一档」的既有排序口径，本轮未改。

## 2026-09-22 「已完成」改 D 青碧 + 已完成按完成时间倒序（产品要求，C 本地落库）

产品反馈（原文）：「这个改成这个颜色 **D** 青碧 #e1f2f2 / #bcdddf，这个排序按照完成时间，越晚越排前面」（附图为 `/tasks?status=done` 的绿色已完成卡）。本批含前端配色 + 服务端排序键 + 前端排序镜像：不改契约、Route Registry、权限矩阵、数据库不变量、迁移、鉴权与幂等策略。

色值口径：D「青碧」底色 `#e1f2f2`、描边 `#bcdddf`、悬停 `#d6edee`、深青字 `#1d5b62`（对比度 6.67:1）。上一版「任务中心 `#cdf1d3`、任务看板 `#eef8f3` 分色」同日作废：任务中心 `/tasks`、项目任务面板、任务看板的卡片、任务中心列表行与看板表格行收成同一套值，`.tb-card.tone-prio-done` 覆盖块删除。看板自带的「状态绿」语义（绿色「已完成」徽章、看板底部图例点 `.tb-dot-done`、概览完成比例条 `.sb-done`、看板行日期 `#58937a`）早于卡片配色、与全局徽章语义同族，本轮刻意不动。

排序口径：服务端统一排序键在状态分组之后插入一级「完成时间倒序」`COALESCE(t.completed_at, '-infinity'::timestamptz) DESC`（未完成 / 已取消归一为 `-infinity`，不参与这一级），`TASK_LIST_SORT_KEY_VERSION` 由 2 升到 3（载荷 6 段 → 7 段，旧游标按无效游标拒绝）；前端 `gridEntries` 同步插入 `completedRankOf`（越晚完成越靠前）。看板 `listForBoard` 早已是 `completed_at DESC NULLS LAST`，本批让任务中心 / 项目任务面板与之对齐。

| 编号 | 类型 | 覆盖点 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| CARD-COLOR-UNIT-012 | Web 单元 | 已完成区按完成时间从晚到早 | `TaskCenterPageView.test.tsx`「已完成按完成时间从晚到早排序，优先级不参与」：三条已完成任务（941 URGENT 9月1日 / 942 LOW 9月12日 / 943 NORMAL 9月6日）收敛为 942 → 943 → 941（2026-09-23 起 942 的优先级改判 HIGH，结论不变，见末节），证明已完成区不再按优先级排、改按完成时间倒序 | 本地通过（2026-09-22） |
| CARD-COLOR-API-003 | 真实 PostgreSQL 集成 | 完成时间倒序排序键与游标版本 3 | `apps/api/test/aggregate-read-ports.integration.test.ts`：夹具创建顺序为 overdue → leftover → urgent → dueSoon → other → tieA → tieB（完成时间随事务 `now()` 递增，前置断言块断言 `stampRows` 严格递增且互不相等），已完成分组期望顺序为 done.tieB → tieA → other → dueSoon → urgent → leftover → overdue（= 创建顺序完全倒序），两个任务端口同序；`aggregate-read.service.test.ts` / `aggregate-read-cursor.test.ts` 的游标断言同步为 7 段 `3\|0\|\|4\|2\|\|501`（2026-09-23 起版本由 3 升到 4，断言改为 `4\|0\|\|4\|2\|\|501`，见末节）。注：夹具只能用真实事务时间戳，直接 UPDATE `completed_at` 会被 `task_status_history` 完成快照不变量触发器拒绝 | 本地通过（2026-09-22） |
| CARD-COLOR-BROWSER-026 | 浏览器实测 | D 青碧落地取色与已完成顺序 | 无头 Chromium 1500 宽（本地 dev 5173，成员账号 xiaoshao，只读浏览既有演示数据）：`/tasks?status=done` 的 `.calm-task-card.tone-prio-done` 计算底色 `rgb(225, 242, 242)`（`#e1f2f2`）、描边 `rgb(188, 221, 223)`（`#bcdddf`）、标题 `rgb(29, 91, 98)`（`#1d5b62`），15 张已完成卡在页面上的先后顺序与数据库 `WHERE work_status = 'DONE' ORDER BY completed_at DESC` 逐条一致（F-01 09-12 07:39:03 → … → F-07 09-08 11:31:17）；`/projects/1/task-board` 的 `.tb-card.tone-prio-done` 同值，切「列表」视图后 `.tb-row--done` 底色 `rgb(225, 242, 242)`、`--tb-row-accent` `#1d5b62`（该行日期文案仍是看板自带的语义绿 `#58937a`）；页面内 `.tone-prio-overdue` / `.tone-prio-soon` 节点数仍为 0 | 本地通过（2026-09-22） |

本地实际执行（2026-09-22 「已完成」改 D 青碧 + 完成时间倒序）：`pnpm --filter @inpulse/web test`（85 文件 560 例）、`pnpm --filter @inpulse/web exec vitest run src/features/my-tasks/TaskCenterPageView.test.tsx`（50 例）、`pnpm --filter @inpulse/api exec vitest run test/aggregate-read.service.test.ts test/aggregate-read-cursor.test.ts`（37 例）、真实 PostgreSQL 集成 `--config vitest.integration.config.ts test/aggregate-read-ports.integration.test.ts`（23 例）、真实 PostgreSQL 集成全量 `--config vitest.integration.config.ts`（48 文件 480 例通过，另有 2 例与本轮无关的失败：`project-member-management-api.integration.test.ts` 期望 422 得 500、`projects-read-api.integration.test.ts` 插入 `PROJECT_ADMIN` 违反 CHECK）、`pnpm --filter @inpulse/web exec tsc --noEmit`、`pnpm --filter @inpulse/api exec tsc -p tsconfig.test.json --noEmit`（仅剩 3 处与本轮无关的 `PROJECT_ADMIN` 错误）、`pnpm exec prettier --write`（12 个改动文件）、`pnpm format:check`、`pnpm exec eslint`（改动文件）通过；浏览器实测见 CARD-COLOR-BROWSER-026（无头 Chromium 1500 宽指向本地 dev 5173，只读浏览既有演示数据，未新增或修改业务数据）；dev 树 `apps/api/dist` 已重建并重启 :3000（`TASK_LIST_SORT_KEY_VERSION = 3` 已生效）；`docs/task-card-colors.md` 的《「已完成」》章节改写为青碧一套色值，配图 `cards-overview.png` / `board-overview.png` / `group-states.png` 按新色重出。未运行：整链 `pnpm lint` / `pnpm typecheck` / `pnpm build` / `pnpm check`、`pnpm test:e2e`（Playwright；`apps/e2e/tests/task-groups.spec.ts` 的断言已按新口径同步但本轮未跑）、`pnpm deps:audit`、GitHub Actions；`apps/api` 的 3 处 `PROJECT_ADMIN` 类型错误与本轮无关，未修。

## 任务多负责人（ADR-040，2026-09-22 本地落库）

任务负责人由 `app.tasks.assignee_id` 单一列改为 `app.task_assignees(task_id, user_id, project_id, created_at)` 关联表，语义为**平权多负责人**（任一负责人都能推进状态与编辑、都进「我的任务」、都收指派通知）。迁移 `0020_task_assignees.sql`（expand：建表、复合外键 `(task_id, project_id) → tasks(id, project_id)`、`task_assignees_active_assignee` 活跃成员防线、`task_assignees_immutable_columns`、索引 `task_assignees_user_idx`、`app_runtime`/`app_backup` 授权、按旧列回填）与 `0021_contract_task_assignees.sql`（contract：删除 `tasks.assignee_id` 与 `tasks_assignee_status_idx`）。

| 编号 | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| ADR040-CONTRACT-001 | 契约 | `assigneeIds` 边界与规范化 | `tasks.test.ts`：`assigneeIds` 1～20 人、空数组与 `0` 值 422、服务端去重并按用户 ID 升序；响应派生 `assigneeId === assigneeIds[0]` | 本地通过（api-contract 16 文件 100 例） |
| ADR040-FINGERPRINT-001 | 契约 | 幂等契约版本随破坏性变更递增 | `createTask`/`updateTask` 升 `2.0.0`、`transitionTask` 升 `3.0.0`、`completeTask` 与模块变体升 `2.0.0`，`archiveTask`/`restoreTask` 继承；`task-completion.test.ts` 断言历史指纹 `["1.0.0","2.0.0","3.0.0"]`；`contract:validate` 无 `[contract-fingerprint]` 违例 | 本地通过（108 条路由） |
| ADR040-DB-001 | PostgreSQL | 关联表防线 | 主键 `(task_id, user_id)` 拒绝重复指派；任务与项目错配被复合外键拒绝 23503；停用用户或非项目活跃成员被 `task_assignees_active_assignee` 拒绝；`task_id`/`user_id`/`project_id`/`created_at` 不可改写；`app_runtime` 无 `UPDATE` 授权 | 本地通过（真实 PostgreSQL 集成） |
| ADR040-DB-002 | 迁移 | expand/contract 与回填 | `db:migrations:check` 22 条通过；升级后每个任务在关联表恰有一行（本地演示库 `tasks` 58 = `task_assignees` 58），`tasks.assignee_id` 与 `tasks_assignee_status_idx` 均已不存在 | 本地通过 |
| ADR040-API-INT-001 | HTTP + PostgreSQL | 多负责人读写 | 创建/编辑/改派多名负责人落库回读；集合未变化时不重写关联表（保留失效成员历史）；仅新绑定的负责人收到通知；`TaskReadModel.dueAt` 为 `Date`（原始行 + 边界映射），锁读查询不使用 `LATERAL`（PostgreSQL `0A000`） | 本地通过（API 集成 50 文件 481 例） |
| ADR040-READPORT-001 | PostgreSQL | 归属与筛选按集合判定 | 「我的任务」、看板、聚合组、遗留项工作流均以 `EXISTS (… task_assignees …)` 判定负责人，标量 `assigneeId` 由 `min(user_id)` 派生；`aggregate-read-ports.integration.test.ts` 断言规划器采用 `task_assignees_user_idx` | 本地通过 |
| ADR040-SEED-001 | 数据 | 演示种子与夹具清理 | `database/seed/demo-data.sql` 新增 `app.task_assignees` COPY 段（53 行）、`export-demo-seed.mjs` 表清单同步，`pnpm db:seed:check` 无漂移；`apps/e2e/helpers/fixture-cleanup.ts` 按关联表删除夹具负责人行 | 本地通过 |
| ADR040-WEB-001 | Web 单元 | 多选与展示 | `GlobalTaskCreateModal`/`TasksPanel`/`ConvertLeftoverTask` 使用多选（至少一名校验），列表与详情以「、」连接多名负责人；Web 单测 85 文件 555 例通过 | 本地通过 |
| ADR040-BROWSER-001 | 浏览器实测 | 真实创建多负责人任务 | 开发实例（`127.0.0.1:5173` + API `127.0.0.1:3000`）：新建任务指派邵晨宇与林雨妍两人，列表行与详情面板均显示两名负责人，`GET /api/v1/tasks?scope=mine` 返回该任务 | 本地通过 |
| ADR040-CONTRACT-002 | 契约 | 任务中心（R-3）返回全部负责人 | `myTaskItemSchema.assignees` 为 `userRefSchema` 数组（1～20 名），标量 `assignee` 保留为派生字段（恒等于 `assignees[0]`）；R-3 是 GET 路由（幂等策略 `none`），契约版本无需递增；`contract:drift`（5 产物）、`contract:validate`（108 条）、`permissions:check`（108/108）通过 | 本地通过 |
| ADR040-READPORT-002 | PostgreSQL | R-3 读端口输出负责人集合 | `MyTaskListRow` 增加 `assigneeIds`（`array_agg(user_id ORDER BY user_id)`，`NULL` 在边界归一为空数组），原 `min(user_id)` 继续供看板等标量调用方使用；单测断言条目 `assignees` 为两人引用且派生 `assignee` 等于首位 | 本地通过（api 单测 65 文件 365 例，其中 1 例为既有 `PROJECT_ADMIN` 失败） |
| ADR040-WEB-002 | Web 单元 | 任务中心卡片与列表列出全部负责人 | `TaskCenterPageView` 用 `assigneeNamesOf()` 以「、」连接全部负责人（卡片 `calm-card-assignee` 与列表负责人列都带 `title`，集合为空时回落「—」）；`my-tasks-v1-query` 的本地过滤按全部负责人姓名匹配；新增「卡片列出全部负责人而不是只显示第一位」与「列表行的负责人列同样列出全部负责人」2 例 | 本地通过（web 85 文件 557 例） |
| ADR040-BROWSER-002 | 浏览器实测 | 任务中心显示多负责人 | 本地开发实例（`127.0.0.1:5173` + API `127.0.0.1:3000`，登录邵晨宇）：`GET /api/v1/me/tasks?limit=100` 的 `INPULSE-T-64` 返回 `assignees` 两人（小潘、邵晨宇）且 `assignee` 为小潘；卡片视图显示「负责人：小潘、邵晨宇」，`?view=list` 列表视图负责人列为「小潘、邵晨宇」 | 本地通过 |

本地实际执行（2026-09-22）：`pnpm db:migrate`（应用 `0020`/`0021`）→ `db:migrations:check`（22 条）→ `db:seed:check`（28 张业务表）→ `contract:generate`（5 产物）→ `contract:drift` → `contract:validate`（108 条）→ `permissions:check`（108/108）；`apps/api` 单测 65 文件 364 例、`apps/web` 85 文件 555 例、`packages/api-contract` 16 文件 100 例、`apps/ops` 52 例、`database` 15 例；真实 PostgreSQL 集成 `apps/api` 50 文件 481 例；`pnpm lint`、`check:deps`（528 文件）、`check:frontend:boundaries`（282 模块）、`check:secrets`（1065 文件）、`check:docs`（86 个 Markdown）、`check:deploy:test`（5 refs）、各包生产构建均通过；改动文件 Prettier 检查通过。验证后已按 2026-09-17 指示清理测试夹具（删除夹具用户 3663、夹具项目 1923、业务行 67226、审计行 3009，保留 3 个真实项目；SYSTEM 审计链因中段删除留下一个可检测断点，清理脚本已提示）。

任务中心「负责人」多值展示（2026-09-22 追加，`fix(tasks)`）：多负责人落库后用户反馈「任务卡片上的负责人怎么只显示一个人」，定位为 R-3 任务中心契约只带派生标量 `assignee`（`min(user_id)`），集合本身没有出接口，视图无法渲染第二名负责人。本批把集合贯通契约、读端口、服务与前端（新增 `ADR040-CONTRACT-002` / `ADR040-READPORT-002` / `ADR040-WEB-002` / `ADR040-BROWSER-002` 四行），标量 `assignee` 保留为派生字段以便看板、统计等按单值消费的调用方无需同批改造。本轮另修复一处会被误判为「代码没生效」的运行时陷阱：`@inpulse/api-contract` 的 `exports.default` 指向 `dist`，只改契约源码而不重建该包产物时，全局响应校验会按旧 Schema 剔除新增字段（表现为接口 200 但响应缺 `assignees`）；改契约后必须同时重建 `packages/api-contract` 的 dist 再重启 API。

未运行 / 已知偏差：① 两例既有失败与本决策无关——`project-member-management-api.integration.test.ts` 与 `projects-read-api.integration.test.ts` 的 `PROJECT_ADMIN` 用例仍违反 `project_members_role_check`（ADR-039 在 `projects.zod.ts` 的 `projectMemberRoleSchema` 等处的残留，本批未改动）；`apps/api` 单测同源 1 例与 3 个 `PROJECT_ADMIN` 类型错误同样为既有问题；② 未跑 `pnpm check` 整链、Playwright E2E（本批未扩展 E2E 用例）、`deps:audit`（需 registry 访问）与 GitHub Actions；③ `pnpm format:check` 仅因工作区既有未提交文件 `apps/web/src/features/tasks/task-origin.tsx` 报错（用户 WIP）；④ 破坏性契约变更（请求体 `assigneeId` → `assigneeIds`）按仓库规则需非作者人工评审后才能合入。

## 任务中心页头 + 控制条一体化与「未完成 / 已完成」数量角标（方案 A，产品要求，2026-09-22 本地落库）

产品要求（原文）：「这一片区域我希望你帮我重新设计一下，可以网上查查 ui 样式，然后完成和未完成需要有数量显示，最后先展示个样式给我再决定要不要修改」。先交付三套样式预览（A 一体化控制条 / B 下划线标签页 / C 状态统计块），用户看过预览后选定方案 A（「根据方案 A 改」），本批把方案 A 落库为真实实现。纯前端呈现变更：不改契约、不改接口、不动数据库。

口径与实现：

- 数量取自既有 R-3 契约的 `stats.myOpen` / `stats.completed`（负责人维度、按当前 project 范围，与列表筛选同口径），不新增接口、不重复计算；`stats` 不可知（适配器未接线或尚未加载）时两档都不渲染角标，不把「不知道」显示成 0。
- 控制条：`.task-toolbar-bar` 把「工作状态（带数量）→ 分隔线 → 搜索框（flex:1）→ 项目 / 优先级 / 任务范围三个浅底无描边下拉 → 靠右展示方式」收进一条白底控制条；条内分段控件与搜索框同为 34px 高，标题 → 控制条 → 卡片 的纵向节奏不变。
- 页头「遗留问题」入口数量由裸文字改为数量签 `.header-count`；数量签与分段角标都对辅助技术隐藏（与侧栏 `.nav-item em` 同口径），按钮可访问名由 `aria-label` 显式给出，仍是「遗留问题 N」。
- 旧固定宽搜索框规则限定为 `.task-toolbar:not(.task-toolbar-bar)`，迭代记录 / 遗留问题 / 项目动态页不受影响。

| 编号 | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| TASKBAR-COUNT-WEB-001 | Web 单元 | 两档显示服务端统计数量 | `TaskCenterPageView.test.tsx` 新增用例：stats 为 `myOpen: 7 / completed: 23` 时「未完成 / 已完成」按钮内 `.segmented-count` 分别为 7 / 23，角标 `aria-hidden="true"` 且 `title="未完成 7 项"`，按钮可访问名仍是「未完成」 | 本地通过 |
| TASKBAR-COUNT-WEB-002 | Web 单元 | 统计不可知不显示假 0 | 同文件新增用例：适配器不返回 stats 时 `.segmented-count` 数量为 0（空态出现后才断言，避免时序误判）；`CalmSegmented` 只对 `typeof count === "number"` 渲染角标 | 本地通过 |
| TASKBAR-LEFTCOUNT-WEB-003 | Web 单元 | 遗留问题入口数量签 | 「遗留问题 3」按钮内 `.header-count` 文本为 3 且 `aria-hidden="true"`，按钮名仍为「遗留问题 3」，既有断言口径不变 | 本地通过 |
| TASKBAR-BROWSER-001 | 浏览器实测 | 真实控制条结构与实测取值 | 真实 E2E 环境（Docker PostgreSQL 18.6 + 生产构建 Vite preview）：控制条高 51px、条内 Select 高 34px、背景 `rgb(243,246,250)`、选中档位角标底色 `rgb(230,242,255)`；1280px 视口下控制条右缘 1246 / 最末控件右缘 1236，不折行 | 本地通过 |
| TASKBAR-BROWSER-002 | 浏览器实测 | 真实数量闭环 | 临时 E2E 用例在夹具项目创建 3 个任务并完成 2 个后进入 `/tasks`：`.task-toolbar-bar .segmented-count` 恰为 2 个，文本依次为 1（未完成）与 2（已完成），截图留档（用例已删，不入库） | 本地通过 |

本地实际执行（2026-09-22）：`pnpm --filter @inpulse/web test`（85 文件 559 例全绿，改前 557，新增 2 例）；改动文件 ESLint 与 Prettier 通过；真实 E2E 定向运行 `aggregate-views`（2 例）、`task-groups`（2 例）与临时截图用例（1 例）通过；`pnpm --filter @inpulse/web typecheck` 的失败与本次无关（既有 `PROJECT_ADMIN` 残留，`git stash` 对照改动前同样失败，7 个文件）。

未运行 / 已知偏差：① 未跑 `pnpm check` 整链、全量 `pnpm test:e2e`、`deps:audit`（需 registry 访问）与 GitHub Actions；② 数量角标只跟随 R-3 统计，不随关键词 / 优先级等本地筛选二次计算，细粒度数字以列表为准；③ 窄视口依赖控制条既有 `flex-wrap` 折行，未新增专项用例；④ 纯前端呈现变更，按仓库规则仍需非作者人工评审。

## 侧栏计数随写操作即时更新（前端缺陷修复，2026-09-22 本地落库）

用户报告（附侧栏截图「任务中心 4 / 遗留问题 2」）：「任务中心新建任务完成任务或者遗留问题产生遗留问题或转成任务那些发生修改变化左边导航栏数字不会及时变化需要刷新才变」。定位为侧栏两个计数查询（`["shell-counters","my-open-tasks"]`、`["shell-counters","open-leftovers"]`，带 60 秒 `staleTime`）从未被任何写路径失效，数字只在整页重挂载后更新；本批只改前端缓存失效，不改契约、接口、权限与数据库。

- 新增 `apps/web/src/shared/api/shell-counters.ts`：查询键常量 + `invalidateShellCounters(queryClient)`；放 `shared` 层以便 `app`（布局与全局 provider）与 `features`（写路径）同时引用且不产生反向依赖。
- 两条失效路径：① `AppProviders` 的全局 `MutationCache.onSuccess` 统一失效，覆盖所有经 React Query mutation 的写操作（不再逐条补 `onSuccess`，避免漏路径）；② 6 条直接调用生成客户端、不经 mutation 的写路径显式调用 `invalidateShellCounters`——`PublishRecordButton`、`RecordLifecycleButton`（作废 / 恢复）、`EditPublishedRecord`（保存修订）、`AppendLeftoverForm`（追加遗留问题）、`ConvertLeftoverTask`（遗留问题转任务）、`CompleteWithRecord`（发布并完成，不带记录也刷新）。
- `shell-data.ts` 的遗留问题计数改用任务中心页头同一查询 `useOpenLeftoverCount`，两处不再各算一次。

| 编号 | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| SHELLCOUNT-WEB-001 | Web 单元 | 经 mutation 的写操作自动失效侧栏计数 | `AppProviders.test.tsx`：挂载带站内通知计数、我的任务数与遗留问题数的 provider 后触发一次 `useMutation`，`listMyTasks` 与 `listLeftoverItems` 调用次数由 1 变 2 | 本地通过 |
| SHELLCOUNT-WEB-002 | Web 单元 | 直调生成客户端的写路径可显式失效 | 同文件：直接调用 `invalidateShellCounters(cache)` 后两个查询各重取一次（覆盖不经 mutation 的 6 条写路径共用的入口） | 本地通过 |
| SHELLCOUNT-WEB-003 | Web 单元（反向对照） | 用例能捕捉缺陷本身 | 把 `invalidateShellCounters` 临时改为空实现：同文件 2 failed / 4 passed；恢复实现后 6 passed | 本地通过 |

本地实际执行（2026-09-22）：`pnpm --filter @inpulse/web exec vitest run src/app/providers/AppProviders.test.tsx` 6 例通过（新增 2 例）；受影响区域定向复跑（providers + published-records + tasks）9 文件 67 例通过；全量 `pnpm --filter @inpulse/web exec vitest run` 85 文件 563 例全绿；改动文件 `eslint` 退出码 0、`prettier --check` 通过；`pnpm check:frontend:boundaries` → `no dependency violations found (283 modules, 1380 dependencies)`。

未运行 / 已知偏差：① 未跑 Playwright E2E（缺陷本身是缓存失效，单测已覆盖两条失效路径；真实浏览器复验待补）、`pnpm check` 整链、`deps:audit` 与 GitHub Actions；② `pnpm --filter @inpulse/web typecheck` 仍有 7 文件 9 处既有 `PROJECT_ADMIN` 残留错误（`git stash` 对照改动前同样失败，属他人在途改动，与本批无关）；③ 全局失效会让侧栏与任务中心页头的遗留问题计数一起重新取数（未挂载时只标记过期、不发请求）。

## 任务中心「遗留问题」计数与侧栏同源（缺陷修复，2026-09-22 本地落库）

现象：任务中心页头「遗留问题」入口从不显示数字，而侧栏导航的「遗留问题」有数字。排查结论是两条叠加：

1. 页头数字来自 R-3 的 `leftoverCount`（`MyTaskQueryPort.leftoverEntry`）：其 SQL 要求「任务经 `leftover_task_links` 关联」与「遗留项 `status = "ACTIVE"`」同时成立，但链接行只在「遗留项转任务」事务内写入、且同一事务把该条目置成 `CONVERTED`（`leftover-record.repository.ts` 的 `link()`：INSERT 链接 + UPDATE 状态），两者在真实业务路径下互斥，计数恒为 0；集成测试用夹具直接 INSERT 链接并保持 ACTIVE，构造了真实路径不可达的组合，因此一直是绿的（`aggregate-read-api.integration.test.ts`「统计卡片与遗留问题入口按基准集合计算」）。
2. 侧栏数字来自 R-6 `bucket=OPEN` 桶条数，与页头原口径不同；即便 R-3 口径修好，两处也会在「我负责 vs 全部」上长期不一致。

修复（前端，不动契约与数据库）：把「未闭环遗留项计数」下沉到 `features/issues/issues-query.ts` 的 `useOpenLeftoverCount`（R-6 `bucket=OPEN`、单页上限 100、超出显示上限、`staleTime` 60s；查询键挂在 `shell-counters` 前缀下），侧栏（`useShellCounters`）与任务中心页头（`TasksPage` 注入视图）共用同一个查询键与缓存，写后由全局 MutationCache 统一失效。视图语义固定为「`undefined` = 未接线、回退适配器字段；`null` = 尚未加载、不显示角标」。

| 编号 | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| LEFTOVERCOUNT-WEB-001 | Web 单元 | 注入计数优先于适配器字段 | `TaskCenterPageView.test.tsx` 新增用例：注入 `leftoverCount: 6` 时按钮可访问名为「遗留问题 6」、`.header-count` 文本为 6，点击仍触发 `onOpenIssues` | 本地通过 |
| LEFTOVERCOUNT-WEB-002 | Web 单元 | 尚未加载不回退成假值 | 同文件新增用例：适配器字段为 3、注入 `leftoverCount: null` 时按钮名仍是「遗留问题」且不渲染 `.header-count`（空态出现后才断言） | 本地通过 |
| LEFTOVERCOUNT-WEB-003 | Web 单元 | 页面接线与定向回归 | `TasksPage.test.tsx`、`features/issues`、`src/app` 定向 11 文件 105 例保持通过；新增的 `app -> features` 导入不违反依赖边界 | 本地通过 |
| LEFTOVERCOUNT-BROWSER-001 | 浏览器实测 | 两处数字同源 | 临时 E2E 用例走真实路径（新建任务 → 完成任务并发布带一条遗留问题的记录）后进入 `/tasks`：侧栏「遗留问题」`em` 与页头「遗留问题 1」数量签同时为 1；点开弹窗后该条出现在「未闭环」桶（截图留档，用例已删） | 本地通过 |

本地实际执行（2026-09-22）：`pnpm --filter @inpulse/web test`（85 文件 563 例；既有 `app-router.test.tsx` 1 例在 HEAD 版本上用 `git stash` 对照同样失败，属本地负载敏感的间歇失败，与本批 diff 无关）；本批相关定向 `vitest` 11 文件 105 例全绿；`pnpm check:frontend:boundaries`（283 模块 1393 依赖）通过；真实 E2E 定向用例通过。

未运行 / 已知偏差：① 未跑 `pnpm check` 整链、全量 `pnpm test:e2e`、`deps:audit`（需 registry 访问）与 GitHub Actions；② R-3 的 `leftoverCount` / `leftoverSample` 后端恒 0 缺陷本次未改后端——页面已不再依赖该字段，但契约字段仍在，建议后续单独修复（其集成测试夹具需同步改成真实路径）或收敛契约；③ 页头计数与侧栏一样是全局范围，选定项目筛选后不随列表一起收窄，弹窗内容在选定项目时可能小于该数字（既有设计，本次未改）。

## 迭代记录草稿箱「空则收起」（产品要求，2026-09-22 本地落库）

产品反馈（原文）：「这个草稿箱在没有草稿的时候默认收起状态，在有草稿的时候默认显示，也就是保持现有状态」（附图为 `/records` 全部项目视图的「我的草稿」区，下方是已发布记录时间线）。本批为纯前端展示改动：不改契约、Route Registry、权限矩阵、数据库不变量、迁移、鉴权与幂等策略，后端零改动。

口径：草稿箱的**内容区**只在真有内容可渲染时出现——有草稿卡片，或读取失败需要给出重试入口；空草稿箱（含首次加载中）默认收起，不再渲染「暂无草稿」空态卡片，记录时间线上移。标题行（`我的草稿` / `项目草稿` / `来源草稿`）与说明、以及来源任务语境下的「新建来源草稿」入口都在标题行 `CalmSectionTitle` 里，始终保留：收起既不带走创建入口，也不吞掉错误提示；同时沿用 RECORD-DRAFTS-CARD-001 的「草稿箱默认平铺、标题无折叠箭头」口径，没有重新引入折叠控件。

| 编号 | 类型 | 覆盖点 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| RECORD-DRAFTS-EMPTY-WEB-001 | Web 单元 | 空草稿箱收起 | `RecordDraftsView.test.tsx`「收起草稿箱：空草稿时只留标题行，不渲染内容区与「暂无草稿」空态」：`listRecordDrafts` 返回空页时 `heading 项目草稿` 可见，`#record-draft-list` 与文本「暂无草稿」都不存在 | 本地通过（2026-09-22） |
| RECORD-DRAFTS-EMPTY-WEB-002 | Web 单元 | 有草稿时照旧展开 | 同文件「展开草稿箱：有草稿时默认照旧平铺卡片」：`#record-draft-list` 存在且「继续编辑」按钮 1 个 | 本地通过（2026-09-22） |
| RECORD-DRAFTS-EMPTY-WEB-003 | Web 单元 | 全部项目视图同样收起 | 同文件「全部项目视图的空草稿箱同样收起，标题仍是「我的草稿」」：`listMyRecordDrafts` 返回空页时 `heading 我的草稿` 可见、`#record-draft-list` 为 null | 本地通过（2026-09-22） |
| RECORD-DRAFTS-EMPTY-WEB-004 | Web 单元 | 来源任务语境保留创建入口 | 同文件「来源任务的空草稿箱收起，标题行的「新建来源草稿」入口保留」：`getTaskRecordDrafts` 返回空列表时按钮「新建来源草稿」可见、`#record-draft-list` 为 null | 本地通过（2026-09-22） |
| RECORD-DRAFTS-EMPTY-WEB-005 | Web 单元 | 读取失败不被收起吞掉 | 同文件「草稿读取失败时内容区仍然展开，保留错误与重试入口」：`listRecordDrafts` 以 `ApiError(500)` 拒绝时按钮「重试草稿列表」可见 | 本地通过（2026-09-22） |
| RECORD-DRAFTS-EMPTY-GATE-001 | 静态门禁 | 类型、风格与全量前端 | `pnpm --filter @inpulse/web test`（85 文件 576 例）、`pnpm --filter @inpulse/web exec vitest run src/features/record-drafts/RecordDraftsView.test.tsx`（19 例）、`pnpm --filter @inpulse/web exec tsc --noEmit`、`pnpm exec prettier --write`（2 个改动文件）、`pnpm lint` 通过 | 本地通过（2026-09-22） |

本地实际执行（2026-09-22 草稿箱「空则收起」）：`pnpm --filter @inpulse/web exec vitest run src/features/record-drafts/RecordDraftsView.test.tsx`（19 例通过）、`pnpm --filter @inpulse/web test`（85 文件 576 例通过）、`pnpm --filter @inpulse/web exec tsc --noEmit`、`pnpm lint`（eslint .）、`pnpm exec prettier --write`（`RecordDraftsView.tsx`、`RecordDraftsView.test.tsx`）通过。

未运行：整链 `pnpm typecheck` / `pnpm build` / `pnpm check`、`pnpm test:e2e`（Playwright；`record-feed.spec.ts` 的 `#record-draft-list` 与 `heading 我的草稿` 断言、`record-drafts.spec.ts` 的 `.draft-card` 断言都在「已创建草稿」路径上，按本口径不受影响但本轮未跑）、`pnpm deps:audit`、GitHub Actions。浏览器实测本轮未做。

> 2026-09-23 更新：本节的「内容区收起 / 标题行常驻」口径已被当天的八次定案取代——空草稿箱改为标题、说明、折叠按钮与内容区整块隐藏，有草稿时默认展开并可用标题行小按钮折叠内容区，草稿箱随项目筛选一起筛（见本文件末节《2026-09-23 八次定案：草稿箱空则整块隐藏 + 可折叠 + 跟随项目筛选》）。正文保留当时的执行事实，不改写。

## 删除「低」（LOW）优先级档位（ADR-041，产品要求，2026-09-23 本地落库）

产品反馈（原文）：「取消低优先级，彻底删除所有和低优先级有关的代码ui」（附图为 `/tasks` 顶部「全部优先级」下拉，仍列出 全部优先级 / 紧急 / 高 / 普通 / 低）。定案口径：优先级由四档收窄为 `URGENT / HIGH / NORMAL` 三档，任务中心筛选、新建与编辑任务表单、遗留项转任务、任务看板筛选、卡片配色、列表行样式与数据库 CHECK 一起下线；存量 `LOW` 任务按默认档 `NORMAL` 归一，不删除任务本体、状态历史、审计、活动与搜索投影、聚合关系。决策记录见 [ADR-041](./adr/ADR-041.md)（`Accepted`，修订 [ADR-037](./adr/ADR-037.md) 的排序键与游标版本）。

数据库：新增 `database/migrations/0022_drop_low_priority.sql`，三步顺序不可颠倒 —— ① `UPDATE app.tasks SET priority = 'NORMAL', row_version = row_version + 1 WHERE priority = 'LOW'`（`tasks_row_version` 触发器要求行版本恰好递增一次，持有旧版本号的客户端编辑时按乐观锁拿到 409）；② `SET CONSTRAINTS ALL IMMEDIATE`，让此前延迟的约束检查先落地；③ `DROP`/`ADD` 把 `tasks_priority_check` 收紧为 `('NORMAL', 'HIGH', 'URGENT')`。若先收紧 CHECK，表内仍存在的 `LOW` 行会让 `ADD CONSTRAINT` 直接失败。历史迁移 `0000_initial.sql` 不改写，升级窗口由该新迁移承接。

排序与游标：`apps/api/src/modules/tasks/task-list-order.ts` 的优先级 CASE 由 `0/1/2/3` 收窄为 `0/1/2`（未命中一律 2），`TASK_LIST_SORT_KEY_VERSION` 由 3 升到 4 —— 旧键第 5 段的 `3` 原意是「低」，在新口径下不对应任何任务的序号，继续接受会在 keyset 比较里静默跳页 / 漏项，因此按无效游标整版拒绝。任务看板读端口 `listForBoard` 的 `ELSE 3` 同步改为 `ELSE 2`。

前端兜底：`task-tone.ts` 与 `priority-select-option.ts` 对未知优先级（含历史 `LOW`）统一回落到「普通」的 `normal` / `#337ee6`，不再有低档的中性灰 `#a0adb9`；`design-system.css` 里 `.tone-prio-low` 的三处定义（列表行浅色变量块、行标题选择器、卡片实色块）整体删除。

| 编号 | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| LOW-PRIORITY-DB-001 | 真实 PostgreSQL 迁移 | 存量归一 + CHECK 收紧 | `0022_drop_low_priority.sql` 执行后 `pnpm db:migrate` 报 `Applied 0022_drop_low_priority.sql`；`pnpm db:migrations:check` 23 条通过；真库按 `app.tasks.priority` 分组只剩 `HIGH 66 / NORMAL 7131 / URGENT 53`，`LOW` 由 7 条归零；`app.tasks` 的 `tasks_priority_check` 已不含 `LOW` | 本地通过（2026-09-23） |
| LOW-PRIORITY-CONTRACT-001 | 契约生成 | 枚举收窄落进契约与生成客户端 | `TASK_PRIORITIES`、`TaskEditRequest.priority`、`ProjectMemberUnfinishedTaskItem.priority`、`TaskBoardCard.priority` 与任务中心读取 Schema 同步收窄为三档；`pnpm contract:generate` 重生成 `packages/api-contract/generated/openapi.json` 与 `apps/web/src/generated/api/*` 后，契约与生成物中 `LOW` 零残留；`pnpm contract:drift` 无漂移、`pnpm contract:validate` 108 条通过、`pnpm permissions:check` 108/108 通过 | 本地通过（2026-09-23） |
| LOW-PRIORITY-API-002 | API 单测 | 游标版本 4 与旧键整版拒绝 | 新增 `apps/api/test/task-list-order.test.ts`：`TASK_LIST_SORT_KEY_VERSION` 为 4，样本键往返为 `4\|0\|\|4\|2\|\|501`，旧版载荷（含原「低」序号 `3\|0\|\|4\|3\|\|501` 与版本 2）经 `parseTaskListSortKey` 一律返回 `null` | 本地通过（2026-09-23） |
| LOW-PRIORITY-API-003 | 真实 HTTP API 集成 | 请求里的 `LOW` 与排序改判 | `aggregate-read-api.integration.test.ts`：`GET /api/v1/me/tasks?priority=LOW` 与既有 `priority=CRITICAL` 同为非法枚举 422；`tasks-api.integration.test.ts` 的排序用例把「低优任务」改为「高优任务」，未完成组内期望顺序随之改判 紧急 → 高 → 普通 | 本地通过（2026-09-23） |
| LOW-PRIORITY-WEB-001 | Web 单元 | 卡片配色与下拉圆点的三档化 | `task-tone.test.ts`：「三个优先级取卡片实色：紧急 / 高 / 普通」，以及「已下线的「低」与其它未知值都落到「普通」，不整页崩溃」——`taskToneOf("LOW", "TODO")` / `taskToneOf("SOMEDAY", "TODO")` / `taskToneOf("", "")` 都为 `normal`，`taskToneClassName("LOW", "TODO")` 不等于 `tone-prio-low`。`priority-select-option.test.ts`：「已下线的「低」与其它未知值都按「普通」的蓝色处理」——`priorityDotColor("LOW")` / `("SOMEDAY")` / `("")` 都为 `#337ee6` | 本地通过（2026-09-23） |
| LOW-PRIORITY-WEB-002 | Web 单元 | 筛选与下拉里不再出现「低」 | 任务中心（`TaskCenterPageView.tsx` / `.test.tsx`、`my-tasks-types.ts`、`my-tasks-url.ts`、`my-tasks-mock.ts`、`my-tasks-v1-query.test.ts`）、任务看板（`task-board-filters.ts` / `.test.ts`、`task-board-format.ts` / `.test.ts`、`TaskBoardToolbar.tsx`）、新建与编辑任务（`GlobalTaskCreateModal.tsx`）、功能页任务面板（`TasksPanel.tsx`）与遗留项转任务（`ConvertLeftoverTask.tsx`）的优先级选项 / 标签 / 圆点 / URL 参数统一为三档；`pnpm --filter @inpulse/web test` 85 文件 576 例通过 | 本地通过（2026-09-23） |
| LOW-PRIORITY-GATE-001 | 静态门禁 | 类型、风格、依赖边界与 Secret | `pnpm typecheck`（全 workspace，含 `tsconfig.test.json`）、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`、`pnpm check:deps`（722 条）、`pnpm check:secrets`（1069 条）、`pnpm check:docs`（88 个 Markdown）、`pnpm db:seed:check`（28 表）通过 | 本地通过（2026-09-23） |

本地实际执行（2026-09-23 删除「低」档位）：`pnpm contract:generate` / `pnpm contract:drift` / `pnpm contract:validate`（108 条）/ `pnpm permissions:check`（108/108）、`pnpm db:migrations:check`（23 条）、`pnpm db:seed:check`（28 表）、`pnpm db:migrate`（`Applied 0022_drop_low_priority.sql`）、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`、`pnpm check:deps`（722 条）、`pnpm check:secrets`（1069 条）、`pnpm check:docs`（88 个 Markdown）、`pnpm --filter @inpulse/web test`（85 文件 576 例）、`pnpm --filter @inpulse/api test:unit`（66 文件 368 例）；真实 PostgreSQL 18.6 + PGroonga 定向集成 `apps/api/test/tasks-api.integration.test.ts`、`task-board-ports.integration.test.ts`、`aggregate-read-list-api.integration.test.ts`、`aggregate-read-api.integration.test.ts`、`aggregate-read-ports.integration.test.ts` 5 文件 105 例通过。

未运行 / 已知偏差：① 未跑全量 `pnpm test:integration`、`pnpm build`、`pnpm test:e2e`（Playwright）、整链 `pnpm check`、`pnpm deps:audit` 与 GitHub Actions；② `docs/assets/task-card-colors` 的样图仍是 2026-09-22 生成的历史图，仍含已下线的「低」卡，未重出（`docs/task-card-colors.md` 的图注已标注）；③ 演示种子里 `task.create` 审计行的事件载荷仍保留 `"priority": "LOW"` —— 审计是只追加的不可变历史，改载荷会让哈希链失配，因此刻意不做「事后美化」，属预期而非缺陷。

## 2026-09-23 二次配色定案：「高」改蓝、「普通」改白（产品要求，2026-09-23 本地落库）

> 2026-09-23 更新：本节里「高」的取值已被同日三次定案取代（「高」最终为金黄 `#fdc106` + 深棕字，「普通」白底卡与紧急红不变），见文件末尾《2026-09-23 三次配色定案：「高」改金黄》。下表保留当时的实际执行结果，不改写。

产品反馈（原文）：「好紧急颜色不变，优先级高改为蓝色的，优先级普通改为白色的」（附图为 `/tasks` 的「全部优先级」下拉：紧急红点 / 高橄榄点 / 普通蓝点，同屏背景是高卡与普通卡）。口径：紧急 `#ce342b` 不变；「高」改为原「普通」的蓝 `#337ee6`（白字，3.99:1）；「普通」改为原「低」的白底卡 `#ffffff`（描边 `#d9e0e7`、悬停 `#f5f8fa`，继承深色正文）。明黄 `#ffdb4d` 与深棕字 `#3f2d00` 退出。改动面：`design-system.css` 的卡片实色块、列表行浅色变量、白字组 / 深字组归属，`priority-select-option.ts` 的圆点表，`task-tone.ts` 的优先级徽章色调。不改契约、路由、权限矩阵、数据库、迁移与排序键，后端零改动。

| 编号 | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| PRIORITY-COLOR-WEB-001 | Web 单元 | 下拉圆点三档改判 | `priority-select-option.test.ts`「三个优先级按卡片取色：紧急红 / 高蓝 / 普通中性灰」：URGENT `#ce342b`、HIGH `#337ee6`（原 `#8a6e00`）、NORMAL `#a0adb9`（原 `#337ee6`）；「已下线的「低」与其它未知值都按「普通」的中性灰处理」：`LOW` / `SOMEDAY` / 空串都回 `#a0adb9` | 本地通过（2026-09-23） |
| PRIORITY-COLOR-WEB-002 | Web 单元 | 优先级徽章色调与卡片同调 | `task-tone.test.ts` 新增 `taskPriorityBadgeTone` 两组断言：「徽章色调与卡片同调：紧急红 / 高蓝 / 普通灰」URGENT `red`、HIGH `blue`（原 `amber`）、NORMAL `gray`（原 `blue`）；「已下线的「低」与其它未知值都按中性灰处理」三条未知输入都回 `gray` | 本地通过（2026-09-23） |
| PRIORITY-COLOR-BROWSER-001 | 浏览器实测 | 六档卡片实色与卡内文字的计算值 | 无头 Chromium（本地 1440 宽）把 `apps/web/src/styles/design-system.css` 的真实样式表注入页面后读计算值：`tone-prio-urgent` 底 `rgb(206, 52, 43)` / 边 `rgb(177, 44, 37)` / 白字、`tone-prio-high` 底 `rgb(51, 126, 230)` / 边 `rgb(44, 108, 198)` / 白字、`tone-prio-normal` 底 `rgb(255, 255, 255)` / 边 `rgb(217, 224, 231)` / 标题 `rgb(36, 61, 84)`、`tone-prio-done` 底 `rgb(225, 242, 242)` / 边 `rgb(188, 221, 223)` / 字 `rgb(29, 91, 98)`、`tone-prio-canceled` 底 `rgb(242, 245, 248)`、`tone-prio-leftover` 底 `rgb(138, 43, 6)`；实色卡内 `.badge` 统一 `rgba(255, 255, 255, 0.18)` + 白字，白底卡内徽章按自身色调（`rgb(230, 242, 255)` + `rgb(36, 114, 195)`）；白卡在浅色页底上靠 2px 描边划界，截图留档 | 本地通过（2026-09-23） |
| PRIORITY-COLOR-WEB-003 | Web 单元 | 全量前端回归 | `pnpm --filter @inpulse/web test` 85 文件 578 例通过（上一轮 576 例 + 本轮新增 2 例徽章色调用例）；`pnpm --filter @inpulse/web exec tsc --noEmit` 无输出 | 本地通过（2026-09-23） |
| PRIORITY-COLOR-GATE-001 | 静态门禁 | 风格与静态检查 | `pnpm exec prettier --write`（5 个改动文件）、`pnpm format:check`、`pnpm lint` 通过 | 本地通过（2026-09-23） |

本地实际执行（2026-09-23 二次配色定案）：「`pnpm --filter @inpulse/web exec vitest run src/features/common/task-tone.test.ts src/features/common/priority-select-option.test.ts`」2 文件 10 例通过、`pnpm --filter @inpulse/web test`（85 文件 578 例）、`pnpm --filter @inpulse/web exec tsc --noEmit`、`pnpm exec prettier --write`（`design-system.css`、`task-tone.ts` / `.test.ts`、`priority-select-option.ts` / `.test.ts`）、`pnpm format:check`、`pnpm lint` 通过；渲染计算值见 PRIORITY-COLOR-BROWSER-001。

未运行 / 已知偏差：① 本轮只改前端视觉与两个色值常量表，未跑 API 单测、真实 PostgreSQL 集成、契约 / 权限 / 依赖边界 / Secret / 文档门禁、`pnpm build`、`pnpm test:e2e`（Playwright）与 GitHub Actions；② 「高」接原「普通」的蓝后白字对比度仍是 3.99:1，低于 AA 的 4.5:1 —— 原「普通」的既有取舍直接转移到「高」上，产品已知悉；③ `docs/assets/task-card-colors` 的样图未重出，仍含旧「高」明黄与旧「普通」蓝；④ 配色属视觉主观项，需非作者人工评审。

## 2026-09-23 三次配色定案：「高」改金黄（产品要求，2026-09-23 本地落库）

> 2026-09-23 更新：本节的卡片实色口径仍有效，但**列表行 / 表格行**那组金黄取值（`#c9821a` / `#fdf8ee` / `#faeed7` / `#f0dfc0` / `#7d5310`）已被同日四次定案取代（列表行改按卡片色派生），见文件末尾《2026-09-23 四次配色定案：列表行按卡片色派生》。下表与正文保留当时的实际执行结果，不改写。

产品反馈（原文）：「优先级高的这个卡片颜色改为这个图里的黄色」（附图为品牌 Logo 的盾形金色）。色值取自附图的逐像素采样：金黄 `#fdc106`（附图另一主色是深藏蓝 `#10253E`，与卡片无关）。口径：紧急 `#ce342b` 不变；「高」由二次定案的蓝 `#337ee6` 改为金黄 `#fdc106` + 深棕字 `#3f2d00`（描边 `#daa605`、悬停 `#e4ae05`；白字 3.99:1 → 深棕字 8.07:1，三次定案后实色卡里不再有低于 AA 的档位）；「普通」白底卡、已完成青碧、已取消与遗留问题锈红不变。改动面：`design-system.css` 的卡片实色块 / 列表行浅色变量 / 白字组与深字组归属，`priority-select-option.ts` 的圆点表，`task-tone.ts` 的优先级徽章色调，以及二次定案漏掉的两处「普通」徽章（`TasksPanel.tsx` 的 `priorityTone`、`task-board-format.ts` 的 `priorityMarkOf`，由 `blue` 补齐为 `gray`）。不改契约、路由、权限矩阵、数据库、迁移与排序键，后端零改动；`docs/adr/ADR-041.md` 的圆点兜底值注释同步为中性灰 `#a0adb9`。

| 编号 | 层级 | 场景 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| PRIORITY-COLOR-THREE-WEB-001 | Web 单元 | 下拉圆点「高」回到金黄同族深版 | `priority-select-option.test.ts`「三个优先级按卡片取色：紧急红 / 高金 / 普通中性灰」：URGENT `#ce342b`、HIGH `#8a6e00`（原 `#337ee6`）、NORMAL `#a0adb9`；「已下线的「低」与其它未知值都按「普通」的中性灰处理」：`LOW` / `SOMEDAY` / 空串仍回 `#a0adb9` | 本地通过（2026-09-23） |
| PRIORITY-COLOR-THREE-WEB-002 | Web 单元 | 优先级徽章色调回到 `amber` | `task-tone.test.ts`「徽章色调与卡片同调：紧急红 / 高金 / 普通灰」：URGENT `red`、HIGH `amber`（原 `blue`）、NORMAL `gray`；「已下线的「低」与其它未知值都按中性灰处理」三条仍回 `gray` | 本地通过（2026-09-23） |
| PRIORITY-COLOR-THREE-WEB-003 | Web 单元 | 看板优先级标记与列表行 tone 改判 | `task-board-format.test.ts` 的 `priorityMarkOf("NORMAL")` 由 `blue` 改判 `gray`；`TaskBoardPageView.test.tsx`「列表视图渲染分组表格行」的「普通」行类名由 `tb-row--tone-blue` 改判 `tb-row--tone-gray`（`tb-row--canceled` / `tb-row--done` 覆盖状态色的断言不变） | 本地通过（2026-09-23） |
| PRIORITY-COLOR-THREE-BROWSER-001 | 浏览器实测 | 六档卡片与列表行的计算值 | 无头 Chromium（本地 1440 宽）把真实 `apps/web/src/styles/design-system.css` 注入页面后读计算值：`tone-prio-high` 卡底 `rgb(253, 193, 6)` / 边 `rgb(218, 166, 5)` / 标题 `rgb(63, 45, 0)`、卡内 `.badge` 为 `rgba(63, 45, 0, 0.12)` + `rgb(63, 45, 0)`、「遗留问题」徽章仍是深锈红实底 + 白字；金黄列表行底 `rgb(253, 248, 238)` / 色条 `rgb(201, 130, 26)` / 标题 `rgb(125, 83, 16)`；`tone-prio-urgent` `rgb(206, 52, 43)`、`tone-prio-normal` `rgb(255, 255, 255)` / 边 `rgb(217, 224, 231)` / 标题 `rgb(36, 61, 84)`、`tone-prio-done` `rgb(225, 242, 242)`、`tone-prio-canceled` `rgb(242, 245, 248)`、`tone-prio-leftover` `rgb(138, 43, 6)` 与二次定案一致，截图留档 | 本地通过（2026-09-23） |
| PRIORITY-COLOR-THREE-WEB-004 | Web 单元 | 全量前端回归 | `pnpm --filter @inpulse/web test` 85 文件 578 例通过（改的是既有断言的取值，未新增 / 删除用例）；`pnpm --filter @inpulse/web exec tsc --noEmit` 无输出 | 本地通过（2026-09-23） |
| PRIORITY-COLOR-THREE-GATE-001 | 静态门禁 | 风格与静态检查 | `pnpm exec prettier --write`（本轮 9 个改动文件）、`pnpm format:check`、`pnpm lint` 通过 | 本地通过（2026-09-23） |

本地实际执行（2026-09-23 三次配色定案）：「`pnpm --filter @inpulse/web exec vitest run src/features/common/task-tone.test.ts src/features/common/priority-select-option.test.ts src/features/task-board/task-board-format.test.ts`」3 文件 26 例通过、`pnpm --filter @inpulse/web test`（85 文件 578 例）、`pnpm --filter @inpulse/web exec tsc --noEmit`、`pnpm exec prettier --write`（`design-system.css`、`task-tone.ts` / `.test.ts`、`priority-select-option.ts` / `.test.ts`、`TasksPanel.tsx`、`task-board-format.ts` / `.test.ts`、`TaskBoardPageView.test.tsx`、`docs/adr/ADR-041.md`）；渲染计算值见 PRIORITY-COLOR-THREE-BROWSER-001。

未运行 / 已知偏差：① 本轮只改前端视觉与三处色调常量表，未跑 API 单测、真实 PostgreSQL 集成、契约 / 权限 / 依赖边界 / Secret / 文档门禁、`pnpm build`、`pnpm test:e2e`（Playwright）与 GitHub Actions；② 二次定案的「高」蓝仅在位半天，「高」的对比度问题从 3.99:1（低于 AA）回落到 8.07:1（已达标）；③ `docs/assets/task-card-colors` 的样图未重出，仍含旧「高」明黄 / 蓝与旧「普通」蓝；④ 配色属视觉主观项，需非作者人工评审。

## 2026-09-23 四次配色定案：列表行按卡片色派生（产品要求，2026-09-23 本地落库）

产品反馈（原文）：「把这个模式下的颜色也改一改，和卡片对应」（附图为任务中心 `/tasks?view=list` 的列表视图截图，「高」行当时是米黄底 `#fdf8ee` + 土金色条 `#c9821a` + 棕字 `#7d5310`）。口径：列表行 / 表格行改按卡片色派生——色条直接用卡片实色、底色是卡片色淡到极浅的一调、标题是同色系深字。紧急色条 `#c0453f` → `#ce342b`（卡片红）、标题 `#8f3f3f` → `#a52a22`（6.48:1）、悬停 `#fbe7e5` → `#fbe4e2`；「高」由 `#c9821a` / `#fdf8ee` / `#faeed7` / `#f0dfc0` / `#7d5310` 换成 `#fdc106`（卡片金）/ `#fff8de` / `#fdecbf` / `#f4e2a6` / `#6b4c00`（7.42:1）。看板列表行 `.tb-row--tone-red` / `.tb-row--tone-amber` 同值同步；看板优先级标签 `.tb-prio--red` `#c0453f` → `#c02b23`（5.30:1）、`.tb-prio--amber` `#c9821a` → `#8a6e00`（对行底 2.96:1 → 4.58:1，修掉 10px 小字不达 AA 的旧欠账）。卡片实色、`priority-select-option.ts`、`task-tone.ts`、契约 / 路由 / 权限矩阵 / 数据库零改动。

| 用例 ID | 类型 | 覆盖点 | 断言 / 证据 | 最近结果 |
| --- | --- | --- | --- | --- |
| PRIORITY-COLOR-FOUR-BROWSER-001 | 浏览器实测 | 六档列表行的计算值（改前 / 改后同页对照） | 无头 Chromium 1320 宽把真实 `design-system.css` 注入页面，按任务中心表格的真实标记渲染六行，同一页用 `.v-before` 作用域内的旧值复现改前状态：紧急底 `rgb(253, 242, 241)` / 色条 `rgb(206, 52, 43)` / 标题 `rgb(165, 42, 34)`（改前 `rgb(192, 69, 63)` / `rgb(143, 63, 63)`）；「高」底 `rgb(255, 248, 222)` / 色条 `rgb(253, 193, 6)` / 标题 `rgb(107, 76, 0)`（改前 `rgb(253, 248, 238)` / `rgb(201, 130, 26)` / `rgb(125, 83, 16)`）；普通 `rgb(246, 248, 250)` / `rgb(160, 173, 185)` / `rgb(95, 109, 122)`、已完成 `rgb(225, 242, 242)` / `rgb(29, 91, 98)`、已取消 `rgb(245, 247, 249)` / `rgb(170, 183, 196)`、遗留问题 `rgb(251, 238, 233)` / `rgb(138, 43, 6)` 四档不变；截图留档 | 本地通过（2026-09-23） |
| PRIORITY-COLOR-FOUR-WEB-001 | Web 单元 | 全量前端回归 | `pnpm --filter @inpulse/web test` 85 文件 578 例通过（本轮只改 CSS 变量与注释，未新增 / 删除用例） | 本地通过（2026-09-23） |
| PRIORITY-COLOR-FOUR-GATE-001 | 静态门禁 | 格式 / lint / 依赖边界 / 文档 | `pnpm format:check`（All matched files use Prettier code style）、`pnpm lint`、`pnpm check:frontend:boundaries`（283 模块 1393 依赖无违规）、`pnpm check:docs` 通过 | 本地通过（2026-09-23） |
| PRIORITY-COLOR-FOUR-BROWSER-002 | 浏览器实测 | dev 5173 上样式表已生效 | `GET http://127.0.0.1:5173/src/styles/design-system.css` 返回的 `.tone-prio-high` 已是 `--task-c: #fdc106; --task-bg: #fff8de; --task-hov: #fdecbf; --task-bd: #f4e2a6; --task-fg: #6b4c00`、`.tone-prio-urgent` 的色条已是 `#ce342b`（Vite 热更新已把改动送到运行中的 dev 服务） | 本地通过（2026-09-23） |

本地实际执行（2026-09-23 四次配色定案）：`pnpm --filter @inpulse/web test`（85 文件 578 例）、`pnpm format:check`、`pnpm lint`、`pnpm check:frontend:boundaries`、`pnpm check:docs`；渲染计算值与同页改前 / 改后对照见 PRIORITY-COLOR-FOUR-BROWSER-001。

未运行 / 已知偏差：① 本轮只改前端视觉（`design-system.css` 的列表行浅色变量与看板行 / 标签色），未跑 API 单测、真实 PostgreSQL 集成、契约 / 权限 / Secret / 依赖审计门禁、`pnpm build`、`pnpm test:e2e`（Playwright）与 GitHub Actions；② 色条与底色同族，对比度天然低（金条对暖金底 1.54:1），识别不靠色条单点，行内另有优先级徽章与同色系标题；③ 真实登录态的任务中心页面未用无头浏览器截屏（dev 环境为统一身份认证登录，本轮用同标记 + 真实样式表的注入渲染替代），需要人工在浏览器里复核观感；④ 配色属视觉主观项，需非作者人工评审；⑤ `docs/assets/task-card-colors` 的样图未重出。

## 2026-09-23 五次配色定案：列表行整体加深一档（产品要求，2026-09-23 本地落库）

产品反馈（原文）：「颜色再深一点？」（承接同日四次定案「把这个模式下的颜色也改一改，和卡片对应」）。口径：六档列表行一起加深、保持表格内部相对关系，卡片实色不动。紧急 `#be3028` / `#fae0dd` / `#f5cfcb` / `#eec4bf` / `#8f1f18`（7.06:1）；「高」`#e6b005` / `#fff3c9` / `#fbe7a6` / `#efd88c` / `#5f4500`（8.09:1）；普通 `#8b99a7` / `#eef2f6` / `#e1e8ee` / `#d2dbe3` / `#51606e`；已完成 `#17535a` / `#d3ebec` / `#c6e3e4` / `#a6d1d4`；已取消 `#96a4b2` / `#e9edf1` / `#dbe2e9` / `#ccd5de` / `#5b6875`（压得更冷一档，避免与「普通」行分不出来）；遗留问题 `#7c2705` / `#f7dfd3` / `#f2cdbd` / `#e8bda8`。看板列表行 `.tb-row--*` 六块同值；看板优先级标签改为跟随该档行文字色（`#8f1f18` / `#5f4500` / `#5f6d7a`），因为底色加深后 `.tb-prio--gray` 旧值 `#8b99a7` 对底只剩 2.59:1。

| 用例 ID | 类型 | 覆盖点 | 断言 / 证据 | 最近结果 |
| --- | --- | --- | --- | --- |
| PRIORITY-COLOR-FIVE-BROWSER-001 | 浏览器实测 | 六档列表行的计算值（加深前 / 后同页对照） | 无头 Chromium 1360 宽注入真实 `design-system.css`、按任务中心表格真实标记渲染六行，同页用 `.v-before` 复现四次定案的旧值：紧急底 `rgb(250, 224, 221)` / 色条 `rgb(190, 48, 40)` / 标题 `rgb(143, 31, 24)`（改前 `rgb(253, 242, 241)` / `rgb(206, 52, 43)` / `rgb(165, 42, 34)`）；「高」底 `rgb(255, 243, 201)` / 色条 `rgb(230, 176, 5)` / 标题 `rgb(95, 69, 0)`（改前 `rgb(255, 248, 222)` / `rgb(253, 193, 6)` / `rgb(107, 76, 0)`）；普通 `rgb(238, 242, 246)` / `rgb(139, 153, 167)` / `rgb(81, 96, 110)`、已完成 `rgb(211, 235, 236)` / `rgb(23, 83, 90)`、已取消 `rgb(233, 237, 241)` / `rgb(150, 164, 178)`、遗留问题 `rgb(247, 223, 211)` / `rgb(124, 39, 5)`；截图留档 | 本地通过（2026-09-23） |
| PRIORITY-COLOR-FIVE-WEB-001 | Web 单元 | 全量前端回归 | `pnpm --filter @inpulse/web test` 85 文件 578 例通过（本轮只改 CSS 变量与注释）。`pnpm typecheck`（全 workspace）、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`、`pnpm check:docs` 通过 | 本地通过（2026-09-23） |
| PRIORITY-COLOR-FIVE-BROWSER-002 | 浏览器实测 | dev 5173 上样式表已生效 | `GET http://127.0.0.1:5173/src/styles/design-system.css` 返回的 `.tone-prio-high` 已是 `--task-c: #e6b005; --task-bg: #fff3c9; --task-hov: #fbe7a6; --task-bd: #efd88c; --task-fg: #5f4500`、`.tone-prio-urgent` 色条 `#be3028`、`.tone-prio-canceled` 底 `#e9edf1` | 本地通过（2026-09-23） |

本地实际执行（2026-09-23 五次配色定案）：`pnpm --filter @inpulse/web test`（85 文件 578 例）、`pnpm typecheck`、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`、`pnpm check:docs`；渲染计算值见 PRIORITY-COLOR-FIVE-BROWSER-001。

未运行 / 已知偏差：① 本轮只改前端视觉（列表行浅色变量与看板行 / 标签色），未跑 API 单测、真实 PostgreSQL 集成、契约 / 权限 / Secret / 依赖审计门禁、`pnpm build`、`pnpm test:e2e`（Playwright）与 GitHub Actions；② 真实登录态页面未用无头浏览器截屏（dev 环境走统一身份认证），用「同标记 + 真实样式表」的注入渲染替代，需人工在浏览器里复核；③ 加深后「已取消」与「普通」两张中性行仍属近邻色，行标题字重与删除线是主要区分手段；④ 配色属视觉主观项，需非作者人工评审；⑤ `docs/assets/task-card-colors` 的样图未重出。

> 2026-09-23 更新：本节的「普通」行灰底取值（`#8b99a7` / `#eef2f6` / `#e1e8ee` / `#d2dbe3` / `#51606e`）已被当天的六次定案取代为蓝边白底，其余五档与「整体加深一档」的口径仍有效，见下一节。正文保留当时的执行事实，不改写。

## 2026-09-23 六次配色定案：列表「普通」行改蓝边白底（产品要求，2026-09-23 本地落库）

产品反馈（原文）：「普通的任务在列表模式下改为蓝色边边，白色底」（附图为任务中心 `/tasks?view=list` 的列表视图截图，四行任务：「普通」行当时还是 `#eef2f6` 近白中性底 + 灰条 `#8b99a7`）。口径：只改列表行 / 表格行的「普通」一档，卡片侧不跟随。色条 `#1467d8`、底色 `#ffffff`、悬停 `#f2f7fe`、描边 `#dbe6f5`、文字仍取中性深色 `#51606e`（对白底 6.6:1）；白底行靠左侧 3px 蓝边与单元格分隔线（`#edf1f6`）分界。看板列表行 `.tb-row--tone-gray` 同值同步（类名 gray 只来自 `task-tone` 的色调映射）。卡片实色块 `:is(.calm-task-card, .tb-card).tone-prio-normal` 新增 `--task-c: #8b99a7`，把白底卡自己的中性灰竖条冻结住，避免卡片被一起改成蓝色。其余五档不变。

| 用例 ID | 类型 | 覆盖点 | 断言 / 证据 | 最近结果 |
| --- | --- | --- | --- | --- |
| PRIORITY-COLOR-SIX-BROWSER-001 | 浏览器实测 | 「普通」行与白底卡的计算值（改前 / 改后同页对照） | 无头 Chromium 1340 宽把真实 `design-system.css` 注入页面、按任务中心表格的真实标记渲染六行，同页用作用域类复现五次定案的旧值：**「普通」行底 `rgb(255, 255, 255)` / 色条 `rgb(20, 103, 216)` / 标题 `rgb(81, 96, 110)`**（改前 `rgb(238, 242, 246)` / `rgb(139, 153, 167)`）；卡片侧白底卡的 `::before` 竖条仍是 `rgb(139, 153, 167)`（未跟随变蓝）；紧急 `rgb(250, 224, 221)` / `rgb(190, 48, 40)` / `rgb(143, 31, 24)`、高 `rgb(255, 243, 201)` / `rgb(230, 176, 5)` / `rgb(95, 69, 0)`、已完成 `rgb(211, 235, 236)` / `rgb(23, 83, 90)`、已取消 `rgb(233, 237, 241)` / `rgb(150, 164, 178)`、遗留问题 `rgb(247, 223, 211)` / `rgb(124, 39, 5)` 五档未变；截图留档 | 本地通过（2026-09-23） |
| PRIORITY-COLOR-SIX-WEB-001 | Web 单元 | 全量前端回归 | `pnpm --filter @inpulse/web test` 85 文件 578 例通过（本轮只改 CSS 变量与注释，未新增 / 删除用例） | 本地通过（2026-09-23） |
| PRIORITY-COLOR-SIX-GATE-001 | 静态门禁 | 格式 / lint / 依赖边界 / 文档 | `pnpm lint`、`pnpm format:check`（All matched files use Prettier code style!）、`pnpm check:frontend:boundaries`（283 模块 1393 依赖无违规）、`pnpm check:docs`（88 个 Markdown 文件的链接与锚点有效）通过 | 本地通过（2026-09-23） |
| PRIORITY-COLOR-SIX-BROWSER-002 | 浏览器实测 | dev 5173 上样式表已生效 | `GET http://127.0.0.1:5173/src/styles/design-system.css` 返回的 `.tone-prio-normal` 已是 `--task-c: #1467d8; --task-bg: #ffffff; --task-hov: #f2f7fe; --task-bd: #dbe6f5; --task-fg: #51606e`、卡片块 `:is(.calm-task-card, .tb-card).tone-prio-normal` 的 `--task-c` 仍是 `#8b99a7`（Vite 热更新已把改动送到运行中的 dev 服务） | 本地通过（2026-09-23） |

本地实际执行（2026-09-23 六次配色定案）：`pnpm --filter @inpulse/web test`（85 文件 578 例）、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`（283 模块 1393 依赖）、`pnpm check:docs`（88 个 Markdown 文件）；渲染计算值与同页改前 / 改后对照见 PRIORITY-COLOR-SIX-BROWSER-001。

未运行 / 已知偏差：① 本轮只改前端视觉（列表行「普通」一档的浅色变量、卡片块的 `--task-c` 冻结与看板行同值同步），未跑 API 单测、真实 PostgreSQL 集成、契约 / 权限 / Secret / 依赖审计门禁、`pnpm build`、`pnpm test:e2e`（Playwright）与 GitHub Actions；② 白底行与表底（`#ffffff`）同色，区分完全依赖左侧 3px 蓝边与单元格分隔线（`#edf1f6`），若后续把表底或分隔线改浅需重新核对；（2026-09-23 更新：本节的「普通」蓝边白底口径仍然有效，未受七次定案影响——七次定案只动了「已完成」一档。）③ 真实登录态的任务中心页面未用无头浏览器截屏（dev 环境为统一身份认证登录），本轮用同标记 + 真实样式表的注入渲染替代，需要人工在浏览器里复核观感；④ 配色属视觉主观项，需非作者人工评审；⑤ `docs/assets/task-card-colors` 的样图未重出。

## 2026-09-23 七次配色定案：「已完成」列表行改用卡片青碧（产品要求，2026-09-23 本地落库）

产品反馈（原文）：「我想 p1 用 p2 的颜色」——p1 指任务中心 `/tasks?status=done` 已完成列表行的截图（当时常态底 `#d3ebec`、悬停 `#c6e3e4`），p2 指卡片青碧的截图（像素实测 `#e1f2f2`）。口径：把「已完成」一档的列表行 / 表格行拉回与卡片同值——底 `#e1f2f2`、悬停 `#d6edee`、描边 `#bcdddf`，色条与标题仍是 `#17535a`（对 `#e1f2f2` 7.42:1）；看板列表行 `.tb-row--done` 同值同步。卡片实色自 2026-09-22 D 青碧定案起就是这一组值，改动前后计算值一致；「已完成」这一档因此退出五次定案「列表行比卡片深一档」的规律，其余五档不变。

| 用例 ID | 类型 | 覆盖点 | 断言 / 证据 | 最近结果 |
| --- | --- | --- | --- | --- |
| PRIORITY-COLOR-SEVEN-BROWSER-001 | 浏览器实测 | 已完成行与卡片的计算值（改前 / 改后同页对照 + 悬停） | 无头 Chromium 1360 宽把真实 `design-system.css` 注入页面、按任务中心表格真实标记渲染七行，同页用 `.v-before tr.tone-prio-done` 复现五次定案旧值：**新版的已完成行常态底 `rgb(225, 242, 242)`**（改前 `rgb(211, 235, 236)`）、色条 `rgb(23, 83, 90)`、标题 `rgb(23, 83, 90)`、悬停 `rgb(214, 237, 238)`（改前悬停 `rgb(198, 227, 228)`；悬停值必须等 0.15s `background` 过渡结束后再读，直接读会拿到过渡中间值，本用例读取前等待 450ms）；卡片 `.calm-task-card.tone-prio-done` 与 `.tb-card.tone-prio-done` 在改前 / 改后都是 `rgb(225, 242, 242)` / 描边 `rgb(188, 221, 223)`；紧急 `rgb(250, 224, 221)` / `rgb(190, 48, 40)` / `rgb(143, 31, 24)`、高 `rgb(255, 243, 201)` / `rgb(230, 176, 5)` / `rgb(95, 69, 0)`、普通 `rgb(255, 255, 255)` / `rgb(20, 103, 216)` / `rgb(81, 96, 110)`、已取消 `rgb(233, 237, 241)` / `rgb(150, 164, 178)` / `rgb(91, 104, 117)`、遗留问题 `rgb(247, 223, 211)` / `rgb(124, 39, 5)` 五档未变；对照截图留档 | 本地通过（2026-09-23） |
| PRIORITY-COLOR-SEVEN-WEB-001 | Web 单元 | 全量前端回归 | `pnpm --filter @inpulse/web test` 85 文件 578 例通过（本轮只改 CSS 变量与注释，未新增 / 删除用例） | 本地通过（2026-09-23） |
| PRIORITY-COLOR-SEVEN-GATE-001 | 静态门禁 | 格式 / lint / 依赖边界 / 文档 | `pnpm lint`、`pnpm format:check`（All matched files use Prettier code style!）、`pnpm check:frontend:boundaries`（283 模块 1393 依赖无违规）、`pnpm check:docs`（88 个 Markdown 文件的链接与锚点有效）通过 | 本地通过（2026-09-23） |
| PRIORITY-COLOR-SEVEN-BROWSER-002 | 浏览器实测 | dev 5173 上样式表已生效 | `GET http://127.0.0.1:5173/src/styles/design-system.css` 返回的 `.tone-prio-done` 已是 `--task-c: #17535a; --task-bg: #e1f2f2; --task-hov: #d6edee; --task-bd: #bcdddf; --task-fg: #17535a`、`.tb-row--done` 的 `--tb-row-bg` 已是 `#e1f2f2`（Vite 热更新已把改动送到运行中的 dev 服务） | 本地通过（2026-09-23） |

本地实际执行（2026-09-23 七次配色定案）：`pnpm --filter @inpulse/web test`（85 文件 578 例）、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`（283 模块 1393 依赖）、`pnpm check:docs`（88 个 Markdown 文件）；渲染计算值与同页改前 / 改后对照见 PRIORITY-COLOR-SEVEN-BROWSER-001。

未运行 / 已知偏差：① 本轮只改前端视觉（`design-system.css` 里「已完成」一档的列表行变量与看板列表行变量），未跑 API 单测、真实 PostgreSQL 集成、契约 / 权限 / Secret / 依赖审计门禁、`pnpm build`、`pnpm test:e2e`（Playwright）与 GitHub Actions；② 「已完成」列表行底色改用卡片青碧后，它与卡片同面同色，两者靠「卡片是圆角实色块、列表行是带 3px 色条的表格行」区分，不再是深浅差；③ 真实登录态的任务中心页面未用无头浏览器截屏（dev 环境为统一身份认证登录），本轮用同标记 + 真实样式表的注入渲染替代，需要人工在浏览器里复核观感；④ 配色属视觉主观项，需非作者人工评审；⑤ 本轮另出了一张《已完成行用卡片青碧-对照》样图，`docs/assets/task-card-colors` 目录下的历史样图仍未重出。


## 2026-09-23 八次定案：草稿箱空则整块隐藏 + 可折叠 + 跟随项目筛选（产品要求，2026-09-23 本地落库）

产品反馈（原文）：「现在我们改草稿箱，当点击迭代记录的时候，会显示全部项目的迭代记录，没有草稿的情况下不出现任何和草稿箱有关的字样。同理筛选到没有草稿的项目也隐藏所有有关草稿箱。假如当前已经有草稿了，则点击迭代记录的时候默认打开草稿箱，但是我希望可以有一个小按钮将草稿箱内容折叠。当筛选项目的时候草稿箱也要被筛选」（附图为 `/records` 全部项目视图的「我的草稿」区与下方的已发布时间线）。定案口径把 2026-09-22 的「空则收起」升级成「空则整块隐藏」：草稿箱的**标题行、说明、折叠按钮与内容区**在有草稿（或读取失败需要给出重试入口）之前一律不渲染，页面上不留「我的草稿 / 项目草稿」任何字样；有草稿时默认展开，标题行右侧新增 26px 幽灵方钮折叠内容区（箭头朝下＝展开中、朝右＝已收起），折叠只收内容区，标题、说明与按钮留在原地；切换项目或进出来源任务语境时回到默认展开；草稿查询本就按 URL `projectId` 走 `listRecordDrafts(projectId, …)` / `listMyRecordDrafts`，因此项目筛选天然把草稿箱一起筛，空结果整块消失。纯前端展示改动：不改契约、Route Registry、权限矩阵、数据库不变量、迁移、鉴权与幂等策略，后端零改动。

| 编号 | 类型 | 覆盖点 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| RECORD-DRAFTS-HIDE-WEB-001 | Web 单元 | 空草稿箱整块不渲染 | `RecordDraftsView.test.tsx`「空草稿箱整块不渲染：没有草稿时不留任何与草稿箱有关的字样」：`listRecordDrafts` 解析为空页（含首次挂起中）时 `heading 项目草稿`、`#record-draft-list`、文本「暂无草稿」与折叠按钮都不存在 | 本地通过（2026-09-23） |
| RECORD-DRAFTS-HIDE-WEB-002 | Web 单元 | 全部项目视图同样整块不渲染 | 同文件「全部项目视图的空草稿箱整块不渲染，连「我的草稿」标题也不出现」：`listMyRecordDrafts` 返回空页时 `heading 我的草稿` 为 null、`#record-draft-list` 为 null | 本地通过（2026-09-23） |
| RECORD-DRAFTS-HIDE-WEB-003 | Web 单元 | 有草稿默认展开 + 小按钮折叠 / 展开 | 同文件「有草稿时默认展开，标题行的小按钮能把内容区折叠再展开」：初始 `#record-draft-list` 存在；点「收起草稿箱」后列表消失而标题与按钮仍在、按钮 `aria-expanded` 为 `false`；再点「展开草稿箱」后卡片回来 | 本地通过（2026-09-23） |
| RECORD-DRAFTS-HIDE-WEB-004 | Web 单元 | 草稿箱跟随项目筛选 | 同文件「筛选项目时草稿箱跟着筛选：切到没有草稿的项目整块消失，切回后回到默认展开」：切到没有草稿的项目 2 时整块消失，切回项目 1 后列表回到默认展开；断言 `listRecordDrafts(2, {limit: 20, authorId: 3}, signal)` | 本地通过（2026-09-23） |
| RECORD-DRAFTS-HIDE-WEB-005 | Web 单元 | 来源任务视图保留创建入口 | 同文件「来源任务的空草稿箱收起，标题行的「新建来源草稿」入口保留」：`getTaskRecordDrafts` 返回空列表时按钮「新建来源草稿」仍可见、不渲染折叠按钮、`#record-draft-list` 为 null | 本地通过（2026-09-23） |
| RECORD-DRAFTS-HIDE-WEB-006 | Web 单元 | 读取失败不被隐藏吞掉 | 同文件「草稿读取失败时内容区仍然展开，保留错误与重试入口」：`listRecordDrafts` 以 `ApiError(500)` 拒绝时标题行与按钮「重试草稿列表」都在 | 本地通过（2026-09-23） |
| RECORD-DRAFTS-HIDE-GATE-001 | 静态门禁 | 类型、风格、文档与全量前端 | `pnpm --filter @inpulse/web test`（85 文件 579 例）、`pnpm --filter @inpulse/web exec vitest run src/features/record-drafts/RecordDraftsView.test.tsx`（20 例）、`pnpm --filter @inpulse/web exec tsc --noEmit`、`pnpm lint`、`pnpm format:check`、`pnpm check:docs` 通过 | 本地通过（2026-09-23） |

本地实际执行（2026-09-23 草稿箱整块隐藏）：`pnpm --filter @inpulse/web exec vitest run src/features/record-drafts/RecordDraftsView.test.tsx`（20 例通过，改前 19 例：删 3 条旧口径用例、补 4 条新用例）、`pnpm --filter @inpulse/web test`（85 文件 579 例通过，改前 578 例）、`pnpm --filter @inpulse/web exec tsc --noEmit`、`pnpm lint`、`pnpm format:check`、`pnpm check:docs` 通过；dev 5173 经 Vite 热更新已把改动送到运行中的服务（`GET /src/features/record-drafts/RecordDraftsView.tsx` 200 且含 `draft-box-toggle` 与 `showDraftBox`，`record-drafts.css` 200）。

未运行 / 已知偏差：① 未跑 API 单测、真实 PostgreSQL 集成、契约 / 权限 / Secret / 依赖审计门禁、整链 `pnpm typecheck` / `pnpm build` / `pnpm check`、`pnpm test:e2e`（Playwright：`record-feed.spec.ts` 的 `#record-draft-list` 与 `heading 我的草稿` 断言、`record-drafts.spec.ts` 的 `.draft-card` 断言都落在「已创建草稿」路径上，按本口径不受影响，但本轮未跑）与 GitHub Actions；② 折叠控件是标题行右侧的小方钮，不是整行可点，`CalmSectionTitle` 自带的 `collapsible` 整行折叠能力本轮没有复用；③ 折叠状态不持久化，换项目、进出来源任务语境或重进页面都回到默认展开（定案如此，若要记住需另加偏好）；④ 空态下「新建迭代记录」的入口仍在页面顶部 CTA，不在草稿箱里，因此草稿箱整块隐藏不会带走创建入口，但需人工在 `/records` 复核「无草稿时页面上确实没有任何草稿箱字样」；⑤ 本轮未做登录态页面的无头浏览器截屏（dev 环境为统一身份认证登录），交互观感需人工复核。

## 2026-09-23 九次定案：草稿卡片去掉「继续编辑 →」，整卡即入口（产品要求，2026-09-23 本地落库）

产品反馈（原文）：「这个按钮去掉，编辑就直接点击草稿卡片即可」（附图为 `/records` 草稿卡片右上角的「继续编辑 →」，被用户划掉）。口径：草稿卡片右上角的可见动作文案整条删除，右上角只留琥珀色「草稿」徽标；打开草稿继续走既有「整卡可点」——点击卡片仍是原来的 `openDraft`（写入 `recordId` 后打开草稿详情弹层），弹层里的「继续编辑」按钮与发布入口不变。动作名不丢：卡片按钮补 `aria-label`（`继续编辑草稿：<标题>`），因此读屏语义与既有的「按 `继续编辑` 找卡片」的单元 / E2E 选择器都保持成立；悬停描边、阴影与 `cursor: pointer` 不变。纯前端展示改动：不改契约、Route Registry、权限矩阵、数据库不变量、迁移、鉴权与幂等策略，后端零改动。

| 编号 | 类型 | 覆盖点 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| RECORD-DRAFTS-CARD-ENTRY-WEB-001 | Web 单元 | 卡片上不再有可见动作文案 | `RecordDraftsView.test.tsx`「lists project drafts as flat cards and opens one straight away」新增断言：卡片按钮 `not.toHaveTextContent("继续编辑")`，且 `toHaveAccessibleName("继续编辑草稿：支付修正")` | 本地通过（2026-09-23） |
| RECORD-DRAFTS-CARD-ENTRY-WEB-002 | Web 单元 | 整卡点击仍打开草稿详情 | 同用例保留的断言：`fireEvent.click(cards[0])` 后「草稿详情」弹层可见 | 本地通过（2026-09-23） |
| RECORD-DRAFTS-CARD-ENTRY-GATE-001 | 静态门禁 | 类型、风格、文档与全量前端 | `pnpm --filter @inpulse/web test`、`pnpm --filter @inpulse/web exec tsc --noEmit`、`pnpm lint`、`pnpm format:check`、`pnpm check:docs` 通过；`.draft-card-action` 规则已从 `record-drafts.css` 删除且全仓库无残留引用 | 本地通过（2026-09-23） |

本地实际执行（2026-09-23 草稿卡片整卡即入口）：`pnpm --filter @inpulse/web exec vitest run src/features/record-drafts/RecordDraftsView.test.tsx`（20 例通过，用例数不变——断言并入既有用例）、`pnpm --filter @inpulse/web test`、`pnpm --filter @inpulse/web exec tsc --noEmit`、`pnpm lint`、`pnpm format:check`、`pnpm check:docs` 通过；`rg "draft-card-action"` 全仓库无命中。

未运行 / 已知偏差：① 未跑 API 单测、真实 PostgreSQL 集成、契约 / 权限 / Secret / 依赖审计门禁、整链 `pnpm typecheck` / `pnpm build` / `pnpm check`、GitHub Actions；② `pnpm test:e2e`（Playwright）本轮未跑：`apps/e2e/tests/record-drafts.spec.ts` 里按 `继续编辑` 找卡片的计数断言与点击依赖卡片无障碍名称，本轮用 `aria-label` 保住了这条路径，但需要下一轮 E2E 复核；该文件里「卡片与弹层同名导致 strict-mode 命中 2 个元素」的问题是本轮之前就存在的失败，不在本次范围内；③ 卡片去掉可见文案后，可点性只靠 `cursor: pointer` 与悬停描边 / 阴影表达，若后续觉得不够明显，可再补一个弱的箭头或标题下划线（需另定案）；④ 登录态页面未做无头浏览器截屏，观感需人工在 `/records` 复核。

## 2026-09-23 十次定案：草稿详情弹层排版对齐正式记录详情（产品要求，2026-09-23 本地落库）

产品反馈（原文）：「这个界面有点丑稍微调整调整排版」（附图为 `/records?projectId=1&recordId=49` 的草稿详情弹层截图）。定案口径：草稿详情的排版向已发布记录详情（`.record-expanded` + `.record-facts`）对齐，不再自成一套——① 元信息从两行灰色斜杠句改成 `.record-facts` 网格块（浅底、标签列 + 值列）：`归属`（项目 / 模块 / 功能）与 `人员`（处理人 · 记录作者），没有关联功能时另起 `影响功能` 行；② 字段区与正式记录同节奏：分隔线 `#edf1f5`、`16px 0` 内距、标签 13px/600 `#314b65`、正文 13px `#60768b`、1.8 行高，首段紧接元信息块且不再画一条贴着浅底块的缝线；③ 「继续编辑 / 发布记录」从正文底部移到弹层 footer（`.surface-modal > .calm-action-footer`：浅底 `#f8fafc`、上分隔线、不随正文滚动），「草稿尚未发布，不计入正式迭代统计。」作为 footer 左侧说明；④ 修掉正文的「块间空行」——`.record-markdown` 原本整块 `white-space: pre-wrap`，Markdown 块与块之间自带的换行符被渲染成空行，改为容器 `normal` + 段落/列表项各自 `pre-wrap`；⑤ 补回列表符号——全局 reset 把 `ul/ol` 的 `list-style` 清成 none，正文列表此前退化成缩进段落，现按 Markdown 语义补回 `disc` / `circle` / `decimal` 与浅灰 marker。①~③ 只动草稿详情弹层；④⑤ 属全局 `.record-markdown` 口径，已发布记录详情、记录工作区与任务详情里的正文一起受益。纯前端展示改动：不改契约、Route Registry、权限矩阵、数据库不变量、迁移、鉴权与幂等策略，后端零改动。

| 编号 | 类型 | 覆盖点 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| RECORD-DRAFT-DETAIL-LAYOUT-WEB-001 | Web 单元 | 详情弹层语义与操作路径不变 | `RecordDraftsView.test.tsx` 20 例通过（本轮未改用例）：卡片 → 详情 → 「继续编辑」进编辑弹层、草稿冲突合并、遗留项补充、发布链路均照旧 | 本地通过（2026-09-23） |
| RECORD-DRAFT-DETAIL-LAYOUT-BROWSER-001 | 浏览器实测 | 真实登录态下的计算样式 | 无头 Chromium 1360 宽 / 设备像素比 2，用演示账号真实登录 5173 后打开 `/records?projectId=1&recordId=49`：facts 块 `display: grid`、列宽 `96px + 638px`、底色 `rgb(247, 250, 253)`；字段区 `padding 16px 0`、分隔线 `rgb(237, 241, 245)`；字段标签 `13px / 600 / rgb(49, 75, 101)`；正文 `13px / rgb(96, 118, 139)`、行高 `23.4px`；列表 `list-style-type: disc`、`padding-left: 22px`；footer `display: flex`、`justify-content: flex-end`、`padding 18px 28px 20px`、底色 `rgb(248, 250, 252)`；说明靠左侧居中（`align-self: center`，`margin-right` 解析为剩余空间 400px）；实拍图留档 | 本地通过（2026-09-23） |
| RECORD-DRAFT-DETAIL-LAYOUT-BROWSER-002 | 浏览器实测 | 块间空行与列表符号的前后对照 | 同一页面注入候选规则前后各测一次：列表项间距 `29.39px → 3px`、段落间距 `31.39px → 8px`，列表项自身高度不变（`23.39px`，说明消掉的只是多出来的一整行空行） | 本地通过（2026-09-23） |
| RECORD-DRAFT-DETAIL-LAYOUT-GATE-001 | 静态门禁 | 类型、风格、依赖边界与全量前端 | `pnpm --filter @inpulse/web test`（85 文件 579 例）、`pnpm --filter @inpulse/web exec tsc --noEmit`、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`（283 模块 1393 依赖无违规）通过 | 本地通过（2026-09-23） |

本地实际执行（2026-09-23 草稿详情排版）：`pnpm --filter @inpulse/web test`（85 文件 579 例）、`pnpm --filter @inpulse/web exec tsc --noEmit`（exit 0）、`pnpm lint`、`pnpm format:check`、`pnpm check:frontend:boundaries`；浏览器实测走 `apps/api/scripts/seed-demo-data.mjs` 统一的演示口令（默认值见该脚本，本记录不复述口令原文）在 5173 走 `/login?local=1` 真实登录，随后打开草稿详情弹层量取计算样式并留档实拍图。

未运行 / 已知偏差：① 未跑 API 单测、真实 PostgreSQL 集成、契约 / 权限 / Secret / 依赖审计门禁、整链 `pnpm typecheck` / `pnpm build` / `pnpm check`、`pnpm test:e2e`（Playwright）与 GitHub Actions；② ④⑤ 是全局 `.record-markdown` 口径，已发布记录详情与记录工作区里的正文一起变化，本轮只实测了草稿详情这一屏，其余屏需人工抽查；③ 草稿详情把 facts 块放在正文之前，而已发布记录详情放在正文之后（草稿要先看清归属再读正文），是有意保留的差异，若要完全一致需另定案；④ 弹层标题里的「（草稿）」与眉标「草稿」仍重复，来自业务数据本身，本轮未改；⑤ 视觉调整属主观项，需非作者人工评审。

## 分段控件切换滑块动画（用户指示，2026-09-23 本地落库）

需求（原文）：「我现在想改未完成和已完成还有卡片列表滑块的切换动画……只需要参考动画就行，样式不要改」，随后追加「任务看板那边也记得改」；参考实现是 Uiverse 的 radio-input（轨道 `position: relative`、绝对定位滑块、`transform: translateX` 位移 + 0.15s ease）。本批为纯前端展示改动：不改契约、Route Registry、权限矩阵、数据库不变量、迁移、鉴权与幂等策略，后端零改动。

实现：选中底色与投影从 `.segmented button.selected` 迁到滑块 `.segmented-thumb`，取值与原规则完全一致（`background: white`、`box-shadow: 0 1px 3px #203c5515`，按钮与滑块同为 4px 圆角），按钮只保留 `color` 变化；`useCalmSegmentedThumb` 以 `button[aria-pressed=true]` 反查选中按钮并按其 `getBoundingClientRect()` 相对轨道实测矩形，写滑块的 `transform` 与 `width`，CSS 只负责 `transform 0.15s ease, width 0.15s ease`；测量在 layout effect 中每次渲染后执行（值未变时回传同一对象，避免测量自转），`ResizeObserver` 观察轨道与各按钮以兜住窗口缩放、字体加载与弹窗由隐藏转显示；滑块只在首次测量完成后挂载，因此首帧不会从左侧滑入。任务看板工具栏（手写 `.segmented`）复用同一 hook 与滑块组件。

| 编号 | 类型 | 覆盖点 | 通过标准 | 状态 |
| --- | --- | --- | --- | --- |
| SEGMENT-SLIDE-BROWSER-001 | 浏览器实测 | 任务中心滑块与选中按钮完全重合 | 临时 E2E：`/tasks?status=open` 打开态滑块 box 与选中按钮一致（x=283、w=86.63、h=29），`transition` 为 `transform 0.15s, width 0.15s` | 本地通过（2026-09-23，用例已删） |
| SEGMENT-SLIDE-BROWSER-002 | 浏览器实测 | 切换过程确有位移过渡 | 同上：点「已完成」后逐帧采样得到 283 → 293 → 358.54 → 371.63 的中间值（不是瞬移） | 本地通过（2026-09-23） |
| SEGMENT-SLIDE-BROWSER-003 | 浏览器实测 | 任务看板视图切换同样生效 | 临时 E2E：`/projects/{id}/task-board` 滑块 box 与「看板」按钮一致（x=286、w=65、h=28），切「列表」采样 286 → 293.68 → 343.97 → 354 | 本地通过（2026-09-23） |
| SEGMENT-SLIDE-WEB-001 | Web 单元 | 既有分段控件断言不受影响 | `pnpm --filter @inpulse/web test` 85 文件 578 例通过（含 `TaskCenterPageView.test.tsx` 58 例与 `src/features/task-board` 4 文件 38 例） | 本地通过（2026-09-23） |
| SEGMENT-SLIDE-GATE-001 | 静态门禁 | 类型、风格与格式 | `pnpm exec eslint`（`Calm.tsx`、`TaskBoardToolbar.tsx`）通过；`pnpm exec prettier --check` 通过；`pnpm --filter @inpulse/web typecheck` 仅剩并行 audit 改动的 1 个错误 | 本地通过（typecheck 见偏差说明） |

本地实际执行（2026-09-23 滑块动画）：`pnpm --filter @inpulse/web test`（85 文件 578 例；首次整套并发运行出现过 2 例超时，单独复跑与随后整套复跑均通过，属既有负载敏感间歇失败）、`pnpm --filter @inpulse/web exec vitest run src/features/my-tasks/TaskCenterPageView.test.tsx`（58 例）、`pnpm --filter @inpulse/web exec vitest run src/features/task-board`（4 文件 38 例）、`pnpm exec eslint`（2 个改动文件）、`pnpm exec prettier --write` 与 `--check`、`pnpm --filter @inpulse/web typecheck`、真实浏览器临时用例（任务中心与任务看板三处滑块，截图留档）。

未运行 / 已知偏差：① 未跑整链 `pnpm check`、全量 `pnpm test:e2e`、`pnpm deps:audit` 与 GitHub Actions；② `pnpm --filter @inpulse/web typecheck` 仍有 1 个并行 audit 改动的错误（`AuditLogPageView.test.tsx(107,5) TS2783: getUserDirectory is specified more than once`），与本批无关；③ `apps/e2e/tests/task-board.spec.ts` 的 R-8 在本机 180s 超时：用 `git stash` 只还原本批 3 个文件后同一用例同样超时（均卡在新建任务弹窗选完「所属模块」后负责人未选中、弹窗不关闭），确认为既有失败，本批未修；④ 本机 E2E 的 API 与 Web 由 Playwright 自建构建（端口 3100 / 4173），不使用手动启动的实例。
