# 备份与恢复 Runbook

状态：**上线门禁 Runbook**。定时备份按[技术设计 §11.5](../../技术设计v1.2.2.md)与
[ADR-020](../adr/ADR-020.md) 是生产上线（Go-Live）门禁项：上线前不部署、不启用任何备份
调度，`docker compose --profile operations` 的 `backup` / `audit-archive` 服务保持未发布，
也不产生备份告警。本文件交付上线前必须准备好的宿主调度配置、并发锁、告警接收方、加密密钥
与异机存储授权流程；启用与演练证据仍在[测试矩阵](../test-matrix.md)的 `DEPLOY-003` /
`DEPLOY-004` / `RECOVERY-001` 下验收。

三条红线（任何情况下都不放弃）：

1. 备份必须加密：明文只允许存在于受限 tmpfs 与进程管道，不得生成本地明文最终文件；
2. 备份必须异机存放：本机与异机副本都必须加密，异机保留至少 30 天；
3. 至少有一份备份通过**完整恢复演练**，否则不得称为有效备份。

## 1. 组件与责任

| 组件 | 位置 | 责任 |
| --- | --- | --- |
| 备份服务 | compose `operations` profile 的 `backup` 服务（F-10.3 已交付，镜像 `deploy/docker/ops.Dockerfile`） | `pg_dump --format=custom`、AES-256-GCM 加密、SHA-256 与签名清单、原子重命名、异机上传与保留 |
| 审计归档 | compose `operations` profile 的 `audit-archive`（F-08 步骤 6 已交付，复用同一 ops 镜像） | 每小时写签名链头检查点、每日导出加密审计明细到独立 WORM 前缀 |
| 宿主调度 | `deploy/backup/`（`backupctl.sh` + 5 个 systemd 单元） | 12 小时调度、并发锁、失败与 staleness 告警、启用/停用与状态 |
| 告警接收方 | 运维侧受控配置（地址不在仓库内） | 接收失败与 staleness 告警 |
| 密钥与异机存储授权 | 运维侧 | 提供解密密钥、异机只读存储凭据、恢复授权流程 |

宿主调度只决定“何时跑”和“失败后告警”，不接触明文备份内容，也不读取加密密钥。

## 2. 生效时机

- 上线前：`backup` / `audit-archive` 只作为 `profiles: [operations]` 声明存在于
  `deploy/compose.yaml`，不部署、不随默认 profile 启动，宿主也不安装
  `inpulse-backup.*` 单元；`backupctl.sh enable` 会拒绝执行（缺少
  `--confirm-go-live` 或缺少演练证据）。
- 上线时：完成 §3 前置后执行一次 `enable`；调度生效后 18 小时内必须出现第一条成功记录
  （`enable` 以 `enabled-at` 记录启用时间作为 watchdog 起点，刚启用不会误报），超阈值后
  watchdog 在整点检查时告警并按 6 小时重复间隔节流。
- 上线后：每月在与生产隔离的环境完成一次全新主机恢复（§7），每季度模拟丢失原主机。

## 3. 启用前必须准备

1. `backup` / `audit-archive` 服务随发布清单交付，并声明 `profiles: [operations]`；
2. `/etc/inpulse/backup.env` 按 `deploy/backup/backup.env.example` 落地（不含任何凭据值）；
3. 告警接收方文件（默认 `/etc/inpulse/secrets/backup-alert-webhook`）存在、非空、
   mode `0400`、属主 `root`；
4. 加密密钥与异机存储授权就绪，且**与备份数据分库存放**；
5. 全新主机恢复演练完成并写入证据文件（默认 `/etc/inpulse/backup-drill-evidence`，
   含演练日期、执行人、实测 RPO/RTO、smoke test 结果）；
6. 发布清单中的镜像 digest、迁移版本与版本化 keyring 可用。

`enable` 会逐项校验 2–5 与 compose 服务；任一项缺失即 fail closed，不安装任何单元。

