import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

test("captures the migrated command palette, notification popover and activity pages", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  const output = path.join(process.env.TEMP ?? ".", "inpulse-visual");
  mkdirSync(output, { recursive: true });

  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "项目与功能" })).toBeVisible();
  await page.screenshot({ path: path.join(output, "01-projects.png") });

  const suffix = Date.now().toString(16).slice(-8).toUpperCase();
  const code = `VIS${suffix}`;
  const name = `视觉迁移项目 ${code}`;
  await page.getByTestId("create-project-button").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("项目名称").fill(name);
  await dialog.getByLabel("项目编码").fill(code.toLowerCase());
  await dialog.getByLabel("项目描述").fill("用于迁移后的活动页视觉检查。");
  await dialog.getByRole("button", { name: "创建项目" }).click();
  await expect(page.getByText("项目创建成功", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "打开全局搜索" }).click();
  const palette = page.getByRole("dialog", { name: "全局搜索" });
  await expect(palette).toBeVisible();
  await palette.getByLabel("全局搜索关键词").fill(code);
  await expect(palette.getByText(/已找到/)).toBeVisible();
  await page.screenshot({ path: path.join(output, "02-command-palette.png") });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "通知" }).click();
  await expect(page.getByRole("dialog", { name: "通知中心" })).toBeVisible();
  await page.screenshot({
    path: path.join(output, "03-notification-popover.png"),
  });
  await page
    .getByRole("button", { name: `打开通知：已加入项目 ${name}` })
    .click();

  await expect(page.getByRole("heading", { name: "项目动态" })).toBeVisible();
  await expect(page.getByText(/创建了项目/)).toBeVisible();
  await page.screenshot({ path: path.join(output, "04-project-activity.png") });

  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "项目动态" })).toBeVisible();
  await page.getByLabel("搜索项目").fill(code);
  await expect(page.getByTestId(/^activity-project-/)).toBeVisible();
  await page.screenshot({ path: path.join(output, "05-activity-index.png") });

  await context.close();
});
