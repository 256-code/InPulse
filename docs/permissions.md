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
| 项目列表（`listProjects` · `GET /api/v1/projects`）与项目详情（`getProject` · `GET /api/v1/projects/{projectId}`） | 401 | 列表返回本人全部活跃项目，详情按资源允许 | 列表只返回本人活跃项目，详情 404 | 列表只返回本人其他活跃项目，已移除项目不返回，详情 404 | 401 | 列表与详情均返回全部项目（含归档） | 服务端从 Session 解析 actor 并先取得 `AuthorizedProjectScope`，SQL 前限制项目范围，不接受客户端传入范围；无权限与不存在统一 404；归档历史仍可读；响应 `no-store`；`projectId` 非法时 422 |
| 编辑项目（`updateProject` · `PATCH /api/v1/projects/{projectId}`） | 401 | 允许 | 404 | 404 | 401 | 允许 | 项目编码创建后不可修改，只允许整笔替换 `name` 与 `description`；父项目必须 ACTIVE，归档项目 409 `PROJECT_ARCHIVED`；CSRF 与 `Idempotency-Key` 必填、`If-Match` 乐观锁（版本冲突 409）；名称/描述、审计 `project.update`、活动与搜索投影同一事务；重放前重新验证当前成员关系与项目可写性 |
| 归档前影响预览（`getProjectArchivePreview` · `GET /api/v1/projects/{projectId}/archive-preview`） | 401 | 403 | 404 | 404 | 401 | 允许（完整管理员 Session 且密码与当前 TOTP 重认证均在 5 分钟内；只读，不要求 CSRF 或幂等键） | 只统计当前未完成（`work_status = 'TODO'` 且 `lifecycle_status = 'ACTIVE'`）任务数，用于归档前提醒；归档项目仍可查看；无审计与投影写入 |
| 归档项目（`archiveProject` · `POST /api/v1/projects/{projectId}/archive`）与恢复项目（`restoreProject` · `POST /api/v1/projects/{projectId}/restore`） | 401 | 403 | 404 | 404 | 401 | 允许（完整管理员 Session 且密码与当前 TOTP 重认证均在 5 分钟内） | 归档原因、CSRF、`Idempotency-Key` 与 `If-Match` 必填；归档要求项目 ACTIVE、恢复要求项目 ARCHIVED，状态不符 409 `PROJECT_STATE_CONFLICT`；归档后项目及全部下级只读而历史仍可读，恢复只恢复项目自身状态；审计 `project.archive`/`project.restore`、活动与搜索投影在同一事务；重放前重新验证管理员重认证新鲜度与项目可读权限 |
| 读取项目及下级资源 | 401 | 允许 | 404 | 404 | 401 | 允许 | 资源型接口隐藏存在性；归档数据仍可读；VOID 记录按下一行 |
| 读取 VOID 迭代记录详情 | 401 | 404 | 404 | 404 | 401 | 允许 | `status` 是可见性真相；恢复为 PUBLISHED 后活跃成员重新可读 |
| 新建或编辑模块、功能、任务、记录、链接 | 401 | 允许 | 404 | 404 | 401 | 允许 | 项目及父级 ACTIVE；写接口默认幂等；未分类模块允许编辑名称、描述，kind 不变，不能物理删除（2026-09-09 人工确认；F-12 已本地实现，真库验收待运行） |
| 任务完成、重新打开、取消、恢复、合并、解除，遗留转任务 | 401 | 允许 | 404 | 404 | 401 | 允许 | 状态机、If-Match 与幂等约束 |
| 搜索（`getSearch` · `GET /api/v1/search`） | 401 | 仅本人活跃项目 | 不返回本项目（可搜索其他活跃成员项目） | 不返回本项目（可搜索其他活跃成员项目） | 401 | 按服务端 Scope | SQL 前强制 AuthorizedProjectScope；`q` 最短 2、最长 200，`limit` 1～50、默认 20，`q`/`limit`/`cursor` 字段校验失败统一返回 422；`cursor` 为服务端 HMAC 签名、校验并带过期时间的不透明字符串，绑定当前用户与规范化查询，TTL 15 分钟，A 已于 2026-09-08 正式确认；VOID 默认不返回，仅系统管理员显式传 `includeVoid=true` 时可见，普通成员传该参数也不会扩大范围；`app_runtime` 只允许 `app` schema USAGE、业务事务内对 `search_projection` 执行 `SELECT/INSERT/UPDATE`、查询 `search_projection` 及执行 `pgroonga_query_escape`/`&@~` 所需函数，不允许 `DELETE`、DDL 或管理函数；`LEFTOVER`（遗留问题）投影由父记录发布/修订/作废/恢复与遗留项转任务在同一事务维护，其可见性与状态跟随父记录与遗留项，不单独放宽授权 |
| 查看项目动态（`getProjectActivity` · `GET /api/v1/projects/{projectId}/activity`） | 401 | 允许 | 404 | 404 | 401 | 允许（默认 MEMBER；显式 `includeAdminOnly=true` 时可见 ADMIN_ONLY） | SQL 前强制服务端 `AuthorizedProjectScope`，不接受客户端传入授权范围；`projectId`、`limit`、`cursor` 校验失败统一 422；`cursor` 为服务端 HMAC 签名、绑定当前用户与项目、带过期时间的不透明字符串；普通成员传 `includeAdminOnly=true` 不扩大范围；响应只暴露脱敏白名单字段 |
| 任务聚合组视图（`getTaskGroup` · `GET /api/v1/task-groups/{groupId}`） | 401 | 允许 | 404 | 404 | 401 | 允许 | 先按 `groupId` 反查项目归属，再按实时成员关系授权；非成员与不存在统一 404；返回组与全部成员（含已解除成员）及每任务 PUBLISHED 记录数，不返回审计快照；记录列表见下一行 |
| 任务聚合组记录（`listTaskGroupRecords` · `GET /api/v1/task-groups/{groupId}/records`） | 401 | 允许 | 404 | 404 | 401 | 允许 | 只返回 PUBLISHED 与 VOID（DRAFT 不可见）；`memberTaskId`/`limit`/`cursor` 校验失败统一 422；游标为服务端 HMAC 签名、绑定当前用户、聚合组与筛选，TTL 15 分钟；链接标题与状态为关联时刻快照，不得用于实时状态判断 |
| 项目概览（`getProjectOverview` · `GET /api/v1/projects/{projectId}/overview`） | 401 | 允许 | 404 | 404 | 401 | 允许 | 服务端聚合活跃模块、活跃功能、未完成任务、迭代记录数、最近迭代与待处理遗留问题；统计口径按功能设计 §29（历史来源分支不计入未完成、模块级记录不按影响功能去重、版本不增加记录数）；`recentRecordLimit`/`activeLeftoverLimit` 默认 3/2、上限 10，越界 422；`activeLeftoverTotal` 与 `activeLeftovers` 同一过滤（`status = 'ACTIVE'`）且不受 `activeLeftoverLimit` 影响；遗留行附来源记录当前标题 `recordTitle`（1～500，与 `recordCode` 并存） |
| 我的任务（`listMyTasks` · `GET /api/v1/me/tasks`） | 401 | 仅本人 | 仅本人 | 仅本人 | 401 | 仅本人 | 负责人固定为当前用户，拒绝客户端提交 `assigneeId`/`userId`/`projectIds`；SQL 前强制 AuthorizedProjectScope；`limit` 1～100、默认 20；游标为服务端 HMAC 签名、绑定当前用户与筛选条件，TTL 15 分钟；`hasPublishedRecord` 与分页在同一条 SQL 内先过滤后分页；V1 筛选为 `projectId`/`scopeType`/`workStatus`/`hasPublishedRecord`/`priority`/`includeCanceled`（`priority` 与 `workStatus` 正交；`includeCanceled` 缺省 false，与 `workStatus` 组合表达 `TODO ∪ CANCELED`）；条目含 `priority`/`dueAt`/`completedAt`/`creatorId`/`githubLinkCount`/`publishedRecordCount`（与 `hasPublishedRecord` 同源同口径，裁决修订 D-1）/`groupId`（列表不返回 `description`）；响应附 `stats`（`myOpen`/`dueToday`/`overdue`/`completedThisMonth`，日/月界按 Asia/Shanghai 由服务端计算）、`leftoverCount` 与 `leftoverSample`（最新 ACTIVE 遗留，summary 前 200 字符、超长追加 “…”），统计基准集合不受分页与游标影响 |
| 遗留问题列表（`listLeftoverItems` · `GET /api/v1/leftover-items`） | 401 | 仅本人活跃项目 | 不返回本项目（可读其他活跃成员项目） | 不返回本项目（可读其他活跃成员项目） | 401 | 按服务端 Scope | 跨项目按服务端 `AuthorizedProjectScope` 汇总可见记录（PUBLISHED / VOID）的稳定遗留项；`bucket` 只切换 OPEN（ACTIVE）与 CLOSED（CONVERTED / RESOLVED）展示分桶，不改变 `leftoverItemId DESC` 排序；内容取最新版本快照，来源任务与跟进任务只返回任务引用，不复制任务实体；`limit` 1～100、默认 20，`projectId` 只收窄范围；游标为服务端 HMAC 签名、绑定当前用户与筛选，TTL 15 分钟；非成员与不存在不返回 404 而是空页（与 `listMyTasks` 同族），字段校验失败统一 422 |
| 聚合组列表（`listTaskGroups` · `GET /api/v1/task-groups`） | 401 | 仅本人活跃项目 | 不返回本项目（可读其他活跃成员项目） | 不返回本项目（可读其他活跃成员项目） | 401 | 按服务端 Scope | 跨项目按服务端 `AuthorizedProjectScope` 列出聚合组与当前生效（ACTIVE）分支，已解除成员不进入摘要；主任务在前、来源任务按加入顺序；`groupRole`/`sourceKind`/`workStatus` 返回原始枚举由前端映射文案；`limit` 1～100、默认 20，`projectId` 只收窄范围；游标为服务端 HMAC 签名、绑定当前用户与筛选，TTL 15 分钟；非成员与不存在不返回 404 而是空页，字段校验失败统一 422 |
| 任务记录标记批量读（`listTaskGroupMemberships` · `GET /api/v1/task-groups/memberships`） | 401 | 允许 | 允许 | 允许 | 401 | 允许 | 只读批量查询（裁决修订 D-1）；`taskIds` 为逗号分隔的 1～100 个正整数，数量、格式或重复校验失败统一 422；请求中每一个有权 taskId 都出现，未加入 `ACTIVE` 聚合组（含已解除）的任务以 `groupId`/`groupRole` 为 null 返回且 `publishedRecordCount` 照常（与 R-1/R-3 同口径、无记录为 0）；无权、不存在（含跨项目）不出现、不泄露存在性（无 404）；不要求 CSRF 或幂等键 |
| 跨项目记录清单（`listRecordFeed` · `GET /api/v1/change-records`） | 401 | 仅本人活跃项目 | 不返回本项目（可读其他活跃成员项目） | 不返回本项目（可读其他活跃成员项目） | 401 | 按服务端 Scope（可显式读 VOID） | 跨项目按服务端 `AuthorizedProjectScope` 汇总可见正式记录（PUBLISHED / VOID），`projectId` 只收窄范围，非成员项目不返回 404 而是空页（与 `listLeftoverItems`/`listTaskGroups` 同族）；`status` 为 PUBLISHED / VOID / ALL，非系统管理员请求 VOID 或 ALL 时收敛为只返回 PUBLISHED 行（不返回 403，也不泄露其他项目是否存在作废记录）；`source` 为 ALL / MAIN / SOURCE / MODULE / FEATURE（MAIN = 未入聚合组任务与聚合组主任务，SOURCE = ACTIVE 聚合组来源任务，MODULE = 无任务模块级记录，FEATURE = 无任务功能级记录）；`q` 走 CHANGE_RECORD 全文投影（PGroonga），最短 2、最长 200，归一化后不足 2 字返回 422；服务端批量回填项目 / 模块 / 功能名与作者引用（不含登录名与邮箱）；固定 `published_at DESC, id DESC` 排序，`limit` 1～100、默认 20，游标为服务端 HMAC 签名、绑定 actor / 命名空间 / `projectId`（null = 全部项目），TTL 15 分钟；不要求 CSRF 或幂等键 |
| 我的草稿（`listMyRecordDrafts` · `GET /api/v1/me/record-drafts`） | 401 | 仅本人 | 仅本人 | 仅本人 | 401 | 仅本人 | 作者恒为当前 actor，拒绝客户端提交 `authorId`/`userId`/`projectIds` 等他人身份或授权范围参数；SQL 前强制 AuthorizedProjectScope，被移出项目后其草稿立即不可见（不返回 404 而是空页）；只返回 DRAFT，未发布不建搜索投影，故不接受 `q`；`limit` 1～100、默认 20，游标为服务端 HMAC 签名、绑定 actor 与命名空间，TTL 15 分钟；字段校验失败统一 422；不要求 CSRF 或幂等键 |
| 通知列表、未读数、单条已读/未读、全部已读（`getNotifications`、`getNotificationUnreadCount`、`readNotification`、`unreadNotification`、`readAllNotifications`） | 401 | 仅本人 | 仅本人 | 仅本人 | 401 | 仅本人 | 服务端始终从 Session 解析收件人，不接受客户端传入 `recipientId`；查询按 `recipient_id = 当前用户` 过滤；单条不存在或非本人统一 404，管理员也不得代读其他用户；三个 POST 均要求 CSRF 与 `Idempotency-Key`，重复执行可安全重放 |
| `listProjectMembers` · `GET /api/v1/projects/{projectId}/members` | 401 | 403 | 404 | 404 | 401 | 允许 | 完整管理员 Session 且密码/当前 TOTP 双因子重认证均在 5 分钟内；返回项目成员完整历史（含 REMOVED）与脱敏 `name/avatarUrl`，不返回登录名/邮箱；不要求 CSRF 或幂等键；项目不存在或无权限统一 404；响应 `no-store` |
| `listProjectMemberUnfinishedTasks` · `GET /api/v1/projects/{projectId}/members/{userId}/unfinished-tasks` | 401 | 403 | 404 | 404 | 401 | 允许 | 同上；目标必须为 ACTIVE 成员，不存在、已移除或无权限统一 404；只返回当前 TODO 且 ACTIVE 的真实任务，提供改派所需 `rowVersion/moduleId/featureId` |
| `addProjectMember` · `POST /api/v1/projects/{projectId}/members` | 401 | 403 | 404 | 404 | 401 | 允许 | 完整管理员 Session + 5 分钟双因子重认证；项目 ACTIVE；目标用户必须 ACTIVE；CSRF 与 `Idempotency-Key` 必填；成员添加、审计、活动与通知在同一事务提交；重复活跃成员 409，停用/不存在用户 422；重放前重新验证管理员、项目可写与成员资源 |
| `removeProjectMember` · `POST /api/v1/projects/{projectId}/members/{userId}/remove` | 401 | 403 | 404 | 404 | 401 | 允许 | 完整管理员 Session + 5 分钟双因子重认证；项目 ACTIVE；目标必须为 ACTIVE 成员；CSRF 与 `Idempotency-Key` 必填；可提交真实任务改派，未改派任务保留原负责人但成员立即失去处理权限；任务改派、成员移除、审计与活动同一事务；`created_by` 不变；重放前重新验证管理员、项目可写与成员资源 |
| 项目、模块或功能归档/恢复 | 401 | 403 | 404 | 404 | 401 | 允许 | 密码与当前 TOTP 重认证；写审计 |
| 原始审计读取（`getAuditLogs` · `GET /api/v1/audit-logs`） | 401 | 403 | 403 | 403 | 401 | 允许（完整管理员 Session 且密码与当前 TOTP 重认证均在 5 分钟内；只读，不要求 CSRF 或幂等键） | 不传 `projectId` 读 SYSTEM 链，传则读 `PROJECT:<id>` 链，不接受客户端伪造归属；查询经独立只读 `audit_reader` 连接（`AUDIT_DB_*` / `AUDIT_DATABASE_URL(_FILE)`，缺失、路径越界或权限不合规在首次读取 fail closed），不与业务连接共用；返回前先以独立 `UnitOfWork` 向 SYSTEM 链写 `AUDIT_LOG_READ`（含操作者、filters、returnedCount、hasMore 与请求元数据，不含审计正文），留痕失败整体失败、不返回未留痕结果；`cursor` 为服务端 HMAC 签名、绑定操作者与查询指纹，TTL 15 分钟，跨查询/过期/非法 422；`from`/`to` 为半开区间且必须带时区；`limit` 默认 50、最大 100；响应 `no-store`；批量导出与远端 WORM 归档由 `apps/ops` 归档进程交付（`audit_archive_writer` 只读审计与链头、WORM 凭据只允许新建对象；见[审计归档 Runbook](./runbooks/audit-archive.md)） |
| 作废 PUBLISHED / 恢复 VOID 迭代记录 | 401 | 403 | 403 | 403 | 401 | 允许 | 重认证并填写原因；写审计 |
| 重置另一名系统管理员 MFA（`resetAdminMfa` · `POST /api/v1/auth/admin/mfa-reset`） | 401 | 403 | 403 | 403 | 401 | 允许 | 仅完整系统管理员 Session 且 5 分钟内完成密码 + 当前 TOTP 双因子重认证；目标必须是另一名 `ACTIVE` 且已启用 TOTP 的系统管理员，且可用 MFA 管理员数大于 1；同一事务禁用目标因子、失效未使用恢复码、递增 `auth_version`、撤销目标全部 Session 并写审计；CSRF 与幂等键必填；成功 204，目标不存在 404，非管理员/目标未启用 403，自重置、最后一名 MFA 管理员或状态冲突 409，字段/请求头无效 422 |
| `listAdminUsers` · `GET /api/v1/admin/users` | 401 | 403 | 403 | 403 | 401 | 允许 | 完整系统管理员 Session；读取全部账号的登录名、姓名、邮箱、头像、管理员角色、状态、版本与时间，不返回密码、TOTP、恢复码等认证材料；最多 1000 条；响应 `no-store`；不需要 CSRF 或幂等键 |
| `createUser` · `POST /api/v1/admin/users` | 401 | 403 | 403 | 403 | 401 | 允许 | 完整管理员 Session 且密码/当前 TOTP 双因子重认证均在 5 分钟内；CSRF 与 `Idempotency-Key` 必填；Argon2id 哈希在事务外生成、业务与审计同事务写入；登录名/邮箱唯一冲突 409；响应不返回密码或认证材料 |
| `updateUser` · `PATCH /api/v1/admin/users/{userId}` | 401 | 403 | 403 | 403 | 401 | 允许 | 完整管理员 Session + 5 分钟双因子重认证；CSRF、`Idempotency-Key` 与 `If-Match` 必填；登录名不可修改，字段缺省保持不变，`email/avatarUrl` 为 null 表示清空；版本/状态冲突 409；禁止取消自己的管理员角色；移除 ACTIVE 管理员前按 id 升序锁定全部活跃 MFA 管理员，剩余可用 MFA 管理员数必须大于 1，否则 409；审计 `admin.user.update` |
| `disableUser` · `POST /api/v1/admin/users/{userId}/disable` | 401 | 403 | 403 | 403 | 401 | 允许 | 完整管理员 Session + 5 分钟双因子重认证；CSRF、`Idempotency-Key` 与 `If-Match` 必填；目标不存在 404、已停用或版本冲突 409；禁止停用自己；停用 ACTIVE 管理员时执行最后一名可用 MFA 管理员保护；同事务置 `DISABLED`/`disabled_at`、递增 `auth_version` 与 `row_version`、撤销全部 Session 并写审计；停用后目标所有受保护请求 401 |
| `enableUser` · `POST /api/v1/admin/users/{userId}/enable` | 401 | 403 | 403 | 403 | 401 | 允许 | 完整管理员 Session + 5 分钟双因子重认证；CSRF、`Idempotency-Key` 与 `If-Match` 必填；目标不存在 404、已启用或版本冲突 409；同事务清除停用态并递增 `row_version`、写审计；不恢复已撤销 Session 或登录限流历史 |
| `forceLogoutUser` · `POST /api/v1/admin/users/{userId}/force-logout` | 401 | 403 | 403 | 403 | 401 | 允许 | 完整管理员 Session + 5 分钟双因子重认证；CSRF、`Idempotency-Key` 与 `If-Match` 必填；目标不存在 404、版本冲突 409；禁止强制退出自己；同事务递增 `auth_version` 与 `row_version`、撤销目标全部 Session 并写审计；账号保持 ACTIVE |

