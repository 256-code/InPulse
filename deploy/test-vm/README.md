# 测试 VM 更新手册

本目录的 `update.ps1` 用于把仓库当前代码更新到测试 VM。它面向单机 Docker
Compose + 本地 registry 的测试环境，不是生产发布流程：生产镜像 Tag/digest 绑定
与签名发布仍按技术设计第 12 章由人工完成，生产升级与回滚口径见
`docs/runbooks/upgrade-rollback.md`。

## 测试环境现状

| 项目          | 值                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| VM            | `10.1.104.45`（Ubuntu + Docker + Compose v2；SSH 账户 `libiao`，docker 命令需 sudo）                           |
| 访问入口      | `https://test-inpulse.libiaorobot.com/`（DNS 指向同一台 VM；HTTPS 请用域名访问，用 IP 会出现证书不匹配告警）   |
| 部署目录      | `/home/libiao/inpulse-deploy`（`compose.yaml`、`.env.deploy`、`secrets/`）                                     |
| 镜像目录      | `/home/libiao/inpulse-images`                                                                                  |
| 本地 registry | `127.0.0.1:5000`（容器 `inpulse-registry`，镜像 `registry:2`）                                                 |
| 运行服务      | `db`（PostgreSQL 18 + PGroonga）、`migrate`（一次性）、`api`、`web`（Nginx）                                   |
| 对外端口      | 22、80（308 跳转到 443）、443                                                                                  |
| SSO           | Casdoor 测试环境 `https://authtest.libiaorobot.com`                                                            |
| TLS           | 公司 ALLinSSL 下发 `*.libiaorobot.com` 通配符（DigiCert，2026-10-15 生效，自动续签；文件 `secrets/tls_*.pem`） |
| 部署目录补充  | `backups/`（同步前的 pg_dump）、`compose.yaml.bak-*`、`.env.deploy.bak-*`（回滚用）                            |
| 企业微信桥接  | 独立容器 `inpulse-wecom-bridge`（非 compose 管理；源码 `deploy/test-vm/wecom-bridge/` 为本地唯一源，用 `deploy/test-vm/update-bridge.ps1` 同步；个人绑定码自助绑定与项目群绑定兑换均已实现，见「企业微信机器人桥接」） |
| AI 辅助转换   | 已启用（`AI_ASSIST_ENABLED=1`）；API Key 待管理员在设置页重填（见「AI 辅助转换启用」） |
| 当前版本      | 5 个镜像统一为 `0.1.0-20261015-6f23ab4`，`BACKUP_GIT_SHA=6f23ab4`（2026-10-15 最新同步） |

## 一次性准备

1. 配置免密登录（只需做一次）。脚本会生成一把无 passphrase 的部署密钥
   `~/.ssh/inpulse_deploy_ed25519`，并把公钥追加到 VM 的 `~/.ssh/authorized_keys`，
   过程中只要求输入一次 VM 密码：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File deploy/test-vm/update.ps1 -SetupKey
   ```

   不配置也能更新，只是上传镜像、执行远端脚本会分别提示输入 VM 密码（约 4 次）。
   脚本不会覆盖你已有的密钥；想用自己的密钥就加 `-SshKey <私钥路径>`。

2. 让脚本能自动应答远端 sudo：在当前 PowerShell 会话里把 VM 登录密码放进环境变量
   `INPULSE_VM_PASSWORD`（脚本只通过 stdin 把它交给远端 `sudo -S`，不写入文件、
   不出现在命令行）。不设置也可以，远端 sudo 会在终端交互提示密码。

3. 确认 Docker Desktop 已启动，且本机能连通 VM 的 22 端口。

4. 本机执行策略是 `Restricted` 时，`powershell -File` 会被拦下；统一按上面的
   `-NoProfile -ExecutionPolicy Bypass` 形式调用即可（只对本次调用生效，不改系统设置）。

## 日常更新

在仓库根目录执行，默认构建并更新全部 5 个镜像：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/test-vm/update.ps1
```

