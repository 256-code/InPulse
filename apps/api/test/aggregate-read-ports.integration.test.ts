import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { INestApplicationContext } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
  createDatabaseClient,
  type DatabaseClient,
} from "@inpulse/database/client";
import type { TransactionContext } from "../src/database/transaction-context.js";
import { PostgresUnitOfWork } from "../src/database/unit-of-work.js";
import {
  FeatureReadPort,
  FeaturesModule,
} from "../src/modules/features/index.js";
import { ModuleReadPort, ModulesModule } from "../src/modules/modules/index.js";
import {
  PostgresTaskQueryPort,
  TASK_EXCLUDED_IDS_MAX,
  TaskListInputError,
} from "../src/modules/tasks/index.js";
import { TaskManagementRepository } from "../src/modules/tasks/task-management.repository.js";
import {
  CHANGE_RECORD_TASK_IDS_MAX,
  ChangeRecordReadInputError,
  PostgresChangeRecordReadPort,
} from "../src/modules/change-records/change-record-read.port.js";
import { PostgresMyTaskQueryPort } from "../src/modules/change-records/my-task-query.port.js";
import { RecordDraftRepository } from "../src/modules/change-records/record-draft.repository.js";
import { createProject, createUser, testUrls } from "./database.helpers.js";

// F-29 / F-32 只读端口验收（C 端口提案 §9.1、A 裁决 §7）：
// 1. 每个新方法至少 1 条真实 PostgreSQL 用例，覆盖正常 / 空 projectIds / 跨项目不返回 /
//    状态边界。
// 2. count 与不分页 list.items.length 在同一 filter 下相等。
// 3. excludedTaskIds 与 hasPublishedRecord 在分页前过滤。
// 4. 空 projectIds 短路且不发出 SQL（captureTransaction 断言零调用）。
// 5. 查询计划命中既有索引、无 Seq Scan on tasks；端口可在只读事务中执行。

let client: DatabaseClient;
let uow: PostgresUnitOfWork;
let moduleContext: INestApplicationContext;
let featureContext: INestApplicationContext;
let modules: ModuleReadPort;
let features: FeatureReadPort;
const taskQuery = new PostgresTaskQueryPort();
const myTasks = new PostgresMyTaskQueryPort();
const records = new PostgresChangeRecordReadPort();
const taskWrites = new TaskManagementRepository();
const draftWrites = new RecordDraftRepository();
let sequence = 0;

interface ProjectScope {
  readonly code: string;
  readonly moduleId: number;
  readonly projectId: number;
  readonly userId: number;
}

interface SqlCall {
  readonly text: string;
  readonly values: readonly unknown[];
}

const recordContent = {
  title: "聚合读端口记录",
  contextProblem: "上下文问题",
  changeSolution: "变更方案",
  resultVerification: "验证结果",
  remainingIssues: "",
};

beforeAll(async () => {
  client = createDatabaseClient(testUrls().runtime, {
    applicationName: "inpulse-aggregate-read-ports",
  });
  expect((await client.sql`SELECT current_user AS role`)[0]?.role).toBe(
    "app_runtime",
  );
  uow = new PostgresUnitOfWork(client);
  moduleContext = await NestFactory.createApplicationContext(ModulesModule, {
    logger: false,
  });
  featureContext = await NestFactory.createApplicationContext(FeaturesModule, {
    logger: false,
  });
  modules = moduleContext.get(ModuleReadPort);
  features = featureContext.get(FeatureReadPort);
});

afterAll(async () => {
  await featureContext?.close();
  await moduleContext?.close();
  await client?.close();
});

function nextSuffix(kind: "T" | "F" | "CR"): string {
  sequence += 1;
  return "-" + kind + "-" + sequence;
}

async function newProject(): Promise<ProjectScope> {
  const userId = await createUser(client.sql);
  const project = await createProject(client.sql, userId);
  return { ...project, userId };
}

async function newModule(scope: ProjectScope, name: string): Promise<number> {
  const [row] = await client.sql<{ id: number }[]>`
    INSERT INTO app.modules (project_id, name, created_by)
    VALUES (${scope.projectId}, ${name}, ${scope.userId})
    RETURNING id
  `;
  if (!row) throw new Error("module fixture insert returned no row");
  return row.id;
}

async function newFeature(
  scope: ProjectScope,
  moduleId: number,
  name: string,
): Promise<number> {
  const [row] = await client.sql<{ id: number }[]>`
    INSERT INTO app.features (project_id, module_id, code, name, created_by)
    VALUES (${scope.projectId}, ${moduleId}, ${scope.code + nextSuffix("F")}, ${name}, ${scope.userId})
    RETURNING id
  `;
  if (!row) throw new Error("feature fixture insert returned no row");
  return row.id;
}

async function addMember(projectId: number, userId: number): Promise<void> {
  await client.sql`
    INSERT INTO app.project_members (project_id, user_id)
    VALUES (${projectId}, ${userId})
  `;
}