## F-14 功能级任务接口（2026-09-09 本地实现）

F-14 功能级任务补充：`listTasks`、`getTask`、`listTaskAssignees`、`createTask`、`updateTask` 允许当前活跃项目成员与系统管理员，匿名/停用 401，非成员/已移除/归属错误 404。读接口包含归档历史；写接口须项目、模块、功能 ACTIVE，编辑还须任务生命周期 ACTIVE，CSRF/数据库幂等，更新 If-Match。创建/真正改派须所选用户 ACTIVE 且为项目 ACTIVE 成员（管理员也不能例外），非法或空负责人 422；未改变的历史负责人允许保留。重放重新验证当前资源权限与父级可写性，失败不返回已存成功内容。成员列表在同一事务内自行验证当前 actor 的项目访问，只暴露本项目活跃用户的 id/name/avatarUrl。实现与实际验证见 [F-14 交审](f14-local-handoff.md)。

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

## F-15 模块级任务接口（2026-09-09）

listModuleTasks/getModuleTask/listModuleTaskAssignees/createModuleTask/updateModuleTask允许当前项目活跃成员和系统管理员；匿名/停用401、非成员/移除/真实归属错误404。写操作要求项目/模块和任务生命周期可写，编辑If-Match，全部写CSRF+数据库幂等；负责人沿用F14真实项目成员规则。新增影响必须ACTIVE同项目同模块，保留/移除既有归档影响合法，影响功能不是MODULE任务父级。原功能页listTasks可读模块引用，只有其真实模块路径提供修改入口；归档功能页不开放引用编辑。模块幂等重放检查任务以及响应全部影响功能的当前可读归属。见 [F15交审](f15-local-handoff.md)。


