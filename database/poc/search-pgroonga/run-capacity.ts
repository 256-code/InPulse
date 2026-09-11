import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import postgres, { type Sql } from "postgres";

import {
  goldenQueries,
  GOLDEN_QUERY_VERSION,
  type GoldenQuerySpec,
} from "../search/golden-queries.js";
import { validateSearchQuery } from "../search/normalize.js";
import { buildSearchSeed, PROJECT_DEFINITIONS } from "../search/seed.js";

// 阶段 4 容量门禁：30 并发持续 10 分钟、预热后 P95 < 500ms / P99 < 1s，
// 并单独记录冷缓存（容器重启清空 shared_buffers 后的首轮查询）。
// 依赖 run-poc.ts 已种子化的 app.pgroonga_poc_scale（101000 行）。
const CAPACITY_REPORT_VERSION = "pgroonga-capacity-v1";
const SCALE_TABLE = "app.pgroonga_poc_scale";
const SCALE_INDEX = "pgroonga_poc_default-query_scale_idx";
const TOP_K = 20;
const MIN_SCALE_ROWS = 100000;
const PROJECT_IDS: readonly number[] = [1, 2, 3, 4, 5, 6];
// 每个请求轮换授权 scope，行级校验任何越界 project_id 都计为违规。
const SCOPE_ROTATION: readonly (readonly number[])[] = [
  [1, 2, 3],
  [4, 5, 6],
  [1, 2, 3, 4, 5, 6],
  [2, 4, 6],
  [1, 3, 5],
];
const DEFAULT_CONCURRENCY = 30;
const DEFAULT_DURATION_MS = 600000;
const DEFAULT_COLD_SAMPLE_COUNT = 30;
const DEFAULT_WARMUP_PASSES = 2;
const TIMELINE_INTERVAL_MS = 60000;
const HISTOGRAM_UPPER_BOUNDS_MS: readonly number[] = [
  1, 2, 5, 10, 25, 50, 100, 200, 500, 1000,
];

// 与生产 PostgresSearchProjectionReader 相同的 SQL 形状：默认全文 opclass、
// pgroonga_query_escape 参数化、scope/项目过滤在 SQL 层、id keyset 分页。
const CAPACITY_SQL =
  "SELECT id::text AS id, project_id, entity_type, entity_id, title, summary " +
  "FROM " +
  SCALE_TABLE +
  " WHERE normalized_search_text &@~ app.pgroonga_query_escape($1)" +
  " AND project_id = ANY($2::int[])" +
  " AND visibility_scope = ANY($3::text[])" +
  " AND id > $4::bigint" +
  " ORDER BY id ASC LIMIT $5";

interface CapacityConfig {
  readonly concurrency: number;
  readonly durationMs: number;
  readonly coldSampleCount: number;
  readonly warmupPasses: number;
  readonly restartContainer: string | null;
}

interface CapacityRow {
  readonly id: string;
  readonly project_id: number;
  readonly entity_type: string;
  readonly entity_id: number;
  readonly title: string;
  readonly summary: string;
}

interface QueryOutcome {
  readonly executedSql: boolean;
  readonly elapsedMs: number;
  readonly rows: readonly CapacityRow[];
  readonly error: string | null;
}

interface LatencySummary {
  readonly count: number;
  readonly minMs: number;
  readonly meanMs: number;
  readonly p50Ms: number;
  readonly p90Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

interface RecorderState {
  requestIndex: number;
  queryCursor: number;
  requests: number;
  sqlExecuted: number;
  validationRejected: number;
  errors: number;
  rowsReturned: number;
  projectViolations: number;
  readonly latencies: number[];
  readonly errorSamples: string[];
}

interface SqlClients {
  adminSql: Sql;
  runtimeSql: Sql;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error("Set " + name);
  }
  return value;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid " + name + ": " + raw);
  }
  return value;
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function createSqlClient(
  url: string,
  max: number,
  applicationName: string,
): Sql {
  return postgres(url, {
    connection: { application_name: applicationName },
    max,
    onnotice: () => undefined,
    prepare: false,
  });
}

async function closeSqlClient(sql: Sql): Promise<void> {
  try {
    await sql.end({ timeout: 5 });
  } catch {
    // 容器重启后的旧连接可能已失效；关闭失败不影响后续重建。
  }
}

