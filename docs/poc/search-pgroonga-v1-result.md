# PGroonga V1 搜索 PoC 结果

## 状态

本文是 [ADR-025](../adr/ADR-025.md) 的 V1 搜索技术验证证据。ADR-025 已
记录并替代 ADR-010；ADR-011 保持原内容不变。PostgreSQL 18.6 探针镜像
验证与正式 `search_projection` bootstrap/迁移已经完成；SearchQueryService
服务层与真实 PostgreSQL 参数化/权限过滤测试已实现，搜索 API/Controller、
页面与生产部署仍在后续纵切片。

## V1 搜索范围

| 搜索类型 | 是否纳入 V1 | 预期 |
| --- | --- | --- |
| 中文短词 | 是 | 必须支持 |
| 完整英文缩写 | 是 | 必须支持 |
| 完整代码标识符 | 是 | 必须支持 |
| 完整编号 | 是 | 必须支持 |
| 任意英文子串 | 否 | 不作为 V1 门禁 |
| 任意代码子串 | 否 | 不作为 V1 门禁 |
| 正则表达式搜索 | 否 | 不纳入 V1 |

V1 明确接受的示例包括 `MFA`、`CSRF`、`payment_callback`、
`task_group_id`、`R-42`、`PR-245`、`退款`、`回调`。`callback`、
`R-4`、`roonga` 等片段式输入不作为 V1 强制验收项。

## PoC 环境

- 基础镜像：`postgres:18.6@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280`
- 探针镜像：`inpulse/pgroonga-pg18.6:repro`，本地构建
  `sha256:bca8248cb90be2b287674741d6d1575b5a87f4f1fbb52259a9aca9055781083a`
- 镜像固定：不使用 `latest`；Groonga 官方 keyring SHA-256 为
  `91677bc2f9f454ef6ddfc6afe40764e470e60d8a6b1921661fd32ae5228537c8`，
  PGroonga `4.0.8-1`、Groonga `16.1.0-1`
- PostgreSQL：18.6
- PGroonga：4.0.8
- Groonga：16.1.0
- 逻辑恢复：`pg_dump --format=custom` 恢复后扩展、索引、权限和默认查询计划均可用
- 初始化：`database/bootstrap/020_pgroonga.sql` 由 `cluster_bootstrap`
  预装扩展并撤销非运行时函数权限；`0003_search_pgroonga.sql` 创建
  `app.pgroonga_text_full_text_search_ops_v2` 索引；`0004` 和 `0005`
  分别在合同确认后删除旧 GIN 索引和 `pg_trgm` 扩展

## 验证方法

- 复用 100 条冻结查询，其中 90 条正常召回、10 条无结果/边界输入。
- 基础数据 1000 行，规模数据 101000 行。
- 新增 15 组 V1 语义探针：`mfa`、`csrf`、`api`、`payment_callback`、
  `task_group_id`、`登录`、`INP-T-2026-0001`、`PR-42`、`R-42`、`PR-245`、
  `SESSION-TOKEN-01`、`2026`、`42`、`退款`、`回调`。
- 默认计划使用 `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)` 并确认使用
  PGroonga 索引；探针另关闭 `enable_seqscan` 作诊断，不作为生产配置。
- 覆盖 10 个候选策略：默认全文、正则 opclass、Bigram、Ngram，以及
  `LIKE`、`ILIKE`、`&@~`、`&~` 查询方式。

完整代码和明细见
[PoC README](../../database/poc/search-pgroonga/README.md)。

## 结果

| 门禁 | 默认 TokenBigram | 结果 |
| --- | --- | --- |
| 15 组 V1 语义探针 | 全部通过 | 通过 |
| 90 条中文金标 Recall@20 | 100%（90/90） | 通过 |
| 空查询/过短/过长输入 | 通过 | 通过 |
| 特殊标点输入 | 通过 | 通过 |
| 跨项目隔离 | 通过 | 通过 |
| 101000 行使用 PGroonga 索引 | 通过 | 通过 |
| PostgreSQL 18.6 探针镜像构建 | 通过 | 通过 |
| `EXPLAIN (ANALYZE, BUFFERS)` 默认计划 | 通过（含 `Buffers` 与 `Execution Time`） | 通过 |
| `0000-0002` 升级到 `0003-0005` | 通过（`0003`：1 applied / 3 already present；`0004/0005`：2 applied / 4 already present） | 通过 |
| `0003`/`0004`/`0005` 事务内回滚 | 通过（PGroonga 索引、旧 GIN 索引、`pg_trgm` 扩展均恢复） | 通过 |
| PGroonga 索引大小度量 | 通过（`object_inspect`：1000/15 行 `indexDiskUsage=5283840`，101000 行 `29138944`） | 通过 |
| 逻辑恢复后 PGroonga 扩展/索引/计划 | 通过 | 通过 |
| 任意英文子串 | 不适用 | 明确排除 |
| 任意代码子串 | 不适用 | 明确排除 |
| 正则查询 | 不适用 | 明确排除 |

默认 `pgroonga_text_full_text_search_ops_v2` 已满足 V1，不需要为 V1 引入
自定义 Ngram、Bigram 或正则 opclass。
`&~` regexp 策略仅由 `cluster_bootstrap` 作诊断执行；`app_runtime`
按最小权限没有 `pgroonga_regexp_text` EXECUTE。

## 推荐查询形式

```sql
normalized_search_text &@~ app.pgroonga_query_escape($1)
```

普通搜索必须把用户输入交给 `pgroonga_query_escape()`，不得直接使用
未转义的 `&~`，也不得把用户输入直接透传给 Groonga 查询语法；本地验证
`app_runtime` 执行 `&~` 返回 `42501`。

## 已知限制

- PostgreSQL 18.6 探针镜像、升级/回滚与逻辑恢复已验证；生产多阶段镜像及
  其最终 digest、Compose 仍未交付。
- 101000 行为确定性仿真数据，不能代表真实业务分布。
- 故障切换和长时间并发更新尚未完成正式验收。
- 当前 `pg_relation_size` 对 PGroonga 索引返回 0；报告已使用
  `pgroonga_command('object_inspect')` 读取 Groonga lexicon `disk_usage`，
  不再把 `pg_relation_size` 当作索引大小。默认查询策略在 1000/15 行和
  101000 行探针上的 `indexDiskUsage` 分别为 `5283840` 与 `29138944`。
- 当前恢复验证使用 PoC 镜像和逻辑备份，不满足 ADR-020/F-10 的加密、签名、
  异机保留、RPO/RTO 和旧 Session 失效门禁。
- 正式 `0003-0005` 迁移已通过真实 PostgreSQL 的扩展存在性、opclass、
  索引、旧 `pg_trgm` contract 清理、runtime 查询/转义与
  `pgroonga_command` 拒绝测试；生产多阶段镜像仍待部署纵切片；生产升级/
  回滚编排仍需 Runbook 与人工评审。

## ADR 与后续事项

- [ADR-025](../adr/ADR-025.md) 已创建，状态为 Accepted，并标记替代
  ADR-010；
- 未修改或覆盖 [ADR-011](../adr/ADR-011.md)；
- 生产 `ProjectAccessQueryPort` 适配器已由 A 岗位落地并纳入
  `ProjectsModule`；下一步为 F-26 契约/API/页面，以及生产备份恢复纵切片。
  SearchQueryService 服务层和基于测试版权限 `AuthorizedProjectScope` 的
  参数化查询集成测试已先行落地。
