/**
 * SEC-003 / ADR-015 CSRF 浏览器生命周期：首登、轮换、刷新、多标签，
 * 以及普通写请求保留 Idempotency-Key/If-Match、securityFlow 不发送业务幂等键。
 */
import { expect, test, type Page } from "@playwright/test";

import {
  createAuthenticatedContext,
  loginViaUi,
} from "../helpers/auth-context.js";
import { createProjectViaUi } from "../helpers/project-create.js";
import { loadRuntime } from "../helpers/runtime.js";

interface CapturedRequest {
  readonly method: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

function captureRequests(page: Page): CapturedRequest[] {
  const captured: CapturedRequest[] = [];
  page.on("request", (request) => {
    captured.push({
      method: request.method(),
      url: request.url(),
      headers: request.headers(),
    });
  });
  return captured;
}

test("首登完成预认证到认证 CSRF 轮换并清除预认证 Cookie", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const context = await browser.newContext({ baseURL: runtime.webBaseUrl });
  const page = await context.newPage();
  const requests = captureRequests(page);
  try {
    await loginViaUi(page, runtime);

    const loginRequest = requests.find(
      (item) =>
        item.url.endsWith("/api/v1/auth/login") && item.method === "POST",
    );
    expect(loginRequest).toBeDefined();
    expect(loginRequest!.headers["x-csrf-token"]).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(loginRequest!.headers["idempotency-key"]).toBeUndefined();

    const csrfIssues = requests.filter((item) =>
      item.url.endsWith("/api/v1/auth/csrf"),
    );
    expect(csrfIssues.length).toBeGreaterThan(0);
    for (const issue of csrfIssues) {
      expect(issue.headers["idempotency-key"]).toBeUndefined();
    }

    const cookies = await context.cookies();
    const session = cookies.find((cookie) => cookie.name === "__Host-session");
    expect(session).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
    });
    expect(
      cookies.find((cookie) => cookie.name === "__Host-preauth"),
    ).toBeUndefined();
  } finally {
    await context.close();
  }
});

test("刷新页面后保持认证，写操作携带 CSRF 与幂等键", async ({ browser }) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    await page.reload();
    await expect(page.getByText("成员", { exact: true })).toBeVisible();

    const requests = captureRequests(page);
    await createProjectViaUi(page, runtime, "CSRF");

    const createRequest = requests.find(
      (item) => item.url.endsWith("/api/v1/projects") && item.method === "POST",
    );
    expect(createRequest?.headers["x-csrf-token"]).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(createRequest?.headers["idempotency-key"]).toBeTruthy();

    const issued = requests.filter((item) =>
      item.url.endsWith("/api/v1/auth/csrf"),
    );
    expect(issued.length).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test("多标签各自签发 CSRF 并独立完成写操作", async ({ browser }) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    const second = await context.newPage();
    const firstRequests = captureRequests(page);
    const secondRequests = captureRequests(second);

    await createProjectViaUi(page, runtime, "CSRF1");
    await createProjectViaUi(second, runtime, "CSRF2");

    const firstIssues = firstRequests.filter((item) =>
      item.url.endsWith("/api/v1/auth/csrf"),
    );
    const secondIssues = secondRequests.filter((item) =>
      item.url.endsWith("/api/v1/auth/csrf"),
    );
    expect(firstIssues.length).toBeGreaterThan(0);
    expect(secondIssues.length).toBeGreaterThan(0);

    const firstCreate = firstRequests.find(
      (item) => item.url.endsWith("/api/v1/projects") && item.method === "POST",
    );
    const secondCreate = secondRequests.find(
      (item) => item.url.endsWith("/api/v1/projects") && item.method === "POST",
    );
    expect(firstCreate?.headers["x-csrf-token"]).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secondCreate?.headers["x-csrf-token"]).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );

    await page.goto("/notifications");
    await page.getByRole("button", { name: "全部已读" }).click();
    await expect(
      page.getByRole("button", { name: "通知", exact: true }),
    ).toHaveAttribute("title", "0 条未读通知");
  } finally {
    await context.close();
  }
});

test("版本化写请求保留 If-Match 与 CSRF、幂等键", async ({ browser }) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    await page.goto(`/projects/${runtime.projectId}/modules`);
    await expect(page.getByRole("heading", { name: "模块管理" })).toBeVisible();
    const name = `CSRF模块-${Date.now()}`;
    await page.getByRole("button", { name: "新建模块" }).click();
    const dialog = page.getByRole("dialog", { name: "新建模块" });
    await dialog.getByLabel("模块名称").fill(name);
    await dialog.getByLabel("模块说明").fill("CSRF 生命周期 E2E");
    await dialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(dialog).toBeHidden();

    const requests = captureRequests(page);
    const card = page.locator(".calm-feature-card").filter({ hasText: name });
    await card.getByRole("button", { name: /编\s*辑/ }).click();
    const edit = page.getByRole("dialog", { name: "编辑模块" });
    await edit.getByLabel("模块名称").fill(`${name}-已修改`);
    await edit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(edit).toBeHidden();

    const updateRequest = requests.find(
      (item) => item.method === "PATCH" && item.url.includes("/modules/"),
    );
    expect(updateRequest).toBeDefined();
    expect(updateRequest!.headers["if-match"]).toMatch(/^"[1-9][0-9]*"$/);
    expect(updateRequest!.headers["x-csrf-token"]).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
    expect(updateRequest!.headers["idempotency-key"]).toBeTruthy();
  } finally {
    await context.close();
  }
});
