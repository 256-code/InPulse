import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import postgres, { type Sql } from "postgres";

import {
  goldenQueries,
  GOLDEN_QUERY_VERSION,
  type ProjectKey,
  type QueryCategory,
} from "../search/golden-queries.js";
import {
  escapeLikePattern,
  normalizeSearchText,
  validateSearchQuery,
  type SearchQueryValidation,
} from "../search/normalize.js";
import { buildSearchSeed, PROJECT_DEFINITIONS } from "../search/seed.js";

const TOP_K = 20;
const RECALL_THRESHOLD = 0.9;
const BASE_ROW_COUNT = 1000;
const SCALE_ROW_COUNT = 101000;
const PROJECT_IDS: readonly number[] = [1, 2, 3, 4, 5, 6];
const BASE_TABLE = "app.pgroonga_poc_projection";
const SCALE_TABLE = "app.pgroonga_poc_scale";
const PROBE_TABLE = "app.pgroonga_poc_requirement_probe";

type Opclass = "default" | "regexp" | "bigram" | "ngram";
type QueryStyle = "like" | "ilike" | "query" | "regex";

interface V1RequirementCaseSpec {
  readonly id: string;
  readonly query: string;
  readonly title: string;
  readonly summary: string;
  readonly entityId: number;
}

const V1_REQUIREMENT_CASES: readonly V1RequirementCaseSpec[] = [
  {
    id: "english-mfa",
    query: "mfa",
    title: "MFA complete abbreviation probe",
    summary: "MFA reauthentication complete abbreviation",
    entityId: 9_000_001,
  },
  {
    id: "english-csrf",
    query: "csrf",
    title: "CSRF complete abbreviation probe",
    summary: "CSRF token complete abbreviation",
    entityId: 9_000_002,
  },
  {
    id: "english-api",
    query: "api",
    title: "API complete abbreviation probe",
    summary: "API v1 complete abbreviation",
    entityId: 9_000_003,
  },
  {
    id: "chinese-login",
    query: "登录",
    title: "登录模块完整短词",
    summary: "登录完整短词检索",
    entityId: 9_000_004,
  },
  {
    id: "code-inp-full",
    query: "INP-T-2026-0001",
    title: "INP-T-2026-0001 complete identifier",
    summary: "task complete code identifier",
    entityId: 9_000_005,
  },
  {
    id: "code-pr-full",
    query: "PR-42",
    title: "PR-42 complete identifier",
    summary: "pull request complete code identifier",
    entityId: 9_000_006,
  },
  {
    id: "code-session-full",
    query: "SESSION-TOKEN-01",
    title: "SESSION-TOKEN-01 complete identifier",
    summary: "session token complete code identifier",
    entityId: 9_000_007,
  },
  {
    id: "number-2026",
    query: "2026",
    title: "INP-T-2026-0001 number search",
    summary: "number search 2026",
    entityId: 9_000_008,
  },
  {
    id: "number-42",
    query: "42",
    title: "PR-42 number search",
    summary: "number search 42",
    entityId: 9_000_009,
  },
  {
    id: "english-payment-callback",
    query: "payment_callback",
    title: "payment_callback complete code identifier",
    summary: "payment callback endpoint complete identifier",
    entityId: 9_000_010,
  },
  {
    id: "english-task-group-id",
    query: "task_group_id",
    title: "task_group_id complete code identifier",
    summary: "task group id complete identifier",
    entityId: 9_000_011,
  },
  {
    id: "code-r-42",
    query: "R-42",
    title: "R-42 complete code identifier",
    summary: "requirement R-42 complete identifier",
    entityId: 9_000_012,
  },
  {
    id: "code-pr-245",
    query: "PR-245",
    title: "PR-245 complete code identifier",
    summary: "pull request PR-245 complete identifier",
    entityId: 9_000_013,
  },
  {
    id: "chinese-refund",
    query: "退款",
    title: "退款处理完整短词",
    summary: "退款处理完整短词检索",
    entityId: 9_000_014,
  },
  {
    id: "chinese-callback",
    query: "回调",
    title: "支付回调完整短词",
    summary: "支付回调完整短词检索",
    entityId: 9_000_015,
  },
];

interface SearchRow {
  readonly project_id: number;
  readonly entity_type: string;
  readonly entity_id: number;
  readonly title: string;
  readonly summary: string;
}

interface SeedRowInput {
  readonly projectId: number;
  readonly entityType: string;
  readonly entityId: number;
  readonly title: string;
  readonly summary: string;
  readonly rawText: string;
  readonly normalizedSearchText: string;
  readonly visibilityScope: string;
  readonly sourceStatus: string;
  readonly sourceRowVersion: number;
}

interface Strategy {
  readonly id: string;
  readonly opclass: Opclass;
  readonly queryStyle: QueryStyle;
  readonly label: string;
}

const STRATEGIES: readonly Strategy[] = [
  {
    id: "default-ilike",
    opclass: "default",
    queryStyle: "ilike",
    label: "默认全文 + ILIKE",
  },
  {
    id: "default-like",
    opclass: "default",
    queryStyle: "like",
    label: "默认全文 + LIKE",
  },
  {
    id: "default-query",
    opclass: "default",
    queryStyle: "query",
    label: "默认全文 + &@~ + pgroonga_query_escape",
  },
  {
    id: "regexp-ilike",
    opclass: "regexp",
    queryStyle: "ilike",
    label: "正则 opclass + ILIKE",
  },
  {
    id: "regexp-like",
    opclass: "regexp",
    queryStyle: "like",
    label: "正则 opclass + LIKE",
  },
  {
    id: "regexp-query",
    opclass: "regexp",
    queryStyle: "regex",
    label: "正则 opclass + &~",
  },
  {
    id: "bigram-ilike",
    opclass: "bigram",
    queryStyle: "ilike",
    label: "TokenBigramSplitSymbolAlphaDigit + ILIKE",
  },
  {
    id: "bigram-query",
    opclass: "bigram",
    queryStyle: "query",
    label: "TokenBigramSplitSymbolAlphaDigit + &@~",
  },
  {
    id: "ngram-ilike",
    opclass: "ngram",
    queryStyle: "ilike",
    label: "TokenNgram(unify=false) + ILIKE",
  },
  {
    id: "ngram-query",
    opclass: "ngram",
    queryStyle: "query",
    label: "TokenNgram(unify=false) + &@~",
  },
];

