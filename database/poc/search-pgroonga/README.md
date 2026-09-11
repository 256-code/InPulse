# PGroonga 搜索 PoC

## 状态

这是 [ADR-025](../../../docs/adr/ADR-025.md) 的 V1 技术验证证据，也是
原 `pg_trgm` 阶段 0 门禁失败后的候选验证。ADR-025 已记录并替代 ADR-010；
本节是阶段 0 技术验证证据；正式 `search_projection` PGroonga 迁移与
bootstrap 已经落库，SearchQueryService 服务层与真实 PostgreSQL 参数化/
权限过滤测试已实现，搜索 API 与页面仍未开始。V1 验收约束
已明确为：完整英文缩写、完整代码标识符、中文短词和编号搜索；不要求任意
英文子串，也不要求代码标识符中间片段子串。

本 PoC 已通过仓库内 Dockerfile 在官方 `postgres:18.6` 基础镜像上安装
PGroonga `4.0.8` 与 Groonga `16.1.0`，并用该镜像完成构建、扩展安装、
migration runner 迁移、搜索语义、默认查询计划、逻辑备份和恢复后的索引
可用性验证。Dockerfile 不使用 `latest` 下载路径：PostgreSQL 基础镜像按
digest 固定，Groonga 官方 keyring 按 SHA-256 固定，PGroonga/Groonga
Debian 包版本固定；本机已验证镜像 digest 为
`sha256:bca8248cb90be2b287674741d6d1575b5a87f4f1fbb52259a9aca9055781083a`。
本镜像只用于 PoC，不代表生产部署镜像已经定稿。

正式证据汇总见
[docs/poc/search-pgroonga-v1-result.md](../../../docs/poc/search-pgroonga-v1-result.md)。

## 复现

需要 Docker。先构建锁定版本的 PostgreSQL 18.6 探针镜像：

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

本地脚本会创建两个一次性容器，执行 `000_roles.sql`、`020_pgroonga.sql`
（由 `cluster_bootstrap` 预装扩展并收紧函数权限）、数据库 migration
runner、集成测试和搜索 PoC；随后在该实例上创建
代表性 PGroonga 索引，执行 `pg_dump --format=custom`（排除 Session 数据）、
在全新容器恢复并验证扩展、索引、权限、默认查询计划与中文探针。成功时
两个容器自动删除；传 `-KeepContainer` 可以保留容器。`pnpm
db:poc:search:pgroonga:local` 保留为使用旧 PoC 镜像的快速入口，但 18.6
验证请使用上面的构建与参数。

如果需要连接已有数据库运行：

```powershell
$env:POC_DATABASE_URL = 'postgresql://app_runtime@127.0.0.1:55434/app_poc'
$env:POC_ADMIN_DATABASE_URL = 'postgresql://cluster_bootstrap@127.0.0.1:55434/app_poc'
$env:POC_PGROONGA_IMAGE = 'groonga/pgroonga:4.0.8-alpine-18'
$env:POC_PGROONGA_IMAGE_DIGEST = 'sha256:b5c92fa3d86ad76ce75ddd8095f60542cf025348a58b8a38cd0b4a580fe4ce68'
pnpm db:poc:search:pgroonga
```

传 `-Capacity` 会在搜索 PoC 通过后追加阶段 4 容量门禁（30 并发 × 600 秒、
冷缓存容器重启、跨项目越界断言），可用 `-CapacityDurationSeconds` 缩短冒烟；
该步骤会 `docker restart` 本次运行的一次性容器，容器创建与清理语义与默认
运行一致。

结果分别写入
[`artifacts/pgroonga-report.json`](./artifacts/pgroonga-report.json)、
[`artifacts/pgroonga-backup-restore-report.json`](./artifacts/pgroonga-backup-restore-report.json)、
[`artifacts/pgroonga-migration-report.json`](./artifacts/pgroonga-migration-report.json)
与 [`artifacts/pgroonga-capacity-report.json`](./artifacts/pgroonga-capacity-report.json)。

## 数据集

- 复用现有冻结搜索金标（`phase4-v1`）：200 条查询、190 条正常召回目标、10 条无结果/边界输入。
- 基础表 1000 行、规模表 101000 行，使用确定性仿真文本，不是真实业务数据。
- 项目过滤在 SQL 层执行，并验证跨项目隔离。
- 追加 15 组 V1 语义探针：完整英文缩写/标识符 `mfa`、`csrf`、`api`、
  `payment_callback`、`task_group_id`，中文短词 `登录`、`退款`、`回调`，
  完整代码标识符 `INP-T-2026-0001`、`PR-42`、`R-42`、`PR-245`、
  `SESSION-TOKEN-01`，以及编号 `2026`、`42`。默认计划使用
  `EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)`；探针另强制关闭
  `enable_seqscan` 作诊断，避免单行小表被普通 `Seq Scan + ILIKE` 误判。

