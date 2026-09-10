import { randomBytes } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { hash as argon2Hash } from "@node-rs/argon2";
import postgres from "postgres";

import { normalizeSearchText } from "../api/src/modules/search/search-text.js";

import {
  parseCookieValue,
  requiredE2eDatabaseUrl,
  RUNTIME_FILE,
  type E2ERuntime,
} from "./helpers/runtime.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const API_PORT = parsePort(process.env["E2E_API_PORT"], 3100);
const WEB_PORT = parsePort(process.env["E2E_WEB_PORT"], 4173);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
const FIXTURE_PASSWORD = "e2e-fixture-password";

function parsePort(value: string | undefined, fallback: number): number {
  const port = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return fallback;
  }
  return port;
}

function headersFromFetch(headers: Headers): readonly string[] {
  const getSetCookie = (
    headers as Headers & { readonly getSetCookie?: () => string[] }
  ).getSetCookie;
  if (typeof getSetCookie === "function") {
    return getSetCookie.call(headers);
  }
  return (headers.get("set-cookie") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

async function waitFor(
  probe: () => Promise<boolean>,
  label: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      if (await probe()) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `Timed out waiting for ${label}${
      lastError === undefined ? "" : `: ${String(lastError)}`
    }`,
  );
}

async function loginViaApi(
  loginName: string,
  password: string,
): Promise<string> {
  const csrfResponse = await fetch(`${API_BASE_URL}/api/v1/auth/csrf`, {
    headers: { origin: API_BASE_URL },
  });
  if (!csrfResponse.ok) {
    throw new Error(`CSRF issuance failed with HTTP ${csrfResponse.status}`);
  }
  const csrf = (await csrfResponse.json()) as { readonly csrfToken: string };
  const preauthCookie = headersFromFetch(csrfResponse.headers)
    .map((value) => parseCookieValue(value, "__Host-preauth"))
    .find((value) => value !== undefined);
  if (preauthCookie === undefined) {
    throw new Error("CSRF response did not include __Host-preauth cookie");
  }

  const loginResponse = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `__Host-preauth=${preauthCookie}`,
      origin: API_BASE_URL,
      "x-csrf-token": csrf.csrfToken,
    },
    body: JSON.stringify({ loginName, password }),
  });
  if (!loginResponse.ok) {
    throw new Error(`Login failed with HTTP ${loginResponse.status}`);
  }
  const login = (await loginResponse.json()) as {
    readonly authState: string;
  };
  if (login.authState !== "AUTHENTICATED") {
    throw new Error(`Unexpected login auth state: ${login.authState}`);
  }

  const sessionCookie = headersFromFetch(loginResponse.headers)
    .map((value) => parseCookieValue(value, "__Host-session"))
    .find((value) => value !== undefined);
  if (sessionCookie === undefined) {
    throw new Error("Login response did not include __Host-session cookie");
  }
  return sessionCookie;
}

