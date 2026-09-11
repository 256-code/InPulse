# 灾难恢复离线 Runbook

状态：**上线门禁 Runbook**（[测试矩阵](../test-matrix.md) `RECOVERY-001` / `DEPLOY-003` /
`DEPLOY-004`）。本文件是[技术设计 §11.2 / §11.2.1 / §11.5](../../技术设计v1.2.2.md)
「首次建库与全新主机恢复」的离线可执行版本：原主机不可用、在线系统全部不可达时，
仅凭离线材料在新主机上重建数据库角色、恢复数据并启动服务。执行期间不依赖原主机、
原网络与任何在线文档；本文件的打印件与全部凭据、密钥、签名发布清单一并离线保管。

与[备份与恢复 Runbook](./backup-restore.md) 的分工：备份调度、异机副本、启用门禁、
staleness 告警与故障处理以该文件为准；本文件只负责「全新主机 / 灾难恢复」的端到端
顺序，包括首次建库一次性覆盖 [`deploy/compose.init.yaml`](../../deploy/compose.init.yaml)
的使用。两文件冲突时按本文件的恢复顺序执行并立即修正相关文档。

三条红线（与 backup-restore.md 相同，任何情况下都不放弃）：

1. 备份必须加密：明文只允许存在于受限 tmpfs 与进程管道；
2. 备份必须异机存放：本机与异机副本都必须加密，异机保留至少 30 天；
3. 至少有一份备份通过完整恢复演练，否则不得称为有效备份。

## 0. 离线材料清单（灾难发生前必须离机保管）

| 材料 | 用途 | 保管要求 |
| --- | --- | --- |
| 六份数据库密码文件（db_bootstrap / db_migrator / db_runtime / db_backup / db_audit_reader / db_audit_archive） | 首次建库与全部角色登录 | 密封、双人授权；与备份副本分库存放 |
| Session / 幂等指纹 / 审计 HMAC / TOTP KEK 四组 keyring（含历史版本） | 恢复后服务启动与历史数据可解 | 与签名发布清单的 key 版本一致 |
| 备份加密密钥 | 解密备份包 | 与备份副本分库存放 |
| 异机只读存储凭据 | 取回备份包 | 部署账户之外单独保管 |
| WORM 凭据与归档签名密钥 | 审计归档校验与续跑 | 同上 |
| TLS 证书与私钥（或签发材料） | Web 入口 | 由受控续期任务维护 |
| 签名发布清单（五个镜像 tag@sha256、Git SHA、迁移版本） | 校验镜像与目标版本 | 打印件 + 离线介质 |
| 本 Runbook 打印件 | 断网可读 | 与发布清单同处 |

没有离机保管等于没有灾难恢复能力；任一材料缺失时不得进入演练或真实恢复流程。
六份密码每份至少 32 字符；文件不进入 Git、镜像、备份或 CI Artifact。

## 1. 新主机准备与镜像校验

1. 校验签名发布清单，确认清单中的 Git SHA 与迁移版本为预期目标，五个镜像 digest 完整；
2. 按清单 digest 拉取五个镜像（DB-bootstrap / Migration / API / Web / ops），逐个核对
   `docker image inspect` 的 RepoDigest 与清单一致；不一致立即停止，不得用任意本地或
   浮动标签镜像替代 DB-bootstrap（PGroonga 缺失会让 020 脚本 fail closed）；
3. 主机安装 Docker Engine 与 Compose，准备空数据卷；本节及后续步骤可断网执行，
   仅镜像拉取与备份取回需要访问受信仓库与异机存储。


## 2. 建立空库与七角色（compose.init.yaml）

`deploy/compose.init.yaml` 是版本化一次性覆盖：仅该次向 db 服务设置 `POSTGRES_DB=app`、
`POSTGRES_USER=cluster_bootstrap`、`POSTGRES_PASSWORD_FILE`，并只读挂载六份密码 Secret
供镜像内初始化脚本消费；NOLOGIN `app_owner` / `audit_writer` 不设密码。初始化与角色探针
通过后立即停止该覆盖，改用稳态 Compose；稳态 db 容器不挂载任何登录密码。禁止把一次性
初始化覆盖用于日常 `up`（静态防线由 `pnpm check:deploy:test` 执行）。

1. 按 §0 把六份密码落位到 `deploy/secrets/`（仅部署账户可读）；确认数据卷为空，有残留
   数据时先保留现场证据再移走；
2. 启动一次性初始化：

   ```bash
   docker compose --project-directory deploy \
     -f deploy/compose.yaml -f deploy/compose.init.yaml \
     --env-file deploy/.env.deploy up -d db
   docker compose --project-directory deploy \
     -f deploy/compose.yaml -f deploy/compose.init.yaml \
     --env-file deploy/.env.deploy logs -f db
   ```

   观察 initdb 与 `/docker-entrypoint-initdb.d/`（`000_roles.sql`、`010_passwords.sql`、
   `020_pgroonga.sql`）依次执行且无报错；