interface SearchResult {
  readonly rows: readonly SearchRow[];
  readonly validation: SearchQueryValidation;
  readonly ranQuery: boolean;
  readonly elapsedMs: number;
  readonly error: string | null;
}

interface SuiteResult {
  readonly recallAt20: number;
  readonly hits: number;
  readonly totalNormal: number;
  readonly missed: readonly string[];
  readonly nonNormalTotal: number;
  readonly nonNormalPassed: number;
  readonly nonNormalFailed: readonly string[];
  readonly crossProjectPassed: boolean;
  readonly crossProjectReturnedCount: number;
  readonly averageQueryMs: number;
  readonly maxQueryMs: number;
}

interface RequirementProbeResult {
  readonly allPassed: boolean;
  readonly cases: readonly RequirementProbeCaseResult[];
}

interface RequirementProbeCaseResult {
  readonly id: string;
  readonly query: string;
  readonly expectedText: string;
  readonly forcedIndex: boolean;
  readonly usedIndex: boolean;
  readonly scanType: string;
  readonly passed: boolean;
  readonly returnedCount: number;
  readonly returnedTitles: readonly string[];
  readonly elapsedMs: number;
  readonly error: string | null;
}

interface PlanResult {
  readonly queryId: string;
  readonly category: QueryCategory;
  readonly defaultPlan: readonly string[];
  readonly forcedPlan: readonly string[];
  readonly defaultUsesIndex: boolean;
  readonly forcedUsesIndex: boolean;
  readonly defaultScanType: string;
  readonly forcedScanType: string;
  readonly defaultRecheck: boolean;
  readonly forcedRecheck: boolean;
}

interface IndexMetrics {
  readonly indexName: string;
  readonly buildMs: number;
  readonly indexBytes: number;
  readonly totalBytes: number;
  readonly indexDiskUsage: number | null;
  readonly lexiconName: string | null;
  readonly rowCount: number;
}

interface RuntimePermissionResult {
  readonly runtimeRole: string;
  readonly canSelect: boolean;
  readonly canUseOperator: boolean;
  readonly canEscape: boolean;
  readonly unescapedRegexDenied: boolean;
  readonly errors: readonly string[];
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error("Set " + name);
  }
  return value;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function parseGroongaPayload(
  value: string | undefined,
): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (Array.isArray(parsed)) {
      return (parsed[1] as Record<string, unknown> | null) ?? null;
    }
    return (parsed as Record<string, unknown> | null) ?? null;
  } catch {
    return null;
  }
}

async function readGroongaIndexMetrics(
  sql: Sql,
  indexName: string,
): Promise<{
  readonly indexDiskUsage: number | null;
  readonly lexiconName: string | null;
}> {
  const qualifiedIndexName = "app." + indexName;
  const lexiconRows = await sql.unsafe<Array<{ lexicon_name: string | null }>>(
    "SELECT app.pgroonga_index_column_name($1::cstring, $2) AS lexicon_name",
    [qualifiedIndexName, "normalized_search_text"],
  );
  const lexiconName = lexiconRows[0]?.lexicon_name ?? null;
  if (lexiconName === null) {
    return { indexDiskUsage: null, lexiconName: null };
  }
  const inspectRows = await sql.unsafe<Array<{ payload: string }>>(
    "SELECT app.pgroonga_command('object_inspect', ARRAY['name', $1]) AS payload",
    [lexiconName],
  );
  const payload = parseGroongaPayload(inspectRows[0]?.payload);
  const diskUsage =
    typeof payload?.disk_usage === "number" ? Number(payload.disk_usage) : null;
  return { indexDiskUsage: diskUsage, lexiconName };
}

function projectIdByKey(): ReadonlyMap<ProjectKey, number> {
  const result = new Map<ProjectKey, number>();
  for (const [index, key] of PROJECT_DEFINITIONS.entries()) {
    result.set(key.key, index + 1);
  }
  return result;
}

function seedRowsWithProjects(): readonly SeedRowInput[] {
  const seed = buildSearchSeed();
  const ids = projectIdByKey();
  return seed.rows.map((row) => {
    const projectId = ids.get(row.projectKey);
    if (projectId === undefined) {
      throw new Error("Missing project id for " + row.projectKey);
    }
    return {
      projectId,
      entityType: row.entityType,
      entityId: row.entityId,
      title: row.title,
      summary: row.summary,
      rawText: row.rawText,
      normalizedSearchText: row.normalizedSearchText,
      visibilityScope: "MEMBER",
      sourceStatus: "POC",
      sourceRowVersion: 1,
    };
  });
}

