import { expect, test } from "@playwright/test";
import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";
test("F-17 独立草稿保存、继续编辑和刷新持久化", async ({ browser }) => {
  test.setTimeout(90000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    await page.goto(`/records?projectId=${runtime.projectId}`);
    await page.getByRole("button", { name: "新建独立草稿" }).click();
    const create = page.getByRole("dialog", { name: "新建独立草稿" });
    await create.getByLabel("所属模块").selectOption({ index: 1 });
    const title = `独立草稿-${Date.now()}`;
    await create.getByLabel("迭代标题").fill(title);
    await create
      .getByLabel("为什么改、发现了什么问题")
      .fill("重复提交造成状态冲突");
    await create.getByLabel("改了什么、怎么改的").fill("增加幂等校验");
    await create.getByLabel("改完效果如何、如何验证").fill("并发请求验证通过");
    await create.getByRole("button", { name: "保存草稿" }).click();
    await expect(create).toBeHidden();
    const detail = page.getByRole("region", { name: "草稿详情" });
    await expect(detail.getByText("暂无已知遗留问题")).toBeVisible();
    await page.getByRole("button", { name: "继续编辑" }).click();
    const edit = page.getByRole("dialog", { name: "编辑草稿" });
    await edit.getByLabel("还有什么问题（选填）").fill("继续观察高峰流量");
    await edit.getByRole("button", { name: "保存草稿" }).click();
    await expect(edit).toBeHidden();
    await page.reload();
    await expect(detail.getByText("继续观察高峰流量")).toBeVisible();
    await expect(
      detail.getByText("草稿尚未发布，不计入正式迭代统计。"),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/f17-independent-draft.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
for (const moduleScope of [false, true])
  test(`F-17 ${moduleScope ? "MODULE" : "FEATURE"} 来源多草稿选择与不完成任务`, async ({
    browser,
  }) => {
    test.setTimeout(90000);
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
        await feature.getByLabel("功能名称").fill(`草稿功能-${suffix}`);
        await feature.getByRole("button", { name: /保\s*存/ }).click();
        await expect(feature).toBeHidden();
        await page
          .locator(".calm-feature-card")
          .filter({ hasText: `草稿功能-${suffix}` })
          .getByRole("link", { name: "查看详情" })
          .click();
      }
      await page.getByRole("button", { name: "新建任务" }).click();
      const createTask = page.getByRole("dialog", { name: "新建任务" });
      const title = `草稿任务-${suffix}`;
      await createTask.getByLabel("任务标题").fill(title);
      await createTask
        .getByLabel("负责人")
        .selectOption({ label: runtime.user.name });
      await createTask.getByRole("button", { name: /保\s*存/ }).click();
      await expect(createTask).toBeHidden();
      const task = page.getByRole("dialog", { name: "任务详情" });
      await task.getByRole("button", { name: "完成任务", exact: true }).click();
      const complete = page.getByRole("dialog", {
        name: "完成任务",
        exact: true,
      });
      await complete.getByLabel("是否产生实际功能变化").selectOption("yes");
      await expect(
        complete.getByRole("button", { name: "确认完成任务" }),
      ).toBeDisabled();
      await complete.getByRole("link", { name: "选择或新建草稿" }).click();
      for (let i = 1; i <= 2; i++) {
        await page.getByRole("button", { name: "新建来源草稿" }).click();
        const create = page.getByRole("dialog", { name: "新建来源草稿" });
        await expect(create.getByLabel("迭代标题")).toHaveValue(title);
        if (i === 2) await create.getByLabel("迭代标题").fill(title + "第二条");
        await create
          .getByLabel("为什么改、发现了什么问题")
          .fill("来源问题" + i);
        await create.getByLabel("改了什么、怎么改的").fill("方案" + i);
        await create.getByLabel("改完效果如何、如何验证").fill("验证" + i);
        await create.getByRole("button", { name: "保存草稿" }).click();
        await expect(create).toBeHidden();
        await expect(
          page.getByRole("button", { name: "查看草稿" }),
        ).toHaveCount(i);
      }
      await page
        .locator(".calm-task-card")
        .filter({ hasText: title + "第二条" })
        .getByRole("button", { name: "查看草稿" })
        .click();
      await page.getByRole("button", { name: "继续编辑" }).click();
      const edit = page.getByRole("dialog", { name: "编辑草稿" });
      await edit.getByLabel("还有什么问题（选填）").fill("来源草稿补充");
      await edit.getByRole("button", { name: "保存草稿" }).click();
      await expect(edit).toBeHidden();
      await page.reload();
      await expect(
        page
          .getByRole("region", { name: "草稿详情" })
          .getByText("来源草稿补充"),
      ).toBeVisible();
      await page.screenshot({
        path: `test-results/f17-${moduleScope ? "module" : "feature"}-drafts.png`,
        fullPage: true,
      });
      await page.getByRole("link", { name: "返回来源任务" }).click();
      await expect(
        task.getByRole("button", { name: "完成任务", exact: true }),
      ).toBeEnabled();
      await expect(task.locator(".task-status-history > li")).toHaveCount(1);
    } finally {
      await context.close();
    }
  });
