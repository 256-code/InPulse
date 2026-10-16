import { expect, test } from "@playwright/test";

import { loginViaUi } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

test("API 使用测试数据库成功启动并通过健康探针", async ({ request }) => {
  const runtime = await loadRuntime();
  const response = await request.get(`${runtime.apiBaseUrl}/api/v1/health`);

  expect(response.ok()).toBe(true);
});

test("匿名访问受保护页面时直接进入登录页并自动发起统一身份认证", async ({
  page,
}) => {
  for (const target of ["/search", "/projects"]) {
    await page.goto(target);

    // ADR-080：RequireAuth 先把匿名访问送到 /login?from=...，登录页随即自动
    // 发起 sso/start；E2E 未配置统一身份认证，服务端 302 回落到隐藏口令
    // 入口，原始目标保留在 from。
    await page.waitForURL(/\/login\?local=1&sso=disabled&from=/);
    const url = new URL(page.url());
    expect(url.searchParams.get("from")).toBe(target);
    await expect(page.getByTestId("login-page")).toBeVisible();
    await expect(page.getByAltText("Libiao Robotics")).toBeVisible();
    await expect(page.getByLabel("登录名")).toBeVisible();
    await expect(page.getByLabel("密码")).toBeVisible();
    await expect(page.getByText(/统一身份认证未启用/)).toBeVisible();
    await expect(page.getByText("需要登录")).toBeHidden();
  }
});

test("默认 /login 自动发起统一身份认证，未配置时回落到隐藏口令入口", async ({
  page,
}) => {
  const ssoStartRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/v1/auth/sso/start")) {
      ssoStartRequests.push(request.url());
    }
  });

  await page.goto("/login?from=%2Fprojects");

  await page.waitForURL(/\/login\?local=1&sso=disabled&from=/);
  expect(
    ssoStartRequests.some((url) => url.includes("returnTo=%2Fprojects")),
  ).toBe(true);
  const url = new URL(page.url());
  expect(url.searchParams.get("local")).toBe("1");
  expect(url.searchParams.get("sso")).toBe("disabled");
  expect(url.searchParams.get("from")).toBe("/projects");
  await expect(page.getByText(/统一身份认证未启用/)).toBeVisible();
  await expect(page.getByLabel("登录名")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "使用统一身份认证登录" }),
  ).toHaveCount(0);
});

test("本地应急入口展示品牌表单与黄色主按钮", async ({ page }) => {
  await page.goto("/login?local=1");

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
  await page.waitForURL(/\/login\?local=1&sso=disabled&from=/);

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

  // 主动退出必须回到不带 from 的干净登录页：登录页随后自动发起统一身份
  // 认证（ADR-080），E2E 未配置 SSO 时服务端 302 回落到隐藏口令入口；
  // from 只由匿名直达受保护页面的跳转（RequireAuth）产生，退出登录不能
  // 把当前页写进登录地址。
  await expect(page).toHaveURL(/\/login\?local=1&sso=disabled$/);
  const url = new URL(page.url());
  expect(url.searchParams.get("from")).toBeNull();

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
