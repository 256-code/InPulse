# InPulse 数据库

本目录是 InPulse 的数据库唯一实现基线。当前锁定 PostgreSQL 18.x、
Drizzle ORM 0.45.2 和 Postgres.js 3.4.9。API 进程只能使用
`app_runtime`，不得启动时迁移；迁移只能由独立的
`app_migrator` 任务执行。

## 目录与真相来源

- `schema/**`：Drizzle 类型模型，供 Repository 编译期使用；
- `migrations/*.sql`：数据库行为的权威、只追加迁移历史；
- `bootstrap/000_roles.sql`：首次建库的角色、所有权和默认权限；
- `bootstrap/010_passwords.sql`：仅初始化容器读取五个独立密码
  Secret；仓库和命令行都不出现密码；
- `bootstrap/020_pgroonga.sql`：由 `cluster_bootstrap` 预装非 trusted 的
  `pgroonga` 扩展，并撤销非运行时角色的扩展函数 EXECUTE；
- `src/migrate.ts`：带全局 advisory lock 和 SHA-256 历史校验的迁移器；
- `test/database.integration.test.ts`：真实 PostgreSQL 约束、权限与并发门禁。

表、可由 Drizzle 表达的约束及 SQL 迁移必须在同一变更中同步。函数、
约束触发器、扩展、对象所有权和 GRANT 只以显式 SQL 迁移表达。已经在任一
环境应用的迁移绝不修改；后续修复必须追加新序号。迁移器发现历史文件哈希
变化会立即失败。

## 首次建库

生产初始化顺序如下：

1. PostgreSQL 官方镜像以 `cluster_bootstrap` 创建 `app` 数据库；
2. 以该一次性超级用户依次执行 `000_roles.sql`、`010_passwords.sql`
   和 `020_pgroonga.sql`；
3. 停止初始化配置，日常数据库容器不再挂载 bootstrap 密码；
4. 独立迁移任务以 `app_migrator` 执行 `pnpm db:migrate`；
5. 迁移成功后 API 才以 `app_runtime` 启动。

PGroonga 不是 trusted extension，不能由普通 `app_owner` 首次安装；
因此 `020_pgroonga.sql` 必须在迁移前由一次性超级用户执行。正式
`0003_search_pgroonga.sql` 只保留幂等守卫与 schema 限定的索引定义，并在
缺少扩展时 fail closed。`0004_search_projection_contract_pg_trgm_index.sql`
确认 PGroonga 索引存在后才删除旧 GIN 索引；
`0005_search_projection_contract_pg_trgm_extension.sql` 确认旧 GIN 索引已
删除且 `pg_trgm` 没有扩展外依赖后才删除扩展，避免把索引和扩展清理与
PGroonga 迁移合并在同一迁移中。

生产环境不接受明文 URL 环境变量。迁移和运行进程分别使用
`MIGRATION_DB_PASSWORD_FILE`、`RUNTIME_DB_PASSWORD_FILE`，并配合
`DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_SSLMODE`。完整键名见
`.env.example`。

本地已有安装 PGroonga 的 PostgreSQL 18 时，可一次性创建隔离集群、迁移、
测试并停止：

```powershell
$env:POSTGRES_BIN = 'C:\Program Files\PostgreSQL\18\bin'
pnpm db:test:local
```

该脚本先检查 `pg_available_extensions`，执行 `020_pgroonga.sql`；若本机
未安装 PGroonga，会明确失败并提示改用 Docker 的一体化 PoC。脚本只在系统
临时目录创建 `InPulse-PgTest-<uuid>`，只监听
`127.0.0.1`，使用仅限该临时实例的 trust 认证，并将
`max_connections` 设为 150 以执行 100 并发审计门禁。成功后自动停止并
删除测试目录；失败时保留日志路径供排查。可传 `-KeepData` 保留成功实例
的数据目录。

## 日常命令

```powershell
pnpm install --frozen-lockfile
pnpm db:migrations:check

$env:MIGRATION_DATABASE_URL = 'postgresql://app_migrator:...@127.0.0.1:5432/app'
pnpm db:migrate

$env:TEST_DATABASE_URL = 'postgresql://cluster_bootstrap@127.0.0.1:55432/app'
pnpm db:test
```

