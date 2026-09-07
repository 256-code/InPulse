# PGroonga 搜索 PoC

## 状态

这是 [ADR-025](../../../docs/adr/ADR-025.md) 的 V1 技术验证证据，也是
原 `pg_trgm` 阶段 0 门禁失败后的候选验证。ADR-025 已记录并替代 ADR-010；
正式产品实现尚未开始，本节不代表生产已实现。V1 验收约束已明确为：完整
英文缩写、完整代码标识符、中文短词和编号搜索；不要求任意英文子串，也
不要求代码标识符中间片段子串。

本 PoC 通过 `groonga/pgroonga:4.0.8-alpine-18` 在一次性 PostgreSQL 18.4
容器中运行，PGroonga 版本为 `4.0.8`，Groonga 版本为 `16.0.8`。仓库当前
生产基线是 PostgreSQL `18.6`，因此本报告不能证明官方 18.6 镜像已经兼容
PGroonga。

正式证据汇总见
[docs/poc/search-pgroonga-v1-result.md](../../../docs/poc/search-pgroonga-v1-result.md)。

## 复现

需要 Docker，并预先拉取镜像：

```powershell
docker pull groonga/pgroonga:4.0.8-alpine-18
pnpm db:poc:search:pgroonga:local
```

本地脚本会创建一次性容器，执行角色初始化、在 `app` schema 创建
`pgroonga` 扩展、显式迁移、数据库集成测试，然后运行搜索 PoC。成功时
容器自动删除；传 `-KeepContainer` 可以保留容器。

如果需要连接已有数据库运行：

```powershell
$env:POC_DATABASE_URL = 'postgresql://app_runtime@127.0.0.1:55434/app_poc'
$env:POC_ADMIN_DATABASE_URL = 'postgresql://cluster_bootstrap@127.0.0.1:55434/app_poc'
$env:POC_PGROONGA_IMAGE = 'groonga/pgroonga:4.0.8-alpine-18'
$env:POC_PGROONGA_IMAGE_DIGEST = 'sha256:b5c92fa3d86ad76ce75ddd8095f60542cf025348a58b8a38cd0b4a580fe4ce68'
pnpm db:poc:search:pgroonga
```

结果写入 [`artifacts/pgroonga-report.json`](./artifacts/pgroonga-report.json)。

## 数据集

- 复用现有冻结搜索金标：100 条查询、90 条正常召回目标、10 条无结果/边界输入。
- 基础表 1000 行、规模表 101000 行，使用确定性仿真文本，不是真实业务数据。
- 项目过滤在 SQL 层执行，并验证跨项目隔离。
- 追加 9 组 V1 语义探针：完整英文缩写 `mfa`、`csrf`、`api`，中文短词
  `登录`，完整代码标识符 `INP-T-2026-0001`、`PR-42`、`SESSION-TOKEN-01`，
  以及编号 `2026`、`42`。所有探针强制关闭 `enable_seqscan` 并检查计划
  确实使用 PGroonga 索引，避免单行小表被普通 `Seq Scan + ILIKE` 误判。

## 策略矩阵

| 策略 | opclass / tokenizer | 查询方式 | V1 完整语义探针全通过 | 规模召回 |
| --- | --- | --- | --- | --- |
| `default-ilike` | 默认 `pgroonga_text_full_text_search_ops_v2`（TokenBigram） | `ILIKE` | 是 | 100% |
| `default-like` | 默认全文 opclass | `LIKE` | 是 | 100% |
| `default-query` | 默认全文 opclass | `&@~` + `pgroonga_query_escape` | 是 | 100% |
| `regexp-ilike` | `app.pgroonga_text_regexp_ops_v2` | `ILIKE` | 是 | 100% |
| `regexp-like` | 正则 opclass | `LIKE` | 是 | 100% |
| `regexp-query` | 正则 opclass | `&~` | 是 | 96.7%（87/90） |
| `bigram-ilike` | `TokenBigramSplitSymbolAlphaDigit` | `ILIKE` | 是 | 100% |
| `bigram-query` | `TokenBigramSplitSymbolAlphaDigit` | `&@~` | 是 | 100% |
| `ngram-ilike` | `TokenNgram(unify_alphabet=false, unify_symbol=false, unify_digit=false)` | `ILIKE` | 是 | 100% |
| `ngram-query` | `TokenNgram(unify=false)` | `&@~` | 是 | 100% |

全部策略在 101000 行数据上使用 PGroonga 索引，没有出现 Seq Scan。默认
全文策略的中文、英文、混合、标点查询多为 Bitmap Heap Scan，编号查询为
Index Scan；自定义 Bigram/Ngram 的部分混合和标点查询也使用 Index Scan。

## 关键结论

1. 默认 `TokenBigram`（`pgroonga_text_full_text_search_ops_v2`）已通过
   全部 9 组 V1 语义探针和 90 条金标召回，在当前 V1 约束下不再需要正则
   opclass 或自定义 Bigram/Ngram；正式方案见 ADR-025。
2. 默认全文索引不支持任意英文子串（如 `roonga`）和代码内部片段
   （如 `R-42`），但这两类已明确排除在 V1 范围之外。
3. `regexp-query` 的 `&~` 虽通过 V1 探针，但把 `项目（POC）`、
   `MFA+CSRF`、`作废「记录」` 当作正则表达式，导致金标 Recall@20 为
   96.7%；普通字符串搜索不应直接使用 `&~`。
4. 101000 行规模索引约 27.8 MB，更新约 7-16 ms，REINDEX 约 589-596 ms；
   这些成本仍需在真实业务数据上复核。
5. `pg_relation_size` 对 PGroonga 索引返回 0；报告改用
   `pgroonga_command('object_inspect')` 读取 PGroonga 索引对象的
   `disk_usage`，并记录对应 Groonga lexicon 名称，才是实际 Groonga 存储占用。
6. 扩展安装在 `app` schema 时，opclass 必须写成
   `app.pgroonga_text_regexp_ops_v2`；没有 schema 限定会报 opclass 不存在。

## 当前建议

V1 建议采用默认 `pgroonga_text_full_text_search_ops_v2`，查询方式优先
`normalized_search_text &@~ app.pgroonga_query_escape($1)`；它在 101000
行上代表查询均为 Index Scan，功能门禁通过，不需要额外引入自定义 tokenizer
或正则 opclass。若后续 V2 要求任意英文/代码子串，再评估
`TokenNgram(unify=false)` 或 `TokenBigramSplitSymbolAlphaDigit`，并新增 ADR。

## 限制

- 只验证了 `pgroonga/pgroonga:4.0.8-alpine-18`，未验证 PostgreSQL 18.6
  官方镜像、其他补丁版本、备份恢复、故障切换和长时间并发更新。
- 101000 行是确定性仿真数据，不能预测真实业务数据分布、中文分词质量、
  索引膨胀和并发写入成本。
- Groonga 版本通过 `pgroonga_command('status')` 从运行实例读取；ADR-025
  已创建，功能/系统/技术设计和测试矩阵已同步，但 PostgreSQL 18.6 官方
  基线、正式迁移、备份恢复和默认查询计划仍需生产验证。
