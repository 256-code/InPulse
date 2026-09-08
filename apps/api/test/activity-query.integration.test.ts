import { randomUUID } from "node:crypto";

import type { DatabaseClient } from "@inpulse/database/client";
import { createDatabaseClient } from "@inpulse/database/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { PostgresAuditWritePort } from "../src/audit/postgres-audit-write-port.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { TimeCursorService } from "../src/cursors/time-cursor.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import type { ActivityWriteInput } from "../src/modules/activity/activity.write-port.js";
import { PostgresActivityWritePort } from "../src/modules/activity/postgres-activity-write-port.js";
import { PostgresActivityProjectionReader } from "../src/modules/activity/activity-projection.reader.js";
import {
  ActivityAuthorizationError,
  ActivityQueryValidationError,
  ActivityQueryService,
} from "../src/modules/activity/activity-query.service.js";
import { PostgresProjectAccessQueryPort } from "../src/modules/projects/postgres-project-access-query-port.js";
import {
  createProject,
  createUser,
  removeMember,
  testUrls,
  type ProjectFixture,
} from "./database.helpers.js";

let client: DatabaseClient | undefined;
let uow: PostgresUnitOfWork | undefined;
let auditPort: PostgresAuditWritePort | undefined;
let activityPort: PostgresActivityWritePort | undefined;
let memberId: number | undefined;
let otherId: number | undefined;
let adminId: number | undefined;
let removedId: number | undefined;
let memberProject: ProjectFixture | undefined;
let otherProject: ProjectFixture | undefined;
let service: ActivityQueryService | undefined;

const auditKey = Buffer.alloc(32, 0x5c);

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-activity-query-test",
  });
  uow = new PostgresUnitOfWork(client);
  auditPort = new PostgresAuditWritePort({
    currentVersion: 1,
    keyFor: () => auditKey,
  });
  activityPort = new PostgresActivityWritePort();
  memberId = await createUser(client.sql);
  otherId = await createUser(client.sql);
  adminId = await createUser(client.sql, { admin: true });
  removedId = await createUser(client.sql);
  memberProject = await createProject(client.sql, memberId);
  otherProject = await createProject(client.sql, otherId);

  await client.sql`
    INSERT INTO app.project_members (project_id, user_id)
    VALUES (${memberProject.projectId}, ${removedId})
  `;
  await removeMember(client.sql, memberProject.projectId, removedId);

  await seedActivity(
    memberProject.projectId,
    memberId,
    1001,
    "TASK_COMPLETED",
    "完成任务",
    "DONE",
    1,
    "MEMBER",
    "2026-09-08T00:00:01.000Z",
  );
  await seedActivity(
    memberProject.projectId,
    memberId,
    1002,
    "MODULE_CREATED",
    "创建模块",
    "ACTIVE",
    1,
    "MEMBER",
    "2026-09-08T00:00:02.000Z",
  );
  await seedActivity(
    memberProject.projectId,
    memberId,
    1003,
    "CHANGE_RECORD_VOIDED",
    "发布并作废记录",
    "VOID",
    2,
    "ADMIN_ONLY",
    "2026-09-08T00:00:03.000Z",
  );
  await seedActivity(
    otherProject.projectId,
    otherId,
    2001,
    "PROJECT_CREATED",
    "创建其他项目",
    "ACTIVE",
    1,
    "MEMBER",
    "2026-09-08T00:00:04.000Z",
  );

  const projectAccess = new PostgresProjectAccessQueryPort(client);
  const reader = new PostgresActivityProjectionReader(client.sql);
  const cursor = new TimeCursorService(
    VersionedHmacKeyring.fromEntries(
      [{ version: 1, key: Buffer.alloc(32, 0x2c) }],
      1,
    ),
    "ACTIVITY",
  );
  service = new ActivityQueryService(projectAccess, reader, cursor);
});

afterAll(async () => {
  await client?.close();
});