## F-16 任务状态和历史接口（2026-09-10）

transitionTask/transitionModuleTask/getTaskStatusHistory/getModuleTaskStatusHistory 允许当前项目活跃成员及系统管理员；匿名/停用401、无成员权限或错误真实归属404。写入要求父级可写、任务ACTIVE、合法状态迁移、CSRF、数据库幂等与If-Match；历史读取允许已归档父级。MODULE 已有归档影响关系可保留；功能引用页不直接执行模块命令。重放重新验证当前身份、权限、父级与已存结果影响资源。COMPLETE 服务端仅接受 WITHOUT_RECORD 六类原因，WITH_RECORD 返回422；取消/恢复不改变授权关系。见 [F16交审](f16-local-handoff.md)。

## F-17 迭代记录草稿接口（2026-09-10）

| operationId | 允许身份 | 附加门禁 |
| --- | --- | --- |
| listRecordDrafts / getRecordDraft | 当前活跃项目成员、系统管理员 | 匿名/停用 401；非成员、移除成员、错误真实归属 404；可读归档范围内 DRAFT；列表 `limit` 1～100、默认 20，`cursor` 为服务端 HMAC 签名、绑定 actor / 命名空间 / 项目、TTL 15 分钟，篡改 / 过期 / 跨项目 / 跨命名空间统一 422 `INVALID_CURSOR`，其余参数校验失败 422；详情读取不接受查询参数 |
| getTaskRecordDrafts | 同上 | 验证任务真实 project/module，返回来源身份和全部 DRAFT，不隐式选择或创建 |
| createIndependentRecordDraft | 同上 | 父级 ACTIVE；独立新选影响同项目同模块且 ACTIVE；处理人/作者为 actor；CSRF、同源、数据库幂等 |
| updateIndependentRecordDraft | 同上 | 父级可写，If-Match 为记录版本；有来源任务则拒绝并要求 Workflow；历史 MODULE 归档影响可保留 |
| createTaskRecordDraft | 同上 | 来源任务 ACTIVE、真实父级可写，If-Match 为任务版本；锁后派生标题/归属/负责人，允许同任务多草稿；CSRF、同源、数据库幂等 |
| updateTaskRecordDraft | 同上 | 同上但 If-Match 为记录版本；任务/记录完整同项目关联匹配，内容更新保留来源与记录快照 |

