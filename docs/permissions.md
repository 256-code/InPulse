# 权限矩阵

状态：已接受的设计基线；应用骨架建立后必须由 `apps/api/test/permissions.matrix.ts` 镜像为可执行测试数据。Route Registry 的每个操作至少匹配一条允许和一条拒绝用例，CI 禁止未覆盖路由。

## 身份定义

| 身份 | 定义 |
|---|---|
| 匿名 | 没有有效 Session |
| 活跃成员 | 在目标项目存在 ACTIVE 成员记录 |
| 其他项目成员 | 有有效 Session，但不是目标项目活跃成员 |
| 已移除成员 | 目标项目最近成员记录为 REMOVED |
| 停用用户 | 用户被停用；其全部 Session 按无效处理，不能恢复身份；仅可按匿名安全语义签发预认证 CSRF 或清 Cookie 登出 |
| 系统管理员 | 全局管理员；高风险操作仍需密码与当前 TOTP 重认证 |

项目创建者不是独立身份。创建时必须作为初始成员且表单不可取消；创建完成后可由系统管理员按普通成员规则移除。`projects.created_by` 永久保留用于溯源，不授予权限。普通成员创建者被移除后失去成员关系派生权限；系统管理员创建者仍保留与成员记录无关的全局权限。详见 [ADR-012](adr/ADR-012.md)。

## 认证安全流程矩阵

下表的 operationId 集合必须与 [ADR-023](adr/ADR-023.md) allowlist 精确相等，并逐项镜像到 Route Registry 和可执行权限测试。“管理员受限/预认证 Session”只允许访问其当前 challenge 明确授权的认证端点，不能访问业务接口；“管理员完整 Session”表示已完成 MFA。即使某一身份列为允许，Origin、Fetch Metadata、CSRF、速率限制及指定前置状态仍可产生拒绝用例，确保每个 operationId 至少有一条允许和一条拒绝测试。

| operationId | 匿名/预认证 Session | 已认证普通用户 | 管理员受限 Session | 管理员完整 Session | 停用目标用户 | 前置状态与结果 |
|---|---:|---:|---:|---:|---:|---|
| `issueCsrfToken` | 允许 | 允许 | 允许 | 允许 | 允许（按匿名） | Fetch Metadata、同源可读与限流通过；GET 的 Origin/Referer 若存在则精确校验，缺失不单独拒绝；按当前有效 Session 类型签发 Token；停用/无效 Session 先清认证 Cookie，再创建匿名预认证状态，不恢复身份 |
| `login` | 仅有效 `PREAUTH` + CSRF 允许 | 409 | 409 | 409 | 401 | 只消费匿名预认证 Session 与其 CSRF；已有认证或受限 Session 必须先登出/清 Cookie，再签发新预认证 CSRF；管理员成功后进入对应 MFA challenge 或完整 Session |
| `logout` | 204 | 204 | 204 | 204 | 204 | 有效 Session 时要求其 CSRF 并条件撤销；Session 无效、已撤销或首次响应丢失后的重试仅在同源 Origin/Referer 与 Fetch Metadata 通过时清 Cookie 并返回 204，不执行状态写 |
| `startMfaEnrollment` | 401 | 403 | 仅 `MFA_ENROLLMENT` 状态允许 | 409 | 401 | 仅尚未启用 MFA 且已通过密码的管理员；按 user → factor → Session 锁序条件递增用户级 generation 并创建新 pending，同一旧 generation 至多一个 2xx |
| `confirmMfaEnrollment` | 401 | 403 | 仅存在 pending enrollment 时允许 | 409 | 401 | 携带 expected 用户级 generation；按相同锁序验证对应 Secret 与未使用的当前 TOTP time-step，启用 MFA、签发恢复码，并原子轮换为完整 Session 与新 CSRF |
| `verifyMfa` | 401 | 403 | 仅 `MFA_CHALLENGE` 状态允许 | 409 | 401 | 密码阶段已成功；条件接受未使用的 TOTP time-step，轮换为完整 Session |
| `reauthenticateAdmin` | 401 | 403 | 403 | 允许 | 401 | 完整管理员 Session + 密码 + 未使用的当前 TOTP time-step；以同一服务端事务时间原子更新 `reauthenticated_at` 与 `mfa_verified_at` |
| `rotateMfaRecoveryCodes` | 401 | 403 | 403 | 允许 | 401 | 5 分钟内完成双因子重认证并消费该次重认证签发的一次性 rotation generation；同一 generation 至多一个 2xx，原子失效旧 Hash 后只展示一次新码 |
| `consumeMfaRecoveryCode` | 401 | 403 | 仅 `RECOVERY_CHALLENGE` 状态允许 | 409 | 401 | 密码阶段已成功；原子消费恢复码 Hash、失效旧代码集并轮换为完整 Session |