## 4. 启用、停用与状态

```bash
# 启用（仅上线时执行；需要 root）
sudo deploy/backup/backupctl.sh enable --confirm-go-live \
  --drill-evidence /etc/inpulse/backup-drill-evidence

# 立即验证一次（可选；确认异机副本可解密读取后再离开）
sudo /usr/local/lib/inpulse/backupctl.sh run

# 状态：配置、阈值、最近成功时间、timer 状态
/usr/local/lib/inpulse/backupctl.sh status

# 停用（不改动任何备份文件与状态目录）
sudo deploy/backup/backupctl.sh disable
```

启用后安装的单元：

| 单元 | 作用 |
| --- | --- |
| `inpulse-backup.timer` | 每 12 小时触发（`OnCalendar=*-*-* 00/12:00:00`、`Persistent=true`、随机延迟 15 分钟） |
| `inpulse-backup.service` | 调用 `backupctl.sh run`；`TimeoutStartSec=3h`；失败走 `OnFailure` |
| `inpulse-backup-alert@.service` | 发送告警，实例名 `%i` 为失败单元 |
| `inpulse-backup-watchdog.timer` / `.service` | 每小时检查 staleness，超过 18 小时没有成功记录即告警（首次成功前以启用时间为基线；重复告警按 `INPULSE_BACKUP_ALERT_REPEAT_HOURS` 节流） |

并发锁：`run` 用 `flock` 独占 `/run/lock/inpulse-backup.lock`；上一次任务未结束时本次触发
直接跳过（不排队），并留下日志。

## 5. 密钥、凭据与告警接收方

- 加密密钥、异机存储凭据、告警 Webhook 一律不进入仓库、不写入环境变量值；只通过受限文件
  （mode `0400` / `0600`、属主 `root`）或 compose secrets（`/run/secrets/*`）提供。
- 告警接收方地址登记在运维侧受控配置中：本 Runbook 记录**接收方归属与联系方式**，仓库不保存
  地址本身。接收方变更属于发布变更，需在发布清单中记录。
- 密钥轮换与恢复：恢复发布清单引用的全部版本化 keyring（Session、幂等 fingerprint、审计、
  TOTP KEK），保留仍被未过期幂等记录引用的 fingerprint key；密钥不得与备份同库存放。

## 6. 每次备份做什么

以下步骤由 `backup` 服务实现（F-10.3），宿主只负责触发：

1. `pg_dump --format=custom --no-owner --no-acl`，并排除 `app.user_sessions`、
   `app.session_csrf_tokens`、`app.preauth_sessions` 的数据（表结构保留）；
2. dump 直接流入 AEAD/age 加密器，不产生明文最终文件；
3. 生成密文 SHA-256 与签名清单（数据库版本、迁移版本、镜像 digest、Git SHA、时间、文件
   大小、审计链锚点）；
4. 同一文件系统原子重命名为最终文件后上传异机只读存储；
5. 本机密文保留 7 天，异机至少 30 天；
6. 不使用 `pg_dump` 恢复数据库角色与密码：角色由 bootstrap 脚本建立，角色密码单独保管；
7. `audit-archive` 每小时写签名链头检查点，每日导出加密审计明细；
8. 记录最近一次成功备份、异机上传、审计归档与恢复演练时间。

手工执行与验证（等价于宿主调度的单次任务；压缩包与清单在 `backup_encrypted` 卷中）：

```bash
# 手工执行一次备份（宿主 backupctl.sh run 的等价命令）：
sudo docker compose --project-name inpulse --env-file deploy/.env.deploy \
  --file deploy/compose.yaml --profile operations run --rm -T backup

# 解密校验备份包（只读取 BACKUP_ENCRYPTION_KEY_FILE，不访问数据库与异机存储）：
sudo docker compose --project-name inpulse --env-file deploy/.env.deploy \
  --file deploy/compose.yaml --profile operations run --rm -T backup \
  node dist/backup-cli.js verify \
  --file /backup/backup-<stamp>-<id>.pgdump.enc \
  --manifest /backup/backup-<stamp>-<id>.pgdump.enc.manifest.json
```

