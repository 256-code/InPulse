import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import type { E2EAccount, E2ERuntime } from "./runtime.js";
import { resetAdminTotpReplayStep } from "./admin-totp.js";
import { totpCode } from "./totp.js";

export interface AuthenticatedContext {
  readonly context: BrowserContext;
  readonly page: Page;
}

export async function loginViaUi(
  page: Page,
  runtime: E2ERuntime,
  account: E2EAccount = runtime.user,
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("登录名").fill(account.loginName);
  await page.getByLabel("密码").fill(account.password);
  await page
    .locator("form")
    .getByRole("button", { name: /登\s*录/ })
    .click();
  await expect(page.getByText("成员", { exact: true })).toBeVisible();
}

export async function loginAdminViaUi(
  page: Page,
  runtime: E2ERuntime,
): Promise<void> {
  await resetAdminTotpReplayStep(runtime.adminMfaUserId);
  await page.goto("/login");
  await page.getByLabel("登录名").fill(runtime.adminMfa.loginName);
  await page.getByLabel("密码").fill(runtime.adminMfa.password);
  await page
    .locator("form")
    .getByRole("button", { name: /登\s*录/ })
    .click();
  await expect(page.getByText("需要完成 TOTP 验证")).toBeVisible();
  await page.getByLabel("6 位验证码").fill(totpCode(runtime.adminMfaSecret));
  await page.getByRole("button", { name: "验证并进入系统" }).click();
  await expect(page.getByText("系统管理员", { exact: true })).toBeVisible();
}

export async function createAuthenticatedContext(
  browser: Browser,
  runtime: E2ERuntime,
): Promise<AuthenticatedContext> {
  const context = await browser.newContext({ baseURL: runtime.webBaseUrl });
  const page = await context.newPage();
  await loginViaUi(page, runtime);
  return { context, page };
}
