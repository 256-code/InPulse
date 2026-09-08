# Workflow 父级写前检查

公开入口 `apps/api/src/workflows/index.ts` 导出
`ProjectWriteAccessWorkflow`、`WorkflowModule` 与相关输入/结果类型。
当前不挂入 `AppModule`，等待首个业务 Workflow 或 Controller 接入后按
`AppModule` 的鉴权装配条件启用。

`ProjectWriteAccessWorkflow` 不开启事务，只接收调用方已经持有的
`TransactionContext`，并按以下顺序检查：

1. `SessionAuthService.resolveActorInTransaction` 解析当前 actor；
2. `ProjectAccessQueryPort.checkProjectForWrite` 锁定并检查项目；
3. `ModuleQueryPort.checkModuleForWrite` 锁定并检查模块；
4. `FeatureQueryPort.checkFeatureForWrite`（仅功能路径）锁定并检查功能。

任一步返回失败后立即停止，不调用后续 Port。失败结果使用类型化
`kind`，由 HTTP 层再映射为 401 / 404 / 409，不在此处抛 Nest HTTP 异常。

```typescript
await this.unitOfWork.run(async (tx) => {
  const access = await this.writeAccess.checkFeatureForWrite(tx, {
    cookieHeader,
    projectId,
    moduleId,
    featureId,
  });
  if (access.kind !== "allowed") {
    throw this.mapWriteAccessError(access.kind);
  }
  // 继续使用 access.actor / access.project / access.module / access.feature。
});
```

验证：`pnpm --filter @inpulse/api exec vitest run test/project-write-access.workflow.test.ts`，
覆盖成功路径与 session、project、module、feature 四层任一失败时的短路行为。
真实数据库行锁语义由 B 的 `write-query-ports.integration.test.ts` 与 A 的
`project-access.integration.test.ts` 分别覆盖；本 Workflow 层只验证编排顺序与结果映射。
