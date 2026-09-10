import { expect, test } from "@playwright/test";

import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

/**
 * F-23 合并到主任务 / F-24 解除合并 / F-25 聚合组详情页的关键路径 E2E。
 * 从功能页任务详情发起合并（搜索主任务 → 选择 → 确认），落到聚合组页验证
 * 主任务与来源分支的展示与记录筛选的 URL 状态；随后解除合并，验证组关闭、
 * 关系标记已解除但历史保留。用例依赖任务创建时同事务写入的搜索投影。
 */

test("F-23/F-24/F-25 合并到主任务、聚合组详情与解除合并", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    const suffix = Date.now().toString(16).toUpperCase();
    const featureName = "聚合组-" + suffix;
    const mainTaskTitle = "合并主任务-" + suffix;
    const sourceTaskTitle = "合并来源任务-" + suffix;

    await page.goto("/projects/" + runtime.projectId + "/modules");
    await page
      .locator(".calm-feature-card")
      .filter({ hasText: "未分类" })
      .first()
      .getByRole("link", { name: "查看功能" })
      .click();
    await page.getByRole("button", { name: "新建功能" }).click();
    const featureDialog = page.getByRole("dialog", { name: "新建功能" });
    await featureDialog.getByLabel("功能名称").fill(featureName);
    await featureDialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(featureDialog).toBeHidden();
    await page
      .locator(".calm-feature-card")
      .filter({ hasText: featureName })
      .getByRole("link", { name: "查看详情" })
      .click();

    const detailDrawer = page.locator(".task-detail-drawer");
    for (const title of [mainTaskTitle, sourceTaskTitle]) {
      await page.getByRole("button", { name: "新建任务" }).click();
      const dialog = page.getByRole("dialog", { name: "新建任务" });
      await dialog.getByLabel("任务标题").fill(title);
      await dialog
        .getByLabel("负责人")
        .selectOption({ label: runtime.user.name });
      await dialog.getByRole("button", { name: /保\s*存/ }).click();
      await expect(dialog).toBeHidden();
      // 任务保存后应用会自动打开该任务的详情抽屉（带遮罩），先关闭再继续，
      // 否则后续点击会被遮罩挡住直到用例超时。
      await expect(detailDrawer).toBeVisible();
      await detailDrawer.getByRole("button", { name: "关闭" }).click();
      await expect(detailDrawer).toBeHidden();
    }

    // F-23：从来源任务详情合并到同项目内的主任务。
    await page
      .locator(".calm-task-card")
      .filter({ hasText: sourceTaskTitle })
      .getByRole("button", { name: "任务详情" })
      .click();
    const drawer = page.locator(".task-detail-drawer");
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "合并到主任务" }).click();
    const mergeDialog = page.getByRole("dialog", { name: "合并到主任务" });
    await mergeDialog
      .getByLabel("主任务（搜索任务编号或标题，至少 2 个字符）")
      .fill(mainTaskTitle);
    await mergeDialog
      .getByRole("button", { name: new RegExp(mainTaskTitle) })
      .click();
    await expect(
      mergeDialog.getByText("已选择主任务：" + mainTaskTitle),
    ).toBeVisible();
    await mergeDialog.getByRole("button", { name: "确认合并" }).click();

    // F-25：聚合组详情页展示主任务与来源分支；记录为空时给出空态。
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toContain("/task-groups/");
    const group = page.getByTestId("task-group");
    await expect(group).toBeVisible();
    await expect(group.getByTestId("task-group-notice")).toContainText(
      "接口说明：",
    );
    const mainMember = group
      .locator(".task-group-member")
      .filter({ hasText: mainTaskTitle });
    await expect(mainMember).toContainText("主任务");
    const sourceMember = group
      .locator(".task-group-member")
      .filter({ hasText: sourceTaskTitle });
    await expect(sourceMember).toContainText("活动来源分支");
    await expect(group.getByText("暂无迭代记录")).toBeVisible();

    // F-30：记录筛选状态由 URL 承载。
    await group.getByRole("button", { name: "主任务", exact: true }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("task"))
      .not.toBeNull();

    // F-24：解除合并需要二次确认，最后一个活跃来源分支会关闭聚合组。
    await sourceMember.getByRole("button", { name: "解除合并" }).click();
    const unmergeDialog = page.getByRole("dialog", { name: "解除合并" });
    await expect(unmergeDialog).toContainText("最后一个活跃来源分支");
    await unmergeDialog
      .getByLabel("解除原因（选填）")
      .fill("E2E：两个任务实际不重复");
    await unmergeDialog.getByRole("button", { name: "确认解除合并" }).click();
    await expect(page.getByTestId("task-group-unmerged-notice")).toBeVisible();
    await expect(
      group.locator(".task-group-member").filter({ hasText: sourceTaskTitle }),
    ).toContainText("已解除");
    await expect(group.getByText(/聚合组已关闭/)).toBeVisible();
  } finally {
    await context.close();
  }
});