只改了一部分时用 `-Targets` 省时间：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/test-vm/update.ps1 -Targets web
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/test-vm/update.ps1 -Targets api,migrate
```

脚本依次完成：构建镜像 → 导出 tar → 上传 → VM 上 load/tag/push 到
`127.0.0.1:5000` → 以 `tag@sha256` 更新 `.env.deploy` 的 `*_IMAGE_REF` →
`docker compose up -d`（`migrate` 先执行数据库迁移）→ 健康检查 → 清理 tar。
构建日志留在本机 `%TEMP%\inpulse-update-<tag>\build-<target>.log`。
2026-10-15 已分三次实测跑通整条链路（`-Targets web`、`-Targets api,web,migrate -FixEol`、
`-Targets ops`、`-Targets db-bootstrap`），5 个镜像统一到 `0.1.0-20261015-277fb89`：
migrate 报 `0 applied, 42 already present`，api/web/db 全部 healthy，`/health/ready` 与
`/` 返回 200，匿名访问受保护接口 401，`/api/v1/auth/sso/start` 302 跳到 Casdoor 测试环境，
api 容器内访问 Casdoor discovery 返回 200（`egress` 生效）。

常用参数：

| 参数                                              | 作用                                                          |
| ------------------------------------------------- | ------------------------------------------------------------- |
| `-Repo`                                           | 要构建的工作区，默认脚本所在仓库根                            |
| `-Targets`                                        | `api`/`web`/`migrate`/`db-bootstrap`/`ops`，或 `all`（默认） |
| `-Tag`                                            | 镜像 Tag，默认 `0.1.0-<yyyyMMdd>-<git 短 sha>`                |
| `-SetupKey`                                       | 一次性配置免密部署密钥后退出                                  |
| `-SshKey`                                         | 指定 SSH 私钥；留空时自动挑第一把能免密登录的候选密钥         |
| `-VmPassword`                                     | VM 密码，只喂给远端 `sudo -S`；推荐改用 `INPULSE_VM_PASSWORD` |
| `-Mirror`                                         | 基础镜像源，默认 `docker.1ms.run`                            |
| `-NoMirror`                                       | 不走镜像源，直接用 Dockerfile 里的原始地址                    |
| `-FixEol`                                         | 构建 migrate 前把漂移成 CRLF 的迁移文件按字节转回 LF          |
| `-SkipBuild`                                      | 跳过构建与上传，用 VM 上已有 tar 重跑远端更新                 |
| `-KeepTar`                                        | 保留两端 tar（默认清理）                                      |
| `-VmHost`/`-VmUser`/`-RemoteDir`/`-ImageDir`        | 覆盖默认连接信息与目录                                        |

## 基础镜像与镜像源

公司网络直连不了 Docker Hub，`docker build` 会卡在 `FROM` 阶段。脚本默认先用镜像源
`docker.1ms.run` 把 Dockerfile 里 `FROM` 与 `# syntax=` 引用的基础镜像拉到本地、重打回
原始名字，然后才开始构建：

- 带 `@sha256:...` 的引用会在拉取后逐个校验 digest，不匹配立即失败，避免镜像源掉包；
- 本地已缓存全部基础镜像时加 `-NoMirror` 跳过这一步，更快；
- 换源用 `-Mirror <host>`。`docker.1ms.run` 于 2026-10-15 实测可拉取 `node`、`postgres`；
  `docker.m.daocloud.io` 对 `library/*` 返回 502。

基础镜像清单直接从 `deploy/docker/*.Dockerfile` 解析，改 Dockerfile 不用改脚本。

## 改了什么就更新什么

| 改动范围                              | Targets                     | 说明                                       |
| ------------------------------------- | --------------------------- | ------------------------------------------ |
| `apps/web`、`deploy/docker/nginx.conf`  | `web`                         | 前端产物与反向代理配置都打在 web 镜像里    |
| `apps/api`、`packages/*`                | `api`                         |                                            |
| `database/migrations/*`               | `migrate`（通常连 `api`）        | 迁移由 migrate 服务执行                    |
| `database/bootstrap/*`              | `db-bootstrap`              | 只在数据卷为空、首次初始化数据库时生效     |
| `apps/ops`、`deploy/backup/*`           | `ops`                         | 备份与审计归档                             |
| `deploy/compose.yaml`、`.env.deploy`    | 不走镜像                    | 见下一节                                   |
| `deploy/test-vm/wecom-bridge/*`      | 不走 compose 镜像             | 跑 `deploy/test-vm/update-bridge.ps1`，见「企业微信机器人桥接」 |

