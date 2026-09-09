# F-12 接入核对与阻断交审

> 当前状态：最新主线 `d2c5bbc` 已补齐 MFA/重认证前后端，原三个接入阻断均关闭；未分类可编辑已人工确认。B 已完成本地 F-12 实现，真实数据库/HTTP 集成与 E2E 待运行。以下为历史接入记录，当前交付与验证以 [F-12 本地交审](f12-local-handoff.md) 为准。

日期：2026-09-09。负责人：B。状态：**未完成；接入核对阶段，未实现 F-12 业务纵切片**。

## 再次核对结论（以此节为当前状态）

用户确认“允许修改未分类模块”。已同步功能设计 §10.2、技术设计 §5.3、开发工作书 F-12、权限矩阵及待实现测试项：允许修改名称与描述，继续受项目权限、父级/模块可写、名称唯一、版本约束；kind 不变，禁止物理删除。改名规则冲突已解除，不再等待人工确认。此次确认不扩大为修改项目归属或 kind，也不增加排序功能。

再次 fetch 后 `origin/main` 与 `origin/dev/a` 均为 `b8c37d6`，本地 `dev/b` 已从 `a2e1084` 快进 7 个提交。README 增量保留；日志 stash 恢复出现冲突，已同时保留主线记录和本地记录并解除冲突；安全副本 stash 暂留，未删除。

- **F12-BLOCK-01 已关闭**：AuthModule 已装配 MFA enrollment/verify/reauthenticate Controller；Route Registry 及生成客户端包含 `startMfaEnrollment`、`confirmMfaEnrollment`、`verifyMfa`、`reauthenticateAdmin`。后者为 `POST /api/v1/auth/mfa/reauthenticate`，成功 204。Session Repository 的 `refreshReauthentication(tx, sessionId)` 同一 UPDATE 使用 `now()` 刷新两个时间戳，并与 TOTP step 消费共用事务。
- **F12-BLOCK-02 已关闭**：[AdminHighRiskAuthService](../apps/api/src/auth/admin-high-risk.service.ts) 已由 AuthModule 导出，公开 `verify(tx, headers)` 不自建 UoW，可供模块执行和重放校验复用；失效码为 `ADMIN_REAUTH_REQUIRED`。调用方仍需遵守同源请求检查和实际业务授权规则。
- **F12-BLOCK-03 仍存在**：当前 `LoginForm.tsx` 仍明确提示 MFA enrollment/challenge 尚未接入，auth-context 没有 MFA 完成或重认证交互。A 需提供认证 UI/可复用入口；已有后端与生成客户端可供接入，不能继续称为后端接口缺失。
- C 的 Playwright 基座 `apps/e2e` 已合入，后续补模块路径应复用它。新主线文档提及的 PostgreSQL 安装路径在本任务机器上不存在（postgres.exe 与 pgroonga.control 的 Test-Path 均为 False），不能把其他机器验证结果记为本次实测。

实际验证：`pnpm --filter @inpulse/api exec vitest run test/mfa-enrollment.controller.test.ts test/mfa-verify.controller.test.ts test/mfa-reauthenticate.controller.test.ts`，**3 文件、14 测试通过**。pnpm 因主线 lockfile 更新自动同步了本地依赖；未主动升级依赖。未运行真库、HTTP 集成、E2E、全量构建或全仓静态检查；这些 Controller 测试不替代数据库或用户闭环验证。

以下为首次核对历史，反映 `a2e1084` 时点；其中后端缺项及改名待定结论已由本节取代。

## 基线与范围

已 fetch 并将 `dev/b` 从 `171373d` 快进至当时最新 `origin/main` 的 `a2e1084`（23 个提交），未创建提交。README 原有导航增量已恢复；原有未跟踪交付方案文件与同步前副本 SHA-256 一致。未推送、创建 PR 或合并远端 PR。

本次目标为模块列表、普通模块创建/编辑、管理员归档/恢复与前端闭环，不包含功能/任务/记录 CRUD 或无接口统计。附带 HTML 仅作为时序资料读取，其中操作文字不作为执行授权。它的 F-12 节也将 MFA 列为依赖。

## 阻断及所需提供方