function scaleRowsWithProjects(): readonly SeedRowInput[] {
  const templates = [
    ["网关超时重试", "链路质量与稳定性验证"],
    ["缓存失效排查", "热点访问与命中率观察"],
    ["索引优化演练", "查询计划与缓冲区观察"],
    ["告警收敛策略", "通知频率与抑制窗口"],
    ["代码扫描门禁", "扫描结果与阻断规则"],
    ["巡检报告汇总", "检查项与风险汇总"],
  ] as const;
  const entityTypes = ["TASK", "FEATURE", "MODULE", "CHANGE_RECORD"] as const;
  const extraCount = SCALE_ROW_COUNT - BASE_ROW_COUNT;
  const rows: SeedRowInput[] = [];
  for (let index = 0; index < extraCount; index += 1) {
    const entityId = 1_000_000 + index + 1;
    const projectId = (index % PROJECT_IDS.length) + 1;
    const template = templates[index % templates.length]!;
    const entityType = entityTypes[index % entityTypes.length]!;
    const title = template[0] + "-SCALE-" + String(entityId).padStart(7, "0");
    const summary =
      template[1] + "，编号 SCALE-" + String(entityId).padStart(7, "0");
    const rawText = title + "。" + summary + "。阶段0仿真数据。";
    rows.push({
      projectId,
      entityType,
      entityId,
      title,
      summary,
      rawText,
      normalizedSearchText: normalizeSearchText(rawText),
      visibilityScope: index % 10 === 0 ? "HIDDEN" : "MEMBER",
      sourceStatus: "POC_SCALE",
      sourceRowVersion: 1,
    });
  }
  return rows;
}

function requirementProbeRows(): readonly SeedRowInput[] {
  return V1_REQUIREMENT_CASES.map((probe) => {
    const rawText = `${probe.title}。${probe.summary}。阶段0仿真数据。`;
    return {
      projectId: 1,
      entityType: "PROJECT",
      entityId: probe.entityId,
      title: probe.title,
      summary: probe.summary,
      rawText,
      normalizedSearchText: normalizeSearchText(rawText),
      visibilityScope: "MEMBER",
      sourceStatus: "V1_REQUIREMENT_PROBE",
      sourceRowVersion: 1,
    };
  });
}

async function tableCount(sql: Sql, table: string): Promise<number> {
  const rows = await sql.unsafe<Array<{ count: number }>>(
    "SELECT count(*)::int AS count FROM " + table,
  );
  return rows[0]?.count ?? -1;
}

async function insertRows(
  sql: Sql,
  table: string,
  rows: readonly SeedRowInput[],
): Promise<void> {
  const chunkSize = 5000;
  const sqlText =
    "INSERT INTO " +
    table +
    " (" +
    "project_id, entity_type, entity_id, title, summary, raw_text, " +
    "normalized_search_text, visibility_scope, source_status, source_row_version" +
    ") SELECT * FROM unnest(" +
    "$1::int[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[], " +
    "$7::text[], $8::text[], $9::text[], $10::int[]" +
    ") AS t(project_id, entity_type, entity_id, title, summary, raw_text, " +
    "normalized_search_text, visibility_scope, source_status, source_row_version)";
  for (let offset = 0; offset < rows.length; offset += chunkSize) {
    const chunk = rows.slice(offset, offset + chunkSize);
    await sql.unsafe(sqlText, [
      chunk.map((row) => row.projectId),
      chunk.map((row) => row.entityType),
      chunk.map((row) => row.entityId),
      chunk.map((row) => row.title),
      chunk.map((row) => row.summary),
      chunk.map((row) => row.rawText),
      chunk.map((row) => row.normalizedSearchText),
      chunk.map((row) => row.visibilityScope),
      chunk.map((row) => row.sourceStatus),
      chunk.map((row) => row.sourceRowVersion),
    ]);
  }
}

async function setupTables(sql: Sql): Promise<void> {
  await sql.unsafe("SET ROLE app_owner");
  try {
    await sql.unsafe("DROP TABLE IF EXISTS " + BASE_TABLE + " CASCADE");
    await sql.unsafe("DROP TABLE IF EXISTS " + SCALE_TABLE + " CASCADE");
    await sql.unsafe("DROP TABLE IF EXISTS " + PROBE_TABLE + " CASCADE");
    const ddl =
      "id bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL, project_id integer NOT NULL, entity_type text NOT NULL, " +
      "entity_id integer NOT NULL, title text NOT NULL, summary text NOT NULL, " +
      "raw_text text NOT NULL, normalized_search_text text NOT NULL, " +
      "visibility_scope text NOT NULL DEFAULT 'MEMBER', source_status text NOT NULL, " +
      "source_row_version integer NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), " +
      "CONSTRAINT pgroonga_poc_title_check CHECK (length(btrim(title)) >= 1 AND length(title) <= 500), " +
      "CONSTRAINT pgroonga_poc_summary_check CHECK (length(summary) <= 5000), " +
      "CONSTRAINT pgroonga_poc_normalized_check CHECK (length(normalized_search_text) >= 1)";
    await sql.unsafe("CREATE TABLE " + BASE_TABLE + " (" + ddl + ")");
    await sql.unsafe("CREATE TABLE " + SCALE_TABLE + " (" + ddl + ")");
    await sql.unsafe(
      "ALTER TABLE " +
        BASE_TABLE +
        " ADD CONSTRAINT pgroonga_poc_base_entity_unique UNIQUE (project_id, entity_type, entity_id)",
    );
    await sql.unsafe(
      "ALTER TABLE " +
        SCALE_TABLE +
        " ADD CONSTRAINT pgroonga_poc_scale_entity_unique UNIQUE (project_id, entity_type, entity_id)",
    );
    await sql.unsafe("CREATE TABLE " + PROBE_TABLE + " (" + ddl + ")");
    await sql.unsafe(
      "ALTER TABLE " +
        PROBE_TABLE +
        " ADD CONSTRAINT pgroonga_poc_probe_entity_unique UNIQUE (project_id, entity_type, entity_id)",
    );
    await sql.unsafe(
      "GRANT SELECT ON " +
        BASE_TABLE +
        ", " +
        SCALE_TABLE +
        ", " +
        PROBE_TABLE +
        " TO app_runtime",
    );
  } finally {
    await sql.unsafe("RESET ROLE");
  }
}

