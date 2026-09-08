import "reflect-metadata";
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, expect, test } from "vitest";
import type { DatabaseClient } from "@inpulse/database/client";
import { createDatabaseClient } from "@inpulse/database/client";

import { PostgresAuditWritePort } from "../src/audit/postgres-audit-write-port.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import {
  createProject,
  createUser,
  testUrls,
  type ProjectFixture,
} from "./database.helpers.js";

let runtime: DatabaseClient | undefined;
let reader: DatabaseClient | undefined;
let uow: PostgresUnitOfWork | undefined;
let port: PostgresAuditWritePort | undefined;
let userId: number | undefined;
let project: ProjectFixture | undefined;

const auditKey = Buffer.from(
  "integration-only-audit-key-not-a-production-secret",
  "utf8",
);

beforeAll(async () => {
  runtime = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-audit-write-test",
  });
  uow = new PostgresUnitOfWork(runtime);
  port = new PostgresAuditWritePort({
    currentVersion: 1,
    keyFor: () => auditKey,
  });
  userId = await createUser(runtime.sql);
  project = await createProject(runtime.sql, userId);
  reader = createDatabaseClient(testUrls().auditReader, {
    applicationName: "inpulse-audit-write-reader-test",
  });
});

afterAll(async () => {
  await runtime?.close();
  await reader?.close();
});

test("port appends a record into a project audit chain and links prev_hash", async () => {
  const chainId = `PROJECT:${project!.projectId}`;
  const first = await uow!.run((tx) =>
    port!.append(tx, {
      projectId: project!.projectId,
      actorType: "USER",
      actorId: userId!,
      action: "PROJECT_CREATED",
      targetType: "PROJECT",
      targetId: String(project!.projectId),
      eventPayload: { code: project!.code },
      requestId: randomUUID(),
      clientRequestId: null,
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
      occurredAt: new Date(),
    }),
  );
  expect(first.chainId).toBe(chainId);
  expect(first.sequenceNo).toBe(1);
  expect(first.recordHash).toHaveLength(32);

  const second = await uow!.run((tx) =>
    port!.append(tx, {
      projectId: project!.projectId,
      actorType: "USER",
      actorId: userId!,
      action: "PROJECT_EDITED",
      targetType: "PROJECT",
      targetId: String(project!.projectId),
      eventPayload: { field: "name" },
      requestId: randomUUID(),
      clientRequestId: null,
      ipAddress: "127.0.0.1",
      userAgent: "vitest",
      occurredAt: new Date(),
    }),
  );
  expect(second.sequenceNo).toBe(2);

  const rows = (await reader!.sql`
    SELECT sequence_no AS "sequenceNo", prev_hash AS "prevHash",
           record_hash AS "recordHash", action, event_payload AS "eventPayload"
      FROM app.audit_logs
     WHERE chain_id = ${chainId}
     ORDER BY sequence_no
  `) as unknown as readonly {
    sequenceNo: string;
    prevHash: Buffer;
    recordHash: Buffer;
    action: string;
    eventPayload: Record<string, unknown>;
  }[];
  expect(rows).toHaveLength(2);
  expect(rows[0]!.action).toBe("PROJECT_CREATED");
  expect(rows[1]!.action).toBe("PROJECT_EDITED");
  expect(Buffer.from(rows[0]!.prevHash)).toEqual(Buffer.alloc(32));
  expect(Buffer.from(rows[1]!.prevHash)).toEqual(rows[0]!.recordHash);
  expect(rows[0]!.eventPayload["code"]).toBe(project!.code);
  expect(rows[0]!.eventPayload["action"]).toBe("PROJECT_CREATED");

  const [head] = (await reader!.sql`
    SELECT last_sequence AS "lastSequence", last_hash AS "lastHash"
      FROM app.audit_chain_heads
     WHERE chain_id = ${chainId}
  `) as unknown as readonly { lastSequence: string; lastHash: Buffer }[];
  expect(Number(head?.lastSequence)).toBe(2);
  expect(Buffer.from(head?.lastHash ?? [])).toEqual(rows[1]!.recordHash);
});

test("SYSTEM chain is used when projectId is null", async () => {
  const result = await uow!.run((tx) =>
    port!.append(tx, {
      projectId: null,
      actorType: "SYSTEM",
      actorId: null,
      action: "SYSTEM_TEST",
      targetType: "SYSTEM",
      targetId: null,
      eventPayload: { marker: "system" },
      requestId: randomUUID(),
      clientRequestId: null,
      ipAddress: null,
      userAgent: null,
      occurredAt: new Date(),
    }),
  );
  expect(result.chainId).toBe("SYSTEM");
  const rows = (await reader!.sql`
    SELECT count(*)::int AS count
      FROM app.audit_logs
     WHERE chain_id = 'SYSTEM'
  `) as unknown as readonly { count: number }[];
  expect(rows[0]!.count).toBeGreaterThanOrEqual(1);
});
