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
| `confirmMfaEnrollment` | 401 | 403 | 仅存在 pending enrollment 时允许 | 409 | 401 | 携带 expected 用户级 generation；按相同锁序验证对应 Secret 与未使用的当前 TOTP time-step，启用 MFA、签发恢复码，并原子轮换为完整 Session 与新 CSRF；错误验证码按用户/IP/全局三层限流，达到阈值返回 429 |
| `verifyMfa` | 401 | 403 | 仅 `MFA_CHALLENGE` 状态允许 | 409 | 401 | 密码阶段已成功；仅接受当前 TOTP time-step ±1 且未使用过的验证码，按 user → factor → Session 锁序，在同一事务升级为完整 Session、刷新 `last_accepted_step` 并签发新 CSRF；错误验证码按用户/IP/全局三层持久化限流，达到阈值返回 429 |
| `reauthenticateAdmin` | 401 | 403 | 403 | 允许 | 401 | 完整管理员 Session + 密码 + 未使用的当前 TOTP time-step；以同一服务端事务时间原子更新 `reauthenticated_at` 与 `mfa_verified_at` |
| `rotateMfaRecoveryCodes` | 401 | 403 | 403 | 允许 | 401 | 5 分钟内完成双因子重认证并消费该次重认证签发的一次性 rotation generation；同一 generation 至多一个 2xx，原子失效旧 Hash 后只展示一次新码 |
| `consumeMfaRecoveryCode` | 401 | 403 | 仅 `RECOVERY_CHALLENGE` 状态允许 | 409 | 401 | 密码阶段已成功；原子消费恢复码 Hash、失效旧代码集并轮换为完整 Session |

管理员 MFA 重置、用户修改及其他不签发或消费一次性安全材料的写操作不在本表，仍按普通业务命令使用 `idempotencyRequired`。

## 业务操作矩阵

F-12 本地接口已登记到可执行权限矩阵，真实 HTTP/数据库验收仍待运行，见 [交审说明](f12-local-handoff.md)：

| operationId | 允许主体 | 拒绝与附加门禁 |
| --- | --- | --- |
| listModules | 当前活跃项目成员、系统管理员 | 匿名/无效 Session 401，其他项目/已移除成员 404；归档仍可读 |
| createModule | 当前活跃项目成员、系统管理员 | 同上；父项目必须 ACTIVE，Session/CSRF 与幂等必需，只能创建 NORMAL |
| updateModule | 当前活跃项目成员、系统管理员 | 同上；真实模块归属与父项目/模块 ACTIVE，If-Match；允许编辑未分类名称/描述 |
| archiveModule | 完整认证且双时间戳重认证新鲜的系统管理员 | 自己项目的普通成员 403，其他项目/已移除成员 404；原因、If-Match、父 ACTIVE 和模块 ACTIVE |
| restoreModule | 完整认证且双时间戳重认证新鲜的系统管理员 | 同上；父 ACTIVE 和模块 ARCHIVED；不恢复下级状态 |

全部写接口重放前重查当前 Session/CSRF、原操作权限和结果模块可读权限；归档/恢复重查重认证。父级已归档则拒绝写入或重放为 409；这些状态门禁不作用于普通 GET。

