import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    hookTimeout: 180_000,
    include: ["test/**/*.test.ts"],
    sequence: {
      concurrent: false,
    },
    testTimeout: 180_000,
  },
});
