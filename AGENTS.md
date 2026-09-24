# InPulse 仓库开发规则

本文件适用于整个仓库，供人工开发者和编码代理共同遵守。子目录只有在确有不同约束时才添加更靠近代码的 `AGENTS.md` 或 `AGENTS.override.md`；子目录规则不得放宽本文件中的安全、数据一致性和审计要求。

## 1. 当前状态与事实来源

- 仓库当前处于阶段 0 实施中，阶段 0 尚未完成；不得把设计范围描述成已实现能力，也不得声称不存在的脚本、测试或服务已经运行成功。
- 当前候选开发基线由 [功能设计 V1.1](./功能设计v1.1.md)、[系统设计文档 V1.0.2](./系统设计文档v1.0.2.md)、[技术设计 V1.2.2](./技术设计v1.2.2.md) 与[正式 ADR 索引](./docs/adr/README.md)同步构成。功能设计负责业务规则，系统设计负责范围、模块和安全机制，技术设计负责实施细节。
- 经批准且明确取代既有决策的 ADR 优先；变更已接受的架构决策时，必须新增 ADR 并标记替代关系，再同步功能设计、系统设计、技术设计、权限矩阵和测试矩阵。
- 文档、ADR、代码或测试发生冲突时，不得静默选择其中一方。先记录冲突及影响；受影响实现必须等待人工定案，未受影响工作可以继续。
- [权限矩阵](./docs/permissions.md)和[测试矩阵](./docs/test-matrix.md)分别是授权验收与测试覆盖的维护入口；相关行为变化必须同步更新。
- 明确的任务目标决定本次修改范围，但不得绕过既有安全和数据不变量。若需求确需改变不变量，先走 ADR 和人工评审。

## 2. 开工方式

开始修改前必须：

1. 查看 `git status`，识别并保留用户或其他任务已有的改动；
2. 阅读本文件、相关设计章节、已有 ADR、相邻实现和测试；
3. 明确目标、范围、非目标、业务不变量、接口、数据库影响和验收方式；
4. 选择一个可审查的业务纵切片，小步实现，不一次生成整个系统再集中调试。

除非任务明确授权，编码代理不得：

- 新增核心生产依赖、升级主版本或更换架构/基础设施；
- 修改数据库不变量、放宽鉴权或降低安全基线；
- 删除、修改或重写已提交的历史迁移；
- 跳过、删除或弱化失败测试以获得通过；
- 读取、输出、复制或修改生产 Secrets；
- 把网络请求放进数据库事务；
- 物理删除必须保留的业务历史；
- 创建提交、推送、合并、打标签或修改远端仓库设置。

## 3. 架构与依赖边界

- 系统形态固定为模块化单体、React SPA、NestJS API 和单一 PostgreSQL 数据库。
- 本期不引入微服务、多租户、Kubernetes、Redis、Elasticsearch、WebSocket、Event Sourcing、CQRS 框架、自研权限 DSL、通用 Outbox/Worker、附件对象存储或 GitHub API/Webhook 深度集成。改变这些非目标必须新增 ADR。
- 后端调用方向为：`Controller -> 单域 Application Service 或跨域 Workflow -> Domain/Public Port -> Repository/Projection Writer -> PostgreSQL`。
- Controller 只能在单域 Use Case 和跨域 Workflow 之间二选一调用，不得直接访问数据库或重复实现业务规则。
- Repository 只负责持久化，不决定业务状态流转。
- 领域模块不得互相调用写服务或访问其他模块的内部 Repository。跨域写只允许 Workflow 调用公开 CommandPort；跨域读只允许通过稳定 QueryPort。
- 一个命令只创建一个 `UnitOfWork`。所有 CommandPort、Repository、审计、通知和投影写入必须显式接收同一个 `TransactionContext`；事务回调中禁止使用全局 Drizzle Client。
- 数据库事务内禁止网络请求和长时间 CPU 工作。
- 前端依赖方向为 `app -> pages -> features -> shared/generated`；`features` 禁止导入 `pages`，`shared` 和 `generated` 禁止反向依赖业务层。
- 禁止建立万能 `shared/utils`。共享代码只放被至少两个应用使用、语义稳定且没有环境副作用的内容。
- 应用代码落库后，CI 必须检查代码依赖图、禁止循环依赖和反向依赖。

## 4. 技术栈与依赖管理

- 使用 TypeScript 严格模式、pnpm workspace、单一 lockfile。
- 候选主版本基线为 Node.js 24.x、pnpm 11.x、React 19.x、Vite 8.x、Ant Design 6.x、TanStack Query 5.x、React Hook Form 7.x、Zod 4.x、PostgreSQL 18.x。
- NestJS 基线已按 [ADR-026](./docs/adr/ADR-026.md) 定案为 11.x 并锁定 11.2.3；升级 12.x 必须满足该 ADR 的触发条件与工作清单，并作为独立依赖升级 PR 由人工确认，不得提前写成既成事实。
- Drizzle 必须处于 `>=0.45.2、<0.46`，但实际补丁版本须由阶段 0 锁定。Nginx 固定为 1.30.x 系列，阶段 0 锁定实际补丁和镜像 digest；切换 stable 系列必须新增 ADR。
- `package.json`、`pnpm-lock.yaml`、CI 和生产镜像必须锁定经过批准的实际版本；生产依赖禁止使用 `latest`、`next`、`beta` 或 `rc`。
- 修改 manifest 时必须同步提交 lockfile。不得手工编辑 lockfile。
- 依赖升级只通过独立 PR 完成，必须人工确认；不得自动合并依赖更新。
- OpenAPI 生成工具链已由 [ADR-027](./docs/adr/ADR-027.md) 定为 `Accepted`（2026-09-07）；`apps/api` 的模块/解析制式已由 [ADR-028](./docs/adr/ADR-028.md) 定为 ESM/NodeNext（2026-09-07）；Nest Zod Pipe/Serializer 组合和运行参数已由 [ADR-029](./docs/adr/ADR-029.md) 定为 `Accepted`（2026-09-09）：Controller 只绑定 `@Operation("operationId")`，请求参数统一使用 `ContractBody/Query/Path/Headers`，响应由全局 ContractResponseInterceptor 按实际状态校验并剔除未知字段，异常由全局 Filter 输出统一错误体并设置 `X-Request-Id`。未转为 `Accepted` 的选择不得在规则或实现中伪装成已冻结基线。
- 搜索基线已经确定为 PostgreSQL + PGroonga + `SearchProjection`（V1 由 ADR-025 替代 ADR-010）：支持中文短词、完整英文缩写、完整代码标识符和完整编号，不保证任意英文/代码子串，不提供正则搜索；普通查询必须使用 `normalized_search_text &@~ app.pgroonga_query_escape($1)`。
- 生产 CSP 已确定使用逐响应 nonce 且禁止 `script-src/style-src 'unsafe-inline'`；阶段 0 验证的是 Ant Design/Vite 兼容性，失败时阻断并通过 ADR 更换方案，不得降低 CSP。

## 5. API 与前端契约

- HTTP API 使用 REST JSON 和 `/api/v1` 前缀。
- `packages/api-contract` 中的 Schema Registry/Zod（内部文件可按 `contracts/*.zod.ts` 组织）是请求与响应数据结构的唯一来源；类型化 Route Registry 是 method、path、operationId、状态码、Content-Type、鉴权、CSRF、幂等和并发策略的唯一来源。两者共同生成 OpenAPI 3.1 与 TypeScript 客户端。
- 每个路由必须完整登记策略；不适用的策略也必须显式写 `none`，不得依赖隐式默认值。
- Controller 只绑定 operationId、调用 Use Case/Workflow，并返回契约 DTO；禁止直接返回数据库实体或重复手写契约 DTO/OpenAPI Decorator。
- 服务端必须验证请求和响应；客户端校验不能替代服务端校验。错误响应统一为 `{ code, message, details, requestId }`，不得使用 NestJS 默认错误格式。
- 状态码语义固定为：400 请求格式或业务参数错误；401 未登录或 Session 失效；403 已登录但无全局权限；404 资源不存在或当前用户不可访问；409 版本、重复操作或状态冲突；422 字段校验错误；429 限流；500 未预期错误；503 服务未就绪（就绪探针未通过）。数据库异常、堆栈和响应校验内部细节不得原样返回客户端。
- 前端所有 API 调用必须经过生成客户端；组件和 feature 代码不得直接裸写 `fetch` 或 `axios`。
- OpenAPI 和生成客户端必须提交到仓库，但只能由生成工具更新，禁止手工修改。
- API 变更必须在同一 PR 中同步 Schema、Route Registry、Controller 绑定、权限矩阵、集成测试、OpenAPI 和客户端，并通过生成物无漂移检查。

## 6. 数据库、事务、幂等与并发

- 数据库约束是最终防线：必填归属使用 `NOT NULL`，状态使用 `TEXT + CHECK`，唯一性和引用完整性使用 `UNIQUE`/FK，而不是只靠应用校验。
- 所有项目内跨层关系必须包含 `project_id`，并使用复合外键阻止跨项目串联。
- 跨模块业务操作必须在同一事务中完成；审计、通知、活动投影和搜索投影与业务写入使用相同事务。
- 聚合更新使用条件更新或显式行锁，并在成功后递增 `row_version`。唯一约束、版本冲突和状态冲突映射为明确的 409 业务错误。
- 多聚合命令固定锁序为：任务 ID 升序 -> 任务组 ID 升序 -> 迭代记录 ID 升序 -> 遗留项 ID 升序。预读结果在获得锁后发生变化时，必须重新读取并从头有限重试。
- 命令需要验证项目、模块或功能仍可写时，必须先按项目 -> 模块 -> 功能的父到子顺序和各层 ID 升序取得 `FOR SHARE`；归档方按相同顺序取得 `FOR UPDATE`，随后才进入上述业务聚合锁序，防止父级归档与子级写入竞态。
- 所有写接口（POST、PUT、PATCH、DELETE）默认必须在 Route Registry 声明 `idempotencyRequired` 并实现数据库级幂等；普通 GET、HEAD 和纯校验接口显式声明 `none`。[ADR-023](./docs/adr/ADR-023.md) allowlist 中的 operationId 必须且只能声明 `securityFlow`，包括签发/消费一次性安全材料（预认证 CSRF、Session 与 CSRF）、登录/登出与 SSO 认证导航（`startSsoLogin`/`completeSsoLogin`，共五条，[ADR-032](./docs/adr/ADR-032.md)）；新增例外必须另立 ADR。通用幂等记录禁止保存或重放 Cookie、CSRF Token 或任何一次性安全材料。
- `idempotencyRequired` 的请求摘要必须覆盖大写 method、operationId、幂等契约版本、摘要格式与请求 Schema 版本、Schema 解析后的 path 参数和规范 query、规范 Content-Type、Route Registry 声明的全部行为相关请求头以及 JCS 规范化 body；使用版本头的路由必须包含 `If-Match`。摘要使用独立、带版本密钥的 HMAC-SHA-256，不得把普通 SHA-256 用作密码、验证码或其他低熵输入的离线校验器。Cookie、Authorization、CSRF、追踪头和 Idempotency-Key 不进入摘要。任一语义输入或幂等契约版本不同都返回 409。幂等不能只依赖前端禁用按钮或进程内锁。
- 每条 `idempotencyRequired` 路由必须登记带版本的 `idempotencyReplayPolicy`：逐个列出可能缓存的 2xx 状态；有 body 时列出精确响应 Schema 引用以及可安全持久化和重放的全部 body 叶子字段，无 body 时使用互斥的 `noBody` 分支。CI 必须拒绝遗漏状态、字段不全或越界、Schema 不一致、Secret 字段以及任何 `Set-Cookie`/认证响应头重放；`none` 与 `securityFlow` 路由的该策略只能为 `none`。请求或安全重放策略变化必须升级幂等契约版本，旧 Key 在新契约下返回 409。
- 每条 `idempotencyRequired` 路由还必须登记 `replayAuthorizationPolicy`，以类型化、最小化的结果资源引用说明缓存响应暴露了哪些资源。幂等重放前必须重新验证当前认证、原操作权限、所有结果资源的当前可读权限及该路由要求的高风险门禁（当前有效的完整管理员 Session）；任一门禁失败时拒绝且不得泄露已存状态码或响应。只有全部门禁通过后，同 Key、同摘要和同契约版本才重放原 2xx。
- 项目创建时，创建者必须自动成为活跃成员且创建流程不可取消该成员关系；创建完成后，系统管理员可以按普通成员规则移除创建者（[ADR-033](./docs/adr/ADR-033.md) 起创建者成员行默认担任组长 LEADER，组长须先由系统管理员转移或撤销后才能被移除）。`projects.created_by` 只用于不可变溯源，不赋予额外权限，也不得随成员移除而改变。普通成员创建者被移除后立即失去成员关系派生的项目权限；若创建者本身是系统管理员，其全局管理员权限不受成员记录影响。测试必须分别覆盖这两种身份。
- 正式记录版本不可变；迭代记录状态只允许 `DRAFT -> PUBLISHED -> VOID`，以及系统管理员执行的 `VOID -> PUBLISHED` 恢复（[ADR-031](./docs/adr/ADR-031.md) 起不再要求 TOTP 重认证）。`status` 是详情、统计、搜索和时间线可见性的唯一真相，不得因恢复后仍保留 `voided_at` 而继续隐藏。恢复必须保留作废快照与全部版本，原因进入不可变审计，具体不变量见 [ADR-024](./docs/adr/ADR-024.md)。任务组成员关系是 MAIN/SOURCE 身份的唯一真相。业务历史默认通过归档、作废或新版本保留，不物理覆盖或删除。
- 历史迁移一经合并不得修改、删除或重排。新迁移采用 expand/contract 思路，必须支持从上一正式版本验证升级和回滚兼容窗口。
- API 进程不得在启动时自动生成 Schema。迁移由独立、受限的 migration 任务执行。
- Repository/Application 集成测试必须使用真实 PostgreSQL 验证事务、锁、约束和权限，不能只 Mock Repository。
- 数据库迁移、约束、角色和权限变更必须人工评审。

## 7. 认证、鉴权与 Secrets

