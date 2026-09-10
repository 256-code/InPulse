import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import {
  CSP_NONCE_PLACEHOLDER,
  applyHtmlSecurityHeaders,
  assertValidNonce,
  buildContentSecurityPolicy,
  createPreviewCspMiddleware,
  generateCspNonce,
  injectCspNonce,
  resolveWebCspMode,
  rewriteHtmlBody,
} from "./vite-csp";

const DESIGN_POLICY =
  "default-src 'self'; script-src 'self' 'nonce-{RANDOM}'; script-src-attr 'none'; " +
  "style-src 'self' 'nonce-{RANDOM}'; style-src-attr 'none'; img-src 'self' data:; " +
  "font-src 'self'; connect-src 'self'; frame-src 'none'; frame-ancestors 'none'; " +
  "base-uri 'none'; object-src 'none'; form-action 'self'";

describe("resolveWebCspMode", () => {
  it("defaults to enforce so CSP is never silently disabled", () => {
    expect(resolveWebCspMode(undefined)).toBe("enforce");
    expect(resolveWebCspMode("")).toBe("enforce");
    expect(resolveWebCspMode("  ")).toBe("enforce");
  });

  it("accepts the three documented modes case-insensitively", () => {
    expect(resolveWebCspMode("enforce")).toBe("enforce");
    expect(resolveWebCspMode("Report-Only")).toBe("report-only");
    expect(resolveWebCspMode("OFF")).toBe("off");
  });

  it("fails closed on unknown values", () => {
    expect(() => resolveWebCspMode("disabled")).toThrow(/INPULSE_WEB_CSP/);
  });
});

describe("buildContentSecurityPolicy", () => {
  it("matches the authoritative policy from the technical design with one nonce", () => {
    const nonce = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    expect(buildContentSecurityPolicy(nonce)).toBe(
      DESIGN_POLICY.replaceAll("{RANDOM}", nonce),
    );
  });

  it("never emits unsafe-inline for scripts or styles", () => {
    const policy = buildContentSecurityPolicy(generateCspNonce());
    expect(policy).not.toContain("unsafe-inline");
    expect(policy).not.toContain("unsafe-eval");
  });
});

describe("generateCspNonce", () => {
  it("produces 128 bit hex nonces that differ per call", () => {
    const first = generateCspNonce();
    const second = generateCspNonce();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toMatch(/^[0-9a-f]{32}$/);
    expect(first).not.toBe(second);
    expect(assertValidNonce(first)).toBe(first);
  });
});

describe("injectCspNonce", () => {
  it("replaces every placeholder occurrence", () => {
    const html = `<meta property="csp-nonce" nonce="${CSP_NONCE_PLACEHOLDER}"><script nonce="${CSP_NONCE_PLACEHOLDER}"></script>`;
    expect(injectCspNonce(html, "abc123")).toBe(
      '<meta property="csp-nonce" nonce="abc123"><script nonce="abc123"></script>',
    );
  });

  it("rejects nonces that could escape the CSP string or HTML attribute", () => {
    expect(() => injectCspNonce("x", "bad'nonce")).toThrow(/base64-value/);
    expect(() => injectCspNonce("x", 'a";evil')).toThrow(/base64-value/);
  });
});

