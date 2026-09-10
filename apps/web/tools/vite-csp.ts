import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import type { Connect, Plugin, PreviewServer, ViteDevServer } from "vite";

/**
 * 技术设计 v1.2.2 §7.5 / ADR-021：HTML 入口层为每个响应生成至少 128 bit 随机
 * nonce，同时写入 CSP 响应头与 bootstrap 元数据（Vite 注入
 * `<meta property="csp-nonce" nonce="...">`），Ant Design StyleProvider 读取同一
 * nonce，运行时 `<style>` 标签必须携带它。
 *
 * 生产 HTML 入口是 Nginx：`html.cspNonce` 让 Vite 构建产物保留本模块的占位符，
 * 由 `deploy/docker/nginx.conf` 的 sub_filter 按响应替换为 Nginx `$request_id`
 * （16 随机字节）。`vite dev` / `vite preview` 由本插件的中间件实现同样的逐响应
 * 语义，供本地开发与 Playwright E2E 在强制模式下验证 Ant Design / Vite 兼容性。
 */
export const CSP_NONCE_PLACEHOLDER = "__INPULSE_CSP_NONCE__";

/**
 * `INPULSE_WEB_CSP` 的合法取值。默认 `enforce`；非法值 fail closed，不得静默
 * 关闭 CSP。
 */
export type WebCspMode = "enforce" | "report-only" | "off";

export function resolveWebCspMode(raw: string | undefined): WebCspMode {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "") {
    return "enforce";
  }
  if (value === "enforce" || value === "report-only" || value === "off") {
    return value;
  }
  throw new Error(
    `INPULSE_WEB_CSP must be enforce | report-only | off, received \`${raw}\``,
  );
}

/** RFC 4648 base64-value 字符集（含 base64url 变体），禁止引号与分号注入。 */
const NONCE_PATTERN = /^[A-Za-z0-9+/=_-]+$/;

export function assertValidNonce(nonce: string): string {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error(
      "CSP nonce contains characters outside RFC 4648 base64-value",
    );
  }
  return nonce;
}

/** 128 bit 随机 nonce；与 Nginx `$request_id` 同为 32 位十六进制，便于对照。 */
export function generateCspNonce(): string {
  return randomBytes(16).toString("hex");
}

/** 技术设计 v1.2.2 §7.5 的权威策略串；禁止加入 `unsafe-inline`。 */
export function buildContentSecurityPolicy(nonce: string): string {
  const value = assertValidNonce(nonce);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${value}'`,
    "script-src-attr 'none'",
    `style-src 'self' 'nonce-${value}'`,
    "style-src-attr 'none'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "object-src 'none'",
    "form-action 'self'",
  ].join("; ");
}

/** 本地开发/预览同样按技术设计 §7.5 输出安全响应头（HSTS 仅由生产 HTTPS 发出）。 */
export const WEB_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy":
    "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
};

export function injectCspNonce(html: string, nonce: string): string {
  const value = assertValidNonce(nonce);
  return html.split(CSP_NONCE_PLACEHOLDER).join(value);
}

export function applyHtmlSecurityHeaders(
  response: ServerResponse,
  mode: WebCspMode,
  nonce: string,
): void {
  response.setHeader("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(WEB_SECURITY_HEADERS)) {
    response.setHeader(name, value);
  }
  if (mode === "off") {
    return;
  }
  const header =
    mode === "enforce"
      ? "Content-Security-Policy"
      : "Content-Security-Policy-Report-Only";
  response.setHeader(header, buildContentSecurityPolicy(nonce));
}

/**
 * 缓冲 HTML 响应体并在发送前把 nonce 占位符替换为当前响应的真实 nonce。
 * HTML 体积很小；替换后由 Node 重新计算 Content-Length，避免长度不一致。
 */
