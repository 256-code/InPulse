import { describe, expect, test } from "vitest";

import type {
  AuditAppendResult,
  AuditWriteInput,
} from "../src/audit/audit.port.js";
import { AuditWritePort } from "../src/audit/audit.port.js";
import type { TransactionContext } from "../src/database/transaction-context.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import {
  ProjectAutoPurgeService,
  projectAutoPurgeOptionsFromEnv,
} from "../src/modules/projects/project-auto-purge.service.js";
import type {
  DeletedProjectRecord,
  ExpiredProjectRecord,
  ProjectPurgeCounts,
} from "../src/modules/projects/projects-write.port.js";
import { ProjectsWritePort } from "../src/modules/projects/projects-write.port.js";

class FakeUnitOfWork {
  runs = 0;

  async run<T>(callback: (tx: TransactionContext) => Promise<T>): Promise<T> {
    this.runs += 1;
    return callback({ db: {} as never, sql: {} as never });
  }
}

class FakeProjectsWritePort {
  candidates: readonly ExpiredProjectRecord[] = [];
  /** 复核结果：命中即返回该记录，未命中表示已还原 / 已删除 / 删除时间被刷新。 */
  expired = new Map<number, DeletedProjectRecord>();
  readonly purgedProjectIds: number[] = [];
  readonly listInputs: { retentionDays: number; limit: number }[] = [];
  failOn: number | undefined;

  async listAutoPurgeCandidates(
    _tx: TransactionContext,
    input: { readonly retentionDays: number; readonly limit: number },
  ): Promise<readonly ExpiredProjectRecord[]> {
    this.listInputs.push(input);
    return this.candidates;
  }

  async findExpiredDeletedProjectForChange(
    _tx: TransactionContext,
    input: { readonly projectId: number; readonly retentionDays: number },
  ): Promise<DeletedProjectRecord | undefined> {
    return this.expired.get(input.projectId);
  }

  async purgeProject(
    _tx: TransactionContext,
    input: { readonly projectId: number },
  ): Promise<ProjectPurgeCounts> {
    if (this.failOn === input.projectId) {
      throw new Error(`purge failed for ${String(input.projectId)}`);
    }
    this.purgedProjectIds.push(input.projectId);
    return {
      modules: 1,
      features: 1,
      tasks: 2,
      changeRecords: 1,
      auditLogs: 1,
      members: 1,
      total: 7,
    };
  }
}

class FakeAuditWritePort {
  readonly entries: AuditWriteInput[] = [];

  async append(
    _tx: TransactionContext,
    input: AuditWriteInput,
  ): Promise<AuditAppendResult> {
    this.entries.push(input);
    return {
      chainId: "SYSTEM",
      sequenceNo: this.entries.length,
      recordHash: Buffer.alloc(32),
    };
  }
}

function deletedProject(
  projectId: number,
  deletedAt: string,
): DeletedProjectRecord {
  return {
    projectId,
    code: `P${String(projectId)}`,
    name: `Project P${String(projectId)}`,
    deletedAt,
    deletedById: 7,
    deletedByName: "删除者",
    rowVersion: 3,
  };
}

function setup(
  options: {
    readonly candidates?: readonly ExpiredProjectRecord[];
    readonly expired?: readonly DeletedProjectRecord[];
  } = {},
) {
  const unitOfWork = new FakeUnitOfWork();
  const projects = new FakeProjectsWritePort();
  const audit = new FakeAuditWritePort();
  projects.candidates = options.candidates ?? [];
  for (const record of options.expired ?? []) {
    projects.expired.set(record.projectId, record);
  }
  const service = new ProjectAutoPurgeService(
    unitOfWork as unknown as PostgresUnitOfWork,
    projects as unknown as ProjectsWritePort,
    audit as unknown as AuditWritePort,
  );
  return { audit, projects, service, unitOfWork };
}

