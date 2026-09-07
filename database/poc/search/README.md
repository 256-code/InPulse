# 阶段 0 搜索 PoC

## 状态

**原 `pg_trgm` 阶段 0 门禁未通过，本文仅保留为切换决策的失败证据。**
默认规划器没有为参数化中文短查询选择 GIN trigram 索引；[ADR-010](../../../docs/adr/ADR-010.md)
已被 [ADR-025](../../../docs/adr/ADR-025.md) 替代，V1 改为 PostgreSQL +
PGroonga，证据见 [PGroonga PoC](../search-pgroonga/README.md)。

## 复现

需要 Docker 和 `postgres:18.6`：

```powershell
pnpm db:poc:search:local
```

脚本会创建一次性本地 PostgreSQL 容器，执行角色初始化、3 条显式迁移、
现有数据库集成测试，然后运行搜索 PoC。成功后容器自动删除；因当前门禁
失败，命令以非零状态退出。单独连接已有数据库运行：

```powershell
$env:POC_DATABASE_URL = 'postgresql://app_runtime@127.0.0.1:55433/app_poc'
pnpm db:poc:search
```

## 数据集

- 1000 条搜索投影，其中 90 条为冻结金标目标，910 条为确定性仿真干扰行；
- 100 条冻结查询，覆盖中文短词、编号、英文、混合字符、全半角标点和边界输入；
- 特殊通配符 `%`、`_`、`\` 使用 `ILIKE ... ESCAPE E'\\'` 参数化转义；
- 查询最短长度 2，PoC 最大长度 200；空、过短、过长输入不进入 SQL；
- 规范化：Unicode NFKC、小写、折叠空白、常见全半角标点映射；
- 项目范围过滤发生在 SQL 层，未使用客户端提供的授权范围。

## 最近结果

报告写入 `artifacts/phase0-report.json`：

| 门禁 | 结果 |
| --- | --- |
| ≥1000 投影 | 1000 |
| ≥100 金标 | 100 |
| Recall@20 | 100%（90/90） |
| 无结果/特殊字符 | 通过 |
| 边界输入 | 通过 |
| 跨项目隔离 | 通过 |
| GIN 默认计划 | **未通过** |
| GIN 强制可用性 | 可用 |

强制 GIN 计划时，1000 行数据集仍将几乎所有行交给 Bitmap Heap Scan
recheck；额外手动插入 100000 条 HIDDEN 仿真行后，强制 GIN 计划仍几乎
扫描全部 101000 行，默认计划反而选择 Seq Scan。因此不能把“GIN 索引可
被强制使用”等同于“目标查询使用 GIN 索引”。

## 下一步

- 本报告作为阶段 0 失败证据保留，不再作为正式搜索方案；
- ADR-025 已采用 PGroonga，正式实现继续按 ADR-025 与相关设计文档推进；
- PostgreSQL 18.6 官方基线的 PGroonga 构建、迁移、默认计划和备份恢复仍需验证。
