import { describe, expect, it, vi } from "vitest";
import type { TransactionContext } from "../src/database/transaction-context.js";
import { ModuleDeletionError } from "../src/modules/modules/module-deletion.command-port.js";
import { ScopeDeletionWorkflow } from "../src/workflows/scope-deletion.workflow.js";

/**
 * ADR-059：模块/功能删除 Workflow 的分支与汇总口径。真实 PostgreSQL 的端到端
 * 行为由 `scope-deletion.integration.test.ts` 覆盖，这里只锁定单靠真库难以区分的
 * 三件事：门禁与拒绝发生的先后顺序、两段链接解除的汇总、以及审计与动态载荷。
 */
const moduleRow = {
  id: 9,
  projectId: 3,
  code: "PAY-M-2",
  name: "结算模块",
  kind: "NORMAL",
  rowVersion: 4,
};

const softModule = {
  ...moduleRow,
  rowVersion: 5,
  deletedAt: new Date("2026-10-09T00:00:00.000Z"),
};

const featureRow = {
  id: 11,
  projectId: 3,
  moduleId: 9,
  code: "PAY-F-4",
  name: "对账功能",
  rowVersion: 2,
};

const softFeature = {
  ...featureRow,
  rowVersion: 3,
  deletedAt: new Date("2026-10-09T00:00:00.000Z"),
};

const taskRow = {
  id: 31,
  projectId: 3,
  moduleId: 9,
  featureId: null,
  rowVersion: 6,
};

const taskDeletionResult = {
  id: 31,
  projectId: 3,
  moduleId: 9,
  featureId: null,
  code: "PAY-T-1",
  title: "对账任务",
  workStatus: "TODO" as const,
  deletedAt: "2026-10-09T00:00:00.000Z",
  deletedBy: 7,
  voidedRecordCount: 1,
  removedLinkCount: 3,
  detachedGroupRole: null,
};

function harness() {
  const tx = {} as TransactionContext;
  const order: string[] = [];
  const values = {
    projectWritable: true,
    module: moduleRow as typeof moduleRow | null,
    moduleKind: "NORMAL" as "NORMAL" | "UNCLASSIFIED",
    aliveFeatures: [] as unknown[],
    mainTaskIds: [] as number[],
    tasks: [] as unknown[],
    detachedLinks: 0,
    voided: [] as { recordId: number; title: string }[],
  };
  // 每个桩都在返回前记一次顺序：返回值由用例改 `values` 决定，顺序记录不受影响。
  const step = (label: string, value: unknown): Promise<unknown> => {
    order.push(label);
    return Promise.resolve(value);
  };
  const deps = {
    uow: {
      run: vi.fn(
        async (fn: (context: TransactionContext) => Promise<unknown>) => fn(tx),
      ),
    },
    access: {
      checkProjectForWrite: vi.fn(async (..._args: unknown[]) =>
        step(
          "lock-project",
          values.projectWritable
            ? { kind: "allowed", resource: {} }
            : { kind: "not-found" },
        ),
      ),
    },
    modules: {
      authorize: vi.fn(async (..._args: unknown[]) =>
        step("authorize-module", undefined),
      ),
      findForDeletion: vi.fn(async (..._args: unknown[]) =>
        step(
          "find-module",
          values.module === null
            ? null
            : { ...values.module, kind: values.moduleKind },
        ),
      ),
      softDelete: vi.fn(async (..._args: unknown[]) =>
        step("soft-delete-module", softModule),
      ),
    },
    features: {
      authorize: vi.fn(async (..._args: unknown[]) =>
        step("authorize-feature", undefined),
      ),
      findForDeletion: vi.fn(async (..._args: unknown[]) =>
        step("find-feature", featureRow),
      ),
      listAliveOfModule: vi.fn(async (..._args: unknown[]) =>
        step("lock-features", values.aliveFeatures),
      ),
      softDelete: vi.fn(async (..._args: unknown[]) =>
        step("soft-delete-feature", softFeature),
      ),
    },
    tasks: {
      listActiveMainTaskIds: vi.fn(async (..._args: unknown[]) =>
        step("main-precheck", values.mainTaskIds),
      ),
      listForScope: vi.fn(async (..._args: unknown[]) =>
        step("lock-tasks", values.tasks),
      ),
    },
    taskDeletion: {
      deleteWithinTransaction: vi.fn(async (..._args: unknown[]) =>
        step("delete-task", taskDeletionResult),
      ),
    },
    records: {
      voidScopeRecords: vi.fn(async (..._args: unknown[]) =>
        step("void-records", values.voided),
      ),
    },
    links: {
      detachTarget: vi.fn(async (..._args: unknown[]) =>
        step("detach-links", values.detachedLinks),
      ),
    },
    audit: {
      append: vi.fn(async (..._args: unknown[]) =>
        step("audit", { chainId: "PROJECT:3", sequenceNo: 12 }),
      ),
    },
    activity: {
      append: vi.fn(async (..._args: unknown[]) => step("activity", undefined)),
      updateEntityVisibility: vi.fn(async (..._args: unknown[]) =>
        step("visibility", undefined),
      ),
    },
    search: {
      remove: vi.fn(async (..._args: unknown[]) =>
        step("search-remove", undefined),
      ),
    },
    tx,
    order,
    values,
  };
  const workflow = new ScopeDeletionWorkflow(
    deps.uow as never,
    deps.access as never,
    deps.modules as never,
    deps.features as never,
    deps.tasks as never,
    deps.taskDeletion as never,
    deps.records as never,
    deps.links as never,
    deps.audit as never,
    deps.activity as never,
    deps.search as never,
  );
  return { ...deps, workflow };
}