// nearest-rank：排序后取 ceil(p * n) 位置的样本，报告中注明方法。
function summarize(samples: readonly number[]): LatencySummary {
  if (samples.length === 0) {
    return {
      count: 0,
      minMs: 0,
      meanMs: 0,
      p50Ms: 0,
      p90Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
    };
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const pick = (percentile: number): number => {
    const rank = Math.ceil(percentile * sorted.length);
    const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
    return round(sorted[index] ?? 0);
  };
  const total = sorted.reduce((sum, value) => sum + value, 0);
  return {
    count: sorted.length,
    minMs: round(sorted[0] ?? 0),
    meanMs: round(total / sorted.length),
    p50Ms: pick(0.5),
    p90Ms: pick(0.9),
    p95Ms: pick(0.95),
    p99Ms: pick(0.99),
    maxMs: round(sorted[sorted.length - 1] ?? 0),
  };
}

function histogram(samples: readonly number[]): ReadonlyArray<{
  readonly upperBoundMs: number | null;
  readonly count: number;
}> {
  const buckets = HISTOGRAM_UPPER_BOUNDS_MS.map((upperBoundMs) => ({
    upperBoundMs: upperBoundMs as number | null,
    count: 0,
  }));
  buckets.push({ upperBoundMs: null, count: 0 });
  for (const sample of samples) {
    const index = HISTOGRAM_UPPER_BOUNDS_MS.findIndex(
      (upperBoundMs) => sample <= upperBoundMs,
    );
    const bucket = index === -1 ? buckets.length - 1 : index;
    buckets[bucket]!.count += 1;
  }
  return buckets;
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

function projectIdByKey(): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  for (const [index, definition] of PROJECT_DEFINITIONS.entries()) {
    result.set(definition.key, index + 1);
  }
  return result;
}

async function tableCount(sql: Sql, table: string): Promise<number> {
  const rows = await sql.unsafe<Array<{ count: number }>>(
    "SELECT count(*)::bigint AS count FROM " + table,
  );
  return Number(rows[0]?.count ?? -1);
}

async function readDatabaseInfo(
  adminSql: Sql,
  runtimeSql: Sql,
): Promise<Record<string, unknown>> {
  const versionRows = await runtimeSql.unsafe<Array<{ version: string }>>(
    "SELECT version() AS version",
  );
  const extensionRows = await adminSql.unsafe<
    Array<{ extversion: string; schema: string; postgres_version: string }>
  >(
    "SELECT e.extversion, n.nspname AS schema, current_setting('server_version') AS postgres_version " +
      "FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pgroonga'",
  );
  const statusRows = await adminSql.unsafe<Array<{ payload: string }>>(
    "SELECT app.pgroonga_command('status') AS payload",
  );
  const statusPayload = parseGroongaPayload(statusRows[0]?.payload);
  const settingRows = await adminSql.unsafe<
    Array<{ name: string; setting: string }>
  >(
    "SELECT name, setting FROM pg_settings WHERE name IN " +
      "('max_connections', 'shared_buffers', 'work_mem', 'effective_cache_size', 'max_worker_processes') " +
      "ORDER BY name",
  );
  return {
    version: versionRows[0]?.version ?? null,
    postgresServerVersion: extensionRows[0]?.postgres_version ?? null,
    image: process.env.POC_PGROONGA_IMAGE?.trim() ?? null,
    imageDigest: process.env.POC_PGROONGA_IMAGE_DIGEST?.trim() ?? null,
    pgroongaVersion: extensionRows[0]?.extversion ?? null,
    pgroongaSchema: extensionRows[0]?.schema ?? null,
    groongaVersion:
      typeof statusPayload?.version === "string" ? statusPayload.version : null,
    settings: Object.fromEntries(
      settingRows.map((row) => [row.name, row.setting]),
    ),
  };
}

async function ensureScaleIndex(
  adminSql: Sql,
): Promise<Record<string, unknown>> {
  await adminSql.unsafe("SET ROLE app_owner");
  try {
    await adminSql.unsafe(
      "DROP INDEX IF EXISTS " + '"app"."' + SCALE_INDEX + '"',
    );
    const startedAt = performance.now();
    await adminSql.unsafe(
      "CREATE INDEX " +
        '"' +
        SCALE_INDEX +
        '"' +
        " ON " +
        SCALE_TABLE +
        " USING pgroonga (normalized_search_text)",
    );
    const buildMs = round(performance.now() - startedAt);
    const sizes = await adminSql.unsafe<
      Array<{ table_bytes: number; total_bytes: number }>
    >(
      "SELECT pg_relation_size($1::regclass)::bigint AS table_bytes, " +
        "pg_total_relation_size($1::regclass)::bigint AS total_bytes",
      [SCALE_TABLE],
    );
    return { buildMs, ...sizes[0] };
  } finally {
    await adminSql.unsafe("RESET ROLE");
  }
}

function restartContainer(name: string): void {
  execFileSync("docker", ["restart", name], { stdio: "pipe" });
}

async function waitForContainerReady(
  name: string,
  timeoutMs: number,
): Promise<number> {
  const startedAt = performance.now();
  for (;;) {
    try {
      execFileSync(
        "docker",
        [
          "exec",
          name,
          "pg_isready",
          "-U",
          "cluster_bootstrap",
          "-d",
          "app_poc",
        ],
        { stdio: "pipe" },
      );
      return round(performance.now() - startedAt);
    } catch (error) {
      if (performance.now() - startedAt > timeoutMs) {
        throw new Error(
          "container " + name + " did not become ready: " + formatError(error),
          { cause: error },
        );
      }
      await new Promise((resolvePromise) => {
        setTimeout(resolvePromise, 1000);
      });
    }
  }
}

async function executeQuery(
  sql: Sql,
  rawQuery: string,
  projectIds: readonly number[],
): Promise<QueryOutcome> {
  const validation = validateSearchQuery(rawQuery);
  if (!validation.ok || projectIds.length === 0) {
    return { executedSql: false, elapsedMs: 0, rows: [], error: null };
  }
  const startedAt = performance.now();
  try {
    const rows = await sql.unsafe<CapacityRow[]>(CAPACITY_SQL, [
      validation.normalizedQuery,
      [...projectIds],
      ["MEMBER"],
      0,
      TOP_K,
    ]);
    return {
      executedSql: true,
      elapsedMs: round(performance.now() - startedAt),
      rows,
      error: null,
    };
  } catch (error) {
    return {
      executedSql: true,
      elapsedMs: round(performance.now() - startedAt),
      rows: [],
      error: formatError(error),
    };
  }
}

function allowedScope(projectIds: readonly number[]): ReadonlySet<number> {
  return new Set(projectIds);
}

function countViolations(
  rows: readonly CapacityRow[],
  allowed: ReadonlySet<number>,
): number {
  let violations = 0;
  for (const row of rows) {
    if (!allowed.has(row.project_id)) {
      violations += 1;
    }
  }
  return violations;
}

async function runColdSamples(
  sql: Sql,
  sampleCount: number,
  restartedContainer: string | null,
  restartWaitMs: number | null,
): Promise<Record<string, unknown>> {
  const specs = goldenQueries.filter((spec) => spec.policy === "normal");
  const samples: Array<{
    readonly id: string;
    readonly query: string;
    readonly elapsedMs: number;
    readonly rowCount: number;
    readonly error: string | null;
  }> = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const spec = specs[index % specs.length];
    if (spec === undefined) {
      break;
    }
    const outcome = await executeQuery(sql, spec.query, PROJECT_IDS);
    samples.push({
      id: spec.id,
      query: spec.query,
      elapsedMs: outcome.elapsedMs,
      rowCount: outcome.rows.length,
      error: outcome.error,
    });
  }
  console.log("capacity cold-cache samples:", samples.length);
  return {
    method:
      restartedContainer === null
        ? "index 构建后未预热的首轮单并发查询（未重启容器，shared_buffers 可能仍缓存索引页）"
        : "容器重启清空 PostgreSQL shared_buffers 后的首轮单并发查询（宿主页缓存未清空）",
    restartedContainer,
    restartWaitMs,
    samples,
    summary: summarize(samples.map((sample) => sample.elapsedMs)),
  };
}

