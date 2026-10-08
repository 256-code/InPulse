import { randomUUID } from "node:crypto";

import type { DatabaseClient } from "@inpulse/database/client";
import { createDatabaseClient } from "@inpulse/database/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import type { ActivityCategory } from "../../../packages/api-contract/src/index.ts";
import { PostgresAuditWritePort } from "../src/audit/postgres-audit-write-port.js";
import { VersionedHmacKeyring } from "../src/auth/keyring.js";
import { TimeCursorService } from "../src/cursors/time-cursor.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import type {
  ActivitySourceEntityType,
  ActivityWriteInput,
} from "../src/modules/activity/activity.write-port.js";
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

  // ADR-050（2026-09-28 修订）：已删除项目退出全部授权范围，但整个项目链的
  // MEMBER 可见动态（含创建到删除的完整过程）对全部登录用户公开；
  // ADMIN_ONLY 行仍随项目一起退出可见范围。
  test("已删除项目对任意登录用户下发 MEMBER 可见的全部动态，不含 ADMIN_ONLY", async () => {
    const owner = await createUser(client!.sql);
    const deletedProject = await createProject(client!.sql, owner);
    await seedActivity(
      deletedProject.projectId,
      owner,
      3001,
      "TASK_COMPLETED",
      "删除前的任务动态",
      "DONE",
      1,
      "MEMBER",
      "2026-09-08T00:00:05.000Z",
    );
    await seedActivity(
      deletedProject.projectId,
      owner,
      3002,
      "PROJECT_DELETED",
      "删除了项目",
      "DELETED",
      2,
      "MEMBER",
      "2026-09-08T00:00:06.000Z",
    );
    await seedActivity(
      deletedProject.projectId,
      owner,
      3003,
      "CHANGE_RECORD_VOIDED",
      "作废记录",
      "VOID",
      3,
      "ADMIN_ONLY",
      "2026-09-08T00:00:07.000Z",
    );
    await client!.sql`
      UPDATE app.projects
         SET deleted_at = now(),
             deleted_by = ${adminId!},
             updated_at = now(),
             row_version = row_version + 1
       WHERE id = ${deletedProject.projectId}
    `;

    // 非成员与仍在册的成员口径一致：删除前的 MEMBER 动态随项目公开。
    for (const actorUserId of [otherId!, owner]) {
      const page = await service!.query({
        actorUserId,
        projectId: deletedProject.projectId,
        limit: 50,
      });
      expect(page.items.map((item) => item.activityType)).toEqual([
        "PROJECT_DELETED",
        "TASK_COMPLETED",
      ]);
      expect(page.items[0]).toMatchObject({
        projectId: deletedProject.projectId,
        activityType: "PROJECT_DELETED",
        sourceEntityId: 3002,
      });
      expect(page.hasMore).toBe(false);
    }

    // includeAdminOnly 不扩大已删除项目的范围（ADMIN_ONLY 不回放）。
    const adminPage = await service!.query({
      actorUserId: adminId!,
      projectId: deletedProject.projectId,
      includeAdminOnly: true,
      limit: 50,
    });
    expect(adminPage.items.map((item) => item.activityType)).toEqual([
      "PROJECT_DELETED",
      "TASK_COMPLETED",
    ]);

    // 未删除项目的行为不变：跨项目依旧无访问权。
    await expect(
      service!.query({
        actorUserId: memberId!,
        projectId: otherProject!.projectId,
        limit: 50,
      }),
    ).rejects.toBeInstanceOf(ActivityAuthorizationError);
  });
});

/**
 * 跨项目聚合动态（`GET /api/v1/activity`）在真实 PostgreSQL 上的行为：
 * 单一结果集全局游标只追加、按日总数与分页解耦、分类口径与前端 chip 一致、
 * 越权项目静默排除。
 */
