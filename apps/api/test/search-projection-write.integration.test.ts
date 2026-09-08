import { randomInt } from "node:crypto";

import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import {
  PostgresSearchProjectionWritePort,
  SearchProjectionWriteValidationError,
  type SearchProjectionWriteInput,
} from "../src/modules/search/index.js";
import {
  createProject,
  createUser,
  testUrls,
  type ProjectFixture,
} from "./database.helpers.js";

interface SearchProjectionRow {
  readonly title: string;
  readonly summary: string;
  readonly raw_text: string;
  readonly normalized_search_text: string;
  readonly visibility_scope: string;
  readonly source_status: string;
  readonly source_row_version: number;
}

let client: DatabaseClient | undefined;
let fixture: ProjectFixture;
let unitOfWork: PostgresUnitOfWork;
let writer: PostgresSearchProjectionWritePort;

async function createFeatureEntity(): Promise<number> {
  const code = `${fixture.code}-F-${randomInt(1, 2_000_000_000)}`;
  const [feature] = await client!.sql<{ id: number }[]>`
    INSERT INTO app.features (
      project_id,
      module_id,
      code,
      name,
      created_by
    )
    VALUES (
      ${fixture.projectId},
      ${fixture.moduleId},
      ${code},
      'Search projection test feature',
      ${fixture.userId}
    )
    RETURNING id
  `;
  if (!feature) {
    throw new Error("Feature fixture insert returned no row");
  }
  return feature.id;
}

function writeInput(entityId: number): SearchProjectionWriteInput {
  return {
    projectId: fixture.projectId,
    entityType: "FEATURE",
    entityId,
    title: "登录功能",
    summary: "统一认证入口",
    rawText: "登录功能。统一认证入口。InPulse-001",
    visibilityScope: "MEMBER",
    sourceStatus: "ACTIVE",
    sourceRowVersion: 1,
  };
}

async function projectionRow(entityId: number) {
  const rows = await client!.sql<SearchProjectionRow[]>`
    SELECT
      title,
      summary,
      raw_text,
      normalized_search_text,
      visibility_scope,
      source_status,
      source_row_version
    FROM app.search_projection
    WHERE project_id = ${fixture.projectId}
      AND entity_type = 'FEATURE'
      AND entity_id = ${entityId}
  `;
  return rows[0] ?? null;
}

async function projectionCount(entityId: number): Promise<number> {
  const [row] = await client!.sql<{ count: number }[]>`
    SELECT count(*)::INTEGER AS count
    FROM app.search_projection
    WHERE project_id = ${fixture.projectId}
      AND entity_type = 'FEATURE'
      AND entity_id = ${entityId}
  `;
  return row?.count ?? 0;
}

describe("PostgresSearchProjectionWritePort", () => {
  beforeAll(async () => {
    client = createDatabaseClient(testUrls().runtime, {
      applicationName: "inpulse-search-projection-write-test",
    });
    const [role] = await client.sql<{ role: string }[]>`
      SELECT current_user AS role
    `;
    expect(role?.role).toBe("app_runtime");
    const userId = await createUser(client.sql);
    fixture = await createProject(client.sql, userId);
    unitOfWork = new PostgresUnitOfWork(client);
    writer = new PostgresSearchProjectionWritePort();
  });

  afterAll(async () => {
    await client?.close();
  });

  test("normalizes a new projection and upserts the same entity without duplicates", async () => {
    const entityId = await createFeatureEntity();
    const first = {
      ...writeInput(entityId),
      rawText: "ＩｎＰｕｌｓｅ　搜索。ＡＢＣ-１２３",
    };
    await unitOfWork.run((tx) => writer.upsert(tx, first));

    expect(await projectionRow(entityId)).toMatchObject({
      title: "登录功能",
      summary: "统一认证入口",
      raw_text: first.rawText,
      normalized_search_text: "inpulse 搜索.abc-123",
      visibility_scope: "MEMBER",
      source_status: "ACTIVE",
      source_row_version: 1,
    });

    await unitOfWork.run((tx) =>
      writer.upsert(tx, {
        ...first,
        title: "登录与退出",
        summary: "认证生命周期",
        rawText: "登录与退出。认证生命周期。InPulse-002",
        visibilityScope: "ADMIN_ONLY",
        sourceStatus: "VOID",
        sourceRowVersion: 2,
      }),
    );

    expect(await projectionCount(entityId)).toBe(1);
    expect(await projectionRow(entityId)).toMatchObject({
      title: "登录与退出",
      summary: "认证生命周期",
      raw_text: "登录与退出。认证生命周期。InPulse-002",
      normalized_search_text: "登录与退出.认证生命周期.inpulse-002",
      visibility_scope: "ADMIN_ONLY",
      source_status: "VOID",
      source_row_version: 2,
    });
  });

  test("a later caller failure rolls back the projection write", async () => {
    const entityId = await createFeatureEntity();
    const cause = new Error("Injected workflow failure");
    await expect(
      unitOfWork.run(async (tx) => {
        await writer.upsert(tx, writeInput(entityId));
        throw cause;
      }),
    ).rejects.toBe(cause);
    expect(await projectionCount(entityId)).toBe(0);
  });

  test("a stale source row version does not overwrite newer projection state", async () => {
    const entityId = await createFeatureEntity();
    await unitOfWork.run((tx) =>
      writer.upsert(tx, {
        ...writeInput(entityId),
        title: "当前版本",
        visibilityScope: "ADMIN_ONLY",
        sourceStatus: "VOID",
        sourceRowVersion: 3,
      }),
    );
    await unitOfWork.run((tx) =>
      writer.upsert(tx, {
        ...writeInput(entityId),
        title: "过期版本",
        visibilityScope: "MEMBER",
        sourceStatus: "ACTIVE",
        sourceRowVersion: 1,
      }),
    );

    expect(await projectionRow(entityId)).toMatchObject({
      title: "当前版本",
      visibility_scope: "ADMIN_ONLY",
      source_status: "VOID",
      source_row_version: 3,
    });
  });

  test("rejects text that produces an empty normalized value", async () => {
    const entityId = await createFeatureEntity();
    await expect(
      unitOfWork.run((tx) =>
        writer.upsert(tx, {
          ...writeInput(entityId),
          rawText: "   ",
        }),
      ),
    ).rejects.toBeInstanceOf(SearchProjectionWriteValidationError);
    expect(await projectionCount(entityId)).toBe(0);
  });
});
