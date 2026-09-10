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
- 所有写接口（POST、PUT、PATCH、DELETE）默认必须在 Route Registry 声明 `idempotencyRequired` 并实现数据库级幂等；普通 GET、HEAD 和纯校验接口显式声明 `none`。[ADR-023](./docs/adr/ADR-023.md) allowlist 中的 operationId 必须且只能声明 `securityFlow`，包括签发/消费一次性安全材料及管理员重认证；新增例外必须另立 ADR。通用幂等记录禁止保存或重放 Cookie、CSRF Token、MFA Secret、验证码或恢复码。
- `idempotencyRequired` 的请求摘要必须覆盖大写 method、operationId、幂等契约版本、摘要格式与请求 Schema 版本、Schema 解析后的 path 参数和规范 query、规范 Content-Type、Route Registry 声明的全部行为相关请求头以及 JCS 规范化 body；使用版本头的路由必须包含 `If-Match`。摘要使用独立、带版本密钥的 HMAC-SHA-256，不得把普通 SHA-256 用作密码、验证码或其他低熵输入的离线校验器。Cookie、Authorization、CSRF、追踪头和 Idempotency-Key 不进入摘要。任一语义输入或幂等契约版本不同都返回 409。幂等不能只依赖前端禁用按钮或进程内锁。
- 每条 `idempotencyRequired` 路由必须登记带版本的 `idempotencyReplayPolicy`：逐个列出可能缓存的 2xx 状态；有 body 时列出精确响应 Schema 引用以及可安全持久化和重放的全部 body 叶子字段，无 body 时使用互斥的 `noBody` 分支。CI 必须拒绝遗漏状态、字段不全或越界、Schema 不一致、Secret 字段以及任何 `Set-Cookie`/认证响应头重放；`none` 与 `securityFlow` 路由的该策略只能为 `none`。请求或安全重放策略变化必须升级幂等契约版本，旧 Key 在新契约下返回 409。
- 每条 `idempotencyRequired` 路由还必须登记 `replayAuthorizationPolicy`，以类型化、最小化的结果资源引用说明缓存响应暴露了哪些资源。幂等重放前必须重新验证当前认证、原操作权限、所有结果资源的当前可读权限及该路由要求的高风险重认证新鲜度；任一门禁失败时拒绝且不得泄露已存状态码或响应。只有全部门禁通过后，同 Key、同摘要和同契约版本才重放原 2xx。
- 项目创建时，创建者必须自动成为活跃成员且创建流程不可取消该成员关系；创建完成后，系统管理员可以按普通成员规则移除创建者。`projects.created_by` 只用于不可变溯源，不赋予额外权限，也不得随成员移除而改变。普通成员创建者被移除后立即失去成员关系派生的项目权限；若创建者本身是系统管理员，其全局管理员权限不受成员记录影响。测试必须分别覆盖这两种身份。
- 正式记录版本不可变；迭代记录状态只允许 `DRAFT -> PUBLISHED -> VOID`，以及经管理员重认证的 `VOID -> PUBLISHED` 恢复。`status` 是详情、统计、搜索和时间线可见性的唯一真相，不得因恢复后仍保留 `voided_at` 而继续隐藏。恢复必须保留作废快照与全部版本，原因进入不可变审计，具体不变量见 [ADR-024](./docs/adr/ADR-024.md)。任务组成员关系是 MAIN/SOURCE 身份的唯一真相。业务历史默认通过归档、作废或新版本保留，不物理覆盖或删除。
- 历史迁移一经合并不得修改、删除或重排。新迁移采用 expand/contract 思路，必须支持从上一正式版本验证升级和回滚兼容窗口。
- API 进程不得在启动时自动生成 Schema。迁移由独立、受限的 migration 任务执行。
- Repository/Application 集成测试必须使用真实 PostgreSQL 验证事务、锁、约束和权限，不能只 Mock Repository。
- 数据库迁移、约束、角色和权限变更必须人工评审。

## 7. 认证、鉴权与 Secrets

