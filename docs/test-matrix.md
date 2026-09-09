# 测试矩阵

状态：已接受的验收基线。当前仓库处于阶段 0 实施中，尚无完整业务应用代码，数据库真实 PostgreSQL 测试与搜索服务/HTTP API 集成测试已部分落地；`已自动化` 表示该检查的脚本已落库并已纳入 `.github/workflows/ci.yml`（实际执行证据见各章节的状态说明），`Required` 表示对应阶段必须实现并由 CI 执行，不代表测试已经通过。

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
| PROJ-CREATE-008 | 前端单元 | 项目创建表单与页面 | RHF + Zod 校验、CSRF/幂等 Key、错误映射、创建成功与入口交互均通过生成客户端消费契约 | 本地通过（`project-query.test.tsx`、`CreateProjectModal.test.tsx`、`ProjectsPage.test.tsx` 等，前端 19 文件 45 例） |
| PROJ-CREATE-009 | Playwright E2E | 项目创建关键路径 | 登录 → `/projects` → RHF 表单创建 → 项目动态 → 搜索到项目 → 站内通知 | 本地 6/6 通过（2026-09-09） |

实现文件：`apps/api/test/project-bootstrap.integration.test.ts`（4 例）与
`apps/api/test/project-code.test.ts`（7 例）。前者需 `TEST_DATABASE_URL` 指向已安装
PGroonga 的 PostgreSQL 18 实例并先执行 `pnpm db:migrate`，由 API 集成测试配置
（`vitest.integration.config.ts`）运行；本机已用 PostgreSQL 18.6 + PGroonga 实测通过，
GitHub Actions 的 CI 尚未就本 PR 执行。

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
| CI-017 | E2E | Playwright 关键路径 | 登录、项目创建到动态/搜索/通知关键路径通过；任务完成、合并/解除任务组、遗留项转任务等路径仍待覆盖 | 本地 6/6 通过（项目创建首条业务关键路径已覆盖）；其余完整关键路径 Required |
| CI-018 | CI | 容器镜像与 Compose | 镜像构建成功、`compose config` 渲染通过、全部运行与基础镜像为 exact-tag@sha256 digest、PostgreSQL 18 命名卷挂载 `/var/lib/postgresql`、容器非 root | Required（Compose/ref 预检已自动化；镜像构建、受信 digest 与扫描仍待 F-10.1/F-10.2） |
| CI-019 | CI | 镜像扫描 | 运行与基础镜像漏洞扫描无 high 及以上未处置项 | Required |

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
> 运行本身尚未执行。CI-017 的 Playwright 基座已于 2026-09-09 在本机 6/6 通过，其中项目创建关键路径已覆盖，其余完整关键路径仍为 Required，本 PR 的 GitHub Actions 执行结果待确认；CI-018 的 `compose config` 渲染、exact-tag@sha256
> 格式、PostgreSQL 18 命名卷挂载、非 root/只读/资源限制/健康检查/端口检查已由
> `pnpm check:deploy:test` 落库（合成 ref，不代表受信镜像已构建），生产镜像构建与
> 真实 digest 仍待 F-10.1/F-10.2，落地后必须按 §12.4 顺序插入 CI；CI-019 因尚无生产 Dockerfile、受信 digest 与镜像扫描而未落库。F-31 覆盖见“Playwright 浏览器测试基座”一节。


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
| AUDIT-001 | PostgreSQL 并发 | 至少 100 个同 scope 并发业务事务 | 链无分叉、无序号缺口，每个成功业务事件恰有一条审计；见 [ADR-008](adr/ADR-008.md) | 已自动化（阶段 0 数据库层：100 并发事务追加同一项目链，序号连续且无分叉；业务命令接入后须重跑，见 CI-008） |
| AUDIT-002 | PostgreSQL 并发 | 多 scope 与链头初始化竞争 | 按 UTF-8 scope 顺序加锁，无死锁或重复链头 | Required |
| AUDIT-003 | PostgreSQL 集成 | 事务回滚 | 业务、审计行与链头同时回滚 | Required |
| AUDIT-004 | 恢复演练 | 密钥轮换、备份与恢复 | 数据库链、链头、远端检查点和归档明细全部一致 | Required |
| SEC-001 | 权限集成 | 数据库角色 | runtime 无 DDL/原始审计 SELECT；writer 不能改历史；reader 只读 | 已自动化（阶段 0 数据库层，见 CI-008） |
| SEC-002 | 浏览器 E2E | nonce CSP | 强制模式下核心页面可用，script/style 均无 `unsafe-inline` | Required |
| SEC-003 | API/浏览器 E2E | CSRF 生命周期 | 首登、轮换、刷新、多标签、过期和“仅未消费状态可最多重签一次”均符合 ADR-015；普通幂等路由保留 Key/If-Match，securityFlow 不发送业务幂等键 | Required |
| SEC-004 | API 集成 | ExternalLinks | 只接受规范化的 `https://github.com/...`；拒绝 HTTP、用户信息、非默认端口、`api.github.com` 与混淆域名；不配置 Token、不发远程请求；跨项目关联失败且并发不重复 | Required |
| SEC-005 | API + PostgreSQL 并发/E2E | 一次性认证安全流程 | 管理员密码阶段显式签发受限态，绝不能因默认值成为完整态；同一 preauth+CSRF 只能成功登录一次；用户级 enrollment generation 在 start-vs-start、start-vs-confirm 及跨 Session 竞争中只有一个条件更新成功；同一 rotation generation、验证 Session、TOTP time-step 或恢复码只能被对应操作接受一次；确认注册原子轮换为完整 Session/新 CSRF，重认证原子刷新双时间戳；恢复码仅存 Argon2id 哈希；重复 CSRF 签发允许，无效 Session 重复登出为 204；九个 operationId 的响应丢失均按 ADR-023 路径恢复 | Required |
| SEC-006 | API 集成 | 未匹配路由的错误契约净化 | 任意未匹配路径返回 `application/json` 的统一 404 `{ code, message, details, requestId }`，message 为固定文案且不回显 method、path 或框架内部文本，响应带 `X-Request-Id` 并保留应用 CSP，不返回框架或 Express 默认 HTML；已匹配路由不受影响；见 [ADR-026](adr/ADR-026.md) | Required |
| SEC-007 | 部署集成 | 数据库 Secret 文件缺失 | 生产模式 fail closed，不得回退到环境变量；缺失路径、越界路径、空值和权限不合规均拒绝连接串构造 | Required |
| SEC-008 | API + PostgreSQL 集成 | 登录爆破限流 | 登录失败按账号 + IP + 全局三层计数，任一桶达到候选阈值返回 429 并在 Argon2 前阻断；同一进程 Argon2 并发不超过候选上限；登录成功清除账号失败计数；桶维度只保存 HMAC-SHA-256 摘要 | 已自动化（单元与真实 PostgreSQL 用例已落库，待 CI 执行） |
| SEC-009 | Application + PostgreSQL 集成 | 用户停用/改密/强退 Session 失效 | 同一事务递增 `users.auth_version`（并推进 `row_version`）后撤销该用户全部未撤销 Session；旧 Session 在下一请求因 `auth_version` 不一致或已撤销而返回 401 | 已自动化（单元与真实 PostgreSQL 用例已落库，待 CI 执行） |