interface TaskOptions {
  readonly assigneeId?: number;
  readonly featureId?: number | null;
  readonly workStatus?: "TODO" | "DONE" | "CANCELED";
  readonly lifecycleStatus?: "ACTIVE" | "ARCHIVED" | "INVALID";
  readonly title?: string;
}

async function newTask(
  scope: ProjectScope,
  options: TaskOptions = {},
): Promise<number> {
  const featureId = options.featureId ?? null;
  const workStatus = options.workStatus ?? "TODO";
  const code = scope.code + nextSuffix("T");
  return uow.run(async (tx) => {
    const created = await taskWrites.create(
      tx,
      { projectId: scope.projectId, moduleId: scope.moduleId, featureId },
      scope.userId,
      code,
      {
        title: options.title ?? "聚合读端口任务",
        description: "",
        assigneeId: options.assigneeId ?? scope.userId,
        priority: "NORMAL",
        dueAt: null,
      },
    );
    const current =
      workStatus === "TODO"
        ? created
        : (await taskWrites.transition(
            tx,
            created,
            scope.userId,
            workStatus,
            workStatus === "DONE" ? "聚合读端口夹具完成" : null,
            "聚合读端口夹具",
          ))!;
    if ((options.lifecycleStatus ?? "ACTIVE") !== "ACTIVE") {
      await tx.sql`UPDATE app.tasks SET lifecycle_status = ${options.lifecycleStatus!}, updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = ${current.id} AND project_id = ${scope.projectId}`;
    }
    return current.id;
  });
}

interface RecordOptions {
  readonly featureId?: number | null;
  readonly taskId?: number | null;
  readonly status?: "PUBLISHED" | "VOID";
}

async function newPublishedRecord(
  scope: ProjectScope,
  options: RecordOptions = {},
): Promise<number> {
  const code = scope.code + nextSuffix("CR");
  const taskId = options.taskId ?? null;
  const draft = await uow.run((tx) =>
    draftWrites.create(
      tx,
      {
        projectId: scope.projectId,
        moduleId: scope.moduleId,
        featureId: options.featureId ?? null,
        impactFeatureIds: [],
      },
      scope.userId,
      recordContent,
      taskId === null ? undefined : { taskId, handlerId: scope.userId },
    ),
  );
  await uow.run(async (tx) => {
    await tx.sql`INSERT INTO app.change_record_versions (record_id, project_id, version_no, title_snapshot, payload, created_by) SELECT id, project_id, 1, title, current_payload, ${scope.userId} FROM app.change_records WHERE id = ${draft.id} AND project_id = ${scope.projectId}`;
    await tx.sql`UPDATE app.change_records SET status = 'PUBLISHED', code = ${code}, current_version = 1, published_at = clock_timestamp(), row_version = row_version + 1 WHERE id = ${draft.id} AND project_id = ${scope.projectId}`;
    if (options.status === "VOID") {
      await tx.sql`UPDATE app.change_records SET status = 'VOID', voided_at = clock_timestamp(), void_reason = '聚合读端口夹具作废', row_version = row_version + 1 WHERE id = ${draft.id} AND project_id = ${scope.projectId}`;
    }
  });
  return draft.id;
}

async function newDraftRecord(
  scope: ProjectScope,
  options: {
    readonly featureId?: number | null;
    readonly taskId?: number | null;
  } = {},
): Promise<number> {
  const featureId = options.featureId ?? null;
  const taskId = options.taskId ?? null;
  const draft = await uow.run((tx) =>
    draftWrites.create(
      tx,
      {
        projectId: scope.projectId,
        moduleId: scope.moduleId,
        featureId,
        impactFeatureIds: [],
      },
      scope.userId,
      recordContent,
      taskId === null ? undefined : { taskId, handlerId: scope.userId },
    ),
  );
  return draft.id;
}

async function newRecordVersion(
  scope: ProjectScope,
  recordId: number,
  versionNo: number,
): Promise<void> {
  await uow.run(async (tx) => {
    await tx.sql`INSERT INTO app.change_record_versions (record_id, project_id, version_no, title_snapshot, payload, created_by) SELECT id, project_id, ${versionNo}, title, current_payload, ${scope.userId} FROM app.change_records WHERE id = ${recordId} AND project_id = ${scope.projectId}`;
    await tx.sql`UPDATE app.change_records SET current_version = ${versionNo}, row_version = row_version + 1, updated_at = clock_timestamp() WHERE id = ${recordId} AND project_id = ${scope.projectId}`;
  });
}

