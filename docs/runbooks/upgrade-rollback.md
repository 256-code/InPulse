# 升级与回滚 Runbook

状态：**上线运维 Runbook**，对应[技术设计 §11.6](../../技术设计v1.2.2.md)。适用对象为
启用后的稳态拓扑：`deploy/compose.yaml` 中 API / Migration / Web 镜像的升级、切换与回滚。

## 1. 前置条件

- 发布清单：镜像 `exact-tag@sha256`、Git SHA、迁移版本、版本化 keyring 版本；
- `pnpm check:deploy --env <envfile>` 与 `pnpm db:migrations:check` 通过；
- 升级前备份已完成且**可解密读取**（见[备份与恢复 Runbook](./backup-restore.md)）；
- 变更窗口、回滚判定人、观察窗口已确认。

## 2. 升级顺序

```text
构建并测试镜像
  -> 备份并验证可读
  -> 运行向后兼容的 expand migration
  -> 启动新 API 并通过 readiness
  -> 切换流量 / 替换容器
  -> 部署新 Web
  -> 运行 smoke test
  -> 观察错误率和慢查询
```

对应命令与判据：

1. 镜像：CI 构建 + Trivy 扫描通过，digest 写入发布清单；
2. 备份：按[备份与恢复 Runbook](./backup-restore.md) §4 手工运行一次并确认异机副本可解密读取；
3. 迁移：`docker compose run --rm migrate`（一次性任务，`restart: no`）；失败即停止升级；
4. API：`docker compose up -d api`，`curl -fsS https://<host>/health/ready` 返回就绪，
   并确认 `X-Request-Id` 与统一错误体在异常路径上仍生效；
5. 切换：保持旧容器到 readiness 通过后再替换，禁止先停旧再起新；
6. Web：`docker compose up -d web`，确认入口 200/308、CSP 逐响应 nonce 与静态资源缓存头；
7. smoke test：登录、项目读取、写入回滚、搜索权限、审计读取；
8. 观察：错误率、慢查询与锁等待；建议观察窗口不少于 30 分钟。

## 3. 回滚

**代码回滚不等于数据库回滚。**

- 触发条件：readiness 持续失败、smoke test 失败，或错误率/慢查询超阈值且 30 分钟内未恢复。
- 操作：把 API / Web 镜像 ref 改回上一版 digest，`docker compose up -d api web`，重跑
  readiness 与 smoke test。
- 禁止：把已应用的 expand 迁移“回退”成删列/删表；确需回退数据形状时必须新增迁移并人工评审。
- 旧代码必须能在新 Schema 上运行：破坏性字段删除（contract）延后到确认旧代码不再使用之后。

## 4. 迁移失败处理

- 迁移由 migration 镜像以 `app_migrator` 执行，逐迁移事务：失败时该迁移回滚；
- API 进程不得在启动时自动生成 Schema；
- 失败后修脚本（不得重写已合并的历史迁移），再重新执行；必要时按 §3 回滚代码。

## 5. 记录

| 场景 | 记录内容 |
| --- | --- |
| 升级 | 发布清单引用、migrate 输出、readiness 与 smoke 结果、观察窗口数据 |
| 回滚 | 触发原因、时间、前后两个 digest、数据一致性检查结果 |
| 迁移失败 | 失败迁移编号、错误信息、修复提交、重新执行结果 |

## 6. 相关记录

- [技术设计 §11.6 升级与回滚](../../技术设计v1.2.2.md)
- [备份与恢复 Runbook](./backup-restore.md)
- [测试矩阵](../test-matrix.md)：`DEPLOY-002`、`DEPLOY-003`