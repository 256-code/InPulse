import { randomUUID } from "node:crypto";

import postgres, { type Sql } from "postgres";

export interface TestUrls {
  readonly archive: string;
  readonly auditReader: string;
  readonly backup: string;
  readonly bootstrap: string;
  readonly migrator: string;
  readonly runtime: string;
}

export interface ProjectFixture {
  readonly code: string;
  readonly moduleId: number;
  readonly projectId: number;
  readonly userId: number;
}

let fixtureCounter = 0;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `Set ${name}; PostgreSQL integration tests never silently skip`,
    );
  }
  return value;
}

function roleUrl(baseUrl: string, role: string): string {
  const url = new URL(baseUrl);
  url.username = role;
  url.password = "";
  return url.toString();
}

export function testUrls(): TestUrls {
  const baseUrl = required("TEST_DATABASE_URL");
  return {
    archive:
      process.env.TEST_AUDIT_ARCHIVE_DATABASE_URL?.trim() ||
      roleUrl(baseUrl, "audit_archive_writer"),
    auditReader:
      process.env.TEST_AUDIT_READER_DATABASE_URL?.trim() ||
      roleUrl(baseUrl, "audit_reader"),
    backup:
      process.env.TEST_BACKUP_DATABASE_URL?.trim() ||
      roleUrl(baseUrl, "app_backup"),
    bootstrap:
      process.env.TEST_BOOTSTRAP_DATABASE_URL?.trim() ||
      roleUrl(baseUrl, "cluster_bootstrap"),
    migrator:
      process.env.TEST_MIGRATOR_DATABASE_URL?.trim() ||
      roleUrl(baseUrl, "app_migrator"),
    runtime:
      process.env.TEST_RUNTIME_DATABASE_URL?.trim() ||
      roleUrl(baseUrl, "app_runtime"),
  };
}

export function connect(url: string, max = 10): Sql {
  return postgres(url, {
    connection: { application_name: "inpulse-search-query-test" },
    max,
    onnotice: () => undefined,
    prepare: false,
  });
}

function nextToken(prefix: string): string {
  fixtureCounter += 1;
  const randomSuffix = randomUUID().replaceAll("-", "").slice(0, 12);
  return `${prefix}${Date.now().toString(36)}${fixtureCounter.toString(36)}${randomSuffix}`;
}

export async function createUser(
  sql: Sql,
  options: { readonly admin?: boolean; readonly disabled?: boolean } = {},
): Promise<number> {
  const loginName = nextToken("user_").toLowerCase();
  const status = options.disabled === true ? "DISABLED" : "ACTIVE";
  const [row] = await sql<Array<{ id: number }>>`
    INSERT INTO app.users (
      login_name,
      name,
      password_hash,
      is_admin,
      status,
      disabled_at
    )
    VALUES (
      ${loginName},
      ${`Test ${loginName}`},
      ${"$argon2id$v=19$m=19456,t=2,p=1$fixture$fixture-hash"},
      ${options.admin === true},
      ${status},
      ${options.disabled === true ? new Date() : null}
    )
    RETURNING id
  `;
  if (!row) {
    throw new Error("User fixture insert returned no row");
  }
  return row.id;
}

export async function createProject(
  sql: Sql,
  userId: number,
): Promise<ProjectFixture> {
  const code = nextToken("P").toUpperCase().slice(0, 24);

  return sql.begin(async (transaction) => {
    const [project] = await transaction<Array<{ id: number }>>`
      INSERT INTO app.projects (code, name, created_by)
      VALUES (${code}, ${`Project ${code}`}, ${userId})
      RETURNING id
    `;
    if (!project) {
      throw new Error("Project fixture insert returned no row");
    }

    await transaction`
      INSERT INTO app.project_members (project_id, user_id)
      VALUES (${project.id}, ${userId})
    `;
    const [module] = await transaction<Array<{ id: number }>>`
      INSERT INTO app.modules (
        project_id,
        name,
        kind,
        created_by
      )
      VALUES (
        ${project.id},
        '未分类',
        'UNCLASSIFIED',
        ${userId}
      )
      RETURNING id
    `;
    if (!module) {
      throw new Error("Module fixture insert returned no row");
    }

    return {
      code,
      moduleId: module.id,
      projectId: project.id,
      userId,
    };
  });
}

export async function removeMember(
  sql: Sql,
  projectId: number,
  userId: number,
): Promise<void> {
  await sql`
    UPDATE app.project_members
       SET status = 'REMOVED',
           removed_at = now()
     WHERE project_id = ${projectId}
       AND user_id = ${userId}
       AND status = 'ACTIVE'
  `;
}
