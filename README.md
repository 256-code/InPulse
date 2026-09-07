# InPulse

软件研发功能迭代记录与任务协作系统，用于统一管理项目、模块、功能、任务、迭代记录及其历史关系。

> 当前状态：阶段 0 实施中。PostgreSQL 数据库、显式迁移、角色隔离和真实数据库集成测试基线已落地；阶段 0 工程基座骨架（pnpm workspace、根级 typecheck/lint/build、最小 API/Web 骨架与 CI）已落库；PGroonga V1 搜索 PoC 已在 PostgreSQL 18.6 探针镜像上通过语义、Recall@20、边界、跨项目隔离、默认查询计划和逻辑恢复，ADR-025 已记录；正式 `search_projection` PGroonga bootstrap 与 `0003-0005` 显式迁移（含旧 `pg_trgm` contract 清理）已落库并通过数据库集成测试。SearchQueryService 服务层与 `ProjectAccessQueryPort` 契约草案已落地，并通过真实 PostgreSQL 集成测试验证参数化查询、权限 Scope、跨项目隔离、`ADMIN_ONLY/HIDDEN`、分页、普通金标召回与 PGroonga 索引计划；生产 `ProjectAccessQueryPort` 适配器、搜索 API/Controller、前端与业务领域模块仍未开始。

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
| 已完成 | 候选设计与 ADR；PostgreSQL 18 Schema、六条显式迁移（`0000-0005`，含 `0003_search_pgroonga.sql` 索引与 `0004/0005` 旧 `pg_trgm` contract 清理）、最小权限角色、迁移器与 100 并发真实数据库门禁；阶段 0 工程基座骨架（pnpm workspace、根级 typecheck/lint/build 与最小 CI 链路）；PGroonga V1 PoC、15 组语义探针、90 条金标 Recall@20=100%、跨项目/边界、PostgreSQL 18.6 探针镜像构建、`EXPLAIN (ANALYZE, BUFFERS)`、`0000-0002 -> 0003-0005` 升级/逐迁移回滚与逻辑恢复验证；SearchQueryService 服务层、`ProjectAccessQueryPort` 契约草案与 8 个真实 PostgreSQL 搜索集成用例；ADR-025 替代 ADR-010 |
| 下一步 | 在 Schema Registry + Route Registry 定案后接入搜索 API/Controller、生产 `ProjectAccessQueryPort` 适配器与前端；随后继续认证、业务领域模块；补齐契约生成链路、生产镜像、加密备份恢复与其余 CI 门禁 |
| 已提供 | pnpm workspace、严格 TypeScript、数据库类型检查/迁移/集成测试、应用 typecheck/lint/build、前端单元测试基座（`pnpm test:web`）、搜索服务真实 PostgreSQL 集成测试、PGroonga 与原 pg_trgm 搜索 PoC 工具链，以及文档检查 |
| 尚未提供 | API 契约生成链路、生产 `ProjectAccessQueryPort` 适配器、搜索 API/Controller/页面、E2E 和生产部署产物 |

以下根级命令由 GitHub Actions 的 `CI / workspace` job 执行；阶段 0 其余门禁仍在建设中，补齐前请勿假设其他命令可用。

CI 当前执行的根级命令：

```shell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm build
pnpm db:migrations:check
pnpm check:docs
```

以下命令已落库，可用于前端单测或边界检查，当前未纳入 CI：

```powershell
pnpm test:web
pnpm check:frontend:boundaries
```

以下命令已落库，但需要已初始化 PostgreSQL 18 + PGroonga 的实例
（`max_connections >= 150`），当前未纳入 CI：

```powershell
pnpm test:search:db
pnpm test
```

`pnpm test:search:db` 只运行搜索服务集成测试；`pnpm test` 同时运行数据库与
搜索服务测试套件。两者都要求先按[数据库说明](./database/README.md)初始化
角色、PGroonga 和迁移，并设置 `MIGRATION_DATABASE_URL` 与
`TEST_DATABASE_URL`。

PGroonga 搜索 PoC 使用仓库内 Dockerfile 构建 PostgreSQL 18.6 探针镜像，
执行迁移、现有数据库测试、V1 语义探针、90 条金标召回、跨项目隔离、查询
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
- [PGroonga V1 PoC 结果](./docs/poc/search-pgroonga-v1-result.md)：V1 范围、15 组语义探针、Recall@20 与 ADR-025；
- [PGroonga PoC](./database/poc/search-pgroonga/README.md)：复现命令、策略矩阵、索引证据与限制；
- [原 pg_trgm PoC](./database/poc/search/README.md)：原门禁失败证据、数据规模、GIN 计划结论。

功能、系统与技术设计及正式 ADR 同步构成候选开发基线。发现冲突时，应先通过 ADR 或同步修订消除歧义，不得由实现者自行选择。

## 许可证

本仓库目前未发布开源许可证，请勿将其视为可自由使用、修改或分发的开源项目。
