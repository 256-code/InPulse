# PGroonga V1 搜索 PoC 结果

## 状态

本文是 [ADR-025](../adr/ADR-025.md) 的 V1 搜索技术验证证据。ADR-025 已
记录并替代 ADR-010；ADR-011 保持原内容不变。正式产品实现尚未开始，
PostgreSQL 18.6 生产验证也尚未完成。

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

- 镜像：`groonga/pgroonga:4.0.8-alpine-18`
- 镜像 digest：`sha256:b5c92fa3d86ad76ce75ddd8095f60542cf025348a58b8a38cd0b4a580fe4ce68`
- PostgreSQL：18.4
- PGroonga：4.0.8
- Groonga：16.0.8
- 仓库当前目标基线：PostgreSQL 18.6
- **尚未验证 PostgreSQL 18.6 官方镜像中 PGroonga 扩展的可构建性**

## 验证方法

- 复用 100 条冻结查询，其中 90 条正常召回、10 条无结果/边界输入。
- 基础数据 1000 行，规模数据 101000 行。
- 新增 9 组 V1 语义探针：`mfa`、`csrf`、`api`、`登录`、
  `INP-T-2026-0001`、`PR-42`、`SESSION-TOKEN-01`、`2026`、`42`。
- 每次探针关闭 `enable_seqscan` 并确认计划确实使用 PGroonga 索引。
- 覆盖 10 个候选策略：默认全文、正则 opclass、Bigram、Ngram，以及
  `LIKE`、`ILIKE`、`&@~`、`&~` 查询方式。

完整代码和明细见
[PoC README](../../database/poc/search-pgroonga/README.md)。

## 结果

| 门禁 | 默认 TokenBigram | 结果 |
| --- | --- | --- |
| 9 组 V1 语义探针 | 全部通过 | 通过 |
| 90 条中文金标 Recall@20 | 100%（90/90） | 通过 |
| 空查询/过短/过长输入 | 通过 | 通过 |
| 特殊标点输入 | 通过 | 通过 |
| 跨项目隔离 | 通过 | 通过 |
| 101000 行使用 PGroonga 索引 | 通过 | 通过 |
| 任意英文子串 | 不适用 | 明确排除 |
| 任意代码子串 | 不适用 | 明确排除 |
| 正则查询 | 不适用 | 明确排除 |

默认 `pgroonga_text_full_text_search_ops_v2` 已满足 V1，不需要为 V1 引入
自定义 Ngram、Bigram 或正则 opclass。

## 推荐查询形式

```sql
normalized_search_text &@~ app.pgroonga_query_escape($1)
```

普通搜索必须把用户输入交给 `pgroonga_query_escape()`，不得直接使用
未转义的 `&~`，也不得把用户输入直接透传给 Groonga 查询语法。

## 已知限制

- PostgreSQL 18.6 与 PGroonga 的生产镜像构建尚未验证。
- 101000 行为确定性仿真数据，不能代表真实业务分布。
- 备份恢复、故障切换、默认查询计划、长时间并发更新尚未完成正式验收。
- 当前 `pg_relation_size` 对 PGroonga 索引返回 0，需使用
  `pgroonga_command('object_inspect')` 检查实际存储。
- 当前未验证生产 Dockerfile、Compose、迁移回滚和恢复脚本。

## ADR 与后续事项

- [ADR-025](../adr/ADR-025.md) 已创建，状态为 Accepted，并标记替代
  ADR-010；
- 未修改或覆盖 [ADR-011](../adr/ADR-011.md)；
- 下一步为 PostgreSQL 18.6 官方基线的 PGroonga 构建、迁移、默认计划、
  备份恢复验证，以及正式搜索索引与 SearchQueryService 实现。
