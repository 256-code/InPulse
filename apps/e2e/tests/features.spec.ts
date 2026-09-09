import { expect } from "@playwright/test";
import { test } from "../helpers/mfa-fixture.js";
import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";
import { totpCode } from "../helpers/totp.js";

test("功能档案：模块入口、创建详情、双页面三方合并、刷新持久化", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    await page.goto(`/projects/${runtime.projectId}/modules`);
    await page.getByRole("link", { name: "查看功能" }).first().click();
    await expect(page.getByRole("heading", { name: "功能档案" })).toBeVisible();
    expect(page.url()).toMatch(/\/modules\/\d+\/features$/);
    const listUrl = page.url();
    const name = `退款功能-${Date.now()}`;
    await page.getByRole("button", { name: "新建功能" }).click();
    const create = page.getByRole("dialog", { name: "新建功能" });
    await create.getByLabel("功能名称").fill(name);
    await create.getByLabel("当前功能说明").fill("创建时的说明");
    await create.getByLabel("标签（每行一个，最多 50 个）").fill("支付\n退款");
    await create.getByRole("button", { name: /保\s*存/ }).click();
    await expect(create).toBeHidden();
    await page
      .locator(".calm-feature-card")
      .filter({ hasText: name })
      .getByRole("link", { name: "查看详情" })
      .click();
    await expect(page.getByRole("heading", { name })).toBeVisible();
    await expect(
      page
        .locator(".feature-reading")
        .getByText("创建时的说明", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /归\s*档/ })).toHaveCount(0);
    await page.getByRole("button", { name: /编\s*辑/ }).click();
    const edit = page.getByRole("dialog", { name: "编辑功能" });
    await edit.getByLabel("功能名称").fill(`${name}-更新`);
    const other = await context.newPage();
    await other.goto(page.url());
    await other.getByRole("button", { name: /编\s*辑/ }).click();
    const otherEdit = other.getByRole("dialog", { name: "编辑功能" });
    await otherEdit.getByLabel("当前功能说明").fill("其他页面的新说明");
    await otherEdit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(otherEdit).toBeHidden();
    await edit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(edit.getByText(/输入已保留/)).toBeVisible();
    await edit.getByRole("button", { name: "加载最新版本后继续编辑" }).click();
    await expect(edit.getByLabel("当前功能说明")).toHaveValue(
      "其他页面的新说明",
    );
    await expect(edit.getByLabel("功能名称")).toHaveValue(`${name}-更新`);
    await edit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(edit).toBeHidden();
    await page.getByRole("button", { name: /编\s*辑/ }).click();
    await edit.getByLabel("当前功能说明").fill("我的说明草稿");
    await other.reload();
    await other.getByRole("button", { name: /编\s*辑/ }).click();
    await otherEdit.getByLabel("当前功能说明").fill("其他页面再次修改");
    await otherEdit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(otherEdit).toBeHidden();
    await edit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(edit.getByText(/输入已保留/)).toBeVisible();
    await edit.getByRole("button", { name: "加载最新版本后继续编辑" }).click();
    await expect(edit.getByText("当前功能说明存在冲突")).toBeVisible();
    await expect(edit.getByRole("button", { name: /保\s*存/ })).toBeDisabled();
    await edit.getByRole("button", { name: "采用最新当前功能说明" }).click();
    await edit.getByRole("button", { name: "应用合并结果" }).click();
    await edit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(edit).toBeHidden();
    await page.reload();
    await expect(
      page
        .locator(".feature-reading")
        .getByText("其他页面再次修改", { exact: true }),
    ).toBeVisible();
    await page.goto(listUrl);
    await expect(page.getByText(`${name}-更新`, { exact: true })).toBeVisible();
    await other.close();
  } finally {
    await context.close();
  }
});

test("功能管理员通过真实安全验证归档并恢复，刷新保留状态", async ({
  browser,
  mfaAdmin,
}) => {
  test.setTimeout(90_000);
  const runtime = await loadRuntime();
  const { context: memberContext, page: memberPage } =
    await createAuthenticatedContext(browser, runtime);
  const context = await browser.newContext({ baseURL: runtime.webBaseUrl });
  const page = await context.newPage();
  try {
    await memberPage.goto(`/projects/${runtime.projectId}/modules`);
    await memberPage.getByRole("link", { name: "查看功能" }).first().click();
    await memberPage.getByRole("button", { name: "新建功能" }).click();
    const create = memberPage.getByRole("dialog", { name: "新建功能" });
    const name = `归档功能-${Date.now()}`;
    await create.getByLabel("功能名称").fill(name);
    await create.getByRole("button", { name: /保\s*存/ }).click();
    await expect(create).toBeHidden();
    await memberPage
      .locator(".calm-feature-card")
      .filter({ hasText: name })
      .getByRole("link", { name: "查看详情" })
      .click();
    const detailUrl = memberPage.url();
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
    await page.goto(detailUrl);
    await page.getByRole("button", { name: /归\s*档/ }).click();
    const archive = page.getByRole("dialog", { name: "归档功能" });
    await archive.getByLabel("操作原因").fill("功能下线，保留历史");
    await archive.getByRole("button", { name: "管理员安全验证" }).click();
    const security = page.getByRole("dialog", { name: "管理员安全验证" });
    await expect(security).toBeVisible({ timeout: 5000 });
    await security.getByLabel("管理员密码").fill(mfaAdmin.account.password);
    await security
      .getByLabel("6 位验证码")
      .fill(totpCode(mfaAdmin.secret, Date.now() + 30_000));
    await security.getByRole("button", { name: "验证身份" }).click();
    await expect(security).toBeHidden();
    await archive.getByRole("button", { name: /确\s*认/ }).click();
    await expect(archive).toBeHidden();
    await page.reload();
    await expect(page.getByRole("button", { name: /恢\s*复/ })).toBeVisible();
    await memberPage.reload();
    await expect(
      memberPage.locator(".feature-facts").getByText("已归档", { exact: true }),
    ).toBeVisible();
    await expect(
      memberPage.getByRole("button", { name: /编\s*辑/ }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: /恢\s*复/ }).click();
    const restore = page.getByRole("dialog", { name: "恢复功能" });
    await restore.getByLabel("操作原因").fill("重新启用功能");
    await restore.getByRole("button", { name: /确\s*认/ }).click();
    await expect(restore).toBeHidden();
    await page.reload();
    await expect(page.getByRole("button", { name: /编\s*辑/ })).toBeVisible();
  } finally {
    await memberContext.close();
    await context.close();
  }
});
