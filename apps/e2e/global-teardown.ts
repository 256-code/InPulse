import { rm } from "node:fs/promises";

import postgres from "postgres";

import {
  E2E_KEYRING_DIR,
  loadRuntime,
  requiredE2eDatabaseUrl,
  RUNTIME_FILE,
  type E2ERuntime,
} from "./helpers/runtime.js";

async function cleanupFixture(
  databaseUrl: string,
  runtime: E2ERuntime,
): Promise<void> {
  const sql = postgres(databaseUrl, {
    max: 1,
    connection: { application_name: "inpulse-e2e-teardown" },
    onnotice: () => undefined,
  });
  try {
    await sql.begin(async (transaction) => {
      await transaction`
        DELETE FROM app.notifications
        WHERE recipient_id = ${runtime.userId}
           OR project_id = ${runtime.projectId}
      `;
      await transaction`
        DELETE FROM app.activity_projection
        WHERE actor_id = ${runtime.userId}
           OR project_id = ${runtime.projectId}
      `;
      await transaction`
        DELETE FROM app.search_projection
        WHERE project_id = ${runtime.projectId}
      `;
      await transaction`
        DELETE FROM app.idempotency_records
        WHERE actor_id = ${runtime.userId}
      `;
      await transaction`
        DELETE FROM app.user_sessions
        WHERE user_id = ${runtime.userId}
      `;
      await transaction`
        DELETE FROM app.user_totp_factors
        WHERE user_id = ${runtime.userId}
      `;
      await transaction`
        DELETE FROM app.mfa_recovery_codes
        WHERE user_id = ${runtime.userId}
      `;
      await transaction`
        DELETE FROM app.idempotency_records
        WHERE actor_id = ${runtime.adminMfaUserId}
      `;
      await transaction`
        DELETE FROM app.user_sessions
        WHERE user_id = ${runtime.adminMfaUserId}
      `;
      await transaction`
        DELETE FROM app.user_totp_factors
        WHERE user_id = ${runtime.adminMfaUserId}
      `;
      await transaction`
        DELETE FROM app.mfa_recovery_codes
        WHERE user_id = ${runtime.adminMfaUserId}
      `;
    });
  } finally {
    await sql.end({ timeout: 5 });
  }
}

export default async function globalTeardown(): Promise<void> {
  let runtime: E2ERuntime | undefined;
  try {
    try {
      runtime = await loadRuntime();
    } catch {
      // Setup may have failed before writing runtime state.
    }
    if (runtime !== undefined) {
      await cleanupFixture(requiredE2eDatabaseUrl(), runtime);
    }
  } finally {
    await Promise.all([
      rm(E2E_KEYRING_DIR, { recursive: true, force: true }),
      rm(RUNTIME_FILE, { force: true }),
    ]);
  }
}