## compose.yaml / .env.deploy 改动怎么同步

脚本只改 `.env.deploy` 里的 `*_IMAGE_REF` 与 `BACKUP_GIT_SHA`，**不会**覆盖 VM 上的
`compose.yaml`：VM 侧有测试环境专属适配，直接覆盖会打断服务。改了仓库里的
`deploy/compose.yaml` 后按下面三步手工同步。

### 第一步：补齐 compose 新引用的 Secret 文件

compose 声明了 `file:` 型 Secret 而 VM 上没有对应文件时，`compose up` 会直接失败。
ADR-068 起 api 需要 `secrets/ai_assist_encryption_key`（一行 `版本:64 位十六进制`，
属主 `10001:10001`、权限 `400`）。在 VM 上执行，**不要把内容打印或贴进任何文档**：

```bash
cd /home/libiao/inpulse-deploy/secrets
sudo install -m 400 -o 10001 -g 10001 /dev/null ai_assist_encryption_key
printf '1:%s\n' "$(openssl rand -hex 32)" | sudo tee ai_assist_encryption_key > /dev/null
stat -c '%n %U:%G %a %s' ai_assist_encryption_key
```

`AI_ASSIST_ENABLED=0` 时 api 不会去读它，但文件必须存在。这把主密钥用于信封加密
管理员在线填写的 AI 端点密钥：**丢了就无法解密已存密钥**，只能在管理页重新填写。

### 第二步：比对差异，只合并新增部分

```powershell
scp libiao@10.1.104.45:/home/libiao/inpulse-deploy/compose.yaml $env:TEMP\vm-compose.yaml
git diff --no-index -- $env:TEMP\vm-compose.yaml deploy/compose.yaml
```

2026-10-15 起 `egress` 已按 [ADR-074](../../docs/adr/ADR-074.md) 并入仓库
`deploy/compose.yaml`；同日 VM 侧新增企业微信接线（见「企业微信机器人桥接」），
这是当前仓库与 VM 的 compose 唯一差异——仓库 `deploy/compose.yaml` 后续变更时，
按本节流程比对合并并保留该差异。下列适配不能丢
（`tmpfs` 写法与 `DB_SSLMODE` 已进仓库工作区）：

- `api` 服务的 `networks: [backend, egress]` 与 `networks` 段的 `egress` 定义。
  `backend` 是 internal 网络、没有外网出口，api 靠 `egress` 访问 Casdoor 与 AI 端点；
  丢掉它 SSO 会回跳 `/login?sso_error=internal`。
- `api` 服务的 `WECOM_ROBOT_ENCRYPTION_KEY_FILE` / `WECOM_ROBOT_ENCRYPTION_KEY_VERSION`
  环境变量、`wecom_robot_encryption_key` 只读 Secret 挂载项，与顶层
  `secrets.wecom_robot_encryption_key: file: ./secrets/wecom_robot_encryption_key`
  （2026-10-15 加；丢它管理员「企业微信机器人」设置页会报 `ENCRYPTION_KEY_UNAVAILABLE`）。

`.env.deploy` 侧要保留：`DB_SSLMODE=prefer`（VM 的 PostgreSQL 未启用服务端 TLS，
postgres.js 在 `require` 下会直接连接失败）、指向 Casdoor 测试环境的 `SSO_*`
（回调地址须已在 Casdoor 应用里登记）。

### 第三步：备份、上传、校验、重启

```bash
cd /home/libiao/inpulse-deploy
sudo cp -p compose.yaml compose.yaml.bak-$(date +%Y%m%d-%H%M%S)
# 本机把合并后的文件 scp 覆盖上来，然后在 VM 上：
sudo docker compose --env-file .env.deploy -f compose.yaml config --quiet
sudo docker compose --env-file .env.deploy -f compose.yaml up -d
```