interface RecallResult {
  readonly recallAt20: number;
  readonly hits: number;
  readonly totalNormal: number;
  readonly missed: readonly string[];
  readonly errors: readonly string[];
}

async function runRecallPass(sql: Sql): Promise<RecallResult> {
  const seed = buildSearchSeed();
  const ids = projectIdByKey();
  let hits = 0;
  let totalNormal = 0;
  const missed: string[] = [];
  const errors: string[] = [];
  for (const spec of goldenQueries) {
    if (spec.policy !== "normal") {
      continue;
    }
    totalNormal += 1;
    const outcome = await executeQuery(sql, spec.query, PROJECT_IDS);
    if (outcome.error !== null) {
      errors.push(spec.id + ": " + outcome.error);
      continue;
    }
    const expectedEntityId = seed.expectedEntityIdsByGoldenId.get(spec.id);
    const expectedEntityType = seed.expectedEntityTypesByGoldenId.get(spec.id);
    const expectedProjectId =
      spec.expectedProjectKey === null
        ? undefined
        : ids.get(spec.expectedProjectKey);
    const found = outcome.rows.some(
      (row) =>
        row.project_id === expectedProjectId &&
        row.entity_id === expectedEntityId &&
        row.entity_type === expectedEntityType,
    );
    if (found) {
      hits += 1;
    } else {
      missed.push(spec.id + ":" + spec.query);
    }
  }
  return {
    recallAt20: totalNormal === 0 ? 0 : hits / totalNormal,
    hits,
    totalNormal,
    missed,
    errors,
  };
}