- 不信任客户端提交的 `projectId` 来证明资源归属。鉴权必须根据 actor、资源真实归属和实时成员关系在服务端完成。
- 成员关系不得缓存到 Session 或长生命周期对象；搜索和动态查询必须先取得服务端生成的 `AuthorizedProjectScope`，并在 SQL 层过滤。
- 资源不存在和无权访问统一返回 404，避免泄露资源存在性；已登录但缺少全局权限时返回 403。
- Session、CSRF 和预认证 Token 在数据库中只保存 Hash；Cookie、CSRF、MFA、重认证和安全响应头必须遵守技术设计。
- 登录只接受匿名预认证 Session 及其 CSRF Token；已有普通、受限或完整认证 Session 必须先登出，再签发新的预认证 CSRF。停用用户的旧 Session 按无效处理；受保护或业务接口返回 401，但 `issueCsrfToken` 与无效 Session 的同源 `logout` 可按匿名安全语义执行且不得恢复身份。
- 管理员密码与当前 TOTP 重认证成功时，必须以同一服务端事务时间原子刷新 Session 的 `reauthenticated_at` 与 `mfa_verified_at`；高风险接口检查两者均在 5 分钟内。
- 认证 Session 的状态必须由每条签发路径显式赋值，不得默认成为完整认证态；管理员密码阶段只能进入 MFA 注册/验证受限态。恢复码只保存带独立 salt 和参数的 Argon2id 编码哈希，不允许普通 SHA-256 校验。
- Markdown 不允许原始 HTML；用户链接必须使用标准 URL Parser 和协议/域名白名单。V1.2.2 仅保存 GitHub HTTPS 链接，不主动抓取远程内容。
- 禁止读取、打印、记录、提交或复制 Secrets。`.env.example` 只放非敏感变量名，不放 Secret 示例值或占位值。
- 生产 Secret 只从 `/run/secrets/*` 读取；缺失、空值、路径越界或权限不合规必须 fail closed，不允许敏感环境变量 fallback。
- 若发现 Secret 已进入 Git 历史，立即停止传播，通知维护者先撤销/轮换，再制定历史清理方案；仅新增一次删除提交不视为完成处置。

## 8. 测试与验证

- 行为变更应先写或更新能失败的测试，再小步实现；修复缺陷必须覆盖回归路径。
- 先运行最小相关测试，再运行类型检查和模块测试；交付前运行所有适用于本次变更的完整门禁。
- 必须覆盖真实数据库约束、事务回滚、权限矩阵、幂等、乐观锁、并发竞态、请求/响应契约和关键 E2E 路径。
- 不得使用 `skip`、降低断言或删除用例来掩盖失败；确需隔离不稳定测试时必须说明原因、影响和恢复计划，并获得人工同意。
- 审计哈希链必须使用真实 PostgreSQL 验证同一 scope 至少 100 个并发业务事务；不得把测试拆成较低阈值后声称满足该门禁。若 CI 连接池无法支撑，必须提供容量依据并通过 ADR 调整，不得同时保留多个验收数字。
- 完整 CI 顺序以技术设计第 12 章为准。新增根脚本后，`README.md`、本文件和 CI 必须同时更新为同一组实际命令。