`config --quiet` 只应打印 `uid/gid/mode is not supported outside Swarm mode` 这类无害
告警；出现其它报错就不要 `up`，先用 `compose.yaml.bak-*` 还原。

另外，`compose.yaml` 的 tmpfs 必须写成块式列表或单字符串；写成
`tmpfs: [/tmp:size=64m, noexec, nosuid, nodev]` 会被 YAML 解析成 4 个挂载项。

2026-10-15 已按上述流程把 ADR-068 的 `AI_ASSIST_ENCRYPTION_KEY_FILE` /
`AI_ASSIST_ENCRYPTION_KEY_VERSION`、只读 Secret 挂载与顶层
`secrets.ai_assist_encryption_key` 合入 VM 侧 `compose.yaml`
（备份 `compose.yaml.bak-20261015-113910`），`egress` 适配保留。

## 证书下发（公司 ALLinSSL，2026-10-15 接入）

公司用 ALLinSSL 统一管理 SSL 证书（`*.libiaorobot.com` 通配符、DNS 校验、自动续签），
VM 按官方「SSH 下发」方式接入，不需要自行申请证书；2026-10-15 已首次下发生效
（DigiCert RapidSSL 签发，主体 `*.libiaorobot.com`，有效期至 2026-12-01，到期前自动续签）：

- 低权限账号 `allinssl`（不加入 sudo 组）只能覆盖
  `/etc/ssl/libiaorobot.com.pem` 与 `/etc/ssl/libiaorobot.com.key` 两个文件；
- 后置命令固定为 `sudo /usr/local/bin/allinssl-reload`（脚本 root 所有）：校验两个文件
  非空 → 覆盖 `secrets/tls_cert.pem` / `secrets/tls_key.pem`（原地写、保 inode，
  web 容器内立即可见）→ `chown 101:101`、`chmod 600` →
  `docker exec inpulse-deploy-web-1 nginx -t && nginx -s reload`，无需重启容器；
- 连接信息与账号密码见 `/home/libiao/inpulse-deploy/allinssl-ssh-info.txt`（600），
  在 ALLinSSL「授权 API 管理 → SSH」按该文件添加主机；工作流部署节点填：证书路径
  `/etc/ssl/libiaorobot.com.pem`、私钥路径 `/etc/ssl/libiaorobot.com.key`、后置命令
  `sudo /usr/local/bin/allinssl-reload`，建议开启「重复部署跳过」；
- 手动自测（任意能连到 VM 的机器）：

  ```bash
  ssh allinssl@10.1.104.45 'test -w /etc/ssl/libiaorobot.com.pem && test -w /etc/ssl/libiaorobot.com.key && sudo -n /usr/local/bin/allinssl-reload && echo OK'
  ```

- 注意：通配符只覆盖一级子域名（`test-inpulse.libiaorobot.com` 可以）；不要手删
  `/etc/ssl` 下这两个文件（`allinssl` 无法重建，需重跑初始化）。

## 同步前给数据库做备份

镜像能按 `.env.deploy.bak-*` 回滚，但迁移**只能向前**：新镜像跑过的迁移不会因为回滚
镜像而撤销。所以涉及 `migrate` 的更新前先落一份 dump（102 MB 的测试库约 1 秒）：

```bash
cd /home/libiao/inpulse-deploy
mkdir -p backups
sudo docker exec inpulse-deploy-db-1 pg_dump -U cluster_bootstrap -d app -Fc \
  > backups/pre-sync-$(date +%Y%m%d-%H%M%S).dump
sudo chown libiao:libiao backups/pre-sync-*.dump
sudo chmod 600 backups/pre-sync-*.dump
sudo docker exec -i inpulse-deploy-db-1 pg_restore --list < backups/<文件名>.dump | wc -l
```

最后一条用来确认 dump 可读（应输出几百行条目；2026-10-15 那份是 677 行、43 张表）。
恢复用 `pg_restore --clean --if-exists`，属于破坏性操作，执行前先确认没人在用这台 VM。

## 把本地演示数据同步到测试 VM（2026-10-15 实作）