async function runWarmup(
  sql: Sql,
  passes: number,
): Promise<Record<string, unknown>> {
  const recall = await runRecallPass(sql);
  let warmupQueries = 0;
  let warmupErrors = 0;
  for (let pass = 1; pass < passes; pass += 1) {
    for (const spec of goldenQueries) {
      const outcome = await executeQuery(sql, spec.query, PROJECT_IDS);
      if (outcome.executedSql) {
        warmupQueries += 1;
      }
      if (outcome.error !== null) {
        warmupErrors += 1;
      }
    }
  }
  console.log(
    "capacity warmup recall:",
    recall.hits + "/" + recall.totalNormal,
  );
  return {
    passes,
    recall,
    additionalWarmupQueries: warmupQueries,
    warmupErrors,
  };
}

function nextSpec(state: RecorderState): GoldenQuerySpec {
  const spec = goldenQueries[state.queryCursor % goldenQueries.length];
  state.queryCursor += 1;
  if (spec === undefined) {
    throw new Error("golden query set is empty");
  }
  return spec;
}

function nextScope(state: RecorderState): readonly number[] {
  const scope = SCOPE_ROTATION[state.requestIndex % SCOPE_ROTATION.length];
  state.requestIndex += 1;
  return scope ?? PROJECT_IDS;
}

function recordOutcome(
  state: RecorderState,
  spec: GoldenQuerySpec,
  scope: readonly number[],
  outcome: QueryOutcome,
): void {
  state.requests += 1;
  if (!outcome.executedSql) {
    state.validationRejected += 1;
    return;
  }
  state.sqlExecuted += 1;
  state.latencies.push(outcome.elapsedMs);
  state.rowsReturned += outcome.rows.length;
  state.projectViolations += countViolations(outcome.rows, allowedScope(scope));
  if (outcome.error !== null) {
    state.errors += 1;
    if (state.errorSamples.length < 5) {
      state.errorSamples.push(spec.id + ": " + outcome.error);
    }
  }
}

async function runWorker(
  sql: Sql,
  state: RecorderState,
  endAt: number,
): Promise<void> {
  while (performance.now() < endAt) {
    const spec = nextSpec(state);
    const scope = nextScope(state);
    const outcome = await executeQuery(sql, spec.query, scope);
    recordOutcome(state, spec, scope, outcome);
  }
}