- 阶段 0 CI 最小链路已落库：根级可运行命令为 `pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm format`、`pnpm format:check`、`pnpm typecheck`、`pnpm test:unit`、`pnpm test:web`、`pnpm test:integration`、`pnpm db:migrations:check`、`pnpm db:migrate`、`pnpm contract:generate`、`pnpm contract:drift`、`pnpm contract:validate`、`pnpm build`、`pnpm test:e2e`、`pnpm check:deploy:test`、`pnpm check:deps`、`pnpm check:frontend:boundaries`、`pnpm permissions:check`、`pnpm deps:audit`、`pnpm check:secrets`、`pnpm check:docs`，以及一次跑完全部非数据库门禁的 `pnpm check`。GitHub Actions 的 `CI / workspace` job 按技术设计 §12.4 顺序执行同一组命令，`Documentation / docs` job 只执行 `check:docs`。因为 `0003_search_pgroonga.sql` 在缺少 PGroonga 时 fail closed，CI 先用 `database/poc/search-pgroonga/Dockerfile.pgroonga-pg18.6` 基于 digest 固定的 `postgres:18.6` 构建探针镜像，再按 `database/scripts/test-local.ps1` 的同一顺序执行 `000_roles.sql`、`020_pgroonga.sql`、空库迁移与集成测试；该探针镜像只服务 CI 与 PoC，不是生产部署镜像，也不等同于 §12.4 的容器镜像构建门禁。`pnpm db:migrate`、`pnpm test:integration`、`pnpm db:test` 与 `pnpm db:test:local` 需要已安装 PGroonga 的 PostgreSQL 18 实例，不含 PGroonga 的官方 PostgreSQL 18.6 安装会让 `db:test:local` 按设计直接失败；本机 PostgreSQL 18.6（`D:\PostgreSQL\18\pgsql`）已内置 PGroonga 4.0.8，`db:test:local` 与 API `test:integration` 均已在本地实测通过。`pnpm test:search:db` 与 `pnpm test` 还要求 `max_connections >= 150`，二者按既定决定尚未纳入 CI。`check:docs` 同时检查 HEAD、暂存区、工作区、未忽略的新文件和 Markdown 链接/锚点；`deps:audit` 需要访问 registry，曾因 `origin/main` PR #16 的 `@testing-library/*` -> `@testing-library/dom` -> `pretty-format@27.0.2` 带入 `ansi-regex@5.0.0`（GHSA-93q8-gq69-wqmw，high，补丁 `>=5.0.1`）而失败，已由 `pnpm-workspace.yaml` 的 `overrides` 把 `ansi-regex` 固定到 `^5.0.1`（lockfile 落为 `5.0.1`）解决；此前本地 `pnpm deps:audit` 与 `pnpm check` 已通过；当前本机 npm 镜像缺少 audit endpoint 时需用公共 registry 执行 `pnpm audit --registry=https://registry.npmjs.org`（2026-09-08 已验证无漏洞），该依赖变更为 dev 工具链，仍须按第 4 节作为独立依赖升级 PR 由人工确认。`test:integration` 已包含技术设计 §12.3/§12.4 要求的数据库角色与权限探针。Playwright 浏览器 E2E 测试基座已落库并纳入 `CI / workspace`（当前 Playwright 29 例：项目创建关键路径、F-03 用户管理、F-05 项目成员管理、F-13 功能档案、F-14 功能级任务、F-16 任务状态闭环、F-17 独立草稿、F-18 记录发布、搜索边界、F-27 项目动态专属路径与 F-28 通知状态联动已覆盖，其余完整关键路径待覆盖）；`deploy/compose.yaml`（§11.2 稳态拓扑预检，环境变量按当前代码实际名称）与镜像 ref 预检已落库，`pnpm check:deploy:test` 使用合成 ref 正例校验 compose 渲染、exact-tag@sha256 格式、PostgreSQL 18 命名卷挂载、非 root/只读/资源限制/健康检查/端口等结构，CI 另用 `.env.deploy.example` 验证占位符被拒绝；生产 Dockerfile（API/Migration/Web/DB-bootstrap）与基础镜像 digest 已按 [ADR-017](./docs/adr/ADR-017.md) 定案，§12.4 的容器镜像构建与 Trivy 镜像扫描已纳入 CI / workspace；真实镜像 Tag/digest 绑定与签名发布清单仍在发布环节由人工完成。`CI / workspace` 在同一 ref 上取消被新推送取代的在运行流水线（`main` 上的运行不取消）（曾试把 `apps/api` 的 `test:unit` 改为并行执行单元测试文件，CI 实测反而略慢：`apps/api test:unit` Duration 由 35.99s 变为 40.14s，原因是该套件在 4 vCPU runner 上受模块导入与 worker 启动开销支配，已回退为原串行方式）；这些只改变耗时，不改变 §12.4 的门禁顺序与判定。2026-09-10 用 `gh run view` 读到单次运行约 16 分钟，其中 `pnpm install --frozen-lockfile` 仅约 13 秒，因此没有为 pnpm store 引入缓存步骤；当前主要耗时项是 Browser E2E、生产镜像构建与 Trivy 扫描。CI 另为 Playwright 的 Chromium 增加 `actions/cache` 步骤缓存 `~/.cache/ms-playwright`（action 固定到 `v5.1.0` 的提交，键绑定 `pnpm-lock.yaml`），因为实测 Install Playwright browser 在 25s~116s 之间波动；Trivy 漏洞库已由 `trivy-action` 自带缓存，未再重复配置。生产镜像的 builder 改为先复制依赖清单（根 manifest、各 workspace 包 `package.json`、lockfile、`.npmrc`）再执行 `pnpm install --frozen-lockfile`，之后才 `COPY . .`，使依赖层不随源码失效；镜像构建改用 container driver 的 buildx 并带 `type=gha` 层缓存（各镜像独立 cache scope 与 `ignore-error=true`），对应 CI 的 Set up Docker Buildx with GHA layer cache 步骤；新增 workspace 包必须同步 `deploy/docker/{api,migration,web}.Dockerfile` 的依赖清单，否则 `--frozen-lockfile` 会因 lockfile 与 manifests 不一致而失败。设计一致性仍需人工检查，不得伪称已运行不存在或未执行的门禁。
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
- 阶段 0 仍待建立的入口：其余业务关键路径 E2E、生产容器镜像构建、exact-tag/digest 格式校验（Compose 渲染与 ref 预检已落库为 `pnpm check:deploy` 与 CI 门禁）、镜像扫描，以及生产加密备份恢复。统一的根级安装、lint、格式、类型检查、单元测试、集成测试、生成物漂移检查、构建入口与 compose/ref 预检已落库；其余入口只有实际脚本落库后才能把命令写成可执行说明。

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

完成一项后应在同一 PR 中更新本节并链接对应证据，避免保留已经解决的阻断描述。