## 策略矩阵

| 策略 | opclass / tokenizer | 查询方式 | V1 完整语义探针全通过 | 规模召回 |
| --- | --- | --- | --- | --- |
| `default-ilike` | 默认 `pgroonga_text_full_text_search_ops_v2`（TokenBigram） | `ILIKE` | 是 | 100% |
| `default-like` | 默认全文 opclass | `LIKE` | 是 | 100% |
| `default-query` | 默认全文 opclass | `&@~` + `pgroonga_query_escape` | 是 | 100% |
| `regexp-ilike` | `app.pgroonga_text_regexp_ops_v2` | `ILIKE` | 是 | 100% |
| `regexp-like` | 正则 opclass | `LIKE` | 是 | 100% |
| `regexp-query` | 正则 opclass | `&~` | 是 | 95.8%（182/190） |
| `bigram-ilike` | `TokenBigramSplitSymbolAlphaDigit` | `ILIKE` | 是 | 100% |
| `bigram-query` | `TokenBigramSplitSymbolAlphaDigit` | `&@~` | 是 | 100% |
| `ngram-ilike` | `TokenNgram(unify_alphabet=false, unify_symbol=false, unify_digit=false)` | `ILIKE` | 是 | 100% |
| `ngram-query` | `TokenNgram(unify=false)` | `&@~` | 是 | 100% |

全部策略在 101000 行数据上使用 PGroonga 索引，没有出现 Seq Scan。默认
全文策略的中文、英文、混合、标点查询多为 Bitmap Heap Scan，编号查询为
Index Scan；自定义 Bigram/Ngram 的部分混合和标点查询也使用 Index Scan。
`regexp-query` 仅作为诊断项使用 `cluster_bootstrap` 执行；`app_runtime`
按最小权限没有 `pgroonga_regexp_text` EXECUTE，未转义 `&~` 查询被拒绝，
不作为 V1 运行时门禁。默认计划报告保留
`EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)` 的 `Buffers` 与 `Execution Time`
文本。

## 关键结论

1. 默认 `TokenBigram`（`pgroonga_text_full_text_search_ops_v2`）已通过
   全部 15 组 V1 语义探针和 200 条金标召回，在当前 V1 约束下不再需要正则
   opclass 或自定义 Bigram/Ngram；正式方案见 ADR-025。
2. 默认全文索引不支持任意英文子串（如 `roonga`）和代码内部片段
   （如 `R-4`），但这两类已明确排除在 V1 范围之外；完整代码标识符
   `R-42`、`PR-245` 已按要求覆盖。
3. `regexp-query` 的 `&~` 虽通过 V1 探针，但把 `项目（POC）`、
   `MFA+CSRF`、`作废「记录」` 当作正则表达式，导致金标 Recall@20 为
   95.8%（182/190）；普通字符串搜索不应直接使用 `&~`。
4. 101000 行规模索引约 27.8 MB，更新约 7-16 ms，REINDEX 约 589-596 ms；
   这些成本仍需在真实业务数据上复核。
5. `pg_relation_size` 对 PGroonga 索引返回 0；报告改用
   `pgroonga_command('object_inspect')` 读取 PGroonga 索引对象的
   `disk_usage`，并记录对应 Groonga lexicon 名称，才是实际 Groonga 存储占用。
   默认查询策略的 1000/15 行探针 `indexDiskUsage` 为 `5283840`，101000 行
   规模索引为 `29138944`。
6. 扩展安装在 `app` schema 时，opclass 必须写成
   `app.pgroonga_text_regexp_ops_v2`；没有 schema 限定会报 opclass 不存在。

## 当前建议

V1 建议采用默认 `pgroonga_text_full_text_search_ops_v2`，查询方式优先
`normalized_search_text &@~ app.pgroonga_query_escape($1)`；它在 101000
行上代表查询均为 Index Scan，功能门禁通过，不需要额外引入自定义 tokenizer
或正则 opclass。若后续 V2 要求任意英文/代码子串，再评估
`TokenNgram(unify=false)` 或 `TokenBigramSplitSymbolAlphaDigit`，并新增 ADR。

## 容量门禁（阶段 4 / A-5）

阶段 4 容量门禁按技术设计 V1.2.2 §9.4 与系统设计 §1.6 执行：搜索投影
≥ 100,000 条且不低于 5 年容量模型峰值的 1.2 倍、≥ 200 条冻结金标、
30 并发持续 10 分钟、预热后 P95 < 500ms / P99 < 1s，并单独记录冷缓存。
运行器 `run-capacity.ts` 复用本 PoC 种子化的 `app.pgroonga_poc_scale`
（101000 行）与默认全文索引，查询 SQL 与生产
`PostgresSearchProjectionReader` 同形状（`&@~ app.pgroonga_query_escape($1)`、
项目与 visibility 过滤在 SQL 层、id keyset 分页），行级校验任何越界
`project_id` 都计为违规。