目标：把本机演示库（`app` @ `127.0.0.1:55432`）的行数据整体搬到 VM。表结构跟随
镜像迁移，不在本流程内。全程约 1 分钟；执行前先按上一节落一份 VM 备份。

1. 本地导出（PowerShell）：

   ```powershell
   & "D:\PostgreSQL\18\pgsql\bin\pg_dump.exe" -Fc -f $env:TEMP\inpulse-demo-app.dump `
     "postgresql://cluster_bootstrap@127.0.0.1:55432/app"
   ```

2. 干净性预检：本地演示库可能残留历史 E2E 夹具的悬空行（外键孤儿），直接恢复会在
   加约束阶段失败。推荐在 VM 上建一个 scratch 演练库空跑一次恢复（`create database
   app_scratch` → `pg_restore` 不加 `--single-transaction` 收集全部 `ERROR` →
   `drop database app_scratch`），按报告清干净再重新导出。2026-10-15 实测只报出 4 行
   `change_record_version_leftovers` 孤儿（对应记录本体早已删除），删除后通过。

3. 上传并恢复（破坏性操作，确认没人在用 VM 时执行）：

   ```bash
   cd /home/libiao/inpulse-deploy
   sudo docker compose --env-file .env.deploy -f compose.yaml stop api
   sudo docker exec -i inpulse-deploy-db-1 pg_restore -U cluster_bootstrap -d app \
     --clean --if-exists --single-transaction < /tmp/inpulse-demo-app.dump
   sudo docker compose --env-file .env.deploy -f compose.yaml up -d
   ```

   `--single-transaction` 保证失败整体回滚、原数据完好（2026-10-15 实际演练过一次）。

4. 迁移账本：dump 会连同本机的 `app.schema_migrations` 一起恢复。本机账本只要存在
   行尾漂移，`migrate` 就会 checksum fail closed、连带 api 不启动（2026-10-15 实测
   13 条漂移直接炸停）。处理二选一：优先修好本机账本（把 checksum 对齐到文件的 LF
   形态，已修，此后本机与 VM 账本逐字节一致）；或恢复后用 pre-restore dump 的原账本
   替换：

   ```bash
   docker exec -i inpulse-deploy-db-1 pg_restore -f - --data-only -t schema_migrations \
     < backups/pre-restore-<时间戳>.dump > /tmp/mig-rows.sql
   { echo "delete from app.schema_migrations;"; cat /tmp/mig-rows.sql; } | \
     docker exec -i inpulse-deploy-db-1 psql -v ON_ERROR_STOP=1 -1 -U cluster_bootstrap -d app
   ```

   注意 `-t` 不要带 `app.` 前缀（带 schema 限定会匹配不到任何条目）。

5. 收尾：清理 dump 带入的本机残留扩展（如 `drop extension if exists pg_trgm`，0005
   契约迁移早已移除，本机属开发调试残留），再按「更新后验证」核对行数与站点探针。

两处跨环境绑定差异（演示用途可接受）：审计链 HMAC 由各自环境的
`secrets/audit_hmac_keyring` 签发，跨环境的审计链全量校验/归档任务会报不匹配；
`ai_assist_settings` 的密钥密文由本地主密钥加密，VM 当前 `AI_ASSIST_ENABLED=0`
不读取——要在 VM 试用 AI 助手，在管理页重新填写一次即可。
## 企业微信机器人桥接（2026-10-15 部署）

测试 VM 的企业微信通知推送由一个**独立于 compose 栈**的桥接容器完成：轮询
`app.notifications`，把新通知经企业微信智能机器人长连接（`aibot_send_msg`）推给
已映射的成员。桥接源码已归档进本仓库 `deploy/test-vm/wecom-bridge/`（本地唯一源，
用 `deploy/test-vm/update-bridge.ps1` 同步到 VM）；它属于测试环境 PoC，不进
`deploy/compose.yaml`、不参与生产镜像与 CI 门禁。

- 容器 `inpulse-wecom-bridge`：`--restart unless-stopped`、`10001:10001`、只读根 +
  tmpfs；创建时接 `egress` 出网，再 `docker network connect` 到 `backend` 连库。
  镜像 `inpulse-wecom-bridge:0.1.0-<日期>-bridge<内容哈希前 7 位>`（同内容同 Tag；
  `FROM` 固定 api 镜像 `d7407c7`，复用其 node 24；pg/ws 与脚本一起打进镜像，已推入
  本地 registry；历史 Tag 均保留可回滚）。
- 部署目录 `/home/libiao/inpulse-deploy/wecom-bridge/`（`app/` 脚本与配置、
  `bridge.env`、`state/` 状态）。机器人凭据从数据库 `app.wecom_robot_config` 读取并
  用主密钥 `secrets/wecom_robot_encryption_key`（0400 / 10001:10001，与本地 keyring 同源）
  解密；管理员在「成员与设置 → 企业微信机器人」保存的新凭据会被桥接自动感知并重连。
  `app_runtime` 无 `audit_logs` 读权限，桥接查询已去掉该 join，操作人回落显示「系统」。
- 收件人映射以数据库 `app.user_wecom_bindings`（`status = 'ACTIVE'`）为唯一来源——用户在
  「账户菜单 → 绑定企业微信」里自助绑定/解绑即时生效（解绑后不再推送，即使
  `bridge-config.json` 里残留旧映射）。`bridge-config.json` 的 `recipients` 只作为「数据库里
  从未出现过该用户记录」时的过渡兜底，日常无需再手工维护。状态在
  `state/bridge-state.json`（lastId），只推新通知、不补发历史。
- **同一机器人同时只允许一条长连接**：VM 桥接与本地 PoC 不能同时在线，否则互相踢线。
  本地要跑 PoC 时先停 VM 侧，用完再启动。

常用命令（VM 上执行，需 sudo）：

```bash
sudo docker logs --tail 50 inpulse-wecom-bridge   # 日志：订阅 errcode / 推送 / 心跳
sudo docker restart inpulse-wecom-bridge          # 重启（排查用；收件人映射改数据库即时生效）
sudo docker stop inpulse-wecom-bridge             # 暂停（本地要用 PoC 时）
sudo docker start inpulse-wecom-bridge            # 恢复
```

改脚本或重建镜像：**先改本地 `deploy/test-vm/wecom-bridge/`（唯一源，不要在 VM 上直接改）**，
再在仓库根目录执行 `powershell -NoProfile -ExecutionPolicy Bypass -File deploy/test-vm/update-bridge.ps1`：
上传 -> 远端 sha256 校验 -> 备份源码 -> 构建并推 registry -> 按固定安全参数重建容器并等「订阅成功」。
`-SkipRestart` 只更新镜像；`-RollbackTo <旧 Tag>` 用历史镜像重建容器回滚。

绑定码自助绑定（2026-10-15 已实现，镜像 bridge3）：用户在「账户菜单 → 绑定企业微信」生成一次
性绑定码（10 分钟有效），把它发送给企业微信里的 InPulse 机器人即可自动落库；桥接以 `app_runtime`
角色调用 `app.redeem_wecom_binding_code`（SECURITY DEFINER，单事务消费），成功后回复「绑定成功」，
失败按 WBC01/02/04/05/06 分类回复。`smoke-redeem.mjs`（镜像内 `/opt/wecom-bridge/`）
可在临时容器自检兑换链路（全程事务、结束回滚，不产生历史数据残留）。

项目群绑定兑换（2026-10-15 已实现，镜像 bridge4）：项目组长/系统管理员在「项目成员页 → 企业微信项目群」
生成一次性项目绑定码（10 分钟有效；发送者需已完成个人绑定，系统管理员豁免成员校验）。在目标群里
@机器人 发送该码（形如「@内部研发项目管理系统 XXXX-XXXX-XXXX-XXXX」）即完成群绑定；桥接从群消息文本中
提取绑定码（容忍「@机器人 」前缀），调用 `app.redeem_project_wecom_binding_code`（SECURITY DEFINER，
单事务消费），结果用 `chat_type:2` 主动推送回该群，失败按 PWG01～PWG08 分类回复；群里的非绑定码消息保持
安静，不再触发私聊回声。`smoke-project-group-redeem.mjs`（镜像内 `/opt/wecom-bridge/`）自检 16 项
（提取 / 首次绑定 / 幂等 / 换绑 / PWG01～PWG06）。**群消息投递**（任务派发与项目动态推送进项目群）仍属第二批，未部署。

## AI 辅助转换启用（2026-10-15）

`.env.deploy` 的 `AI_ASSIST_ENABLED` 已置 1 并重建 api（备份
`.env.deploy.bak-20261015-145032`）。VM 侧 `secrets/ai_assist_encryption_key` 是
2026-10-15 11:38 在 VM 上生成的主密钥（与本地不同），从本地同步来的 API Key 密文
解不开——需要管理员在「系统设置 → AI 辅助转换」重填 API Key 并测试连接。

## 数据库迁移

- `compose up -d` 时 `migrate` 先执行（`api` 依赖 `service_completed_successfully`）；
  迁移失败则 api 不启动，脚本会打印 migrate 退出码与 api 最近日志。
- 查看迁移日志：

  ```powershell
  ssh libiao@10.1.104.45 "sudo docker logs --tail 80 inpulse-deploy-migrate-1"
  ```

- 历史迁移不可修改。回滚 `.env.deploy` 只能回滚镜像版本，**不能**回滚数据库结构；
  含破坏性迁移的版本要按迁移自身的兼容窗口处理。

## 回滚

脚本每次更新前都会把 `.env.deploy` 备份成 `.env.deploy.bak-<时间戳>`，旧镜像 Tag
也仍留在本地 registry 中：

```powershell
ssh libiao@10.1.104.45
cd /home/libiao/inpulse-deploy
ls -t .env.deploy.bak-*
sudo cp -p .env.deploy.bak-<时间戳> .env.deploy
sudo docker compose --env-file .env.deploy -f compose.yaml up -d
```

## 更新后验证

```powershell
curl.exe -k https://test-inpulse.libiaorobot.com/health/ready
curl.exe -k -o NUL -w "%{http_code}" "https://test-inpulse.libiaorobot.com/api/v1/search?q=hello"
curl.exe -k -I https://test-inpulse.libiaorobot.com/api/v1/auth/sso/start
```

期望依次是 200、401（匿名访问受保护接口）、302 跳转到 Casdoor 测试环境；
这三条已于 2026-10-15 实测通过。注意 `/api/v1/search` 不带 `q` 时会先返回 422
（查询参数校验先于鉴权），验证时必须带上 `q`。

## 磁盘与清理

- VM 根分区 40G；每次更新会在 registry 里新增一个 Tag，旧 Tag 保留用于回滚。
- 脚本默认删除两端 tar 并执行 `docker image prune -f`。
- 确认不再需要回滚后，可手工清理旧镜像：

  ```powershell
  ssh libiao@10.1.104.45 "sudo docker images 'inpulse/*' --format '{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedSince}}'"
  ssh libiao@10.1.104.45 "sudo docker rmi <镜像 ID>"
  ```

  registry 内的旧 Tag 需要按 digest 调 `DELETE /v2/<name>/manifests/<digest>`，再跑
  `registry garbage-collect`；测试环境一般在磁盘吃紧时再处理。

## 常见问题

- 构建时 OOM（Out Of Memory，进程因内存不足被系统杀掉）：关掉占内存的程序，或用
  `-Targets` 只构建需要的镜像；Docker Desktop 的内存上限在 Settings → Resources 调整。
- 反复提示 `libiao@10.1.104.45's password`：说明没有可用的免密密钥（旧密钥可能带
  passphrase）。执行一次 `-SetupKey` 生成 `~/.ssh/inpulse_deploy_ed25519` 即可；
  脚本会按 `inpulse_deploy_ed25519` → `inpulse_test_deploy` → `id_ed25519` 的顺序
  自动挑选第一把真正能免密登录的密钥。