## 搜索、部署与恢复

| ID | 阶段 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| SEARCH-001 | 阶段 0 | 中文/标识符可行性金标 | ≥1,000 投影、≥100 查询、Recall@20 ≥90%，目标查询使用 PGroonga `pgroonga_text_full_text_search_ops_v2`，普通输入经 `pgroonga_query_escape`，跨项目 0 条 | Required |
| SEARCH-002 | 阶段 4 | 峰值容量 | ≥100,000 且 ≥五年峰值 1.2 倍；30 并发 10 分钟；预热 P95 <500ms/P99 <1s | Required |
| SEARCH-003 | 阶段 0 | `GET /api/v1/search` API 契约纵切片 | Schema Registry、Route Registry、权限矩阵与 Controller 绑定一致；生成 OpenAPI 与客户端无漂移；`q/cursor/limit/includeVoid` 边界、`SearchItem` 判别字段、`SearchPage` 的 `items/nextCursor/hasMore` envelope、不透明游标的 HMAC 签名/篡改/过期/绑定验证与 `422` 映射由单元测试覆盖；真实 PostgreSQL 分页继续验证签名游标可用 | 已自动化（契约、游标、Controller 单测和真实 HTTP API 集成测试已落库；前端搜索页面单测已本地覆盖；Playwright E2E 仍为 Required；本次改动尚未在 GitHub Actions 执行） |
| SEARCH-004 | 阶段 0 | `SearchProjectionWritePort` | 显式接收同一 `TransactionContext`，规范化 `rawText` 后 upsert；同一 `(project_id,entity_type,entity_id)` 不重复；更新可同步 `visibility_scope/source_status/source_row_version`；旧 `source_row_version` 不覆盖较新状态；后续业务异常整体回滚 | 已自动化（`SearchProjectionModule` 注入单测 + 真实 PostgreSQL 4 例已本地通过；GitHub Actions 待执行） |

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
> 14 个文件 60 例通过。C 已本地完成搜索页面与前端认证最小纵切片，前端单测覆盖查询、签名游标分页、短词与 401 错误、认证上下文、登录与登出；仍缺少 Playwright E2E 和生产备份恢复纵切片。
> 2026-09-08 新增 `SearchProjectionWritePort`：独立 `SearchProjectionModule`、
> PostgreSQL upsert 适配器、输入校验、NFKC/大小写/空白/标点规范化和
> `source_row_version` 防旧写；模块注入单测与真实 PostgreSQL 4 例已本地通过。
> 本次非数据库门禁已在本地通过：lint、格式、全 workspace typecheck、单元测试、
> 迁移/契约检查、构建、依赖边界、权限矩阵、Secret 与文档检查；`deps:audit`
> 因本地 npm 镜像无 audit endpoint，改用公共 registry 验证为无漏洞。GitHub Actions 尚未执行。