async function newLeftover(
  scope: ProjectScope,
  recordId: number,
  options: {
    readonly status?: "ACTIVE" | "CONVERTED" | "RESOLVED";
    readonly contents: readonly string[];
  },
): Promise<number> {
  const status = options.status ?? "ACTIVE";
  const contents = [...options.contents];
  return uow.run(async (tx) => {
    const [row] = await tx.sql<{ id: number }[]>`
      INSERT INTO app.change_record_leftover_items (record_id, project_id, status, created_by)
      VALUES (${recordId}, ${scope.projectId}, ${status}, ${scope.userId})
      RETURNING id
    `;
    if (!row) throw new Error("leftover fixture insert returned no row");
    // change_record_version_leftovers 以 (record_id, version_no) 外键引用
    // change_record_versions；草稿记录没有版本，快照行只能按现有版本写入。
    const [record] = await tx.sql<{ currentVersion: number }[]>`
      SELECT current_version AS "currentVersion"
        FROM app.change_records
       WHERE id = ${recordId}
         AND project_id = ${scope.projectId}
    `;
    const availableVersions = record?.currentVersion ?? 0;
    for (let index = 0; index < contents.length; index += 1) {
      if (index + 1 > availableVersions) {
        break;
      }
      const content = contents[index];
      if (content === undefined) {
        throw new Error("leftover fixture content is missing");
      }
      await tx.sql`INSERT INTO app.change_record_version_leftovers (record_id, version_no, leftover_item_id, project_id, content_snapshot) VALUES (${recordId}, ${index + 1}, ${row.id}, ${scope.projectId}, ${content})`;
    }
    return row.id;
  });
}

async function newTaskBatch(
  scope: ProjectScope,
  count: number,
  startCode: number,
): Promise<void> {
  await client.sql.begin(async (tx) => {
    const rows = await tx<{ id: number }[]>`
      INSERT INTO app.tasks (project_id, module_id, feature_id, scope_type, code, title, description, assignee_id, creator_id, priority, work_status, lifecycle_status)
      SELECT ${scope.projectId}, ${scope.moduleId}, NULL, 'MODULE', ${scope.code + "-T-"} || (${startCode} + n), '批量夹具任务 ' || n, '', ${scope.userId}, ${scope.userId}, 'NORMAL', 'TODO', 'ACTIVE'
        FROM generate_series(1, ${count}) AS n
      RETURNING id
    `;
    await tx`
      INSERT INTO app.task_status_history (task_id, project_id, from_work_status, to_work_status, changed_by)
      SELECT id, ${scope.projectId}, NULL, 'TODO', ${scope.userId}
        FROM unnest(${rows.map((row) => row.id)}::integer[]) AS id
    `;
  });
}

function captureTransaction(): { calls: SqlCall[]; tx: TransactionContext } {
  const calls: SqlCall[] = [];
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0] ?? "";
    for (let index = 0; index < values.length; index += 1) {
      text += "$" + (index + 1) + (strings[index + 1] ?? "");
    }
    calls.push({ text, values });
    return Promise.resolve([]);
  };
  const tx: TransactionContext = {
    db: {} as TransactionContext["db"],
    sql: sql as unknown as TransactionContext["sql"],
  };
  return { calls, tx };
}

async function explain(call: SqlCall): Promise<string> {
  return client.sql.begin(async (tx) => {
    // 夹具库规模小，且 app_runtime 无 MAINTAIN 权限、无法 ANALYZE；关闭顺序扫描后
    // 计划仍出现索引路径，才证明该查询形状可被既有索引服务（不依赖 Seq Scan）。
    await tx.unsafe("SET LOCAL enable_seqscan = off");
    const rows = await tx.unsafe<Array<Record<string, string>>>(
      "EXPLAIN (ANALYZE, BUFFERS) " + call.text,
      [...call.values] as never[],
    );
    return rows
      .map((row) => row["QUERY PLAN"] ?? JSON.stringify(row))
      .join(String.fromCharCode(10));
  });
}

describe("ModuleReadPort.count and FeatureReadPort.count", () => {
  test("module count keeps archived history and never crosses projects", async () => {
    const scope = await newProject();
    const other = await newProject();
    const extraModule = await newModule(scope, "正常模块");
    expect(
      await uow.run((tx) => modules.count(tx, { projectId: scope.projectId })),
    ).toBe(2);
    expect(
      await uow.run((tx) =>
        modules.count(tx, { projectId: scope.projectId, status: "ACTIVE" }),
      ),
    ).toBe(2);
    await client.sql`UPDATE app.modules SET status = 'ARCHIVED', archived_at = now(), row_version = row_version + 1 WHERE id = ${extraModule}`;
    expect(
      await uow.run((tx) => modules.count(tx, { projectId: scope.projectId })),
    ).toBe(2);
    expect(
      await uow.run((tx) =>
        modules.count(tx, { projectId: scope.projectId, status: "ACTIVE" }),
      ),
    ).toBe(1);
    expect(
      await uow.run((tx) =>
        modules.count(tx, { projectId: scope.projectId, status: "ARCHIVED" }),
      ),
    ).toBe(1);
    expect(
      await uow.run((tx) => modules.count(tx, { projectId: other.projectId })),
    ).toBe(1);
  });

  test("feature count narrows by module and status without leaking projects", async () => {
    const scope = await newProject();
    const other = await newProject();
    const secondModule = await newModule(scope, "第二模块");
    await newFeature(scope, scope.moduleId, "功能甲");
    const archived = await newFeature(scope, scope.moduleId, "功能乙");
    await newFeature(scope, secondModule, "功能丙");
    await client.sql`UPDATE app.features SET status = 'ARCHIVED', archived_at = now(), row_version = row_version + 1 WHERE id = ${archived}`;
    expect(
      await uow.run((tx) => features.count(tx, { projectId: scope.projectId })),
    ).toBe(3);
    expect(
      await uow.run((tx) =>
        features.count(tx, {
          projectId: scope.projectId,
          moduleId: scope.moduleId,
        }),
      ),
    ).toBe(2);
    expect(
      await uow.run((tx) =>
        features.count(tx, {
          projectId: scope.projectId,
          moduleId: scope.moduleId,
          status: "ACTIVE",
        }),
      ),
    ).toBe(1);
    expect(
      await uow.run((tx) =>
        features.count(tx, {
          projectId: scope.projectId,
          moduleId: secondModule,
          status: "ACTIVE",
        }),
      ),
    ).toBe(1);
    expect(
      await uow.run((tx) => features.count(tx, { projectId: other.projectId })),
    ).toBe(0);
    expect(
      await uow.run((tx) =>
        features.count(tx, {
          projectId: scope.projectId,
          moduleId: other.moduleId,
        }),
      ),
    ).toBe(0);
  });
});

