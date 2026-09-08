import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import { afterAll, beforeAll, expect, test } from "vitest";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import type { TransactionContext } from "../src/database/transaction-context.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import {
  ModulesCommandPort,
  ModulesModule,
} from "../src/modules/modules/index.js";
import { createUser, testUrls } from "./database.helpers.js";

let client: DatabaseClient | undefined;
let context: INestApplicationContext | undefined;
let uow: PostgresUnitOfWork;
let port: ModulesCommandPort;
let creatorId: number;
let memberId: number;

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-modules-command-test",
  });
  expect((await client.sql`SELECT current_user AS role`)[0]?.role).toBe(
    "app_runtime",
  );
  creatorId = await createUser(client.sql);
  memberId = await createUser(client.sql);
  uow = new PostgresUnitOfWork(client);
  context = await NestFactory.createApplicationContext(ModulesModule, {
    logger: false,
  });
  port = context.get(ModulesCommandPort);
});

afterAll(async () => {
  await context?.close();
  await client?.close();
});

// Only the caller fixture writes Projects data; no production Projects implementation is implied.
async function initializeProject(tx: TransactionContext): Promise<number> {
  const code = `M${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`;
  const [project] = await tx.sql<{ id: number }[]>`
    INSERT INTO app.projects (code, name, created_by)
    VALUES (${code}, 'Modules Port fixture', ${creatorId}) RETURNING id
  `;
  if (!project) throw new Error("Project fixture insert returned no row");
  await tx.sql`
    INSERT INTO app.project_members (project_id, user_id)
    VALUES (${project.id}, ${creatorId}), (${project.id}, ${memberId})
  `;
  return project.id;
}

// Always queried outside the completed/rolled-back transaction.
async function counts(projectId: number) {
  const [row] = await client!.sql`
    SELECT
      (SELECT count(*)::int FROM app.projects WHERE id = ${projectId}) AS projects,
      (SELECT count(*)::int FROM app.project_members WHERE project_id = ${projectId}) AS members,
      (SELECT count(*)::int FROM app.modules WHERE project_id = ${projectId}) AS modules
  `;
  return row;
}

test("runtime initializes project, initial members and exactly one unclassified module", async () => {
  const result = await uow.run(async (tx) => {
    const projectId = await initializeProject(tx);
    const module = await port.createUnclassifiedModule(tx, {
      projectId,
      createdBy: creatorId,
    });
    return { projectId, module };
  });
  expect(Object.keys(result.module)).toEqual(["moduleId"]);
  expect(await counts(result.projectId)).toEqual({
    projects: 1,
    members: 2,
    modules: 1,
  });
  const [row] = await client!.sql`
    SELECT m.name, m.kind, m.status, m.description, m.sort_order, m.row_version,
      m.created_by, m.archived_at,
      m.created_at = p.created_at AND m.updated_at = p.created_at AS same_time,
      pm.joined_at = p.created_at AND pm.status = 'ACTIVE' AS initial_creator
    FROM app.modules m JOIN app.projects p ON p.id = m.project_id
    JOIN app.project_members pm ON pm.project_id = p.id AND pm.user_id = p.created_by
    WHERE m.id = ${result.module.moduleId} AND m.project_id = ${result.projectId}
  `;
  expect(row).toEqual({
    name: "未分类模块",
    kind: "UNCLASSIFIED",
    status: "ACTIVE",
    description: "",
    sort_order: 0,
    row_version: 1,
    created_by: creatorId,
    archived_at: null,
    same_time: true,
    initial_creator: true,
  });
});

test("a later caller failure rolls back project, members and module", async () => {
  let projectId = 0;
  const failure = new Error("Injected later workflow failure");
  await expect(
    uow.run(async (tx) => {
      projectId = await initializeProject(tx);
      await port.createUnclassifiedModule(tx, {
        projectId,
        createdBy: creatorId,
      });
      throw failure;
    }),
  ).rejects.toBe(failure);
  expect(projectId).toBeGreaterThan(0);
  expect(await counts(projectId)).toEqual({
    projects: 0,
    members: 0,
    modules: 0,
  });
});

test("duplicate in the same initialization transaction rejects and rolls everything back", async () => {
  let projectId = 0;
  await expect(
    uow.run(async (tx) => {
      projectId = await initializeProject(tx);
      await port.createUnclassifiedModule(tx, {
        projectId,
        createdBy: creatorId,
      });
      await port.createUnclassifiedModule(tx, {
        projectId,
        createdBy: creatorId,
      });
    }),
  ).rejects.toMatchObject({
    code: "UNCLASSIFIED_MODULE_CONFLICT",
    status: 409,
  });
  expect(projectId).toBeGreaterThan(0);
  expect(await counts(projectId)).toEqual({
    projects: 0,
    members: 0,
    modules: 0,
  });
});

test("duplicate against a committed project fails without changing existing data", async () => {
  const projectId = await uow.run(async (tx) => {
    const id = await initializeProject(tx);
    await port.createUnclassifiedModule(tx, {
      projectId: id,
      createdBy: creatorId,
    });
    return id;
  });
  await expect(
    uow.run((tx) =>
      port.createUnclassifiedModule(tx, {
        projectId,
        createdBy: creatorId,
      }),
    ),
  ).rejects.toMatchObject({
    code: "UNCLASSIFIED_MODULE_CONFLICT",
    status: 409,
  });
  expect(await counts(projectId)).toEqual({
    projects: 1,
    members: 2,
    modules: 1,
  });
});

test("a nonexistent project is rejected by the FK and leaves no orphan module", async () => {
  // Reserve a real identity in a rolled-back transaction, avoiding guessed IDs.
  let projectId = 0;
  const failure = new Error("Reserve nonexistent project ID");
  await expect(
    uow.run(async (tx) => {
      projectId = await initializeProject(tx);
      throw failure;
    }),
  ).rejects.toBe(failure);
  await expect(
    uow.run((tx) =>
      port.createUnclassifiedModule(tx, {
        projectId,
        createdBy: creatorId,
      }),
    ),
  ).rejects.toMatchObject({
    code: "23503",
    constraint_name: "modules_project_fk",
  });
  expect(await counts(projectId)).toEqual({
    projects: 0,
    members: 0,
    modules: 0,
  });
});