async function seedFixture(databaseUrl: string): Promise<{
  readonly userId: number;
  readonly memberId: number;
  readonly projectId: number;
  readonly searchQuery: string;
  readonly projectTitle: string;
  readonly projectName: string;
  readonly hiddenProjectId: number;
  readonly hiddenProjectTitle: string;
  readonly hiddenSearchQuery: string;
  readonly pageSearchQuery: string;
  readonly pageSearchTotal: number;
  readonly chineseSearchQuery: string;
  readonly chineseSearchTitle: string;
  readonly specialSearchQuery: string;
  readonly specialSearchTitle: string;
  readonly missingSearchQuery: string;
  readonly loginName: string;
  readonly name: string;
  readonly memberLoginName: string;
  readonly memberName: string;
}> {
  const sql = postgres(databaseUrl, {
    max: 1,
    connection: { application_name: "inpulse-e2e-setup" },
    onnotice: () => undefined,
  });
  try {
    const suffix = randomBytes(5).toString("hex").toLowerCase();
    const loginName = `e2e_${suffix}`;
    const name = `E2E 用户 ${suffix}`;
    const passwordHash = await argon2Hash(FIXTURE_PASSWORD, {
      memoryCost: 19 * 1024,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
      algorithm: 2,
    });
    const users = (await sql<readonly { id: number }[]>`
      INSERT INTO app.users (
        login_name,
        name,
        password_hash,
        is_admin,
        status
      )
      VALUES (
        ${loginName},
        ${name},
        ${passwordHash},
        false,
        'ACTIVE'
      )
      RETURNING id
    `) as unknown as readonly { id: number }[];
    const user = users[0];
    if (user === undefined) {
      throw new Error("E2E user fixture insert returned no row");
    }

    const memberSuffix = randomBytes(5).toString("hex").toLowerCase();
    const memberLoginName = `e2e_member_${memberSuffix}`;
    const memberName = `E2E 成员 ${memberSuffix}`;
    const memberPasswordHash = await argon2Hash(FIXTURE_PASSWORD, {
      memoryCost: 19 * 1024,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
      algorithm: 2,
    });
    const members = (await sql<readonly { id: number }[]>`
      INSERT INTO app.users (
        login_name,
        name,
        password_hash,
        is_admin,
        status
      )
      VALUES (
        ${memberLoginName},
        ${memberName},
        ${memberPasswordHash},
        false,
        'ACTIVE'
      )
      RETURNING id
    `) as unknown as readonly { id: number }[];
    const member = members[0];
    if (member === undefined) {
      throw new Error("E2E member fixture insert returned no row");
    }

    const code = `E2E${randomBytes(5).toString("hex").toUpperCase()}`;
    const projectName = `E2E Playwright 项目 ${code}`;
    const projectId = await sql.begin(async (transaction) => {
      const projects = (await transaction<readonly { id: number }[]>`
        INSERT INTO app.projects (code, name, created_by)
        VALUES (${code}, ${projectName}, ${user.id})
        RETURNING id
      `) as unknown as readonly { id: number }[];
      const project = projects[0];
      if (project === undefined) {
        throw new Error("E2E project fixture insert returned no row");
      }

      await transaction`
        INSERT INTO app.project_members (project_id, user_id)
        VALUES (${project.id}, ${user.id})
      `;
      await transaction`
        INSERT INTO app.modules (project_id, name, kind, created_by)
        VALUES (${project.id}, '未分类', 'UNCLASSIFIED', ${user.id})
      `;
      return project.id;
    });

    const searchQuery = `e2e${randomBytes(3).toString("hex")}`;
    const projectTitle = `E2E 可搜索项目 ${code}`;
    const projectSearchText = `${projectTitle} ${searchQuery}`;
    await sql`
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
        'PROJECT',
        ${projectId},
        ${projectTitle},
        'Playwright E2E fixture',
        ${projectSearchText},
        ${normalizeSearchText(projectSearchText)},
        'MEMBER',
        'ACTIVE',
        1
      )
    `;

    const hiddenCode = `E2EH${randomBytes(5).toString("hex").toUpperCase()}`;
    const hiddenProjectId = await sql.begin(async (transaction) => {
      const hiddenProjectRows = (await transaction<readonly { id: number }[]>`
        INSERT INTO app.projects (code, name, created_by)
        VALUES (${hiddenCode}, ${`E2E 隐藏项目 ${hiddenCode}`}, ${member.id})
        RETURNING id
      `) as unknown as readonly { id: number }[];
      const hiddenProject = hiddenProjectRows[0];
      if (hiddenProject === undefined) {
        throw new Error("E2E hidden project fixture insert returned no row");
      }
      await transaction`
        INSERT INTO app.project_members (project_id, user_id)
        VALUES (${hiddenProject.id}, ${member.id})
      `;
      await transaction`
        INSERT INTO app.modules (project_id, name, kind, created_by)
        VALUES (${hiddenProject.id}, '未分类', 'UNCLASSIFIED', ${member.id})
      `;
      return hiddenProject.id;
    });
    const hiddenProjectTitle = `E2E 隐藏项目 ${hiddenCode}`;
    const hiddenSearchQuery = `e2ehidden${randomBytes(3).toString("hex")}`;
    await sql`
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
        ${hiddenProjectId},
        'PROJECT',
        ${hiddenProjectId},
        ${hiddenProjectTitle},
        'Playwright hidden search fixture',
        ${hiddenProjectTitle},
        ${hiddenSearchQuery},
        'MEMBER',
        'ACTIVE',
        1
      )
    `;

    const pageSearchQuery = `e2epage${randomBytes(3).toString("hex")}`;
    const pageSearchTotal = 25;
    for (let index = 0; index < pageSearchTotal; index += 1) {
      const pageTitle = `E2E 分页任务 ${String(index + 1).padStart(2, "0")} ${code}`;
      await sql`
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
          'TASK',
          ${2_000_000 + index},
          ${pageTitle},
          'Playwright pagination fixture',
          ${`${pageTitle} ${pageSearchQuery}`},
          ${pageSearchQuery},
          'MEMBER',
          'ACTIVE',
          1
        )
      `;
    }

    const chineseSearchQuery = "退款";
    const chineseSearchTitle = `E2E 中文短词搜索 ${code}`;
    await sql`
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
        'TASK',
        3000002,
        ${chineseSearchTitle},
        'Playwright Chinese fixture',
        ${chineseSearchTitle},
        '退款回调重复处理',
        'MEMBER',
        'ACTIVE',
        1
      )
    `;

    const specialSearchQuery = `e2e-refund-${randomBytes(3).toString("hex")}`;
    const specialSearchTitle = `E2E 特殊标识符搜索 ${specialSearchQuery}`;
    await sql`
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
        'TASK',
        3000003,
        ${specialSearchTitle},
        'Playwright special identifier fixture',
        ${specialSearchTitle},
        ${specialSearchQuery},
        'MEMBER',
        'ACTIVE',
        1
      )
    `;

    const missingSearchQuery = `e2emissing${randomBytes(4).toString("hex")}`;

    return {
      userId: user.id,
      memberId: member.id,
      projectId,
      searchQuery,
      projectTitle,
      projectName,
      hiddenProjectId,
      hiddenProjectTitle,
      hiddenSearchQuery,
      pageSearchQuery,
      pageSearchTotal,
      chineseSearchQuery,
      chineseSearchTitle,
      specialSearchQuery,
      specialSearchTitle,
      missingSearchQuery,
      loginName,
      name,
      memberLoginName,
      memberName,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export default async function globalSetup(): Promise<void> {
  const apiEntry = path.resolve(ROOT, "apps/api/dist/main.js");
  await access(apiEntry);

  await waitFor(
    async () => {
      const response = await fetch(`${API_BASE_URL}/api/v1/health`);
      return response.ok;
    },
    "API health",
    120_000,
  );
  await waitFor(
    async () => {
      const response = await fetch(`${WEB_BASE_URL}/login`);
      return response.ok;
    },
    "web dev server",
    120_000,
  );

  const fixture = await seedFixture(requiredE2eDatabaseUrl());
  const sessionCookie = await loginViaApi(fixture.loginName, FIXTURE_PASSWORD);

  await mkdir(path.dirname(RUNTIME_FILE), { recursive: true });
  const runtime: E2ERuntime = {
    apiBaseUrl: API_BASE_URL,
    webBaseUrl: WEB_BASE_URL,
    userId: fixture.userId,
    projectId: fixture.projectId,
    searchQuery: fixture.searchQuery,
    projectTitle: fixture.projectTitle,
    projectName: fixture.projectName,
    hiddenProjectId: fixture.hiddenProjectId,
    hiddenProjectTitle: fixture.hiddenProjectTitle,
    hiddenSearchQuery: fixture.hiddenSearchQuery,
    pageSearchQuery: fixture.pageSearchQuery,
    pageSearchTotal: fixture.pageSearchTotal,
    chineseSearchQuery: fixture.chineseSearchQuery,
    chineseSearchTitle: fixture.chineseSearchTitle,
    specialSearchQuery: fixture.specialSearchQuery,
    specialSearchTitle: fixture.specialSearchTitle,
    missingSearchQuery: fixture.missingSearchQuery,
    sessionCookie,
    user: {
      loginName: fixture.loginName,
      name: fixture.name,
      password: FIXTURE_PASSWORD,
    },
    member: {
      loginName: fixture.memberLoginName,
      name: fixture.memberName,
      password: FIXTURE_PASSWORD,
    },
  };
  await writeFile(RUNTIME_FILE, `${JSON.stringify(runtime, null, 2)}\n`);
}
