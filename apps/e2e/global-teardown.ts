import { rm } from "node:fs/promises";

import {
  cleanupFixtures,
  formatFixtureCleanupReport,
} from "./helpers/fixture-cleanup.js";
import {
  E2E_KEYRING_DIR,
  requiredE2eDatabaseUrl,
  RUNTIME_FILE,
} from "./helpers/runtime.js";

export default async function globalTeardown(): Promise<void> {
  try {
    const report = await cleanupFixtures(requiredE2eDatabaseUrl());
    console.log(formatFixtureCleanupReport(report));
  } finally {
    await Promise.all([
      rm(E2E_KEYRING_DIR, { recursive: true, force: true }),
      rm(RUNTIME_FILE, { force: true }),
    ]);
  }
}