export function rewriteHtmlBody(response: ServerResponse, nonce: string): void {
  const chunks: Buffer[] = [];
  const originalWrite = response.write.bind(response);
  const originalEnd = response.end.bind(response);

  const collect = (chunk: unknown, encoding: unknown): boolean => {
    if (typeof chunk === "string") {
      chunks.push(
        Buffer.from(
          chunk,
          typeof encoding === "string" ? (encoding as BufferEncoding) : "utf8",
        ),
      );
      return true;
    }
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
      return true;
    }
    return false;
  };

  response.write = ((
    chunk: unknown,
    encoding?: unknown,
    callback?: unknown,
  ): boolean => {
    if (collect(chunk, encoding)) {
      if (typeof encoding === "function") {
        (encoding as () => void)();
      } else if (typeof callback === "function") {
        (callback as () => void)();
      }
      return true;
    }
    return (originalWrite as (...args: unknown[]) => boolean)(
      chunk,
      encoding,
      callback,
    );
  }) as typeof response.write;

  response.end = ((
    chunk?: unknown,
    encoding?: unknown,
    callback?: unknown,
  ): ServerResponse => {
    collect(chunk, typeof encoding === "function" ? undefined : encoding);
    const body = injectCspNonce(Buffer.concat(chunks).toString("utf8"), nonce);
    if (!response.headersSent) {
      // 替换后长度变化，交由 Node 重新计算；若下游已先发送头部（例如压缩流），
      // 保持原样，不能在这里改写已发送的头部。
      response.removeHeader("Content-Length");
      response.removeHeader("Transfer-Encoding");
    }
    const done = typeof encoding === "function" ? encoding : callback;
    return (originalEnd as (...args: unknown[]) => ServerResponse)(
      body,
      "utf8",
      typeof done === "function" ? done : undefined,
    );
  }) as typeof response.end;
}

type MiddlewareServer = Pick<ViteDevServer | PreviewServer, "middlewares">;

function wantsHtml(request: IncomingMessage): boolean {
  return String(request.headers.accept ?? "").includes("text/html");
}

/**
 * dev 模式：Vite 的 HTML 转换包含 React Refresh 前导脚本等逐请求内容，无法预读
 * 磁盘文件，因此在 body 写出发送前替换占位符（dev 不压缩，缓冲安全）。
 */
export function installDevCspMiddleware(
  server: MiddlewareServer,
  mode: WebCspMode,
): void {
  const handler: Connect.NextHandleFunction = (
    request,
    response,
    next,
  ): void => {
    if (!wantsHtml(request)) {
      next();
      return;
    }
    const nonce = generateCspNonce();
    applyHtmlSecurityHeaders(response, mode, nonce);
    rewriteHtmlBody(response, nonce);
    next();
  };
  server.middlewares.use(handler);
}

const INDEX_EXTENSION = /\.[A-Za-z0-9]+$/;

/**
 * preview 模式：Vite 预览会对 HTML 做压缩，压缩后的字节无法再做字符串替换，
 * 因此这里直接短路提供构建产物 `dist/index.html`（占位符必须由 Vite 构建写入），
 * 静态资源请求仍交给 Vite 处理。语义与生产 Nginx `try_files ... /index.html`
 * 一致：无扩展名路径与 `/index.html` 都返回注入 nonce 的入口 HTML。
 */
export function createPreviewCspMiddleware(
  mode: WebCspMode,
  indexHtmlPath: string,
): Connect.NextHandleFunction {
  return (request, response, next): void => {
    if (request.method !== "GET" || !wantsHtml(request)) {
      next();
      return;
    }
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const isEntry =
      pathname === "/" ||
      pathname === "/index.html" ||
      !INDEX_EXTENSION.test(pathname);
    if (!isEntry) {
      next();
      return;
    }
    const nonce = generateCspNonce();
    applyHtmlSecurityHeaders(response, mode, nonce);
    void readFile(indexHtmlPath, "utf8")
      .then((html) => {
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(injectCspNonce(html, nonce));
      })
      .catch((error: unknown) => {
        next(error as Error);
      });
  };
}

export function createWebCspPlugin(mode: WebCspMode): Plugin {
  let indexHtmlPath = path.resolve(process.cwd(), "dist", "index.html");
  return {
    name: "inpulse-web-csp",
    configResolved(config) {
      indexHtmlPath = path.resolve(
        config.root,
        config.build.outDir,
        "index.html",
      );
    },
    configureServer(server) {
      installDevCspMiddleware(server, mode);
    },
    configurePreviewServer(server) {
      server.middlewares.use(createPreviewCspMiddleware(mode, indexHtmlPath));
    },
  };
}
