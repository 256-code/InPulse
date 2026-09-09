# Browser E2E

Playwright E2E 纵切片由 F-31 建立，当前覆盖 API 健康探针、真实认证
（含 MFA 登录挑战与管理员重认证）、F-03 用户管理（普通成员 403、
管理员新增/编辑/停用/启用/强退与高风险重认证）、项目创建关键路径
（登录 → 创建项目 → 项目动态 → 搜索 → 站内通知）、全局搜索边界
（跨项目隔离、空态、签名游标分页与中文短词/特殊标识符）、项目动态专属路径、
F-13 功能档案、F-14 功能级任务创建/分配/编辑和站内通知已读/未读/全部已读联动等
可直接验证的路径。

## 前置条件

1. 已执行 `pnpm install --frozen-lockfile`。
2. 已准备 PostgreSQL 18 + PGroonga 实例，并完成 `000_roles.sql`、
   `020_pgroonga.sql` 与 `0000-0005` 迁移。
3. 已执行 `pnpm build`，使 `apps/api/dist/main.js` 可用。
4. 设置可写测试数据的 bootstrap URL，例如：

```powershell
$env:E2E_DATABASE_URL = "postgresql://cluster_bootstrap@127.0.0.1:55432/app"
```

5. 首次运行或机器未安装 Chromium 时，执行：

```powershell
pnpm --filter @inpulse/e2e exec playwright install chromium
```

可选端口通过 `E2E_API_PORT`、`E2E_WEB_PORT` 覆盖，默认分别为 3100 与 4173。

## 运行

```powershell
pnpm test:e2e
```

Playwright `webServer` 先启动已构建的 API（`node dist/main.js`，使用
`NODE_ENV=test`、`app_runtime` 数据库 URL 和临时 Session/幂等 keyring），再启动
Vite dev server，并把 `/api/v1` 代理到 API。`global-setup` 在服务就绪后创建唯一
E2E 用户、可见项目、无当前成员关系的隐藏项目与搜索投影并签发 Session；API 启动探针验证
`GET /api/v1/health`。失败时保留截图、trace 与 video。
需要管理员 MFA 的用例通过 `mfa-fixture` 为每个测试创建独立的临时管理员并完成
TOTP 注册；测试在登录和重认证前会把该测试用户的 `last_accepted_step` 重置为
`NULL`，避免时间步/验证码重放污染。该逻辑只作用于 E2E 夹具，不改变生产认证行为。

`global-teardown` 清理通知、活动、搜索投影、幂等记录、用户会话与 MFA 状态。
由于项目必须保留唯一未分类模块，且数据库触发器禁止物理删除该模块，E2E 项目和
用户骨架按业务不变量保留；本地通过唯一标识隔离，CI 使用一次性探针数据库，避免
跨运行状态污染。若要实现项目/用户物理自清，需要先另行设计测试专用数据库策略或
新增 ADR，不能在 E2E 中绕过数据库触发器。

## CI

GitHub Actions 的 `CI / workspace` job 在 `pnpm build` 之后、`pnpm check:deps`
之前安装 Chromium 并执行 `pnpm test:e2e`，此时 PostgreSQL 探针实例仍在运行。
无论成功或失败都会上传 Playwright HTML 报告、截图、trace 与 video 作为 CI
artifact。当前为 19 个用例，已覆盖 MFA 登录挑战/管理员重认证、F-03 用户
管理、项目创建关键路径、F-13 功能档案、F-14 功能级任务、搜索边界、
F-27 项目动态专属路径与 F-28 通知状态联动；F-03 分支在旧基线 `8386b29` 的
CI 已通过，同步 `origin/main` `273b273` 后完整 CI 待新运行验证；仍不等同于
完整业务关键路径。

## 范围说明

当前意图是建立可重复的浏览器自动化基座，不等同于完整业务关键路径。任务完成、
合并/解除合并等场景需要在对应业务模块交付后逐条加入。

## 新增业务场景

新增场景时复制 `templates/business-critical-path.template.ts` 到
`tests/<domain>.spec.ts`，再替换用例名称与断言。模板已经包含真实登录上下文、
唯一 fixture 复用、失败截图/trace 配置和上下文清理示例；不要把模板直接作为
已交付用例运行，也不得用 `test.skip` 或 `test.fixme` 掩盖未完成行为。写场景时
应使用生成客户端访问 API，并为写操作补齐 409/422 与幂等重放断言。