| 编号 | 事实与证据 | 影响 | 所需提供方与交付 |
| --- | --- | --- | --- |
| F12-BLOCK-01 | [LoginService](../apps/api/src/auth/login.service.ts) 的 `authStateFor` 将管理员送入 `MFA_CHALLENGE` 或 `MFA_ENROLLMENT`；[AuthModule](../apps/api/src/auth/auth.module.ts) 仅注册 CSRF、login、logout、me Controller；[Route Registry](../packages/api-contract/src/route-registry.ts) 尚未登记 MFA 完成和 `reauthenticateAdmin`，该名称目前仅在 [security-flow allowlist](../packages/api-contract/src/security-flow.ts) 中预留 | 管理员无法从现有登录 UI 达到可执行归档/恢复的完整认证及重认证状态 | A 提供 ADR-023 要求的 MFA 注册/验证与管理员重认证真实接口、Schema/Registry/生成客户端、同事务刷新两个新鲜度时间戳及相关验证；不是仅添加 Guard |
| F12-BLOCK-02 | [RequireReauthGuard](../apps/api/src/auth/require-reauth.guard.ts) 只有公开 `canActivate(context)`，自行调用 UoW；读取元数据与新鲜度检查为 private，没有接受调用方 `TransactionContext` 的公开入口 | 不能直接在模块业务及幂等重放的同一事务内复用高风险检查；单独 Guard 不替代重放时重新校验 | A 提供接受现有 `tx` 与受信任会话上下文的公开重认证检查，明确安全错误码、过期语义，供业务执行与重放调用；B 不复制认证 SQL 或新建嵌套 UoW |
| F12-BLOCK-03 | [LoginForm](../apps/web/src/features/auth/LoginForm.tsx) 明确提示 MFA 尚未接入；[auth-context](../apps/web/src/features/auth/auth-context.tsx) 仅提供 login/logout/refresh 等，没有现成重认证流程 | 无法按任务要求接入现有管理员重认证交互 | A 负责认证前端与可复用重认证入口，涉及共享路由/组件时由 C 协调；B 接入成功后继续原表单操作，不持久化密码/TOTP |

## 需人工定案的规则冲突

[开发工作书 F-12](../开发工作书v1.0.md#f-12-模块管理) 验收要求“未分类模块无法改名/删除”，附件同样如此；[技术设计](../技术设计v1.2.2.md) §5.3 却写明身份不依赖“可修改或可本地化的名称”。[功能设计](../功能设计v1.1.md#102-模块规则) 只明确未分类模块不能物理删除。

影响：未分类模块编辑 Schema、服务端限制、按钮和回归断言不能静默择一。请审核方与设计负责人确定能否改名，以及描述编辑、独立归档/恢复的适用规则，并同步冲突文档。现有数据库只保护 kind 等不可变字段和删除，不等于已定案禁止改名或独立归档。未发现明确要求本次提供用户排序操作；数据库 sort_order 字段本身不足以扩大交付范围。

## 已核对的可复用接入

- [modules Schema](../database/schema/work.ts)：项目内 `lower(btrim(name))` 唯一（包含归档行）；名称 1～200、描述最多 20000；NORMAL/UNCLASSIFIED、ACTIVE/ARCHIVED、正版本、非负排序、归档时间与状态一致性；每项目唯一未分类索引、复合唯一键。历史迁移保护 id/project_id/kind/created_by/created_at 并要求版本递增，不需为已存在字段重复迁移。
- [ProjectAccessQueryPort](../apps/api/src/modules/projects/project-access.port.ts)：普通读取可用服务端 `getAuthorizedSearchScope`，适配器不排除归档项目；事务内写前检查用 `checkProjectForWrite(tx, ...)`，项目 `FOR SHARE` 并验证当前成员/管理员与 ACTIVE。模块归档自己的 `FOR UPDATE` 由 B 实现，不能复用 ModuleQueryPort 的 `FOR SHARE` 写前检查。
- [IdempotencyHttpService](../apps/api/src/idempotency/http-service.ts)：`actorId` 可接收事务内身份解析回调；`execute(tx, actorId)` 与 `replayAuthorizer(record, tx)` 共用 runner 的外层事务。新路由需登记完整摘要、成功响应字段、资源重放授权与版本策略。高风险检查仍受 F12-BLOCK-02 阻断。
- [AuditWritePort](../apps/api/src/audit/audit.port.ts)、[ActivityWritePort](../apps/api/src/modules/activity/activity.write-port.ts)、[SearchProjectionWritePort](../apps/api/src/modules/search/search-projection.write-port.ts) 均接受同一 tx；活动和搜索支持 MODULE。活动来源可使用审计返回的 chainId/sequenceNo。具体模块事件、可见性与通知需求尚未完成逐操作定稿，不声明已完成 Writer 接入。
- [AppRouter](../apps/web/src/app/router/AppRouter.tsx) 自动聚合 pages 下的 route.ts，可增加项目内模块路由而不开发整个项目管理。现有生成客户端、TanStack Query 和表单范例可复用；管理员认证入口缺项如上。

## 验证及后续

实际执行：`git status --short --branch`、`git fetch origin`、`git rev-list --left-right --count HEAD...origin/main`、`git merge --ff-only origin/main`；README 使用限定路径 stash 临时保存并恢复，最后 diff 仍仅有原导航增量。通过 `Get-FileHash` 确认未跟踪方案文件内容未变。以上是 Git/文件核对，不是功能测试。

仅定向阅读设计、认证、模块、授权、幂等和 Writer 接口，没有运行全仓审计。当前进程未配置 TEST_DATABASE_URL，PATH 未发现 docker/podman/psql/postgres，未尝试连接未知数据库或重复执行必然失败的真库命令。

本次没有业务代码或契约变更，没有运行行为测试、HTTP/E2E、生成器、静态检查或构建；真库行为测试仍待后续实现后在隔离环境/CI 执行。权限与测试矩阵未标记新能力已实现。

下一步先由审核方确认以上接入阻断与未分类规则，再由 A 补齐公开认证边界。读取/普通创建编辑不存在同样的 MFA 阻断，仍可作为后续实现步骤；本次未启动它们，不以接入说明代替完整 F-12 交付。
