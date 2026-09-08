import "reflect-metadata";
import { setTimeout } from "node:timers/promises";
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
  ModuleQueryPort,
  ModulesModule,
} from "../src/modules/modules/index.js";
import {
  FeatureQueryPort,
  FeaturesModule,
} from "../src/modules/features/index.js";
import { createProject, createUser, testUrls } from "./database.helpers.js";

let client: DatabaseClient;
let writer: DatabaseClient;
let moduleContext: INestApplicationContext;
let featureContext: INestApplicationContext;
let modules: ModuleQueryPort;
let features: FeatureQueryPort;
let uow: PostgresUnitOfWork;
let userId: number;

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, { maxConnections: 1 });
  writer = createDatabaseClient(testUrls().runtime, { maxConnections: 1 });
  expect((await client.sql`SELECT current_user AS role`)[0]?.role).toBe(
    "app_runtime",
  );
  expect((await writer.sql`SELECT current_user AS role`)[0]?.role).toBe(
    "app_runtime",
  );
  uow = new PostgresUnitOfWork(client);
  userId = await createUser(client.sql);
  moduleContext = await NestFactory.createApplicationContext(ModulesModule, {
    logger: false,
  });
  featureContext = await NestFactory.createApplicationContext(FeaturesModule, {
    logger: false,
  });
  modules = moduleContext.get(ModuleQueryPort);
  features = featureContext.get(FeatureQueryPort);
});

afterAll(async () => {
  await featureContext?.close();
  await moduleContext?.close();
  await writer?.close();
  await client?.close();
});

async function fixture() {
  // Existing helper commits a valid project, creator membership and unclassified module.
  const project = await createProject(client.sql, userId);
  const [module] = await client.sql<{ id: number }[]>`
    INSERT INTO app.modules (project_id, name, created_by)
    VALUES (${project.projectId}, 'Normal fixture', ${userId}) RETURNING id
  `;
  if (!module) throw new Error("Missing module fixture");
  const [feature] = await client.sql<{ id: number }[]>`
    INSERT INTO app.features (project_id, module_id, code, name, created_by)
    VALUES (${project.projectId}, ${module.id}, ${`${project.code}-F-1`}, 'Feature fixture', ${userId}) RETURNING id
  `;
  if (!feature) throw new Error("Missing feature fixture");
  return {
    projectId: project.projectId,
    moduleId: module.id,
    featureId: feature.id,
    otherModuleId: project.moduleId,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;
type Domain = "module" | "feature";
function check(domain: Domain, tx: TransactionContext, input: Fixture) {
  return domain === "module"
    ? modules.checkModuleForWrite(tx, input)
    : features.checkFeatureForWrite(tx, input);
}
function summary(
  domain: Domain,
  f: Fixture,
  status = "ACTIVE",
  rowVersion = 1,
) {
  return {
    projectId: f.projectId,
    moduleId: f.moduleId,
    ...(domain === "feature" ? { featureId: f.featureId } : {}),
    status,
    rowVersion,
  };
}
async function archive(tx: TransactionContext, domain: Domain, f: Fixture) {
  if (domain === "module") {
    await tx.sql`UPDATE app.modules SET status = 'ARCHIVED', archived_at = now(), row_version = row_version + 1 WHERE id = ${f.moduleId}`;
  } else {
    await tx.sql`UPDATE app.features SET status = 'ARCHIVED', archived_at = now(), row_version = row_version + 1 WHERE id = ${f.featureId}`;
  }
}

for (const domain of ["module", "feature"] as const) {
  test(`${domain}: active, archived, absent and wrong ownership have exact public results`, async () => {
    const f = await fixture();
    const otherProject = await createProject(client.sql, userId);
    await uow.run(async (tx) => {
      expect(await check(domain, tx, f)).toEqual({
        kind: "allowed",
        resource: summary(domain, f),
      });
      expect(
        await check(domain, tx, {
          ...f,
          moduleId: domain === "module" ? -1 : f.moduleId,
          featureId: -1,
        }),
      ).toEqual({ kind: "not-found" });
      expect(
        await check(domain, tx, { ...f, projectId: otherProject.projectId }),
      ).toEqual({
        kind: "not-found",
      });
      if (domain === "feature") {
        expect(
          await check(domain, tx, { ...f, moduleId: f.otherModuleId }),
        ).toEqual({ kind: "not-found" });
      }
      await archive(tx, domain, f);
      expect(await check(domain, tx, f)).toEqual({
        kind: "parent-not-active",
        resource: summary(domain, f, "ARCHIVED", 2),
      });
      expect(await check(domain, tx, { ...f, projectId: -1 })).toEqual({
        kind: "not-found",
      });
    });
  });

  for (const end of ["commit", "rollback"] as const) {
    test(`${domain}: FOR SHARE blocks real archive UPDATE until ${end}`, async () => {
      const f = await fixture();
      const rollback = new Error("Release holder by rollback");
      let update: Promise<void> | undefined;
      let updateError: unknown;
      let updated = false;
      try {
        const holding = uow.run(async (tx) => {
          expect((await check(domain, tx, f)).kind).toBe("allowed");
          const [holder] = await tx.sql<
            { pid: number }[]
          >`SELECT pg_backend_pid() AS pid`;
          let announce!: (pid: number) => void;
          const ready = new Promise<number>((resolve) => {
            announce = resolve;
          });
          update = new PostgresUnitOfWork(writer)
            .run(async (other) => {
              await other.sql`SET LOCAL statement_timeout = '10s'`;
              const [session] = await other.sql<
                { pid: number }[]
              >`SELECT pg_backend_pid() AS pid`;
              if (!session) throw new Error("Missing writer PID");
              announce(session.pid);
              await archive(other, domain, f);
              updated = true;
            })
            .catch((error: unknown) => {
              updateError = error;
              announce(-1);
            });
          const writerPid = await ready;
          expect(writerPid).not.toBe(holder?.pid);
          let blocked = false;
          const deadline = Date.now() + 5000;
          while (
            Date.now() < deadline &&
            !blocked &&
            !updated &&
            updateError === undefined
          ) {
            const [row] = await tx.sql<{ blocked: boolean }[]>`
              SELECT ${holder!.pid} = ANY(pg_blocking_pids(${writerPid})) AS blocked
            `;
            blocked = row?.blocked === true;
            if (!blocked) await setTimeout(20);
          }
          expect(updateError).toBeUndefined();
          expect(blocked).toBe(true);
          expect(updated).toBe(false);
          if (end === "rollback") throw rollback;
        });
        if (end === "rollback") await expect(holding).rejects.toBe(rollback);
        else await holding;
      } finally {
        await update;
      }
      expect(updateError).toBeUndefined();
      expect(updated).toBe(true);
      // Independent transaction after both connections finish proves release and persistence.
      expect(await uow.run((tx) => check(domain, tx, f))).toEqual({
        kind: "parent-not-active",
        resource: summary(domain, f, "ARCHIVED", 2),
      });
    });
  }
}
