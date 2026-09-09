import { expect, test } from "@playwright/test";

import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

test("登录用户创建项目并验证动态、搜索与站内通知", async ({ browser }) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  const suffix = Date.now().toString(16).slice(-10).toUpperCase();
  const code = `F04${suffix}`;
  const name = `F-04 Playwright 项目 ${code}`;

  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "项目与功能" })).toBeVisible();
  await page.getByTestId("create-project-button").click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("项目名称").fill(name);
  await dialog.getByLabel("项目编码").fill(code.toLowerCase());
  await dialog
    .getByLabel("项目描述")
    .fill("由 Playwright 创建，用于验证 F-04 关键路径。");
  await dialog.getByRole("button", { name: "创建项目" }).click();

  await expect(page.getByText("项目创建成功", { exact: true })).toBeVisible();
  await page.getByTestId("open-created-project-activity").click();

  await expect(page.getByRole("heading", { name: "项目动态" })).toBeVisible();
  await expect(
    page.getByText(`创建了项目 ${name}`, { exact: true }),
  ).toBeVisible();

  await page.goto(`/search?q=${encodeURIComponent(code)}`);
  await expect(page.getByTestId("search-result-item")).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();

  await page.goto("/notifications");
  await expect(
    page.getByText(`已加入项目 ${name}`, { exact: true }),
  ).toBeVisible();

  await context.close();
});