describe("HTML security headers and body rewrite", () => {
  function createResponseStub() {
    const headers = new Map<string, string>();
    const response = {
      setHeader: vi.fn((name: string, value: string) => {
        headers.set(name.toLowerCase(), value);
        return response;
      }),
      removeHeader: vi.fn((name: string) => {
        headers.delete(name.toLowerCase());
      }),
      write: vi.fn(),
      end: vi.fn(),
      getHeader: (name: string) => headers.get(name.toLowerCase()),
    };
    return { response, headers };
  }

  it("sets no-store plus the designed headers and the nginx-style policy", () => {
    const { response, headers } = createResponseStub();
    applyHtmlSecurityHeaders(response as never, "enforce", "f".repeat(32));

    expect(headers.get("cache-control")).toBe("no-store");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("x-frame-options")).toBe("DENY");
    expect(headers.get("referrer-policy")).toBe("no-referrer");
    expect(headers.get("permissions-policy")).toBe(
      "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    );
    const policy = headers.get("content-security-policy") ?? "";
    expect(policy).toContain(`script-src 'self' 'nonce-${"f".repeat(32)}'`);
    expect(policy).toContain(`style-src 'self' 'nonce-${"f".repeat(32)}'`);
    expect(policy).not.toContain("unsafe-inline");
    expect(headers.has("strict-transport-security")).toBe(false);
  });

  it("uses the Report-Only header name in report-only mode and skips CSP when off", () => {
    const reportOnly = createResponseStub();
    applyHtmlSecurityHeaders(
      reportOnly.response as never,
      "report-only",
      "a".repeat(32),
    );
    expect(reportOnly.headers.has("content-security-policy")).toBe(false);
    expect(
      reportOnly.headers.get("content-security-policy-report-only") ?? "",
    ).toContain(`'nonce-${"a".repeat(32)}'`);

    const off = createResponseStub();
    applyHtmlSecurityHeaders(off.response as never, "off", "b".repeat(32));
    expect(off.headers.has("content-security-policy")).toBe(false);
    expect(off.headers.has("content-security-policy-report-only")).toBe(false);
    expect(off.headers.get("cache-control")).toBe("no-store");
  });

  it("rewrites buffered chunks with the response nonce before flushing", () => {
    const { response } = createResponseStub();
    const flush = vi.fn((body: string) => body);
    response.end = flush as never;
    response.setHeader("Content-Length", "1234");

    rewriteHtmlBody(response as never, "c".repeat(32));
    response.write(`<meta nonce="${CSP_NONCE_PLACEHOLDER}">`);
    response.end(`<script nonce="${CSP_NONCE_PLACEHOLDER}"></script>`);

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush.mock.calls[0]?.[0]).toBe(
      `<meta nonce="${"c".repeat(32)}"><script nonce="${"c".repeat(32)}"></script>`,
    );
    expect(response.removeHeader).toHaveBeenCalledWith("Content-Length");
    expect(response.removeHeader).toHaveBeenCalledWith("Transfer-Encoding");
  });
});

describe("createPreviewCspMiddleware", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "inpulse-csp-"));
  const indexHtmlPath = path.join(tempDir, "index.html");
  writeFileSync(
    indexHtmlPath,
    `<!doctype html><html><head><meta property="csp-nonce" nonce="${CSP_NONCE_PLACEHOLDER}"><script src="/assets/app.js" nonce="${CSP_NONCE_PLACEHOLDER}"></script></head></html>`,
    "utf8",
  );
  const handler = createPreviewCspMiddleware("enforce", indexHtmlPath);

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createPreviewResponse() {
    const headers = new Map<string, string>();
    let resolveEnded: (body: string) => void = () => {};
    const ended = new Promise<string>((resolve) => {
      resolveEnded = resolve;
    });
    const response = {
      headersSent: false,
      setHeader: vi.fn((name: string, value: string) => {
        headers.set(name.toLowerCase(), value);
      }),
      removeHeader: vi.fn((name: string) => {
        headers.delete(name.toLowerCase());
      }),
      end: vi.fn((body?: string) => {
        resolveEnded(String(body ?? ""));
      }),
      write: vi.fn(),
    };
    return { response, headers, ended };
  }

  it("serves the built entry HTML with a real nonce for SPA routes", async () => {
    const { response, headers, ended } = createPreviewResponse();
    const next = vi.fn();
    handler(
      {
        method: "GET",
        url: "/projects/1/activity?tab=all",
        headers: { accept: "text/html,application/xhtml+xml" },
      } as never,
      response as never,
      next,
    );

    const body = await ended;
    expect(next).not.toHaveBeenCalled();
    expect(body).not.toContain(CSP_NONCE_PLACEHOLDER);
    expect(body).toContain('property="csp-nonce"');
    expect(headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(headers.get("cache-control")).toBe("no-store");
    const policy = headers.get("content-security-policy") ?? "";
    const nonce = /'nonce-([0-9a-f]{32})'/.exec(policy)?.[1] ?? "";
    expect(nonce).toHaveLength(32);
    expect(body).toContain(`nonce="${nonce}"`);
  });

  it("passes hashed asset requests through to Vite", () => {
    const { response } = createPreviewResponse();
    const next = vi.fn();
    handler(
      {
        method: "GET",
        url: "/assets/index-abc123.js",
        headers: { accept: "text/html" },
      } as never,
      response as never,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(response.end).not.toHaveBeenCalled();
  });

  it("passes non-GET requests through", () => {
    const { response } = createPreviewResponse();
    const next = vi.fn();
    handler(
      {
        method: "HEAD",
        url: "/login",
        headers: { accept: "text/html" },
      } as never,
      response as never,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
