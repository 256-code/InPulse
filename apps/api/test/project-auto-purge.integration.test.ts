import { randomBytes } from "node:crypto";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PostgresAuditWritePort } from "../src/audit/postgres-audit-write-port.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import { PostgresProjectsWritePort } from "../src/modules/projects/postgres-projects-write-port.js";
import {
  ProjectAutoPurgeService,
  PROJECT_AUTO_PURGE_TRIGGER,
} from "../src/modules/projects/project-auto-purge.service.js";
import { createProject, createUser, testUrls } from "./database.helpers.js";

/**
 * ADR-055 真实 PostgreSQL 集成测试：保留期到期的自动彻底删除走与手工彻底删除
 * 同一条 `app.purge_project` 窄口，SYSTEM 审计链留痕，且计时只认「最后一次删除」。
 */
const RETENTION_DAYS = 30;
const BATCH_SIZE = 500;

let client: DatabaseClient;
let auditReader: DatabaseClient;
let unitOfWork: PostgresUnitOfWork;
let projects: PostgresProjectsWritePort;
let service: ProjectAutoPurgeService;

const auditKey = randomBytes(32);

beforeAll(async () => {
  const urls = testUrls();
  client = createDatabaseClient(urls.runtime, {
    applicationName: "inpulse-adr055-project-auto-purge",
  });
  auditReader = createDatabaseClient(urls.auditReader, {
    applicationName: "inpulse-adr055-project-auto-purge-audit",
  });
  unitOfWork = new PostgresUnitOfWork(client);
  projects = new PostgresProjectsWritePort();
  service = new ProjectAutoPurgeService(
    unitOfWork,
    projects,
    new PostgresAuditWritePort({ currentVersion: 1, keyFor: () => auditKey }),
  );
});

afterAll(async () => {
  await client?.close();
  await auditReader?.close();
});

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

/** 走 ADR-049 的软删除端口（与项目删除命令同一持久化路径），删除时间可回拨。 */
async function softDelete(
  projectId: number,
  actorId: number,
  deletedAt: Date,
): Promise<void> {
  const rows = (await client.sql`
    SELECT row_version AS "rowVersion" FROM app.projects WHERE id = ${projectId}
  `) as unknown as readonly { readonly rowVersion: number }[];
  const deleted = await unitOfWork.run((tx) =>
    projects.softDeleteProject(tx, {
      projectId,
      expectedRowVersion: rows[0]!.rowVersion,
      actorId,
      deletedAt,
    }),
  );
  expect(deleted).toBe(true);
}

/** 走 ADR-051 的还原端口；还原清空 deleted_at，保留期随之从头开始。 */
async function restore(projectId: number): Promise<void> {
  const restored = await unitOfWork.run((tx) =>
    projects.restoreProject(tx, { projectId }),
  );
  expect(restored).not.toBeUndefined();
}

/** 模拟项目删除命令在项目自己审计链上留下的记录，用于验证彻底删除会带走整条链。 */
async function appendProjectChainRecord(
  projectId: number,
  actorId: number,
): Promise<void> {
  await unitOfWork.run((tx) =>
    new PostgresAuditWritePort({
      currentVersion: 1,
      keyFor: () => auditKey,
    }).append(tx, {
      projectId,
      actorType: "USER",
      actorId,
      action: "project.delete",
      targetType: "PROJECT",
      targetId: String(projectId),
      eventPayload: { code: "P", name: "Project" },
      requestId: "adr055-fixture",
      occurredAt: new Date(),
    }),
  );
}

async function projectRow(projectId: number): Promise<{
  readonly deletedAt: string | null;
} | null> {
  const rows = (await client.sql`
    SELECT deleted_at AS "deletedAt" FROM app.projects WHERE id = ${projectId}
  `) as unknown as readonly { readonly deletedAt: Date | null }[];
  const row = rows[0];
  if (row === undefined) return null;
  return {
    deletedAt:
      row.deletedAt === null ? null : new Date(row.deletedAt).toISOString(),
  };
}

