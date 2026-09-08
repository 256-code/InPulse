import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";

import { PostgresProjectAccessQueryPort } from "../src/modules/projects/postgres-project-access-query-port.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import {
  connect,
  createProject,
  createUser,
  removeMember,
  testUrls,
} from "./database.helpers.js";

let client: DatabaseClient | undefined;
let runtime: ReturnType<typeof connect>;
let projectAccess: PostgresProjectAccessQueryPort;

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-project-access-test",
  });
  runtime = connect(testUrls().runtime);
  projectAccess = new PostgresProjectAccessQueryPort(client);
});

afterAll(async () => {
  await runtime.end({ timeout: 5 });
  await client?.close();
});

function checkProjectForWrite(actorUserId: number, projectId: number) {
  if (client === undefined || projectAccess === undefined) {
    throw new Error("integration fixture not initialized");
  }
  return new PostgresUnitOfWork(client).run((tx) =>
    projectAccess.checkProjectForWrite(tx, { actorUserId, projectId }),
  );
}

describe("PostgresProjectAccessQueryPort（真实 PostgreSQL）", () => {
  test("活跃成员只返回其 ACTIVE 成员项目，且按项目 ID 升序", async () => {
    const member = await createUser(runtime);
    const otherUser = await createUser(runtime);
    const first = await createProject(runtime, member);
    const second = await createProject(runtime, member);
    await createProject(runtime, otherUser);

    const scope = await projectAccess.getAuthorizedSearchScope(member);

    expect(scope.actorUserId).toBe(member);
    expect(scope.isSystemAdmin).toBe(false);
    expect(scope.projectIds).toEqual([first.projectId, second.projectId]);
  });

  test("已移除成员立即失去对应项目搜索范围", async () => {
    const member = await createUser(runtime);
    const otherUser = await createUser(runtime);
    const project = await createProject(runtime, member);
    await createProject(runtime, otherUser);

    await removeMember(runtime, project.projectId, member);

    const scope = await projectAccess.getAuthorizedSearchScope(member);

    expect(scope.isSystemAdmin).toBe(false);
    expect(scope.projectIds).toEqual([]);
  });

  test("停用用户即使有成员关系也不返回项目范围", async () => {
    const disabledUser = await createUser(runtime, { disabled: true });
    const owner = await createUser(runtime);
    await createProject(runtime, owner);

    await runtime`
      INSERT INTO app.project_members (project_id, user_id)
      VALUES (
        (SELECT id FROM app.projects ORDER BY id DESC LIMIT 1),
        ${disabledUser}
      )
    `;

    const scope = await projectAccess.getAuthorizedSearchScope(disabledUser);

    expect(scope.isSystemAdmin).toBe(false);
    expect(scope.projectIds).toEqual([]);
  });

  test("系统管理员按项目 ID 升序返回全部项目", async () => {
    const admin = await createUser(runtime, { admin: true });
    const owner = await createUser(runtime);
    const first = await createProject(runtime, owner);
    const second = await createProject(runtime, owner);

    const scope = await projectAccess.getAuthorizedSearchScope(admin);

    expect(scope.actorUserId).toBe(admin);
    expect(scope.isSystemAdmin).toBe(true);
    expect(scope.projectIds).toEqual(
      [...scope.projectIds].sort((left, right) => left - right),
    );
    expect(scope.projectIds).toEqual(
      expect.arrayContaining([first.projectId, second.projectId]),
    );
  });

  test("不存在的用户返回空范围", async () => {
    const scope = await projectAccess.getAuthorizedSearchScope(-1);

    expect(scope.isSystemAdmin).toBe(false);
    expect(scope.projectIds).toEqual([]);
  });
});

describe("PostgresProjectAccessQueryPort.checkProjectForWrite（真实 PostgreSQL）", () => {
  test("ACTIVE 成员返回 allowed，并携带项目版本与管理员标记", async () => {
    const member = await createUser(runtime);
    const project = await createProject(runtime, member);

    const result = await checkProjectForWrite(member, project.projectId);

    expect(result).toEqual({
      kind: "allowed",
      resource: {
        projectId: project.projectId,
        status: "ACTIVE",
        rowVersion: 1,
        isSystemAdmin: false,
      },
    });
  });

  test("无成员关系的普通用户返回 not-found", async () => {
    const owner = await createUser(runtime);
    const stranger = await createUser(runtime);
    const project = await createProject(runtime, owner);

    const result = await checkProjectForWrite(stranger, project.projectId);

    expect(result).toEqual({ kind: "not-found" });
  });

  test("已移除成员返回 not-found", async () => {
    const member = await createUser(runtime);
    const project = await createProject(runtime, member);

    await removeMember(runtime, project.projectId, member);

    const result = await checkProjectForWrite(member, project.projectId);

    expect(result).toEqual({ kind: "not-found" });
  });

  test("系统管理员无需成员关系即可写入，并返回 isSystemAdmin", async () => {
    const admin = await createUser(runtime, { admin: true });
    const owner = await createUser(runtime);
    const project = await createProject(runtime, owner);

    const result = await checkProjectForWrite(admin, project.projectId);

    expect(result).toEqual({
      kind: "allowed",
      resource: {
        projectId: project.projectId,
        status: "ACTIVE",
        rowVersion: 1,
        isSystemAdmin: true,
      },
    });
  });

  test("已归档项目返回 parent-not-active，且不按状态过滤掉记录", async () => {
    const member = await createUser(runtime);
    const project = await createProject(runtime, member);

    await runtime`
      UPDATE app.projects
         SET status = 'ARCHIVED',
             archived_at = now()
       WHERE id = ${project.projectId}
    `;

    const result = await checkProjectForWrite(member, project.projectId);

    expect(result).toEqual({
      kind: "parent-not-active",
      resource: {
        projectId: project.projectId,
        status: "ARCHIVED",
        rowVersion: 1,
        isSystemAdmin: false,
      },
    });
  });

  test("不存在的项目返回 not-found", async () => {
    const member = await createUser(runtime);

    const result = await checkProjectForWrite(member, -1);

    expect(result).toEqual({ kind: "not-found" });
  });

  test("停用 actor 返回 not-found", async () => {
    const disabledUser = await createUser(runtime, { disabled: true });
    const owner = await createUser(runtime);
    const project = await createProject(runtime, owner);

    const result = await checkProjectForWrite(disabledUser, project.projectId);

    expect(result).toEqual({ kind: "not-found" });
  });
});
