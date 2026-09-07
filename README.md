# InPulse

软件研发功能迭代记录与任务协作系统，用于统一管理项目、模块、功能、任务、迭代记录及其历史关系。

> 当前状态：阶段 0 实施中。PostgreSQL 数据库、显式迁移、角色隔离和真实数据库集成测试基线已落地；PGroonga V1 搜索 PoC 已通过语义、Recall@20、边界和跨项目隔离，ADR-025 已记录；PostgreSQL 18.6 官方基线与正式产品搜索实现尚未验证和开始。应用代码尚未开始。

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
| 已完成 | 候选设计与 ADR；PostgreSQL 18 Schema、三条显式迁移、最小权限角色、迁移器及 100 并发真实数据库门禁；PGroonga V1 PoC、90 条金标 Recall@20=100%、跨项目/边界验证；ADR-025 替代 ADR-010 |
| 下一步 | 在 PostgreSQL 18.6 官方基线验证 PGroonga 构建、迁移、默认计划和恢复；随后基于数据库事务契约实现 API 契约、认证、领域模块、正式搜索索引与前端 |
| 已提供 | pnpm workspace、严格 TypeScript、数据库类型检查/迁移/集成测试、PGroonga 与原 pg_trgm 搜索 PoC 工具链，以及文档检查 |
| 尚未提供 | API/Web 应用源代码、应用 lint/build/E2E 和生产部署产物 |

当前已验证的数据库与文档命令：

```shell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm db:migrations:check
pnpm db:migrate
pnpm db:test
node scripts/check_docs.mjs
```

PGroonga 搜索 PoC 使用 Docker 启动一次性
`groonga/pgroonga:4.0.8-alpine-18`，执行迁移、现有数据库测试、V1 语义探针、
90 条金标召回、跨项目隔离和查询计划验证。当前 PoC 使用内置 PostgreSQL
18.4，尚不能替代 PostgreSQL 18.6 官方基线；完整结论见
[PGroonga PoC 说明](./database/poc/search-pgroonga/README.md)。

```powershell
pnpm db:poc:search:pgroonga:local
```

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
- [PGroonga V1 PoC 结果](./docs/poc/search-pgroonga-v1-result.md)：V1 范围、9 组语义探针、Recall@20 与 ADR-025；
- [PGroonga PoC](./database/poc/search-pgroonga/README.md)：复现命令、策略矩阵、索引证据与限制；
- [原 pg_trgm PoC](./database/poc/search/README.md)：原门禁失败证据、数据规模、GIN 计划结论。

功能、系统与技术设计及正式 ADR 同步构成候选开发基线。发现冲突时，应先通过 ADR 或同步修订消除歧义，不得由实现者自行选择。

## 许可证

本仓库目前未发布开源许可证，请勿将其视为可自由使用、修改或分发的开源项目。
