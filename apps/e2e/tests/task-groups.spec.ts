import { expect, test } from "@playwright/test";

import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";
import { pickCalmSelectOption } from "../helpers/calm-select.js";

/**
 * F-23 合并到主任务 / F-24 解除合并 / F-25 聚合组详情与任务中心聚合组区块的
 * 关键路径 E2E。从功能页任务详情发起合并（搜索主任务 → 选择 → 确认），合并在
 * 当前页面就地打开聚合组弹窗（`/task-groups/{id}` 独立页已改为弹层，地址不变），
 * 在弹窗里验证主任务与来源分支的展示与记录筛选；并在任务中心验证「任务聚合组」
 * 区块（主分支 / 来源分支 / 查看主任务跳转）；随后解除合并，验证组关闭、关系
 * 标记已解除但历史保留。用例依赖任务创建时同事务写入的搜索投影。
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
    await page.getByRole("button", { name: "新增功能" }).click();
    const featureDialog = page.getByRole("dialog", { name: "新增功能" });
    await featureDialog.getByLabel("功能名称").fill(featureName);
    await featureDialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(featureDialog).toBeHidden();
    await page
      .locator(".calm-feature-card")
      .filter({ hasText: featureName })
      .getByRole("link", { name: "查看详情" })
      .click();

    const detail = page.getByRole("dialog", { name: "任务详情" });
    for (const title of [mainTaskTitle, sourceTaskTitle]) {
      await page.getByRole("button", { name: "新建任务", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "新建任务" });
      await dialog.getByLabel("任务标题").fill(title);
      await pickCalmSelectOption(dialog, "负责人", runtime.user.name);
      await dialog.getByRole("button", { name: /保\s*存/ }).click();
      await expect(dialog).toBeHidden();
      // 任务保存后应用会自动打开该任务的详情弹窗（带遮罩），先关闭再继续，
      // 否则后续点击会被遮罩挡住直到用例超时。
      await expect(detail).toBeVisible();
      await detail.getByRole("button", { name: "关闭" }).click();
      await expect(detail).toBeHidden();
    }

    // F-23：从来源任务详情合并到同项目内的主任务。
    await page
      .locator(".calm-task-card")
      .filter({ hasText: sourceTaskTitle })
      .getByRole("button", { name: "任务详情" })
      .click();
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: "合并到主任务" }).click();
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

    // F-25：合并成功后在当前页面就地打开聚合组弹窗（地址不变），弹窗展示主任务
    // 与来源分支；记录为空时给出空态。
    const group = page.locator(".task-group-detail-modal");
    await expect(group).toBeVisible();
    expect(new URL(page.url()).pathname).not.toContain("/task-groups/");
    // 设计师稿 task-center.tsx 的聚合组区块没有「接口说明」黄条：服务端适配器下
    // 弹窗只呈现头部、成员分支与记录面板，开发期接口说明不进入用户界面。
    await expect(group.getByText(/接口说明/)).toHaveCount(0);
    const mainMember = group
      .locator(".task-group-member")
      .filter({ hasText: mainTaskTitle });
    await expect(mainMember).toContainText("主任务");
    const sourceMember = group
      .locator(".task-group-member")
      .filter({ hasText: sourceTaskTitle });
    await expect(sourceMember).toContainText("活动来源分支");
    await expect(group.getByText("暂无迭代记录")).toBeVisible();

    // 记录筛选是弹层局部状态（不再写入 URL），点击后筛选按钮保持选中。
    const mainFilter = group.getByRole("button", {
      name: "主任务",
      exact: true,
    });
    await mainFilter.click();
    await expect(mainFilter).toHaveAttribute("aria-pressed", "true");
    expect(new URL(page.url()).searchParams.get("task")).toBeNull();

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

test("F-25 任务中心聚合组区块展示主分支、来源分支与查看主任务", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    const suffix = Date.now().toString(16).toUpperCase();
    const featureName = "聚合组面板-" + suffix;
    const mainTaskTitle = "面板主任务-" + suffix;
    const sourceTaskTitle = "面板来源任务-" + suffix;

    await page.goto("/projects/" + runtime.projectId + "/modules");
    await page
      .locator(".calm-feature-card")
      .filter({ hasText: "未分类" })
      .first()
      .getByRole("link", { name: "查看功能" })
      .click();
    await page.getByRole("button", { name: "新增功能" }).click();
    const featureDialog = page.getByRole("dialog", { name: "新增功能" });
    await featureDialog.getByLabel("功能名称").fill(featureName);
    await featureDialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(featureDialog).toBeHidden();
    await page
      .locator(".calm-feature-card")
      .filter({ hasText: featureName })
      .getByRole("link", { name: "查看详情" })
      .click();
    const featurePath = new URL(page.url()).pathname;

    const detail = page.getByRole("dialog", { name: "任务详情" });
    for (const title of [mainTaskTitle, sourceTaskTitle]) {
      await page.getByRole("button", { name: "新建任务", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "新建任务" });
      await dialog.getByLabel("任务标题").fill(title);
      await pickCalmSelectOption(dialog, "负责人", runtime.user.name);
      await dialog.getByRole("button", { name: /保\s*存/ }).click();
      await expect(dialog).toBeHidden();
      await expect(detail).toBeVisible();
      await detail.getByRole("button", { name: "关闭" }).click();
      await expect(detail).toBeHidden();
    }

    await page
      .locator(".calm-task-card")
      .filter({ hasText: sourceTaskTitle })
      .getByRole("button", { name: "任务详情" })
      .click();
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: "合并到主任务" }).click();
    const mergeDialog = page.getByRole("dialog", { name: "合并到主任务" });
    await mergeDialog
      .getByLabel("主任务（搜索任务编号或标题，至少 2 个字符）")
      .fill(mainTaskTitle);
    await mergeDialog
      .getByRole("button", { name: new RegExp(mainTaskTitle) })
      .click();
    await mergeDialog.getByRole("button", { name: "确认合并" }).click();
    await expect(page.locator(".task-group-detail-modal")).toBeVisible();
    expect(new URL(page.url()).pathname).not.toContain("/task-groups/");

    // C-1：功能页任务卡片按 R-5 页面级批量显示关系徽章，来源任务详情
    // 的「查看主任务」直达当前聚合组。
    await page.goto(featurePath);
    const sourceCard = page
      .locator(".calm-task-card")
      .filter({ hasText: sourceTaskTitle });
    await expect(
      sourceCard.getByText("来源任务", { exact: true }),
    ).toBeVisible();
    await expect(
      page
        .locator(".calm-task-card")
        .filter({ hasText: mainTaskTitle })
        .getByText("主任务", { exact: true }),
    ).toBeVisible();
    await sourceCard.getByRole("button", { name: "任务详情" }).click();
    await expect(detail.getByText("来源任务", { exact: true })).toBeVisible();
    await detail.getByRole("button", { name: "查看主任务" }).click();
    // 聚合组入口就地打开弹窗，不再离开当前功能页。
    await expect(page.locator(".task-group-detail-modal")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(featurePath);

    // 任务中心「任务聚合组」区块：组头、主分支与活动来源分支。
    await page.goto("/tasks");
    const panel = page.locator(".group-panel");
    await expect(panel).toBeVisible();
    await expect(panel.getByText(/\d+ 个聚合组/)).toBeVisible();
    const card = panel
      .locator(".group-card")
      .filter({ hasText: mainTaskTitle });
    await expect(card).toBeVisible();
    await expect(card.locator("header .task-id")).toContainText("TG-");
    await expect(card.getByText("进行中")).toBeVisible();
    await expect(card.locator("header")).toContainText(runtime.projectName);
    await expect(card).toContainText("来源任务的原始状态");
    const mainRow = card.locator("li").filter({ hasText: mainTaskTitle });
    await expect(mainRow).toContainText("主分支");
    await expect(mainRow).toContainText("未完成");
    await expect(mainRow).toContainText(runtime.user.name);
    const sourceRow = card.locator("li").filter({ hasText: sourceTaskTitle });
    await expect(sourceRow).toContainText("活动来源");

    // 分支按钮按统一模式打开任务详情；返回任务中心后「查看主任务」直达主任务。
    await sourceRow.locator("button.branch-task").click();
    await expect(detail).toBeVisible();
    await expect(detail.getByText(sourceTaskTitle)).toBeVisible();
    await detail.getByRole("button", { name: "关闭" }).click();
    await expect(detail).toBeHidden();

    await page.goto("/tasks");
    const cardAgain = page
      .locator(".group-panel .group-card")
      .filter({ hasText: mainTaskTitle });
    await cardAgain.getByRole("button", { name: "查看主任务" }).click();
    await expect(detail).toBeVisible();
    await expect(detail.getByText(mainTaskTitle)).toBeVisible();
  } finally {
    await context.close();
  }
});