3. 等 db healthy 后运行角色探针（任一断言不满足即停止并保留现场）：

   ```bash
   docker compose --project-directory deploy \
     -f deploy/compose.yaml -f deploy/compose.init.yaml \
     --env-file deploy/.env.deploy exec db psql -U cluster_bootstrap -d app -Atc "
       SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole
         FROM pg_roles
        WHERE rolname IN ('app_owner','audit_writer','app_migrator','app_runtime',
                          'app_backup','audit_reader','audit_archive_writer')
        ORDER BY rolname;"
   ```

   期望 7 行：`app_owner` / `audit_writer` 的 `rolcanlogin` 为 `f`，其余 5 个为 `t`；
   全部 `rolsuper` / `rolcreatedb` / `rolcreaterole` 为 `f`。再确认 PGroonga 已预装：

   ```bash
   docker compose --project-directory deploy \
     -f deploy/compose.yaml -f deploy/compose.init.yaml \
     --env-file deploy/.env.deploy exec db psql -U cluster_bootstrap -d app -Atc \
     "SELECT extname FROM pg_extension WHERE extname = 'pgroonga';"
   ```

   期望输出 `pgroonga`；为空说明所用镜像缺少扩展，回到 §1 核对 digest。

4. 探针通过后立即停止一次性覆盖并切回稳态：

   ```bash
   docker compose --project-directory deploy \
     -f deploy/compose.yaml -f deploy/compose.init.yaml \
     --env-file deploy/.env.deploy down
   docker compose --project-directory deploy \
     -f deploy/compose.yaml --env-file deploy/.env.deploy up -d
   ```

   之后登录密码只存在于 `deploy/secrets/` 与容器内只读挂载；bootstrap 凭据不再出现。


## 3. 恢复数据

1. 从异机只读存储取回最近一次通过校验的加密备份包与签名清单；
2. 校验密文 SHA-256 与签名清单（清单含数据库版本、迁移版本、镜像 digest、Git SHA、
   时间、文件大小与审计链锚点），任何不符即停；
3. 在 tmpfs 解密（明文不得落盘为最终文件），以 `app_owner` 执行
   `pg_restore --no-owner --no-acl`；角色、对象 owner 与密码不依赖 `pg_restore`——
   角色已在 §2 建立，密码只来自 §0 离线材料；
4. 重新执行权限收敛脚本（`000_roles.sql` 与 `020_pgroonga.sql` 幂等可重跑），并验证
   runtime / backup 不拥有对象且不能 DDL。

## 4. Session 与安全状态处理

1. 逻辑备份按技术设计排除了 `user_sessions` / `session_csrf_tokens` /
   `preauth_sessions` 的数据；恢复后确认三表均为空；
2. 若恢复来源是物理全库快照（含三表数据），在 API 启动前轮换 Session HMAC key 并递增
   全部用户 `auth_version`，再清空三表数据；审计链不得重写，恢复后只允许继续追加。

## 5. 迁移与完整校验

1. 以 `app_migrator` 运行迁移任务（compose `migrate` 服务），确认迁移版本与发布清单一致；
2. 校验扩展、全部约束、审计链序号 / Hash / 远端锚点；
3. 校验 MFA（TOTP KEK）与审计 HMAC 的历史 keyring 可用性（抽样解密 / 验证）；缺历史
   版本时用 §0 离线材料补齐后再启动；
4. 启动 API / Web，运行 smoke test：登录、项目读取、写入回滚、搜索权限与审计读取；
5. 记录实测 RPO / RTO（目标 RPO ≤ 24h、RTO ≤ 2h）；未达标即上线阻断。


## 6. 演练节奏与证据

每月至少在与生产隔离的临时环境完成一次上述全新主机恢复；每季度模拟丢失原主机。
演练记录字段与 [backup-restore.md](./backup-restore.md) §8 相同（日期与执行人、来源
备份、Hash 校验、实测 RPO / RTO、smoke test、结论）；只有通过完整恢复演练的文件才称为
有效备份。`backupctl.sh enable --confirm-go-live` 要求该演练证据文件存在。

## 7. 故障处理

| 症状 | 判断依据 | 处置 |
| --- | --- | --- |
| 初始化脚本报错 | db 日志出现密码长度或文件缺失错误 | 核对六份密码落位、长度与权限；修正后删除空卷重跑 §2 |
| 角色探针失败 | §2 步骤 3 任一断言不满足 | 停止并保留现场，不得带病进入 §3 |
| `pgroonga` 缺失 | 扩展探针为空 | 使用签名清单中的 DB-bootstrap digest 重建，禁止用官方裸镜像替代 |
| 恢复后 Session 非空 | §4 检查 | 轮换 Session HMAC key、递增 auth_version、清空三表后再启动 API |
| 迁移版本不符 | §5 校验 | 使用发布清单对应版本镜像；不得手工修改迁移历史 |
| 审计链校验失败 | §5 校验 | 按[审计归档 Runbook](./audit-archive.md) 定位；无法解释即视为数据不可信，恢复不通过 |

## 8. 相关记录

- [技术设计 §11.2 / §11.2.1 / §11.5](../../技术设计v1.2.2.md)、[ADR-017](../adr/ADR-017.md)、
  [ADR-018](../adr/ADR-018.md)、[ADR-020](../adr/ADR-020.md)
- [`deploy/compose.init.yaml`](../../deploy/compose.init.yaml)、
  [`database/bootstrap/`](../../database/bootstrap/)
- [备份与恢复 Runbook](./backup-restore.md)、[审计归档 Runbook](./audit-archive.md)、
  [升级与回滚 Runbook](./upgrade-rollback.md)
- [测试矩阵](../test-matrix.md)：`RECOVERY-001`、`DEPLOY-003`、`DEPLOY-004`
