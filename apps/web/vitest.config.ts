import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
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
    // 本机 20 核时 vitest 会按文件起满 worker（实测同时启动 85 个 jsdom），CPU 饱和会让
    // `findByRole` 这类默认 1s 的等待偶发超时（`app-router.test.tsx`、`ConvertLeftoverTask.test.tsx`）。
    // 这里给并发设上限换取稳定；CI（4 vCPU）默认并发本来更低，不受影响。
    maxWorkers: 8,
    include: ["src/**/*.{test,spec}.{ts,tsx}", "tools/**/*.test.ts"],
  },
});
