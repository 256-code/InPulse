import { randomBytes } from "node:crypto";
import { hash as argon2Hash } from "@node-rs/argon2";
import { test as base } from "@playwright/test";
import postgres from "postgres";
import {
  loadRuntime,
  requiredE2eDatabaseUrl,
  type E2EAccount,
} from "./runtime.js";

export interface AdminFixture {
  readonly userId: number;
  readonly account: E2EAccount;
}

// Test-scoped fixtures are recreated for every test attempt, including retries.
export const test = base.extend<{ admin: AdminFixture }>({
  admin: async ({ baseURL }, use) => {
    const runtime = await loadRuntime();
    if (baseURL !== runtime.webBaseUrl)
      throw new Error("Admin fixture base URL mismatch");
    const sql = postgres(requiredE2eDatabaseUrl(), {
      max: 1,
      onnotice: () => undefined,
    });
    const suffix = randomBytes(10).toString("hex");
    const account = {
      loginName: `e2e_admin_${suffix}`,
      name: `E2E Admin ${suffix}`,
      password: randomBytes(24).toString("hex"),
    };
    let userId: number | undefined;
    try {
      const passwordHash = await argon2Hash(account.password, {
        memoryCost: 19 * 1024,
        timeCost: 2,
        parallelism: 1,
        outputLen: 32,
        algorithm: 2,
      });
      const [user] = await sql<
        { id: number }[]
      >`INSERT INTO app.users (login_name, name, password_hash, is_admin, status) VALUES (${account.loginName}, ${account.name}, ${passwordHash}, true, 'ACTIVE') RETURNING id`;
      if (!user) throw new Error("Admin fixture insert returned no row");
      const fixtureId = user.id;
      userId = fixtureId;
      await use({ userId: fixtureId, account });
    } finally {
      try {
        if (userId !== undefined) {
          const fixtureUserId = userId;
          // Only this attempt's transient sessions; retain user/audit history.
          await sql`DELETE FROM app.user_sessions WHERE user_id = ${fixtureUserId}`;
        }
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
  },
});