async function countProjectRows(
  table: string,
  projectId: number,
): Promise<number> {
  const rows = (await client.sql.unsafe(
    `SELECT count(*)::integer AS "count" FROM app.${table} WHERE project_id = ${Math.trunc(projectId)}`,
  )) as unknown as readonly { readonly count: number }[];
  return rows[0]!.count;
}

async function projectChainExists(projectId: number): Promise<boolean> {
  const rows = (await auditReader.sql`
    SELECT 1 AS "found"
      FROM app.audit_chain_heads
     WHERE chain_id = ${`PROJECT:${String(projectId)}`}
  `) as unknown as readonly { readonly found: number }[];
  return rows.length > 0;
}

interface PurgeAuditRow {
  readonly actorType: string;
  readonly actorId: number | null;
  readonly targetId: string;
  readonly eventPayload: {
    readonly code: string;
    readonly name: string;
    readonly deletedAt: string;
    readonly deletedBy: { readonly id: number; readonly name: string };
    readonly actorRole: string;
    readonly trigger: string;
    readonly retentionDays: number;
    readonly records: Readonly<Record<string, number>>;
  };
}

async function purgeAuditRows(
  projectId: number,
): Promise<readonly PurgeAuditRow[]> {
  return (await auditReader.sql`
    SELECT actor_type AS "actorType",
           actor_id AS "actorId",
           target_id AS "targetId",
           event_payload AS "eventPayload"
      FROM app.audit_logs
     WHERE chain_id = 'SYSTEM'
       AND action = 'project.purge'
       AND target_id = ${String(projectId)}
     ORDER BY sequence_no ASC
  `) as unknown as readonly PurgeAuditRow[];
}