- 不信任客户端提交的 `projectId` 来证明资源归属。鉴权必须根据 actor、资源真实归属和实时成员关系在服务端完成。
- 成员关系不得缓存到 Session 或长生命周期对象；搜索和动态查询必须先取得服务端生成的 `AuthorizedProjectScope`，并在 SQL 层过滤。
- 资源不存在和无权访问统一返回 404，避免泄露资源存在性；已登录但缺少全局权限时返回 403。
- Session、CSRF 和预认证 Token 在数据库中只保存 Hash；Cookie、CSRF 和安全响应头必须遵守技术设计。
- 单点登录（[ADR-032](./docs/adr/ADR-032.md)，前端入口经 [ADR-036](./docs/adr/ADR-036.md) 修订）是并列登录入口：`/login` 默认展示本地口令表单，登录框下方的「或以统一身份认证登录」图标入口整页跳转 `GET /api/v1/auth/sso/start`；该路由只保存 state 的 HMAC 并下发 `__Host-sso-state`，`GET /api/v1/auth/sso/callback` 必须同时匹配 URL `state` 与该 Cookie 后才一次性消费；nonce 与 PKCE verifier 由服务端从 state 派生、不落库；token 交换与 JWKS 验签禁止放进数据库事务；只允许用 `sub`/`Name`/`DisplayName`/`Email` 映射本地账号，Casdoor 的 `isAdmin` 等 claim 一律不得影响 InPulse 权限。
- SSO 首次登录 JIT 开通 `is_admin=false`、`password_hash=NULL`、无任何项目成员关系的账号；映射优先级固定为 `sso_subject` 命中 → 登录名命中且未绑定且邮箱一致时绑定 → JIT；邮箱不一致或 subject 已绑定其它账号必须按冲突拒绝，禁止静默接管同名账号。无口令账号在本地入口必须干净地返回 401，不得抛错或 500。
- `SSO_ENABLED` 非真值即整体关闭；配置非法时 fail closed：点击统一身份认证入口后由服务端 302 回 `/login?local=1&sso=disabled`，登录页提示未启用并隐藏入口；`/login?local=1` 是管理员应急口令入口，渲染与默认登录页一致。SSO start/callback 是 302-only 路由，不参与生成客户端；前端只做同源整页跳转，不得为此新增裸 `fetch`/`axios`，也不得新增 SSO 状态查询接口。
- 登录只接受匿名预认证 Session 及其 CSRF Token；已有普通、受限或完整认证 Session 必须先登出，再签发新的预认证 CSRF。停用用户的旧 Session 按无效处理；受保护或业务接口返回 401，但 `issueCsrfToken` 与无效 Session 的同源 `logout` 可按匿名安全语义执行且不得恢复身份。
- 管理员高风险接口只要求当前有效的完整管理员 Session（`AUTHENTICATED`）、`is_admin`、写操作 CSRF、数据库级幂等与审计留痕；[ADR-031](./docs/adr/ADR-031.md) 起不再要求管理员密码与 TOTP 重认证，`reauthenticated_at`/`mfa_verified_at` 不再作为门禁条件。
- 认证 Session 的状态必须由每条签发路径显式赋值，不得默认成为完整认证态；[ADR-031](./docs/adr/ADR-031.md) 起 `user_sessions.auth_state` 只写入 `AUTHENTICATED`，历史取值不得作为有效认证态参与鉴权。
- Markdown 不允许原始 HTML；用户链接必须使用标准 URL Parser 和协议/域名白名单。V1.2.2 仅保存 GitHub HTTPS 链接，不主动抓取远程内容。
- 禁止读取、打印、记录、提交或复制 Secrets。`.env.example` 只放非敏感变量名，不放 Secret 示例值或占位值。
- 生产 Secret 只从 `/run/secrets/*` 读取；缺失、空值、路径越界或权限不合规必须 fail closed，不允许敏感环境变量 fallback。
- 若发现 Secret 已进入 Git 历史，立即停止传播，通知维护者先撤销/轮换，再制定历史清理方案；仅新增一次删除提交不视为完成处置。

## 8. 测试与验证

- 行为变更应先写或更新能失败的测试，再小步实现；修复缺陷必须覆盖回归路径。
- 先运行最小相关测试，再运行类型检查和模块测试；交付前运行所有适用于本次变更的完整门禁。
- 必须覆盖真实数据库约束、事务回滚、权限矩阵、幂等、乐观锁、并发竞态、请求/响应契约和关键 E2E 路径。
- 不得使用 `skip`、降低断言或删除用例来掩盖失败；确需隔离不稳定测试时必须说明原因、影响和恢复计划，并获得人工同意。
- 本地跑真实 PostgreSQL 集成测试与 Playwright E2E 必须指向独立测试库（推荐 `app_ci`），不得指向本地演示库 `app`：夹具会直接写进演示页面，而演示库里的历史夹具只能人工清理。一次性准备：`CREATE DATABASE app_ci OWNER cluster_bootstrap` → 在 `app_ci` 上执行 `database/bootstrap/000_roles.sql` 与 `database/bootstrap/020_pgroonga.sql` → `MIGRATION_DATABASE_URL=postgresql://cluster_bootstrap@127.0.0.1:55432/app_ci pnpm db:migrate`；跑测试时把 `TEST_DATABASE_URL` / `E2E_DATABASE_URL` 指向 `app_ci`。演示库若已被污染，用 `E2E_DATABASE_URL=postgresql://cluster_bootstrap@127.0.0.1:55432/app node apps/e2e/helpers/fixture-cleanup.ts` 清理（按夹具前缀删除并回退 SYSTEM 审计链头；`cleanupFixtures` 有事务级完整性断言）。
- 审计哈希链必须使用真实 PostgreSQL 验证同一 scope 至少 100 个并发业务事务；不得把测试拆成较低阈值后声称满足该门禁。若 CI 连接池无法支撑，必须提供容量依据并通过 ADR 调整，不得同时保留多个验收数字。
- 完整 CI 顺序以技术设计第 12 章为准。新增根脚本后，`README.md`、本文件和 CI 必须同时更新为同一组实际命令。