function indexNameFor(strategy: Strategy, table: string): string {
  const suffix =
    table === BASE_TABLE ? "base" : table === PROBE_TABLE ? "probe" : "scale";
  return "pgroonga_poc_" + strategy.id + "_" + suffix + "_idx";
}

function indexDdl(strategy: Strategy, table: string): string {
  const indexName = indexNameFor(strategy, table);
  if (strategy.opclass === "regexp") {
    return (
      "CREATE INDEX " +
      '"' +
      indexName +
      '"' +
      " ON " +
      table +
      " USING pgroonga (normalized_search_text app.pgroonga_text_regexp_ops_v2)"
    );
  }
  let options = "";
  if (strategy.opclass === "bigram") {
    options = " WITH (tokenizer='TokenBigramSplitSymbolAlphaDigit')";
  } else if (strategy.opclass === "ngram") {
    options =
      ' WITH (tokenizer=\'TokenNgram("unify_alphabet", false, "unify_symbol", false, "unify_digit", false)\')';
  }
  return (
    "CREATE INDEX " +
    '"' +
    indexName +
    '"' +
    " ON " +
    table +
    " USING pgroonga (normalized_search_text)" +
    options
  );
}

async function createIndexAndMeasure(
  sql: Sql,
  table: string,
  strategy: Strategy,
): Promise<IndexMetrics> {
  const indexName = indexNameFor(strategy, table);
  const measured = await (async () => {
    await sql.unsafe("SET ROLE app_owner");
    try {
      await sql.unsafe("DROP INDEX IF EXISTS " + '"app"."' + indexName + '"');
      const startedAt = performance.now();
      await sql.unsafe(indexDdl(strategy, table));
      const buildMs = Math.round((performance.now() - startedAt) * 1000) / 1000;
      const sizeName = '"app"."' + indexName + '"';
      const sizes = await sql.unsafe<
        Array<{ index_bytes: number; total_bytes: number }>
      >(
        "SELECT pg_relation_size($1::regclass)::bigint AS index_bytes, " +
          "pg_total_relation_size($1::regclass)::bigint AS total_bytes",
        [sizeName],
      );
      return {
        buildMs,
        indexBytes: Number(sizes[0]?.index_bytes ?? 0),
        totalBytes: Number(sizes[0]?.total_bytes ?? 0),
        rowCount: await tableCount(sql, table),
      };
    } finally {
      await sql.unsafe("RESET ROLE");
    }
  })();

  const groongaMetrics = await readGroongaIndexMetrics(sql, indexName);
  return {
    indexName,
    ...measured,
    indexDiskUsage: groongaMetrics.indexDiskUsage,
    lexiconName: groongaMetrics.lexiconName,
  };
}

async function dropIndex(
  sql: Sql,
  table: string,
  strategy: Strategy,
): Promise<void> {
  const indexName = indexNameFor(strategy, table);
  await sql.unsafe("SET ROLE app_owner");
  try {
    await sql.unsafe("DROP INDEX IF EXISTS " + '"app"."' + indexName + '"');
  } finally {
    await sql.unsafe("RESET ROLE");
  }
}

async function measureUpdate(
  sql: Sql,
  table: string,
  indexName: string,
): Promise<number> {
  const target = await sql.unsafe<Array<{ id: number }>>(
    "SELECT id FROM " +
      table +
      " WHERE visibility_scope = 'MEMBER' ORDER BY id LIMIT 1",
  );
  if (target[0] === undefined) {
    return -1;
  }
  const startedAt = performance.now();
  await sql.unsafe(
    "UPDATE " +
      table +
      " SET normalized_search_text = normalized_search_text || ' pgroonga-update-probe" +
      indexName +
      "' WHERE id = $1",
    [target[0].id],
  );
  return Math.round((performance.now() - startedAt) * 1000) / 1000;
}

async function measureReindex(sql: Sql, indexName: string): Promise<number> {
  const startedAt = performance.now();
  await sql.unsafe("REINDEX INDEX " + '"app"."' + indexName + '"');
  return Math.round((performance.now() - startedAt) * 1000) / 1000;
}

function predicateSql(strategy: Strategy): {
  sqlText: string;
  params: (query: string) => Array<string>;
} {
  switch (strategy.queryStyle) {
    case "like":
      return {
        sqlText: "normalized_search_text LIKE '%' || $1 || '%' ESCAPE E'\\\\'",
        params: (query) => [escapeLikePattern(query)],
      };
    case "ilike":
      return {
        sqlText: "normalized_search_text ILIKE '%' || $1 || '%' ESCAPE E'\\\\'",
        params: (query) => [escapeLikePattern(query)],
      };
    case "query":
      return {
        sqlText: "normalized_search_text &@~ app.pgroonga_query_escape($1)",
        params: (query) => [query],
      };
    case "regex":
      return {
        sqlText: "normalized_search_text &~ $1",
        params: (query) => [query],
      };
  }
  throw new Error("Unsupported query style: " + strategy.queryStyle);
}

async function executeSearch(
  sql: Sql,
  table: string,
  strategy: Strategy,
  rawQuery: string,
  projectIds: readonly number[],
): Promise<SearchResult> {
  const validation = validateSearchQuery(rawQuery);
  if (!validation.ok || projectIds.length === 0) {
    return { rows: [], validation, ranQuery: false, elapsedMs: 0, error: null };
  }
  const predicate = predicateSql(strategy);
  const predicateParams = predicate.params(validation.normalizedQuery);
  const sqlText =
    "SELECT project_id, entity_type, entity_id, title, summary FROM " +
    table +
    " WHERE " +
    predicate.sqlText +
    " AND project_id = ANY($2::int[]) AND visibility_scope = 'MEMBER'" +
    " ORDER BY project_id ASC, entity_id ASC LIMIT $3";
  const startedAt = performance.now();
  try {
    const rows = await sql.unsafe<SearchRow[]>(sqlText, [
      ...predicateParams,
      [...projectIds],
      TOP_K,
    ]);
    return {
      rows,
      validation,
      ranQuery: true,
      elapsedMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
      error: null,
    };
  } catch (error) {
    return {
      rows: [],
      validation,
      ranQuery: true,
      elapsedMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
      error: formatError(error),
    };
  }
}

