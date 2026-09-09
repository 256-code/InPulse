import { expect, test } from "@playwright/test";

import { loadRuntime } from "../helpers/runtime.js";

test("API 使用测试数据库成功启动并通过健康探针", async ({ request }) => {
  const runtime = await loadRuntime();
  const response = await request.get(`${runtime.apiBaseUrl}/api/v1/health`);

  expect(response.ok()).toBe(true);
});

test("匿名访问受保护页面时展示登录提示", async ({ page }) => {
  await page.goto("/search");

  await expect(page.getByText("需要登录")).toBeVisible();
  await expect(page.getByText("访问此页面需要先登录系统。")).toBeVisible();
});

test("E2E 登录复用后的 Session 可以读取当前用户", async ({ request }) => {
  const runtime = await loadRuntime();
  const response = await request.get(`${runtime.apiBaseUrl}/api/v1/me`, {
    headers: { cookie: `__Host-session=${runtime.sessionCookie}` },
  });

  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    readonly loginName: string;
    readonly name: string;
  };
  expect(body.loginName).toBe(runtime.user.loginName);
  expect(body.name).toBe(runtime.user.name);
});
