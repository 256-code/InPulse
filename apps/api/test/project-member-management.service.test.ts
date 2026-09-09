import { describe, expect, it, vi } from "vitest";

import type { TransactionContext } from "../src/database/transaction-context.js";
import type { ProjectAccessQueryPort } from "../src/modules/projects/project-access.port.js";
import type {
  ActiveUsersQueryPort,
  ProjectsWritePort,
} from "../src/modules/projects/projects-write.port.js";
import type { ProjectMemberTaskCommandPort } from "../src/modules/tasks/project-member-task.command-port.js";
import { ProjectMemberManagementService } from "../src/modules/projects/project-member-management.service.js";

const tx = {} as TransactionContext;
const project = {
  projectId: 7,
  name: "商城系统",
  status: "ACTIVE" as const,
  rowVersion: 1,
};
const activeMember = {
  membershipId: 10,
  projectId: 7,
  userId: 5,
  name: "张三",
  avatarUrl: null,
  status: "ACTIVE" as const,
  joinedAt: "2026-09-09T00:00:00.000Z",
  removedAt: null,
};
const removedMember = {
  ...activeMember,
  membershipId: 9,
  status: "REMOVED" as const,
  removedAt: "2026-09-09T01:00:00.000Z",
};
const unfinishedTask = {
  taskId: 12,
  projectId: 7,
  moduleId: 3,
  featureId: null,
  scopeType: "MODULE" as const,
  code: "P-T-1",
  title: "任务",
  description: "",
  priority: "NORMAL" as const,
  dueAt: null,
  workStatus: "TODO" as const,
  assigneeId: 5,
  rowVersion: 2,
  impactFeatureIds: [],
};

function setup() {
  const projects = {
    findProject: vi.fn().mockResolvedValue(project),
    listMembers: vi.fn().mockResolvedValue([activeMember]),
    findLatestMember: vi.fn().mockResolvedValue(activeMember),
    addMemberHistory: vi.fn().mockResolvedValue(activeMember),
    removeMember: vi.fn().mockResolvedValue(removedMember),
  };
  const access = {
    checkProjectForWrite: vi.fn().mockResolvedValue({
      kind: "allowed",
      resource: {
        projectId: 7,
        status: "ACTIVE",
        rowVersion: 1,
        isSystemAdmin: true,
      },
    }),
  };
  const activeUsers = {
    findActiveUserIds: vi.fn().mockResolvedValue([5]),
  };
  const tasks = {
    listUnfinished: vi.fn().mockResolvedValue([unfinishedTask]),
    reassign: vi.fn().mockResolvedValue([12]),
  };
  const audit = {
    append: vi.fn().mockResolvedValue({
      chainId: "PROJECT:7",
      sequenceNo: 1,
      recordHash: Buffer.alloc(32),
    }),
  };
  const activity = { append: vi.fn().mockResolvedValue(undefined) };
  const notifications = { write: vi.fn().mockResolvedValue(undefined) };
  const service = new ProjectMemberManagementService(
    projects as unknown as ProjectsWritePort,
    activeUsers as unknown as ActiveUsersQueryPort,
    access as unknown as ProjectAccessQueryPort,
    tasks as unknown as ProjectMemberTaskCommandPort,
    audit as never,
    activity as never,
    notifications as never,
  );
  return {
    service,
    projects,
    access,
    activeUsers,
    tasks,
    audit,
    activity,
    notifications,
  };
}