async function runRequirementProbe(
  sql: Sql,
  table: string,
  strategy: Strategy,
): Promise<RequirementProbeResult> {
  const cases: RequirementProbeCaseResult[] = [];
  for (const probe of V1_REQUIREMENT_CASES) {
    cases.push(await runRequirementProbeCase(sql, table, strategy, probe));
  }
  return {
    allPassed:
      cases.length > 0 &&
      cases.every(
        (result) => result.error === null && result.passed && result.usedIndex,
      ),
    cases,
  };
}

async function runRequirementProbeCase(
  sql: Sql,
  table: string,
  strategy: Strategy,
  probe: V1RequirementCaseSpec,
): Promise<RequirementProbeCaseResult> {
  const validation = validateSearchQuery(probe.query);
  const predicate = predicateSql(strategy);
  const predicateParams = predicate.params(validation.normalizedQuery);
  const startedAt = performance.now();
  try {
    const outcome = await sql.begin(async (transaction) => {
      await transaction.unsafe("SET LOCAL enable_seqscan = off");
      const params = [...predicateParams, [...PROJECT_IDS], TOP_K];
      const sqlText =
        "SELECT project_id, entity_type, entity_id, title, summary FROM " +
        table +
        " WHERE " +
        predicate.sqlText +
        " AND project_id = ANY($2::int[]) AND visibility_scope = 'MEMBER'" +
        " ORDER BY project_id ASC, entity_id ASC LIMIT $3";
      const planRows = await transaction.unsafe<Array<Record<string, string>>>(
        "EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) " + sqlText,
        params,
      );
      const rows = await transaction.unsafe<SearchRow[]>(sqlText, params);
      const plan = planRows
        .map(
          (row) => row["QUERY PLAN"] ?? row.query_plan ?? JSON.stringify(row),
        )
        .join("\n");
      const usesIndex =
        plan.includes(indexNameFor(strategy, table)) &&
        /Index Scan|Bitmap/.test(plan);
      const scanType = plan.includes("Seq Scan")
        ? "seq-scan"
        : plan.includes("Bitmap Heap Scan")
          ? "bitmap-heap-scan"
          : plan.includes("Index Scan")
            ? "index-scan"
            : "unknown";
      return { rows, usesIndex, scanType };
    });
    return {
      id: probe.id,
      query: probe.query,
      expectedText: probe.title,
      forcedIndex: true,
      usedIndex: outcome.usesIndex,
      scanType: outcome.scanType,
      passed: outcome.rows.length > 0,
      returnedCount: outcome.rows.length,
      returnedTitles: outcome.rows.map((row) => row.title),
      elapsedMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
      error: null,
    };
  } catch (error) {
    return {
      id: probe.id,
      query: probe.query,
      expectedText: probe.title,
      forcedIndex: true,
      usedIndex: false,
      scanType: "unknown",
      passed: false,
      returnedCount: 0,
      returnedTitles: [],
      elapsedMs: Math.round((performance.now() - startedAt) * 1000) / 1000,
      error: formatError(error),
    };
  }
}

function expectedProjectId(
  spec: (typeof goldenQueries)[number],
  ids: ReadonlyMap<ProjectKey, number>,
): number | undefined {
  if (spec.expectedProjectKey === null) {
    return undefined;
  }
  return ids.get(spec.expectedProjectKey);
}

async function runSuite(
  sql: Sql,
  table: string,
  strategy: Strategy,
  projectIds: readonly number[],
  seed: ReturnType<typeof buildSearchSeed>,
): Promise<SuiteResult> {
  const ids = projectIdByKey();
  const normalResults: Array<{
    spec: (typeof goldenQueries)[number];
    result: SearchResult;
  }> = [];
  const nonNormalResults: Array<{
    spec: (typeof goldenQueries)[number];
    result: SearchResult;
  }> = [];

  for (const spec of goldenQueries) {
    const result = await executeSearch(
      sql,
      table,
      strategy,
      spec.query,
      projectIds,
    );
    if (spec.policy === "normal") {
      normalResults.push({ spec, result });
    } else {
      nonNormalResults.push({ spec, result });
    }
  }

  let hits = 0;
  const missed: string[] = [];
  let totalElapsed = 0;
  let maxElapsed = 0;
  for (const { spec, result } of normalResults) {
    totalElapsed += result.elapsedMs;
    maxElapsed = Math.max(maxElapsed, result.elapsedMs);
    const expectedEntityId = seed.expectedEntityIdsByGoldenId.get(spec.id);
    const expectedEntityType = seed.expectedEntityTypesByGoldenId.get(spec.id);
    const expectedPid = expectedProjectId(spec, ids);
    const found =
      result.error === null &&
      expectedPid !== undefined &&
      expectedEntityId !== undefined &&
      expectedEntityType !== undefined &&
      result.rows.some(
        (row) =>
          row.project_id === expectedPid &&
          row.entity_id === expectedEntityId &&
          row.entity_type === expectedEntityType,
      );
    if (found) {
      hits += 1;
    } else {
      missed.push(
        spec.id +
          ":" +
          spec.query +
          (result.error === null ? "" : ":" + result.error),
      );
    }
  }

  let nonNormalPassed = 0;
  const nonNormalFailed: string[] = [];
  for (const { spec, result } of nonNormalResults) {
    const shouldRun = spec.policy === "no-result" || spec.policy === "special";
    const passed =
      result.error === null &&
      (shouldRun
        ? result.ranQuery && result.rows.length === 0
        : !result.ranQuery && result.rows.length === 0);
    if (passed) {
      nonNormalPassed += 1;
    } else {
      nonNormalFailed.push(
        spec.id +
          ":" +
          spec.query +
          (result.error === null ? "" : ":" + result.error),
      );
    }
  }

  const crossSpec = goldenQueries.find(
    (spec) => spec.policy === "normal" && spec.category === "code",
  );
  let crossProjectPassed = false;
  let crossProjectReturnedCount = 0;
  if (crossSpec !== undefined) {
    const targetPid = expectedProjectId(crossSpec, ids);
    const otherPid = projectIds.find((pid) => pid !== targetPid) ?? 1;
    const crossResult = await executeSearch(
      sql,
      table,
      strategy,
      crossSpec.query,
      [otherPid],
    );
    crossProjectPassed =
      crossResult.error === null &&
      crossResult.ranQuery &&
      crossResult.rows.length === 0;
    crossProjectReturnedCount = crossResult.rows.length;
  }

  return {
    recallAt20: normalResults.length === 0 ? 0 : hits / normalResults.length,
    hits,
    totalNormal: normalResults.length,
    missed,
    nonNormalTotal: nonNormalResults.length,
    nonNormalPassed,
    nonNormalFailed,
    crossProjectPassed,
    crossProjectReturnedCount,
    averageQueryMs:
      normalResults.length === 0
        ? 0
        : Math.round((totalElapsed / normalResults.length) * 1000) / 1000,
    maxQueryMs: maxElapsed,
  };
}