| DEPLOY-001 | 阶段 0 | 空库迁移与角色 | 独立迁移任务成功，应用启动不迁移，runtime 无 DDL | 部分自动化（空库迁移与 runtime DDL 见 CI-007/CI-008；`apps/api` 启动不迁移尚无断言） |
| DEPLOY-002 | 上线前 | 可复现镜像 | 精确 Tag 与 digest、一致 lockfile、非 root 运行、健康检查通过 | Required |
| RECOVERY-001 | 上线前及演练 | 全新主机恢复 | 达到记录的 RPO/RTO；旧 Session 失效；审计链与检查点一致；恢复发布清单中的全部版本化 keyring，并保留仍被未过期幂等记录引用的 fingerprint key | Required |

## 前端基础框架与边界治理 (F-30)

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| FE-001 | 单元测试 | 动态路由聚合与防重 | `buildRouteObjects` 支持 `AppRouteModule` 转换，检测并拒绝重复路径，正确传递 `requiresAuth`/`requiresAdmin` | 已自动化 |
| FE-002 | 单元测试 | 声明式鉴权与管理员守卫 | `RequireAuth` / `RequireAdmin` 支持 `loading`、`anonymous`、`error` 提示，普通用户拦截及管理员放行 | 已自动化 |
| FE-003 | 单元测试 | 全局错误边界与恢复 | `AppErrorBoundary` 捕获 UI 渲染异常，展示 Ant Design 提示并支持重置重试 | 已自动化 |
| FE-004 | 单元测试 | 409 数据冲突交互规范 | `ConflictNotice` 保留本地未提交输入，提示冲突原因并提供重新加载最新数据回调 | 已自动化 |
| FE-005 | 架构门禁 | 前端分层依赖检查 | `dependency-cruiser` 确保单向依赖（`app -> pages -> features -> shared/generated`），禁止反向/跨层与循环依赖 | 已自动化 |
| FE-006 | 单元测试 | 全局搜索页面纵切片 | `SearchPageView` 通过生成客户端消费 `getSearch`，覆盖 `q`、签名游标分页、短词提示与 401 不泄露服务端细节；顶部搜索框提交导航 `/search?q=...` | 已自动化（本地前端 12 文件 32 例通过；GitHub Actions 尚未执行） |
| FE-007 | 单元测试 | 真实认证上下文与登录表单 | `AuthProvider` 覆盖挂载恢复会话、匿名 CSRF bootstrap、登录、登出与 MFA 不认证；`LoginForm` 覆盖失败提示与成功回调 | 已自动化（本地前端 12 文件 32 例通过；GitHub Actions 尚未执行） |

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
| CONTRACT-001 | 契约与权限 | F-27/F-28 路由登记 | 12 条 Route Registry 与 Schema、OpenAPI、生成客户端、Controller 扫描、权限矩阵一一对应；`contract:drift`、`contract:validate`、`permissions:check` 均通过 | 本地通过；GitHub Actions 尚未执行 |

后端本次新增/扩展的真实 PostgreSQL 集成共 20 例（活动投影 4、活动查询 4、通知状态 6、HTTP 集成 4、Session 回归 2），API 集成全量 18 文件 78 例通过；前端全量 16 文件 39 例通过。F-04 项目创建 Workflow 已接入活动、通知与搜索投影；任务完成、记录作废/恢复、合并等业务 Workflow 尚未接入活动/通知写端口，因此这些业务事件尚未在生产侧生成。
>
> 2026-09-09 更新：F-04 项目创建前端纵切片新增 `project-form.ts`、`project-query.ts`、`CreateProjectModal.tsx`、`ProjectsPageView.tsx`；`/projects` 改为 `requiresAuth`；Playwright 项目创建用例覆盖创建 → 动态 → 搜索 → 通知。API 单测 38 文件 177 例、前端 19 文件 45 例、API 集成 21 文件 87 例、database 集成 13 例、Playwright 6/6 均本地通过；GitHub Actions 尚未执行。

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
