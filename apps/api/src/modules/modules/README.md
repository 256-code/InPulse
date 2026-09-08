# Modules 项目初始化 CommandPort

本模块只提供项目初始化中的未分类模块写入，不代表项目创建闭环或模块管理已完成。

当前验证状态：2026-09-08，提交 `e826483` 的
[CI / workspace](https://github.com/256-code/InPulse/actions/runs/34200874889)
通过；PostgreSQL 18.6 + PGroonga 隔离库的
[数据库测试日志](https://github.com/256-code/InPulse/actions/runs/34200874889/job/101979120660?pr=34#step:17:29)
确认 `modules-command.integration.test.ts` **5/5 实际通过，155 ms**，未使用 Mock。
CI 通过根级 `pnpm test:integration` 调用 API 的相同 Vitest 集成配置执行该文件。
本机依然没有数据库环境；下文保留本地失败历史。PR [#34](https://github.com/256-code/InPulse/pull/34)
等待人工评审，不自动合并。

依据：[ADR-013](../../../../../docs/adr/ADR-013.md)、
[数据库事务契约](../../../../../database/README.md#功能开发必须遵守的事务契约)。

公开入口为 `apps/api/src/modules/modules/index.ts`。WorkflowModule 在 Nest
`imports` 中加入 `ModulesModule`，Workflow 用 `@Inject(ModulesCommandPort)`
注入同名抽象类 token。Repository 和 Service 不从公开入口导出，根 AppModule 未接入。

```typescript
createUnclassifiedModule(
  tx: TransactionContext,
  input: CreateUnclassifiedModuleInput,
): Promise<CreateUnclassifiedModuleResult>;
// input: { projectId: number; createdBy: number }
// result: { moduleId: number }
```

ID 类型取自现有 modules Schema；`createdBy` 由受信任 Workflow 传入。
名称固定为“未分类模块”，身份固定为 `UNCLASSIFIED`；数据库默认值提供
空描述、ACTIVE、排序 0、版本 1、空归档时间以及 `now()` 创建/更新时间。
已有 fixture 中的“未分类”并非名称约束，技术设计以不可变 kind 判定身份。

以下是位于 `apps/api/src/workflows/` 的**接入示意**，其中项目创建、成员写入和后续步骤
仍由 A 实现；不是已交付 Workflow：

```typescript
import { ModulesCommandPort, ModulesModule } from "../modules/modules/index.js";

// Nest: @Module({ imports: [ModulesModule], ... })
// Workflow constructor: @Inject(ModulesCommandPort) private readonly modules: ModulesCommandPort
await this.unitOfWork.run(async (tx) => {
  // A 在此使用同一 tx 创建项目、创建者及初始成员，得到 projectId、creatorId。
  const { moduleId } = await this.modules.createUnclassifiedModule(tx, {
    projectId,
    createdBy: creatorId,
  });
  // A 继续以同一 tx 写审计、通知与投影；任一步失败必须向外抛出。
  return { moduleId };
});
```

事务所有权只在调用方。Port 和 Repository 只使用传入的 `tx.sql`，不创建
UnitOfWork、不提交、不使用全局客户端。项目与创建者成员历史必须同事务写入并
保留数据库 `now()` 默认值，确保延迟初始化约束通过。授权、初始成员有效性、
项目可写性和外层幂等仍由 Workflow 负责；此 Port 不作为普通模块创建入口。

重复创建不视为幂等成功。PostgreSQL `23505` 且约束为
`modules_one_unclassified_unique` 或 `modules_name_project_unique` 时，抛出公开的
`UnclassifiedModuleConflictError`（`status=409`、`code=UNCLASSIFIED_MODULE_CONFLICT`、
固定安全消息）。其他错误原样向 Workflow 传播；不存在项目由
`modules_project_fk` 拒绝（`23503`）。不得捕获后继续提交，必须使外层 UoW 回滚。
HTTP 错误信封、requestId、外键错误映射和未知异常脱敏由 A 的外层处理，
不得直接向用户返回数据库异常文本。本次没有 HTTP 路由或认证链路改动。

复用现有 PostgreSQL 测试基座，仅在已 bootstrap、已迁移全部历史的隔离测试库执行：

```powershell
pnpm --filter @inpulse/api exec vitest run --config vitest.integration.config.ts test/modules-command.integration.test.ts
pnpm --filter @inpulse/api exec vitest run test/modules-module.test.ts
```

数据库测试用 `app_runtime` 写入并在事务结束后独立查询，覆盖成功、后续失败回滚、
同事务重复回滚、已提交项目重复拒绝和不存在项目。fixture 使用随机编码，
不禁用触发器、不删除业务历史；成功 fixture 随隔离测试实例整体销毁。
2026-09-08 本地 Nest 注入测试 1/1 通过；数据库套件因缺少
`TEST_DATABASE_URL` 在 beforeAll 失败，5 个行为断言均未执行，仍需在具备
PostgreSQL 18 + PGroonga 的隔离实例或 CI 验证。

2026-09-08 14:29 +08:00 按上述数据库命令再次执行，退出码 1：
beforeAll 仍因缺少 `TEST_DATABASE_URL` 失败，5 例均未实际执行，状态保持**待验证**。
环境复查：`POSTGRES_BIN` 未配置；PATH 未找到 docker、podman、psql、postgres，
默认 PostgreSQL/Docker 安装位置未发现工具；`wsl --list --quiet` 返回 1，提示 WSL 未安装。
未连接未知数据库、未用 Mock 或 Nest 注入测试替代数据库验证。
