import { describe, expect, it, vi } from "vitest";

import type { AuditWritePort } from "../src/audit/audit.port.js";
import type { TransactionContext } from "../src/database/transaction-context.js";
import type { ActivityWritePort } from "../src/modules/activity/activity.write-port.js";
import type { ProjectAccessQueryPort } from "../src/modules/projects/project-access.port.js";
import {
  ProjectManagementService,
  ProjectManagementError,
} from "../src/modules/projects/project-management.service.js";
import type {
  ProjectChangeRecord,
  ProjectsWritePort,
} from "../src/modules/projects/projects-write.port.js";
import type { SearchProjectionWritePort } from "../src/modules/search/search-projection.write-port.js";

const current: ProjectChangeRecord = {
  projectId: 7,
  code: "SHOP",
  name: "商城系统",
  description: "旧描述",
  status: "ACTIVE",
  rowVersion: 1,
  createdBy: 5,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  memberCount: 2,
};

const tx = {} as unknown as TransactionContext;

function setup(
  check: Awaited<ReturnType<ProjectAccessQueryPort["checkProjectForWrite"]>> = {
    kind: "allowed",
    resource: {
      projectId: 7,
      status: "ACTIVE",
      rowVersion: 1,
      isSystemAdmin: false,
    },
  },
  found: ProjectChangeRecord | undefined = current,
  statusUpdated: ProjectChangeRecord | undefined = {
    ...current,
    status: "ARCHIVED",
    rowVersion: 2,
    updatedAt: "2026-09-10T00:00:00.000Z",
  },
) {
  const checkProjectForWrite = vi.fn().mockResolvedValue(check);
  const findProjectForChange = vi.fn().mockResolvedValue(found);
  const updateProjectDetails = vi.fn().mockResolvedValue({
    ...current,
    name: "商城系统二期",
    description: "新描述",
    rowVersion: 2,
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  const updateProjectStatus = vi.fn().mockResolvedValue(statusUpdated);
  const countUnfinishedTasks = vi.fn().mockResolvedValue(3);
  const appendAudit = vi
    .fn()
    .mockResolvedValue({ chainId: "chain-1", sequenceNo: 4 });
  const appendActivity = vi.fn().mockResolvedValue(undefined);
  const upsertSearch = vi.fn().mockResolvedValue(undefined);
  const service = new ProjectManagementService(
    {
      findProjectForChange,
      updateProjectDetails,
      updateProjectStatus,
      countUnfinishedTasks,
    } as unknown as ProjectsWritePort,
    { checkProjectForWrite } as unknown as ProjectAccessQueryPort,
    { append: appendAudit } as unknown as AuditWritePort,
    { append: appendActivity } as unknown as ActivityWritePort,
    { upsert: upsertSearch } as unknown as SearchProjectionWritePort,
  );
  return {
    service,
    checkProjectForWrite,
    findProjectForChange,
    updateProjectDetails,
    updateProjectStatus,
    countUnfinishedTasks,
    appendAudit,
    appendActivity,
    upsertSearch,
  };
}

describe("ProjectManagementService", () => {
  it("edits the project, locks the row and writes audit, activity and search in one transaction", async () => {
    const s = setup();
    const result = await s.service.updateProject(tx, {
      actorId: 5,
      projectId: 7,
      version: 1,
      edit: { name: "商城系统二期", description: "新描述" },
      requestId: "req-1",
    });

    expect(s.checkProjectForWrite).toHaveBeenCalledWith(tx, {
      actorUserId: 5,
      projectId: 7,
    });
    expect(s.findProjectForChange).toHaveBeenCalledWith(
      tx,
      { projectId: 7 },
      true,
    );
    expect(s.updateProjectDetails).toHaveBeenCalledWith(tx, {
      projectId: 7,
      expectedRowVersion: 1,
      name: "商城系统二期",
      description: "新描述",
    });
    expect(s.appendAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "project.update",
        targetType: "PROJECT",
        targetId: "7",
        requestId: "req-1",
        eventPayload: {
          before: { name: "商城系统", description: "旧描述", rowVersion: 1 },
          after: {
            name: "商城系统二期",
            description: "新描述",
            rowVersion: 2,
          },
        },
      }),
    );
    expect(s.appendActivity).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        sourceEntityType: "PROJECT",
        sourceEntityId: 7,
        activityType: "PROJECT_UPDATED",
        sourceRowVersion: 2,
      }),
    );
    expect(s.upsertSearch).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        entityType: "PROJECT",
        entityId: 7,
        title: "商城系统二期",
        sourceStatus: "ACTIVE",
        sourceRowVersion: 2,
      }),
    );
    expect(result.project).toMatchObject({
      id: 7,
      name: "商城系统二期",
      rowVersion: 2,
    });
  });

  it("rejects stale versions before writing anything", async () => {
    const s = setup(undefined, {
      ...current,
      rowVersion: 3,
    });
    await expect(
      s.service.updateProject(tx, {
        actorId: 5,
        projectId: 7,
        version: 1,
        edit: { name: "过期编辑", description: "" },
        requestId: "req-2",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "PROJECT_VERSION_CONFLICT",
    });
    expect(s.updateProjectDetails).not.toHaveBeenCalled();
    expect(s.appendAudit).not.toHaveBeenCalled();
  });

  it("rejects missing projects and archived writes, and validates replay context", async () => {
    const missing = setup({ kind: "not-found" });
    await expect(
      missing.service.updateProject(tx, {
        actorId: 5,
        projectId: 7,
        version: 1,
        edit: { name: "x", description: "" },
        requestId: "req-3",
      }),
    ).rejects.toMatchObject({ status: 404, code: "PROJECT_NOT_FOUND" });

    const archived = setup({
      kind: "parent-not-active",
      resource: {
        projectId: 7,
        status: "ARCHIVED",
        rowVersion: 2,
        isSystemAdmin: false,
      },
    });
    await expect(
      archived.service.updateProject(tx, {
        actorId: 5,
        projectId: 7,
        version: 2,
        edit: { name: "x", description: "" },
        requestId: "req-4",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROJECT_ARCHIVED" });

    await expect(
      archived.service.replay(tx, 5, { projectId: "not-a-number" }),
    ).rejects.toThrow();
    await expect(
      archived.service.replay(tx, 5, { projectId: 7 }),
    ).rejects.toBeInstanceOf(ProjectManagementError);
  });

  it("archives with reason, audit, activity and search projection in one transaction", async () => {
    const s = setup();
    const result = await s.service.archiveProject(tx, {
      actorId: 9,
      projectId: 7,
      version: 1,
      reason: "项目已交付",
      requestId: "req-archive",
    });

    expect(s.checkProjectForWrite).toHaveBeenCalledWith(tx, {
      actorUserId: 9,
      projectId: 7,
    });
    expect(s.updateProjectStatus).toHaveBeenCalledWith(tx, {
      projectId: 7,
      expectedRowVersion: 1,
      status: "ARCHIVED",
    });
    expect(s.appendAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "project.archive",
        requestId: "req-archive",
        eventPayload: {
          reason: "项目已交付",
          before: { status: "ACTIVE", rowVersion: 1 },
          after: { status: "ARCHIVED", rowVersion: 2 },
        },
      }),
    );
    expect(s.appendActivity).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        activityType: "PROJECT_ARCHIVED",
        sourceRowVersion: 2,
      }),
    );
    expect(s.upsertSearch).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        entityType: "PROJECT",
        sourceStatus: "ARCHIVED",
        sourceRowVersion: 2,
      }),
    );
    expect(result.project).toMatchObject({
      id: 7,
      status: "ARCHIVED",
      rowVersion: 2,
    });
  });

  it("rejects archive of an archived or stale project without writing", async () => {
    const archived = setup({
      kind: "parent-not-active",
      resource: {
        projectId: 7,
        status: "ARCHIVED",
        rowVersion: 2,
        isSystemAdmin: true,
      },
    });
    await expect(
      archived.service.archiveProject(tx, {
        actorId: 9,
        projectId: 7,
        version: 2,
        reason: "重复归档",
        requestId: "req-5",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROJECT_ARCHIVED" });
    expect(archived.updateProjectStatus).not.toHaveBeenCalled();

    const stale = setup(undefined, { ...current, rowVersion: 4 });
    await expect(
      stale.service.archiveProject(tx, {
        actorId: 9,
        projectId: 7,
        version: 1,
        reason: "过期归档",
        requestId: "req-6",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROJECT_VERSION_CONFLICT" });

    const stateConflict = setup(undefined, {
      ...current,
      status: "ARCHIVED",
      rowVersion: 1,
    });
    await expect(
      stateConflict.service.archiveProject(tx, {
        actorId: 9,
        projectId: 7,
        version: 1,
        reason: "状态冲突",
        requestId: "req-7",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROJECT_STATE_CONFLICT" });
  });

  it("restores an archived project and allows replay for archived scopes", async () => {
    const restoredRecord: ProjectChangeRecord = {
      ...current,
      status: "ACTIVE",
      rowVersion: 3,
    };
    const s = setup(
      undefined,
      { ...current, status: "ARCHIVED", rowVersion: 2 },
      restoredRecord,
    );
    const result = await s.service.restoreProject(tx, {
      actorId: 9,
      projectId: 7,
      version: 2,
      reason: "项目重启",
      requestId: "req-restore",
    });

    expect(s.updateProjectStatus).toHaveBeenCalledWith(tx, {
      projectId: 7,
      expectedRowVersion: 2,
      status: "ACTIVE",
    });
    expect(s.appendAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "project.restore",
        eventPayload: {
          reason: "项目重启",
          before: { status: "ARCHIVED", rowVersion: 2 },
          after: { status: "ACTIVE", rowVersion: 3 },
        },
      }),
    );
    expect(s.appendActivity).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        activityType: "PROJECT_RESTORED",
        sourceRowVersion: 3,
      }),
    );
    expect(s.upsertSearch).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        sourceStatus: "ACTIVE",
        sourceRowVersion: 3,
      }),
    );
    expect(result.project).toMatchObject({ status: "ACTIVE", rowVersion: 3 });

    await expect(
      s.service.replay(tx, 9, { projectId: 7 }, { allowArchived: true }),
    ).resolves.toBeUndefined();

    const active = setup();
    await expect(
      active.service.restoreProject(tx, {
        actorId: 9,
        projectId: 7,
        version: 1,
        reason: "未归档",
        requestId: "req-8",
      }),
    ).rejects.toMatchObject({ status: 409, code: "PROJECT_STATE_CONFLICT" });
  });

  it("counts unfinished tasks for the archive preview", async () => {
    const s = setup();
    const result = await s.service.archivePreview(tx, 9, 7);
    expect(result).toEqual({ projectId: 7, unfinishedTaskCount: 3 });
    expect(s.countUnfinishedTasks).toHaveBeenCalledWith(tx, { projectId: 7 });
  });
});