describe("ActivityQueryService 聚合动态 (real PostgreSQL)", () => {
  let feedUserId: number;
  let feedOtherId: number;
  let feedAdminId: number;
  let projectA: ProjectFixture;
  let projectB: ProjectFixture;
  let projectC: ProjectFixture;
  let deletedProject: ProjectFixture;

  beforeAll(async () => {
    feedUserId = await createUser(client!.sql);
    feedOtherId = await createUser(client!.sql);
    feedAdminId = await createUser(client!.sql, { admin: true });
    projectA = await createProject(client!.sql, feedUserId);
    projectB = await createProject(client!.sql, feedUserId);
    projectC = await createProject(client!.sql, feedOtherId);
    const deletedOwner = await createUser(client!.sql);
    deletedProject = await createProject(client!.sql, deletedOwner);
    await client!.sql`
      UPDATE app.projects
         SET deleted_at = now(),
             deleted_by = ${feedAdminId},
             updated_at = now(),
             row_version = row_version + 1
       WHERE id = ${deletedProject.projectId}
    `;

    // A 项目：跨桶实体类型 + 跨上海自然日的两条（相隔 1 小时）。
    await seedActivity(
      projectA.projectId,
      feedUserId,
      101,
      "TASK_COMPLETED",
      "A 任务完成",
      "DONE",
      1,
      "MEMBER",
      "2026-09-07T15:30:00.000Z",
      "TASK",
    );
    await seedActivity(
      projectA.projectId,
      feedUserId,
      102,
      "MODULE_CREATED",
      "A 模块创建",
      "ACTIVE",
      1,
      "MEMBER",
      "2026-09-07T16:30:00.000Z",
      "MODULE",
    );
    await seedActivity(
      projectA.projectId,
      feedUserId,
      103,
      "TASK_MERGED",
      "A 任务合并",
      "ACTIVE",
      1,
      "MEMBER",
      "2026-09-08T01:00:00.000Z",
      "TASK_GROUP",
    );
    await seedActivity(
      projectA.projectId,
      feedUserId,
      104,
      "PROJECT_CREATED",
      "A 项目创建",
      "ACTIVE",
      1,
      "MEMBER",
      "2026-09-08T02:00:00.000Z",
      "PROJECT",
    );
    // B 项目：含一条 ADMIN_ONLY。
    await seedActivity(
      projectB.projectId,
      feedUserId,
      201,
      "CHANGE_RECORD_VOIDED",
      "B 记录作废",
      "VOID",
      2,
      "MEMBER",
      "2026-09-07T17:00:00.000Z",
      "CHANGE_RECORD",
    );
    await seedActivity(
      projectB.projectId,
      feedUserId,
      202,
      "CHANGE_RECORD_VOIDED",
      "B 管理员作废",
      "VOID",
      3,
      "ADMIN_ONLY",
      "2026-09-08T03:00:00.000Z",
      "CHANGE_RECORD",
    );
    await seedActivity(
      projectB.projectId,
      feedUserId,
      203,
      "TASK_COMPLETED",
      "B 任务完成",
      "DONE",
      1,
      "MEMBER",
      "2026-09-08T04:00:00.000Z",
      "TASK",
    );
    // C 项目属于他人：对 feedUser 只作为「越权项目」夹具。
    await seedActivity(
      projectC.projectId,
      feedOtherId,
      301,
      "TASK_COMPLETED",
      "C 任务完成",
      "DONE",
      1,
      "MEMBER",
      "2026-09-08T05:00:00.000Z",
      "TASK",
    );
    // D 项目已删除：整条 MEMBER 链对全部登录用户公开。
    await seedActivity(
      deletedProject.projectId,
      deletedOwner,
      401,
      "TASK_COMPLETED",
      "D 删除前完成",
      "DONE",
      1,
      "MEMBER",
      "2026-09-08T06:00:00.000Z",
      "TASK",
    );
    await seedActivity(
      deletedProject.projectId,
      deletedOwner,
      402,
      "PROJECT_DELETED",
      "D 删除项目",
      "DELETED",
      2,
      "MEMBER",
      "2026-09-08T06:30:00.000Z",
      "PROJECT",
    );
    await seedActivity(
      deletedProject.projectId,
      deletedOwner,
      403,
      "CHANGE_RECORD_VOIDED",
      "D 管理员作废",
      "VOID",
      3,
      "ADMIN_ONLY",
      "2026-09-08T07:00:00.000Z",
      "CHANGE_RECORD",
    );
  });

  test("全局游标只追加：翻页不会把新条目插回更早的日期", async () => {
    const pages: {
      readonly ids: readonly number[];
      readonly keys: readonly string[];
      readonly hasMore: boolean;
      readonly nextCursor: string | null;
    }[] = [];
    let cursor: string | undefined;
    let hasMore = true;
    while (hasMore && pages.length < 10) {
      const page = await service!.listFeed({
        actorUserId: feedUserId,
        projectIds: [projectA.projectId, projectB.projectId],
        limit: 2,
        ...(cursor === undefined ? {} : { after: cursor }),
      });
      pages.push({
        ids: page.items.map((item) => item.sourceEntityId),
        keys: page.items.map((item) => `${item.occurredAt}|${item.id}`),
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      });
      cursor = page.nextCursor ?? undefined;
      hasMore = page.hasMore;
    }

    expect(pages.map((page) => page.ids)).toEqual([
      [203, 104],
      [103, 201],
      [102, 101],
    ]);
    expect(pages.at(-1)!.hasMore).toBe(false);
    expect(pages.at(-1)!.nextCursor).toBeNull();
    // 页内与跨页都是严格递减的 (occurredAt, id) 键。
    const keys = pages.flatMap((page) => page.keys);
    expect(new Set(keys).size).toBe(keys.length);
    const sorted = [...keys].sort().reverse();
    expect(keys).toEqual(sorted);

    // 重新取第一页结果不变，证明分页锚点稳定。
    const first = await service!.listFeed({
      actorUserId: feedUserId,
      projectIds: [projectA.projectId, projectB.projectId],
      limit: 2,
    });
    expect(first.items.map((item) => item.sourceEntityId)).toEqual([203, 104]);
  });

  test("按日总数是过滤条件下的全量，不随分页增长", async () => {
    const page = await service!.listFeed({
      actorUserId: feedUserId,
      projectIds: [projectA.projectId, projectB.projectId],
      limit: 1,
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.sourceEntityId).toBe(203);
    // 2026-09-07T15:30Z（上海 09-07 23:30）与 16:30Z（上海 09-08 00:30）
    // 相隔一小时但分属两个自然日，用于锁定 Asia/Shanghai 日界。
    expect(page.dayTotals).toEqual([
      { day: "2026-09-08", count: 5 },
      { day: "2026-09-07", count: 1 },
    ]);
    expect(page.dayTotalsTruncated).toBe(false);

    const admin = await service!.listFeed({
      actorUserId: feedAdminId,
      projectIds: [projectA.projectId, projectB.projectId],
      includeAdminOnly: true,
      limit: 1,
    });
    expect(admin.dayTotals).toEqual([
      { day: "2026-09-08", count: 6 },
      { day: "2026-09-07", count: 1 },
    ]);
  });

  test("分类口径与前端 chip 一一对应，且按日总数同步收窄", async () => {
    const expected: readonly (readonly [
      ActivityCategory,
      readonly number[],
    ])[] = [
      ["all", [203, 104, 103, 201, 102, 101]],
      ["task", [203, 103, 101]],
      ["record", [201]],
      ["module", [102]],
      ["feature", []],
      ["project", [104]],
      ["member", []],
      ["github", []],
    ];
    for (const [category, ids] of expected) {
      const page = await service!.listFeed({
        actorUserId: feedUserId,
        projectIds: [projectA.projectId, projectB.projectId],
        category,
        limit: 50,
      });
      expect({
        category,
        ids: page.items.map((item) => item.sourceEntityId),
      }).toEqual({ category, ids });
    }

    const taskOnly = await service!.listFeed({
      actorUserId: feedUserId,
      projectIds: [projectA.projectId, projectB.projectId],
      category: "task",
      limit: 50,
    });
    expect(taskOnly.dayTotals).toEqual([
      { day: "2026-09-08", count: 2 },
      { day: "2026-09-07", count: 1 },
    ]);
  });

  test("范围 = 实时授权范围 ∪ 全部已删除项目，删除链不回放 ADMIN_ONLY", async () => {
    const nonMember = await service!.listFeed({
      actorUserId: feedOtherId,
      projectIds: [deletedProject.projectId],
      limit: 50,
    });
    expect(nonMember.items.map((item) => item.sourceEntityId)).toEqual([
      402, 401,
    ]);
    expect(nonMember.hasMore).toBe(false);

    const admin = await service!.listFeed({
      actorUserId: feedAdminId,
      projectIds: [deletedProject.projectId],
      includeAdminOnly: true,
      limit: 50,
    });
    expect(admin.items.map((item) => item.sourceEntityId)).toEqual([402, 401]);
  });

  test("projectIds 只收窄，越权与未知项目静默排除", async () => {
    const narrowed = await service!.listFeed({
      actorUserId: feedUserId,
      projectIds: [projectA.projectId],
      limit: 50,
    });
    expect(narrowed.items.map((item) => item.sourceEntityId)).toEqual([
      104, 103, 102, 101,
    ]);
    expect(narrowed.dayTotals).toEqual([
      { day: "2026-09-08", count: 3 },
      { day: "2026-09-07", count: 1 },
    ]);

    // 混入越权项目时只保留有权部分，不抛 403 / 404。
    const mixed = await service!.listFeed({
      actorUserId: feedUserId,
      projectIds: [projectA.projectId, projectC.projectId],
      limit: 50,
    });
    expect(mixed.items.map((item) => item.sourceEntityId)).toEqual([
      104, 103, 102, 101,
    ]);

    // 全部越权或不存在时返回空页，仍然不泄露存在性。
    for (const projectIds of [
      [projectC.projectId],
      [999_999_999],
      [projectC.projectId, 999_999_999],
    ]) {
      const page = await service!.listFeed({
        actorUserId: feedUserId,
        projectIds,
        limit: 50,
      });
      expect(page).toMatchObject({
        items: [],
        nextCursor: null,
        hasMore: false,
        dayTotals: [],
      });
    }
  });

  test("游标绑定过滤条件、操作者与路由，任一变化即失效", async () => {
    const feed = await service!.listFeed({
      actorUserId: feedUserId,
      limit: 1,
    });
    const cursor = feed.nextCursor;
    expect(cursor).not.toBeNull();

    const invalidCursor = {
      status: "invalid-cursor",
    } satisfies Partial<ActivityQueryValidationError>;
    await expect(
      service!.listFeed({
        actorUserId: feedUserId,
        projectIds: [projectA.projectId],
        limit: 1,
        after: cursor!,
      }),
    ).rejects.toMatchObject(invalidCursor);
    await expect(
      service!.listFeed({
        actorUserId: feedUserId,
        category: "task",
        limit: 1,
        after: cursor!,
      }),
    ).rejects.toMatchObject(invalidCursor);
    await expect(
      service!.listFeed({ actorUserId: feedOtherId, limit: 1, after: cursor! }),
    ).rejects.toMatchObject(invalidCursor);
    await expect(
      service!.query({
        actorUserId: feedUserId,
        projectId: projectA.projectId,
        limit: 1,
        after: cursor!,
      }),
    ).rejects.toMatchObject(invalidCursor);
    await expect(
      service!.listFeed({ actorUserId: feedUserId, limit: 1, after: "junk" }),
    ).rejects.toMatchObject(invalidCursor);
  });

  test("非法 projectIds / category / limit 按契约拒绝", async () => {
    const invalidProjectIds = {
      status: "invalid-project-ids",
    } satisfies Partial<ActivityQueryValidationError>;
    for (const projectIds of [
      [],
      [0],
      [projectA.projectId, projectA.projectId],
      Array.from({ length: 101 }, (_, index) => index + 1),
    ]) {
      await expect(
        service!.listFeed({ actorUserId: feedUserId, projectIds, limit: 20 }),
      ).rejects.toMatchObject(invalidProjectIds);
    }
    await expect(
      service!.listFeed({
        actorUserId: feedUserId,
        category: "bogus" as never,
      }),
    ).rejects.toMatchObject({ status: "invalid-category" });
    await expect(
      service!.listFeed({ actorUserId: feedUserId, limit: 0 }),
    ).rejects.toMatchObject({ status: "invalid-limit" });
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
  sourceEntityType: ActivitySourceEntityType = "TASK",
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
      sourceEntityType,
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
