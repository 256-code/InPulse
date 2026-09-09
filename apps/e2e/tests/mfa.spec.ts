import { expect } from "@playwright/test";
import { test } from "../helpers/mfa-fixture.js";

import { resetAdminTotpReplayStep } from "../helpers/admin-totp.js";
import { loadRuntime } from "../helpers/runtime.js";
import { totpCode } from "../helpers/totp.js";

test("已启用 MFA 的管理员能完成验证并重认证", async ({ browser, mfaAdmin }) => {
  test.setTimeout(90_000);
  const runtime = await loadRuntime();
  await resetAdminTotpReplayStep(mfaAdmin.userId);
  const context = await browser.newContext({ baseURL: runtime.webBaseUrl });
  const page = await context.newPage();
  try {
    await page.goto("/login");
    await page.getByLabel("登录名").fill(mfaAdmin.account.loginName);
    await page.getByLabel("密码").fill(mfaAdmin.account.password);
    await page
      .locator("form")
      .getByRole("button", { name: /登\s*录/ })
      .click();
    await expect(page.getByText("需要完成 TOTP 验证")).toBeVisible();
    await page.getByLabel("6 位验证码").fill(totpCode(mfaAdmin.secret));
    await page.getByRole("button", { name: "验证并进入系统" }).click();
    await expect(page.getByText("系统管理员", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "账户菜单" }).click();
    await page.getByRole("button", { name: "管理员安全验证" }).click();
    const dialog = page.getByRole("dialog", { name: "管理员安全验证" });
    await expect(dialog).toBeVisible();
    await resetAdminTotpReplayStep(mfaAdmin.userId);
    await dialog.getByLabel("管理员密码").fill(mfaAdmin.account.password);
    await dialog.getByLabel("6 位验证码").fill(totpCode(mfaAdmin.secret));
    await dialog.getByRole("button", { name: "验证身份" }).click();
    await expect(dialog.getByText("重认证成功")).toBeVisible();
  } finally {
    await context.close();
  }
});