`TEST_DATABASE_URL` 的角色派生只适用于 loopback trust 测试库。CI 使用独立
密码时必须显式提供 `TEST_MIGRATOR_DATABASE_URL`、
`TEST_RUNTIME_DATABASE_URL`、`TEST_BACKUP_DATABASE_URL`、
`TEST_AUDIT_READER_DATABASE_URL` 和
`TEST_AUDIT_ARCHIVE_DATABASE_URL`。

## 阶段 0 搜索 PoC

PostgreSQL 18.6 PGroonga V1 PoC（需要 Docker）：

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

脚本创建一次性源/目标容器，执行 `000_roles.sql` 与 `020_pgroonga.sql`、
显式迁移、现有数据库测试、搜索 PoC，并执行排除 Session 数据的
`pg_dump`/`pg_restore` 烟雾验证；成功时自动删除容器，也可传
`-KeepContainer` 保留。结果写入
`poc/search-pgroonga/artifacts/pgroonga-report.json`、
`poc/search-pgroonga/artifacts/pgroonga-backup-restore-report.json` 与
`poc/search-pgroonga/artifacts/pgroonga-migration-report.json`。
18.6 探针镜像上的 V1 语义、90 条金标 Recall@20、边界、跨项目隔离、默认
查询计划的 `ANALYZE/BUFFERS` 证据、`0000-0002 -> 0003-0005` 升级/逐迁移
回滚、旧 `pg_trgm` GIN/扩展清理和逻辑恢复均通过；旧
`pnpm db:poc:search:pgroonga:local` 仍保留为非 18.6 快速复现入口。

原 `pg_trgm` PoC 保留为决策证据：

```powershell
pnpm db:poc:search:local
```

该脚本使用 `postgres:18.6`；`Recall@20`、无结果、边界和跨项目隔离通过，
但参数化中文短查询的默认查询计划未使用 GIN trigram 索引，因此当前仍会
非零退出。完整结论见 [PGroonga PoC 说明](./poc/search-pgroonga/README.md)
与 [原 pg_trgm PoC 说明](./poc/search/README.md)。

## 功能开发必须遵守的事务契约

- 创建项目时，同一事务必须插入项目、创建者成员历史和唯一
  `kind='UNCLASSIFIED'` 模块；否则提交失败。三者使用数据库
  `now()` 默认值，不由客户端伪造时间；
- 新建任务时同一事务插入第一条 `task_status_history`。每次完成、重开、
  取消或恢复都追加连续历史；重开行保存上次完成时间与完成说明快照；
- 核心聚合每次更新必须令 `row_version = row_version + 1`，并在
  `WHERE` 中匹配调用方的期望版本；
- DRAFT 记录没有版本；发布时同一事务插入 v1，已发布编辑插入连续的新版本。
  当前标题和 payload 必须与 `current_version` 快照一致。VOID 期间不可编辑，
  恢复只能修改状态、并发控制字段 `row_version` 和更新时间；业务版本
  `current_version` 必须保持不变，并保留作废快照；
- ACTIVE 任务组在提交时必须恰有一个 ACTIVE MAIN 和至少一个 ACTIVE
  SOURCE；CLOSED 组不得有 ACTIVE 成员。解除最后一个 SOURCE 时，同一事务
  关闭组并解除 MAIN；
- 任务/记录影响功能只允许 MODULE scope。所有跨层关系携带
  `project_id` 并由复合外键拒绝跨项目串联；
- 编号只通过 `code_sequences` 的原子 UPSERT 分配。编号唯一、单调但不承诺
  无空洞；
- 审计先按 UTF-8 chain ID 顺序调用
  `audit_lock_head(chainId, projectId, initialKeyVersion)`，应用按 JCS-1
  信封计算 HMAC-SHA-256，再调用 `audit_append_locked(...)`。业务写、
  审计、通知、活动和搜索投影必须共用同一个事务；
- `app_runtime` 对原始审计表没有任何直接权限；审计查询使用独立
  `audit_reader` 连接，备份使用 `app_backup`，Session、CSRF、预认证和
  限流桶明确不授予备份读取权限。

应用 Repository 不得使用数据库级级联删除清理业务历史，也不得绕过
Workflow 的锁序与父级 ACTIVE 检查。当前数据库触发器负责最终结构防线，
授权、归档可写性、JCS/HMAC 密钥和跨域命令语义仍由应用层按技术设计执行。
