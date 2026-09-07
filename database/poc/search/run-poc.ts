import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import postgres, { type Sql } from "postgres";

import {
  assertGoldenQueryShape,
  GOLDEN_QUERY_VERSION,
  goldenQueries,
  type ProjectKey,
  type GoldenQuerySpec,
  type QueryCategory
} from "./golden-queries.js";
import {
  escapeLikePattern,
  validateSearchQuery,
  type SearchQueryValidation
} from "./normalize.js";
import {
  buildSearchSeed,
  PROJECT_DEFINITIONS,
  type SearchRowSeed
} from "./seed.js";

const TOP_K = 20;
const RECALL_THRESHOLD = 0.9;
const SEED_ROW_COUNT = 1000;
const SEED_SOURCE_STATUS = "POC";

interface SearchRow {
  readonly project_id: number;
  readonly entity_type: string;
  readonly entity_id: number;
  readonly title: string;
  readonly summary: string;
}

interface ProjectIdMap {
  readonly byKey: ReadonlyMap<ProjectKey, number>;
  readonly all: readonly number[];
}

interface QueryRunResult {
  readonly spec: GoldenQuerySpec;
  readonly validation: SearchQueryValidation;
  readonly ranQuery: boolean;
  readonly returnedCount: number;
  readonly targetFound: boolean;
  readonly passed: boolean;
  readonly elapsedMs: number;
}

interface IndexPlanResult {
  readonly queryId: string;
  readonly category: QueryCategory;
  readonly plan: readonly string[];
  readonly ginIndexUsed: boolean;
  readonly defaultPlan: readonly string[];
  readonly defaultPlanUsesGin: boolean;
  readonly plannerHinted: boolean;
}

