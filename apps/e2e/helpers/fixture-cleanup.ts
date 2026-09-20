import { pathToFileURL } from "node:url";

import postgres from "postgres";

/**
 * E2E 夹具数据物理清理。
 *
 * 夹具账号固定使用 `e2e_` / `f03_`（Playwright，`global-setup.ts`、
 * `admin-fixture.ts` 与各 spec 的既有命名）以及 `user_` / `sso_` / `login_` /
 * `invalidate_` / `csrf_`（API 集成测试 `database.helpers.createUser` 与各
 * 集成 spec 的既有命名）前缀。本模块按前缀识别夹具用户，再按其 `created_by`
 * 识别夹具项目，然后按依赖顺序物理删除全部关联业务数据、PROJECT 审计链
 * 与夹具账号，供 `global-teardown.ts` 与集成测试收尾后手动调用。
 *
 * 数据库不变量禁止物理删除任何项目的 UNCLASSIFIED 模块
 * （`app.protect_unclassified_module`），因此删除只在清理会话内以
 * `session_replication_role = replica` 关闭行级触发器与外键检查后执行；
 * 删除结束后立即用内置断言复核：夹具残留为 0、审计无悬空 actor、
 * 项目 bootstrap 成员关系完整、每个项目恰好一个 UNCLASSIFIED 模块。
 * 任一断言失败都会回滚整个事务。该入口只清理测试夹具，不得用于生产数据。
 *
 * SYSTEM 链中夹具账号产生的记录会一并删除，并把链头回退到剩余的最后一条
 * 记录；若夹具记录之后已写入真实用户记录，链上会留下一个可检测的断点
 * （`systemChainBroken` 报告并打印提示），因为删除链中段无法在保持哈希链
 * 完整的前提下完成。
 */
export interface FixtureCleanupReport {
  readonly fixtureUsers: number;
  readonly fixtureProjects: number;
  readonly deletedRows: number;
  readonly auditRowsDeleted: number;
  readonly systemChainRewound: boolean;
  readonly systemChainBroken: boolean;
}

/**
 * 夹具账号过滤条件（`\_` 匹配字面下划线）。
 * `e2e_` / `f03_` 来自 Playwright 夹具；`user_`（`database.helpers.createUser`）、
 * `sso_`、`login_`、`invalidate_`、`csrf_` 来自 API 集成测试的夹具命名。
 */
const FIXTURE_LOGIN_FILTER = [
  "login_name LIKE 'e2e\\_%'",
  "login_name LIKE 'f03\\_%'",
  "login_name LIKE 'user\\_%'",
  "login_name LIKE 'sso\\_%'",
  "login_name LIKE 'login\\_%'",
  "login_name LIKE 'invalidate\\_%'",
  "login_name LIKE 'csrf\\_%'",
].join(" OR ");

export function formatFixtureCleanupReport(
  report: FixtureCleanupReport,
): string {
  if (report.fixtureUsers === 0) {
    return "[e2e] 夹具清理：未发现 E2E 夹具数据";
  }
  let message =
    `[e2e] 夹具清理：删除用户 ${report.fixtureUsers}、项目 ${report.fixtureProjects}` +
    `、业务行 ${report.deletedRows}、审计行 ${report.auditRowsDeleted}`;
  if (report.systemChainRewound) {
    message += "；SYSTEM 链头已回退到剩余的最后一条记录";
  }
  if (report.systemChainBroken) {
    message +=
      "；注意 SYSTEM 链留下一个断点：夹具记录之后已有真实写入，删除中段无法保持哈希链完整";
  }
  return message;
}

