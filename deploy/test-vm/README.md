# 测试 VM 更新手册

本目录的 `update.ps1` 用于把仓库当前代码更新到测试 VM。它面向单机 Docker
Compose + 本地 registry 的测试环境，不是生产发布流程：生产镜像 Tag/digest 绑定
与签名发布仍按技术设计第 12 章由人工完成，生产升级与回滚口径见
`docs/runbooks/upgrade-rollback.md`。

## 测试环境现状

| 项目         | 值                                                                                     |
| ------------ | -------------------------------------------------------------------------------------- |
| VM           | `10.1.104.45`（Ubuntu + Docker + Compose v2；SSH 账户 `libiao`，docker 命令需 sudo）      |
| 访问入口     | `https://test-inpulse.libiaorobot.com/`（DNS 指向同一台 VM，也可直接用 IP）                 |
| 部署目录     | `/home/libiao/inpulse-deploy`（`compose.yaml`、`.env.deploy`、`secrets/`）                 |
| 镜像目录     | `/home/libiao/inpulse-images`                                                             |
| 本地 registry | `127.0.0.1:5000`（容器 `inpulse-registry`，镜像 `registry:2`）                              |
| 运行服务     | `db`（PostgreSQL 18 + PGroonga）、`migrate`（一次性）、`api`、`web`（Nginx）                |
| 对外端口     | 22、80（308 跳转到 443）、443                                                              |
| SSO          | Casdoor 测试环境 `https://authtest.libiaorobot.com`                                          |
| TLS          | 自签证书（SAN 覆盖域名与 IP），文件为 `secrets/tls_cert.pem`、`secrets/tls_key.pem`          |
| 部署目录补充 | `backups/`（同步前的 pg_dump）、`compose.yaml.bak-*`、`.env.deploy.bak-*`（回滚用）          |
| 当前版本     | 5 个镜像统一为 `0.1.0-20261015-277fb89`，`BACKUP_GIT_SHA=277fb89`（2026-10-15 全量同步）      |

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
`deploy/compose.yaml`，仓库与 VM 的 compose 无需再手工合并；若未来再次分叉
（例如 VM 先行做了新适配），按本节流程比对合并。下列适配不能丢
（`tmpfs` 写法与 `DB_SSLMODE` 已进仓库工作区）：

- `api` 服务的 `networks: [backend, egress]` 与 `networks` 段的 `egress` 定义。
  `backend` 是 internal 网络、没有外网出口，api 靠 `egress` 访问 Casdoor 与 AI 端点；
  丢掉它 SSO 会回跳 `/login?sso_error=internal`。

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
- 浏览器证书警告：测试 VM 用自签证书，在自己电脑导入 `secrets/tls_cert.pem` 即可；
  要让所有人免警告，需要公司签发的 `test-inpulse.libiaorobot.com` 证书替换
  `secrets/tls_cert.pem` 与 `secrets/tls_key.pem`，再执行
  `sudo docker exec inpulse-deploy-web-1 nginx -s reload`。
- 首个管理员：SSO 首次登录按 JIT 建号（`is_admin=false`、无项目成员关系），
  需要人工在数据库里提升；管理员权限定义见 `docs/permissions.md`。

## 安全约束

- 不要把 VM 密码、Casdoor client secret、数据库口令写进仓库文件，
  `pnpm check:secrets` 会拦截。Secret 只保存在 VM 的
  `/home/libiao/inpulse-deploy/secrets/`（权限 600、属主为对应容器内 uid）。
- 更新只操作 `/home/libiao` 下的目录与自建 Docker 对象，不改 VM 的系统配置、
  防火墙或其他用户。