所有写接口成功重放前重新验证当前认证、CSRF、成员权限、真实可写父级和返回的全部影响资源；来源路径额外重读任务/记录关联。拒绝不泄露已存响应。TODO/DONE/CANCELED 均可保存来源草稿，保存不改变状态。无权限放宽、数据库权限或迁移变更。列表分页（B-1）返回 C-006 envelope（items/nextCursor/hasMore），按服务端固定 `created_at DESC,id DESC` keyset 排序；前端只按 `nextCursor` 追加，不得重排，也不得把游标跨项目或跨接口复用。见 [F-17 交审说明](f17-local-handoff.md)。

## F-18 正式记录接口（2026-09-10）

| operationId | 允许主体 | 实时门禁及拒绝 |
| --- | --- | --- |
| listChangeRecords / getChangeRecord | 活跃项目成员、系统管理员 | 匿名/停用 401；非成员/撤权/跨项目 404；成员仅 PUBLISHED；管理员显式 VOID 列表及 VOID 详情，归档父级可读；列表 `limit` 1～100、默认 20，`cursor` 为服务端 HMAC 签名、绑定 actor / 命名空间 / 项目、TTL 15 分钟，篡改 / 过期 / 跨项目 / 跨命名空间统一 422 `INVALID_CURSOR`，其余参数校验失败 422；详情读取不接受查询参数 |
| listChangeRecordVersions / getChangeRecordVersion | 同上 | 真实项目及记录关系，版本属于该记录；普通成员 VOID 404，管理员可读全部版本；恢复以 status 为准 |
| publishChangeRecord | 同上 | 父级可写、记录 DRAFT、If-Match；来源为空或锁内 DONE，TODO/CANCELED 409；同源/CSRF、数据库幂等 |
| createChangeRecordVersion | 同上 | 父级可写、记录 PUBLISHED、If-Match 与 X-Record-Version；内容 DTO 禁止来源/身份/状态字段；ACTIVE 清空须明确确认；同源/CSRF、数据库幂等 |

