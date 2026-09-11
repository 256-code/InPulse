import { randomBytes } from "node:crypto";
import { expect, type Page } from "@playwright/test";

import type { E2ERuntime } from "./runtime.js";

export interface CreatedProject {
  readonly code: string;
  readonly name: string;
}

export interface CreateProjectViaUiOptions {
  /** 创建成功横幅的断言超时（毫秒）；默认沿用 Playwright 的 10s，仅在本地大数据量列表上放宽。 */
  readonly successTimeoutMs?: number;
}

export async function createProjectViaUi(
  page: Page,
  runtime: E2ERuntime,
  prefix: string,
  options: CreateProjectViaUiOptions = {},
): Promise<CreatedProject> {
  const suffix =
    Date.now().toString(16).slice(-8).toUpperCase() +
    randomBytes(2).toString("hex").toUpperCase();
  const code = `${prefix}${suffix}`;
  const name = `${prefix} Playwright 项目 ${code}`;

  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "项目与功能" })).toBeVisible();
  await page.getByTestId("create-project-button").click();

  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("项目名称").fill(name);
  await dialog.getByLabel("项目编码").fill(code.toLowerCase());
  await dialog
    .getByLabel("项目描述")
    .fill("由 Playwright E2E 创建，用于验证项目动态与站内通知。");
  await dialog.getByLabel(`选择成员：${runtime.member.name}`).check();
  await expect(dialog.getByText(/已选择 1 位其他成员/)).toBeVisible();
  await dialog.getByRole("button", { name: "创建项目" }).click();

  await expect(page.getByText("项目创建成功", { exact: true })).toBeVisible(
    options.successTimeoutMs === undefined
      ? {}
      : { timeout: options.successTimeoutMs },
  );
  return { code, name };
}
