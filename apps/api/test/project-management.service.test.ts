import { describe, expect, it, vi } from "vitest";

import type { AuditWritePort } from "../src/audit/audit.port.js";
import type { TransactionContext } from "../src/database/transaction-context.js";
import type { ActivityWritePort } from "../src/modules/activity/activity.write-port.js";
import type { ProjectAccessQueryPort } from "../src/modules/projects/project-access.port.js";
import type { ProjectMembersQueryPort } from "../src/modules/projects/project-members-query.port.js";
import type { ProjectRoleGateService } from "../src/modules/projects/project-role-gate.service.js";
import type { ProjectStartNotifier } from "../src/modules/projects/project-start.notifier.js";
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
  firstTaskCompletedAt: "2026-09-09T01:00:00.000Z",
  rowVersion: 1,
  createdBy: 5,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  memberCount: 2,
  stats: {
    activeModuleCount: 2,
    activeFeatureCount: 1,
    openTaskCount: 3,
    completedTaskCount: 1,
  },
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
    status: "MAINTENANCE",
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
  const countUnarchivedTasks = vi.fn().mockResolvedValue(0);
  const appendAudit = vi
    .fn()
    .mockResolvedValue({ chainId: "chain-1", sequenceNo: 4 });
  const appendActivity = vi.fn().mockResolvedValue(undefined);
  const upsertSearch = vi.fn().mockResolvedValue(undefined);
  const findActiveRole = vi.fn().mockResolvedValue("LEADER");
  const listActiveMemberIds = vi.fn().mockResolvedValue([2, 3]);
  const manageRole = vi.fn().mockResolvedValue("LEADER");
  const notifyProjectStarted = vi.fn().mockResolvedValue(undefined);
  const service = new ProjectManagementService(
    {
      findProjectForChange,
      updateProjectDetails,
      updateProjectStatus,
      countUnarchivedTasks,
    } as unknown as ProjectsWritePort,
    { checkProjectForWrite } as unknown as ProjectAccessQueryPort,
    { append: appendAudit } as unknown as AuditWritePort,
    { append: appendActivity } as unknown as ActivityWritePort,
    { upsert: upsertSearch } as unknown as SearchProjectionWritePort,
    {
      findActiveRole,
      listActiveMemberIds,
    } as unknown as ProjectMembersQueryPort,
    { manageRole } as unknown as ProjectRoleGateService,
    { notify: notifyProjectStarted } as unknown as ProjectStartNotifier,
  );
  return {
    service,
    checkProjectForWrite,
    findProjectForChange,
    updateProjectDetails,
    updateProjectStatus,
    countUnarchivedTasks,
    appendAudit,
    appendActivity,
    upsertSearch,
    findActiveRole,
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
    // ADR-033：写命令响应携带当前用户的项目内角色。
    expect(result.currentUserRole).toBe("LEADER");
    expect(s.findActiveRole).toHaveBeenCalledWith(tx, {
      projectId: 7,
      userId: 5,
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

  it("rejects missing projects and validates replay context", async () => {
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

    await expect(
      missing.service.replay(tx, 5, { projectId: "not-a-number" }),
    ).rejects.toThrow();
    await expect(
      missing.service.replay(tx, 5, { projectId: 7 }),
    ).rejects.toBeInstanceOf(ProjectManagementError);
  });

  it("把项目切换为维护中：写审计、活动与搜索投影", async () => {
    const s = setup();
    const result = await s.service.changeProjectStatus(tx, {
      actorId: 9,
      projectId: 7,
      version: 1,
      target: "MAINTENANCE",
      requestId: "req-status",
    });

    expect(s.countUnarchivedTasks).toHaveBeenCalledWith(tx, { projectId: 7 });
    expect(s.updateProjectStatus).toHaveBeenCalledWith(tx, {
      projectId: 7,
      expectedRowVersion: 1,
      status: "MAINTENANCE",
    });
    expect(s.appendAudit).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        action: "project.status.change",
        requestId: "req-status",
      }),
    );
    expect(s.appendActivity).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        activityType: "PROJECT_STATUS_CHANGED",
        sourceRowVersion: 2,
      }),
    );
    expect(s.upsertSearch).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        sourceStatus: "MAINTENANCE",
        sourceRowVersion: 2,
      }),
    );
    expect(result.project).toMatchObject({
      status: "MAINTENANCE",
      rowVersion: 2,
    });
  });

  it("维护中门禁：仍有未收尾任务时拒绝进入维护中且不写任何副作用", async () => {
    const s = setup();
    s.countUnarchivedTasks.mockResolvedValueOnce(2);
    await expect(
      s.service.changeProjectStatus(tx, {
        actorId: 9,
        projectId: 7,
        version: 1,
        target: "MAINTENANCE",
        requestId: "req-gate",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "PROJECT_MAINTENANCE_TASKS_OPEN",
    });
    expect(s.updateProjectStatus).not.toHaveBeenCalled();
    expect(s.appendAudit).not.toHaveBeenCalled();
    expect(s.appendActivity).not.toHaveBeenCalled();
  });

  it("未开始与维护中禁止越级互改，目标态与当前态相同返回 409", async () => {
    const notStarted = setup(undefined, {
      ...current,
      status: "NOT_STARTED",
      firstTaskCompletedAt: null,
    });
    await expect(
      notStarted.service.changeProjectStatus(tx, {
        actorId: 9,
        projectId: 7,
        version: 1,
        target: "MAINTENANCE",
        requestId: "req-skip",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "PROJECT_STATUS_LEVEL_SKIP",
    });
    expect(notStarted.countUnarchivedTasks).not.toHaveBeenCalled();

    const same = setup();
    await expect(
      same.service.changeProjectStatus(tx, {
        actorId: 9,
        projectId: 7,
        version: 1,
        target: "ACTIVE",
        requestId: "req-same",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "PROJECT_STATE_CONFLICT",
    });
  });
});