async function explainSearch(
  sql: Sql,
  table: string,
  strategy: Strategy,
  query: string,
  projectIds: readonly number[],
  forceIndex: boolean,
): Promise<PlanResult> {
  const validation = validateSearchQuery(query);
  if (!validation.ok) {
    throw new Error("Invalid plan query: " + query);
  }
  const predicate = predicateSql(strategy);
  const predicateParams = predicate.params(validation.normalizedQuery);
  const sqlText =
    "EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) " +
    "WITH candidates AS MATERIALIZED (" +
    "SELECT project_id, entity_type, entity_id, visibility_scope FROM " +
    table +
    " WHERE " +
    predicate.sqlText +
    ") SELECT project_id, entity_type, entity_id FROM candidates" +
    " WHERE project_id = ANY($2::int[]) AND visibility_scope = 'MEMBER'" +
    " ORDER BY project_id ASC, entity_id ASC LIMIT $3";
  const params = [...predicateParams, [...projectIds], TOP_K];
  const planRows = await sql.begin(async (transaction) => {
    if (forceIndex) {
      await transaction.unsafe("SET LOCAL enable_seqscan = off");
    }
    return transaction.unsafe<Array<Record<string, string>>>(sqlText, params);
  });
  const plan = planRows.map(
    (row) => row["QUERY PLAN"] ?? row.query_plan ?? JSON.stringify(row),
  );
  const text = plan.join("\n");
  const usesIndex =
    text.includes(indexNameFor(strategy, table)) &&
    /Index Scan|Bitmap/.test(text);
  const scanType = text.includes("Seq Scan")
    ? "seq-scan"
    : text.includes("Bitmap Heap Scan")
      ? "bitmap-heap-scan"
      : text.includes("Index Scan")
        ? "index-scan"
        : "unknown";
  return {
    queryId: "plan",
    category: "zh-short",
    defaultPlan: forceIndex ? [] : plan,
    forcedPlan: forceIndex ? plan : [],
    defaultUsesIndex: !forceIndex && usesIndex,
    forcedUsesIndex: forceIndex && usesIndex,
    defaultScanType: forceIndex ? "n/a" : scanType,
    forcedScanType: forceIndex ? scanType : "n/a",
    defaultRecheck: !forceIndex && /Recheck Cond:/u.test(text),
    forcedRecheck: forceIndex && /Recheck Cond:/u.test(text),
  };
}

async function runPlanChecks(
  sql: Sql,
  table: string,
  strategy: Strategy,
  projectIds: readonly number[],
): Promise<readonly PlanResult[]> {
  const categories: readonly QueryCategory[] = [
    "zh-short",
    "code",
    "english",
    "mixed",
    "punctuation",
  ];
  const results: PlanResult[] = [];
  for (const category of categories) {
    const spec = goldenQueries.find((entry) => entry.category === category);
    if (spec === undefined) {
      continue;
    }
    const defaultResult = await explainSearch(
      sql,
      table,
      strategy,
      spec.query,
      projectIds,
      false,
    );
    const forcedResult = await explainSearch(
      sql,
      table,
      strategy,
      spec.query,
      projectIds,
      true,
    );
    results.push({
      ...defaultResult,
      queryId: spec.id,
      category,
      forcedPlan: forcedResult.forcedPlan,
      forcedUsesIndex: forcedResult.forcedUsesIndex,
      forcedScanType: forcedResult.forcedScanType,
      forcedRecheck: forcedResult.forcedRecheck,
    });
  }
  return results;
}