describe("ActivityQueryService (real PostgreSQL)", () => {
  test("普通成员只读取本人项目的 MEMBER 投影，显式 includeAdminOnly 不扩大范围", async () => {
    const page = await service!.query({
      actorUserId: memberId!,
      projectId: memberProject!.projectId,
      limit: 50,
    });
    expect(page.items).toHaveLength(2);
    expect(
      page.items.every((item) => item.projectId === memberProject!.projectId),
    ).toBe(true);
    expect(page.items.some((item) => item.sourceEntityId === 1003)).toBe(false);
    expect(page.hasMore).toBe(false);

    const explicit = await service!.query({
      actorUserId: memberId!,
      projectId: memberProject!.projectId,
      includeAdminOnly: true,
      limit: 50,
    });
    expect(explicit.items).toHaveLength(2);
  });

  test("系统管理员默认排除 ADMIN_ONLY，显式开启后可见", async () => {
    const defaultPage = await service!.query({
      actorUserId: adminId!,
      projectId: memberProject!.projectId,
      limit: 50,
    });
    expect(defaultPage.items).toHaveLength(2);

    const adminPage = await service!.query({
      actorUserId: adminId!,
      projectId: memberProject!.projectId,
      includeAdminOnly: true,
      limit: 50,
    });
    expect(adminPage.items).toHaveLength(3);
    expect(adminPage.items.some((item) => item.sourceEntityId === 1003)).toBe(
      true,
    );
  });

  test("跨项目与已移除成员统一无项目访问，签名游标支持无重叠分页", async () => {
    await expect(
      service!.query({
        actorUserId: memberId!,
        projectId: otherProject!.projectId,
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(ActivityAuthorizationError);
    await expect(
      service!.query({
        actorUserId: removedId!,
        projectId: memberProject!.projectId,
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(ActivityAuthorizationError);

    const first = await service!.query({
      actorUserId: memberId!,
      projectId: memberProject!.projectId,
      limit: 1,
    });
    expect(first.items).toHaveLength(1);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    const second = await service!.query({
      actorUserId: memberId!,
      projectId: memberProject!.projectId,
      limit: 1,
      after: first.nextCursor as string,
    });
    expect(second.items).toHaveLength(1);
    expect(second.hasMore).toBe(false);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    expect(second.nextCursor).toBeNull();

    await expect(
      service!.query({
        actorUserId: memberId!,
        projectId: memberProject!.projectId,
        after: "not-a-cursor",
      }),
    ).rejects.toMatchObject({
      status: "invalid-cursor",
    } satisfies Partial<ActivityQueryValidationError>);
  });

  test("响应只暴露脱敏白名单字段且不包含 metadata", async () => {
    const page = await service!.query({
      actorUserId: memberId!,
      projectId: memberProject!.projectId,
      limit: 50,
    });
    expect(Object.keys(page.items[0]!).sort()).toEqual([
      "activityType",
      "actorId",
      "id",
      "occurredAt",
      "projectId",
      "sourceEntityId",
      "sourceEntityType",
      "summary",
    ]);
  });
});

async function seedActivity(
  projectId: number,
  actorId: number,
  entityId: number,
  action: string,
  summary: string,
  sourceStatus: string,
  sourceRowVersion: number,
  visibilityScope: "MEMBER" | "ADMIN_ONLY",
  occurredAt: string,
): Promise<void> {
  await uow!.run(async (tx) => {
    const audit = await auditPort!.append(tx, {
      projectId,
      actorType: "USER",
      actorId,
      action,
      targetType: "TASK",
      targetId: String(entityId),
      eventPayload: { summary },
      requestId: randomUUID(),
      clientRequestId: null,
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
      occurredAt: new Date(occurredAt),
    });
    const input: ActivityWriteInput = {
      projectId,
      sourceChainId: `PROJECT:${projectId}`,
      sourceSequence: audit.sequenceNo,
      sourceEntityType: "TASK",
      sourceEntityId: entityId,
      activityType: action,
      actorId,
      summary,
      metadata: { hidden: "must-not-leak" },
      visibilityScope,
      sourceStatus,
      sourceRowVersion,
      occurredAt: new Date(occurredAt),
    };
    await activityPort!.append(tx, input);
  });
}