- migrate 退出 1、日志报 `Applied migration "00xx_....sql" was modified`：几乎都是
  **行尾漂移**，不是迁移被改动。`database/src/migrations.ts` 按文件原始字节算 sha256，
  工作区里 CRLF 的迁移文件会让校验和对不上数据库账本，于是 `compose up` 时 migrate
  失败、api/web 不启动、站点直接不可用。脚本在构建 migrate 前会用
  `git ls-files --eol` 预检并列出问题文件，加 `-FixEol` 可按字节转回 LF
  （只改行尾、不改内容，git 也不会产生变更）。已经炸了就按「回滚」一节还原
  `.env.deploy`。2026-10-15 曾因 13 个迁移文件漂移成 CRLF 触发过一次。
- 根因是仓库 `.gitattributes` 规定 `* text=auto eol=lf`，但本机
  `core.autocrlf=true`（来自 `D:/Git/etc/gitconfig`）会在工作区留下 CRLF。
  自查：`git ls-files --eol | Where-Object { $_ -notmatch '\sw/lf\s' }`。
- 构建卡在 `pnpm install`、日志刷 `registry.npmjs.org ... ETIMEDOUT`：公司网络到
  npmjs 不稳定。依赖层缓存命中时不需要联网；一旦 `pnpm-lock.yaml` 或任何
  `package.json` 变了就会重新解析，pnpm 会重试几分钟（实测最终能成，但很慢）。
  `registry.npmmirror.com` 本机可直连，必要时临时在 `.npmrc` 加 `registry=`，
  用完还原、不要提交。