describe("ProjectMemberManagementService", () => {
  it("lists full member history for an existing project", async () => {
    const s = setup();
    const body = await s.service.listMembers(tx, 7);
    expect(body.items).toHaveLength(1);
    expect(s.projects.findProject).toHaveBeenCalledWith(tx, { projectId: 7 });
  });

  it("lists unfinished tasks only for an ACTIVE member", async () => {
    const s = setup();
    await expect(s.service.listUnfinishedTasks(tx, 7, 5)).resolves.toEqual({
      items: [unfinishedTask],
    });
    s.projects.findLatestMember.mockResolvedValueOnce(removedMember);
    await expect(s.service.listUnfinishedTasks(tx, 7, 5)).rejects.toMatchObject(
      {
        status: 404,
        code: "PROJECT_MEMBER_NOT_FOUND",
      },
    );
  });

  it("adds a new ACTIVE member with audit/activity/notification in one transaction", async () => {
    const s = setup();
    s.projects.findLatestMember.mockResolvedValueOnce(removedMember);
    const result = await s.service.addMember(tx, {
      actorId: 1,
      projectId: 7,
      userId: 5,
      requestId: "req-1",
    });
    expect(result.responseStatus).toBe(200);
    expect(result.body).toMatchObject({
      member: { userId: 5, status: "ACTIVE" },
    });
    expect(s.projects.addMemberHistory).toHaveBeenCalledWith(tx, {
      projectId: 7,
      userId: 5,
    });
    expect(s.audit.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "project.member.add" }),
    );
    expect(s.activity.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ activityType: "PROJECT_MEMBER_ADDED" }),
    );
    expect(s.notifications.write).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({
        recipientId: 5,
        notificationType: "PROJECT_JOINED",
      }),
    );
  });

  it("rejects duplicate active member and invalid user without writing", async () => {
    const s = setup();
    s.projects.findLatestMember.mockResolvedValueOnce(activeMember);
    await expect(
      s.service.addMember(tx, {
        actorId: 1,
        projectId: 7,
        userId: 5,
        requestId: "req-2",
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "PROJECT_MEMBER_ALREADY_ACTIVE",
    });
    expect(s.projects.addMemberHistory).not.toHaveBeenCalled();

    s.activeUsers.findActiveUserIds.mockResolvedValueOnce([]);
    s.projects.findLatestMember.mockResolvedValueOnce(undefined);
    await expect(
      s.service.addMember(tx, {
        actorId: 1,
        projectId: 7,
        userId: 99,
        requestId: "req-3",
      }),
    ).rejects.toMatchObject({
      status: 422,
      code: "PROJECT_MEMBER_USER_INVALID",
    });
  });

  it("removes a member after optional true reassignment and preserves historical owner", async () => {
    const s = setup();
    s.tasks.listUnfinished.mockResolvedValueOnce([]);
    const result = await s.service.removeMember(tx, {
      actorId: 1,
      projectId: 7,
      userId: 5,
      request: {
        reassignments: [
          {
            taskId: 12,
            moduleId: 3,
            featureId: null,
            rowVersion: 2,
            assigneeId: 6,
          },
        ],
      },
      requestId: "req-4",
    });
    expect(result.responseStatus).toBe(200);
    expect(result.body).toMatchObject({
      member: { status: "REMOVED" },
      reassignedTaskIds: [12],
      unfinishedTaskCount: 0,
    });
    expect(s.tasks.reassign).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ targetUserId: 5 }),
    );
    expect(s.notifications.write).not.toHaveBeenCalled();
    expect(s.audit.append).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ action: "project.member.remove" }),
    );
  });

  it("returns 404 when removing a non-active member", async () => {
    const s = setup();
    s.projects.findLatestMember.mockResolvedValueOnce(removedMember);
    await expect(
      s.service.removeMember(tx, {
        actorId: 1,
        projectId: 7,
        userId: 5,
        request: { reassignments: [] },
        requestId: "req-5",
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(s.tasks.reassign).not.toHaveBeenCalled();
  });

  it("re-checks project writability before replaying idempotent member writes", async () => {
    const s = setup();
    await expect(
      s.service.replayAuthorizer(tx, 1, {
        projectId: 7,
        memberUserId: 5,
      }),
    ).resolves.toBeUndefined();
    expect(s.access.checkProjectForWrite).toHaveBeenCalledWith(tx, {
      actorUserId: 1,
      projectId: 7,
    });

    s.access.checkProjectForWrite.mockResolvedValueOnce({
      kind: "parent-not-active",
      resource: {
        projectId: 7,
        status: "ARCHIVED",
        rowVersion: 2,
        isSystemAdmin: true,
      },
    });
    await expect(
      s.service.replayAuthorizer(tx, 1, {
        projectId: 7,
        memberUserId: 5,
      }),
    ).rejects.toMatchObject({
      status: 409,
      code: "PROJECT_MEMBER_PROJECT_ARCHIVED",
    });
  });
});