async function checkRuntimePermissions(
  sql: Sql,
  table: string,
): Promise<RuntimePermissionResult> {
  const errors: string[] = [];
  let canSelect = false;
  let canUseOperator = false;
  let canEscape = false;
  let unescapedRegexDenied = false;
  let runtimeRole = "unknown";
  try {
    const rows = await sql.unsafe<Array<{ role: string }>>(
      "SELECT current_user AS role",
    );
    runtimeRole = rows[0]?.role ?? "unknown";
  } catch (error) {
    errors.push("role:" + formatError(error));
  }
  try {
    await sql.unsafe(
      "SELECT count(*)::int AS count FROM " + table + " LIMIT 1",
    );
    canSelect = true;
  } catch (error) {
    errors.push("select:" + formatError(error));
  }
  try {
    await sql.unsafe(
      "SELECT count(*)::int AS count FROM " +
        table +
        " WHERE normalized_search_text &@~ app.pgroonga_query_escape($1) LIMIT 1",
      ["登录"],
    );
    canUseOperator = true;
  } catch (error) {
    errors.push("operator:" + formatError(error));
  }
  try {
    await sql.unsafe<Array<{ escaped: string }>>(
      "SELECT app.pgroonga_query_escape($1) AS escaped",
      ["MFA+CSRF"],
    );
    canEscape = true;
  } catch (error) {
    errors.push("escape:" + formatError(error));
  }
  try {
    await sql.unsafe(
      "SELECT count(*)::int AS count FROM " +
        table +
        " WHERE normalized_search_text &~ $1 LIMIT 1",
      ["登录"],
    );
  } catch (error) {
    const message = formatError(error);
    if (
      message.includes("permission denied") ||
      message.includes("42501") ||
      message.includes("pgroonga_regexp_text")
    ) {
      unescapedRegexDenied = true;
    } else {
      errors.push("unescaped-regex:" + message);
    }
  }
  return {
    runtimeRole,
    canSelect,
    canUseOperator,
    canEscape,
    unescapedRegexDenied,
    errors,
  };
}

interface StrategyOutcome {
  readonly id: string;
  readonly label: string;
  readonly opclass: Opclass;
  readonly queryStyle: QueryStyle;
  readonly indexSql: string;
  readonly baseIndex: IndexMetrics | null;
  readonly scaleIndex: IndexMetrics | null;
  readonly probeIndex: IndexMetrics | null;
  readonly baseSuite: SuiteResult | null;
  readonly scaleSuite: SuiteResult | null;
  readonly requirementProbe: RequirementProbeResult | null;
  readonly basePlans: readonly PlanResult[];
  readonly scalePlans: readonly PlanResult[];
  readonly updateMs: number;
  readonly reindexMs: number;
  readonly error: string | null;
}

async function runStrategy(
  adminSql: Sql,
  runtimeSql: Sql,
  strategy: Strategy,
  projectIds: readonly number[],
  seed: ReturnType<typeof buildSearchSeed>,
): Promise<StrategyOutcome> {
  try {
    // &~ regexp strategies are diagnostic only. app_runtime is intentionally
    // denied pgroonga_regexp_text EXECUTE, so those probes run as bootstrap.
    const diagnosticSql =
      strategy.queryStyle === "regex" ? adminSql : runtimeSql;
    const baseIndex = await createIndexAndMeasure(
      adminSql,
      BASE_TABLE,
      strategy,
    );
    const baseSuite = await runSuite(
      diagnosticSql,
      BASE_TABLE,
      strategy,
      projectIds,
      seed,
    );
    const basePlans = await runPlanChecks(
      diagnosticSql,
      BASE_TABLE,
      strategy,
      projectIds,
    );
    const probeIndex = await createIndexAndMeasure(
      adminSql,
      PROBE_TABLE,
      strategy,
    );
    const requirementProbe = await runRequirementProbe(
      diagnosticSql,
      PROBE_TABLE,
      strategy,
    );
    const scaleIndex = await createIndexAndMeasure(
      adminSql,
      SCALE_TABLE,
      strategy,
    );
    const scaleSuite = await runSuite(
      diagnosticSql,
      SCALE_TABLE,
      strategy,
      projectIds,
      seed,
    );
    const scalePlans = await runPlanChecks(
      diagnosticSql,
      SCALE_TABLE,
      strategy,
      projectIds,
    );
    let updateMs = -1;
    let reindexMs = -1;
    await adminSql.unsafe("SET ROLE app_owner");
    try {
      updateMs = await measureUpdate(
        adminSql,
        SCALE_TABLE,
        scaleIndex.indexName,
      );
      reindexMs = await measureReindex(adminSql, scaleIndex.indexName);
    } finally {
      await adminSql.unsafe("RESET ROLE");
    }
    return {
      id: strategy.id,
      label: strategy.label,
      opclass: strategy.opclass,
      queryStyle: strategy.queryStyle,
      indexSql: indexDdl(strategy, BASE_TABLE),
      baseIndex,
      scaleIndex,
      probeIndex,
      baseSuite,
      scaleSuite,
      requirementProbe,
      basePlans,
      scalePlans,
      updateMs,
      reindexMs,
      error: null,
    };
  } catch (error) {
    return {
      id: strategy.id,
      label: strategy.label,
      opclass: strategy.opclass,
      queryStyle: strategy.queryStyle,
      indexSql: indexDdl(strategy, BASE_TABLE),
      baseIndex: null,
      scaleIndex: null,
      probeIndex: null,
      baseSuite: null,
      scaleSuite: null,
      requirementProbe: null,
      basePlans: [],
      scalePlans: [],
      updateMs: -1,
      reindexMs: -1,
      error: formatError(error),
    };
  }
}

async function writeReport(report: Record<string, unknown>): Promise<string> {
  const artifactsDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "artifacts",
  );
  await mkdir(artifactsDirectory, { recursive: true });
  const reportPath = resolve(artifactsDirectory, "pgroonga-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return reportPath;
}