- 基础镜像 digest 校验失败：镜像源上的 tag 可能指向与 Dockerfile 固定值不同的
  manifest（`docker.1ms.run` 的 `postgres:18.6` 就与固定的 `4ef4dbc9…` 不一致），
  所以脚本按 `名字@digest` 拉取而不是按 tag 拉。
- api 起不来、日志报模块找不到：确认 `deploy/docker/api.Dockerfile` 里包含
  `packages/canonical-json` 的 COPY 与 build，漏掉会让镜像内缺少 dist。
- 数据库角色密码不生效：`database/bootstrap/010_passwords.sql` 读 secret 文件时必须
  用 `btrim(..., E' \r\n\t')`，否则文件尾换行会进入密码。
- SSO 回跳 `/login?sso_error=internal`：多为 api 出不了网（检查 api 是否挂在 `egress`
  网络），或 `SSO_ISSUER` 与 discovery 返回的 issuer 不一致。可在容器内直接验证：
  `sudo docker exec inpulse-deploy-api-1 node -e "fetch(process.env.SSO_ISSUER + '/.well-known/openid-configuration').then(r => console.log(r.status))"`。
- 浏览器证书警告：证书由公司 ALLinSSL 统一下发并自动续签（`*.libiaorobot.com`，
  2026-10-15 首次下发生效），正常情况无需任何导入。排查顺序：① 确认访问的是
  域名 `https://test-inpulse.libiaorobot.com/` 而不是 IP（证书不含 IP，用
  `https://10.1.104.45/` 必然告警）；② 换**无痕窗口**重开：正常则问题在那台电脑的
  浏览器扩展（注入 http 资源会被拦成「连接不安全」，而证书仍显示有效；2026-10-15
  已实测同事案例为无痕正常、扩展导致），逐个禁用扩展排查；③ 以上排除后确认
  ALLinSSL 工作流「部署成功」且 `openssl s_client -connect
  test-inpulse.libiaorobot.com:443 -servername test-inpulse.libiaorobot.com`
  主体为 `*.libiaorobot.com`。
- 首个管理员：空库时首个 SSO 登录账号自动成为系统管理员（[ADR-075](../../docs/adr/ADR-075.md)，
  2026-10-15 起）；库非空时 JIT 开通仍为 `is_admin=false`、无项目成员关系，需要人工
  在数据库里提升。管理员权限定义见 `docs/permissions.md`。

## 安全约束

- 不要把 VM 密码、Casdoor client secret、数据库口令写进仓库文件，
  `pnpm check:secrets` 会拦截。Secret 只保存在 VM 的
  `/home/libiao/inpulse-deploy/secrets/`（权限 600、属主为对应容器内 uid）。
- 更新只操作 `/home/libiao` 下的目录与自建 Docker 对象，不改 VM 的系统配置、
  防火墙或其他用户。
