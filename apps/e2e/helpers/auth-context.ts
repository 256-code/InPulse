import {
  expect,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

import type { E2EAccount, E2ERuntime } from "./runtime.js";

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
  await expect(page.getByText("已登录")).toBeVisible();
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
