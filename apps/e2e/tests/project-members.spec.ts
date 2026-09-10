import { expect } from "@playwright/test";
import { test } from "../helpers/mfa-fixture.js";

import {
  createAuthenticatedContext,
  loginAdminViaUi,
} from "../helpers/auth-context.js";
import { resetAdminTotpReplayStep } from "../helpers/admin-totp.js";
import { loadRuntime } from "../helpers/runtime.js";
import { totpCode } from "../helpers/totp.js";

test("普通成员不能访问项目成员管理页面", async ({ browser }) => {
  test.setTimeout(60_000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    await page.goto(`/projects/${runtime.projectId}/members`);
    await expect(page.getByTestId("admin-forbidden")).toBeVisible();
    await expect(page.getByText("无权访问", { exact: true })).toBeVisible();
    await expect(
      page.getByText("此区域仅限系统管理员访问。", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});

test("管理员完成成员添加与移除，并校验不存在项目的读取边界", async ({
  browser,
  mfaAdmin,
}) => {
  test.setTimeout(180_000);
  const runtime = await loadRuntime();
  const context = await browser.newContext({ baseURL: runtime.webBaseUrl });
  const page = await context.newPage();
  const memberCard = page
    .locator(".calm-member-card")
    .filter({ hasText: runtime.member.name })
    .last();

  try {
    await loginAdminViaUi(page, runtime, mfaAdmin);
    await page.goto(`/projects/${runtime.projectId}/members`);
    await expect(
      page.getByRole("heading", { name: "项目成员管理" }),
    ).toBeVisible();

    const reauth = page.getByRole("dialog", { name: "管理员安全验证" });
    await expect(reauth).toBeVisible();
    await resetAdminTotpReplayStep(mfaAdmin.userId);
    await reauth.getByLabel("管理员密码").fill(mfaAdmin.account.password);
    await reauth.getByLabel("6 位验证码").fill(totpCode(mfaAdmin.secret));
    await reauth.getByRole("button", { name: "验证身份" }).click();
    await expect(reauth).toBeHidden();

    await expect(page.getByText("成员与历史", { exact: true })).toBeVisible();
    await expect(
      page.locator(".calm-member-card").filter({ hasText: runtime.user.name }),
    ).toHaveCount(1);

    await page.getByRole("button", { name: "添加成员" }).click();
    const addDialog = page.getByRole("dialog", { name: "添加项目成员" });
    await addDialog.getByLabel(`选择成员：${runtime.member.name}`).check();
    await addDialog.getByRole("button", { name: "添加成员" }).click();
    await expect(
      page.getByText("成员已添加，项目成员列表已更新。"),
    ).toBeVisible();
    await expect(
      memberCard.getByText("活跃成员", { exact: true }),
    ).toBeVisible();

    await memberCard.getByRole("button", { name: /移\s*除/ }).click();
    const removeDialog = page.getByRole("dialog", { name: "移除项目成员" });
    await expect(
      removeDialog.getByText(`确认从项目中移除 ${runtime.member.name}？`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      removeDialog.getByText("该成员没有未完成任务。", { exact: true }),
    ).toBeVisible();
    await removeDialog.getByRole("button", { name: "确认移除" }).click();
    await expect(
      page.getByText(
        "成员已移出项目，未改派任务保留原负责人且该成员已失去处理权限。",
      ),
    ).toBeVisible();
    await expect(memberCard.getByText("已移除", { exact: true })).toBeVisible();
    await expect(
      memberCard.getByText("历史记录已保留", { exact: true }),
    ).toBeVisible();
    await expect(memberCard.locator(".member-removed-note")).toBeVisible();

    await page.goto("/projects/999999999/members");
    await expect(
      page.getByText("项目成员加载失败", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("项目或成员不存在，或你已无权访问。", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