两条 POST 重放重新验证当前身份、CSRF、实时权限、可写父级及结果记录/影响/遗留项归属，拒绝不返回缓存结果。来源任务后续重开不取消已发布历史的修订/重放资格。发布通知去重后的作者/处理人/当前任务负责人/真实所属或影响功能创建者，修订通知原作者/当前任务负责人，逐人检查当前项目权限。无新增数据库角色或权限。列表分页（B-1）返回 C-006 envelope（items/nextCursor/hasMore），按 `published_at DESC,id DESC` keyset 排序，不改变可见性口径：无权限项目先按 404 收敛，再校验游标；VOID 列表仅管理员并复用同一游标绑定。见 [F-18 交审说明](f18-local-handoff.md)。

## F-23 任务合并接口（2026-09-10）

| operationId | 允许身份 | 附加门禁 |
| --- | --- | --- |
| mergeTaskGroup | 当前活跃项目成员、系统管理员 | 匿名/停用 401；非成员、移除成员、来源/主任务真实归属错误、跨项目或任务不存在 404；Session、CSRF、同源与数据库幂等 |

仅 `POST /api/v1/task-groups/merge`：请求只携带来源任务、主任务、分支类型（ACTIVE/HISTORICAL）与合并说明，项目、聚合组编号和成员快照（原工作状态/原负责人）全部由服务端在锁内按真实任务推导。服务端先按项目 -> 模块 -> 影响功能父到子顺序取 `FOR SHARE`，再按任务 ID 升序 `FOR UPDATE`，已有聚合组按组行 `FOR UPDATE` 后重读成员；来源任务已属于其他活跃聚合组、主任务在组内不是 MAIN、聚合组已关闭或主任务已变化统一 409。合并只写 `task_groups`/`task_group_members` 关系与来源快照、审计、活动、通知与搜索投影，不修改任何任务字段。重放前重新验证当前认证、CSRF、项目授权、聚合组仍为 ACTIVE 与全部结果任务可读，任一门禁失败不返回已存响应。无权限放宽、数据库权限或迁移变更。见 [F-23 交审说明](f23-local-handoff.md)。