管理员 MFA 重置、用户修改及其他不签发或消费一次性安全材料的写操作不在本表，仍按普通业务命令使用 `idempotencyRequired`。

## 业务操作矩阵

| 操作 | 匿名 | 活跃成员 | 其他项目成员 | 已移除成员 | 停用用户 | 系统管理员 | 额外条件 |
|---|---:|---:|---:|---:|---:|---:|---|
| 读取当前用户 | 401 | 允许 | 允许 | 允许 | 401 | 允许 | 服务端从 `__Host-session` 解析身份，不接受客户端传入用户 ID；响应 `no-store` |
| 创建项目（`createProject` · `POST /api/v1/projects`） | 401 | 允许 | 允许 | 允许 | 401 | 允许 | 请求者自动成为活跃成员且创建时不可取消；请求头需同步 CSRF，正文 `memberIds` 为可选初始成员且不含创建者，服务端在单事务内校验全员 ACTIVE 并写审计、搜索/活动投影与通知；要求 `Idempotency-Key`，重放前需重新验证当前认证与项目可读权限；成功返回 200；`code` 显式提供时须符合 `^[A-Z][A-Z0-9_]{1,31}$`，未提供时由服务端从名称派生 |
| 读取项目及下级资源 | 401 | 允许 | 404 | 404 | 401 | 允许 | 资源型接口隐藏存在性；归档数据仍可读；VOID 记录按下一行 |
| 读取 VOID 迭代记录详情 | 401 | 404 | 404 | 404 | 401 | 允许 | `status` 是可见性真相；恢复为 PUBLISHED 后活跃成员重新可读 |
| 新建或编辑模块、功能、任务、记录、链接 | 401 | 允许 | 404 | 404 | 401 | 允许 | 项目及父级 ACTIVE；写接口默认幂等 |
| 任务完成、重新打开、取消、恢复、合并、解除，遗留转任务 | 401 | 允许 | 404 | 404 | 401 | 允许 | 状态机、If-Match 与幂等约束 |
| 搜索（`getSearch` · `GET /api/v1/search`） | 401 | 仅本人活跃项目 | 不返回本项目（可搜索其他活跃成员项目） | 不返回本项目（可搜索其他活跃成员项目） | 401 | 按服务端 Scope | SQL 前强制 AuthorizedProjectScope；`q` 最短 2、最长 200，`limit` 1～50、默认 20，`q`/`limit`/`cursor` 字段校验失败统一返回 422；`cursor` 为服务端 HMAC 签名、校验并带过期时间的不透明字符串，绑定当前用户与规范化查询，TTL 15 分钟，A 已于 2026-09-08 正式确认；VOID 默认不返回，仅系统管理员显式传 `includeVoid=true` 时可见，普通成员传该参数也不会扩大范围；`app_runtime` 只允许 `app` schema USAGE、业务事务内对 `search_projection` 执行 `SELECT/INSERT/UPDATE`、查询 `search_projection` 及执行 `pgroonga_query_escape`/`&@~` 所需函数，不允许 `DELETE`、DDL 或管理函数 |
| 查看项目动态（`getProjectActivity` · `GET /api/v1/projects/{projectId}/activity`） | 401 | 允许 | 404 | 404 | 401 | 允许（默认 MEMBER；显式 `includeAdminOnly=true` 时可见 ADMIN_ONLY） | SQL 前强制服务端 `AuthorizedProjectScope`，不接受客户端传入授权范围；`projectId`、`limit`、`cursor` 校验失败统一 422；`cursor` 为服务端 HMAC 签名、绑定当前用户与项目、带过期时间的不透明字符串；普通成员传 `includeAdminOnly=true` 不扩大范围；响应只暴露脱敏白名单字段 |
| 通知列表、未读数、单条已读/未读、全部已读（`getNotifications`、`getNotificationUnreadCount`、`readNotification`、`unreadNotification`、`readAllNotifications`） | 401 | 仅本人 | 仅本人 | 仅本人 | 401 | 仅本人 | 服务端始终从 Session 解析收件人，不接受客户端传入 `recipientId`；查询按 `recipient_id = 当前用户` 过滤；单条不存在或非本人统一 404，管理员也不得代读其他用户；三个 POST 均要求 CSRF 与 `Idempotency-Key`，重复执行可安全重放 |
| 成员管理 | 401 | 403 | 404 | 404 | 401 | 允许 | 密码与当前 TOTP 重认证；写审计 |
| 项目、模块或功能归档/恢复 | 401 | 403 | 404 | 404 | 401 | 允许 | 密码与当前 TOTP 重认证；写审计 |
| 移除普通成员或项目创建者 | 401 | 403 | 404 | 404 | 401 | 允许 | 密码与当前 TOTP 重认证；只修改成员历史；`created_by` 不变；系统管理员仍保留全局权限；写审计 |
| 原始审计查询或导出 | 401 | 403 | 403 | 403 | 401 | 允许 | 重认证；使用 audit_reader；读取本身写审计 |
| 作废 PUBLISHED / 恢复 VOID 迭代记录 | 401 | 403 | 403 | 403 | 401 | 允许 | 重认证并填写原因；写审计 |
| 用户启停、强退、管理员管理 | 401 | 不适用 | 不适用 | 不适用 | 401 | 允许 | 重认证；不能留下无 MFA 管理员的失控状态 |