`verify` 输出明文/密文 SHA-256、字节数与签名版本；清单校验失败或哈希不一致即非零退出。
备份任务失败时保留本机密文（保留期 7 天），上传恢复后必须在窗口内补齐异机副本。

## 7. 全新主机恢复

1. 校验发布清单签名与全部镜像 digest，创建空卷，用 bootstrap 脚本建立全部 LOGIN/NOLOGIN
   角色与默认权限；
2. 校验密文 Hash，在 tmpfs 解密，以 `app_owner` 执行 `pg_restore --no-owner --no-acl`；
3. 重新执行权限收敛脚本，验证 runtime/backup 不拥有对象且不能 DDL；
4. 确认 `user_sessions` / `session_csrf_tokens` / `preauth_sessions` 为空；若恢复自物理全库
   快照，在 API 启动前轮换 Session HMAC key 并递增全部用户 `auth_version`；
5. 校验迁移版本、扩展、约束、审计序号/Hash/远端锚点与 MFA/审计旧密钥可用性；
6. 启动 API/Web，运行登录、项目读取、写入回滚、搜索权限与审计读取 smoke test；
7. 记录实测 RPO/RTO（目标 RPO ≤ 24h、RTO ≤ 2h）；未达标即上线阻断。

## 8. 演练记录

| 字段 | 说明 |
| --- | --- |
| 演练日期与执行人 | 每月隔离环境一次、每季度模拟丢失原主机一次 |
| 来源备份文件 | 密文 Hash、签名清单校验结果 |
| 恢复耗时 | 实测 RTO |
| 数据新鲜度 | 实测 RPO（最近一次成功备份与数据时间差） |
| smoke test | 登录、项目读取、写入回滚、搜索权限、审计读取结果 |
| 结论 | 通过/不通过；不通过即视为没有有效备份 |

## 9. 故障处理

| 症状 | 判断依据 | 处置 |
| --- | --- | --- |
| 备份失败 | 告警“备份告警：failed-unit:inpulse-backup”（非零退出或超时；由 `OnFailure` 上报） | `systemctl status inpulse-backup.service`、`journalctl -u inpulse-backup.service`；修复数据库/异机存储可达性后手工 `backupctl.sh run` |
| 超过 18 小时无成功记录 | 告警“备份超过 18 小时未成功” | 检查 `systemctl list-timers inpulse-backup.timer`、宿主时钟、磁盘空间与锁文件；修复后手工重跑（同一未恢复故障按 `INPULSE_BACKUP_ALERT_REPEAT_HOURS` 节流） |
| 告警发送失败 | 日志“告警发送失败”或“告警接收方文件缺失” | 检查 Webhook 文件权限与网络；修复前把告警降级为人工巡检并记录 |
| 异机上传失败 | 备份服务非零退出 | 检查异机存储授权与配额；本机密文 7 天保留是最后窗口，必须在窗口内恢复上传 |
| 恢复演练未通过 | §8 记录 | 视为没有有效备份：上线阻断，按 §7 重跑并记录 |

## 10. 相关记录

- [技术设计 §11.5 备份与恢复](../../技术设计v1.2.2.md)
- [ADR-020 加密逻辑备份与全新主机恢复验证](../adr/ADR-020.md)
- [ADR-018 PostgreSQL 数据卷与数据库角色分离](../adr/ADR-018.md)
- [测试矩阵](../test-matrix.md)：`DEPLOY-003`、`DEPLOY-004`、`RECOVERY-001`
- 宿主调度配置与单元：[`deploy/backup/`](../../deploy/backup/)
- [升级与回滚 Runbook](./upgrade-rollback.md)