async function runSustained(
  sql: Sql,
  config: CapacityConfig,
): Promise<Record<string, unknown>> {
  const state: RecorderState = {
    requestIndex: 0,
    queryCursor: 0,
    requests: 0,
    sqlExecuted: 0,
    validationRejected: 0,
    errors: 0,
    rowsReturned: 0,
    projectViolations: 0,
    latencies: [],
    errorSamples: [],
  };
  const bufferStatsRows = await sql.unsafe<
    Array<{ blks_hit: number; blks_read: number }>
  >(
    "SELECT blks_hit::bigint AS blks_hit, blks_read::bigint AS blks_read " +
      "FROM pg_stat_database WHERE datname = current_database()",
  );
  const bufferStatsBefore = bufferStatsRows[0];
  const startedAt = performance.now();
  const endAt = startedAt + config.durationMs;
  const timeline: Array<Record<string, number>> = [];
  const sampler = (async (): Promise<void> => {
    for (;;) {
      const remaining = endAt - performance.now();
      if (remaining <= 0) {
        return;
      }
      await new Promise((resolvePromise) => {
        setTimeout(resolvePromise, Math.min(TIMELINE_INTERVAL_MS, remaining));
      });
      timeline.push({
        elapsedSeconds: round((performance.now() - startedAt) / 1000),
        requests: state.requests,
        sqlExecuted: state.sqlExecuted,
        errors: state.errors,
        projectViolations: state.projectViolations,
        p95MsSoFar: summarize(state.latencies).p95Ms,
      });
    }
  })();
  const workers: Array<Promise<void>> = [];
  for (let worker = 0; worker < config.concurrency; worker += 1) {
    workers.push(runWorker(sql, state, endAt));
  }
  await Promise.all([...workers, sampler]);
  const actualDurationMs = round(performance.now() - startedAt);
  const bufferStatsRowsAfter = await sql.unsafe<
    Array<{ blks_hit: number; blks_read: number }>
  >(
    "SELECT blks_hit::bigint AS blks_hit, blks_read::bigint AS blks_read " +
      "FROM pg_stat_database WHERE datname = current_database()",
  );
  const bufferStatsAfter = bufferStatsRowsAfter[0];
  const blksHit =
    Number(bufferStatsAfter?.blks_hit ?? 0) -
    Number(bufferStatsBefore?.blks_hit ?? 0);
  const blksRead =
    Number(bufferStatsAfter?.blks_read ?? 0) -
    Number(bufferStatsBefore?.blks_read ?? 0);
  const latency = summarize(state.latencies);
  console.log(
    "capacity sustained:",
    state.requests + " requests / " + state.sqlExecuted + " SQL",
    "p95=" + latency.p95Ms + "ms",
    "p99=" + latency.p99Ms + "ms",
    "errors=" + state.errors,
  );
  return {
    concurrency: config.concurrency,
    requestedDurationMs: config.durationMs,
    actualDurationMs,
    requests: state.requests,
    sqlExecuted: state.sqlExecuted,
    validationRejected: state.validationRejected,
    errors: state.errors,
    errorSamples: state.errorSamples,
    rowsReturned: state.rowsReturned,
    projectViolations: state.projectViolations,
    qps:
      actualDurationMs === 0
        ? 0
        : round(state.requests / (actualDurationMs / 1000)),
    latencyMethod: "nearest-rank（排序后取 ceil(p*n)）",
    latencyMs: latency,
    histogram: histogram(state.latencies),
    timeline,
    sharedBufferStats: {
      blksHit,
      blksRead,
      hitRate:
        blksHit + blksRead === 0 ? 0 : round(blksHit / (blksHit + blksRead)),
    },
  };
}

async function runCrossProjectProbe(
  sql: Sql,
): Promise<Record<string, unknown>> {
  const spec = goldenQueries.find(
    (query) => query.policy === "normal" && query.category === "code",
  );
  if (spec === undefined || spec.expectedProjectKey === null) {
    throw new Error("missing code golden query for cross-project probe");
  }
  const ids = projectIdByKey();
  const targetProjectId = ids.get(spec.expectedProjectKey);
  const otherProjectId = PROJECT_IDS.find(
    (projectId) => projectId !== targetProjectId,
  );
  if (otherProjectId === undefined) {
    throw new Error("missing other project id for cross-project probe");
  }
  const outcome = await executeQuery(sql, spec.query, [otherProjectId]);
  return {
    queryId: spec.id,
    query: spec.query,
    expectedProjectId: targetProjectId,
    queriedProjectIds: [otherProjectId],
    returnedRows: outcome.rows.length,
    error: outcome.error,
    passed: outcome.error === null && outcome.rows.length === 0,
  };
}

async function writeCapacityReport(
  report: Record<string, unknown>,
): Promise<string> {
  const artifactsDirectory = resolve(
    dirname(fileURLToPath(import.meta.url)),
    "artifacts",
  );
  await mkdir(artifactsDirectory, { recursive: true });
  const reportPath = resolve(
    artifactsDirectory,
    "pgroonga-capacity-report.json",
  );
  await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  return reportPath;
}