## 强制规则

1. 成员关系在每次请求中实时读取，不缓存到 Session 或长生命周期对象。
2. 资源型接口对“不存在”和“无项目权限”统一返回 404；明确的全局管理接口返回 403。
3. 停用用户的 Session 统一视为无效：所有受保护或业务路由返回 401，使用停用凭据登录也返回 401。仅 `issueCsrfToken` 与无效/已撤销 Session 的 `logout` 按匿名安全例外执行，前者只能创建无身份的预认证状态，后者只清 Cookie 且不写业务状态。
4. Controller 不接受客户端传入的授权 Scope；Scope 由 `ProjectAccessQueryPort` 在服务端计算并进入 SQL 谓词。
5. 所有非安全写方法的幂等默认值遵循 [ADR-019](adr/ADR-019.md)。
6. `securityFlow` 的 operationId、身份、challenge 前置状态与恢复路径必须同时符合本矩阵和 [ADR-023](adr/ADR-023.md)，不得通过改名或泛化“登录”绕过逐操作覆盖；`login` 只接受匿名预认证状态，不支持认证 Session 内重新登录。
7. 迭代记录的详情、统计、搜索和时间线必须以 `status` 判定可见性，不得以保留的 `voided_at` 推断当前状态。
8. 更改本矩阵需要同步 Route Registry、测试矩阵、相关设计与 ADR。
9. `app_runtime` 搜索数据库权限按最小集显式授予，不得依赖 PUBLIC；业务事务内仅允许维护 `search_projection` 的 `INSERT/UPDATE`（无 `DELETE`/DDL），普通查询只允许 `normalized_search_text &@~ app.pgroonga_query_escape($1)`。