## F-19 组合完成接口（2026-09-10）

| operationId | 允许主体 | 实时约束 |
| --- | --- | --- |
| completeTask | 当前活跃项目成员、系统管理员 | 匿名/停用/无效 CSRF 401，同源失败 403，错误归属/撤权/不可访问草稿 404；真实父级 ACTIVE，任务 ACTIVE/TODO、If-Match/expectedRowVersion 和引用草稿版本锁内检查，不匹配 409 |
| completeTask 重放 | 同上 | 重新验证身份、CSRF、当前项目权限、真实可写父级、组身份及全部任务/记录/影响/遗留资源；不得泄露已存状态码或结果 |

历史 SOURCE 不承接新执行工作，MAIN 与活动 SOURCE 可完成；无变化只保存六类原因和说明。有变化不得更改草稿身份/归属/历史影响或覆盖已有其他 task_id。两业务事件通知分别去重并检查收件人当前访问权。无权限基线、数据库角色或迁移改变。见 [F-19 交审说明](f19-local-handoff.md)。

F-19 兼容收口：transitionTask/transitionModuleTask 的 COMPLETE 也必须通过 TaskCompletionWorkflow 的真实归属、当前组身份与相关记录作者通知过滤。历史 SOURCE 当前执行及成功结果重放均拒绝；MAIN/活动 SOURCE 可完成。两旧 operation 幂等/重放授权契约升级 2.0.0，旧 1.0.0 Key 返回 409。REOPEN/CANCEL/RESTORE 保留原权限行为和旧 TaskItem/ModuleTaskItem 响应。
## F-20 遗留转换授权（2026-09-10）

