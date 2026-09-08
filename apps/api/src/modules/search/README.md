# SearchProjectionWritePort

`SearchProjectionWritePort` 是业务命令维护 `search_projection` 的公开写边界。
调用方负责鉴权、事务边界和字段脱敏；Port 只负责输入校验、文本规范化与
PostgreSQL upsert。

```typescript
await this.unitOfWork.run(async (tx) => {
  await this.searchProjection.upsert(tx, {
    projectId,
    entityType: "CHANGE_RECORD",
    entityId,
    title,
    summary,
    rawText,
    visibilityScope: "ADMIN_ONLY",
    sourceStatus: "VOID",
    sourceRowVersion,
  });
});
```

约束：

- 不接受全局 Drizzle Client，必须使用调用方传入的 `TransactionContext`；
- 调用方必须先完成鉴权并保证 `entityId` 属于 `projectId`；Port 不校验资源归属；
- `normalized_search_text` 由 `rawText` 经 `normalizeSearchText` 派生；
- `(project_id, entity_type, entity_id)` 唯一，重复 update 不产生新行；
- 已持久化的 `source_row_version` 不低于 `EXCLUDED` 时才允许覆盖，防止旧写回退；
- 数据库 CHECK、FK 和唯一约束仍是最终防线。

由 `SearchProjectionModule` 导出 `SearchProjectionWritePort`，业务 Workflow
只需导入该模块，不依赖搜索查询 Controller、Session 或项目查询适配器。

验证：

```shell
pnpm --filter @inpulse/api exec vitest run test/search-projection.module.test.ts
pnpm --filter @inpulse/api exec vitest run --config vitest.integration.config.ts test/search-projection-write.integration.test.ts
```