| 操作 | 匿名 | 活跃成员 | 其他项目成员 | 已移除成员 | 停用用户 | 系统管理员 | 额外条件 |
|---|---:|---:|---:|---:|---:|---:|---|
| 读取当前用户 | 401 | 允许 | 允许 | 允许 | 401 | 允许 | 服务端从 `__Host-session` 解析身份，不接受客户端传入用户 ID；响应 `no-store` |
| 读取用户目录（`getUserDirectory` · `GET /api/v1/users`） | 401 | 允许 | 允许 | 允许 | 401 | 允许 | 服务端从 Session 解析身份；只返回 `id`、`name`、`avatarUrl`、`isAdmin`，不返回登录名、邮箱、密码哈希或停用状态；只返回 ACTIVE 且 `disabled_at IS NULL` 的用户，最多 300 条；响应 `no-store` |
| 创建项目（`createProject` · `POST /api/v1/projects`） | 401 | 允许 | 允许 | 允许 | 401 | 允许 | 请求者自动成为活跃成员且创建时不可取消；请求头需同步 CSRF，正文 `memberIds` 为可选初始成员且不含创建者，服务端在单事务内校验全员 ACTIVE 并写审计、搜索/活动投影与通知；要求 `Idempotency-Key`，重放前需重新验证当前认证与项目可读权限；成功返回 200；`code` 显式提供时须符合 `^[A-Z][A-Z0-9_]{1,31}$`，未提供时由服务端从名称派生 |
| 读取项目及下级资源 | 401 | 允许 | 404 | 404 | 401 | 允许 | 资源型接口隐藏存在性；归档数据仍可读；VOID 记录按下一行 |
| 读取 VOID 迭代记录详情 | 401 | 404 | 404 | 404 | 401 | 允许 | `status` 是可见性真相；恢复为 PUBLISHED 后活跃成员重新可读 |
| 新建或编辑模块、功能、任务、记录、链接 | 401 | 允许 | 404 | 404 | 401 | 允许 | 项目及父级 ACTIVE；写接口默认幂等；未分类模块允许编辑名称、描述，kind 不变，不能物理删除（2026-09-09 人工确认；F-12 已本地实现，真库验收待运行） |
| 任务完成、重新打开、取消、恢复、合并、解除，遗留转任务 | 401 | 允许 | 404 | 404 | 401 | 允许 | 状态机、If-Match 与幂等约束 |
| 搜索（`getSearch` · `GET /api/v1/search`） | 401 | 仅本人活跃项目 | 不返回本项目（可搜索其他活跃成员项目） | 不返回本项目（可搜索其他活跃成员项目） | 401 | 按服务端 Scope | SQL 前强制 AuthorizedProjectScope；`q` 最短 2、最长 200，`limit` 1～50、默认 20，`q`/`limit`/`cursor` 字段校验失败统一返回 422；`cursor` 为服务端 HMAC 签名、校验并带过期时间的不透明字符串，绑定当前用户与规范化查询，TTL 15 分钟，A 已于 2026-09-08 正式确认；VOID 默认不返回，仅系统管理员显式传 `includeVoid=true` 时可见，普通成员传该参数也不会扩大范围；`app_runtime` 只允许 `app` schema USAGE、业务事务内对 `search_projection` 执行 `SELECT/INSERT/UPDATE`、查询 `search_projection` 及执行 `pgroonga_query_escape`/`&@~` 所需函数，不允许 `DELETE`、DDL 或管理函数 |
| 查看项目动态（`getProjectActivity` · `GET /api/v1/projects/{projectId}/activity`） | 401 | 允许 | 404 | 404 | 401 | 允许（默认 MEMBER；显式 `includeAdminOnly=true` 时可见 ADMIN_ONLY） | SQL 前强制服务端 `AuthorizedProjectScope`，不接受客户端传入授权范围；`projectId`、`limit`、`cursor` 校验失败统一 422；`cursor` 为服务端 HMAC 签名、绑定当前用户与项目、带过期时间的不透明字符串；普通成员传 `includeAdminOnly=true` 不扩大范围；响应只暴露脱敏白名单字段 |
| 通知列表、未读数、单条已读/未读、全部已读（`getNotifications`、`getNotificationUnreadCount`、`readNotification`、`unreadNotification`、`readAllNotifications`） | 401 | 仅本人 | 仅本人 | 仅本人 | 401 | 仅本人 | 服务端始终从 Session 解析收件人，不接受客户端传入 `recipientId`；查询按 `recipient_id = 当前用户` 过滤；单条不存在或非本人统一 404，管理员也不得代读其他用户；三个 POST 均要求 CSRF 与 `Idempotency-Key`，重复执行可安全重放 |
| 成员管理 | 401 | 403 | 404 | 404 | 401 | 允许 | 密码与当前 TOTP 重认证；写审计 |
| 项目、模块或功能归档/恢复 | 401 | 403 | 404 | 404 | 401 | 允许 | 密码与当前 TOTP 重认证；写审计 |
| 移除普通成员或项目创建者 | 401 | 403 | 404 | 404 | 401 | 允许 | 密码与当前 TOTP 重认证；只修改成员历史；`created_by` 不变；系统管理员仍保留全局权限；写审计 |
| 原始审计查询或导出 | 401 | 403 | 403 | 403 | 401 | 允许 | 重认证；使用 audit_reader；读取本身写审计 |
| 作废 PUBLISHED / 恢复 VOID 迭代记录 | 401 | 403 | 403 | 403 | 401 | 允许 | 重认证并填写原因；写审计 |
| 重置另一名系统管理员 MFA（`resetAdminMfa` · `POST /api/v1/auth/admin/mfa-reset`） | 401 | 403 | 403 | 403 | 401 | 允许 | 仅完整系统管理员 Session 且 5 分钟内完成密码 + 当前 TOTP 双因子重认证；目标必须是另一名 `ACTIVE` 且已启用 TOTP 的系统管理员，且可用 MFA 管理员数大于 1；同一事务禁用目标因子、失效未使用恢复码、递增 `auth_version`、撤销目标全部 Session 并写审计；CSRF 与幂等键必填；成功 204，目标不存在 404，非管理员/目标未启用 403，自重置、最后一名 MFA 管理员或状态冲突 409，字段/请求头无效 422 |
| `listAdminUsers` · `GET /api/v1/admin/users` | 401 | 403 | 403 | 403 | 401 | 允许 | 完整系统管理员 Session；读取全部账号的登录名、姓名、邮箱、头像、管理员角色、状态、版本与时间，不返回密码、TOTP、恢复码等认证材料；最多 1000 条；响应 `no-store`；不需要 CSRF 或幂等键 |
| `createUser` · `POST /api/v1/admin/users` | 401 | 403 | 403 | 403 | 401 | 允许 | 完整管理员 Session 且密码/当前 TOTP 双因子重认证均在 5 分钟内；CSRF 与 `Idempotency-Key` 必填；Argon2id 哈希在事务外生成、业务与审计同事务写入；登录名/邮箱唯一冲突 409；响应不返回密码或认证材料 |
| `updateUser` · `PATCH /api/v1/admin/users/{userId}` | 401 | 403 | 403 | 403 | 401 | 允许 | 完整管理员 Session + 5 分钟双因子重认证；CSRF、`Idempotency-Key` 与 `If-Match` 必填；登录名不可修改，字段缺省保持不变，`email/avatarUrl` 为 null 表示清空；版本/状态冲突 409；禁止取消自己的管理员角色；移除 ACTIVE 管理员前按 id 升序锁定全部活跃 MFA 管理员，剩余可用 MFA 管理员数必须大于 1，否则 409；审计 `admin.user.update` |
| `disableUser` · `POST /api/v1/admin/users/{userId}/disable` | 401 | 403 | 403 | 403 | 401 | 允许 | 完整管理员 Session + 5 分钟双因子重认证；CSRF、`Idempotency-Key` 与 `If-Match` 必填；目标不存在 404、已停用或版本冲突 409；禁止停用自己；停用 ACTIVE 管理员时执行最后一名可用 MFA 管理员保护；同事务置 `DISABLED`/`disabled_at`、递增 `auth_version` 与 `row_version`、撤销全部 Session 并写审计；停用后目标所有受保护请求 401 |
| `enableUser` · `POST /api/v1/admin/users/{userId}/enable` | 401 | 403 | 403 | 403 | 401 | 允许 | 完整管理员 Session + 5 分钟双因子重认证；CSRF、`Idempotency-Key` 与 `If-Match` 必填；目标不存在 404、已启用或版本冲突 409；同事务清除停用态并递增 `row_version`、写审计；不恢复已撤销 Session 或登录限流历史 |
| `forceLogoutUser` · `POST /api/v1/admin/users/{userId}/force-logout` | 401 | 403 | 403 | 403 | 401 | 允许 | 完整管理员 Session + 5 分钟双因子重认证；CSRF、`Idempotency-Key` 与 `If-Match` 必填；目标不存在 404、版本冲突 409；禁止强制退出自己；同事务递增 `auth_version` 与 `row_version`、撤销目标全部 Session 并写审计；账号保持 ACTIVE |

