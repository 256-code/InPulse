import { randomBytes } from "node:crypto";
import { hash as argon2Hash } from "@node-rs/argon2";
import { test as base } from "@playwright/test";
import postgres from "postgres";
import {
  loadRuntime,
  parseCookieValue,
  requiredE2eDatabaseUrl,
  type E2EAccount,
} from "./runtime.js";
import { totpCode } from "./totp.js";

interface MfaAdminFixture {
  readonly account: E2EAccount;
  readonly secret: string;
}

// Test-scoped fixtures are recreated for every test attempt, including retries.
export const test = base.extend<{ mfaAdmin: MfaAdminFixture }>({
  mfaAdmin: async ({ baseURL }, use) => {
    const runtime = await loadRuntime();
    if (baseURL !== runtime.webBaseUrl)
      throw new Error("MFA fixture base URL mismatch");
    const sql = postgres(requiredE2eDatabaseUrl(), {
      max: 1,
      onnotice: () => undefined,
    });
    const suffix = randomBytes(10).toString("hex");
    const account = {
      loginName: `e2e_mfa_${suffix}`,
      name: `E2E MFA ${suffix}`,
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
      if (!user) throw new Error("MFA fixture insert returned no row");
      userId = user.id;
      const secret = await enrollAdminViaApi(
        runtime.apiBaseUrl,
        account.loginName,
        account.password,
      );
      await use({ account, secret });
    } finally {
      try {
        if (userId !== undefined) {
          const fixtureUserId = userId;
          // Only this attempt's transient auth material; retain user/audit history.
          await sql.begin(async (tx) => {
            await tx`DELETE FROM app.user_sessions WHERE user_id = ${fixtureUserId}`;
            await tx`DELETE FROM app.mfa_recovery_codes WHERE user_id = ${fixtureUserId}`;
            await tx`DELETE FROM app.user_totp_factors WHERE user_id = ${fixtureUserId}`;
          });
        }
      } finally {
        await sql.end({ timeout: 5 });
      }
    }
  },
});

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

async function enrollAdminViaApi(
  apiBaseUrl: string,
  loginName: string,
  password: string,
): Promise<string> {
  const csrfResponse = await fetch(`${apiBaseUrl}/api/v1/auth/csrf`, {
    headers: { origin: apiBaseUrl },
  });
  if (!csrfResponse.ok) {
    throw new Error(
      `Admin CSRF issuance failed with HTTP ${csrfResponse.status}`,
    );
  }
  const csrf = (await csrfResponse.json()) as { readonly csrfToken: string };
  const preauthCookie = headersFromFetch(csrfResponse.headers)
    .map((value) => parseCookieValue(value, "__Host-preauth"))
    .find((value) => value !== undefined);
  if (preauthCookie === undefined) {
    throw new Error(
      "Admin CSRF response did not include __Host-preauth cookie",
    );
  }

  const loginResponse = await fetch(`${apiBaseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `__Host-preauth=${preauthCookie}`,
      origin: apiBaseUrl,
      "x-csrf-token": csrf.csrfToken,
    },
    body: JSON.stringify({ loginName, password }),
  });
  if (!loginResponse.ok) {
    throw new Error(`Admin MFA login failed with HTTP ${loginResponse.status}`);
  }
  const login = (await loginResponse.json()) as {
    readonly authState: string;
    readonly csrfToken: string;
    readonly enrollmentGeneration?: number;
  };
  if (
    login.authState !== "MFA_ENROLLMENT" ||
    login.enrollmentGeneration === undefined
  ) {
    throw new Error(`Unexpected admin MFA login state: ${login.authState}`);
  }
  const sessionCookie = headersFromFetch(loginResponse.headers)
    .map((value) => parseCookieValue(value, "__Host-session"))
    .find((value) => value !== undefined);
  if (sessionCookie === undefined) {
    throw new Error(
      "Admin MFA login response did not include __Host-session cookie",
    );
  }

  const startResponse = await fetch(
    `${apiBaseUrl}/api/v1/auth/mfa/enrollment/start`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `__Host-session=${sessionCookie}`,
        origin: apiBaseUrl,
        "x-csrf-token": login.csrfToken,
      },
      body: JSON.stringify({
        expectedEnrollmentGeneration: login.enrollmentGeneration,
      }),
    },
  );
  if (!startResponse.ok) {
    throw new Error(`Admin MFA start failed with HTTP ${startResponse.status}`);
  }
  const start = (await startResponse.json()) as {
    readonly enrollmentGeneration: number;
    readonly secret: string;
  };

  const confirmResponse = await fetch(
    `${apiBaseUrl}/api/v1/auth/mfa/enrollment/confirm`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `__Host-session=${sessionCookie}`,
        origin: apiBaseUrl,
        "x-csrf-token": login.csrfToken,
      },
      body: JSON.stringify({
        expectedEnrollmentGeneration: start.enrollmentGeneration,
        code: totpCode(start.secret, Date.now() - 30_000),
      }),
    },
  );
  if (!confirmResponse.ok) {
    throw new Error(
      `Admin MFA confirm failed with HTTP ${confirmResponse.status}`,
    );
  }
  return start.secret;
}
