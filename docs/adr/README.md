# 架构决策记录索引

本目录是 InPulse 架构决策的唯一权威来源。技术设计和系统设计只引用 ADR 编号与本索引，不再各自维护决策全文。

## 状态约定

- `Accepted`：当前基线，实施与评审必须遵守。
- `Proposed`：仍在评审，不得作为实现前提。
- `Superseded`：已被新 ADR 替代，保留历史但不得用于新实现。

修改已接受决策时必须新增 ADR，并在旧记录中标明替代关系；不得复用或重排编号。

## 决策索引

| ADR | 状态 | 决策 |
|---|---|---|
| [ADR-001](ADR-001.md) | Accepted | 采用模块化单体 |
| [ADR-002](ADR-002.md) | Accepted | 前端采用 React SPA |
| [ADR-003](ADR-003.md) | Superseded | NestJS 11.x 基线与 12.x 阶段 0 门禁，由 ADR-026 替代 |
| [ADR-004](ADR-004.md) | Accepted | Zod Schema Registry 与 Route Registry 共同生成契约 |
| [ADR-005](ADR-005.md) | Accepted | PostgreSQL 18、Drizzle 与显式迁移 |
| [ADR-006](ADR-006.md) | Accepted | PostgreSQL hash-only Session Store |
| [ADR-007](ADR-007.md) | Accepted | TaskGroupMember 是任务组归属唯一真相 |
| [ADR-008](ADR-008.md) | Accepted | 分 scope 串行审计哈希链与角色隔离 |
| [ADR-009](ADR-009.md) | Accepted | 本期不实现通用 Outbox |
| [ADR-010](ADR-010.md) | Superseded | pg_trgm 与搜索投影的双阶段门禁，由 ADR-025 替代 |
| [ADR-011](ADR-011.md) | Accepted | Argon2id 与服务端 Session 认证 |
| [ADR-012](ADR-012.md) | Superseded | 两类角色与创建者成员关系语义，由 ADR-033 扩展为项目内角色模型 |
| [ADR-013](ADR-013.md) | Accepted | WorkflowModule 与显式 UnitOfWork |
| [ADR-014](ADR-014.md) | Accepted | 使用脱敏 ActivityProjection |
| [ADR-015](ADR-015.md) | Accepted | 同步 CSRF Token 与有限重签 |
| [ADR-016](ADR-016.md) | Superseded | 系统管理员 TOTP MFA 与重认证，由 ADR-031 替代 |
| [ADR-017](ADR-017.md) | Accepted | 固定版本、补丁与镜像 digest |
| [ADR-018](ADR-018.md) | Accepted | PostgreSQL 数据卷与数据库角色分离 |
| [ADR-019](ADR-019.md) | Accepted | Route Registry、权限矩阵与写接口幂等默认值 |
| [ADR-020](ADR-020.md) | Accepted | 加密逻辑备份与全新主机恢复验证 |
| [ADR-021](ADR-021.md) | Accepted | 逐响应 nonce CSP |
| [ADR-022](ADR-022.md) | Accepted | ExternalLinks 类型化关联模型 |
| [ADR-023](ADR-023.md) | Accepted | 一次性认证安全流程的幂等例外（allowlist 经 ADR-031 收缩、ADR-032 调整为 `issueCsrfToken`、`login`、`logout`、`startSsoLogin`、`completeSsoLogin`） |
| [ADR-024](ADR-024.md) | Accepted | 迭代记录作废与可审计恢复状态机 |
| [ADR-025](ADR-025.md) | Accepted | V1 采用 PGroonga 实现中文与标识符搜索 |
| [ADR-026](ADR-026.md) | Accepted | NestJS 基线锁定 11.2.3 并延后 12.x 升级 |
| [ADR-027](ADR-027.md) | Accepted | 契约生成链路使用 Zod 4 JSON Schema 与仓库内生成器 |
| [ADR-028](ADR-028.md) | Accepted | apps/api 迁移至 ESM/NodeNext 以消费共享 ESM 包 |
| [ADR-029](ADR-029.md) | Accepted | Nest 运行期采用自研 Zod Pipe 与响应 Serializer |
| [ADR-030](ADR-030.md) | Accepted | 空项目、模块业务编号与任务就地创建归属 |
| [ADR-031](ADR-031.md) | Accepted | 移除 TOTP 两步验证与管理员高风险重认证 |
| [ADR-032](ADR-032.md) | Accepted | 接入立镖 Casdoor OIDC 单点登录（SSO）；前端默认入口经 ADR-036 修订、会话空闲时长经 ADR-038 修订 |
| [ADR-033](ADR-033.md) | Accepted | 项目内角色（组长与项目管理员），扩展 ADR-012 |
| [ADR-034](ADR-034.md) | Accepted | 项目归档申请—审核（双人同意）、任务与功能归档及父级归档前置校验 |
| [ADR-035](ADR-035.md) | Accepted | 项目生命周期四态（未开始 / 进行中 / 维护中 / 已归档）、粘性标记与项目写入口口径 |
| [ADR-036](ADR-036.md) | Accepted | 登录页默认展示本地口令表单，统一身份认证改为并列入口 |
| [ADR-037](ADR-037.md) | Proposed | 任务列表排序口径统一（紧急度优先 + 状态分组）与多列 keyset 游标 |
| [ADR-038](ADR-038.md) | Accepted | 本地会话空闲有效期由 30 分钟调整为 2 小时 |
## 关联基线

- [功能设计 V1.1](../../功能设计v1.1.md)
- [技术设计 V1.2.2](../../技术设计v1.2.2.md)
- [系统设计 V1.0.2](../../系统设计文档v1.0.2.md)
- [权限矩阵](../permissions.md)
- [测试矩阵](../test-matrix.md)
