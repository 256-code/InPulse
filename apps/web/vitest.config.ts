import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@app": path.resolve(__dirname, "./src/app"),
      "@pages": path.resolve(__dirname, "./src/pages"),
      "@features": path.resolve(__dirname, "./src/features"),
      "@shared": path.resolve(__dirname, "./src/shared"),
      "@generated": path.resolve(__dirname, "./src/generated"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // 并发上限按可用 CPU 收敛：本机 20 核时 vitest 会按文件起满 worker（实测同时启动 85 个 jsdom），
    // CPU 饱和会让 `findByRole`/`waitFor` 这类等待偶发超时（`app-router.test.tsx`、
    // `ConvertLeftoverTask.test.tsx`、`TasksPage.test.tsx`、`GlobalTaskCreateModal.test.tsx` 都出现过）。
    // CI 的 ubuntu runner 只有 4 vCPU，写死 8 会变成超额订阅（比默认并发更慢、更容易超时），
    // 因此上限取「核数 - 1」与 8 的较小值：本机 20 核仍为 8，CI 回落到 3。
    maxWorkers: Math.max(2, Math.min(8, availableParallelism() - 1)),
    // 懒加载 chunk 冷启动（TaskDetailOverlay / IssuesPageView）与 Ant Design 交互序列在共享 runner 上
    // 可能超过 vitest 默认的 5s 单测预算；放宽预算，不改动任何断言。
    testTimeout: 20_000,
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tools/**/*.test.ts"],
  },
});