describe("TaskQueryPort list and count", () => {
  test("filters, ordering and count agree with the unpaged list", async () => {
    const scope = await newProject();
    const other = await newProject();
    const colleague = await createUser(client.sql);
    await addMember(scope.projectId, colleague);
    const todo = await newTask(scope, { assigneeId: colleague });
    const done = await newTask(scope, { workStatus: "DONE" });
    const canceled = await newTask(scope, { workStatus: "CANCELED" });
    const foreign = await newTask(other);
    const page = await uow.run((tx) =>
      taskQuery.list(tx, { projectIds: [scope.projectId], limit: 100 }),
    );
    expect(page.items.map((item) => item.taskId)).toEqual([
      canceled,
      done,
      todo,
    ]);
    expect(page.hasMore).toBe(false);
    expect(page.nextTaskId).toBeNull();
    expect(page.items[0]).toMatchObject({
      projectId: scope.projectId,
      moduleId: scope.moduleId,
      featureId: null,
      scopeType: "MODULE",
      workStatus: "CANCELED",
      lifecycleStatus: "ACTIVE",
    });
    expect(page.items[0]?.createdAt).toBeInstanceOf(Date);
    expect(
      await uow.run((tx) =>
        taskQuery.count(tx, { projectIds: [scope.projectId] }),
      ),
    ).toBe(page.items.length);
    const byAssignee = await uow.run((tx) =>
      taskQuery.list(tx, {
        projectIds: [scope.projectId],
        assigneeId: colleague,
        limit: 100,
      }),
    );
    expect(byAssignee.items.map((item) => item.taskId)).toEqual([todo]);
    expect(
      await uow.run((tx) =>
        taskQuery.count(tx, {
          projectIds: [scope.projectId],
          assigneeId: colleague,
        }),
      ),
    ).toBe(byAssignee.items.length);
    const byStatus = await uow.run((tx) =>
      taskQuery.list(tx, {
        projectIds: [scope.projectId],
        workStatuses: ["DONE", "CANCELED"],
        limit: 100,
      }),
    );
    expect(byStatus.items.map((item) => item.taskId)).toEqual([canceled, done]);
    const crossProject = await uow.run((tx) =>
      taskQuery.list(tx, { projectIds: [other.projectId], limit: 100 }),
    );
    expect(crossProject.items.map((item) => item.taskId)).toEqual([foreign]);
    expect(
      await uow.run((tx) =>
        taskQuery.count(tx, {
          projectIds: [scope.projectId, other.projectId],
        }),
      ),
    ).toBe(4);
  });

  test("effectiveOnly drops invalid and canceled tasks but keeps archived ones", async () => {
    const scope = await newProject();
    const featureId = await newFeature(scope, scope.moduleId, "影响功能");
    const active = await newTask(scope);
    const canceled = await newTask(scope, { workStatus: "CANCELED" });
    const invalid = await newTask(scope, { lifecycleStatus: "INVALID" });
    const archived = await newTask(scope, { lifecycleStatus: "ARCHIVED" });
    const featureScoped = await newTask(scope, { featureId });
    const all = await uow.run((tx) =>
      taskQuery.list(tx, { projectIds: [scope.projectId], limit: 100 }),
    );
    expect(all.items).toHaveLength(5);
    const effective = await uow.run((tx) =>
      taskQuery.list(tx, {
        projectIds: [scope.projectId],
        effectiveOnly: true,
        limit: 100,
      }),
    );
    const effectiveIds = effective.items.map((item) => item.taskId);
    expect(effectiveIds.sort((left, right) => left - right)).toEqual(
      [active, archived, featureScoped].sort((left, right) => left - right),
    );
    expect(effectiveIds).not.toContain(canceled);
    expect(effectiveIds).not.toContain(invalid);
    expect(
      await uow.run((tx) =>
        taskQuery.count(tx, {
          projectIds: [scope.projectId],
          effectiveOnly: true,
        }),
      ),
    ).toBe(effective.items.length);
    const byScope = await uow.run((tx) =>
      taskQuery.list(tx, {
        projectIds: [scope.projectId],
        scopeTypes: ["FEATURE"],
        limit: 100,
      }),
    );
    expect(byScope.items.map((item) => item.taskId)).toEqual([featureScoped]);
    expect(byScope.items[0]).toMatchObject({ featureId, scopeType: "FEATURE" });
    expect(
      await uow.run((tx) =>
        taskQuery.count(tx, {
          projectIds: [scope.projectId],
          scopeTypes: ["MODULE"],
        }),
      ),
    ).toBe(4);
  });

  test("task pagination walks every row exactly once", async () => {
    const scope = await newProject();
    const created = [
      await newTask(scope),
      await newTask(scope),
      await newTask(scope),
      await newTask(scope),
      await newTask(scope),
    ];
    const first = await uow.run((tx) =>
      taskQuery.list(tx, { projectIds: [scope.projectId], limit: 2 }),
    );
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const second = await uow.run((tx) =>
      taskQuery.list(tx, {
        projectIds: [scope.projectId],
        limit: 2,
        afterTaskId: first.nextTaskId!,
      }),
    );
    expect(second.items).toHaveLength(2);
    expect(second.hasMore).toBe(true);
    const third = await uow.run((tx) =>
      taskQuery.list(tx, {
        projectIds: [scope.projectId],
        limit: 2,
        afterTaskId: second.nextTaskId!,
      }),
    );
    expect(third.items).toHaveLength(1);
    expect(third.hasMore).toBe(false);
    expect(third.nextTaskId).toBeNull();
    const seen = [...first.items, ...second.items, ...third.items].map(
      (item) => item.taskId,
    );
    expect(seen).toEqual([...created].sort((left, right) => right - left));
    expect(new Set(seen).size).toBe(seen.length);
  });

  test("excludedTaskIds filter before pagination and inside count", async () => {
    const scope = await newProject();
    const first = await newTask(scope);
    const second = await newTask(scope);
    const third = await newTask(scope);
    const fourth = await newTask(scope);
    const fifth = await newTask(scope);
    const excluded = [fifth, fourth];
    const page = await uow.run((tx) =>
      taskQuery.list(tx, {
        projectIds: [scope.projectId],
        excludedTaskIds: excluded,
        limit: 2,
      }),
    );
    expect(page.items.map((item) => item.taskId)).toEqual([third, second]);
    expect(page.hasMore).toBe(true);
    const next = await uow.run((tx) =>
      taskQuery.list(tx, {
        projectIds: [scope.projectId],
        excludedTaskIds: excluded,
        limit: 2,
        afterTaskId: page.nextTaskId!,
      }),
    );
    expect(next.items.map((item) => item.taskId)).toEqual([first]);
    expect(next.hasMore).toBe(false);
    expect(
      await uow.run((tx) =>
        taskQuery.count(tx, {
          projectIds: [scope.projectId],
          excludedTaskIds: excluded,
        }),
      ),
    ).toBe(3);
    expect(
      await uow.run((tx) =>
        taskQuery.count(tx, {
          projectIds: [scope.projectId],
          excludedTaskIds: [fifth],
        }),
      ),
    ).toBe(4);
  });

  test("task list validation rejects unbounded filters before SQL", async () => {
    const { calls, tx } = captureTransaction();
    await expect(
      taskQuery.list(tx, { projectIds: [1], limit: 0 }),
    ).rejects.toMatchObject({
      name: "TaskListInputError",
      reason: "invalid-limit",
    });
    await expect(
      taskQuery.list(tx, { projectIds: [1], limit: 1.5 }),
    ).rejects.toBeInstanceOf(TaskListInputError);
    await expect(
      taskQuery.list(tx, {
        projectIds: [1],
        limit: 20,
        excludedTaskIds: Array.from(
          { length: TASK_EXCLUDED_IDS_MAX + 1 },
          () => 1,
        ),
      }),
    ).rejects.toMatchObject({ reason: "invalid-excluded-task-ids" });
    await expect(
      taskQuery.list(tx, { projectIds: [1], limit: 20, excludedTaskIds: [0] }),
    ).rejects.toMatchObject({ reason: "invalid-excluded-task-ids" });
    await expect(
      taskQuery.count(tx, {
        projectIds: [1],
        excludedTaskIds: Array.from(
          { length: TASK_EXCLUDED_IDS_MAX + 1 },
          () => 1,
        ),
      }),
    ).rejects.toMatchObject({ reason: "invalid-excluded-task-ids" });
    expect(calls).toEqual([]);
    await expect(
      taskQuery.count(tx, {
        projectIds: [],
        excludedTaskIds: Array.from({ length: TASK_EXCLUDED_IDS_MAX }, () => 1),
      }),
    ).resolves.toBe(0);
    expect(calls).toEqual([]);
  });

  test("empty authorized project scope short-circuits without SQL", async () => {
    const { calls, tx } = captureTransaction();
    await expect(
      taskQuery.list(tx, { projectIds: [], limit: 20 }),
    ).resolves.toEqual({ items: [], nextTaskId: null, hasMore: false });
    await expect(taskQuery.count(tx, { projectIds: [] })).resolves.toBe(0);
    expect(calls).toEqual([]);
  });
});

