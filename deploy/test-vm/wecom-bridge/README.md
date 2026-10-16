# 测试 VM 企业微信桥接（本地唯一源）

本目录是测试 VM `inpulse-wecom-bridge` 容器脚本的**本地唯一源**：先改这里，再用
`deploy/test-vm/update-bridge.ps1` 同步到 VM。它属于测试环境 PoC，**不是生产实现**：
不进 `deploy/compose.yaml`、不进 `apps/`、不参与生产镜像与 CI 门禁。

## 目录

- `app/`：桥接脚本。`runner.mjs` 拉起两个子进程——`long-conn.mjs`（企业微信长连接：绑定码兑换、
  主动推送）与 `bridge.mjs`（轮询 `app.notifications` 推送个人通知）。
- `Dockerfile`：`FROM` 本地 registry 的 api 镜像（复用其 node 24）；`COPY app /opt/wecom-bridge`。
- `bridge.env`、`app/bridge-config.json`、`app/config.json`、`test-bridge-config.json`：运行配置
  （不含任何 Secret；密钥与密码由 VM 上只读挂载）。
- `node_modules` 不入库：VM 侧 `app/node_modules` 是上一次安装的结果；仅当 `package.json`
  变化时，同步脚本会在 VM 上用既有桥接镜像执行 `npm install --omit=dev` 刷新。

## 同步到 VM

```powershell
$env:INPULSE_VM_PASSWORD=''
powershell -NoProfile -ExecutionPolicy Bypass -File deploy/test-vm/update-bridge.ps1
```

脚本流程：上传 → 远端逐文件 `sha256sum -c` 校验 → 构建 `inpulse-wecom-bridge:0.1.0-<日期>-bridge<内容哈希>` →
推送本地 registry → 按原安全参数重建容器并等待「订阅成功」。`-SkipRestart` 只更新镜像、不动容器。

## 约束与回滚

- 同一机器人只允许一条长连接：本地跑 PoC 前先停 VM 桥接（`sudo docker stop inpulse-wecom-bridge`）。
- 历史 bridge 镜像与 VM 上脚本 `*.bak-*` 留档可回滚；回滚 = 用旧 tag 重建容器（完整参数见 `update-bridge.ps1` 内 `docker run`）。
- 运行细节、排障与常用命令见 `deploy/test-vm/README.md`「企业微信机器人桥接」。
