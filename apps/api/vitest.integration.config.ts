import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@inpulse\/api-contract$/,
        replacement: fileURLToPath(
          new URL("../../packages/api-contract/src/index.ts", import.meta.url),
        ),
      },
      {
        find: /^@inpulse\/database\/client$/,
        replacement: fileURLToPath(
          new URL("../../database/src/client.ts", import.meta.url),
        ),
      },
      {
        find: /^@inpulse\/database\/config$/,
        replacement: fileURLToPath(
          new URL("../../database/src/config.ts", import.meta.url),
        ),
      },
      {
        find: /^@inpulse\/database$/,
        replacement: fileURLToPath(
          new URL("../../database/schema/index.ts", import.meta.url),
        ),
      },
    ],
  },
  test: {
    fileParallelism: false,
    hookTimeout: 180_000,
    include: ["test/**/*.integration.test.ts"],
    exclude: ["**/search-query.integration.test.ts"],
    sequence: {
      concurrent: false,
    },
    testTimeout: 180_000,
  },
});
