import { expect, test } from "@playwright/test";

import { loginViaUi } from "../helpers/auth-context.js";
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
  await expect(page.getByRole("heading", { name: "项目列表" })).toBeVisible();
});

test("退出登录回落到干净的登录页，换账号登录不再落回上一账号的页面", async ({
  page,
}) => {
  const runtime = await loadRuntime();

  await loginViaUi(page, runtime);
  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "项目列表" })).toBeVisible();

  await page.getByRole("button", { name: "账户菜单" }).click();
  await page.getByRole("button", { name: /退出登录/ }).click();

  // 主动退出必须回到不带 from 的干净登录页：from 只由匿名直达受保护页面的
  // 跳转（RequireAuth）产生，退出登录不能把当前页写进登录地址。
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("登录名").fill(runtime.member.loginName);
  await page.getByLabel("密码").fill(runtime.member.password);
  await page
    .locator("form")
    .getByRole("button", { name: /登\s*录/ })
    .click();

  // 换账号登录后回到默认入口（任务中心），而不是上一账号停留的项目列表。
  await expect(page).toHaveURL(/\/tasks$/);
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

test("未配置单点登录时登录页保留本地表单，点击单点登录入口回落到隐藏口令入口", async ({
  page,
}) => {
  await page.goto("/login?from=%2Fprojects");

  // ADR-036：默认展示本地口令表单，不再自动跳转，原始目标保留在 from。
  await expect(page.getByTestId("login-page")).toBeVisible();
  await expect(page.getByLabel("登录名")).toBeVisible();
  await expect(page.getByLabel("密码")).toBeVisible();
  await expect(page.getByText("或以统一身份认证登录")).toBeVisible();

  await page.getByRole("button", { name: "使用统一身份认证登录" }).click();

  await page.waitForURL(/\/login\?local=1&sso=disabled&from=/);
  const url = new URL(page.url());
  expect(url.searchParams.get("local")).toBe("1");
  expect(url.searchParams.get("sso")).toBe("disabled");
  expect(url.searchParams.get("from")).toBe("/projects");

  await expect(page.getByText(/统一身份认证未启用/)).toBeVisible();
  await expect(page.getByLabel("登录名")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使用统一身份认证登录" }),
  ).toBeHidden();
});

test("单点登录入口在未配置时也 302 回落到本地入口", async ({ request }) => {
  const runtime = await loadRuntime();
  const response = await request.get(
    `${runtime.webBaseUrl}/api/v1/auth/sso/start?returnTo=%2Fsearch`,
    { maxRedirects: 0 },
  );

  expect(response.status()).toBe(302);
  expect(response.headers()["location"]).toBe(
    "/login?local=1&sso=disabled&from=%2Fsearch",
  );
});
