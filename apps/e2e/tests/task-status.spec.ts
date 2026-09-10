import { expect, test } from "@playwright/test";
import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

for (const moduleScope of [false, true])
  test(`F-16 ${moduleScope ? "MODULE" : "FEATURE"} 状态闭环与不可变历史`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const runtime = await loadRuntime();
    const { context, page } = await createAuthenticatedContext(
      browser,
      runtime,
    );
    try {
      await page.goto(`/projects/${runtime.projectId}/modules`);
      const suffix = Date.now();
      if (moduleScope)
        await page.getByRole("link", { name: "模块任务" }).first().click();
      else {
        await page.getByRole("link", { name: "查看功能" }).first().click();
        await page.getByRole("button", { name: "新建功能" }).click();
        const feature = page.getByRole("dialog", { name: "新建功能" });
        await feature.getByLabel("功能名称").fill(`状态功能-${suffix}`);
        await feature.getByRole("button", { name: /保\s*存/ }).click();
        await expect(feature).toBeHidden();
        await page
          .locator(".calm-feature-card")
          .filter({ hasText: `状态功能-${suffix}` })
          .getByRole("link", { name: "查看详情" })
          .click();
      }
      await page.getByRole("button", { name: "新建任务" }).click();
      const create = page.getByRole("dialog", { name: "新建任务" });
      const title = `状态任务-${suffix}`;
      await create.getByLabel("任务标题").fill(title);
      await create
        .getByLabel("负责人")
        .selectOption({ label: runtime.user.name });
      await create.getByRole("button", { name: /保\s*存/ }).click();
      await expect(create).toBeHidden();
      const detail = page.getByRole("dialog", { name: "任务详情" });
      await detail
        .getByRole("button", { name: "完成任务", exact: true })
        .click();
      const complete = page.getByRole("dialog", {
        name: "完成任务",
        exact: true,
      });
      await complete.getByLabel("是否产生实际功能变化").selectOption("yes");
      await expect(
        complete.getByRole("button", { name: "发布并完成任务" }),
      ).toBeDisabled();
      await complete.getByLabel("是否产生实际功能变化").selectOption("no");
      await complete.getByLabel("完成原因").selectOption("测试验证");
      await complete.getByLabel("完成补充说明").fill("首次验证完成");
      await complete.getByRole("button", { name: "确认完成任务" }).click();
      await expect(complete).toBeHidden();
      await expect(
        detail.getByText("完成说明：测试验证，不涉及功能变化：首次验证完成"),
      ).toBeVisible();
      for (const [action, reason] of [
        ["重新打开", "追加验证"],
        ["取消任务", "暂不需要"],
        ["恢复任务", "需求恢复"],
      ]) {
        await detail
          .getByRole("button", { name: action!, exact: true })
          .click();
        const modal = page.getByRole("dialog", { name: action!, exact: true });
        await modal.getByLabel("操作原因（选填）").fill(reason!);
        await modal.getByRole("button", { name: `确认${action}` }).click();
        await expect(modal).toBeHidden();
        await expect(
          detail.getByText(`原因：${reason}`, { exact: true }),
        ).toBeVisible();
      }
      await detail
        .getByRole("button", { name: "完成任务", exact: true })
        .click();
      await complete.getByLabel("是否产生实际功能变化").selectOption("no");
      await complete.getByLabel("完成原因").selectOption("技术调研");
      await complete.getByLabel("完成补充说明").fill("二次完成");
      await complete.getByRole("button", { name: "确认完成任务" }).click();
      await expect(complete).toBeHidden();
      await expect(detail.locator(".task-status-history > li")).toHaveCount(6);
      await page.screenshot({
        path: `test-results/f16-${moduleScope ? "module" : "feature"}-history.png`,
        fullPage: true,
      });
      await page.reload();
      await page.getByLabel("任务状态筛选").selectOption("DONE");
      await page
        .locator(".calm-task-card")
        .filter({ hasText: title })
        .getByRole("button", { name: "任务详情" })
        .click();
      await expect(detail.locator(".task-status-history > li")).toHaveCount(6);
      await expect(
        detail.getByText("完成说明：技术调研，不涉及功能变化：二次完成"),
      ).toBeVisible();
      await page.goto(`/search?q=${encodeURIComponent(title)}`);
      await expect(
        page.getByText(title, { exact: true }).first(),
      ).toBeVisible();
    } finally {
      await context.close();
    }
  });