const deleteModule = (harnessed: ReturnType<typeof harness>) =>
  harnessed.workflow.deleteModule(7, 3, 9, 4, "模块下线", "req-1");

const deleteFeature = (harnessed: ReturnType<typeof harness>) =>
  harnessed.workflow.deleteFeature(7, 3, 9, 11, 2, "功能下线", "req-2");

describe("ADR-059 删除模块与功能的跨域编排", () => {
  it("未分类模块在写任何数据之前被拒绝", async () => {
    const harnessed = harness();
    harnessed.values.moduleKind = "UNCLASSIFIED";

    const error = await deleteModule(harnessed).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ModuleDeletionError);
    expect(error).toMatchObject({
      status: 409,
      code: "MODULE_UNCLASSIFIED_PROTECTED",
    });
    expect(harnessed.order).toEqual([
      "authorize-module",
      "lock-project",
      "find-module",
    ]);
    expect(harnessed.modules.softDelete).not.toHaveBeenCalled();
    expect(harnessed.links.detachTarget).not.toHaveBeenCalled();
    expect(
      harnessed.taskDeletion.deleteWithinTransaction,
    ).not.toHaveBeenCalled();
    expect(harnessed.audit.append).not.toHaveBeenCalled();
    expect(harnessed.search.remove).not.toHaveBeenCalled();
  });

  it("项目不可写或模块不存在时统一按模块不存在返回 404", async () => {
    const blocked = harness();
    blocked.values.projectWritable = false;
    const notWritable = await deleteModule(blocked).catch(
      (caught: unknown) => caught,
    );
    expect(notWritable).toMatchObject({
      status: 404,
      code: "MODULE_NOT_FOUND",
    });
    expect(blocked.modules.findForDeletion).not.toHaveBeenCalled();

    const absent = harness();
    absent.values.module = null;
    const notFound = await deleteModule(absent).catch(
      (caught: unknown) => caught,
    );
    expect(notFound).toMatchObject({ status: 404, code: "MODULE_NOT_FOUND" });
    expect(absent.modules.softDelete).not.toHaveBeenCalled();
  });

  it("版本不一致返回 409，且不软删除模块、不解链接、不写审计", async () => {
    const harnessed = harness();

    const error = await harnessed.workflow
      .deleteModule(7, 3, 9, 5, null, "req-1")
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      status: 409,
      code: "MODULE_VERSION_CONFLICT",
    });
    expect(harnessed.modules.softDelete).not.toHaveBeenCalled();
    expect(harnessed.links.detachTarget).not.toHaveBeenCalled();
    expect(harnessed.audit.append).not.toHaveBeenCalled();
    expect(harnessed.activity.append).not.toHaveBeenCalled();
    expect(harnessed.search.remove).not.toHaveBeenCalled();
  });

  it("主任务门禁先于任何逐任务删除整体判定，命中即整体拒绝", async () => {
    const harnessed = harness();
    harnessed.values.aliveFeatures = [featureRow];
    harnessed.values.mainTaskIds = [42, 43];
    harnessed.values.tasks = [taskRow];

    const error = await deleteModule(harnessed).catch(
      (caught: unknown) => caught,
    );

    expect(error).toMatchObject({
      status: 409,
      code: "TASK_GROUP_MAIN_LOCKED",
    });
    expect((error as Error).message).toContain("42、43");
    expect(harnessed.order).toContain("main-precheck");
    expect(harnessed.order).not.toContain("delete-task");
    expect(
      harnessed.taskDeletion.deleteWithinTransaction,
    ).not.toHaveBeenCalled();
    expect(harnessed.tasks.listForScope).not.toHaveBeenCalled();
    // 功能锁、软删除与其审计发生在任务级联之前（同一事务，整体回滚后不落库）；
    // 模块级审计、动态与投影必须等整条级联成功。
    expect(
      harnessed.audit.append.mock.calls.map(
        (call) => (call[1] as { action: string }).action,
      ),
    ).toEqual(["feature.delete"]);
    expect(harnessed.records.voidScopeRecords).not.toHaveBeenCalled();
    // 功能的投影移除发生在级联功能时；模块自身的投影必须等整条级联成功。
    expect(harnessed.search.remove.mock.calls.map((call) => call[2])).toEqual([
      "FEATURE",
    ]);
    expect(
      harnessed.activity.append.mock.calls.map(
        (call) => (call[1] as { activityType: string }).activityType,
      ),
    ).toEqual(["FEATURE_DELETED"]);
  });

  it("模块级计数把功能与任务两段链接解除、以及两段记录作废一起汇总", async () => {
    const harnessed = harness();
    harnessed.values.aliveFeatures = [featureRow];
    harnessed.values.detachedLinks = 2;
    harnessed.values.tasks = [taskRow];
    harnessed.values.voided = [{ recordId: 77, title: "九月迭代" }];

    const result = await deleteModule(harnessed);

    // 链接解除 = 功能级 2 + 任务级 3；记录作废 = 任务级 1 + 范围内 1。
    expect(result).toMatchObject({
      id: 9,
      deletedBy: 7,
      deletedFeatureCount: 1,
      deletedTaskCount: 1,
      removedLinkCount: 5,
      voidedRecordCount: 2,
      deletedAt: "2026-10-09T00:00:00.000Z",
    });
    expect(harnessed.taskDeletion.deleteWithinTransaction).toHaveBeenCalledWith(
      harnessed.tx,
      {
        projectId: 3,
        taskId: 31,
        rowVersion: 6,
        actorId: 7,
        reason: "模块下线",
        requestId: "req-1",
      },
    );
    expect(harnessed.audit.append).toHaveBeenCalledWith(
      harnessed.tx,
      expect.objectContaining({
        action: "module.delete",
        targetId: "9",
        eventPayload: expect.objectContaining({
          deletedFeatureIds: [11],
          deletedTaskCount: 1,
          voidedRecords: [77],
          removedLinkCount: 5,
          reason: "模块下线",
        }),
      }),
    );
    expect(harnessed.activity.append).toHaveBeenCalledWith(
      harnessed.tx,
      expect.objectContaining({
        activityType: "MODULE_DELETED",
        sourceEntityType: "MODULE",
        sourceEntityId: 9,
        sourceStatus: "DELETED",
        sourceRowVersion: 5,
        summary: "删除模块：结算模块",
        metadata: expect.objectContaining({
          deletedFeatureCount: 1,
          deletedTaskCount: 1,
          voidedRecordIds: [77],
          removedLinkCount: 5,
        }),
      }),
    );
    expect(harnessed.search.remove).toHaveBeenCalledWith(
      harnessed.tx,
      3,
      "MODULE",
      9,
    );
    // 父到子的取锁顺序：模块行与功能行都先于任务行。
    expect(harnessed.order.indexOf("soft-delete-feature")).toBeLessThan(
      harnessed.order.indexOf("lock-tasks"),
    );
  });

  it("删除功能只覆盖本功能范围，且模块级影响任务不参与级联", async () => {
    const harnessed = harness();
    harnessed.values.detachedLinks = 2;
    harnessed.values.tasks = [taskRow];
    harnessed.values.voided = [{ recordId: 78, title: "十月迭代" }];

    const result = await deleteFeature(harnessed);

    expect(result).toMatchObject({
      id: 11,
      moduleId: 9,
      deletedTaskCount: 1,
      removedLinkCount: 5,
      voidedRecordCount: 2,
    });
    expect(harnessed.features.softDelete).toHaveBeenCalledWith(
      harnessed.tx,
      featureRow,
      7,
    );
    expect(harnessed.links.detachTarget).toHaveBeenCalledWith(
      harnessed.tx,
      3,
      "FEATURE",
      11,
    );
    expect(harnessed.tasks.listActiveMainTaskIds).toHaveBeenCalledWith(
      harnessed.tx,
      3,
      { moduleId: 9, featureId: 11 },
    );
    expect(harnessed.records.voidScopeRecords).toHaveBeenCalledWith(
      harnessed.tx,
      expect.objectContaining({ moduleId: 9, featureId: 11 }),
    );
    expect(harnessed.audit.append).toHaveBeenCalledWith(
      harnessed.tx,
      expect.objectContaining({
        action: "feature.delete",
        targetType: "FEATURE",
        targetId: "11",
        eventPayload: expect.objectContaining({
          moduleId: 9,
          removedLinkCount: 2,
          cascadeFromModuleId: null,
        }),
      }),
    );
    expect(harnessed.search.remove).toHaveBeenCalledWith(
      harnessed.tx,
      3,
      "FEATURE",
      11,
    );
    // 功能路径不做模块级功能扫描。
    expect(harnessed.features.listAliveOfModule).not.toHaveBeenCalled();
  });

  it("模块级联时每个被删功能单独留一条审计，并按来源标注", async () => {
    const harnessed = harness();
    harnessed.values.aliveFeatures = [featureRow];
    harnessed.values.detachedLinks = 1;

    await deleteModule(harnessed);

    const featureAudits = harnessed.audit.append.mock.calls
      .map((call) => call[1] as { action: string; eventPayload: unknown })
      .filter((input) => input.action === "feature.delete");
    expect(featureAudits).toHaveLength(1);
    expect(featureAudits[0]?.eventPayload).toMatchObject({
      featureId: 11,
      deletedTaskCount: null,
      voidedRecords: [],
      removedLinkCount: 1,
      cascadeFromModuleId: 9,
    });
  });

  it("空原因回落默认文案，写入审计与记录作废的是同一份原因", async () => {
    const harnessed = harness();

    await harnessed.workflow.deleteModule(7, 3, 9, 4, "   ", "req-1");
    const moduleAudit = harnessed.audit.append.mock.calls[0]?.[1] as {
      eventPayload: { reason: string };
    };
    expect(moduleAudit.eventPayload.reason).toBe("模块已被删除");
    expect(harnessed.records.voidScopeRecords).toHaveBeenCalledWith(
      harnessed.tx,
      expect.objectContaining({ reason: "模块已被删除" }),
    );

    const featureHarnessed = harness();
    await featureHarnessed.workflow.deleteFeature(
      7,
      3,
      9,
      11,
      2,
      null,
      "req-2",
    );
    const featureAudit = featureHarnessed.audit.append.mock.calls[0]?.[1] as {
      eventPayload: { reason: string };
    };
    expect(featureAudit.eventPayload.reason).toBe("功能已被删除");
  });
});
