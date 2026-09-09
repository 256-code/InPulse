import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { defineConfig, devices } from "@playwright/test";

import {
  E2E_KEYRING_DIR,
  E2E_ROOT,
  IDEMPOTENCY_KEYRING_FILE,
  requiredE2eDatabaseUrl,
  runtimeDatabaseUrl,
  SESSION_KEYRING_FILE,
} from "./helpers/runtime.js";

function parsePort(value: string | undefined, fallback: number): number {
  const port = Number.parseInt(value ?? "", 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

const ROOT = path.resolve(E2E_ROOT, "../..");
const API_PORT = parsePort(process.env["E2E_API_PORT"], 3100);
const WEB_PORT = parsePort(process.env["E2E_WEB_PORT"], 4173);
const API_BASE_URL = `http://127.0.0.1:${API_PORT}`;
const WEB_BASE_URL = `http://127.0.0.1:${WEB_PORT}`;
const databaseUrl = requiredE2eDatabaseUrl();

mkdirSync(E2E_KEYRING_DIR, { recursive: true });
writeFileSync(
  SESSION_KEYRING_FILE,
  `1:${randomBytes(32).toString("hex")}\n`,
  "utf8",
);
writeFileSync(
  IDEMPOTENCY_KEYRING_FILE,
  `1:${randomBytes(32).toString("hex")}\n`,
  "utf8",
);

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env["CI"] ? 1 : 0,
  forbidOnly: Boolean(process.env["CI"]),
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report", open: "never" }],
  ],
  outputDir: "test-results",
  use: {
    baseURL: WEB_BASE_URL,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: "node dist/main.js",
      cwd: path.resolve(ROOT, "apps/api"),
      url: `${API_BASE_URL}/api/v1/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        DATABASE_URL: runtimeDatabaseUrl(databaseUrl),
        NODE_ENV: "test",
        PORT: String(API_PORT),
        SESSION_HASH_KEYRING_FILE: SESSION_KEYRING_FILE,
        SESSION_HASH_KEYRING_TEST_PATH: "1",
        SESSION_HASH_KEY_VERSION: "1",
        IDEMPOTENCY_FINGERPRINT_KEYRING_FILE: IDEMPOTENCY_KEYRING_FILE,
        IDEMPOTENCY_FINGERPRINT_KEYRING_TEST_PATH: "1",
        IDEMPOTENCY_FINGERPRINT_KEY_VERSION: "1",
      },
    },
    {
      command:
        "node node_modules/vite/bin/vite.js --host 127.0.0.1 " +
        `--port ${WEB_PORT} --strictPort`,
      cwd: path.resolve(ROOT, "apps/web"),
      url: `${WEB_BASE_URL}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ...process.env,
        VITE_API_PROXY_TARGET: API_BASE_URL,
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
