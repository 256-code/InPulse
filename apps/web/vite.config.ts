import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CSP_NONCE_PLACEHOLDER,
  createWebCspPlugin,
  resolveWebCspMode,
} from "./tools/vite-csp.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiProxyTarget =
  process.env["VITE_API_PROXY_TARGET"]?.trim() || "http://127.0.0.1:3000";

// 默认启用强制 CSP；`INPULSE_WEB_CSP=report-only|off` 只用于排查（见
// tools/vite-csp.ts 与 ADR-021，禁止把不安全策略带入生产）。
const cspMode = resolveWebCspMode(process.env["INPULSE_WEB_CSP"]);
const apiProxy = {
  "/api/v1": {
    target: apiProxyTarget,
    changeOrigin: false,
  },
};

export default defineConfig({
  // Vite 会把该占位符写入构建产物与开发服务器 HTML 的 script/style/meta，
  // 生产由 Nginx sub_filter 替换为逐响应 `$request_id`。
  html: { cspNonce: CSP_NONCE_PLACEHOLDER },
  plugins: [react(), createWebCspPlugin(cspMode)],
  server: {
    proxy: apiProxy,
  },
  preview: {
    proxy: apiProxy,
  },
  resolve: {
    alias: {
      "@app": path.resolve(__dirname, "./src/app"),
      "@pages": path.resolve(__dirname, "./src/pages"),
      "@features": path.resolve(__dirname, "./src/features"),
      "@shared": path.resolve(__dirname, "./src/shared"),
      "@generated": path.resolve(__dirname, "./src/generated"),
    },
  },
});