describe("MyTaskQueryPort.list", () => {
  test("hasPublishedRecord filters before pagination and scopes to projects", async () => {
    const scope = await newProject();
    const olderPublished = await newTask(scope);
    await newPublishedRecord(scope, { taskId: olderPublished });
    const newerPublished = await newTask(scope);
    await newPublishedRecord(scope, { taskId: newerPublished });
    const newestWithoutRecord = await newTask(scope);
    const all = await uow.run((tx) =>
      myTasks.list(tx, { projectIds: [scope.projectId], limit: 100 }),
    );
    expect(all.items.map((item) => item.taskId)).toEqual([
      newestWithoutRecord,
      newerPublished,
      olderPublished,
    ]);
    const withoutRecord = await uow.run((tx) =>
      myTasks.list(tx, {
        projectIds: [scope.projectId],
        hasPublishedRecord: false,
        limit: 1,
      }),
    );
    expect(withoutRecord.items.map((item) => item.taskId)).toEqual([
      newestWithoutRecord,
    ]);
    expect(withoutRecord.hasMore).toBe(false);
    const withRecord = await uow.run((tx) =>
      myTasks.list(tx, {
        projectIds: [scope.projectId],
        hasPublishedRecord: true,
        limit: 1,
      }),
    );
    expect(withRecord.items.map((item) => item.taskId)).toEqual([
      newerPublished,
    ]);
    expect(withRecord.hasMore).toBe(true);
    const nextPage = await uow.run((tx) =>
      myTasks.list(tx, {
        projectIds: [scope.projectId],
        hasPublishedRecord: true,
        limit: 1,
        afterTaskId: withRecord.nextTaskId!,
      }),
    );
    expect(nextPage.items.map((item) => item.taskId)).toEqual([olderPublished]);
    expect(nextPage.hasMore).toBe(false);
    const other = await newProject();
    const foreign = await newTask(other);
    const scoped = await uow.run((tx) =>
      myTasks.list(tx, { projectIds: [other.projectId], limit: 100 }),
    );
    expect(scoped.items.map((item) => item.taskId)).toEqual([foreign]);
    const excluded = await uow.run((tx) =>
      myTasks.list(tx, {
        projectIds: [scope.projectId],
        excludedTaskIds: [newestWithoutRecord],
        limit: 100,
      }),
    );
    expect(excluded.items.map((item) => item.taskId)).toEqual([
      newerPublished,
      olderPublished,
    ]);
    const byAssignee = await uow.run((tx) =>
      myTasks.list(tx, {
        projectIds: [scope.projectId],
        assigneeId: scope.userId,
        limit: 100,
      }),
    );
    expect(byAssignee.items).toHaveLength(3);
  });

  test("my task list short-circuits and validates like the task port", async () => {
    const { calls, tx } = captureTransaction();
    await expect(
      myTasks.list(tx, { projectIds: [], limit: 20 }),
    ).resolves.toEqual({ items: [], nextTaskId: null, hasMore: false });
    await expect(
      myTasks.list(tx, { projectIds: [1], limit: 0 }),
    ).rejects.toBeInstanceOf(TaskListInputError);
    await expect(
      myTasks.list(tx, {
        projectIds: [1],
        limit: 20,
        excludedTaskIds: Array.from(
          { length: TASK_EXCLUDED_IDS_MAX + 1 },
          () => 1,
        ),
      }),
    ).rejects.toMatchObject({ reason: "invalid-excluded-task-ids" });
    expect(calls).toEqual([]);
  });
});