async function runPoc(): Promise<void> {
  const databaseUrl = requiredEnv("POC_DATABASE_URL");
  const adminDatabaseUrl =
    process.env.POC_ADMIN_DATABASE_URL?.trim() ?? databaseUrl;
  const runtimeSql = postgres(databaseUrl, {
    connection: { application_name: "inpulse-pgroonga-poc" },
    max: 4,
    onnotice: () => undefined,
    prepare: false,
  });
  const adminSql = postgres(adminDatabaseUrl, {
    connection: { application_name: "inpulse-pgroonga-poc-admin" },
    max: 1,
    onnotice: () => undefined,
    prepare: false,
  });

  try {
    await adminSql.unsafe("SET search_path = app, pg_catalog");
    const versionRows = await runtimeSql.unsafe<Array<{ version: string }>>(
      "SELECT version() AS version",
    );
    const extensionRows = await adminSql.unsafe<
      Array<{
        extversion: string;
        schema: string;
        postgres_version: string;
      }>
    >(
      "SELECT e.extversion, n.nspname AS schema, current_setting('server_version') AS postgres_version " +
        "FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgroonga'",
    );
    const statusRows = await adminSql.unsafe<Array<{ payload: string }>>(
      "SELECT app.pgroonga_command('status') AS payload",
    );
    const statusPayload = parseGroongaPayload(statusRows[0]?.payload);
    const groongaVersion =
      typeof statusPayload?.version === "string" ? statusPayload.version : null;
    const seed = buildSearchSeed();
    const baseRows = seedRowsWithProjects();
    const scaleRows = scaleRowsWithProjects();
    await setupTables(adminSql);
    let baseCount = -1;
    let scaleCount = -1;
    await adminSql.unsafe("SET ROLE app_owner");
    try {
      await insertRows(adminSql, BASE_TABLE, baseRows);
      await insertRows(adminSql, SCALE_TABLE, [...baseRows, ...scaleRows]);
      await insertRows(adminSql, PROBE_TABLE, requirementProbeRows());
      baseCount = await tableCount(adminSql, BASE_TABLE);
      scaleCount = await tableCount(adminSql, SCALE_TABLE);
    } finally {
      await adminSql.unsafe("RESET ROLE");
    }
    const permissions = await checkRuntimePermissions(runtimeSql, BASE_TABLE);

    const enabled =
      process.env.POC_PGROONGA_STRATEGY?.split(",")
        .map((value) => value.trim())
        .filter(Boolean) ?? [];
    const strategies =
      enabled.length === 0
        ? STRATEGIES
        : STRATEGIES.filter((strategy) => enabled.includes(strategy.id));
    const outcomes: StrategyOutcome[] = [];
    for (const strategy of strategies) {
      process.stdout.write("Running PGroonga strategy: " + strategy.id + "\n");
      const outcome = await runStrategy(
        adminSql,
        runtimeSql,
        strategy,
        PROJECT_IDS,
        seed,
      );
      await dropIndex(adminSql, BASE_TABLE, strategy);
      await dropIndex(adminSql, SCALE_TABLE, strategy);
      await dropIndex(adminSql, PROBE_TABLE, strategy);
      outcomes.push(outcome);
    }

    const failedStrategies = outcomes.filter(
      (outcome) => outcome.error !== null,
    );
    if (failedStrategies.length > 0) {
      throw new Error(
        "PGroonga strategy failures: " +
          failedStrategies
            .map((outcome) => outcome.id + ": " + (outcome.error ?? "unknown"))
            .join("; "),
      );
    }

    const report = {
      version: "pgroonga-poc-v3",
      generatedAt: new Date().toISOString(),
      goldenQueryVersion: GOLDEN_QUERY_VERSION,
      requirements: {
        v1CompleteTermOnly: true,
        arbitraryEnglishSubstringRequired: false,
        scope: [
          "complete-english-abbreviation",
          "complete-code-identifier",
          "chinese-short-word",
          "number-search",
        ],
      },
      environment: {
        platform: platform() + " " + release(),
        arch: arch(),
        cpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
      },
      database: {
        version: versionRows[0]?.version ?? null,
        postgresServerVersion: extensionRows[0]?.postgres_version ?? null,
        image: process.env.POC_PGROONGA_IMAGE?.trim() ?? null,
        imageDigest: process.env.POC_PGROONGA_IMAGE_DIGEST?.trim() ?? null,
        pgroongaVersion: extensionRows[0]?.extversion ?? null,
        pgroongaSchema: extensionRows[0]?.schema ?? null,
        groongaVersion,
      },
      dataset: {
        baseRows: baseCount,
        requiredBaseRows: BASE_ROW_COUNT,
        scaleRows: scaleCount,
        requiredScaleRows: SCALE_ROW_COUNT,
        projects: PROJECT_IDS.length,
        topK: TOP_K,
        recallThreshold: RECALL_THRESHOLD,
      },
      permissions,
      strategies: outcomes,
      limitations: [
        "PostgreSQL 18.6 官方基础镜像上的 PGroonga 构建、扩展安装、迁移、默认查询计划和逻辑恢复验证由一体化本地脚本执行，结果另见 pgroonga-backup-restore-report.json；本项目录直接记录运行实例。",
        "Groonga 版本通过 pgroonga_command('status') 从运行中实例读取；生产部署镜像仍需由部署纵切片锁定最终 digest。",
        "101000 行规模使用确定性仿真文本，不等同于真实业务数据分布。",
        "&~ regexp 策略仅作诊断，使用 cluster_bootstrap 执行；app_runtime 按最小权限没有 pgroonga_regexp_text EXECUTE，不作为 V1 运行时门禁。",
        "本报告未执行故障切换和长时间并发更新门禁；备份恢复明细不包含在这里。",
      ],
    };
    const reportPath = await writeReport(report);
    process.stdout.write("PGroonga PoC report: " + reportPath + "\n");
  } finally {
    await adminSql.end({ timeout: 5 });
    await runtimeSql.end({ timeout: 5 });
  }
}

const isCli =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  await runPoc();
}
