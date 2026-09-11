import { expect } from "@playwright/test";
import { test } from "../helpers/mfa-fixture.js";

import { resetAdminTotpReplayStep } from "../helpers/admin-totp.js";
import { loginAdminViaUi } from "../helpers/auth-context.js";
import { createProjectViaUi } from "../helpers/project-create.js";
import { loadRuntime } from "../helpers/runtime.js";
import { totpCode } from "../helpers/totp.js";

test("F-06 管理员归档与恢复项目：未完成任务提醒、5 分钟重认证、只读与恢复后读写", async ({
  browser,
  mfaAdmin,
}) => {
  test.setTimeout(300_000);
  // 本地长期 E2E 库中管理员可见的项目列表远大于 CI 空库，每次项目写操作后
  // 列表整体重渲染，UI 状态提交可能明显滞后于 HTTP 响应；默认 10s 断言窗口
  // 在本地不稳定。本文件对这类等待统一放宽，断言语义不变。
  const listTimeoutMs = 60_000;
  const runtime = await loadRuntime();
  const context = await browser.newContext({ baseURL: runtime.webBaseUrl });
  const page = await context.newPage();

  try {
    await loginAdminViaUi(page, runtime, mfaAdmin);
    const created = await createProjectViaUi(page, runtime, "C6", {
      successTimeoutMs: listTimeoutMs,
    });

    await page.getByTestId("open-created-project-activity").click();
    const projectId = Number(page.url().match(/projects\/(\d+)/)?.[1] ?? 0);
    expect(projectId).toBeGreaterThan(0);

    const suffix = Date.now().toString(16).toUpperCase();
    const taskTitle = "未完成任务-" + suffix;
    const featureName = "归档功能-" + suffix;

    // 为归档预览准备一个未完成任务：未分类模块下新建功能与任务。
    await page.goto("/projects/" + projectId + "/modules");
    await page.getByRole("link", { name: "查看功能" }).first().click();
    await page.getByRole("button", { name: "新建功能" }).click();
    const featureDialog = page.getByRole("dialog", { name: "新建功能" });
    await featureDialog.getByLabel("功能名称").fill(featureName);
    await featureDialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(featureDialog).toBeHidden({ timeout: listTimeoutMs });

    await page
      .locator(".calm-feature-card")
      .filter({ hasText: featureName })
      .getByRole("link", { name: "查看详情" })
      .click();
    const featureUrl = page.url();
    await page.getByRole("button", { name: "新建任务" }).click();
    const taskDialog = page.getByRole("dialog", { name: "新建任务" });
    await taskDialog.getByLabel("任务标题").fill(taskTitle);
    await taskDialog
      .getByLabel("负责人")
      .selectOption({ label: runtime.member.name });
    await taskDialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(taskDialog).toBeHidden({ timeout: listTimeoutMs });
    await expect(page.getByRole("dialog", { name: "任务详情" })).toContainText(
      taskTitle,
      { timeout: listTimeoutMs },
    );

    await page.goto("/projects");
    const card = page
      .locator("article.project-card")
      .filter({ hasText: new RegExp(created.code, "i") });
    await expect(card).toBeVisible({ timeout: listTimeoutMs });
    await expect(card.getByText("正常", { exact: true })).toBeVisible({
      timeout: listTimeoutMs,
    });

    // 归档属于高风险操作：先在账户菜单完成 5 分钟内密码 + TOTP 重认证，
    // 归档弹窗才能读取未完成任务预览（未重认证时预览降级为「未能读取」告警）。
    await page.getByRole("button", { name: "账户菜单" }).click();
    await page.getByRole("button", { name: "管理员安全验证" }).click();
    const reauth = page.getByRole("dialog", { name: "管理员安全验证" });
    await expect(reauth).toBeVisible({ timeout: listTimeoutMs });
    await resetAdminTotpReplayStep(mfaAdmin.userId);
    await reauth.getByLabel("管理员密码").fill(mfaAdmin.account.password);
    await reauth.getByLabel("6 位验证码").fill(totpCode(mfaAdmin.secret));
    await reauth.getByRole("button", { name: "验证身份" }).click();
    await expect(reauth.getByText("重认证成功")).toBeVisible({
      timeout: listTimeoutMs,
    });
    await reauth.getByRole("button", { name: /完\s*成/ }).click();
    await expect(reauth).toBeHidden({ timeout: listTimeoutMs });

    // 归档：预览未完成任务 -> 填写原因 -> 重认证窗口内直接确认成功。
    await page.getByTestId("archive-project-" + projectId).click();
    const archiveDialog = page.getByRole("dialog", { name: /归档项目/ });
    await expect(
      archiveDialog.getByText("该项目仍有 1 个未完成任务"),
    ).toBeVisible({ timeout: listTimeoutMs });
    await archiveDialog
      .getByLabel("归档原因")
      .fill("E2E 归档验证：未完成任务已妥善安排");
    await archiveDialog.getByRole("button", { name: "确认归档" }).click();
    await expect(archiveDialog).toBeHidden({ timeout: listTimeoutMs });
    await expect(page.getByTestId("project-management-success")).toContainText(
      "项目「" + created.name + "」已归档",
      { timeout: listTimeoutMs },
    );
    await expect(card.getByText("已归档", { exact: true })).toBeVisible({
      timeout: listTimeoutMs,
    });
    await expect(page.getByTestId("restore-project-" + projectId)).toBeVisible({
      timeout: listTimeoutMs,
    });
    await expect(page.getByTestId("archive-project-" + projectId)).toHaveCount(
      0,
      { timeout: listTimeoutMs },
    );

    // 只读校验：归档后编辑入口返回 PROJECT_ARCHIVED，名称不可保存。
    await page.getByTestId("edit-project-" + projectId).click();
    const editDialog = page.getByRole("dialog", { name: /编辑项目/ });
    await editDialog.getByLabel("项目名称").fill("不应保存的名称");
    await editDialog.getByRole("button", { name: "保存修改" }).click();
    await expect(
      editDialog.getByText("项目已归档，项目只读；需要先恢复后才能编辑。"),
    ).toBeVisible({ timeout: listTimeoutMs });
    await editDialog.getByRole("button", { name: /取\s*消/ }).click();
    await expect(editDialog).toBeHidden({ timeout: listTimeoutMs });
    // 保存被服务端拒绝后名称未落库：列表卡片仍是原名称。
    await expect(card.getByText(created.name, { exact: true })).toBeVisible({
      timeout: listTimeoutMs,
    });

    // 恢复：仍处于同一 5 分钟重认证窗口内，不需要第二次 TOTP。
    await page.getByTestId("restore-project-" + projectId).click();
    const restoreDialog = page.getByRole("dialog", { name: /恢复项目/ });
    await restoreDialog
      .getByLabel("恢复原因")
      .fill("E2E 恢复验证：确认历史数据完整");
    await restoreDialog.getByRole("button", { name: "确认恢复" }).click();
    await expect(restoreDialog).toBeHidden({ timeout: listTimeoutMs });
    await expect(page.getByTestId("project-management-success")).toContainText(
      "项目「" + created.name + "」已恢复为正常状态",
      { timeout: listTimeoutMs },
    );
    await expect(card.getByText("正常", { exact: true })).toBeVisible({
      timeout: listTimeoutMs,
    });
    await expect(page.getByTestId("archive-project-" + projectId)).toBeVisible({
      timeout: listTimeoutMs,
    });

    // 恢复后重新可写：编辑名称保存成功。
    const renamed = created.name + "（恢复后）";
    await page.getByTestId("edit-project-" + projectId).click();
    await editDialog.getByLabel("项目名称").fill(renamed);
    await editDialog.getByRole("button", { name: "保存修改" }).click();
    await expect(editDialog).toBeHidden({ timeout: listTimeoutMs });
    await expect(page.getByTestId("project-management-success")).toContainText(
      "项目「" + renamed + "」已更新",
      { timeout: listTimeoutMs },
    );

    // 归档/恢复周期未丢失历史数据：功能下任务仍可见。
    await page.goto(featureUrl);
    await expect(page.getByText(taskTitle, { exact: true })).toBeVisible({
      timeout: listTimeoutMs,
    });
  } finally {
    await context.close();
  }
});