describe("ChangeRecordReadPort", () => {
  test("published counts and recent list hide drafts and voids", async () => {
    const scope = await newProject();
    const other = await newProject();
    const featureId = await newFeature(scope, scope.moduleId, "支付功能");
    const featureRecord = await newPublishedRecord(scope, { featureId });
    const moduleRecord = await newPublishedRecord(scope, {});
    await newDraftRecord(scope);
    const voided = await newPublishedRecord(scope, { status: "VOID" });
    await newPublishedRecord(other, {});
    expect(
      await uow.run((tx) =>
        records.countPublished(tx, { projectId: scope.projectId }),
      ),
    ).toBe(2);
    expect(
      await uow.run((tx) =>
        records.countPublished(tx, { projectId: scope.projectId, featureId }),
      ),
    ).toBe(1);
    expect(
      await uow.run((tx) =>
        records.countPublished(tx, {
          projectId: scope.projectId,
          scopeType: "MODULE",
        }),
      ),
    ).toBe(1);
    expect(
      await uow.run((tx) =>
        records.countPublished(tx, {
          projectId: scope.projectId,
          moduleId: other.moduleId,
        }),
      ),
    ).toBe(0);
    expect(
      await uow.run((tx) =>
        records.countPublished(tx, { projectId: other.projectId }),
      ),
    ).toBe(1);
    const recent = await uow.run((tx) =>
      records.listRecentPublished(tx, {
        projectId: scope.projectId,
        limit: 10,
      }),
    );
    expect(recent.map((item) => item.recordId)).toEqual([
      moduleRecord,
      featureRecord,
    ]);
    expect(recent.map((item) => item.recordId)).not.toContain(voided);
    expect(recent[0]).toMatchObject({
      projectId: scope.projectId,
      featureId: null,
      featureName: null,
      currentVersion: 1,
    });
    expect(recent[0]?.publishedAt).toBeInstanceOf(Date);
    expect(recent[1]).toMatchObject({ featureId, featureName: "支付功能" });
    expect(recent[1]?.code).toContain("-CR-");
    expect(recent.length).toBe(
      await uow.run((tx) =>
        records.countPublished(tx, { projectId: scope.projectId }),
      ),
    );
    const limited = await uow.run((tx) =>
      records.listRecentPublished(tx, { projectId: scope.projectId, limit: 1 }),
    );
    expect(limited.map((item) => item.recordId)).toEqual([moduleRecord]);
    await expect(
      uow.run((tx) =>
        records.listRecentPublished(tx, {
          projectId: scope.projectId,
          limit: 0,
        }),
      ),
    ).rejects.toBeInstanceOf(ChangeRecordReadInputError);
    await expect(
      uow.run((tx) =>
        records.listRecentPublished(tx, {
          projectId: scope.projectId,
          limit: 101,
        }),
      ),
    ).rejects.toMatchObject({ reason: "invalid-limit" });
  });

  test("active leftovers use the newest snapshot of visible records only", async () => {
    const scope = await newProject();
    const featureId = await newFeature(scope, scope.moduleId, "遗留功能");
    const record = await newPublishedRecord(scope, { featureId });
    await newRecordVersion(scope, record, 2);
    const activeLeftover = await newLeftover(scope, record, {
      contents: ["第一版遗留内容", "第二版遗留内容"],
    });
    const resolvedLeftover = await newLeftover(scope, record, {
      status: "RESOLVED",
      contents: ["已解决内容"],
    });
    const draftRecord = await newDraftRecord(scope);
    const draftLeftover = await newLeftover(scope, draftRecord, {
      contents: ["草稿记录内容"],
    });
    const voidRecord = await newPublishedRecord(scope, { status: "VOID" });
    const voidLeftover = await newLeftover(scope, voidRecord, {
      contents: ["作废记录内容"],
    });
    const other = await newProject();
    const otherRecord = await newPublishedRecord(other, {});
    const otherLeftover = await newLeftover(other, otherRecord, {
      contents: ["其他项目内容"],
    });
    const leftovers = await uow.run((tx) =>
      records.listActiveLeftovers(tx, {
        projectId: scope.projectId,
        limit: 10,
      }),
    );
    const ids = leftovers
      .map((item) => item.leftoverItemId)
      .sort((left, right) => left - right);
    expect(ids).toEqual(
      [activeLeftover, voidLeftover].sort((left, right) => left - right),
    );
    expect(ids).not.toContain(resolvedLeftover);
    expect(ids).not.toContain(draftLeftover);
    expect(ids).not.toContain(otherLeftover);
    const active = leftovers.find(
      (item) => item.leftoverItemId === activeLeftover,
    );
    expect(active).toMatchObject({
      recordId: record,
      projectId: scope.projectId,
      content: "第二版遗留内容",
    });
    expect(active?.recordCode).toContain("-CR-");
    const featureScoped = await uow.run((tx) =>
      records.listActiveLeftovers(tx, {
        projectId: scope.projectId,
        featureId,
        limit: 10,
      }),
    );
    expect(featureScoped.map((item) => item.leftoverItemId)).toEqual([
      activeLeftover,
    ]);
    const moduleScoped = await uow.run((tx) =>
      records.listActiveLeftovers(tx, {
        projectId: scope.projectId,
        scopeType: "MODULE",
        limit: 10,
      }),
    );
    expect(moduleScoped.map((item) => item.leftoverItemId)).toEqual([
      voidLeftover,
    ]);
    const capped = await uow.run((tx) =>
      records.listActiveLeftovers(tx, {
        projectId: scope.projectId,
        limit: 1,
      }),
    );
    expect(capped).toHaveLength(1);
  });

  test("task ids with published records scope by project, task set and status", async () => {
    const scope = await newProject();
    const other = await newProject();
    const published = await newTask(scope);
    await newPublishedRecord(scope, { taskId: published });
    const draftOnly = await newTask(scope);
    await newDraftRecord(scope, { taskId: draftOnly });
    const noRecord = await newTask(scope);
    const foreign = await newTask(other);
    await newPublishedRecord(other, { taskId: foreign });
    expect(
      await uow.run((tx) =>
        records.listTaskIdsWithPublishedRecords(tx, [
          scope.projectId,
          other.projectId,
        ]),
      ),
    ).toEqual([published, foreign].sort((left, right) => left - right));
    expect(
      await uow.run((tx) =>
        records.listTaskIdsWithPublishedRecords(tx, [scope.projectId]),
      ),
    ).toEqual([published]);
    expect(
      await uow.run((tx) =>
        records.listTaskIdsWithPublishedRecords(
          tx,
          [scope.projectId],
          [draftOnly, noRecord],
        ),
      ),
    ).toEqual([]);
    expect(
      await uow.run((tx) =>
        records.listTaskIdsWithPublishedRecords(
          tx,
          [scope.projectId],
          [published, noRecord],
        ),
      ),
    ).toEqual([published]);
  });

  test("record read validation rejects unbounded task sets before SQL", async () => {
    const { calls, tx } = captureTransaction();
    await expect(
      records.listTaskIdsWithPublishedRecords(
        tx,
        [1],
        Array.from({ length: CHANGE_RECORD_TASK_IDS_MAX + 1 }, () => 1),
      ),
    ).rejects.toMatchObject({
      name: "ChangeRecordReadInputError",
      reason: "invalid-task-ids",
    });
    await expect(
      records.listTaskIdsWithPublishedRecords(tx, [1], [0]),
    ).rejects.toMatchObject({ reason: "invalid-task-ids" });
    await expect(
      records.listRecentPublished(tx, { projectId: 1, limit: -1 }),
    ).rejects.toBeInstanceOf(ChangeRecordReadInputError);
    await expect(
      records.listActiveLeftovers(tx, { projectId: 1, limit: 101 }),
    ).rejects.toBeInstanceOf(ChangeRecordReadInputError);
    expect(calls).toEqual([]);
    await expect(
      records.listTaskIdsWithPublishedRecords(tx, [], [1]),
    ).resolves.toEqual([]);
    await expect(
      records.listTaskIdsWithPublishedRecords(tx, [1], []),
    ).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("读端口查询计划（A 裁决 §6 冲突 B 的 EXPLAIN 上限依据）", () => {
  test("端口过滤列由既有 btree 索引覆盖，不需要新增迁移", async () => {
    const rows = await client.sql.unsafe<
      { indexname: string; indexdef: string }[]
    >(
      "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'app' AND tablename = 'tasks' AND indexname IN ('tasks_project_status_idx', 'tasks_assignee_status_idx') ORDER BY indexname",
    );
    const projectIndex = rows.find(
      (row) => row.indexname === "tasks_project_status_idx",
    );
    const assigneeIndex = rows.find(
      (row) => row.indexname === "tasks_assignee_status_idx",
    );
    expect(projectIndex?.indexdef).toContain(
      "(project_id, lifecycle_status, work_status, id)",
    );
    expect(assigneeIndex?.indexdef).toContain("(assignee_id, work_status, id)");
  });

  test("四种端口形状都命中预期索引且不回退为 Seq Scan", async () => {
    const scope = await newProject();
    const bulk = await newProject();
    await newTaskBatch(bulk, 200, 400);
    const mine = await newTask(scope, { assigneeId: scope.userId });
    const listCall = captureTransaction();
    await taskQuery.list(listCall.tx, {
      projectIds: [scope.projectId],
      limit: 21,
    });
    const countCall = captureTransaction();
    await taskQuery.count(countCall.tx, {
      projectIds: [scope.projectId, bulk.projectId],
      effectiveOnly: true,
    });
    const assigneeCall = captureTransaction();
    await taskQuery.list(assigneeCall.tx, {
      projectIds: [scope.projectId, bulk.projectId],
      assigneeId: scope.userId,
      limit: 21,
    });
    const excludedIds: number[] = [];
    for (let offset = 0; offset < TASK_EXCLUDED_IDS_MAX; offset += 1) {
      excludedIds.push(mine + offset);
    }
    expect(excludedIds).toHaveLength(TASK_EXCLUDED_IDS_MAX);
    const excludedCall = captureTransaction();
    await taskQuery.list(excludedCall.tx, {
      projectIds: [scope.projectId, bulk.projectId],
      excludedTaskIds: excludedIds,
      limit: 21,
    });

    const listPlan = await explain(listCall.calls[0]!);
    const countPlan = await explain(countCall.calls[0]!);
    const assigneePlan = await explain(assigneeCall.calls[0]!);
    const excludedPlan = await explain(excludedCall.calls[0]!);

    expect(listPlan).toContain("tasks_project_status_idx");
    expect(assigneePlan).toContain("tasks_assignee_status_idx");
    for (const plan of [listPlan, countPlan, assigneePlan, excludedPlan]) {
      expect(plan).toMatch(/Index Only Scan|Index Scan|Bitmap Heap Scan/);
      expect(plan).not.toMatch(/Seq Scan on tasks/);
    }
    expect(excludedPlan).toContain("<> ALL");
  });
});