## F-13 功能档案接口（2026-09-09 本地实现）

| operationId | 允许身份 | 拒绝与附加门禁 |
|---|---|---|
| listFeatures | 活跃项目成员、系统管理员 | 匿名/停用 401；非成员、已移除、模块归属错误 404；含归档历史 |
| getFeature | 活跃项目成员、系统管理员 | 同上，项目/模块/功能完整归属不符 404 |
| findSimilarFeatures | 活跃项目成员、系统管理员 | 同上；SQL 在 LIMIT 前限制当前项目 FEATURE + MEMBER 投影；提示不阻止同名创建 |
| createFeature | 活跃项目成员、系统管理员 | 父项目/模块必须 ACTIVE；Session、CSRF、同源和幂等 Key；只接受 name/currentBehavior/tags |
| updateFeature | 活跃项目成员、系统管理员 | 同上且功能 ACTIVE，If-Match；说明前后审计，不生成迭代记录 |
| archiveFeature | 完整认证且五分钟双因子重认证新鲜的系统管理员 | 普通成员 403；非成员 404；父级 ACTIVE、功能 ACTIVE、原因和 If-Match |
| restoreFeature | 完整认证且五分钟双因子重认证新鲜的系统管理员 | 同上；功能 ARCHIVED；只恢复自身，不改下级状态 |

四条写接口重放前重查 Session/CSRF、当前项目授权、完整结果归属及必要重认证；父项目/模块归档拒绝重放。重复状态操作可重放原成功结果，不重复执行状态迁移。所有拒绝返回统一错误体，不泄露已存响应。真实测试入口见 [F-13 交审说明](f13-local-handoff.md)。

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
