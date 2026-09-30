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
| [ADR-033](ADR-033.md) | Accepted | 项目内角色（组长与项目管理员），扩展 ADR-012；项目管理员与授权口径经 ADR-039 修订 |
| [ADR-034](ADR-034.md) | Accepted | 任务与功能归档及父级归档前置校验；角色口径经 ADR-039 修订，**项目归档申请—审核部分由 [ADR-043](ADR-043.md) 替代，模块归档部分由 [ADR-044](ADR-044.md) 替代，功能归档部分由 [ADR-045](ADR-045.md) 替代，任务归档部分由 [ADR-054](ADR-054.md) 替代** |
| [ADR-035](ADR-035.md) | Accepted | 项目生命周期、粘性标记与项目写入口口径；角色口径经 ADR-039 修订，**状态口径由 [ADR-043](ADR-043.md) 修订为三态** |
| [ADR-036](ADR-036.md) | Accepted | 登录页默认展示本地口令表单，统一身份认证改为并列入口 |
| [ADR-037](ADR-037.md) | Proposed | 任务列表排序口径统一（紧急度优先 + 状态分组）与多列 keyset 游标 |
| [ADR-038](ADR-038.md) | Accepted | 本地会话空闲有效期由 30 分钟调整为 2 小时 |
| [ADR-039](ADR-039.md) | Accepted | 移除项目管理员角色，项目内管理权限下放给全体活跃成员（修订 ADR-033/034/035） |
| [ADR-040](ADR-040.md) | Accepted | 任务支持平权多负责人（关联表取代单一负责人列） |
| [ADR-041](ADR-041.md) | Accepted | 删除任务优先级的「低」（LOW）档位（修订 ADR-037 的排序键与游标版本） |
| [ADR-042](ADR-042.md) | Accepted | 原始审计读取留痕按「查看」计数（进入与切换对象各一条） |
| [ADR-043](ADR-043.md) | Accepted | 项目层面下线归档，生命周期收窄为未开始 / 进行中 / 维护中三态（替代 ADR-034 项目归档部分、修订 ADR-035） |
| [ADR-044](ADR-044.md) | Accepted | 模块层面下线归档，模块只有 ACTIVE（替代 ADR-034 模块归档部分、修订 ADR-033/ADR-039 的模块归档授权口径；功能档位表述经 ADR-045 修订，模块列表排序键经 ADR-046 修订） |
| [ADR-045](ADR-045.md) | Accepted | 功能层面下线归档，功能只有 ACTIVE（替代 ADR-034 功能归档部分、修订 ADR-039 的项目内管理操作清单与 ADR-044 的功能档位表述） |
| [ADR-046](ADR-046.md) | Accepted | 三层列表排序统一为「档位优先 + 创建时间从近到远」（修订 ADR-044 的模块列表排序表述） |
| [ADR-047](ADR-047.md) | Accepted | 迭代记录发布与任务完成解耦（修订功能设计 F-18 / F-19 与技术设计 §6.3 的发布门禁） |
| [ADR-048](ADR-048.md) | Accepted | 迭代记录草稿支持物理删除（`SECURITY DEFINER` 函数 + `record.draft.delete` 审计；明确 ADR-024 `DRAFT` 一档的删除语义） |
| [ADR-049](ADR-049.md) | Accepted | 项目删除为软删除（保留全部历史、退出可见范 围），只有系统管理员与本项目组长可删除（在 ADR-039 的权限下放上新增例外）；**第 3 节的可见性绝对表述由 [ADR-050](ADR-050.md) 修订，第 8 节「不提供彻底删除与恢复」由 [ADR-051](ADR-051.md) 修订** |
| [ADR-050](ADR-050.md) | Accepted | 项目删除记录对全部登录用户可见：作为动态流 内的普通一行（服务端只放行 `PROJECT_DELETED` 行）并在审计页补齐已删除项目的审计 链入口，记录删除人（修订 ADR-049 第 3 节的可见性表述；非目标第 1 条由 [ADR-051](ADR-051.md) 修订，**第 5 节的服务端 收窄由 [ADR-052](ADR-052.md) 修订**） |
| [ADR-051](ADR-051.md) | Accepted | 项目还原与彻底删除：删除记录行同时提供「还 原项目」（系统管理员或本项目组长，清空软删除标记）与「彻底删除」（仅系统管理员，经 `app.purge_project` 窄口物理删除全部下级数据与该项目审计链，只留 SYSTEM 链一 条 `project.purge`）（修订 ADR-049 第 8 节与 ADR-050 非目标第 1 条） |
| [ADR-052](ADR-052.md) | Accepted | 已删除项目的完整动态过程与删除操作唯一入口：已删除项目下发整个项目链的 `MEMBER` 可见动态（不含 `ADMIN_ONLY`），同一项目多次删除只让最新一条保留还原与彻底删除，项目筛选下拉新增「已删除项目」（修订 ADR-050 第 5 节的服务端收窄） |
| [ADR-053](ADR-053.md) | Accepted | 项目组长唯一性与转移：有活跃成员则恰好一名组长，组长只能转移不能撤销/移除，组长本人可转交身份（修订 ADR-033/ADR-039 的组长授权口径） |
| [ADR-054](ADR-054.md) | Accepted | 任务层面下线归档，任务生命周期只剩 ACTIVE / INVALID（替代 ADR-034 任务归档部分、修订 ADR-043「维护中」门禁的实现口径） |
| [ADR-055](ADR-055.md) | Accepted | 项目保留期到期自动彻底删除：软删除满 30 天（按最后一次删除计时）由服务端后台经 `app.purge_project` 物理删除并在 SYSTEM 链留 `project.purge`（`trigger = AUTO_RETENTION`）（扩展 ADR-051 的触发路径） |

## 关联基线

- [功能设计 V1.1](../../功能设计v1.1.md)
- [技术设计 V1.2.2](../../技术设计v1.2.2.md)
- [系统设计 V1.0.2](../../系统设计文档v1.0.2.md)
- [权限矩阵](../permissions.md)
- [测试矩阵](../test-matrix.md)