- 入口：`poc-search-pgroonga-local.ps1 -Capacity`（默认 600 秒，
  `-CapacityDurationSeconds` 可缩短冒烟）；对已有实例可直接运行
  `pnpm --filter @inpulse/database poc:search:capacity`。
- 环境变量：`POC_DATABASE_URL`（`app_runtime`）、`POC_ADMIN_DATABASE_URL`
  （`cluster_bootstrap`，缺省回退 `POC_DATABASE_URL`）、
  `POC_CAPACITY_CONCURRENCY`（默认 30）、`POC_CAPACITY_DURATION_MS`
  （默认 600000）、`POC_CAPACITY_COLD_QUERIES`（默认 30）、
  `POC_CAPACITY_WARMUP_PASSES`（默认 2）、`POC_CAPACITY_RESTART_CONTAINER`
  （冷缓存重启的容器名，本地脚本自动设置）。
- 冷缓存：`docker restart` 指定容器清空 PostgreSQL shared_buffers 后，以
  单并发执行首批查询并与预热后的持续压测分开记录；宿主页缓存与存储层
  缓存未清空，生产冷启动仍需按 DEPLOY / RECOVERY 门禁复测。
- 结果写入 `artifacts/pgroonga-capacity-report.json`
  （`version: pgroonga-capacity-v1`，含 `gates` 与 `allPassed`）；任一
  门禁不通过时以非零退出。
- 2026-09-11 本地实测（`inpulse/pgroonga-pg18.6:repro`、PostgreSQL 18.6、
  PGroonga 4.0.8、101000 行、30 并发 × 600 秒）：2,398,317 次请求 /
  2,362,344 次 SQL、0 错误、P95 10.171 ms、P99 13.284 ms、Recall@20
  189/190（99.47%）、跨项目越界 0、冷缓存 30 条单独记录，全部 gate 通过。
- 该门禁不进入 CI：完整运行含 10 分钟持续负载与容器重启，属阶段 4 /
  发布前验收门禁；30 并发由单进程发起，未包含 Nginx、TLS、API 与鉴权
  开销，端到端 P95 需在部署环境复测。
- 设计文档未给出 5 年容量模型峰值的具体数值；1.2 倍条件以上界形式记录
  （模型峰值 ≤ 84166 时自动满足），模型定稿后需人工复核并按需复测。

## 迁移生命周期

- 空库迁移由数据库集成测试执行，七条迁移（`0000-0006`）全部 Applied。
- 升级路径在独立 `app_upgrade_prev` 数据库中验证：先运行 `0000`、`0001`、
  `0002`，在 `schema_migrations` 中写入这三个文件的精确 checksum，再由
  仓库 migration runner 应用 `0003_search_pgroonga.sql`；实际结果为
  1 applied / 3 already present，确认 PGroonga 索引已创建并记录迁移历史。
  在旧 GIN 索引仍存在时强制计划确认 PGroonga 可用，再由同一 migration
  runner 应用 `0004`-`0006`；实际结果为 3 applied / 4 already present，
  确认旧 GIN 索引和 `pg_trgm` 扩展被独立删除。
- 回滚分别对 `0003`、`0004`、`0005` 做显式事务验证：`0003` 删除并恢复
  PGroonga 索引、`0004` 删除并恢复旧 GIN 索引、`0005` 删除并恢复
  `pg_trgm` 扩展；逐次回滚后迁移历史保持可回退。
- 结果见 `artifacts/pgroonga-migration-report.json`
  （`version: pgroonga-migration-v3`）；生产升级/回滚编排仍需部署 Runbook
  与人工评审。

## 限制

- 已验证 PostgreSQL 18.6 官方基础镜像、PGroonga 构建、`020_pgroonga.sql`
  扩展权限、`0003-0006` 显式迁移、旧 `pg_trgm` contract 清理、默认查询
  计划和逻辑恢复，但未验证其他补丁版本、故障切换和长时间并发更新。
- 101000 行是确定性仿真数据，不能预测真实业务数据分布、中文分词质量、
  索引膨胀和并发写入成本。
- 恢复验证只证明 PoC 扩展与索引在逻辑恢复后可用；正式 `search_projection`
  迁移由数据库集成测试验证，但加密、签名、异机保留、RPO/RTO、旧 Session
  失效及生产部署镜像仍属于 ADR-020/F-10 与 F-26 的后续交付。
