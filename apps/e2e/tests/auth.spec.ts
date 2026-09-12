import { expect, test } from "@playwright/test";

import { loadRuntime } from "../helpers/runtime.js";

test("API 使用测试数据库成功启动并通过健康探针", async ({ request }) => {
  const runtime = await loadRuntime();
  const response = await request.get(`${runtime.apiBaseUrl}/api/v1/health`);

  expect(response.ok()).toBe(true);
});

test("匿名访问受保护页面时直接进入登录页", async ({ page }) => {
  for (const target of ["/search", "/projects"]) {
    await page.goto(target);

    await page.waitForURL(/\/login\?from=/);
    expect(new URL(page.url()).searchParams.get("from")).toBe(target);
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.getByAltText("Libiao Robotics")).toBeVisible();
    await expect(page.getByLabel("登录名")).toBeVisible();
    await expect(page.getByLabel("密码")).toBeVisible();
    await expect(page.getByText("需要登录")).toBeHidden();
  }
});

test("登录页展示品牌表单与黄色主按钮", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByTestId("login-page")).toBeVisible();
  await expect(page.getByAltText("Libiao Robotics")).toBeVisible();
  await expect(page.getByLabel("登录名")).toBeVisible();
  await expect(page.getByLabel("密码")).toBeVisible();

  const submit = page.locator("form").getByRole("button", { name: /登\s*录/ });
  await expect(submit).toBeVisible();

  const background = await submit.evaluate(
    (element) => getComputedStyle(element).backgroundColor,
  );
  expect(background).toBe("rgb(247, 200, 0)");
});

test("登录后回到登录前的目标页面", async ({ page }) => {
  const runtime = await loadRuntime();

  await page.goto("/projects");
  await page.waitForURL(/\/login\?from=/);

  await page.getByLabel("登录名").fill(runtime.user.loginName);
  await page.getByLabel("密码").fill(runtime.user.password);
  await page
    .locator("form")
    .getByRole("button", { name: /登\s*录/ })
    .click();

  await expect(page).toHaveURL(/\/projects$/);
  await expect(page.getByRole("heading", { name: "项目与功能" })).toBeVisible();
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
