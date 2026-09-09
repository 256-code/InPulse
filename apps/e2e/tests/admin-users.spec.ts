import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import {
  createAuthenticatedContext,
  loginAdminViaUi,
} from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";
import { totpCode } from "../helpers/totp.js";

test("普通成员不能访问用户管理页面", async ({ browser }) => {
  test.setTimeout(60_000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    await page.goto("/settings");
    await expect(page.getByTestId("admin-forbidden")).toBeVisible();
    await expect(page.getByText("无权访问", { exact: true })).toBeVisible();
    await expect(
      page.getByText("此区域仅限系统管理员访问。", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("管理员完成用户新增、编辑、停用、启用与强制退出", async ({ browser }) => {
  test.setTimeout(120_000);
  const runtime = await loadRuntime();
  const context = await browser.newContext({
    baseURL: runtime.webBaseUrl,
  });
  const page = await context.newPage();
  const suffix = `${Date.now().toString(36)}${randomUUID().slice(0, 6)}`;
  const loginName = `f03_${suffix}`;
  const name = `F-03 用户 ${suffix}`;

  try {
    await loginAdminViaUi(page, runtime);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "用户管理" })).toBeVisible();

    await page.getByRole("button", { name: "新增用户" }).click();
    const createDialog = page.getByRole("dialog", { name: "新增用户" });
    await createDialog.getByLabel("登录名").fill(loginName);
    await createDialog.getByLabel("姓名").fill(name);
    await createDialog.getByLabel("邮箱").fill(`${loginName}@example.com`);
    await createDialog.getByLabel("初始密码").fill("f03-e2e-password-123");
    await createDialog.getByRole("button", { name: /保\s*存/ }).click();

    const reauth = page.getByRole("dialog", { name: "管理员安全验证" });
    await expect(reauth).toBeVisible();
    await reauth.getByLabel("管理员密码").fill(runtime.adminMfa.password);
    await reauth
      .getByLabel("6 位验证码")
      .fill(totpCode(runtime.adminMfaSecret));
    await reauth.getByRole("button", { name: "验证身份" }).click();
    await expect(reauth).toBeHidden();
    await expect(
      createDialog.getByText("管理员安全验证已完成，请重新提交当前操作。", {
        exact: true,
      }),
    ).toBeVisible();
    await createDialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(page.getByText("用户创建成功", { exact: true })).toBeVisible();

    const card = page.locator(".ant-card").filter({ hasText: loginName });
    await expect(card.getByText(name, { exact: true })).toBeVisible();

    await card.getByRole("button", { name: /编\s*辑/ }).click();
    const editDialog = page.getByRole("dialog", { name: "编辑用户" });
    const updatedName = `${name}-已编辑`;
    await editDialog.getByLabel("姓名").fill(updatedName);
    await editDialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(editDialog).toBeHidden();
    await expect(card.getByText(updatedName, { exact: true })).toBeVisible();

    await card.getByRole("button", { name: /停\s*用/ }).click();
    const disableDialog = page.getByRole("dialog", { name: "停用用户" });
    await disableDialog.getByRole("button", { name: /确\s*认/ }).click();
    await expect(disableDialog).toBeHidden();
    await expect(card.getByText("已停用", { exact: true })).toBeVisible();

    await card.getByRole("button", { name: /启\s*用/ }).click();
    const enableDialog = page.getByRole("dialog", { name: "启用用户" });
    await enableDialog.getByRole("button", { name: /确\s*认/ }).click();
    await expect(enableDialog).toBeHidden();
    await expect(card.getByText("正常", { exact: true })).toBeVisible();

    await card.getByRole("button", { name: "强制退出" }).click();
    const logoutDialog = page.getByRole("dialog", { name: "强制退出" });
    await logoutDialog.getByRole("button", { name: /确\s*认/ }).click();
    await expect(logoutDialog).toBeHidden();
    await expect(
      page.getByText("已强制退出该用户", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
