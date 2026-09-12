import { expect } from "@playwright/test";
import { test } from "../helpers/mfa-fixture.js";
import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";
import { resetAdminTotpReplayStep } from "../helpers/admin-totp.js";
import { totpCode } from "../helpers/totp.js";
test("F21 管理员双因子作废、发现VOID与恢复，成员重新可读旧版本", async ({
  browser,
  mfaAdmin,
}) => {
  test.setTimeout(150000);
  const runtime = await loadRuntime(),
    member = await createAuthenticatedContext(browser, runtime);
  const context = await browser.newContext({ baseURL: runtime.webBaseUrl }),
    page = await context.newPage();
  try {
    const title = "生命周期-" + Date.now(),
      privateReason = "仅管理员原因-" + Date.now();
    await member.page.goto(`/records?projectId=${runtime.projectId}`);
    await member.page.getByRole("button", { name: "新建独立草稿" }).click();
    const draft = member.page.getByRole("dialog", { name: "新建独立草稿" });
    await draft.getByLabel("所属模块").selectOption({ index: 1 });
    await draft.getByLabel("迭代标题").fill(title);
    await draft.getByLabel("为什么改、发现了什么问题").fill("原始问题");
    await draft.getByLabel("改了什么、怎么改的").fill("原始方案");
    await draft.getByLabel("改完效果如何、如何验证").fill("原始验证");
    await draft.getByLabel("还有什么问题（选填）").fill("保留遗留问题");
    await draft.getByRole("button", { name: "保存草稿" }).click();
    await expect(draft).toBeHidden();
    await member.page
      .getByRole("button", { name: "发布记录", exact: true })
      .click();
    const publish = member.page.getByRole("dialog", { name: "发布迭代记录" });
    await publish.getByRole("button", { name: "确认发布" }).click();
    await expect(publish).toBeHidden();
    const memberDetail = member.page.getByRole("region", {
      name: "正式记录详情",
    });
    await expect(memberDetail).toBeVisible();
    const recordUrl = member.page.url();
    await expect(
      memberDetail.getByRole("button", { name: "作废记录" }),
    ).toHaveCount(0);
    await resetAdminTotpReplayStep(mfaAdmin.userId);
    await page.goto("/login");
    await page.getByLabel("登录名").fill(mfaAdmin.account.loginName);
    await page.getByLabel("密码").fill(mfaAdmin.account.password);
    await page
      .locator("form")
      .getByRole("button", { name: /登\s*录/ })
      .click();
    await page.getByLabel("6 位验证码").fill(totpCode(mfaAdmin.secret));
    await page.getByRole("button", { name: "验证并进入系统" }).click();
    await expect(page.getByText("系统管理员", { exact: true })).toBeVisible();
    await page.goto(recordUrl);
    const detail = page.getByRole("region", { name: "正式记录详情" });
    await detail.getByRole("button", { name: "作废记录" }).click();
    const voidDialog = page.getByRole("dialog", {
      name: "作废记录",
      exact: true,
    });
    await expect(
      voidDialog.getByRole("button", { name: "确认作废记录" }),
    ).toBeDisabled();
    await voidDialog.getByLabel("作废原因").fill(privateReason);
    await voidDialog.getByRole("button", { name: "确认作废记录" }).click();
    const reauth = page.getByRole("dialog", { name: "管理员安全验证" });
    await expect(reauth).toBeVisible();
    await resetAdminTotpReplayStep(mfaAdmin.userId);
    await reauth.getByLabel("管理员密码").fill(mfaAdmin.account.password);
    await reauth.getByLabel("6 位验证码").fill(totpCode(mfaAdmin.secret));
    await reauth.getByRole("button", { name: "验证身份" }).click();
    await expect(reauth).toBeHidden();
    await expect(voidDialog.getByLabel("作废原因")).toHaveValue(privateReason);
    await voidDialog.getByRole("button", { name: "确认作废记录" }).click();
    await expect(voidDialog).toBeHidden();
    await expect(detail.getByText("已作废 · 仅管理员可见")).toBeVisible();
    await expect(detail.getByText(privateReason)).toBeVisible();
    await member.page.reload();
    await expect(
      member.page.getByText("记录不存在或当前无法访问。"),
    ).toBeVisible();
    await page
      .getByRole("group", { name: "记录状态" })
      .getByRole("button", { name: "已作废" })
      .click();
    await page
      .locator(".record-card")
      .filter({ hasText: title })
      .locator("summary")
      .click();
    await expect(detail.getByLabel("较早版本")).toHaveValue("1");
    await expect(
      detail.getByLabel("版本差异").getByText("原始方案").first(),
    ).toBeVisible();
    await detail.getByRole("button", { name: "恢复记录" }).click();
    const restore = page.getByRole("dialog", { name: "恢复记录", exact: true });
    await restore.getByLabel("恢复原因").fill("纠正误作废");
    await restore.getByRole("button", { name: "确认恢复记录" }).click();
    await expect(restore).toBeHidden();
    await expect(detail.getByText(/-CR-\d+ · v1 · 已发布/)).toBeVisible();
    await expect(detail.getByText(privateReason)).toHaveCount(0);
    await member.page.goto(recordUrl);
    await expect(memberDetail.getByText(/-CR-\d+ · v1 · 已发布/)).toBeVisible();
    await expect(
      memberDetail.getByLabel("版本差异").getByText("保留遗留问题").first(),
    ).toBeVisible();
    await member.page.screenshot({
      path: "test-results/f21-restored-member.png",
      fullPage: true,
    });
    await member.page.goto(`/search?q=${encodeURIComponent(title)}`);
    await expect(
      member.page.getByText(title, { exact: true }).first(),
    ).toBeVisible();
    await expect(member.page.getByText(privateReason)).toHaveCount(0);
  } finally {
    await context.close();
    await member.context.close();
  }
});