describe("ProjectAutoPurgeService", () => {
  test("没有候选时只做一次只读查询，不写审计", async () => {
    const { audit, projects, service, unitOfWork } = setup();

    const result = await service.run({ retentionDays: 30, batchSize: 20 });

    expect(result).toEqual({
      candidates: 0,
      purgedProjectIds: [],
      skippedProjectIds: [],
      failedProjectIds: [],
    });
    expect(unitOfWork.runs).toBe(1);
    expect(projects.listInputs).toEqual([{ retentionDays: 30, limit: 20 }]);
    expect(audit.entries).toEqual([]);
  });

  test("锁内复核失败（已还原 / 并发删除）时跳过，不删除也不写审计", async () => {
    const { audit, projects, service } = setup({
      candidates: [{ projectId: 11, deletedAt: "2026-08-01T00:00:00.000Z" }],
    });

    const result = await service.run({ retentionDays: 30, batchSize: 20 });

    expect(result.skippedProjectIds).toEqual([11]);
    expect(result.purgedProjectIds).toEqual([]);
    expect(projects.purgedProjectIds).toEqual([]);
    expect(audit.entries).toEqual([]);
  });

  test("到期项目物理删除并在 SYSTEM 链留痕（SYSTEM 参与者、保留期与触发来源）", async () => {
    const { audit, projects, service } = setup({
      candidates: [{ projectId: 21, deletedAt: "2026-08-01T00:00:00.000Z" }],
      expired: [deletedProject(21, "2026-08-01T00:00:00.000Z")],
    });

    const result = await service.run({ retentionDays: 30, batchSize: 20 });

    expect(result.purgedProjectIds).toEqual([21]);
    expect(projects.purgedProjectIds).toEqual([21]);
    expect(audit.entries).toHaveLength(1);
    expect(audit.entries[0]).toMatchObject({
      projectId: null,
      actorType: "SYSTEM",
      actorId: null,
      action: "project.purge",
      targetType: "PROJECT",
      targetId: "21",
      eventPayload: {
        code: "P21",
        name: "Project P21",
        deletedAt: "2026-08-01T00:00:00.000Z",
        deletedBy: { id: 7, name: "删除者" },
        actorRole: "SYSTEM",
        trigger: "AUTO_RETENTION",
        retentionDays: 30,
        records: {
          modules: 1,
          features: 1,
          tasks: 2,
          changeRecords: 1,
          auditLogs: 1,
          members: 1,
          total: 7,
        },
      },
    });
    expect(typeof audit.entries[0]!.requestId).toBe("string");
  });

  test("单个项目失败不阻塞其它候选，失败者等下一轮重试", async () => {
    const { audit, projects, service } = setup({
      candidates: [
        { projectId: 31, deletedAt: "2026-08-01T00:00:00.000Z" },
        { projectId: 32, deletedAt: "2026-08-02T00:00:00.000Z" },
      ],
      expired: [
        deletedProject(31, "2026-08-01T00:00:00.000Z"),
        deletedProject(32, "2026-08-02T00:00:00.000Z"),
      ],
    });
    projects.failOn = 31;

    const result = await service.run({ retentionDays: 30, batchSize: 20 });

    expect(result.failedProjectIds).toEqual([31]);
    expect(result.purgedProjectIds).toEqual([32]);
    expect(projects.purgedProjectIds).toEqual([32]);
    expect(audit.entries.map((entry) => entry.targetId)).toEqual(["32"]);
  });

  test("环境变量默认 30 天 / 20 个，非法值 fail closed", () => {
    expect(projectAutoPurgeOptionsFromEnv({})).toEqual({
      retentionDays: 30,
      batchSize: 20,
    });
    expect(
      projectAutoPurgeOptionsFromEnv({
        PROJECT_AUTO_PURGE_RETENTION_DAYS: "7",
        PROJECT_AUTO_PURGE_BATCH_SIZE: "5",
      }),
    ).toEqual({ retentionDays: 7, batchSize: 5 });
    expect(() =>
      projectAutoPurgeOptionsFromEnv({
        PROJECT_AUTO_PURGE_RETENTION_DAYS: "0",
      }),
    ).toThrow("PROJECT_AUTO_PURGE_RETENTION_DAYS must be a positive integer");
    expect(() =>
      projectAutoPurgeOptionsFromEnv({ PROJECT_AUTO_PURGE_BATCH_SIZE: "-1" }),
    ).toThrow("PROJECT_AUTO_PURGE_BATCH_SIZE must be a positive integer");
  });
});