| 路由 | 授权与限制 |
| --- | --- |
| convertLeftoverToTask | 匿名/失效401，非成员或错误记录/遗留404，真实父级归档409；当前PUBLISHED关系、稳定ACTIVE项、版本/继承确认、当前活跃成员指派、CSRF/同源/幂等 |
| previewLeftoverTask | 实时项目成员/管理员，PUBLISHED当前遗留；因为是写预览，真实父级归档409；MODULE归档影响只排除不阻断 |
| getLeftoverTaskSource | 按真实任务项目验证当前成员/管理员；任务不存在/失权404，归档历史可读；来源非PUBLISHED或未关联返回null，不暴露记录引用 |

不同Key重复转换先验证现有任务归属与访问再返回409引用；失权details为空。同Key成功结果重放检查当前记录、稳定链接、任务和保存影响资源。任务负责人须由服务端成员端口验证，来源scope与原文不可由客户端改写。三路由均no-store，具体测试与未验证项见[F-20交审说明](f20-local-handoff.md)。

## F-24 解除合并接口（2026-09-10）

| operationId | 允许身份 | 附加门禁 |
| --- | --- | --- |
| unmergeTaskGroup | 当前活跃项目成员、系统管理员 | 匿名/停用 401；非成员、已移除成员、来源/主任务真实归属错误、跨项目或任务不存在 404；Session、CSRF、同源与数据库幂等 |

