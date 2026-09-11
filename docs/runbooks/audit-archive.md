# 审计归档 Runbook

状态：**上线运维 Runbook**，对应[技术设计 §11.5](../../技术设计v1.2.2.md)第 7 步、[开发工作书 F-08](../../开发工作书v1.0.md)
步骤 6，以及 `deploy/compose.yaml` 的 operations `audit-archive` 服务。适用对象为启用后的
审计远端归档：每小时签名链头检查点、每日加密明细导出到 WORM 对象存储。

## 1. 机制概览

| 任务 | 频率 | 载体 | 产物 |
| --- | --- | --- | --- |
| 链头检查点 | 每小时 | `inpulse-audit-archive-checkpoint.timer` -> `audit-archivectl.sh run-checkpoint` | `<prefix>/checkpoints/chain=<slug>/<generatedAt>-seq<n>.json` |
| 明细导出 | 每日 UTC 00:20 | `inpulse-audit-archive-export.timer` -> `audit-archivectl.sh run-export` | `<prefix>/exports/date=<YYYY-MM-DD>/audit-export-<from>-<to>.jsonl.enc` 与同名 `.manifest.json` |

- 归档进程固定使用 `audit_archive_writer`（只读 `app.audit_logs` 与 `app.audit_chain_heads`），
  不挂载在线审计 HMAC keyring；
- 检查点与导出清单使用独立 `ARCHIVE_SIGNING_KEY_FILE`（HMAC-SHA256 + JCS 规范化）签名；
  导出密文为 AES-256-GCM，加密子密钥由签名密钥经 HKDF-SHA256 派生（info `inpulse-audit-export-v1`）；
- WORM 凭据只允许新建对象：`409/412` 按“对象已存在”幂等处理，**不覆盖、不删除**；
- 归档中断不改变在线审计链；重跑只会写出新对象。

## 2. 前置条件

- Compose secrets（`deploy/secrets/`，mode 0400，声明见 `deploy/compose.yaml`）：
  - `db_audit_archive_password`：`audit_archive_writer` 密码；
  - `audit_worm_credentials`：JSON，`{version, endpoint, region, bucket, accessKeyId, secretAccessKey, prefix?, forcePathStyle?, objectLock?}`；
  - `audit_archive_signing_key`：每行 `<version>:<64 hex>`，取最大版本写入，旧版本保留用于验签；
- `OPS_IMAGE_REF` 已由发布清单解析为 `exact-tag@sha256:digest`，且 `pnpm check:deploy --env <envfile>` 通过；
- 宿主配置 `/etc/inpulse/audit-archive.env`（参考 [audit-archive.env.example](../../deploy/backup/audit-archive.env.example)）；
- 告警接收方复用备份通道 `INPULSE_BACKUP_ALERT_WEBHOOK_FILE`（见[备份与恢复 Runbook](./backup-restore.md)）。

## 3. 启用与停用

```bash
# 发布清单提供 compose.yaml / .env.deploy / secrets 之后（上线门禁动作）：
sudo deploy/backup/audit-archivectl.sh enable --confirm-go-live
sudo deploy/backup/audit-archivectl.sh status

# 停用（不改动 WORM 中任何已写入对象）：
sudo deploy/backup/audit-archivectl.sh disable
```

`enable` 会拒绝：缺少 `--confirm-go-live`、缺少宿主配置、compose 未交付
operations `audit-archive` 服务等提前启用场景。上线前 `--profile operations` 保持未启用。

## 4. 手工执行与验证

```bash
# 每小时任务（检查点）
sudo docker compose --project-name inpulse --env-file deploy/.env.deploy \
  --file deploy/compose.yaml --profile operations run --rm -T \
  audit-archive node dist/cli.js checkpoint

# 每日任务（默认前一 UTC 自然日；可用 --from/--to 显式指定）
sudo docker compose --project-name inpulse --env-file deploy/.env.deploy \
  --file deploy/compose.yaml --profile operations run --rm -T \
  audit-archive node dist/cli.js export
```

验证归档对象（在能读取 WORM 的运维主机上执行；等价本地命令
`pnpm --filter @inpulse/ops audit-archive verify ...`）：

```bash
node dist/cli.js verify checkpoint --file <checkpoint.json>
node dist/cli.js verify export --file <audit-export-*.jsonl.enc> --manifest <audit-export-*.manifest.json>
```

验证内容：检查点/清单签名、导出包 AES-GCM 认证与明文 SHA-256，以及清单中的密文
SHA-256、`rowCount` 与对象键绑定。恢复演练还必须校验序号、Hash 与密钥版本链。

## 5. 失败与告警

- 宿主 `flock` 保证同一时间只有一个归档任务，重叠触发直接跳过；
- 任务失败或超时通过 `OnFailure=inpulse-backup-alert@%N.service` 上报（与备份共用告警通道）；
- 常见失败与处置：

| 现象 | 处置 |
| --- | --- |
| `ARCHIVE_SIGNING_KEY_FILE` 解析失败 | 检查文件格式 `<version>:<64 hex>`，每行一个版本 |
| `WORM put ... failed with status 403` | 检查 WORM 凭据、bucket 策略与对象锁配置 |
| `WORM` 返回 409/412 | 正常幂等（对象已存在），无需处理 |
| 数据库 `42501` | 检查 `audit_archive_writer` 的 SELECT 权限与密码 Secret |
| 导出窗口疑似缺行 | 用 `--from/--to` 扩大窗口重跑，并与 `app.audit_logs.occurred_at` 对账 |

## 6. 密钥轮换与红线

- 轮换：在 `audit_archive_signing_key` 追加更高版本行；旧版本必须保留，供历史检查点与导出清单验签；
- 在线审计 HMAC keyring 与归档签名密钥相互独立，不得混用；归档容器不挂载在线 HMAC；
- 归档凭据不得具备覆盖或删除对象能力（对象锁/WORM 策略保证）；
- 归档 Secret 只从 `/run/secrets/*` 读取；缺失或权限不合规必须 fail closed。

## 7. 记录

| 场景 | 记录内容 |
| --- | --- |
| 启用 | go-live 确认、compose 服务、`audit-archivectl.sh status` 输出 |
| 验证 | 检查点/导出对象键、验签结果、最近成功时间 |
| 失败 | 失败单元名、错误信息、处置动作、重跑结果 |
