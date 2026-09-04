# 测试矩阵

状态：已接受的验收基线。当前仓库处于设计阶段，尚无应用代码；`Required` 表示对应阶段必须实现并由 CI 执行，不代表测试已经通过。

## 文档与仓库治理

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| DOC-001 | CI | Git 文本、空白与冲突标记 | `node scripts/check_docs.mjs` 对 HEAD、暂存区、工作区及未忽略新文件无报错 | 已自动化 |
| DOC-002 | CI | Markdown 相对/引用式链接与本地锚点 | 不存在断链、未定义引用、危险 scheme、越界路径或缺失锚点 | 已自动化 |
| DOC-003 | Review | ADR 引用与编号 | 所有 ADR 编号唯一，设计只引用 `docs/adr` 权威记录 | Required |
| DOC-004 | Review | 规则与远程设置 | 文档只陈述已核验事实，目标配置明确标记为待管理员落实 | Required |

## 权限与成员关系

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| AUTHZ-001 | API 集成 | 每条 Route Registry 操作 | 至少一条允许与一条拒绝用例，身份覆盖与[权限矩阵](permissions.md)一致 | Required |
| AUTHZ-002 | PostgreSQL 集成 | 跨项目 IDOR | 其他项目成员和已移除成员均得到 404，SQL 不返回目标行 | Required |
| AUTHZ-003 | Workflow 集成 | 创建项目时取消创建者 | 请求被 Schema/业务规则拒绝；创建者必为初始成员 | Required |
| AUTHZ-004 | Workflow 集成 | 管理员移除项目创建者 | ACTIVE 成员记录关闭；`projects.created_by` 值不变；创建者立即失去项目权限 | Required |
| AUTHZ-005 | Workflow 集成 | 创建者重新加入 | 新增成员历史，不覆盖之前 `joined_at/removed_at` | Required |
| AUTHZ-006 | API 集成 | 停用用户旧 Session | 所有请求统一 401，其他用户不受影响 | Required |

## 幂等、版本与事务

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| IDEMP-001 | Registry CI | POST/PUT/PATCH/DELETE 默认策略 | 默认登记 `idempotencyRequired`；显式豁免同时登记原因并引用对应的 Accepted ADR | Required |
| IDEMP-002 | API 集成 | 相同 Key、相同请求重放 | 只执行一次，重放原状态码和脱敏响应 | Required |
| IDEMP-003 | API 集成 | 相同 Key、不同请求摘要 | 返回 409，不改变业务数据 | Required |
| IDEMP-004 | PostgreSQL 并发 | 两连接使用同一 Key | 只有一个业务事务成功执行；后继读取已提交结果 | Required |
| IDEMP-005 | PostgreSQL 并发 | 先行事务回滚 | 幂等占位随事务回滚，后继请求可重新执行 | Required |
| IDEMP-006 | API 集成 | 幂等重放前权限被移除 | 重新鉴权并拒绝，不泄露原响应 | Required |
| CONC-001 | PostgreSQL 并发 | 多聚合锁序 | 按任务、任务组、记录、遗留项 ID 升序；变化后有限次从头重试 | Required |
| CONC-002 | API 集成 | If-Match 版本冲突 | 返回 409；无部分更新 | Required |
| TX-001 | Workflow 集成 | 任一步骤失败 | 业务、审计、通知及投影全部回滚 | Required |

## 审计与安全

| ID | 层级 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| AUDIT-001 | PostgreSQL 并发 | 至少 100 个同 scope 并发业务事务 | 链无分叉、无序号缺口，每个成功业务事件恰有一条审计；见 [ADR-008](adr/ADR-008.md) | Required |
| AUDIT-002 | PostgreSQL 并发 | 多 scope 与链头初始化竞争 | 按 UTF-8 scope 顺序加锁，无死锁或重复链头 | Required |
| AUDIT-003 | PostgreSQL 集成 | 事务回滚 | 业务、审计行与链头同时回滚 | Required |
| AUDIT-004 | 恢复演练 | 密钥轮换、备份与恢复 | 数据库链、链头、远端检查点和归档明细全部一致 | Required |
| SEC-001 | 权限集成 | 数据库角色 | runtime 无 DDL/原始审计 SELECT；writer 不能改历史；reader 只读 | Required |
| SEC-002 | 浏览器 E2E | nonce CSP | 强制模式下核心页面可用，script/style 均无 `unsafe-inline` | Required |
| SEC-003 | API/浏览器 E2E | CSRF 生命周期 | 首登、轮换、刷新、多标签、过期和最多一次重签均符合 ADR-015 | Required |
| SEC-004 | API 集成 | ExternalLinks | 只接受 HTTPS；不发远程请求；跨项目关联失败；并发不重复 | Required |

## 搜索、部署与恢复

| ID | 阶段 | 场景 | 通过标准 | 状态 |
|---|---|---|---|---|
| SEARCH-001 | 阶段 0 | 中文可行性金标 | ≥1,000 投影、≥100 查询、Recall@20 ≥90%，目标查询使用 GIN trigram，跨项目 0 条 | Required |
| SEARCH-002 | 阶段 4 | 峰值容量 | ≥100,000 且 ≥五年峰值 1.2 倍；30 并发 10 分钟；预热 P95 <500ms/P99 <1s | Required |
| DEPLOY-001 | 阶段 0 | 空库迁移与角色 | 独立迁移任务成功，应用启动不迁移，runtime 无 DDL | Required |
| DEPLOY-002 | 上线前 | 可复现镜像 | 精确 Tag 与 digest、一致 lockfile、非 root 运行、健康检查通过 | Required |
| RECOVERY-001 | 上线前及演练 | 全新主机恢复 | 达到记录的 RPO/RTO；旧 Session 失效；审计链与检查点一致 | Required |

## 维护规则

- 新增 Route Registry 操作时，同一 PR 必须添加权限、幂等及错误契约用例。
- 修复竞态时必须保留能在真实 PostgreSQL 上复现旧缺陷的测试。
- 不得用 mock 数据库替代锁、唯一约束、迁移或事务测试。
- PR 中只报告实际执行过的测试；尚未具备运行条件的条目标记为 `Required`，不得写成通过。
