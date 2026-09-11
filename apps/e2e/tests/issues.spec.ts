import { expect, test } from "@playwright/test";
import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

/**
 * F-20 遗留问题页（R-6）关键路径 E2E：发布带「还有什么问题」的迭代记录后，
 * 未闭环桶展示来源记录、来源任务与转为任务入口；页内完成转换后按应用统一
 * 模式自动打开新建的跟进任务详情，回到遗留问题页可见该条移入已闭环折叠区
 * 并保留跟进任务入口，原记录内容不被改写。
 */

test("F-20 遗留问题页未闭环展示与页内转为任务闭环", async ({ browser }) => {
  test.setTimeout(120_000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    const suffix = Date.now().toString(16).toUpperCase();
    const taskTitle = "遗留页来源任务-" + suffix;
    const followupTitle = "遗留页跟进-" + suffix;
    const leftover =
      "遗留页跟原文 " + suffix + "：充电策略参数配置项缺少默认值校验。";

    await page.goto("/projects/" + runtime.projectId + "/modules");
    await page.getByRole("link", { name: "模块任务" }).first().click();
    await page.getByRole("button", { name: "新建任务" }).click();
    const form = page.getByRole("dialog", { name: "新建任务" });
    await form.getByLabel("任务标题").fill(taskTitle);
    await form.getByLabel("负责人").selectOption({ label: runtime.user.name });
    await form.getByRole("button", { name: /保\s*存/ }).click();
    await expect(form).toBeHidden();
    const task = page.getByRole("dialog", { name: "任务详情" });
    await task.getByRole("button", { name: "完成任务", exact: true }).click();
    const completion = page.getByRole("dialog", {
      name: "完成任务",
      exact: true,
    });
    await completion.getByLabel("是否产生实际功能变化").selectOption("yes");
    for (const label of [
      "为什么改、发现了什么问题",
      "改了什么、怎么改的",
      "改完效果如何、如何验证",
    ])
      await completion.getByLabel(label).fill("F-20 E2E 内容 " + suffix);
    await completion.getByLabel("还有什么问题（选填）").fill(leftover);
    await completion
      .getByRole("button", { name: "发布并完成任务", exact: true })
      .click();
    await expect(completion).toBeHidden();

    await page.goto("/issues");
    await expect(page.getByTestId("issues-page")).toBeVisible();
    await expect(page.getByText(/按发布时间倒序/)).toBeVisible();
    const row = page
      .getByTestId(/^leftover-item-/)
      .filter({ hasText: leftover });
    await expect(row).toBeVisible();
    await expect(row.getByText("待闭环")).toBeVisible();
    await expect(row).toContainText(taskTitle);

    await row.getByRole("button", { name: /^来源任务/ }).click();
    const drawer = page.locator(".task-detail-drawer");
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(taskTitle)).toBeVisible();

    await page.goto("/issues");
    await page
      .getByTestId(/^leftover-item-/)
      .filter({ hasText: leftover })
      .getByRole("button", { name: "转为任务" })
      .click();
    const convert = page.getByRole("dialog", { name: "遗留问题转为新任务" });
    await expect(convert.getByText(leftover)).toBeVisible();
    await convert.getByLabel("跟进任务标题").fill(followupTitle);
    await convert
      .getByLabel("跟进任务负责人")
      .selectOption({ label: runtime.user.name });
    await convert.getByRole("button", { name: "创建跟进任务" }).click();
    await expect(convert).toBeHidden();

    // 转换成功后与新建任务一致，自动打开新建的跟进任务详情。
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(followupTitle)).toBeVisible();

    // 回到遗留问题页：条目离开未闭环桶，进入已闭环折叠区并保留跟进任务入口。
    await page.goto("/issues");
    await expect(
      page
        .locator(".issues-page > .issue-list")
        .getByTestId(/^leftover-item-/)
        .filter({ hasText: leftover }),
    ).toHaveCount(0);

    const closed = page.locator("details.history-block");
    await expect(closed.locator("summary")).toContainText("已闭环");
    await closed.locator("summary").click();
    const closedRow = closed
      .getByTestId(/^leftover-item-/)
      .filter({ hasText: leftover });
    await expect(closedRow).toBeVisible();
    await expect(closedRow.getByText("已闭环")).toBeVisible();
    await closedRow.getByRole("button", { name: /查看跟进任务/ }).click();
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(followupTitle)).toBeVisible();
  } finally {
    await context.close();
  }
});