仅 `POST /api/v1/task-groups/unmerge`：请求只携带来源任务与解除原因（可空，≤10000，空白回落固定文案），项目与聚合组归属全部由服务端在锁内推导。服务端按项目 -> 模块 -> 影响功能父到子顺序取 `FOR SHARE`，再按任务 ID 升序 `FOR UPDATE`，最后锁聚合组行并重读成员；仅允许解除活跃 SOURCE：来源已不是活跃成员 404 `TASK_NOT_MERGED`，来源是 MAIN、聚合组已关闭或锁内关系变化统一 409。解除只写 `task_group_members` 关系（`DETACHED` + 时间 + 原因）与聚合组状态/版本，不修改任务工作状态、负责人和迭代记录；最后一个来源解除时同事务关闭聚合组并解除 MAIN。重放前重新验证当前认证、CSRF、项目授权、聚合组可读与全部结果任务可读（组可为 `CLOSED`），任一门禁失败不返回已存响应。无权限放宽、数据库权限或迁移变更。见 [F-24 交审说明](f24-local-handoff.md)。

## F-21 记录作废与恢复（2026-09-10）

| operationId | 允许身份 | 拒绝与门禁 |
| --- | --- | --- |
| voidChangeRecord | 完整管理员 Session，五分钟密码与当前 TOTP 双时间戳重认证 | 匿名/失效401；普通成员及其他非管理员403；原因非空、同源、CSRF、If-Match、数据库幂等；PUBLISHED→VOID；错误资源404，状态/版本/归档父级409 |
| restoreChangeRecord | 同上 | VOID→PUBLISHED；项目和模块 ACTIVE，FEATURE 所属功能 ACTIVE；MODULE 历史影响及来源任务不是父级门禁 |

listChangeRecords 默认 PUBLISHED，管理员显式 status=VOID 才列出作废记录；成员请求 VOID 返回404。getChangeRecord/listChangeRecordVersions/getChangeRecordVersion 允许管理员读取 VOID 详情和全部不可变版本，成员返回404。ReadableRecord 的 PUBLISHED 分支不包含作废快照；VOID 分支仅向管理员返回最近作废时间/原因。恢复后即便保留快照，成员读取仅取 PUBLISHED 分支。

迁移响应/幂等缓存只有 id/projectId/status/rowVersion。重放先重查当前完整认证、CSRF、管理员双时间戳和结果记录可读性；归档父级不取消历史可读性，重放不重复迁移。业务状态、审计、Search 与该记录全部 Activity 共用一个事务；Activity 不含原因，无作废/恢复通知。见 [F-21 交审说明](f21-local-handoff.md)。

## F-22 GitHub 当前关联

| operationId | 允许主体 | 拒绝与附加门禁 |
| --- | --- | --- |
| listExternalLinks | 当前活跃项目成员、系统管理员 | 匿名/无效Session401，其他项目/已移除成员404；按真实目标归属；VOID普通成员404、管理员只读；归档目标可读 |
| addExternalLink | 当前活跃项目成员、系统管理员 | 同上；目标及真实父级ACTIVE（记录DRAFT/PUBLISHED），VOID管理员409；CSRF、同源、If-Match、数据库幂等；重复当前关联409、容量超限422 |
| removeExternalLink | 当前活跃项目成员、系统管理员 | 同上；只解除当前类型化关联，保留链接实体与不可变审计；其他项目linkId404；状态/版本冲突409 |

三条路由使用严格的 PROJECT/FEATURE/TASK/CHANGE_RECORD 目标枚举。Workflow经各域公开QueryPort解析真实归属、按父到子顺序取锁，各域CommandPort递增目标row_version，不改正式current_version或不可变历史。MODULE的历史影响功能不是记录所属父级；合并来源任务的链接不转移。新写入取得目标锁后再验证Session/CSRF与实时成员关系。重放重新验证当前认证、原操作权限、真实目标和保留链接实体可读；已成功解除的关联无需仍存在，父级归档不隐藏历史成功结果，VOID成员仍404。

### F-22 父审核增量（2026-09-10）

读取与重放在真实父级锁后取目标FOR SHARE并重读，锁保持至本次关联读取/重放授权完成；预读状态不参与最终可见性判定。等待父锁期间PUBLISHED转VOID后，普通GET与添加/解除重放均404，管理员只读。Route Registry与实写审计统一EXTERNAL_LINK_ADDED/EXTERNAL_LINK_REMOVED；真实锁竞态和验证更正见[F22交审说明](f22-local-handoff.md)。