- 阶段 0 CI 最小链路已落库：根级可运行命令为 `pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm format`、`pnpm format:check`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:web`、`pnpm test:integration`、`pnpm db:migrations:check`、`pnpm db:seed:check`、`pnpm db:seed:demo`、`pnpm db:migrate`、`pnpm contract:generate`、`pnpm contract:drift`、`pnpm contract:validate`、`pnpm build`、`pnpm test:e2e`、`pnpm check:deploy:test`、`pnpm check:deps`、`pnpm check:frontend:boundaries`、`pnpm permissions:check`、`pnpm deps:audit`、`pnpm check:secrets`、`pnpm check:docs`，以及一次跑完全部非数据库门禁的 `pnpm check`（`pnpm check` 在 `db:migrations:check` 之后插入 `pnpm db:seed:check`）。GitHub Actions 的 `CI / workspace` job 按技术设计 §12.4 顺序执行同一组命令，`Documentation / docs` job 只执行 `check:docs`。因为 `0003_search_pgroonga.sql` 在缺少 PGroonga 时 fail closed，CI 先用 `database/poc/search-pgroonga/Dockerfile.pgroonga-pg18.6` 基于 digest 固定的 `postgres:18.6` 构建探针镜像，再按 `database/scripts/test-local.ps1` 的同一顺序执行 `000_roles.sql`、`020_pgroonga.sql`、空库迁移与集成测试；该探针镜像只服务 CI 与 PoC，不是生产部署镜像，也不等同于 §12.4 的容器镜像构建门禁。`pnpm db:migrate`、`pnpm test:integration`、`pnpm db:test` 与 `pnpm db:test:local` 需要已安装 PGroonga 的 PostgreSQL 18 实例，不含 PGroonga 的官方 PostgreSQL 18.6 安装会让 `db:test:local` 按设计直接失败；本机 PostgreSQL 18.6（`D:\PostgreSQL\18\pgsql`）已内置 PGroonga 4.0.8，`db:test:local` 与 API `test:integration` 均已在本地实测通过。`pnpm test:search:db` 与 `pnpm test` 还要求 `max_connections >= 150`，二者按既定决定尚未纳入 CI。`check:docs` 同时检查 HEAD、暂存区、工作区、未忽略的新文件和 Markdown 链接/锚点；`deps:audit` 需要访问 registry，曾因 `origin/main` PR #16 的 `@testing-library/*` -> `@testing-library/dom` -> `pretty-format@27.0.2` 带入 `ansi-regex@5.0.0`（GHSA-93q8-gq69-wqmw，high，补丁 `>=5.0.1`）而失败，已由 `pnpm-workspace.yaml` 的 `overrides` 把 `ansi-regex` 固定到 `^5.0.1`（lockfile 落为 `5.0.1`）解决；此前本地 `pnpm deps:audit` 与 `pnpm check` 已通过；当前本机 npm 镜像缺少 audit endpoint 时需用公共 registry 执行 `pnpm audit --registry=https://registry.npmjs.org`（2026-09-08 已验证无漏洞），该依赖变更为 dev 工具链，仍须按第 4 节作为独立依赖升级 PR 由人工确认。`test:integration` 已包含技术设计 §12.3/§12.4 要求的数据库角色与权限探针。A-1 备份/恢复集成测试需要真实 `pg_dump`/`pg_restore`：runner 自带的 PGDG noble 客户端为 16.x，pg_dump 拒绝连接主版本更新的服务器（测试库为 PostgreSQL 18.6），因此 `CI / workspace` 在集成测试前启用 PGDG 源并安装固定版本 `postgresql-client-18=18.6-1.pgdg24.04+2`，通过 `INPULSE_BACKUP_PG_DUMP`/`INPULSE_BACKUP_PG_RESTORE` 注入 `apps/ops` 集成测试（本地等价设置见本文件 A-1 条目）。Playwright 浏览器 E2E 测试基座已落库并纳入 `CI / workspace`（当前 Playwright 29 例：项目创建关键路径、F-03 用户管理、F-05 项目成员管理、F-13 功能档案、F-14 功能级任务、F-16 任务状态闭环、F-17 独立草稿、F-18 记录发布、搜索边界、F-27 项目动态专属路径与 F-28 通知状态联动已覆盖，其余完整关键路径待覆盖）；`deploy/compose.yaml`（§11.2 稳态拓扑预检，环境变量按当前代码实际名称）与镜像 ref 预检已落库，`pnpm check:deploy:test` 使用合成 ref 正例校验 compose 渲染、exact-tag@sha256 格式、PostgreSQL 18 命名卷挂载、非 root/只读/资源限制/健康检查/端口等结构，CI 另用 `.env.deploy.example` 验证占位符被拒绝；生产 Dockerfile（API/Migration/Web/DB-bootstrap）与基础镜像 digest 已按 [ADR-017](./docs/adr/ADR-017.md) 定案，§12.4 的容器镜像构建与 Trivy 镜像扫描已纳入 CI / workspace；真实镜像 Tag/digest 绑定与签名发布清单仍在发布环节由人工完成。`CI / workspace` 在同一 ref 上取消被新推送取代的在运行流水线（`main` 上的运行不取消）（曾试把 `apps/api` 的 `test:unit` 改为并行执行单元测试文件，CI 实测反而略慢：`apps/api test:unit` Duration 由 35.99s 变为 40.14s，原因是该套件在 4 vCPU runner 上受模块导入与 worker 启动开销支配，已回退为原串行方式）；这些只改变耗时，不改变 §12.4 的门禁顺序与判定。2026-09-10 用 `gh run view` 读到单次运行约 16 分钟，其中 `pnpm install --frozen-lockfile` 仅约 13 秒，因此没有为 pnpm store 引入缓存步骤；当前主要耗时项是 Browser E2E、生产镜像构建与 Trivy 扫描。CI 另为 Playwright 的 Chromium 增加 `actions/cache` 步骤缓存 `~/.cache/ms-playwright`（action 固定到 `v5.1.0` 的提交，键绑定 `pnpm-lock.yaml`），因为实测 Install Playwright browser 在 25s~116s 之间波动；Trivy 漏洞库已由 `trivy-action` 自带缓存，未再重复配置。生产镜像的 builder 改为先复制依赖清单（根 manifest、各 workspace 包 `package.json`、lockfile、`.npmrc`）再执行 `pnpm install --frozen-lockfile`，之后才 `COPY . .`，使依赖层不随源码失效；镜像构建改用 container driver 的 buildx 并带 `type=gha` 层缓存（各镜像独立 cache scope 与 `ignore-error=true`），对应 CI 的 Set up Docker Buildx with GHA layer cache 步骤；新增 workspace 包必须同步 `deploy/docker/{api,migration,web}.Dockerfile` 的依赖清单，否则 `--frozen-lockfile` 会因 lockfile 与 manifests 不一致而失败。固定 digest 的基础镜像不会因 Debian 安全更新自动重建，上游集中公布安全公告后 Trivy 镜像扫描会转红（2026-09-13 API 镜像报出 `libpcre2-8-0` 的 2 个 HIGH）：五个生产 Dockerfile 因此在 runtime 阶段刷新 Debian 安全包并 `apt-get clean && rm -rf /var/lib/apt/lists/*`——api/migration/ops 只带 Node、没有需要按版本确认的服务器二进制，用 `apt-get upgrade -y`；web 要让 nginx 停在 1.30.x、db-bootstrap 的 PGDG 源会让整体 upgrade 带走 PostgreSQL 18.6 基线，二者只用点名 `apt-get install -y --only-upgrade` 且两套套件的包名不同（bookworm 只有 `libpcre2-8-0`，trixie 需 8 个包名，写错会 `E: Unable to locate package` 并 fail 构建）。设计一致性仍需人工检查，不得伪称已运行不存在或未执行的门禁。
- 2026-09-09 依赖审计复核与修复（覆盖上文 2026-09-08 “已验证无漏洞”的过时结论）：使用公共 registry 执行 `pnpm audit --audit-level=high` 时，当前基线经 `apps__api > @nestjs/core > @nestjs/platform-express > multer` 暴露 3 个 high（GHSA-wc9g-mqfw-jrwm、GHSA-qfvm-cv95-jqjf、GHSA-535w-7cp7-47q4），修复版本为 `multer >=2.3.0`；A 的独立 PR #56 已先合入 `multer: "^2.3.0"` override，C 的独立 PR #57 进一步收紧为精确版本 `multer: "2.3.0"` 并同步 lockfile，公共 registry 审计已返回无漏洞，`deps:audit` 不再被 multer 阻断；依赖变更按第 4 节经独立 PR 与人工确认，不得夹带。
- 阶段 0 搜索 PoC 已落库：PostgreSQL 18.6 探针镜像已完成 PGroonga 构建、扩展安装、迁移、15 组 V1 语义探针、90 条金标、跨项目隔离、`EXPLAIN (ANALYZE, BUFFERS)` 默认计划、`0000-0002 -> 0003-0005` 由 migration runner 升级/逐迁移事务内回滚和排除 Session 数据的逻辑恢复验证；旧 `pg_trgm` GIN 索引由 `0004` 删除、`pg_trgm` 扩展由 `0005` 在 contract 确认后删除；`search_projection` PGroonga bootstrap 与 `0003-0005` 显式迁移已通过真实 PostgreSQL 集成测试，`app_runtime` 使用未转义 `&~` 被拒绝；SearchQueryService 服务层与 `ProjectAccessQueryPort` 契约草案已落地，真实 PostgreSQL 权限过滤/参数化查询测试已通过；生产 `ProjectAccessQueryPort` 适配器与通用 `SessionAuthService` 已落库；`GET /api/v1/search` 契约纵切片（Schema、Route Registry、OpenAPI、生成客户端与最小 Controller）和服务端签名游标已落库，A 已正式确认 C-006；真实 HTTP API 集成测试已由本地 PostgreSQL 验证通过（2 个搜索文件 16 例、API 集成 14 个文件 60 例）；`SearchProjectionWritePort` 已实现独立 `SearchProjectionModule`、显式 `TransactionContext` 的 PostgreSQL upsert、输入校验、文本规范化与 `source_row_version` 防旧写，模块注入单测与真实 PostgreSQL 4 例已本地通过；搜索页面最小纵切片已本地落库并通过前端单测（10 文件 24 例），搜索边界 Playwright E2E 已本地 13/13，生产加密备份恢复仍待交付；`pnpm db:poc:search:local` 保留为原 `pg_trgm` GIN 默认计划未通过的证据并会非零退出。
- 阶段 0 F-27/F-28 纵切片已本地落库：新增活动/通知公共写端口与显式事务 PostgreSQL 适配器、项目动态读取（服务端 `AuthorizedProjectScope` + 白名单投影）、通知列表/未读数/单条已读未读/全部已读、签名游标、CSRF 与幂等重放；Schema、Route Registry、权限矩阵、OpenAPI、生成客户端和前端活动/通知页面已同步；现有 API 单测 39 文件 180 例、真实 PostgreSQL 集成 22 文件 89 例、前端 20 文件 48 例、全 workspace typecheck/build、契约/权限/依赖边界/Secret/文档门禁均本地通过，`pnpm check` 仅因本地 npm 镜像无 audit endpoint 失败，公共 registry 审计无漏洞；GitHub Actions 尚未执行；F-04 项目创建 Workflow 已调用活动、通知与搜索投影写端口并生成对应事件，但任务完成、记录作废/恢复、合并等 Workflow 尚未调用活动/通知写端口，未声明这些业务事件在生产侧生成。
- 阶段 0 F-31 Playwright 浏览器测试基座已本地落库：新增 `apps/e2e`（Playwright webServer 启动 API/Vite、global setup/teardown、真实 UI 登录辅助、API 启动探针/匿名保护页/全局搜索/站内通知/API Session/项目创建关键路径 6 个用例）、根级 `pnpm test:e2e`、Vite 代理与 CI / workspace 步骤；CI 步骤按 §12.4 位于 `pnpm build` 与 `pnpm check:deps` 之间；本地 6/6 通过，项目创建关键路径（登录 → 创建项目 → 项目动态 → 搜索 → 站内通知）已覆盖，其余完整业务关键路径仍未覆盖，Playwright 新增强需非作者人工评审。
- 阶段 0 F-04 项目创建前端纵切片已本地落库：`/projects` 改为登录保护，以 Ant Design、React Hook Form + Zod 实现项目创建表单，所有 API 调用均经生成客户端，先签发 CSRF Token 再携带 `x-csrf-token` 与 `Idempotency-Key` 调用 `createProject`；处理 401、403、409、422、429；创建后可直接打开项目动态并跳转全局搜索，完成登录 → 创建项目 → 项目动态 → 搜索 → 站内通知真实 UI 关键路径。修复 `ProjectBootstrapController` 将浏览器完整请求头误判为 422 的问题，并补充审计 keyring 的临时测试路径防线与项目创建控制器单元测试；API 单测 39 文件 180 例、真实 PostgreSQL 集成 22 文件 89 例、前端单测 20 文件 48 例、Playwright 6/6 通过，lint、typecheck、build、格式、契约/权限/依赖边界/Secret/文档/部署预检均本地通过；本地镜像下 `pnpm deps:audit` 与整体 `pnpm check` 因缺少 audit endpoint 在审计步骤失败，改用公共 registry `pnpm audit --registry=https://registry.npmjs.org` 返回无已知漏洞，其余门禁均通过；GitHub Actions 尚未执行。
- 阶段 0 F-01/F-08/F-11 缺口已本地落库：F-01 增加 Session 分批清理（单事务 `FOR UPDATE SKIP LOCKED`、过期/绝对过期/已消费三类数据与可配置批大小）；F-08 增加审计 HMAC 惰性轮换（keyring 当前版本驱动、先写 `AUDIT_KEY_ROTATED` 再写业务事件）和同事务回滚测试；F-11 按 [ADR-029](./docs/adr/ADR-029.md) 落库 `@Operation`、Contract 请求装饰器、全局响应 Serializer、统一异常 Filter 与同源 Guard。`pnpm check` 全绿，真实 PostgreSQL API 集成 28 文件 124 例、数据库集成 13 例、Playwright 8/8 通过；GitHub Actions 尚未就本轮 PR 执行。
- 阶段 0 用户目录与设计师最新视觉迁移已本地落库：新增 `GET /api/v1/users`（Schema、Route Registry、OpenAPI、生成客户端、Controller/Service/Repository），只返回 ACTIVE 且未停用用户的 `id/name/avatarUrl/isAdmin`，最多 300 条并响应 `no-store`；创建项目表单可在此目录中选择其他初始成员，前端去重排序、排除创建者并生成 `memberIds`；公共应用壳按最新设计师 token、深色侧栏、白色顶栏与面包屑迁移，项目页与创建弹窗同步新视觉；API 单测 39 文件 180 例、真实 PostgreSQL 集成 22 文件 89 例、前端 20 文件 48 例、Playwright 6/6 通过，lint/typecheck/build/契约/权限/依赖边界/Secret/文档/部署预检均本地通过，GitHub Actions 尚未执行。
- 阶段 0 全局命令面板、通知弹层与活动页设计师最新视觉迁移已本地落库：新增 `features/command-palette`、`features/activity-center`、`features/common/components/InpulseIcon` 与 `pages/activity-center`、`pages/issues`；命令面板支持 Ctrl/Cmd+K、类型分组、方向键/Enter/Esc 与生成客户端搜索；通知铃铛改为弹层，支持未读数量、最近通知、全部已读与点击目标直达；活动页拆为项目选择入口与项目动态详情，公共壳改用联合品牌图片；项目创建通知 `targetPath` 修正为 `/projects/{projectId}/activity`；API 单测 39 文件 180 例、真实 PostgreSQL API 集成 22 文件 89 例（含项目创建 4 例）、前端单测 23 文件 52 例、Playwright 7/7 通过，lint/typecheck/build/格式/契约/权限/依赖边界/Secret/文档/部署预检均本地通过，GitHub Actions 尚未执行。
- 阶段 0 依赖漏洞修复：`deps:audit` 另曾因 `multer@2.2.0` 的 3 个 high（GHSA-wc9g-mqfw-jrwm、GHSA-qfvm-cv95-jqjf、GHSA-535w-7cp7-47q4）失败；A #56 已通过 `pnpm-workspace.yaml` 的 `multer: "^2.3.0"` override 合入主线后，本 PR #57 再将版本收紧为精确 `2.3.0`（`pnpm-lock.yaml` 同步更新）；`pnpm audit --registry=https://registry.npmjs.org --audit-level=high` 已由公共 registry 验证返回 `No known vulnerabilities found`。该变更为 `@nestjs/platform-express@11.2.3` 的传递依赖，仍须按第 4 节作为独立依赖修复 PR 由人工确认，不得调低 `--audit-level`、添加 allowlist 或删除门禁。
- 阶段 0 前端 MFA 与管理员重认证交互已本地落库：登录页支持 TOTP 注册、验证与恢复码并在成功后轮换 CSRF Token；管理员账户菜单提供“管理员安全验证”弹窗，输入管理员密码和当前 TOTP 完成 5 分钟双因子重认证；所有前端调用经生成客户端并统一映射 401/403/409/422/429；新增前端单测（Web 25 文件 63 例）与 Playwright MFA 真实 UI 用例，E2E 总 8/8、API 单测 47 文件 224 例、真实 PostgreSQL 集成 22 文件 89 例均本地通过；lint、typecheck、build、格式、依赖边界、Secret 与文档检查通过；[PR #63](https://github.com/256-code/InPulse/pull/63) 的 GitHub Actions 已通过（workspace 10m2s，docs 通过）。
- 阶段 0 F-26 搜索边界 Playwright E2E 已本地落库：`search.spec.ts` 由 1 个正向用例扩为 5 个，覆盖无权限项目不返回、无匹配空态、签名游标 20→25 条加载更多、中文短词与特殊标识符；`global-setup` 创建无当前用户成员关系的隐藏项目、25 条分页投影与语义 fixture，`global-teardown` 同步清理；本地 E2E 13/13、`apps/e2e` typecheck 与 API build 通过；PR #68 GitHub Actions 已通过（workspace 10m14s，docs 通过）。
- 阶段 0 F-27/F-28 项目动态与通知状态 Playwright E2E 已本地落库：新增 `activity.spec.ts`，覆盖创建项目后进入专属动态页并看到 `project.create` 条目；`notifications.spec.ts` 扩为已读 ↔ 未读切换、全部已读与铃铛未读计数联动；抽取 `createProjectViaUi` 供动态/通知场景复用。本分支已 rebase 到 `origin/main` `1c2b5bf`；本地完整 `pnpm test:e2e` 16/16（含搜索边界与 F-13 功能档案），`pnpm build`、`apps/e2e` typecheck、`pnpm format:check`、`pnpm check:docs` 与 `git diff --check` 通过；PR #67 首次 CI 已通过（workspace 9m58s，docs 通过），rebase 后 GitHub Actions 已通过（workspace 11m7s，docs 通过，run 34334259877/34334259709）；本次 rebase 后仅文档同步，未等待新 CI。
- 阶段 1 F-03 用户管理（A）已本地落库：新增 `GET/POST /api/v1/admin/users`、`PATCH /api/v1/admin/users/{userId}`、`POST .../disable|enable|force-logout` 六条契约，管理列表、新增、编辑、启停、启用与强制退出；列表仅管理员；写操作要求 5 分钟密码 + 当前 TOTP 重认证、CSRF 与幂等键，版本化操作另带 `If-Match`；停用/强退同事务递增 `auth_version`、撤销 Session 并写审计；禁止自停用/自降级/自强退并保护最后一名可用 MFA 管理员；前端 `/settings` 改为管理员路由并用生成客户端完成全部交互；已合并 `origin/main` `8386b29`（含 F-13 与 F-27/F-28 E2E）并重新生成契约；本地验证：API 单测 55 文件 256 例、真实 PostgreSQL 集成 31 文件 152 例、前端 30 文件 87 例、契约 6 文件 63 例、数据库 5 例、Playwright 18/18，lint/typecheck/build/格式/契约 41 条路由/权限/依赖边界/Secret/59 个 Markdown/6 个迁移/部署预检/公共 registry 审计通过；GitHub Actions 尚未执行，最终 CI 与推送记录见开发日志。
- 阶段 1 F-23 任务合并（C）已本地落库：新增唯一路由 `POST /api/v1/task-groups/merge`（`mergeTaskGroup`，Session + CSRF + 数据库幂等，契约版本 1.0.0，锁序 project -> module -> feature -> task -> taskGroup，审计动作 `task.merge`）与 `TaskGroupsModule`；服务端按请求体任务 ID 解析归属项目，项目/模块/影响功能 `FOR SHARE` 后按任务 ID 升序 `FOR UPDATE` 并锁后重读，SAVEPOINT 有限重试；来源已属活跃聚合组、组内主任务变化或组已关闭 409，跨项目与非成员统一 404，归档父级 409；合并只写 `task_groups`/`task_group_members` 关系与来源快照（原工作状态、原负责人），不改任何任务字段，审计、活动、通知与搜索投影同事务；重放前重新验证当前认证、CSRF、项目可写、聚合组 ACTIVE 与全部结果任务可读；`TaskQueryPort` 新增 `findByTaskId`、`ProjectCodePort` 新增聚合组编号，`TaskDraftSource` 统一为 `TaskReadModel`；无新迁移。本地验证：API 集成全量 37 文件 232/232（F-23 文件 6/6）、API 单测 61 文件 291/291、契约 10 文件 75/75、前端 35 文件 120 例、`lint`/`format:check`/`typecheck`/`build`/`contract:drift`/`contract:validate`（73 条）/`permissions:check`（73/73）/`check:deps`/`check:frontend:boundaries`/`check:secrets`/`check:deploy:test`/`db:migrations:check` 与公共 registry 审计通过；`pnpm test:e2e` 未运行（无前端改动），GitHub Actions 未执行。详见 [F-23 交审说明](./docs/f23-local-handoff.md)。
- 阶段 0 F-09 逐响应 nonce CSP 与安全响应头纵切片已本地落库：Vite 构建期在入口 HTML 的 script/style/modulepreload 标签与 `csp-nonce` bootstrap meta 写入 `__INPULSE_CSP_NONCE__` 占位符，生产 Nginx 用每请求 16 随机字节的 `$request_id` 经 `sub_filter` 逐响应替换，CSP 头与 HTML 同值且 script-src/style-src 均无 `unsafe-inline`；HSTS/nosniff/X-Frame-Options/Referrer-Policy/Permissions-Policy 收敛到 `deploy/docker/nginx-security-headers.conf` 并由每个声明 `add_header` 的 location 显式 include；入口与 SPA 回退 `no-store` 并关闭条件请求与 ETag（避免 304 复用旧 nonce），哈希资源保持 `immutable`；`AppProviders` 改读 `meta.nonce` IDL 属性以适配生产构建；Playwright Web 服务改为 `vite build && vite preview`，`INPULSE_WEB_CSP` 非法值 fail closed 到 enforce。本地验证：web 单测 37 文件 136 例、`apps/e2e/tests/csp.spec.ts` 2/2、新增 `scripts/check-web-image-csp.sh` 在真实镜像与真实 Nginx 上 7 组断言通过、API 单测 61 文件 291 例、真实 PostgreSQL 集成 37 文件 232 例、`pnpm check` 全绿，CI 已在生产 Web 镜像构建后新增同脚本步骤；全量 `pnpm test:e2e` 最近一次 19 passed / 8 failed 均为本机既有失败或波动（`E2E_WEB_CSP=off` 对照仍失败），GitHub Actions 尚未执行。F-09 当时剩余的三项（SEC-004/SEC-006/SEC-007）已由后续切片交付，见下条；Markdown 白名单仍未交付。
- 阶段 0 F-09 数据安全专项其余三项（SEC-004/SEC-006/SEC-007）已本地落库：SEC-006 的未匹配路由由全局 `ApiExceptionFilter` 统一为固定文案 JSON 404（含前缀外与根路径，不回显 method/path 或框架文案，`X-Request-Id` 与 body 一致，已匹配路由不受影响），按 [ADR-026](./docs/adr/ADR-026.md) 直接修正异常过滤器、不引入 adapter 包装，回归用例 `apps/api/test/http-error-contract.integration.test.ts` 3 例；SEC-007 把 Secret 文件权限判定抽成 `database/src/config.ts` 的 `isPrivateOwnerReadableFile`，权限矩阵、生产路径越界（相对路径/`..`/嵌套/根目录本身）、缺失变量不回退与直连连接串在生产被拒、空内容拒绝共 15 例单测覆盖，真实 POSIX 权限位需 Linux 环境、Windows 本机不可复现，部署侧仍由 `check:deploy` 校验 compose secret 声明的 mode 0400/直接子项/uid-gid；SEC-004 按 [ADR-022](./docs/adr/ADR-022.md) 用标准 URL Parser 实现 `apps/api/src/modules/external-links/github-url.ts`（拒绝 http/ftp、用户信息、非默认端口、`api.github.com`、混淆域名与编码伪段，query 白名单化，识别 ISSUE/PULL_REQUEST/COMMIT，不发远程请求；16 例单测）并以 `database/test/integration/external-links.test.ts` 7 例锁定数据库防线（规范化 URL 同项目唯一与并发去重、非 https/混淆域名/带 fragment 被 CHECK 拒绝、跨项目与错配关联被复合外键拒绝、`normalized_url` 不可变）。本地 `pnpm check` 全绿（web 39 文件 140 例、api 单测 63 文件 309 例、真实 PostgreSQL 集成 database 2 文件 20 例与 api 40 文件 255 例、契约 77 例、权限矩阵 79/79、依赖边界 457 文件、Secret 704 文件、文档 61 文件、公共 registry 审计无已知漏洞）；未运行 `pnpm test:e2e`（无前端与路由行为变更）、GitHub Actions 与镜像扫描。仍未交付：Markdown 白名单（前端当前没有 Markdown 渲染落点，新增生产依赖必须独立 PR 并由人工确认）与外部链接的 HTTP 关联接口（属 F-14 业务纵切片）。
- 阶段 1 F-24 解除合并（C）已本地落库：新增唯一路由 `POST /api/v1/task-groups/unmerge`（`unmergeTaskGroup`，Session + CSRF + 数据库幂等，契约版本 1.0.0，锁序 project -> module -> feature -> task -> taskGroup，`versionPolicy: none` 以任务/聚合组行锁与 SAVEPOINT 有限重试实现等价并发控制，审计动作 `task.unmerge`）；请求只携带 `sourceTaskId` 与可空 `unmergeReason`（≤10000，空白回落固定文案），服务端在锁内仅允许解除活跃 SOURCE，把成员关系标记 `DETACHED`（时间 + 原因），最后一个来源解除时同事务关闭聚合组并解除 MAIN；任务工作状态、负责人、迭代记录与行版本不变；审计、活动、通知（去重接收人、深链来源任务）与搜索投影同事务；重放前重新验证当前认证、CSRF、项目可写、聚合组可读与全部结果任务可读（组可为 CLOSED）；响应 `TaskGroupUnmergeResponse` 含关闭状态与解除成员快照；无新迁移。本地验证：解除集成 8/8、`task-group` 2 文件 14/14、集成全量 40 文件 260 例（两轮各 1 例既有偶发失败，单文件复跑通过）、API 单测 63 文件 303/303、契约 12 文件 84/84、前端 37 文件 124 例（2 例既有计时敏感用例单跑通过）、`lint`/`format:check`/`typecheck`/`build`/`contract:drift`/`contract:validate`（81 条）/`permissions:check`（81/81）/`check:deps`/`check:frontend:boundaries`/`check:secrets`/`check:deploy:test`/`db:migrations:check` 与公共 registry 审计通过；`pnpm test:e2e` 未运行（无前端改动）。已两次 rebase（`c7c6881`：F-19 PR #85 之后；`14ce2ef`：F-09 加固 PR #86 之后）并强制推送；`c7c6881` 基线上 PR #87 的 GitHub Actions 已通过（workspace 12m4s，docs 通过），`14ce2ef` 基线本轮 CI 通过后同步到开发日志。详见 [F-24 交审说明](./docs/f24-local-handoff.md)。
- 阶段 1 F-32 任务中心与 F-29 项目概览前端骨架已本地落库（C）：`/tasks` 改为登录保护，页面以注入式 mock adapter 承载统计卡片、视图标签、高级筛选面板与任务明细，筛选状态按 F-30 由 URL 承载（scope/project/status/priority/level/relation/record/github/canceled/q/view/more，默认值省略、非法值回退、非管理员强制 mine）；`/projects/:projectId/overview` 按设计师稿还原项目详情头部、6 项指标条、最近迭代与待处理遗留问题面板，项目名/状态/成员数走 A 已有项目端口（2026-09-14 按用户确认改为 4 张指标小卡：未完成任务/迭代记录/成员/遗留问题，活跃模块与活跃功能从展示层取消、R-2 服务端口径不变，见测试矩阵 F-29 条目）；2026-09-14 按产品截图反馈删除任务中心只读详情弹层 `MyTaskDetailModal`：卡片与列表行点击改经 `onOpenTask`（`TasksPage` → `taskDetailPath`）直达功能档案 `?taskId=` 深链，写操作（编辑/状态推进/生成迭代记录/合并/关联链接）只在功能档案任务详情弹窗提供，任务中心不再复制入口，见测试矩阵「F-32 任务中心点击卡片直达功能档案」条目；2026-09-10 已按设计师最新稿逐页截图对比并迁移对齐（项目概览头部改纵向结构、指标条改 4 列网格、任务卡片顶部徽章与页脚优先级全称；设计师稿中任务中心的「任务聚合组」区块与项目概览的项目内导航/模块区块未迁移，分别属 F-25 与模块读端口依赖）；F-25/F-29/F-32 路由未由 A 冻结，按 `docs/c-port-extension-proposal.md` §7.5 不登记 Route Registry、不新增契约；前端单测 48 文件 195 例、typecheck/build/格式/lint/依赖边界通过，GitHub Actions 尚未执行；F-29 入口链接、F-32 补充字段（priority/dueAt/completedAt/description/creatorId）与 F-29 统计口径等待 A 裁定；该批前端改动已于 2026-09-14 随分支 `agents/fix-main-page-functionality` 首次推送（`pnpm test:web` 73 文件 399 例、typecheck/build/lint/format:check/check:docs/依赖边界与定向 Playwright 通过，GitHub Actions 尚未执行），仍需非作者人工评审。
- 阶段 0 F-09/SEC-004 外部链接数据库防线补齐（B，`codex/f22-external-links-fk-tests`）：`database/test/integration/external-links.test.ts` 由 7 例扩为 13 例，把复合外键覆盖从任务级扩到任务/功能/记录/项目四类类型化关联——跨项目串联、行内 `project_id` 与实体或链接归属错配均被复合外键拒绝（23503），四类关联重复关联同一链接均 23505，原有规范化 URL 同项目唯一与并发去重、非 https/混淆域名/带 fragment 被 CHECK 拒绝、`normalized_url` 不可变保持不变；`docs/test-matrix.md` 的 F09-SEC004-DB-001 与 SEC-004 条目同步为 13 例与四类关联。本地验证：真实 PostgreSQL 18.6 + PGroonga 下 `pnpm db:test`（数据库单测 15/15、集成 2 文件 26/26，其中 `external-links.test.ts` 13/13）、`@inpulse/database` typecheck、目标文件 ESLint 与 Prettier 检查、`pnpm check:docs`（72 个 Markdown 文件）通过；未提交、未推送，GitHub Actions 与其余门禁待 PR 执行。
- 阶段 0 F-08 步骤 4 原始审计读取留痕（A）已本地落库：新增唯一路由 `GET /api/v1/audit-logs`（`getAuditLogs`，完整管理员 Session + 5 分钟双时间戳重认证；只读，不要求 CSRF 或幂等键），Schema、Route Registry、权限矩阵、OpenAPI 与生成客户端同步（95 条路由）；查询走独立只读 `audit_reader` 连接（`AUDIT_DB_*` / `AUDIT_DATABASE_URL(_FILE)`，惰性建池、配置缺失即首次读取 fail closed；`deploy/compose.yaml` 新增 `db_audit_reader_password` secret 并启用 `AUDIT_DB_USER`），返回前在同一请求内用业务侧独立 `UnitOfWork` 向 SYSTEM 链追加 `AUDIT_LOG_READ`（filters/returnedCount/hasMore 与请求元数据，不含审计正文），留痕失败整体失败；游标为绑定操作者与查询指纹的 15 分钟 HMAC 签名；`AuditLogReadModule` 随 `authModules` 条件挂载，未配置 Session keyring 时健康探针仍可启动。新增 `apps/api/test/audit-logs.integration.test.ts` 7 例；本地 API 单测 66 文件 343 例、集成 48 文件 415 例、lint/typecheck/格式/契约 95 路由/权限 95/95/依赖边界/Secret/文档/部署预检与公共 registry 审计均通过；GitHub Actions 尚未执行。远端 WORM 归档与加密明细导出（F-08 步骤 6）仍未交付。
- 阶段 0 演示数据库已作为版本化种子落库：`database/seed/demo-data.sql` 是真实演示环境导出的业务数据快照（27 张业务表，含项目审计链），由 `scripts/export-demo-seed.mjs` 生成、`apps/api/scripts/seed-demo-data.mjs` 载入，根级入口为 `pnpm db:seed:demo`（载入，已有数据时需 `-- --force`）与 `pnpm db:seed:check`（生成物漂移检查，已插入 `pnpm check` 链）。导出只含业务数据：口令哈希在种子中是固定占位值、由载入脚本用 `@node-rs/argon2` 统一重置为演示口令并回读校验；登录会话、CSRF 材料、幂等记录、限流桶、MFA 恢复码与 TOTP 因子等运行痕迹既不导出也在载入时清空；审计链里的测试痕迹行在导出时按前缀剔除。载入前置条件是空库已执行 `bootstrap/000_roles.sql`、`bootstrap/020_pgroonga.sql` 与 `pnpm db:migrate`。本地验证（2026-09-13）：在新建库上按该顺序迁移 10 条后载入种子成功，逐表 `md5(string_agg(to_jsonb(t)::text))` 比对与演示库 26/27 表完全一致（仅 `users` 因口令占位重置与 `row_version` 递增不同，去掉口令列后一致），并对该库启动真实 API 跑通登录与 22 条读路径（账号/项目/概览/模块/功能点/任务/聚合组/遗留问题/迭代记录/动态/通知/搜索/用户目录）。种子文件只进版本库，不进入迁移历史、不改任何表结构。同批附带修复两处会阻断 `CI / workspace` 集成测试步骤的断言：`database/test/integration/database.test.ts` 的迁移不可变清单补齐 `0009_tasks_creator_index.sql`；`apps/api/test/aggregate-read-ports.integration.test.ts` 的「记录维度计数命中 `change_records` 索引」断言由只接受 `Index Scan using change_records_` 放宽为同时接受 `Bitmap Index Scan on change_records_`（同一 SQL、同一索引集下 Windows 本机与 Linux CI 规划器各选一种访问方式，节点文本分别为 `using` 与 `on`），`Seq Scan` 与 `actual time` 断言强度不变。该例的定位方式是用 `node:24.20.0-bookworm` 容器 + PGroonga 探针镜像复刻 CI 环境（因为 CI job logs 需要登录态而本机 `gh` 未登录），复现 exit 1 后修复，同一容器全量 51 文件 447 例全绿。
- 阶段 1 裁决修订 D-2「遗留问题转任务标签」已本地落库（C，未提交）：R-3 `MyTaskItem` 与 R-5 `TaskGroupMembershipItem` 增加 `hasLeftoverSource`（按 `leftover_task_links` 存在链接行判定，与来源记录当前状态无关，见 [A 的契约评审裁决](./docs/a-contract-review-f25-f29-f32.md) §12）；记录侧 `ChangeRecordReadPort.listLeftoverSourceTaskIds` 只读映射供 R-3 / R-5 同一只读事务消费；任务中心卡片/列表行与功能档案任务卡片/列表/详情弹窗显示「遗留问题」徽章（R-5 仍为页面级一次批量，读取失败降级隐藏）；契约、Route Registry summary、Schema Registry 描述、权限矩阵、OpenAPI 与生成客户端同一批再生成（105 条路由、5 产物漂移通过）。本地验证：API 单测 64 文件 351 例、Web 77 文件 455 例、契约 98 例、真库集成（aggregate-read-api / aggregate-read-ports / aggregate-read-list-api）3 文件 50 例、全 workspace typecheck、eslint/prettier（改动文件）、`check:frontend:boundaries`（251 模块）、`permissions:check`（105/105）通过；未跑全量 `test:integration` / `test:e2e` / `pnpm check` 整链，GitHub Actions 未执行；详见 [测试矩阵](./docs/test-matrix.md) D-2 章节。
- 阶段 1 任务看板（R-8）遗留问题徽章与优先级排序已本地落库（C，2026-09-21，`test`，未提交未推送）：看板卡片顶部标记组与列表行标题前显示「遗留问题」徽章（复用 R-5 `listTaskGroupMemberships` 页面级一次批量 `hasLeftoverSource`，读取失败按缺席隐藏，与任务中心/功能档案同文案同色调，遵循裁决修订 D-2；不改契约、路由与迁移）；`TaskQueryPort.listForBoard` 的未完成桶内排序改为先按优先级 紧急 → 高 → 普通 → 低、再按截止时间升序（NULL 最后），已完成仍按完成时间倒序、已取消不变，[ADR-037](./docs/adr/ADR-037.md) §3 的「看板口径不变」条目已加 2026-09-21 修订行。本地验证：Web 看板单测 4 文件 38 例、真实 PostgreSQL 看板端口集成 6 例（含优先级压过截止时间的反事实夹具）、全 workspace typecheck、lint、`format:check`、`check:frontend:boundaries`（280 模块）、`check:docs`（84 个 Markdown）、Web 生产构建通过；真实浏览器复验（项目 1 看板与列表视图）：T-58 卡片显示带提示的「遗留问题」徽章、列表行标题前同徽章、泳道顺序 高 → 高 → 普通 → 已完成（完成时间倒序）与底部图例一致；测试夹具已按 2026-09-17 指示清理（`user_` 前缀 8 账号、8 项目、2456 业务行，复核残留 0）。未运行：整链 `pnpm check`、Playwright E2E（本批未扩展）、API/数据库全量集成、GitHub Actions。
- 阶段 0 仍待建立的入口：其余业务关键路径 E2E、生产容器镜像构建、exact-tag/digest 格式校验（Compose 渲染与 ref 预检已落库为 `pnpm check:deploy` 与 CI 门禁）、镜像扫描，以及生产加密备份恢复。统一的根级安装、lint、格式、类型检查、单元测试、集成测试、生成物漂移检查、构建入口与 compose/ref 预检已落库；其余入口只有实际脚本落库后才能把命令写成可执行说明。
- 测试数据清理约定（2026-09-22 用户指示，长期有效）：本地/共享开发库上的集成测试、Playwright E2E 或手工冒烟产生的测试用户（`user_` 前缀登录名）、其创建的测试项目（`Project P` 前缀）及全部关联数据，跑完必须立即清理；统一入口 `node scripts/purge-test-data.mjs`（默认先 `pg_dump` 备份到容器 `/tmp`，再在一个事务内按外键顺序删除并校验剩余真实数据；`--dry-run` 预演、`--no-backup` 跳过备份）。脚本保护 SYSTEM 审计链与真实项目数据，必要时临时禁用后恢复 `modules_protect_unclassified` 触发器，不进 CI、不改数据库结构。2026-09-22 首次清理记录：删除 62 测试用户、26 测试项目、共 602 行关联数据（含 28 模块、17 功能、13 任务、43 成员关系、17 审计、61 会话），清理后 6 个真实用户 / 3 个真实项目、4 条审计链哈希校验全部通过。

## 9. 文档与变更同步

- README 只说明项目目的、当前状态、快速上手入口和文档导航；详细开发流程放在 `CONTRIBUTING.md`，代理执行规则放在本文件。
- 改变架构、API、权限、事务、数据库、部署或运维行为时，必须同步相关 ADR、三份设计文档、权限矩阵、测试矩阵和 Runbook。
- 不允许只改代码而让设计文档失真，也不允许只改生成物而不改其源定义。
- 仓库内链接使用相对路径；新增或重命名文档后检查引用是否有效。

## 10. Git 与 Pull Request

- Git 细则以 [CONTRIBUTING.md](./CONTRIBUTING.md) 为准。
- `main` 是唯一可发布主线；`dev/a`、`dev/b`、`dev/c` 是三个岗位的长期工作分支，不得直接合并到 `main`。
- 只允许向自己的 `dev/<role>` 及其创建的交付短分支推送；禁止直接推送 `main` 或绕过 PR 合并。
- 使用短生命周期交付分支和小 PR；一个 PR 聚焦一个逻辑变更或业务纵切片，不得把未交付 WIP 混入 PR。交付分支合并删除后，把最新 `main` 同步回对应 `dev/<role>`。
- 每次向远端推送功能分支或创建/更新 PR 前，必须更新 [开发日志](./开发日志.md)，记录做了什么、功能、修复/重构或优化、实际验证结果、文档同步、风险与后续事项；不得编造测试或 CI 结果。
- 进入 `main` 的最终 squash commit 与 PR 标题使用 Conventional Commits 格式。
- 合并前必须通过适用检查并完成人工审查；数据库迁移、鉴权、权限、Secrets、API 契约、Dockerfile、Compose 和 GitHub workflow 是重点审查项。
- 禁止向 `main` 强制推送、重写共享历史、删除受保护分支或移动已发布标签。
- `pnpm-lock.yaml`、数据库迁移、生成的 OpenAPI/客户端和必要测试 fixtures 应提交；本地环境、Secrets、数据库备份和构建产物不得提交。

## 11. Code Review Rules

代码审查优先查找以下问题：

- 跨项目数据泄露、IDOR、鉴权或 CSRF 放宽；
- 跨模块 Repository 访问、反向/循环依赖、绕过 Workflow 的跨域写；
- 一个业务命令出现多个事务、事务中使用全局数据库 Client 或执行网络请求；
- 幂等、锁序、乐观锁、409 映射或数据库约束缺失；
- 手工修改生成客户端/OpenAPI，或 API 变更未同步权限与测试；
- 历史迁移被重写、业务历史被物理删除、Secrets 或敏感数据进入日志/仓库；
- 只依赖 Mock 而未验证真实 PostgreSQL 行为；
- 测试被跳过、弱化，或文档/ADR 与行为漂移。

格式化和纯样式问题交给自动化工具；审查意见应说明具体风险、触发条件和安全修改方向。

## 12. Definition of Done

只有同时满足以下条件才能声明完成：

- 用户目标和验收条件已满足，且没有夹带无关重构；
- 新行为、失败路径和回归路径有适当测试；
- 所有适用验证已通过，未执行或失败的检查被明确报告；
- API、客户端、数据库迁移和 lockfile 等派生产物无漂移；
- ADR、设计、权限矩阵、测试矩阵和运行文档已按行为同步；
- diff 已人工检查，不包含 Secrets、调试输出、临时文件或未经批准的依赖；
- [开发日志](./开发日志.md)已按本 PR 实际推送、验证和交付内容更新；
- 交付说明列出修改内容、验证证据、剩余风险和后续事项。

## 13. 基线冻结剩余事项

截至 2026-09-07，本轮评审已将创建者成员关系、写接口幂等范围和审计并发阈值转为本文件第 6、8 节的可执行规则，并分别落入 [ADR-012](./docs/adr/ADR-012.md)、[ADR-019](./docs/adr/ADR-019.md)、[ADR-008](./docs/adr/ADR-008.md)及[测试矩阵](./docs/test-matrix.md)；一次性认证流程的受控幂等例外见 [ADR-023](./docs/adr/ADR-023.md)，记录作废后恢复的状态与历史不变量见 [ADR-024](./docs/adr/ADR-024.md)，V1 搜索采用 PGroonga 的基线与阶段 0 证据见 [ADR-025](./docs/adr/ADR-025.md) 与 [PGroonga V1 PoC 结果](./docs/poc/search-pgroonga-v1-result.md)，NestJS 版本基线的阶段 0 兼容性门禁已完成并按 [ADR-026](./docs/adr/ADR-026.md) 定案为 11.2.3（替代 [ADR-003](./docs/adr/ADR-003.md)，验证证据见 [NestJS PoC 结果](./docs/poc/nestjs-11-vs-12-v1-result.md)）。ADR 编号冲突已由[唯一 ADR 索引](./docs/adr/README.md)消除：以技术设计的 ADR-001～ADR-020 为主线，系统设计新增的 CSP 与 ExternalLinks 决策顺延为 ADR-021、ADR-022，后续决策继续顺序编号。设计文档必须只引用该索引，不再维护相互冲突的编号正文。

开发基线仍不能宣告冻结，直至以下资料和门禁完成：

- 管理员完成 `CONTRIBUTING.md` 所列目标仓库设置；若 GitHub 方案不支持相应保护能力，须记录限制和替代人工门禁；
- 阶段 0 的技术验证、实际版本锁定和其余 CI 门禁通过：截至 2026-09-07，技术设计 §12.4 中 frozen lockfile 安装、lint、format check、typecheck、unit tests、空库迁移、真实 PostgreSQL 集成测试（含数据库角色/权限探针）、OpenAPI/客户端漂移检查、Route Registry/权限/响应 Schema 完整性、web/api 生产构建、依赖边界检查、权限矩阵检查与依赖/Secret 扫描已落库并在 `.github/workflows/ci.yml` 的 `CI / workspace` job 中按序执行。非数据库门禁已在本地实测通过；空库迁移与真实 PostgreSQL 集成测试曾在 `0000-0002` 上本地实测通过，但合并 `0003-0005` 后迁移与 `database/scripts/test-local.ps1` 均要求已安装 PGroonga 的 PostgreSQL 18 实例；本机 PostgreSQL 18.6 已内置 PGroonga 4.0.8，因此 `db:test:local`（`000_roles.sql` + `020_pgroonga.sql` + `0000-0005` 全量迁移 + database 单元/集成测试）与 API `test:integration` 均已在本地实测通过，CI 的 PGroonga 探针镜像仍作为可复现隔离门禁保留；仍缺 Playwright 完整关键路径 E2E（测试基座已落库）、生产容器镜像构建、exact-tag/digest 格式校验、镜像扫描（`deploy/compose.yaml` 与 ref 预检 `pnpm check:deploy` 已落库、CI 已加 compose 渲染与占位符拒绝门禁，但生产 Dockerfile 与真实 digest 未定案，只有 PoC/CI 探针镜像 Dockerfile），以及 Drizzle 与 Nginx 实际补丁与镜像 digest 锁定；[ADR-027](./docs/adr/ADR-027.md) 已转为 `Accepted`（2026-09-07，见该文件接受记录）。
- 2026-09-08：C 在本地完成搜索页面最小纵切片并同步 README、测试矩阵、前端契约说明与本日志；前端 typecheck、单测（10 文件 24 例）、依赖边界、构建、迁移/契约/权限/Secret/文档检查通过；`pnpm check` 仅因当前 npm 镜像无 audit endpoint 失败，公共 registry 单独审计无漏洞；GitHub Actions 尚未执行，真实登录态尚未接入。
- 2026-09-08：C 在本地完成 `SearchProjectionWritePort`（独立 `SearchProjectionModule`、显式 `TransactionContext` upsert、输入校验、文本规范化与 `source_row_version` 防旧写）；API 单测与真实 PostgreSQL 集成、类型检查、契约、构建、依赖边界、权限、Secret 与文档检查通过；`pnpm check` 同样仅因本地 npm 镜像无 audit endpoint 而在 `deps:audit` 中断，公共 registry 单独审计无漏洞；GitHub Actions 尚未执行。
- 2026-09-08：C 在本地完成 F-27 项目动态与 F-28 站内通知读写纵切片；同步 README、权限矩阵、测试矩阵、前端契约说明、开发日志与 AGENTS 状态；API 单测、真实 PostgreSQL 集成、前端单测与构建、类型检查、契约/权限/依赖边界/Secret/文档门禁均通过，`pnpm check` 因本地 npm 镜像无 audit endpoint 失败但公共 registry 审计无漏洞；GitHub Actions 尚未执行，业务 Workflow 尚未接入活动/通知写端口。

- 阶段 1 F-25/F-29/F-32 契约裁决已本地落库（A）：新增 [A 的契约评审裁决](./docs/a-contract-review-f25-f29-f32.md)，裁决 C-003（已接受，转具体 Route）与 C-010（已接受，转具体 Route 后关闭）以及 C 提交的 Q-01 ~ Q-15；三条候选路由进入正式契约，并按 Q-02 新增记录子资源路由，共四条：`getTaskGroup`、`getProjectOverview`、`listMyTasks`、`listTaskGroupRecords`，路径、operationId、状态码与只读策略全部冻结；跨域读归属裁定为「B 域单条 SQL 稳定只读端口加 C 聚合读服务」，拒绝直读他域业务表（路线 III）与依赖环（路线 I）两条路线，路线 IV 留待后续；同步回填上游清单 §4.8.1 / §6 / §7 与两份 C 提案（聚合契约提案、端口扩展提案）。本轮为文档裁决：未改任何代码、迁移、契约源或生成物，未运行代码类门禁；四条路由尚未登记 Route Registry——登记、权限矩阵、测试矩阵、OpenAPI 与生成客户端必须与实现同一个 PR 落库（依赖 B 的只读端口扩展），在此之前仍不是实现依据；工作书 F-32 步骤 1 的处方偏差需非作者人工确认。

- 阶段 1 F-29/F-32 第二轮契约裁决已本地落库（A）：回应 B 在 PR #98 后反馈的契约缺口与 `TaskItem.groupRole`。裁决 [A 的契约评审裁决](./docs/a-contract-review-f25-f29-f32.md) §10 接受 R-2 `activeLeftoverTotal` 与 `LeftoverItemSummary.recordTitle`、R-3 列表项 `priority` / `dueAt` / `completedAt` / `creatorId` / `githubLinkCount` / `groupId` 与 `stats` / `leftoverCount` / `leftoverSample`、筛选参数 `priority` 与 `includeCanceled`；拒绝列表返回 `description`；延后 `scopeCounts`、`relation`、`query` 与 `scope=created/all`。`TaskItem.groupRole` 不在 B 的任务读写路由扩字段（会形成 TasksModule 与 TaskGroupsModule 依赖环），改为新增 C 侧只读路由 R-5 `GET /api/v1/task-groups/memberships`（`listTaskGroupMemberships`）。本轮只做裁决与台账同步：未改代码、迁移、契约源或生成物，未注册路由；实现必须与 A 的契约登记、权限矩阵、测试矩阵、OpenAPI 与生成客户端同一个 PR 落库，`priority` / `includeCanceled` 需补 `EXPLAIN` 证据。

- 备份调度生效时机已裁定（A，2026-09-11）：定时备份（宿主每 12 小时加密备份、排除 Session、SHA-256/签名清单、异机保留与失败告警）是生产上线门禁项，上线时才启用；上线前不部署、不运行定时备份任务，`deploy/compose.yaml` 的 `operations` profile 保持未发布。同时修正文档内备份频率不一致：技术设计 §1.3、系统设计部署表与技术设计 §10.4/§11.5/§12 统一为与 ADR-020 一致的至少每 12 小时，未改动 ADR-020 决策。本轮仅文档变更，未改代码、迁移、契约源或生成物。

- 阶段 0 F-10 备份调度配置与 Runbook 已本地落库（A）：新增 `deploy/backup/`（`backupctl.sh` 宿主控制器 + `inpulse-backup`/`inpulse-backup-alert@`/`inpulse-backup-watchdog` systemd 单元与定时器 + `backup.env.example` 非敏感配置示例）与 `docs/runbooks/backup-restore.md`、`docs/runbooks/upgrade-rollback.md`；启用流程要求 `--confirm-go-live` 与全新主机恢复演练证据（fail closed），`run` 以 `flock` 串行化并执行 `docker compose --profile operations run --rm backup`，staleness 默认 18 小时、每小时 watchdog，告警 Webhook 只从受限文件读取且不进进程参数与日志；`scripts/check_deploy_refs.mjs` 新增 9 项备份资产与调度不变量静态校验（12 小时/每小时节奏、`Persistent`、`flock`、go-live 门禁与 `enabled-at` 启用基线、`*_FILE` 凭据、禁止 `--profile operations up`、`backup`/`audit-archive` 必须 `profiles: [operations]`）；本地 `pnpm check:deploy:test` 退出码 0、`bash -n deploy/backup/backupctl.sh` 通过；未运行：真实主机 systemd 安装、真实告警投递、全新主机恢复演练与 GitHub Actions；`backup`/`audit-archive` 服务本体（F-10.3）与真实镜像 digest 签名发布清单仍未交付。

- 阶段 1 F-25/F-29/F-32 第二轮契约扩展与 R-5 已本地落库（A）：R-2 `getProjectOverview` 增加 `activeLeftoverTotal` 与 `LeftoverItemSummary.recordTitle`；R-3 `listMyTasks` 列表项增加 `priority` / `dueAt` / `completedAt` / `creatorId` / `githubLinkCount` / `groupId`，响应增加 `stats`（`myOpen` / `dueToday` / `overdue` / `completedThisMonth`，Asia/Shanghai 日/月界由服务端计算）/ `leftoverCount` / `leftoverSample`（200 字符截断），筛选增加 `priority` 与 `includeCanceled`（`TODO ∪ CANCELED`）；新增 R-5 `GET /api/v1/task-groups/memberships`（`listTaskGroupMemberships`，`taskIds` 逗号分隔 1..100 正整数、422 校验，只返回授权项目内 `ACTIVE` 组关系、不泄露存在性）。契约、Route Registry、权限矩阵、测试矩阵、OpenAPI、生成客户端与服务端实现同一 PR 落库；`pnpm contract:validate`（94 条）、`pnpm contract:drift`（5 产物）、`pnpm permissions:check`（94/94）、API 单测 66 文件 343 例、真实 PostgreSQL 集成 47 文件 407 例（聚合读 19/19）、Web 58 文件 248 例、全 workspace typecheck 通过；`priority` / `includeCanceled` 的 `EXPLAIN (ANALYZE, BUFFERS)` 证据（30,481 行、反向主键索引扫描、非顺序扫描）已写入测试矩阵。C 侧 R-5 前端接线、F-29 / F-32 适配器降级项替换与 Playwright 关键路径仍待交付；`description` / `scopeCounts` / `relation` / `query` / `scope=created|all` 保持拒绝或延后。

- 阶段 0 F-26 搜索结果「遗留问题」独立分类已本地落库（A）：新增迁移 `0006_leftover_search_entity.sql` 把 `search_projection_entity_type_check` 扩展为 8 类；新增 `LeftoverSearchProjectionSync`，在记录发布/修订（`RecordPublicationEffects`）、作废/恢复（`RecordLifecycleService`）与遗留项转任务（`LeftoverTaskWorkflow`）的同一事务内按遗留项最新版本 `content_snapshot` 刷新 `LEFTOVER` 投影：`entityId` 为遗留项 ID、title 至多 500 字符、summary 标注处置状态（待处理/已解决/已转为任务）与来源记录、可见性跟随父记录（PUBLISHED=MEMBER、VOID=ADMIN_ONLY）、`sourceStatus` 为遗留项状态、`sourceRowVersion` 防旧写；搜索页面与命令面板新增「遗留问题」分组。本地验证：API 单测 66 文件 343 例、真实 PostgreSQL API 集成 47 文件 408 例、Web 58 文件 249 例、`pnpm db:test` 26 例、Playwright E2E 43/43，lint/format/typecheck/build/契约（94 条）/权限（94/94）/迁移（7 个）/Secret/文档/部署/依赖边界与公共 registry 审计全部通过；GitHub Actions 未执行。用户反馈的 A 缺口清单中 F-26 项关闭；F-08 的审计读取留痕与远端 WORM 归档仍待交付。

- 阶段 1 ADR-033 项目内角色（组长与项目管理员）已本地落库（A+C，未提交）：按用户要求「创建项目的人是项目小组组长，可以进行成员添加、归档模块、删除模块（逻辑归档），或让其他成员成为该项目管理员，权限只存在于被赋予的项目中」交付完整纵切片——[ADR-033](./docs/adr/ADR-033.md)（[ADR-012](./docs/adr/ADR-012.md) 转 Superseded）、迁移 `0015_project_member_roles.sql`（`project_members.role` + 枚举 CHECK + `project_members_one_leader` 部分唯一索引 + `project_members_removed_role_check` + 创建者回填 LEADER）、契约新增 `setProjectMemberRole` 路由与 `ProjectMemberRecordItem/ProjectMemberItem.role`、`ProjectDetailResponse.currentUserRole`（98 条路由，受影响路由 `authPolicy` 由 `adminSession` 调整为 `session`、幂等契约版本按重放字段升级）、后端 `ProjectRoleGateService` 同事务实时角色门禁（成员管理与模块归档/恢复：系统管理员/本项目 LEADER/PROJECT_ADMIN 允许、普通成员 403、非成员 404；组长不可被移除 409；系统管理员转移组长时同事务自动降级原组长；`removeMember` 同事务重置 role）、前端成员页角色徽标与「设置角色」弹窗（组长仅 MEMBER/PROJECT_ADMIN，系统管理员含 LEADER）、成员页入口按 `currentUserRole` 分流、模块/功能页归档入口按角色放开（功能归档仍仅系统管理员）；功能设计/系统设计/技术设计、权限矩阵与 `docs/permissions.md`、测试矩阵同步。本地验证：契约 generate/drift/validate（98 条）、permissions:check（98/98）、lint、format:check、全 workspace typecheck、check:deps（173 文件）、check:frontend:boundaries（248 模块）、db:migrations:check（16 迁移）、check:secrets（1002 文件）、API 单测 64 文件 351 例、Web 单测 76 文件 425 例、web/api 生产构建、真实 PostgreSQL 18.6 + PGroonga 下 API 集成 48 文件 444 例（含 ADR-033 角色矩阵新用例）与 database 单测 15 + 集成 26 全部通过；Playwright E2E、GitHub Actions 与 `deps:audit` 未运行；`check:docs` 仅因仓库根目录历史遗留未跟踪 `.tmp-*.diff` 文件失败（非本批文件）。本批未提交、未推送，等待用户评审。附带环境修复（不入库）：本机系统缺失 VC++ 运行库导致 `@node-rs/argon2` 原生模块加载失败（Win32 126），已在 node_modules 平台包目录补齐 `vcruntime140*.dll`/`msvcp140.dll` 恢复本机测试能力。
  完成一项后应在同一 PR 中更新本节并链接对应证据，避免保留已经解决的阻断描述。

- 2026-09-10 F-21 已本地交审：管理员记录作废/恢复、双时间戳重认证（含锁后复核）、原因/If-Match/数据库幂等、管理员VOID读取/发现及同事务审计/Activity/Search；版本、最近作废快照、遗留项及转换链接保留，无通知或迁移。真库四文件63/63、契约42/42、Web7/7、86路由/权限与5生成物漂移通过；Edge F21 1/1及相邻F18 2/2分别通过，未执行本批CI。代码 9b5805805bbee6f0ff964fba75d5732701570943，范围与失败历史见 [F-21交审说明](docs/f21-local-handoff.md)。

- 阶段 0 F-08 审计远端归档（步骤 6）已本地落库（A）：新增 `packages/canonical-json`（把 `canonicalizeJson` 从 `apps/api/src/idempotency/jcs.ts` 提取为共享包，API 幂等摘要、审计写与 ops 归档共用）与 `apps/ops`（`audit-archive` CLI：`checkpoint`/`export`/`both`/`verify`；自研 SigV4 最小 S3 WORM 客户端（PUT/GET、对象锁头、409/412 幂等、5xx 退避）；AES-256-GCM 明细导出与 HKDF-SHA256 子密钥派生；`<version>:<64hex>` 归档签名 keyring；`audit_archive_writer` 只读连接；生产凭据只走 `WORM_CREDENTIALS_FILE`/`ARCHIVE_SIGNING_KEY_FILE` 并 fail closed）；`deploy/compose.yaml` 新增 operations `audit-archive` 服务与 `db_audit_archive_password`/`audit_worm_credentials`/`audit_archive_signing_key` Secret（`OPS_IMAGE_REF` 加入发布清单必需 ref）；`deploy/backup/audit-archivectl.sh` + 每小时检查点与每日导出 service/timer + `audit-archive.env.example`，与备份调度共用告警单元与 go-live 门禁；`docs/runbooks/audit-archive.md` 交付启用/验证/失败处置；`scripts/check_deploy_refs.mjs` 新增审计归档资产与调度不变量校验。本地验证：`pnpm --filter @inpulse/ops test:unit` 7 文件 36 例、`test:integration` 4/4（真实 PostgreSQL）、typecheck、lint、格式、`check:deploy:test`（5 refs）、`check:deps`（604 文件）通过；未运行：真实 S3/Object-Lock 端点联调、真实主机 systemd 安装、GitHub Actions；`backup` 服务本体（F-10.3）仍未交付。

- 阶段 1 A-1 `operations/backup` 服务本体与镜像入口已本地落库（A）：新增 `apps/ops` 备份实现（`src/backup.ts` 流式 `pg_dump --format=custom --no-owner --no-acl --exclude-table-data=app.user_sessions|session_csrf_tokens|preauth_sessions` -> AES-256-GCM（HKDF-SHA256 派生 `inpulse-backup-encryption-v1` 子密钥）-> 明文/密文 SHA-256 -> `.partial` 原子重命名 -> AES-GCM 自校验 -> HMAC-SHA256+JCS 签名清单（含 DB 版本、迁移版本、审核链头锚点、Git SHA、镜像 ref）-> 异机 S3 兼容 WORM 上传（对象锁 ≥30 天）与本机 7 天保留；`src/backup-cli.ts` 提供 `backup`/`verify` 子命令，失败统一 `inpulse-backup:` 前缀）；`deploy/compose.yaml` 新增 operations `backup` 服务（非 root 10002、只读根、/backup 加密卷、`BACKUP_GIT_SHA`/`BACKUP_IMAGE_REF` 由发布清单注入，生产缺失即 fail closed）与 `db_backup_password`/`backup_encryption_key`/`offsite_credentials` Secret；新增 `deploy/docker/ops.Dockerfile` 生产镜像（PostgreSQL 18.6 客户端固定 `18.6-1.pgdg12+2`，供 pg_dump/pg_restore，CI 构建与 Trivy 扫描），并把 API/Migration/Ops 三镜像的 `pnpm deploy --legacy` 改为 `--config.node-linker=hoisted`，修复运行树把 workspace 包符号链接指回不存在 `/workspace` 导致镜像内模块解析失败的缺陷；新增迁移 `0007_backup_role_pg_dump_grants.sql`：实测 `pg_dump` 快照开始时对 dump 范围全部表加 ACCESS SHARE 锁，与「`app_backup` 显式无会话表 SELECT」不可兼得，故补表级 SELECT 与序列只读（数据仍由 `--exclude-table-data` 排除，无写权限/无 DDL），该设计冲突按仓库规则留待非作者评审定案；`scripts/check_deploy_refs.mjs` 把 ops Dockerfile、operations 服务 Secret 长语法与 runtime 工具链删除纳入校验。本地验证：`@inpulse/ops` 单测 8 文件 52 例、集成 2 文件 7 例（真实 PostgreSQL + 真实 pg_dump/pg_restore：备份、清单、WORM 桩上传、恢复演练后会话表为空/迁移与业务行存在）、数据库集成 26 例、`pnpm check:deploy:test`（5 refs）退出码 0、ops 镜像本地构建成功且容器内 `pg_dump 18.6`、非 root 10002、缺 Secret fail closed 已验证；未运行：真实 S3/Object-Lock 端点与 systemd 启用、真实全新主机恢复演练、GitHub Actions。

- 阶段 1 A-7 契约修订 D-1 已本地落库（A）：R-3 `MyTaskItem` 增加 `publishedRecordCount`（与 `hasPublishedRecord` 同源同口径，恒有 `hasPublishedRecord === (publishedRecordCount > 0)`）；R-5 `listTaskGroupMemberships` 由「聚合组成员关系」扩为「任务记录标记批量读」——条目为 `{ taskId, groupId, groupRole, publishedRecordCount }`，`groupId` / `groupRole` 改为可空，请求中每一个有权 taskId 都出现（未入组以 null 返回且计数照常），无权或不存在（含跨项目）仍不出现；`TaskGroupMembershipQueryService` 改为 `TaskQueryPort.listByIds` 求有权集合后，经 `TaskGroupMembershipReadPort.listGroupRoles` 与 B-7 的 `ChangeRecordReadPort.countPublishedByTask` 补齐关系与计数，空授权范围短路不发后续 SQL；Route Registry summary、权限矩阵、OpenAPI、生成客户端与测试同一 PR 同步。本地验证：契约漂移 / 校验 / 权限（5 产物、97 路由、97/97）、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm test:unit`（api 68 文件 351 例、web 64 文件 293 例、ops 8 文件 52 例）、真库 `apps/api/test/aggregate-read-api.integration.test.ts` 19/19 与 `apps/api/test/aggregate-read-ports.integration.test.ts` 17/17、全量 API 集成 49 文件 428 例均通过；`EXPLAIN (ANALYZE, BUFFERS)` 断言加强为 ANALYZE 实测输出（`actual time`）。GitHub Actions 尚未执行；R-5 的 `groupId` / `groupRole` 可空是破坏性契约变更，C-1 接线前必须先判 null。分支 `feature/a7-contract-d1`，见 [开发日志](./开发日志.md) 2026-09-11 A 条目与 [测试矩阵](./docs/test-matrix.md) A-7 章节。

- 阶段 1 A-2 未裁决契约项（C-001 / C-004 / C-005 / C-007 / C-008）已本地落库（A）：新增 [A 的契约评审裁决](./docs/a-contract-review-frontend-consumption.md)，五项全部定案——C-001 生成客户端输出位置冻结为 `apps/web/src/generated/api/`（`packages/api-contract` 只放 Schema / Route Registry、生成器与 OpenAPI 产物；技术设计仓库结构“客户端”修订为“客户端生成器”）；C-004 `details` 保持开放对象并冻结保留键 `issues` / `reason` 与空对象约定（FC-031 判别联合延后，恢复条件见裁决 §3.2）；C-005 冻结 `CSRF_ORIGIN_REJECTED` / `CSRF_TOKEN_INVALID` / `MFA_CSRF_REJECTED` / `ADMIN_CSRF_REJECTED` 四码，禁止用 `FORBIDDEN` 表示 CSRF 失败；C-007 生成客户端不做运行时 Schema 校验（只做类型映射 + 最小形状契约）；C-008 `message` 是稳定诊断文案、前端只按 `code` 分支。[error.zod.ts](./packages/api-contract/src/contracts/error.zod.ts) 四字段补 `description` 并随 `pnpm contract:generate` 同步 OpenAPI；`generation.test.ts` 新增 C-007 断言。本地验证：`contract:generate` / `contract:drift`（5 个产物）/ `contract:validate`（97 条路由）/ `permissions:check`（97/97）、`lint`、`format:check`、`typecheck`、`test:unit`（api-contract 94 例、api 68 文件 351 例、ops 8 文件 52 例、web 通过）、真库 `pnpm --filter @inpulse/api test:integration` 49 文件 428 例（三次连续全绿；最早一次运行出现一次不可复现失败，已记录）、`check:docs`（74 个 Markdown）、`check:secrets`（928 文件）均通过。GitHub Actions 尚未执行；FC-031 判别联合与逐路由 `details` Schema ref 为明确延后项。

- 阶段 1 A-3 `compose.init` 首次建库纵切片与灾难恢复离线 Runbook 已本地落库（A）：新增版本化一次性覆盖 `deploy/compose.init.yaml`（仅该次向 db 服务设置 `POSTGRES_DB=app` / `POSTGRES_USER=cluster_bootstrap` / `POSTGRES_PASSWORD_FILE`，只读挂载 bootstrap / migrator / runtime / backup / audit_reader / audit_archive 六份密码 Secret，target `/run/secrets/db_*`、mode 0400、uid/gid 999），新增 [灾难恢复离线 Runbook](./docs/runbooks/disaster-recovery.md)（离线材料清单、镜像 digest 校验、建库与角色探针、数据恢复、Session 处理、迁移与完整校验、RPO/RTO 门禁与故障处理；`backup-restore.md` §7 与 `database/README.md` 同步引用）；`database/bootstrap/010_passwords.sql` 容器内 Secret 路径对齐稳态命名 `db_*`（`database/.env.example` 同步）；`scripts/check_deploy_refs.mjs` 渲染 overlay 并静态保证稳态渲染不含 POSTGRES_* 与 db_bootstrap_password、六份 Secret 只挂 db、migrate/api/web/backup/audit-archive 从不挂 bootstrap、`.env.deploy.example` 占位符被拒；本地 Docker（Compose v5.5.0）实测构建 db-bootstrap 镜像后 overlay 首次建库（initdb 与 `000_roles.sql` / `010_passwords.sql` / `020_pgroonga.sql` 无报错、healthy）、角色/扩展探针（7 角色 NOLOGIN/LOGIN 与最小权限、`app_runtime` 密码登录且 `SET ROLE app_owner` 被拒、`pgroonga` 存在）、切回稳态 Compose 接管（同卷 healthy）；`pnpm check:deploy:test`、`pnpm lint`、`pnpm format:check`、`pnpm typecheck`、`pnpm check:docs`（75 个 Markdown）、`pnpm check:secrets` 本地通过；GitHub Actions 尚未执行；真实主机恢复演练（RECOVERY-001 / DEPLOY-003）仍属上线门禁。
- 阶段 1 A-4 SEC-003 CSRF 完整生命周期 E2E 已本地落库（A）：新增 `apps/api/test/csrf-lifecycle.integration.test.ts`（真实 PostgreSQL 与完整 AppModule HTTP：错误 CSRF 登录不消费预认证材料、重签后重试一次成功且成功即单次消费（重复登录 409/401）、认证 Session 最多保留 4 个 CSRF 并淘汰最旧、认证 Session 与预认证材料过期后重签恢复、登录不写 `app.idempotency_records` 且模块创建缺 `Idempotency-Key` 返回 400）；新增 `apps/e2e/tests/csrf.spec.ts`（Playwright：首登后 `__Host-preauth` 清除与 `__Host-session` HttpOnly/Secure/SameSite=Lax 属性、`GET /auth/csrf` 与 login 不发送业务幂等键、刷新后写操作重新签发 CSRF、多标签各自签发并独立写成功、模块编辑 PATCH 携带 `If-Match`/CSRF/幂等键）；本地验证：集成 4/4、E2E 4/4、`pnpm build`、`apps/e2e` typecheck、`pnpm format:check`、`pnpm check:docs` 通过；GitHub Actions 尚未执行。
- 阶段 1 项目主页恢复与「系统目录」导航（C，2026-09-14 本地落库）：上一轮目录改造（`codex/project-tree-nav`，未合并）把项目主页入口让给新建的只读复刻页（`/explorer` 重实现，从未进入任何提交），产品反馈项目主页面「严重丢失了好多功能和效果」并澄清「目录应该影响的是这个页面而不是新建页面」。本轮改为**目录只做导航**：新增 `apps/web/src/features/project-tree/`（`ProjectTree.tsx` 复用既有 `useProjectDetail` / `useModules` / `useFeatures` 与生成客户端渲染三级树；`tree-selection.ts` 的 `treeScopeOf` / `treePath` 负责选中层级与既有页面映射），在 `AppLayout` 既有 `nav[aria-label="工作区导航"]` 内新增「系统目录」分组（仅项目目录路径渲染），系统 / 模块 / 功能分别落到项目主页 `/projects/{p}/modules`、功能目录 `/projects/{p}/modules/{m}/features`、功能档案 `.../features/{f}`；删除只读复刻页与 `/explorer` 路由，项目卡片入口保持 `onOpenModules` → 项目主页；无新增路由、无 API / 契约 / 权限 / 迁移改动。本地验证：`project-tree` 2 文件 7 例与 `AppLayout.test.tsx` 新增 2 例、`pnpm test:web` 73 文件 399 例、`pnpm typecheck`（8 个 workspace）、`pnpm build`、`pnpm check:frontend:boundaries`（244 模块 / 1146 依赖）、`pnpm lint`、`pnpm format:check`、`pnpm check:docs`（75 个 Markdown）通过，真实浏览器人工复验三级目录分别驱动既有页面；**尚无目录树的 Playwright 用例**（E2E 覆盖待补），整链 `pnpm check`（本机 npm 镜像缺 audit endpoint）与全量 `pnpm test:e2e` 未运行，GitHub Actions 尚未执行；详见测试矩阵「项目主页目录树恢复」条目。 PR [#140](https://github.com/256-code/InPulse/pull/140) 首轮 CI 的 Browser E2E 暴露目录树节点与功能档案动作按钮的可访问名冲突：`features.spec.ts` 用例新建的功能名 `归档功能-<时间戳>` 同时命中树节点按钮与功能档案页的「归档功能」动作按钮（Playwright strict mode），已把该用例的动作按钮查询限定到 `page.getByRole` 的 `main` 主内容区，并在本地以 `E2E_DATABASE_URL=postgresql://cluster_bootstrap@127.0.0.1:55432/app`、`E2E_API_PORT=3188`、`E2E_WEB_PORT=4188` 复跑 `features.spec.ts` 2 passed（22.9s）；本轮为选择器作用域修正，产品行为与断言强度均未变。

## 2026-09-14 ADR-030 当前分支说明

项目与任务流程按用户确认的 ADR-030 修订：新项目不自动创建未分类模块；保留旧模块历史并新增项目内模块编号；支持任务/新模块/新功能同事务创建；当前项目成员只读、任务中心授权范围/逾期分页、功能验收标准、草稿详情及根仓库入口同步。迁移 `0010`–`0012`、契约、生成客户端、权限和测试矩阵已同步。历史模块编号回填后须在同一迁移内 `SET CONSTRAINTS ALL IMMEDIATE` 清空延迟事件，再修改模块表约束。联合创建先取得项目排他锁再进入各域 CommandPort，避免编号序列与审计锁交叉等待。

本轮仅进行了相关前端交互、服务层、真实 PostgreSQL 18.6/HTTP 回归和历史升级探针。遵循用户对本任务的限制，不执行全量构建、静态检查、依赖审计；不声明完整 CI 或浏览器 E2E 已通过。遗留问题转任务不属于本次修改范围。

## 2026-09-15 ADR-031 TOTP 验证移除说明

按用户明确要求，本期移除全部 TOTP 验证（连管理员高风险重认证一并取消），并以 ADR-031 取代 ADR-016；数据库本期只停用不删除（保留 `user_totp_factors`、`mfa_recovery_codes` 表与 `user_sessions.mfa_verified_at` 等列），后续 contract 迁移再删。因此：

- 登录只做密码验证（Argon2id + 登录限流），成功后直接签发自 `AUTHENTICATED` 的完整认证 Session 与新 CSRF；不存在 MFA 注册/验证/恢复码挑战与受限 Session。
- 管理员高风险操作（`listAdminUsers`/`createUser`/`updateUser`/`disableUser`/`enableUser`/`forceLogoutUser`、`getAuditLogs`、`getProjectArchivePreview`/`archiveProject`/`restoreProject`、`archiveModule`/`restoreModule`、`archiveFeature`/`restoreFeature`、`addProjectMember`/`removeProjectMember`、`voidChangeRecord`/`restoreChangeRecord`）只要求当前有效的完整管理员 Session、`is_admin`、写操作 CSRF 与数据库级幂等；不再要求管理员密码 + TOTP 重认证，错误码收敛为 401 `ADMIN_SESSION_REQUIRED`、403 `ADMIN_REQUIRED` 与 401 `ADMIN_CSRF_REJECTED`。
- 删除 7 条 MFA 认证路由后 Route Registry 为 95 条；`securityFlow` allowlist 收敛为 `issueCsrfToken`/`login`/`logout` 三条。
- 管理员最后一名保护由「最后一名可用 MFA 管理员」改为「最后一名可用管理员」（`LAST_ACTIVE_ADMIN_REQUIRED`）。
- 本文件上文历史条目中出现的 TOTP/MFA/重认证描述均为当时事实，与本节冲突时以 ADR-031 与本节的现行规则为准。

## 2026-09-15 ADR-032 Casdoor 单点登录接入说明

按用户明确要求，InPulse 接入立镖公司 Casdoor OIDC 单点登录（ADR-032），口令入口降级为管理员应急通道。因此：

- `/login` 默认整页跳转到 `/api/v1/auth/sso/start?returnTo=...`（查询参数名必须与契约 `SsoStartQueryRequest` 一致），回调 `/api/v1/auth/sso/callback` 成功后复用与口令登录同一实现签发本地 Session；`securityFlow` allowlist 由三条扩为五条，Route Registry 为 97 条路由。
- 数据库迁移 `0013_sso_login.sql` 新增 `users.sso_subject`（部分唯一索引 + 绑定后不可改写触发器）、允许 `password_hash` 为空，并新增 `app.sso_login_attempts`；历史迁移不得修改。
- 本地会话空闲有效期由 8 小时收紧为 30 分钟，口令与 SSO 共用 `SESSION_TTL_POLICY`（`SESSION_IDLE_MAX_AGE_SECONDS` 可覆盖），绝对有效期仍为 7 天。
- 生产 Secret 为 `/run/secrets/sso_client_secret`（由 `SSO_CLIENT_SECRET_FILE` 指定）；本地与集成测试只允许 `NODE_ENV=test` 且 `SSO_CLIENT_SECRET_TEST_PATH=1` 时读取临时路径。
- 新增覆盖：`sso.config.test.ts`、`sso-oidc.client.test.ts`、`sso.controller.test.ts`、`sso-return-to.test.ts`、`session-ttl.policy.test.ts`、`sso-login.integration.test.ts`（真实 PostgreSQL + 桩 IdP）以及登录页单测与 E2E 用例。
- 迁移 `0014_sso_backup_grants.sql` 为 `app_backup` 补齐 `app.sso_login_attempts` 的表级 SELECT 与序列 USAGE/SELECT（pg_dump 一致性快照必需，与迁移 0007 同源），并把 `app.sso_login_attempts` 加入 `apps/ops/src/backup.ts` 的 `BACKUP_EXCLUDED_TABLE_DATA`：该表只保留结构、数据不进备份产物。新增表进入备份范围按 fail closed 处理——必须显式补一条备份授权迁移，不得改成 `ALTER DEFAULT PRIVILEGES` 默认授权（例外须新增 ADR）。
- 本轮联调修复（均为真实缺陷，已落库）：① `apps/api/src/auth/auth.module.ts` 与 `sso-login.service.ts` 曾从 `audit/index.js` barrel 引入 `AuditWritePort`，与 `AuditLogReadModule -> AuthModule` 形成循环依赖，导致整个 `AppModule` 初始化时 Nest 拿到 `undefined` 并以 `process.abort()` 崩溃（8 个 API 集成测试文件直接退出）；改为直接引用 `audit/audit.port.js`，该循环由 `pnpm check:deps` 的 `[circular-dependency]` 拦住；② `apps/web/tools/vite-csp.ts` 的 dev/preview CSP 中间件原先会短路所有无扩展名且 `Accept: text/html` 的请求，把浏览器整页导航到 `/api/v1/auth/sso/start` 的请求当成 SPA 入口返回 `index.html`，使 SSO 回落在本地预览里自跳转成环（URL 与请求头超限后返回 431）；新增 `isApiPath` 放行 `/api/**` 交给代理，E2E 复跑 56/56；③ `sso.config.ts` 的回调地址变量由 `SSO_REDIRECT_URL` 更名为 `SSO_REDIRECT_URI`（与 OIDC `redirect_uri` 术语一致），因为 `scripts/check_secrets.mjs` 把所有 `*_URL` 键视为必须指向 `/run/secrets/*` 的敏感变量，改名避免误判而不放宽门禁。
- 本文件上文历史条目中出现的 8 小时空闲超时、三条 `securityFlow` 等描述为当时事实，与本节冲突时以 ADR-032 与本节的现行规则为准。

## 2026-09-16 ADR-034 项目归档申请与任务归档说明

按用户确认的口径（项目归档保留「双方同意」，但审批权只归总管理员）把项目归档改为「申请—审核」，并同步确定任务归档与父级归档前置校验。实现细节与边界见 [ADR-034](./docs/adr/ADR-034.md)。

- 项目组长（LEADER）、项目管理员（PROJECT_ADMIN）与系统管理员可发起项目归档申请，普通成员 403；但只有系统管理员能批准真正归档或驳回申请，申请权与审批权分离。
- 拦截口径只针对任务，且以「已收尾」为准：项目归档的申请与批准、模块归档都要求作用域内不存在 `lifecycle_status = 'ACTIVE'` 且 `work_status = 'TODO'` 的任务（已完成、已取消与已归档都算收尾），否则分别 409 `PROJECT_ARCHIVE_TASKS_OPEN` 与 `MODULE_ARCHIVE_TASKS_OPEN`；功能不需要归档，也不作为任何一级的归档拦截条件。
- 任务新增归档/恢复命令（`archiveTask`/`restoreTask` 与模块级 `archiveModuleTask`/`restoreModuleTask`），只切换 `tasks.lifecycle_status`，权限为系统管理员、本项目组长或项目管理员，普通成员 403 `TASK_ARCHIVE_FORBIDDEN`；不写 `task_status_history`，不改变完成统计口径，同事务写审计、活动与搜索投影。
- 归档命令的父级口径：项目必须 ACTIVE；模块或功能已归档时**仍允许归档其任务**（收尾动作），否则「先归档功能→其任务无法归档→模块下永远存在 ACTIVE 任务」会锁死模块归档。恢复仍要求模块与功能父级链全部 ACTIVE。HTTP 幂等解析阶段与 `execute` 使用同一口径。
- 任务归档/恢复入口与模块、功能一致，只放在任务编辑弹窗底部（`data-testid=task-modal-lifecycle`，文案「归档」/「恢复」），普通成员不可见；409 文案带未收尾任务数量并指引到该入口。父级已归档、任务只读时该弹窗对有归档角色的用户仍可打开（表单只读）。
- 迁移 `0016_project_archive_requests.sql`（新表、枚举 CHECK、部分唯一索引、origin guard 触发器与 `app_runtime` 授权）；`docs/permissions.md` 已同步新增项目归档申请、批准、驳回与任务归档、恢复条目。
- 功能归档/恢复（界口语「删除功能」）与任务、模块归档同一口径，自 ADR-034 起由系统管理员、本项目组长或项目管理员执行，普通成员 403 `FEATURE_MANAGE_FORBIDDEN`；前端入口与模块弹窗一致，只放在「编辑功能」弹窗底部（文案「归档」/「恢复」），卡片与详情页头只对已归档功能保留「恢复功能」；功能不参与任务归档前置校验，归档功能只要求项目与父模块 ACTIVE。
- 本文件与三份基线设计文档中「项目归档由系统管理员单方执行」的历史描述为当时事实，与本节冲突时以 ADR-034 与本节的现行规则为准。
- 2026-09-17 前端改动免测试（项目负责人指示）：只改前端（`apps/web`）且不涉及后端、契约、权限与数据库时，不再运行任何测试与门禁命令（含定向 vitest、`pnpm test:web`、Playwright、`pnpm check` 等），改动完成即交付；是否补跑由项目负责人决定。
- 2026-09-17 测试数据必须清理（项目负责人指示）：每次跑完会落库的测试（Playwright E2E、真实 PostgreSQL 集成等）后必须删除测试数据，不得在本地或共享开发库留下夹具项目、夹具用户及派生数据。Playwright 的 `global-teardown` 已改为按 `e2e_` / `f03_` 账号前缀自动物理清理夹具（`apps/e2e/helpers/fixture-cleanup.ts`：按依赖序删除业务表、`PROJECT:` 审计链、悬空审计行与夹具账号，回退被清空的 SYSTEM 链头，并复核夹具残留为 0、项目 bootstrap 成员关系与每项目唯一 UNCLASSIFIED 模块不变量，断言失败即回滚）；运行被中断未触发 teardown 时用 `pnpm --filter @inpulse/e2e cleanup` 或 `node apps/e2e/helpers/fixture-cleanup.ts` 手动补跑（需要 `E2E_DATABASE_URL` / `TEST_DATABASE_URL` 的 bootstrap 角色）。清理以 `session_replication_role = replica` 关闭行级触发器执行（UNCLASSIFIED 禁删触发器会阻止删除夹具项目），该开关仅限测试夹具清理，业务代码不得使用；SYSTEM 链若在夹具记录之后已有真实写入会留下一个可检测的断点，清理报告会提示。

## 2026-09-18 ADR-036 登录入口调整说明

按用户要求把登录页默认入口从「自动整页跳转统一身份认证」改回「默认展示本地口令表单」，并在登录框下方并列提供「或以统一身份认证登录」图标入口（[ADR-036](./docs/adr/ADR-036.md) 修订 ADR-032 决策 7）。因此：

- `/login`（含 `?from=`、`?local=1`）默认渲染本地口令表单，不再自动跳转 `/api/v1/auth/sso/start`；点击登录框下方的单点登录图标才整页跳转 SSO（仍走 ADR-032 的 302 导航与 fail closed 回落）。
- `sso=disabled` 与 `sso_error=` 回落都保留本地口令表单：`sso=disabled` 时隐藏 SSO 入口并提示未启用；`sso_error=` 时错误提示置顶、SSO 入口保留可重试。
- 退出登录与未登录态的「前往登录」回到 `/login`，不再直接整页跳 SSO。
- ADR-032 的 OIDC 协议、两条 302-only 路由、`securityFlow` 五条 allowlist、用户映射、JIT 开通、会话与限流语义均不变；服务端路由与权限矩阵无改动。
- 本文件上文历史条目中出现的「`/login` 默认整页跳转 SSO」为当时事实，与本节冲突时以 ADR-036 与本节的现行规则为准。

## 2026-09-20 ADR-038 本地会话空闲时长调整说明

按用户要求把本地会话空闲有效期由 30 分钟调长为 2 小时（[ADR-038](./docs/adr/ADR-038.md) 修订 ADR-032 决策 6 的时长取值）。因此：

- 默认空闲有效期由 1800 秒改为 7200 秒（`apps/api/src/auth/session-ttl.policy.ts`），口令与 SSO 登录共用同一 `SESSION_TTL_POLICY`；`SESSION_IDLE_MAX_AGE_SECONDS` 仍可覆盖，非法取值继续启动失败。
- 失效机制不变：空闲超时仍自签发起固定计算、不随请求滑动续期；绝对超时仍为 7 天；`auth_version` 实时失效、停用即失效、Session 清理与备份排除语义均无改动。
- 部署配方同步为 2 小时：`deploy/.env.deploy.example` 与 `deploy/.env.deploy.test` 写入 `SESSION_IDLE_MAX_AGE_SECONDS=7200`，`deploy/compose.yaml` 注释同步。
- 路由、契约、权限矩阵与数据库迁移无改动；测试断言已同步（`session-ttl.policy.test.ts` 默认 7200 秒、`sso-login.integration.test.ts` 以 7200 秒签发并断言窗口），测试矩阵新增 2026-09-20 修订行。
- 本文件上文历史条目中出现的 30 分钟空闲超时为当时事实，与本节冲突时以 ADR-038 与本节的现行规则为准。

## 2026-09-23 ADR-043 / ADR-044 项目与模块归档下线说明

按用户 2026-09-23 连续两条指示整体下线「项目层」与「模块层」的归档：[ADR-043](./docs/adr/ADR-043.md) 把项目状态收窄为未开始 / 进行中 / 维护中三态，[ADR-044](./docs/adr/ADR-044.md) 让模块只剩 `ACTIVE`。因此：

- 项目不再有归档、恢复、归档申请与待审提示，六条项目归档路由与 `app.project_archive_requests` 的前后端实现全部删除；切换到维护中要求项目下不存在 `lifecycle_status = 'ACTIVE'` 且 `work_status NOT IN ('DONE','CANCELED')` 的任务，否则 409 `PROJECT_MAINTENANCE_TASKS_OPEN`。项目三态下都可写。
- 模块只有 `ACTIVE`：`archiveModule` / `restoreModule` 两条路由、`ModuleArchiveRequest`（原因）、`MODULE_ARCHIVE_TASKS_OPEN`、`FEATURE_MODULE_ARCHIVED`、`ModuleQueryPort.checkModuleForWrite` 的 `parent-not-active` 与 `ProjectWriteAccessFailure.module-not-active` 全部删除，`ModuleWriteCheckResult` 只有 `allowed | not-found`；`app.modules.status` 由 `modules_status_check` 锁定为 `ACTIVE`，`archived_at` 由 `modules_archived_at_null_check` 锁定为空。
- 功能、任务、迭代记录与遗留项的归档、恢复与父级归档前置校验**不变**：功能级 `parent-not-active`（`feature.status = 'ARCHIVED'`）当时仍在（该部分已由 [ADR-045](./docs/adr/ADR-045.md) 下线，见下文 2026-09-24 小节）；`archiveModuleTask` / `restoreModuleTask` 是「模块级任务」的归档命令，与模块归档无关，继续有效。
- 管理员高风险操作清单不再包含 `getProjectArchivePreview` / `archiveProject` / `restoreProject` / `archiveModule` / `restoreModule`（对应路由已不存在，调用返回 404）。
- 模块卡「进行中 / 未开始」标签继续由该模块已完成任务数派生，列表仍按派生档位分组（进行中在前），组内按 `sort_order`、`id` 升序；功能列表当时仍保留「已归档」档位（该表述已由 [ADR-045](./docs/adr/ADR-045.md) 修订，见下文 2026-09-24 小节）。
- 本文件上文 ADR-016 与 ADR-034 小节中把「项目归档申请—审核」「模块归档与恢复」写作现行规则的部分，以本节与 ADR-043 / ADR-044 为准。

## 2026-09-24 ADR-045 功能归档下线说明

按用户 2026-09-24 指示（承接功能卡上仍显示琥珀色「已归档」徽章的追问，答复「要继续」）把「功能层」归档一并下线（[ADR-045](./docs/adr/ADR-045.md)）。因此：

- 功能只有 `ACTIVE`：`archiveFeature` / `restoreFeature` 两条路由、`FeatureArchiveRequest`（原因）、`FeatureQueryPort.checkFeatureForWrite` 的 `parent-not-active`、`ProjectWriteAccessFailure.feature-not-active` 与 `FEATURE_STATE_CONFLICT` 全部删除，`FeatureWriteCheckResult` 只有 `allowed | not-found`；`app.features.status` 由 `features_status_check` 锁定为 `ACTIVE`，`archived_at` 由 `features_archived_at_null_check` 锁定为空。
- 功能下级的「父级已归档」分支整体删除：任务、聚合组、迭代记录、遗留项、外部链接、记录发布与聚合读不再有 `TASK_PARENT_ARCHIVED` / `TASK_IMPACT_ARCHIVED` / `TASK_MERGE_PARENT_ARCHIVED` / `LEFTOVER_PARENT_ARCHIVED` 与「排除归档影响功能」；功能创建 / 编辑 / 详情 / 列表 / 相似候选不再按状态过滤。任务自身的归档与恢复（`archiveTask` / `restoreTask` / `archiveModuleTask` / `restoreModuleTask`）不变。
- 功能卡「进行中 / 未开始」标签改由该功能已完成任务数（`stats.completedTaskCount`）派生，与模块同一口径；`featureItemSchema` 去掉 `status` / `archivedAt`，`createFeature` / `updateFeature` 幂等契约版本统一升 1.4.0。
- 管理员高风险操作清单不再包含 `archiveFeature` / `restoreFeature`（对应路由已不存在，调用返回 404）。
- 本文件上文 ADR-034 小节中把「功能归档 / 恢复」写作现行规则的部分、以及本节上一段（2026-09-23）中「功能列表保留「已归档」档位」的表述，以本节与 ADR-045 为准。
- 功能层下线归档的验证：`pnpm --filter @inpulse/e2e exec playwright test` 整包 56 例全绿（含 `features.spec.ts`「功能页不再有归档与恢复入口，功能始终可编辑（ADR-045）」）；同步运行树 `D:\InPulse` 后真机核对 `/projects/1/modules/3/features` 与 `/projects/2/modules/9/features` 无「已归档」文本、无归档 / 恢复动作按钮，页面内 `fetch` 实测 `POST .../features/{id}/archive` 与 `/restore` 均 404，`GET .../features` 的 item 无 `status` / `archivedAt`。E2E 侧同时修掉既有 spec 漂移与 `apps/e2e/global-setup.ts` 搜索夹具在 `search_projection_entity_unique` 上的唯一键冲突（夹具 `entity_id` 改为 `2_100_000` / `2_100_001`），并给 `playwright.config.ts` 补 `actionTimeout: 30_000` 以免定位器失配时静默等到用例超时；详见 `docs/test-matrix.md` 的 ADR-045 节。

## 2026-09-24 ADR-046 三层列表排序口径

按用户 2026-09-24 指示（「项目排序首先大体按照状态，进行中，未开始，维护中，细化按照创建时间排序。模块和功能按照创建时间从近到远」）统一三层列表的排序键（[ADR-046](./docs/adr/ADR-046.md)）：

- 项目列表：档位（`ACTIVE` 进行中 → `NOT_STARTED` 未开始 → `MAINTENANCE` 维护中）→ `created_at DESC` → `id DESC`，见 `apps/api/src/modules/projects/postgres-project-query-port.ts` 的 `list`。
- 模块列表与功能列表：派生档位（进行中 → 未开始）→ `created_at DESC` → `id DESC`，见 `apps/api/src/modules/modules/module-management.repository.ts` 与 `apps/api/src/modules/features/feature-management.repository.ts`。模块排序**不再使用** `sort_order`：该列应用内从不写入、恒为默认值 `0`，只有演示种子数据填了 1~8；列本身保留，不删列，也不为此新增迁移与索引（排序首键是相关子查询算出的 `CASE`，任何索引都满足不了）。
- 档位口径不变：项目读存储状态，模块与功能由 `stats.completedTaskCount` 派生；卡片档位徽章的文案与配色不变。本文件与 ADR-044 中「模块列表组内按 `sort_order`、`id` 升序」的表述以本节与 ADR-046 为准。
- `created_at` 相同时用 `id DESC` 兜底保证顺序稳定；演示数据里项目 1 的 8 个模块创建时间完全相同，因此它们现在按 ID 倒序显示。契约侧 `listProjects` / `listModules` / `listFeatures` 三条路由描述同步（顺手清掉 `listProjects` 描述里残留的「包含归档历史 / 已归档档位 / 待审归档申请摘要」过时文案）。
- 验证（2026-09-24 本地）：`apps/api` 单测 66 文件 367 例、真实 PostgreSQL 集成 49 文件 451 例（含三处新排序断言：`projects-read-api` 的后建「未开始」项目排在旧「未开始」之前且档位计数为 `[1, 0, 0, 0]`、`modules-api` 的未分类模块列表 `[module.id, project.moduleId]`、`features-api` 的 `[active.id, newerNotStarted.id, notStarted.id]`）、`apps/web` 单测 85 文件 553 例、Playwright E2E 整包 56 例全绿（4.9 分钟）；`pnpm lint`、`pnpm typecheck`、`pnpm format:check`、`pnpm build`、`contract:drift`、`contract:validate`（98 条）、`permissions:check`（98 条）、`db:migrations:check`（26 条）、`check:docs`（92 个 Markdown）、`check:frontend:boundaries`（283 模块 / 1392 依赖）通过。`apps/web` 的 `src/app/router/app-router.test.tsx` 在全量批次下偶发 1 例失败，单独复跑 3/3 通过，与本次排序改动无关（既有偏差）。详见 `docs/test-matrix.md` 的 ADR-046 节。

## 2026-09-24 任务紧急桶：遗留问题来源改排到已逾期之后

按用户 2026-09-24 指示（「这个排序稍微改一下，把遗留问题排到已经逾期后面」）重排未完成任务的紧急桶：**标记紧急(0) → 已逾期(1) → 遗留问题来源(2) → 今/明日截止(3) → 其余(4)**（此前遗留问题来源是第 0 桶）。

- 服务端唯一排序键在 `apps/api/src/modules/tasks/task-list-order.ts` 的 `urgency` 表达式，任务中心、任务列表端口与任务面板共用；`TASK_LIST_SORT_KEY_VERSION` 由 4 升到 5，旧游标整版拒绝（旧 0 = 遗留问题来源，新 0 = 标记紧急）。
- 前端 `apps/web/src/features/my-tasks/TaskCenterPageView.tsx` 的 `urgencyBucketOf` 必须与服务端同步重排：它让聚合组卡与任务卡共用同一把尺子（组卡「来源」不适用，「紧急」取未完成分支最高一档、「截止」取最早一条）。两处注释互相引用，改一处必须改另一处。
- 只改顺序，不改颜色：`task-tone.ts` / `design-system.css` 的卡片取色、优先级徽章、「遗留问题」棕色徽章与截止日期文案全部不变；任务看板四桶口径（[ADR-037](./docs/adr/ADR-037.md) §3）同样不变。
- ADR-037 §3 已补 2026-09-22 与 2026-09-24 两条修订（§1 / §3 表格里 2026-09-18 的原始桶序以这两条为准），并同步 `功能设计v1.1.md`、`docs/task-card-colors.md`、`docs/c-v1-alignment.md`、`docs/test-matrix.md`（TASK-URGENCY-ORDER-* 小节）与 `开发日志.md` 第二十一条。
