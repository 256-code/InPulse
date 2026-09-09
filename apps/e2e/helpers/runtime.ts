import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const E2E_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const RUNTIME_FILE = path.join(E2E_ROOT, "test-results", "runtime.json");
export const E2E_KEYRING_DIR = path.join(E2E_ROOT, ".e2e-runtime", "keyrings");
export const SESSION_KEYRING_FILE = path.join(
  E2E_KEYRING_DIR,
  "session.keyring",
);
export const IDEMPOTENCY_KEYRING_FILE = path.join(
  E2E_KEYRING_DIR,
  "idempotency.keyring",
);

export interface E2ERuntime {
  readonly apiBaseUrl: string;
  readonly webBaseUrl: string;
  readonly userId: number;
  readonly projectId: number;
  readonly searchQuery: string;
  readonly projectTitle: string;
  readonly sessionCookie: string;
  readonly user: {
    readonly loginName: string;
    readonly name: string;
    readonly password: string;
  };
}

export function requiredE2eDatabaseUrl(): string {
  const value =
    process.env["E2E_DATABASE_URL"]?.trim() ??
    process.env["TEST_DATABASE_URL"]?.trim();
  if (!value) {
    throw new Error(
      "E2E requires E2E_DATABASE_URL or TEST_DATABASE_URL with a bootstrap role",
    );
  }
  return value;
}

export function runtimeDatabaseUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.username = "app_runtime";
  url.password = "";
  return url.toString();
}

export async function loadRuntime(): Promise<E2ERuntime> {
  const content = await readFile(RUNTIME_FILE, "utf8");
  return JSON.parse(content) as E2ERuntime;
}

export function parseCookieValue(
  setCookie: string,
  expectedName: string,
): string | undefined {
  const segment = setCookie.split(";", 1)[0]?.trim();
  if (segment === undefined) {
    return undefined;
  }
  const separator = segment.indexOf("=");
  if (separator <= 0) {
    return undefined;
  }
  const name = segment.slice(0, separator).trim();
  const value = segment.slice(separator + 1).trim();
  return name === expectedName && value.length > 0 ? value : undefined;
}