export async function cleanupFixtures(
  databaseUrl: string,
): Promise<FixtureCleanupReport> {
  const sql = postgres(databaseUrl, {
    max: 1,
    connection: { application_name: "inpulse-e2e-cleanup" },
    onnotice: () => undefined,
  });
  try {
    return await sql.begin(async (transaction) => {
      await transaction.unsafe("SET LOCAL session_replication_role = replica");
      await transaction.unsafe(
        `CREATE TEMP TABLE _cleanup_users ON COMMIT DROP AS
           SELECT id FROM app.users WHERE ${FIXTURE_LOGIN_FILTER}`,
      );
      await transaction.unsafe(
        `CREATE TEMP TABLE _cleanup_projects ON COMMIT DROP AS
           SELECT id FROM app.projects
            WHERE created_by IN (SELECT id FROM _cleanup_users)`,
      );

      const userRows = await transaction.unsafe(
        "SELECT count(*)::int AS n FROM _cleanup_users",
      );
      const projectRows = await transaction.unsafe(
        "SELECT count(*)::int AS n FROM _cleanup_projects",
      );
      const fixtureUsers = Number(userRows[0]?.["n"] ?? 0);
      const fixtureProjects = Number(projectRows[0]?.["n"] ?? 0);

      if (fixtureUsers === 0) {
        return {
          fixtureUsers: 0,
          fixtureProjects: 0,
          deletedRows: 0,
          auditRowsDeleted: 0,
          systemChainRewound: false,
          systemChainBroken: false,
        } satisfies FixtureCleanupReport;
      }

      let deletedRows = 0;
      // 非夹具项目在清理前的不变量计数：删除动作不得让它变差。
      const beforeInvariants = await transaction.unsafe(
        `SELECT
           (SELECT count(*)::int FROM app.projects p
             WHERE p.id NOT IN (SELECT id FROM _cleanup_projects)
               AND NOT EXISTS (
                 SELECT 1 FROM app.project_members m
                  WHERE m.project_id = p.id
                    AND m.user_id = p.created_by
                    AND m.joined_at = p.created_at
               )) AS broken_bootstrap,
           (SELECT count(*)::int FROM (
             SELECT p.id
               FROM app.projects p
               LEFT JOIN app.modules m
                 ON m.project_id = p.id AND m.kind = 'UNCLASSIFIED'
              WHERE p.id NOT IN (SELECT id FROM _cleanup_projects)
              GROUP BY p.id
             HAVING count(m.id) <> 1
           ) missing) AS missing_unclassified`,
      );
      const remove = async (statement: string): Promise<number> => {
        const result = await transaction.unsafe(statement);
        const affected = Number(result.count ?? 0);
        deletedRows += affected;
        return affected;
      };

      await remove(
        `DELETE FROM app.notifications
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR recipient_id IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.activity_projection
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR actor_id IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.search_projection
          WHERE project_id IN (SELECT id FROM _cleanup_projects)`,
      );
      await remove(
        `DELETE FROM app.task_external_links
          WHERE project_id IN (SELECT id FROM _cleanup_projects)`,
      );
      await remove(
        `DELETE FROM app.feature_external_links
          WHERE project_id IN (SELECT id FROM _cleanup_projects)`,
      );
      await remove(
        `DELETE FROM app.change_record_external_links
          WHERE project_id IN (SELECT id FROM _cleanup_projects)`,
      );
      await remove(
        `DELETE FROM app.project_external_links
          WHERE project_id IN (SELECT id FROM _cleanup_projects)`,
      );
      await remove(
        `DELETE FROM app.leftover_task_links
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR created_by IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.external_links
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR created_by IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.change_record_version_leftovers
          WHERE project_id IN (SELECT id FROM _cleanup_projects)`,
      );
      await remove(
        `DELETE FROM app.change_record_versions
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR created_by IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.change_record_leftover_items
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR created_by IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.change_record_feature_impacts
          WHERE project_id IN (SELECT id FROM _cleanup_projects)`,
      );
      await remove(
        `DELETE FROM app.change_records
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR author_id IN (SELECT id FROM _cleanup_users)
             OR handler_id IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.task_feature_impacts
          WHERE project_id IN (SELECT id FROM _cleanup_projects)`,
      );
      await remove(
        `DELETE FROM app.task_status_history
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR changed_by IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.task_group_members
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR original_assignee_id IN (SELECT id FROM _cleanup_users)
             OR detached_by IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.task_groups
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR created_by IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.tasks
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR assignee_id IN (SELECT id FROM _cleanup_users)
             OR creator_id IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.features
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR created_by IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.modules
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR created_by IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.project_archive_requests
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR requested_by IN (SELECT id FROM _cleanup_users)
             OR decided_by IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.project_members
          WHERE project_id IN (SELECT id FROM _cleanup_projects)
             OR user_id IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.projects
          WHERE id IN (SELECT id FROM _cleanup_projects)`,
      );
      await remove(
        `DELETE FROM app.code_sequences
          WHERE project_id IN (SELECT id FROM _cleanup_projects)`,
      );

      const projectChainRows = await remove(
        `DELETE FROM app.audit_logs
          WHERE chain_id LIKE 'PROJECT:%'
            AND project_id IN (SELECT id FROM _cleanup_projects)`,
      );
      await remove(
        `DELETE FROM app.audit_chain_heads
          WHERE project_id IN (SELECT id FROM _cleanup_projects)`,
      );
      const systemRows = await remove(
        `DELETE FROM app.audit_logs
          WHERE chain_id = 'SYSTEM'
            AND actor_id IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.idempotency_records
          WHERE actor_id IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.session_csrf_tokens
          WHERE session_id IN (
            SELECT id FROM app.user_sessions
             WHERE user_id IN (SELECT id FROM _cleanup_users)
          )`,
      );
      await remove(
        `DELETE FROM app.user_sessions
          WHERE user_id IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.user_totp_factors
          WHERE user_id IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.mfa_recovery_codes
          WHERE user_id IN (SELECT id FROM _cleanup_users)`,
      );
      await remove(
        `DELETE FROM app.users WHERE id IN (SELECT id FROM _cleanup_users)`,
      );

      // 夹具用户删除后才可能出现悬空 actor；覆盖全部链，含缺失 project_id 的 PROJECT 链行。
      const strayRows = await remove(
        `DELETE FROM app.audit_logs
          WHERE actor_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM app.users u WHERE u.id = app.audit_logs.actor_id
            )`,
      );

      const rewind = await transaction.unsafe(
        `UPDATE app.audit_chain_heads h
            SET last_sequence = t.sequence_no,
                last_hash = t.record_hash,
                updated_at = t.occurred_at
           FROM (
             SELECT sequence_no, record_hash, occurred_at
               FROM app.audit_logs
              WHERE chain_id = 'SYSTEM'
              ORDER BY sequence_no DESC
              LIMIT 1
           ) t
          WHERE h.chain_id = 'SYSTEM'
            AND h.last_sequence > t.sequence_no`,
      );
      const systemChainRewound = Number(rewind.count ?? 0) > 0;

      await transaction.unsafe(
        `SELECT setval('app.users_id_seq',
                       coalesce((SELECT max(id) FROM app.users), 0) + 1,
                       false)`,
      );
      await transaction.unsafe(
        `SELECT setval('app.projects_id_seq',
                       coalesce((SELECT max(id) FROM app.projects), 0) + 1,
                       false)`,
      );

      let systemChainBroken = false;
      if (systemRows > 0) {
        const breaks = await transaction.unsafe(
          `SELECT count(*)::int AS n
             FROM app.audit_logs a
            WHERE a.chain_id = 'SYSTEM'
              AND a.sequence_no > 1
              AND NOT EXISTS (
                SELECT 1 FROM app.audit_logs b
                 WHERE b.chain_id = a.chain_id
                   AND b.sequence_no = a.sequence_no - 1
                   AND b.record_hash = a.prev_hash
              )`,
        );
        systemChainBroken = Number(breaks[0]?.["n"] ?? 0) > 0;
      }

      const checkRows = await transaction.unsafe(
        `SELECT
           (SELECT count(*)::int FROM app.users
             WHERE ${FIXTURE_LOGIN_FILTER}) AS remaining_users,
           (SELECT count(*)::int FROM app.projects
             WHERE id IN (SELECT id FROM _cleanup_projects))
             AS remaining_projects,
           (SELECT count(*)::int FROM app.audit_logs l
             WHERE l.actor_id IS NOT NULL
               AND NOT EXISTS (
                 SELECT 1 FROM app.users u WHERE u.id = l.actor_id
               )) AS dangling_audit_actors,
           (SELECT count(*)::int FROM app.projects p
             WHERE NOT EXISTS (
               SELECT 1 FROM app.project_members m
                WHERE m.project_id = p.id
                  AND m.user_id = p.created_by
                  AND m.joined_at = p.created_at
             )) AS broken_bootstrap,
           (SELECT count(*)::int FROM (
             SELECT p.id
               FROM app.projects p
               LEFT JOIN app.modules m
                 ON m.project_id = p.id AND m.kind = 'UNCLASSIFIED'
              GROUP BY p.id
             HAVING count(m.id) <> 1
           ) missing) AS missing_unclassified`,
      );
      const checks = (checkRows[0] ?? {}) as Record<string, number>;
      const before = (beforeInvariants[0] ?? {}) as Record<string, number>;
      const failedChecks = [
        // 夹具残留与悬空审计 actor 必须为 0。
        ...[
          "remaining_users",
          "remaining_projects",
          "dangling_audit_actors",
        ].filter((key) => Number(checks[key] ?? 0) !== 0),
        // 项目不变量只要求清理未让计数变差：本地库可能存在规范化之前建立的历史项目。
        ...["broken_bootstrap", "missing_unclassified"].filter(
          (key) => Number(checks[key] ?? 0) > Number(before[key] ?? 0),
        ),
      ];
      if (failedChecks.length > 0) {
        throw new Error(
          `夹具清理后完整性断言失败：${failedChecks
            .map((key) => `${key}=${String(checks[key])}`)
            .join(", ")}`,
        );
      }

      return {
        fixtureUsers,
        fixtureProjects,
        deletedRows,
        auditRowsDeleted: projectChainRows + systemRows + strayRows,
        systemChainRewound,
        systemChainBroken,
      } satisfies FixtureCleanupReport;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  const databaseUrl =
    process.env["E2E_DATABASE_URL"]?.trim() ??
    process.env["TEST_DATABASE_URL"]?.trim();
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    console.error(
      "[e2e] 需要 E2E_DATABASE_URL 或 TEST_DATABASE_URL（bootstrap 角色）才能清理夹具数据",
    );
    process.exitCode = 1;
  } else {
    const report = await cleanupFixtures(databaseUrl);
    console.log(formatFixtureCleanupReport(report));
  }
}