async function runCapacity(): Promise<void> {
  const runtimeUrl = requiredEnv("POC_DATABASE_URL");
  const adminUrl = process.env.POC_ADMIN_DATABASE_URL?.trim() ?? runtimeUrl;
  const config: CapacityConfig = {
    concurrency: numberFromEnv("POC_CAPACITY_CONCURRENCY", DEFAULT_CONCURRENCY),
    durationMs: numberFromEnv("POC_CAPACITY_DURATION_MS", DEFAULT_DURATION_MS),
    coldSampleCount: numberFromEnv(
      "POC_CAPACITY_COLD_QUERIES",
      DEFAULT_COLD_SAMPLE_COUNT,
    ),
    warmupPasses: numberFromEnv(
      "POC_CAPACITY_WARMUP_PASSES",
      DEFAULT_WARMUP_PASSES,
    ),
    restartContainer:
      process.env.POC_CAPACITY_RESTART_CONTAINER?.trim() || null,
  };
  const clients: SqlClients = {
    adminSql: createSqlClient(adminUrl, 4, "inpulse-pgroonga-capacity-admin"),
    runtimeSql: createSqlClient(
      runtimeUrl,
      config.concurrency + 2,
      "inpulse-pgroonga-capacity",
    ),
  };
  try {
    const databaseInfo = await readDatabaseInfo(
      clients.adminSql,
      clients.runtimeSql,
    );
    const scaleRows = await tableCount(clients.adminSql, SCALE_TABLE);
    if (scaleRows < MIN_SCALE_ROWS) {
      throw new Error(
        "scale table " +
          SCALE_TABLE +
          " has " +
          String(scaleRows) +
          " rows; run the PGroonga PoC first (>= " +
          String(MIN_SCALE_ROWS) +
          " required)",
      );
    }
    const indexInfo = await ensureScaleIndex(clients.adminSql);

    let restartWaitMs: number | null = null;
    if (config.restartContainer !== null) {
      console.log("capacity cold-cache restart:", config.restartContainer);
      await closeSqlClient(clients.adminSql);
      await closeSqlClient(clients.runtimeSql);
      restartContainer(config.restartContainer);
      restartWaitMs = await waitForContainerReady(
        config.restartContainer,
        120000,
      );
      clients.adminSql = createSqlClient(
        adminUrl,
        4,
        "inpulse-pgroonga-capacity-admin",
      );
      clients.runtimeSql = createSqlClient(
        runtimeUrl,
        config.concurrency + 2,
        "inpulse-pgroonga-capacity",
      );
    }

    const coldCache = await runColdSamples(
      clients.runtimeSql,
      config.coldSampleCount,
      config.restartContainer,
      restartWaitMs,
    );
    const warmup = await runWarmup(clients.runtimeSql, config.warmupPasses);
    const crossProjectBeforeSustained = await runCrossProjectProbe(
      clients.runtimeSql,
    );
    const sustained = await runSustained(clients.runtimeSql, config);
    const crossProjectAfterSustained = await runCrossProjectProbe(
      clients.runtimeSql,
    );
    const groongaMetrics = await readGroongaIndexMetrics(
      clients.adminSql,
      SCALE_INDEX,
    );

    const latency = sustained.latencyMs as LatencySummary;
    const recall = warmup.recall as RecallResult;
    const sustainedErrors = Number(sustained.errors ?? -1);
    const sustainedViolations = Number(sustained.projectViolations ?? -1);
    const sustainedDuration = Number(sustained.actualDurationMs ?? 0);
    const gates = {
      scaleRows: scaleRows >= MIN_SCALE_ROWS,
      frozenGoldenSet: goldenQueries.length >= 200,
      goldenQueryVersion: GOLDEN_QUERY_VERSION === "phase4-v1",
      recallAt20: recall.totalNormal >= 190 && recall.recallAt20 >= 0.9,
      concurrency: config.concurrency === 30,
      duration: sustainedDuration >= config.durationMs,
      zeroErrors: sustainedErrors === 0 && recall.errors.length === 0,
      p95Under500ms: latency.p95Ms < 500,
      p99Under1000ms: latency.p99Ms < 1000,
      crossProjectZero:
        sustainedViolations === 0 &&
        crossProjectBeforeSustained.passed === true &&
        crossProjectAfterSustained.passed === true,
      coldCacheRecorded:
        Number((coldCache.summary as LatencySummary | undefined)?.count ?? 0) >=
        config.coldSampleCount,
    };
    const allPassed = Object.values(gates).every((value) => value === true);

    const report = {
      version: CAPACITY_REPORT_VERSION,
      generatedAt: new Date().toISOString(),
      goldenQueryVersion: GOLDEN_QUERY_VERSION,
      gate: {
        clause:
          "技术设计 V1.2.2 §9.4 / 系统设计 §1.6：搜索投影 >= 100000 条且不低于 5 年容量模型峰值 1.2 倍；>= 200 条冻结金标；30 并发持续 10 分钟；预热后 P95 < 500ms、P99 < 1s；Recall@20 >= 90%；跨项目 0 条；另报冷缓存",
        scaleRowFloor: MIN_SCALE_ROWS,
        concurrency: 30,
        durationMs: DEFAULT_DURATION_MS,
        p95LimitMs: 500,
        p99LimitMs: 1000,
        recallThreshold: 0.9,
        fiveYearPeakModel: {
          definedInDesignDocs: false,
          note: "设计文档未给出 5 年容量模型峰值的具体数值；本报告记录验收规模 101000 条与对应上界：当 5 年峰值模型 <= 84166 条时，1.2 倍条件自动满足。模型定稿后需人工复核并按需复测。",
        },
      },
      environment: {
        platform: platform() + " " + release(),
        arch: arch(),
        cpuCount: cpus().length,
        totalMemoryBytes: totalmem(),
      },
      database: databaseInfo,
      dataset: {
        table: SCALE_TABLE,
        scaleRows,
        requiredScaleRows: MIN_SCALE_ROWS,
        projects: PROJECT_IDS.length,
        topK: TOP_K,
        goldenQueries: goldenQueries.length,
        goldenNormalQueries: goldenQueries.filter(
          (spec) => spec.policy === "normal",
        ).length,
      },
      index: {
        name: SCALE_INDEX,
        definition:
          "CREATE INDEX " +
          SCALE_INDEX +
          " ON " +
          SCALE_TABLE +
          " USING pgroonga (normalized_search_text)",
        ...indexInfo,
        ...groongaMetrics,
      },
      config: {
        concurrency: config.concurrency,
        durationMs: config.durationMs,
        coldSampleCount: config.coldSampleCount,
        warmupPasses: config.warmupPasses,
        restartContainer: config.restartContainer,
        scopeRotation: SCOPE_ROTATION,
        sql: CAPACITY_SQL,
      },
      phases: {
        coldCache,
        warmup,
        sustained,
        crossProjectBeforeSustained,
        crossProjectAfterSustained,
      },
      gates,
      allPassed,
      limitations: [
        "101000 行为确定性仿真数据，不代表真实业务分布；容量结论只覆盖该仿真规模。",
        "冷缓存为容器重启后（PostgreSQL shared_buffers 清空）的首轮查询；宿主页缓存与存储层缓存未清空，生产冷启动与异地恢复场景仍需按 DEPLOY/RECOVERY 门禁复测。",
        "30 并发由同一台宿主上的单个 Node 进程发起，未包含 Nginx、TLS、API 与鉴权层开销；端到端 P95 需在部署环境复测。",
        "设计文档未固定 5 年容量模型峰值；1.2 倍条件以上界形式记录（模型峰值 <= 84166 时成立），模型定稿后需人工复核。",
        "P95/P99 使用 nearest-rank 方法；跨项目校验为行级断言与两次负向探针，未覆盖真实成员关系变更并发。",
      ],
    };
    const reportPath = await writeCapacityReport(report);
    console.log("PGroonga capacity report: " + reportPath);
    console.log("capacity gates:", JSON.stringify(gates));
    if (!allPassed) {
      throw new Error("PGroonga capacity gate failed: " + reportPath);
    }
  } finally {
    await closeSqlClient(clients.adminSql);
    await closeSqlClient(clients.runtimeSql);
  }
}

const isCli =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isCli) {
  await runCapacity();
}
