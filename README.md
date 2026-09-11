# InPulse

软件研发功能迭代记录与任务协作系统，用于统一管理项目、模块、功能、任务、迭代记录及其历史关系。

> 当前状态：阶段 0 实施中。PostgreSQL 数据库、`0000-0005` 显式迁移（含 PGroonga 索引与旧 `pg_trgm` contract 清理）、角色隔离和真实数据库集成测试基线已落地；阶段 0 CI 最小链路已按[技术设计 §12.4](./技术设计v1.2.2.md#124-ci-门禁)顺序落库（安装、lint、format check、typecheck、单测、空库迁移、真实 PostgreSQL 集成测试、契约漂移与完整性、生产构建、Playwright 浏览器 E2E 基座、Compose/镜像 ref 预检、依赖边界、权限矩阵、依赖/Secret 扫描），CI 用仓库内探针 Dockerfile 基于 digest 固定的 `postgres:18.6` 构建带 PGroonga 的测试库；API 契约生成链路已落库，生成工具决策见 [ADR-027](./docs/adr/ADR-027.md)（`Accepted`，2026-09-07）；PGroonga V1 搜索 PoC 已在 PostgreSQL 18.6 探针镜像上通过语义、Recall@20、边界、跨项目隔离、默认查询计划和逻辑恢复，ADR-025 已记录；SearchQueryService 服务层与生产 `ProjectAccessQueryPort` 适配器、通用 `SessionAuthService` 已落地；`GET /api/v1/search` 契约纵切片已落地 Schema、Route Registry、OpenAPI、生成客户端、最小 Controller、服务端签名游标与真实 `hasMore`，C-006 已由 A 于 2026-09-08 正式确认；认证纵切片已包含 `GET /auth/csrf`、`POST /auth/login`、`POST /auth/logout`、`GET /me`，并已加入登录限流与 Session 统一失效。真实 HTTP API 集成测试已落库并在本机真实 PostgreSQL 上通过，搜索相关 PR #68 GitHub Actions 已通过；搜索页面最小纵切片已通过生成客户端接入真实 `GET /api/v1/search`，支持关键词、分类展示与签名游标分页，搜索边界、F-27/F-28 项目动态与通知状态 Playwright E2E 已本地 16/16（含 F-13 功能档案）；F-27 项目动态与 F-28 站内通知的 API 契约、读写端口和前端页面已落地；F-04 项目创建后端 Workflow 与前端纵切片已落地，并通过真实 E2E 验证创建 → 动态 → 搜索 → 站内通知；创建表单已接入 `GET /api/v1/users` 选择初始成员，公共应用壳、项目页、全局命令面板、通知弹层与活动页已按设计师最新视觉迁移，通知可直达项目动态；生产容器镜像（API/Migration/Web/DB-bootstrap/Ops，`deploy/docker/*.Dockerfile`）与 Nginx 生产配置、镜像构建/Trivy 扫描门禁已落库，基础镜像 digest 已按 [ADR-017](./docs/adr/ADR-017.md) 固定；真实镜像 Tag/digest 绑定与签名发布清单仍由发布环节完成；任务完成、记录作废/恢复、合并等业务事件尚未接入；业务领域模块与其余 Playwright 完整关键路径 E2E 仍待补齐；Playwright 浏览器测试基座、Compose 稳态拓扑与镜像 ref 预检已落库，但仅校验结构与格式，不代表可启动生产部署。

## 项目目标

InPulse 面向国内单企业、单实例的软件研发团队，目标规模为 10～300 名用户，重点保证：

- 任务、迭代记录、合并关系和操作历史可追溯；
- 核心业务操作保持事务一致，不丢失数据、不串项目、不产生半完成状态；
- 权限、并发冲突和数据库不变量可由自动化检查验证；
- 1～3 人、以 AI 编码代理为主要生产力的团队可以长期维护。

候选系统采用 React SPA、NestJS 模块化单体和单一 PostgreSQL 数据库。完整业务范围、业务规则、架构边界、版本候选项和非目标以功能设计、系统设计与技术设计为准，README 不重复维护这些清单。

## 当前仓库状态

| 状态 | 内容 |
|---|---|
| 已完成 | 候选设计与 ADR；PostgreSQL 18 Schema、八条显式迁移（`0000-0007`，含 `0003_search_pgroonga.sql` 索引与 `0004/0005` 旧 `pg_trgm` contract 清理）、最小权限角色、迁移器与 100 并发真实数据库门禁；阶段 0 工程基座骨架（pnpm workspace、Prettier 格式基线、根级 typecheck/lint/build）与按 §12.4 顺序执行的 CI 链路；API 契约双真相（Schema Registry/Zod + Route Registry）、OpenAPI 3.1 与 TypeScript 客户端生成、漂移与完整性检查、可执行权限矩阵；Nest 运行期契约绑定与统一错误模型（[ADR-029](./docs/adr/ADR-029.md)）、F-01 Session 分批清理、审计 HMAC 惰性轮换与同事务回滚；依赖边界与 Secret 扫描；F-30 前端基座（路由、鉴权守卫、错误边界、Ant Design 主题与 Provider、`@app/@pages/@features/@shared/@generated` 路径别名、jsdom 单测与 dependency-cruiser 边界规则）；PGroonga V1 PoC、15 组语义探针、200 条冻结金标（phase4-v1）Recall@20=100%、跨项目/边界、PostgreSQL 18.6 探针镜像构建、`EXPLAIN (ANALYZE, BUFFERS)`、`0000-0002 -> 0003-0006` 升级/逐迁移回滚与逻辑恢复验证；SearchQueryService 服务层、`ProjectAccessQueryPort` 契约草案与 8 个真实 PostgreSQL 搜索集成用例；生产 `ProjectAccessQueryPort` 适配器与通用 `SessionAuthService`；`GET /api/v1/search` 契约纵切片（Schema、Route Registry、权限矩阵、OpenAPI、生成客户端、最小 Controller、服务端签名游标与真实 `hasMore`）与 8 个真实 HTTP API 集成用例；搜索页面最小纵切片（`/search` 页面、`features/search`、顶部全局搜索框、`useInfiniteQuery` 签名游标分页与前端单测）；F-27 项目动态与 F-28 站内通知（活动/通知写端口、`AuthorizedProjectScope` 动态读取、通知已读/未读/全部已读、前端页面与铃铛）；F-31 Playwright 浏览器测试基座（真实 UI 登录、匿名保护页、全局搜索与站内通知冒烟、API Session 复用、Vite 代理与 CI 接入）；F-12 模块管理创建/编辑/归档/恢复与审计/活动/搜索同事务，含 100 真实业务命令同链并发证据；F-04 项目创建前端纵切片（`/projects` 登录保护、RHF + Zod 表单、生成客户端 CSRF/幂等调用、创建后动态/搜索/通知 E2E）；用户目录 `GET /api/v1/users` 与创建项目成员选择；设计师最新公共应用壳/项目页/全局命令面板/通知弹层/活动页视觉迁移；生产 API/Migration/Web/DB-bootstrap/Ops 镜像与 Nginx 配置（基础 digest 见 [ADR-017](./docs/adr/ADR-017.md)）、镜像构建与 Trivy 扫描门禁；`operations` profile 的 `backup` 备份服务本体（F-10.3：`pg_dump --format=custom` + AES-256-GCM + SHA-256/签名清单 + 异机 WORM 上传，入口 `deploy/docker/ops.Dockerfile`）与宿主调度接线；ADR-025 替代 ADR-010 |
| 下一步 | A 已正式确认 `{ items, nextCursor, hasMore }` 与不透明游标方向（2026-09-08），C-006 关闭；搜索页面最小纵切片、F-27/F-28 读写与前端纵切片已本地完成，F-04 项目创建前端纵切片已落地并覆盖首个业务关键路径，创建表单已接入用户目录并支持选择初始成员，公共应用壳、项目页、全局命令面板、通知弹层与活动页已按设计师最新视觉迁移，活动页拆分为项目选择入口和项目动态详情，项目创建 Workflow 已接入活动、通知与搜索投影；接下来把任务完成、记录作废/恢复、合并等业务 Workflow 接入活动/通知写端口；补齐其余 Playwright 完整关键路径 E2E、生产加密备份服务与恢复演练（F-10.2/F-10.3）、真实镜像 Tag/digest 签名发布清单（首次建库 `compose.init` 一次性覆盖与[灾难恢复离线 Runbook](./docs/runbooks/disaster-recovery.md) 已提供）；生产 Dockerfile、镜像构建/扫描与基础镜像 digest 已落库（基础 digest 见 [ADR-017](./docs/adr/ADR-017.md)）；Playwright 测试基座、Compose 渲染与 ref 预检已作为阶段 0 门禁落库；真实 HTTP API 集成与前端页面将在 PR 上由 CI 复核；CI 在真实 PR 上稳定后再把 §12.4 门禁设为 required checks |
| 已提供 | pnpm workspace、严格 TypeScript、格式检查、数据库类型检查/迁移/集成测试、应用 typecheck/lint/build、前端单元测试（`pnpm test:web`）与 dependency-cruiser 边界检查、契约生成与漂移检查、权限矩阵检查、依赖边界与 Secret 扫描、依赖漏洞审计、搜索服务真实 PostgreSQL 集成测试、搜索 API 真实 HTTP 集成测试、搜索 API 稳定正式契约（C-006 已确认）、搜索页面最小纵切片、Playwright 浏览器测试基座（`pnpm test:e2e`）、PGroonga 与原 pg_trgm 搜索 PoC 工具链，以及文档检查 |
| 尚未提供 | 任务/记录/合并等其余业务领域模块与 API、其余 Playwright 完整关键路径 E2E、真实全新主机恢复演练（备份服务本体已交付，演练与启用属上线门禁）、真实镜像 Tag/digest 签名发布清单；生产容器镜像与镜像扫描已提供，Playwright 测试基座、Compose 稳态拓扑与镜像 ref 预检已提供，备份调度宿主配置与备份/恢复、升级/回滚 Runbook 已提供（`backup` 服务本体与 `audit-archive` 归档 CLI、compose operations 服务、宿主调度均已交付，见 [备份与恢复 Runbook](./docs/runbooks/backup-restore.md) 与 [审计归档 Runbook](./docs/runbooks/audit-archive.md)） |

> 2026-09-09 更新：登录页已接入 TOTP 注册、验证与恢复码，管理员账户菜单提供密码 + 当前 TOTP 重认证；受限 MFA Session 仅在内存保留，注册/验证/恢复码成功后立即轮换 CSRF Token；前端单测 Web 25 文件 63 例，Playwright 16/16（含真实 TOTP 挑战与重认证；本分支新增搜索边界：跨项目隔离、空态、签名游标分页、中文短词与特殊标识符，并新增项目动态专属路径与通知已读/未读/全部已读联动；rebase 后包含 F-13 功能档案），PR #68 GitHub Actions 已通过（workspace 10m14s，docs 通过）；PR #67 首次 CI 已通过（workspace 9m58s，docs 通过），rebase 后 CI 已通过（workspace 11m7s，docs 通过），API 单测 47 文件 224 例；[PR #63](https://github.com/256-code/InPulse/pull/63) 的 GitHub Actions 已通过（workspace 10m2s，docs 通过）；生产仍需 TOTP KEK 相关 Secret。

> 2026-09-09 补充：F-01 Session 分批清理、F-08 审计密钥惰性轮换与同事务回滚、F-11 Nest 运行期契约绑定和统一错误模型均已本地落库；`pnpm check` 全绿，真实 PostgreSQL 集成 API 124 例、数据库 13 例通过，Playwright 8/8；GitHub Actions 仍在 PR 阶段复核。

> 2026-09-09 F-12 已合入主线；模块创建/编辑/归档/恢复已接入审计、活动与搜索投影，新增 100 个真实 `createModule` 并发业务事务同项目审计链证据，F-12 API 集成 10/10 本地通过。

> 2026-09-09 阶段 1 A 域 F-03 用户管理已本地落库：新增管理员用户列表与创建/编辑/停用/启用/强制退出，写操作要求管理员密码+当前 TOTP 5 分钟双因子重认证、CSRF 与幂等键，停用/强退同事务递增 `auth_version` 并撤销 Session；已合并 `origin/main` `8386b29` 到 F-03 交付分支，本地 API 单测 256 例、真实 PostgreSQL 集成 152 例、Web 单测 87 例、Playwright 18/18 通过；GitHub Actions 尚未执行。

> 2026-09-10 阶段 1 F-05 项目成员管理 Playwright E2E 已补齐：新增 `apps/e2e/tests/project-members.spec.ts` 两个用例（普通成员访问 `/projects/:id/members` 被 `RequireAdmin` 拦截显示 403 空态；管理员登录后完成 5 分钟重认证，经页面添加与移除成员并校验不存在项目的读取失败边界）。分支 rebase 到 `origin/main` `5020c0a` 后本地 `pnpm test:e2e` 29/29 通过（4.7m），`pnpm lint`、`pnpm format:check`、`pnpm --filter @inpulse/e2e typecheck` 均通过；分支 `codex/c-member-e2e` 尚未推送，GitHub Actions 待运行。

> 2026-09-11 备份调度生效时机已定（A）：定时备份（宿主每 12 小时加密备份、排除 Session、SHA-256/签名清单、异机保留与失败告警）是生产上线门禁项，上线时才启用；上线前不部署、不运行定时备份任务，`deploy/compose.yaml` 的 `operations` profile 保持未发布，研发阶段数据安全由开发库自身快照承担。同步把技术设计 §1.3 与系统设计中的每日备份表述统一为与 ADR-020 一致的至少每 12 小时，未改动 ADR-020 决策；本轮仅文档变更，未改代码、迁移、契约源或生成物。

> 2026-09-11 更新：上述上线门禁的宿主侧配置与 Runbook 已本地落库——`deploy/backup/`（`backupctl.sh`、5 个 systemd 单元、非敏感配置示例）、[备份与恢复 Runbook](./docs/runbooks/backup-restore.md) 与 [升级与回滚 Runbook](./docs/runbooks/upgrade-rollback.md)，并由 `pnpm check:deploy:test` 静态校验调度节奏、并发锁、go-live 门禁与凭据文件化；`audit-archive` 归档 CLI、compose 服务与宿主调度已本地落库（F-08 步骤 6，见 [审计归档 Runbook](./docs/runbooks/audit-archive.md)）。

> 2026-09-11 阶段 1 A-1 已本地落库：`operations` profile 新增 `backup` 备份服务本体（`apps/ops` 编译入口 `dist/backup-cli.js backup`：流式 `pg_dump --format=custom` → AES-256-GCM 加密 → SHA-256 与 HMAC 签名清单 → 原子重命名 → 异机 WORM 上传 + 本机 7 天保留）与 `deploy/docker/ops.Dockerfile` 生产镜像（PostgreSQL 18.6 客户端、非 root `10002:10002`、CI 构建与 Trivy 扫描）；迁移 `0007` 为 `app_backup` 补齐 `pg_dump` 所需的表级 SELECT 与序列只读授权（会话表数据仍由 `--exclude-table-data` 排除，角色无写权限）；修复生产镜像 deploy 运行树不自包含的缺陷（`--config.node-linker=hoisted`）；真实全新主机恢复演练与调度启用仍属上线门禁。

下列根级命令已真实可运行，并与 GitHub Actions 的 `CI / workspace` job 按[技术设计 §12.4](./技术设计v1.2.2.md#124-ci-门禁)顺序执行同一组命令；§12.4 中其余 Playwright 完整关键路径 E2E、生产容器镜像构建、真实镜像 digest 绑定与镜像扫描尚未落库；Playwright 测试基座、Compose 渲染与 ref 预检已落库，补齐前请勿假设这些检查已执行。
下列根级命令已真实可运行，并与 GitHub Actions 的 `CI / workspace` job 按[技术设计 §12.4](./技术设计v1.2.2.md#124-ci-门禁)顺序执行同一组命令；生产容器镜像构建与 Trivy 镜像扫描已落库，基础镜像 digest 已按 [ADR-017](./docs/adr/ADR-017.md) 固定；§12.4 中其余 Playwright 完整关键路径 E2E、真实镜像 Tag/digest 绑定与签名发布清单、以及生产加密备份恢复仍未落库，补齐前请勿假设这些检查已执行。

当前可运行的根级命令（§12.4 顺序）：

```shell
pnpm install --frozen-lockfile
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:unit
pnpm db:migrations:check
pnpm db:migrate            # 需要 PostgreSQL 18 + PGroonga
pnpm test:integration      # 需要 PostgreSQL 18 + PGroonga
pnpm contract:drift
pnpm contract:validate
pnpm build
pnpm test:e2e              # 需要 PostgreSQL 18 + PGroonga；先执行 pnpm build
pnpm check:deploy:test      # 需要 Docker；使用合成 ref 校验 compose 结构与 ref 格式
pnpm check:deps
pnpm check:frontend:boundaries
pnpm permissions:check
pnpm deps:audit            # 需要访问 registry
pnpm check:secrets
pnpm check:docs
```

辅助命令：

```shell
pnpm check             # 一次跑完上述全部非数据库门禁
pnpm format            # 用 Prettier 写入格式
pnpm contract:generate # 重新生成 OpenAPI 与 TypeScript 客户端
pnpm test:web          # 只运行 apps/web 单元测试
pnpm check:deploy:test # Compose 渲染 + exact-tag@sha256 + 结构不变量正例
pnpm check:deploy      # 真实发布 ref 检查，需要 deploy/.env.deploy
```

以下命令已落库，但需要已初始化 PostgreSQL 18 + PGroonga 的实例
（`max_connections >= 150`），当前未纳入 CI：

```powershell
pnpm test:search:db
pnpm test
```

`pnpm test:search:db` 运行搜索服务层与真实 HTTP API 集成测试；`pnpm test`
同时运行数据库与搜索服务测试套件。两者都要求先按[数据库说明](./database/README.md)初始化
角色、PGroonga 和迁移，并设置 `MIGRATION_DATABASE_URL` 与
`TEST_DATABASE_URL`。

PGroonga 搜索 PoC 使用仓库内 Dockerfile 构建 PostgreSQL 18.6 探针镜像，
执行迁移、现有数据库测试、V1 语义探针、200 条冻结金标召回、跨项目隔离、查询
计划验证、旧 `pg_trgm` GIN 索引与扩展的 contract 清理，以及排除 Session
数据的逻辑备份恢复与恢复后索引烟雾测试。完整结论见
[PGroonga PoC 说明](./database/poc/search-pgroonga/README.md)。

```powershell
docker build `
  -f database/poc/search-pgroonga/Dockerfile.pgroonga-pg18.6 `
  -t inpulse/pgroonga-pg18.6:repro `
  database/poc/search-pgroonga
powershell -NoProfile -ExecutionPolicy Bypass `
  -File database/scripts/poc-search-pgroonga-local.ps1 `
  -Image inpulse/pgroonga-pg18.6:repro `
  -Port 55436 -RestorePort 55437
```

旧的 `pnpm db:poc:search:pgroonga:local` 仍保留为快速复现入口，但其默认
镜像不是 18.6 探针镜像。

原 `pg_trgm` PoC 作为决策证据保留，命令会因 GIN 默认计划门禁失败而非零
退出，见[原搜索 PoC 说明](./database/poc/search/README.md)：

```powershell
pnpm db:poc:search:local
```

数据库迁移和测试需要 PostgreSQL 18；Windows 可设置 `POSTGRES_BIN` 后运行
`pnpm db:test:local` 自动创建并销毁 loopback 临时实例。环境变量、生产
Secret、角色和功能开发事务契约见[数据库说明](./database/README.md)。

基线冻结的剩余事项只在[仓库开发规则](./AGENTS.md#13-基线冻结剩余事项)维护；实施顺序和验收条件见[技术设计第 14 章](./技术设计v1.2.2.md#14-实施顺序)。

## 文档导航

- [系统设计文档 V1.0.2](./系统设计文档v1.0.2.md)：范围、技术选型、模块划分与安全机制；
- [技术设计 V1.2.2](./技术设计v1.2.2.md)：实施级架构、数据库、事务、安全、测试、部署与阶段验收；
- [功能设计 V1.1](./功能设计v1.1.md)：业务范围、业务规则、角色与核心验收标准；
- [ADR 索引](./docs/adr/README.md)：架构决策的唯一编号、状态和正式记录；
- [权限矩阵](./docs/permissions.md)：身份、操作与资源级授权规则；
- [测试矩阵](./docs/test-matrix.md)：规则到自动化验收的覆盖关系；
- [AGENTS.md](./AGENTS.md)：人工开发者与编码代理都必须遵守的仓库规则；
- [CONTRIBUTING.md](./CONTRIBUTING.md)：分支、提交、Pull Request、评审和发布规则。
- [开发日志](./开发日志.md)：每次推送前记录代码变更、功能、优化、测试验证和后续事项。
- [备份与恢复 Runbook](./docs/runbooks/backup-restore.md)：上线门禁下的加密备份调度、启用/停用、全新主机恢复与演练证据；
- [升级与回滚 Runbook](./docs/runbooks/upgrade-rollback.md)：生产升级顺序、迁移失败处理与代码回滚边界。
- [PGroonga V1 PoC 结果](./docs/poc/search-pgroonga-v1-result.md)：V1 范围、15 组语义探针、Recall@20 与 ADR-025；
- [PGroonga PoC](./database/poc/search-pgroonga/README.md)：复现命令、策略矩阵、索引证据与限制；
- [原 pg_trgm PoC](./database/poc/search/README.md)：原门禁失败证据、数据规模、GIN 计划结论。

功能、系统与技术设计及正式 ADR 同步构成候选开发基线。发现冲突时，应先通过 ADR 或同步修订消除歧义，不得由实现者自行选择。

## 许可证

本仓库目前未发布开源许可证，请勿将其视为可自由使用、修改或分发的开源项目。
