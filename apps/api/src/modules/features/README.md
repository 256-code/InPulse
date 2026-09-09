# FeatureQueryPort 事务内写前检查

2026-09-09 F-13 增量：功能管理 HTTP 模块为独立 `FeaturesManagementModule`，与本文件原 `FeaturesModule` 写前检查公开模块分离。功能列表/详情、创建/编辑、管理员归档恢复、相似候选的接口及实际验证见 [F-13 本地交审说明](../../../../../docs/f13-local-handoff.md)。原写前检查接口不变，继续由 Tasks/ChangeRecords/Workflow 使用；归档后返回 `parent-not-active`，历史读取不调用此 Port。

公开入口 `apps/api/src/modules/features/index.ts` 导出 `FeatureQueryPort`、
`CheckFeatureForWriteInput`、`FeatureForWriteResource`、`FeatureWriteCheckResult` 和 `FeaturesModule`。
Nest imports 加入 `FeaturesModule`，通过 `@Inject(FeatureQueryPort)` 注入抽象类 token。
根 AppModule 不接入未使用模块。

```typescript
checkFeatureForWrite(
  tx: TransactionContext,
  input: { projectId: number; moduleId: number; featureId: number },
): Promise<FeatureWriteCheckResult>;
```

三种 kind 与 [ModuleQueryPort](../modules/README.md) 一致：allowed、not-found、parent-not-active。
allowed 与 parent-not-active 的 resource 仅含 featureId、moduleId、projectId、status 和 rowVersion；
status 为 ACTIVE 或 ARCHIVED，其余为 Schema integer 对应的 number。
不存在、项目或模块归属不匹配时只返回 not-found，归属正确但功能已归档时返回摘要。
SQL 只读取 app.features，包含完整归属条件并取得 FOR SHARE，再检查状态；
不自行查询项目或模块，不认证、不写入、不自行开启事务。

下面是 Workflow 接入示意，**不是本次实现的业务 Workflow**；需注入 A 的
SessionAuthService、ProjectAccessQueryPort，以及两个 B Port：

```typescript
import { ModuleQueryPort, ModulesModule } from '../modules/index.js';
import { FeatureQueryPort, FeaturesModule } from './index.js';

await this.unitOfWork.run(async (tx) => {
  const actor = await this.sessionAuth.resolveActorInTransaction(tx, cookieHeader);
  if (!actor) throw this.unauthenticated(); // 外层安全错误映射示意
  const project = await this.projectAccess.checkProjectForWrite(tx, {
    actorUserId: actor.userId, projectId,
  });
  if (project.kind !== 'allowed') throw this.writeRejected(project.kind);
  const module = await this.modules.checkModuleForWrite(tx, { projectId, moduleId });
  if (module.kind !== 'allowed') throw this.writeRejected(module.kind);
  const feature = await this.features.checkFeatureForWrite(tx, { projectId, moduleId, featureId });
  if (feature.kind !== 'allowed') throw this.writeRejected(feature.kind);
  // 同一 tx 内继续业务写入；回调结束后统一提交，抛错统一回滚。
});
```

示例相对导入按本目录解析；消费者应按自身位置导入两个域的 index.ts。
不能把输入归属或本 Port 的 allowed 当作项目授权。锁顺序为项目 → 模块 → 功能，
同层多资源 ID 升序；锁随 tx 提交/回滚释放。本接口不用于普通详情或归档操作。
数据库错误向调用方传播；安全的 HTTP 错误映射和完整业务流程留给外层。

验证：本地 Nest 注入通过，局部 TypeScript 检查通过；本机未配置 TEST_DATABASE_URL，
未发现 Docker/Podman/psql，本机未执行数据库测试。提交 `58acbe7` 的 PostgreSQL 18.6 + PGroonga
[CI 日志](https://github.com/256-code/InPulse/actions/runs/34210258609/job/102009300977?pr=42#step:17:28) 已确认 **6/6 实际通过，334 ms**；待 A/C 人工评审。
现有集成配置会自动发现以下测试，无需修改 CI：

```shell
pnpm --filter @inpulse/api exec vitest run --config vitest.integration.config.ts test/write-query-ports.integration.test.ts
```

6 个用例覆盖两域活跃/归档/缺失/归属不匹配，以及两域各自提交、回滚释放锁。
锁测试用 app_runtime 的两个独立连接，以 pg_blocking_pids 确认真实 UPDATE 被持锁连接阻塞，
事务结束后验证更新完成与版本递增。fixture 复用项目初始化 helper，满足创建者成员和未分类约束；
使用唯一测试数据，不删除历史、不禁用触发器、不使用 Mock。仅在隔离测试库运行。
