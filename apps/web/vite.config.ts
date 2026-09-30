import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
// 局域网共享（scripts/dev-start.mjs --lan）：用自签证书提供 HTTPS，让
// `__Host-` + Secure 会话 Cookie 在局域网设备上可用（见 README 本地开发启动）。
const httpsCertFile = process.env["VITE_DEV_HTTPS_CERT"]?.trim();
const httpsKeyFile = process.env["VITE_DEV_HTTPS_KEY"]?.trim();
const https =
  httpsCertFile && httpsKeyFile
    ? { cert: readFileSync(httpsCertFile), key: readFileSync(httpsKeyFile) }
    : undefined;

const apiProxy = {
  "/api/v1": {
    target: apiProxyTarget,
    changeOrigin: false,
    // HTTPS 入口要把原始协议转发给 API：CSRF 同源校验按
    // x-forwarded-proto + Host 比较 Origin，缺失时回落 http 会误判跨源。
    ...(https ? { xfwd: true } : {}),
  },
};

export default defineConfig({
  // Vite 会把该占位符写入构建产物与开发服务器 HTML 的 script/style/meta，
  // 生产由 Nginx sub_filter 替换为逐响应 `$request_id`。
  html: { cspNonce: CSP_NONCE_PLACEHOLDER },
  plugins: [react(), createWebCspPlugin(cspMode)],
  server: {
    proxy: apiProxy,
    ...(https ? { https } : {}),
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