function runSuffix(): string {
  return `${Date.now().toString(36).toUpperCase()}${randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

function projectCode(prefix: string): string {
  return `${prefix}${Math.abs(
    Number(BigInt(`0x${randomBytes(4).toString("hex")}`))
  ).toString(36).toUpperCase()}`.slice(0, 32);
}

async function seedProjects(
  sql: Sql,
  suffix: string
): Promise<ProjectIdMap> {
  const byKey = new Map<ProjectKey, number>();

  for (const definition of PROJECT_DEFINITIONS) {
    const loginName = `poc_${definition.key}_${suffix}`.toLowerCase();
    const projectId = await sql.begin(async (transaction) => {
      const [user] = await transaction<Array<{ id: number }>>`
        INSERT INTO app.users (login_name, name, password_hash)
        VALUES (
          ${loginName},
          ${`Poc ${definition.name}`},
          ${"$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture-hash"}
        )
        RETURNING id
      `;
      if (user === undefined) {
        throw new Error(`Failed to seed user ${definition.key}`);
      }

      const [project] = await transaction<Array<{ id: number }>>`
        INSERT INTO app.projects (code, name, created_by)
        VALUES (
          ${projectCode(definition.codePrefix)},
          ${definition.name},
          ${user.id}
        )
        RETURNING id
      `;
      if (project === undefined) {
        throw new Error(`Failed to seed project ${definition.key}`);
      }

      await transaction`
        INSERT INTO app.project_members (project_id, user_id)
        VALUES (${project.id}, ${user.id})
      `;
      await transaction`
        INSERT INTO app.modules (
          project_id,
          name,
          kind,
          created_by
        )
        VALUES (${project.id}, '未分类', 'UNCLASSIFIED', ${user.id})
      `;
      return project.id;
    });
    byKey.set(definition.key, projectId);
  }

  return { byKey, all: [...byKey.values()] };
}

async function seedSearchRows(
  sql: Sql,
  rows: readonly SearchRowSeed[],
  projectIds: ProjectIdMap
): Promise<void> {
  await sql.begin(async (transaction) => {
    for (const row of rows) {
      const projectId = projectIds.byKey.get(row.projectKey);
      if (projectId === undefined) {
        throw new Error(`Missing project id for ${row.projectKey}`);
      }
      await transaction`
        INSERT INTO app.search_projection (
          project_id,
          entity_type,
          entity_id,
          title,
          summary,
          raw_text,
          normalized_search_text,
          visibility_scope,
          source_status,
          source_row_version
        )
        VALUES (
          ${projectId},
          ${row.entityType},
          ${row.entityId},
          ${row.title},
          ${row.summary},
          ${row.rawText},
          ${row.normalizedSearchText},
          'MEMBER',
          ${SEED_SOURCE_STATUS},
          1
        )
      `;
    }
  });
}

async function countSeededRows(
  sql: Sql,
  projectIds: ProjectIdMap
): Promise<number> {
  const [row] = await sql<Array<{ count: number }>>`
    SELECT count(*)::INTEGER AS count
      FROM app.search_projection
     WHERE project_id = ANY(${projectIds.all})
       AND source_status = ${SEED_SOURCE_STATUS}
  `;
  if (row === undefined) {
    throw new Error("Seeded row count returned no row");
  }
  return row.count;
}

async function search(
  sql: Sql,
  projectIds: readonly number[],
  rawQuery: string,
  topK = TOP_K
): Promise<{
  readonly rows: readonly SearchRow[];
  readonly validation: SearchQueryValidation;
  readonly ranQuery: boolean;
}> {
  const validation = validateSearchQuery(rawQuery);
  if (!validation.ok || projectIds.length === 0) {
    return { rows: [], validation, ranQuery: false };
  }

  const pattern = escapeLikePattern(validation.normalizedQuery);
  const rows = await sql<SearchRow[]>`
    WITH candidates AS MATERIALIZED (
      SELECT project_id, entity_type, entity_id, title, summary,
             visibility_scope
        FROM app.search_projection
       WHERE normalized_search_text ILIKE '%' || ${pattern} || '%'
             ESCAPE E'\\\\'
    )
    SELECT project_id, entity_type, entity_id, title, summary
      FROM candidates
     WHERE project_id = ANY(${projectIds})
       AND visibility_scope = 'MEMBER'
     ORDER BY project_id ASC, entity_id ASC
     LIMIT ${topK}
  `;
  return { rows, validation, ranQuery: true };
}

async function explainSearch(
  sql: Sql,
  projectIds: readonly number[],
  rawQuery: string,
  mode: "default" | "force-gin"
): Promise<{ readonly plan: readonly string[]; readonly ranQuery: boolean }> {
  const validation = validateSearchQuery(rawQuery);
  if (!validation.ok || projectIds.length === 0) {
    return { plan: [], ranQuery: false };
  }
  const pattern = escapeLikePattern(validation.normalizedQuery);
  const rows = mode === "force-gin"
    ? await sql.begin(async (transaction) => {
        await transaction`SET LOCAL enable_seqscan = off`;
        return transaction<Array<Record<string, string>>>`
          EXPLAIN (ANALYZE, BUFFERS)
          WITH candidates AS MATERIALIZED (
            SELECT project_id, entity_type, entity_id, visibility_scope
              FROM app.search_projection
             WHERE normalized_search_text ILIKE '%' || ${pattern} || '%'
                   ESCAPE E'\\\\'
          )
          SELECT project_id, entity_type, entity_id
            FROM candidates
           WHERE project_id = ANY(${projectIds})
             AND visibility_scope = 'MEMBER'
           ORDER BY project_id ASC, entity_id ASC
           LIMIT ${TOP_K}
        `;
      })
    : await sql<Array<Record<string, string>>>`
        EXPLAIN (ANALYZE, BUFFERS)
        WITH candidates AS MATERIALIZED (
          SELECT project_id, entity_type, entity_id, visibility_scope
            FROM app.search_projection
           WHERE normalized_search_text ILIKE '%' || ${pattern} || '%'
                 ESCAPE E'\\\\'
        )
        SELECT project_id, entity_type, entity_id
          FROM candidates
         WHERE project_id = ANY(${projectIds})
           AND visibility_scope = 'MEMBER'
         ORDER BY project_id ASC, entity_id ASC
         LIMIT ${TOP_K}
      `;
  const plan = rows.map((row) => row["QUERY PLAN"] ?? row.query_plan ?? "");
  return { plan, ranQuery: true };
}

async function runGoldenQuery(
  sql: Sql,
  projectIds: readonly number[],
  spec: GoldenQuerySpec,
  expectedProjectId: number | undefined,
  expectedEntityId: number | undefined,
  expectedEntityType: string | undefined
): Promise<QueryRunResult> {
  const startedAt = performance.now();
  const result = await search(sql, projectIds, spec.query);
  const elapsedMs = Math.round((performance.now() - startedAt) * 1000) / 1000;

  let targetFound = false;
  let passed: boolean;

  if (spec.policy === "normal") {
    targetFound =
      expectedProjectId !== undefined &&
      expectedEntityId !== undefined &&
      expectedEntityType !== undefined &&
      result.rows.some(
        (row) =>
          row.project_id === expectedProjectId &&
          row.entity_id === expectedEntityId &&
          row.entity_type === expectedEntityType
      );
    passed = targetFound;
  } else if (
    spec.policy === "no-result" ||
    spec.policy === "special"
  ) {
    passed = result.ranQuery && result.rows.length === 0;
  } else {
    passed = !result.ranQuery && result.rows.length === 0;
  }

  return {
    spec,
    validation: result.validation,
    ranQuery: result.ranQuery,
    returnedCount: result.rows.length,
    targetFound,
    passed,
    elapsedMs
  };
}

async function runCrossProjectCheck(
  sql: Sql,
  projectIds: ProjectIdMap,
  firstGolden: GoldenQuerySpec
): Promise<{
  readonly passed: boolean;
  readonly query: string;
  readonly returnedCount: number;
}> {
  const targetProjectKey = firstGolden.expectedProjectKey;
  if (targetProjectKey === null) {
    throw new Error("Cross-project check requires an expected golden query");
  }
  const targetProjectId = projectIds.byKey.get(targetProjectKey);
  const otherProjectId = projectIds.all.find(
    (projectId) => projectId !== targetProjectId
  );
  if (targetProjectId === undefined || otherProjectId === undefined) {
    throw new Error("Cross-project check needs at least two projects");
  }

  const result = await search(sql, [otherProjectId], firstGolden.query);
  const emptyScope = await search(sql, [], firstGolden.query);
  return {
    passed:
      result.ranQuery &&
      result.rows.length === 0 &&
      emptyScope.ranQuery === false,
    query: firstGolden.query,
    returnedCount: result.rows.length
  };
}

async function runIndexPlanChecks(
  sql: Sql,
  projectIds: readonly number[]
): Promise<readonly IndexPlanResult[]> {
  const categories: readonly QueryCategory[] = [
    "zh-short",
    "code",
    "english",
    "mixed",
    "punctuation"
  ];
  const results: IndexPlanResult[] = [];
  for (const category of categories) {
    const spec = goldenQueries.find((entry) => entry.category === category);
    if (spec === undefined) {
      throw new Error(`Missing golden query for ${category}`);
    }
    const ginPlan = await explainSearch(
      sql,
      projectIds,
      spec.query,
      "force-gin"
    );
    const defaultPlan = await explainSearch(
      sql,
      projectIds,
      spec.query,
      "default"
    );
    if (!ginPlan.ranQuery || !defaultPlan.ranQuery) {
      throw new Error(`EXPLAIN query was not executed for ${spec.id}`);
    }
    const ginPlanText = ginPlan.plan.join("\n");
    const defaultPlanText = defaultPlan.plan.join("\n");
    const ginIndexUsed =
      ginPlanText.includes("search_projection_normalized_text_trgm_idx") &&
      /(?:Bitmap Index Scan|Index Scan)/u.test(ginPlanText);
    results.push({
      queryId: spec.id,
      category,
      plan: ginPlan.plan,
      ginIndexUsed,
      defaultPlan: defaultPlan.plan,
      defaultPlanUsesGin:
        defaultPlanText.includes(
          "search_projection_normalized_text_trgm_idx"
        ) && /(?:Bitmap Index Scan|Index Scan)/u.test(defaultPlanText),
      plannerHinted: true
    });
  }
  return results;
}

export async function runPoc(): Promise<void> {
  const databaseUrl = process.env.POC_DATABASE_URL?.trim() ??
    process.env.TEST_DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error("Set POC_DATABASE_URL or TEST_DATABASE_URL");
  }

  const normalCaseCount = assertGoldenQueryShape();
  const seed = buildSearchSeed();
  if (seed.rows.length !== SEED_ROW_COUNT) {
    throw new Error(
      `Expected ${SEED_ROW_COUNT} projection rows, got ${seed.rows.length}`
    );
  }

  const sql = postgres(databaseUrl, {
    connection: { application_name: "inpulse-search-poc" },
    max: 4,
    onnotice: () => undefined,
    prepare: false
  });

  const artifactsDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "artifacts"
  );
  await mkdir(artifactsDirectory, { recursive: true });
  const reportPath = resolve(artifactsDirectory, "phase0-report.json");

  try {
    const [versionRow] = await sql<Array<{ version: string }>>`
      SELECT version() AS version
    `;
    if (versionRow === undefined) {
      throw new Error("PostgreSQL version query returned no row");
    }

    const projectIds = await seedProjects(sql, runSuffix());
    await seedSearchRows(sql, seed.rows, projectIds);
    const rowCount = await countSeededRows(sql, projectIds);

    const resultPromises = goldenQueries.map((spec) => {
      const entityId = spec.policy === "normal"
        ? seed.expectedEntityIdsByGoldenId.get(spec.id)
        : undefined;
      const entityType = spec.policy === "normal"
        ? seed.expectedEntityTypesByGoldenId.get(spec.id)
        : undefined;
      const projectKey = spec.policy === "normal"
        ? spec.expectedProjectKey
        : null;
      const expectedProjectId = projectKey === null
        ? undefined
        : projectIds.byKey.get(projectKey);
      return runGoldenQuery(
        sql,
        projectIds.all,
        spec,
        expectedProjectId,
        entityId,
        entityType
      );
    });
    const queryResults = await Promise.all(resultPromises);

    const recallCases = queryResults.filter(
      (result) => result.spec.policy === "normal"
    );
    const hits = recallCases.filter((result) => result.passed).length;
    const recallAt20 = hits / recallCases.length;

    const nonRecallCases = queryResults.filter(
      (result) => result.spec.policy !== "normal"
    );
    const noResultPassed = nonRecallCases.every((result) => result.passed);
    const edgeCases = queryResults.filter(
      (result) => result.spec.policy === "edge"
    );
    const edgePassed = edgeCases.every((result) => result.passed);

    const crossProjectGolden = goldenQueries.find(
      (entry) => entry.policy === "normal" && entry.category === "code"
    );
    if (crossProjectGolden === undefined) {
      throw new Error("No code golden query available");
    }
    const crossProject = await runCrossProjectCheck(
      sql,
      projectIds,
      crossProjectGolden
    );
    const indexPlans = await runIndexPlanChecks(sql, projectIds.all);
    const ginUsableWhenForced = indexPlans.every(
      (result) => result.ginIndexUsed
    );
    const ginDefaultPlanPassed = indexPlans.every(
      (result) => result.defaultPlanUsesGin
    );
    const ginPassed = ginDefaultPlanPassed;

    const passed =
      rowCount >= SEED_ROW_COUNT &&
      recallAt20 >= RECALL_THRESHOLD &&
      noResultPassed &&
      edgePassed &&
      crossProject.passed &&
      ginPassed;

    const report = {
      version: GOLDEN_QUERY_VERSION,
      generatedAt: new Date().toISOString(),
      postgres: {
        version: versionRow.version,
        image: process.env.POC_POSTGRES_IMAGE?.trim() ?? null,
        imageDigest: process.env.POC_POSTGRES_IMAGE_DIGEST?.trim() ?? null
      },
      environment: {
        platform: `${platform()} ${release()}`,
        arch: arch(),
        cpuCount: cpus().length,
        totalMemoryBytes: totalmem()
      },
      dataset: {
        rowCount,
        minimumRows: SEED_ROW_COUNT,
        projectCount: projectIds.all.length,
        seedAlgorithm: "deterministic templates + frozen golden targets",
        normalizedBy: "NFKC + lowercase + whitespace collapse + punctuation map"
      },
      queries: {
        count: goldenQueries.length,
        expectedCount: normalCaseCount,
        topK: TOP_K,
        recallThreshold: RECALL_THRESHOLD,
        recallAt20,
        hits,
        expectedCases: recallCases.map((result) => ({
          id: result.spec.id,
          category: result.spec.category,
          query: result.spec.query,
          returnedCount: result.returnedCount,
          targetFound: result.targetFound,
          passed: result.passed,
          elapsedMs: result.elapsedMs
        })),
        nonExpectedCases: nonRecallCases.map((result) => ({
          id: result.spec.id,
          category: result.spec.category,
          policy: result.spec.policy,
          query: result.spec.query,
          ranQuery: result.ranQuery,
          returnedCount: result.returnedCount,
          passed: result.passed,
          elapsedMs: result.elapsedMs
        }))
      },
      security: {
        crossProject: crossProject,
        sql: [
          "WITH candidates AS MATERIALIZED (",
          "  SELECT ... FROM app.search_projection",
          "  WHERE normalized_search_text ILIKE '%' || escaped_query || '%' ESCAPE E'\\\\'",
          ")",
          "SELECT ... FROM candidates",
          "WHERE project_id = ANY(?) AND visibility_scope = 'MEMBER'",
          "ORDER BY project_id, entity_id LIMIT 20"
        ],
        plannerHintForGinProof: "SET LOCAL enable_seqscan = off"
      },
      indexPlans,
      gates: {
        rowCountPassed: rowCount >= SEED_ROW_COUNT,
        recallPassed: recallAt20 >= RECALL_THRESHOLD,
        noResultPassed,
        edgePassed,
        crossProjectPassed: crossProject.passed,
        ginIndexUsableWhenForced: ginUsableWhenForced,
        ginDefaultPlanPassed,
        ginIndexPassed: ginPassed,
        passed
      }
    };

    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`Search PoC report: ${reportPath}`);
    console.log(`Projection rows: ${rowCount}`);
    console.log(
      `Recall@${TOP_K}: ${(recallAt20 * 100).toFixed(2)}% (${hits}/${recallCases.length})`
    );
    console.log(`No-result cases passed: ${noResultPassed}`);
    console.log(`Edge cases passed: ${edgePassed}`);
    console.log(`Cross-project passed: ${crossProject.passed}`);
    console.log(`GIN index usable when forced: ${ginUsableWhenForced}`);
    console.log(`GIN default plan passed: ${ginDefaultPlanPassed}`);
    console.log(`Overall gate: ${passed ? "PASS" : "FAIL"}`);

    if (!passed) {
      throw new Error(
        "Search phase 0 PoC did not pass one or more required gates"
      );
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

const isCli = process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  await runPoc();
}