describe("ADR-055 保留期到期的项目自动彻底删除", () => {
  it("到期项目被自动彻底删除：逐表清空、PROJECT 链消失、SYSTEM 链留一条 project.purge", async () => {
    const ownerId = await createUser(client.sql);
    const project = await createProject(client.sql, ownerId);
    const projectId = project.projectId;
    await appendProjectChainRecord(projectId, ownerId);
    expect(await projectChainExists(projectId)).toBe(true);

    await softDelete(projectId, ownerId, daysAgo(RETENTION_DAYS + 1));

    const result = await service.run({
      retentionDays: RETENTION_DAYS,
      batchSize: BATCH_SIZE,
    });

    expect(result.purgedProjectIds).toContain(projectId);
    // 项目行、下级数据与它自己的审计链全部物理删除。
    expect(await projectRow(projectId)).toBeNull();
    expect(await countProjectRows("modules", projectId)).toBe(0);
    expect(await countProjectRows("project_members", projectId)).toBe(0);
    expect(await projectChainExists(projectId)).toBe(false);

    const auditRows = await purgeAuditRows(projectId);
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toMatchObject({
      actorType: "SYSTEM",
      actorId: null,
      targetId: String(projectId),
      eventPayload: {
        code: project.code,
        name: `Project ${project.code}`,
        deletedBy: { id: ownerId },
        actorRole: "SYSTEM",
        trigger: PROJECT_AUTO_PURGE_TRIGGER,
        retentionDays: RETENTION_DAYS,
        records: { modules: 1, members: 1 },
      },
    });
    // 审计正文里的删除时刻与行上的 deleted_at 同源（回拨后的时间）。
    expect(Date.parse(auditRows[0]!.eventPayload.deletedAt)).toBeLessThan(
      Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000,
    );
  });

  it("还没到保留期的已删除项目保持原样，不产生任何自动删除审计", async () => {
    const ownerId = await createUser(client.sql);
    const project = await createProject(client.sql, ownerId);
    const projectId = project.projectId;
    await softDelete(projectId, ownerId, daysAgo(RETENTION_DAYS - 1));

    const result = await service.run({
      retentionDays: RETENTION_DAYS,
      batchSize: BATCH_SIZE,
    });

    expect(result.purgedProjectIds).not.toContain(projectId);
    expect(await projectRow(projectId)).not.toBeNull();
    expect(await countProjectRows("modules", projectId)).toBe(1);
    expect(await purgeAuditRows(projectId)).toEqual([]);
  });

  it("还原过就按最后一次删除计时：先删 40 天 -> 还原 -> 再删，仍在保留期内不被删除", async () => {
    const ownerId = await createUser(client.sql);
    const project = await createProject(client.sql, ownerId);
    const projectId = project.projectId;

    // 第一次删除已超过保留期，但还原把它撤销了。
    await softDelete(projectId, ownerId, daysAgo(RETENTION_DAYS + 10));
    await restore(projectId);
    expect((await projectRow(projectId))!.deletedAt).toBeNull();

    // 还原后重新删除：删除时间从头计，30 天保留期重新开始。
    await softDelete(projectId, ownerId, new Date());
    const inRetention = await service.run({
      retentionDays: RETENTION_DAYS,
      batchSize: BATCH_SIZE,
    });
    expect(inRetention.purgedProjectIds).not.toContain(projectId);
    expect(await projectRow(projectId)).not.toBeNull();
    expect(await purgeAuditRows(projectId)).toEqual([]);

    // 再一次还原并按新的删除时间回拨到超过保留期后，才轮到自动删除。
    await restore(projectId);
    await softDelete(projectId, ownerId, daysAgo(RETENTION_DAYS + 1));
    const expired = await service.run({
      retentionDays: RETENTION_DAYS,
      batchSize: BATCH_SIZE,
    });
    expect(expired.purgedProjectIds).toContain(projectId);
    expect(await projectRow(projectId)).toBeNull();
    expect(await purgeAuditRows(projectId)).toHaveLength(1);
  });

  it("没被删除的项目永远不进入候选，复核谓词只认超过保留期的删除", async () => {
    const ownerId = await createUser(client.sql);
    const active = await createProject(client.sql, ownerId);

    const result = await service.run({
      retentionDays: RETENTION_DAYS,
      batchSize: BATCH_SIZE,
    });
    expect(result.purgedProjectIds).not.toContain(active.projectId);

    // 复核谓词：未删除与刚删除都返回 undefined，超过保留期才返回记录。
    const fresh = await createProject(client.sql, ownerId);
    await softDelete(fresh.projectId, ownerId, new Date());
    expect(
      await unitOfWork.run((tx) =>
        projects.findExpiredDeletedProjectForChange(tx, {
          projectId: fresh.projectId,
          retentionDays: RETENTION_DAYS,
        }),
      ),
    ).toBeUndefined();
    expect(
      await unitOfWork.run((tx) =>
        projects.findExpiredDeletedProjectForChange(tx, {
          projectId: active.projectId,
          retentionDays: RETENTION_DAYS,
        }),
      ),
    ).toBeUndefined();

    await restore(fresh.projectId);
    await softDelete(fresh.projectId, ownerId, daysAgo(RETENTION_DAYS + 1));
    const expired = await unitOfWork.run((tx) =>
      projects.findExpiredDeletedProjectForChange(tx, {
        projectId: fresh.projectId,
        retentionDays: RETENTION_DAYS,
      }),
    );
    expect(expired).toMatchObject({
      projectId: fresh.projectId,
      code: fresh.code,
      deletedById: ownerId,
    });

    // 候选列表按保留期筛选，包含刚过期的项目。
    const candidates = await unitOfWork.run((tx) =>
      projects.listAutoPurgeCandidates(tx, {
        retentionDays: RETENTION_DAYS,
        limit: BATCH_SIZE,
      }),
    );
    expect(candidates.map((item) => item.projectId)).toContain(fresh.projectId);
  });
});
