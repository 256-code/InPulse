import postgres from "postgres";

import { requiredE2eDatabaseUrl } from "./runtime.js";

export async function resetAdminTotpReplayStep(userId: number): Promise<void> {
  const sql = postgres(requiredE2eDatabaseUrl(), {
    max: 1,
    connection: { application_name: "inpulse-e2e-totp-reset" },
    onnotice: () => undefined,
  });
  try {
    await sql`
      UPDATE app.user_totp_factors
         SET last_accepted_step = NULL
       WHERE user_id = ${userId}
         AND status = 'ACTIVE'
    `;
  } finally {
    await sql.end({ timeout: 5 });
  }
}
