import { expect, test, type Page } from "@playwright/test";
import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";
async function createTask(
  page: Page,
  runtime: Awaited<ReturnType<typeof loadRuntime>>,
  feature: boolean,
) {
  const title = `组合任务-${Date.now()}`;
  await page.goto(`/projects/${runtime.projectId}/modules`);
  if (feature) {
    await page.getByRole("link", { name: "查看功能" }).first().click();
    await page.getByRole("button", { name: "新建功能" }).click();
    const dialog = page.getByRole("dialog", { name: "新建功能" });
    await dialog.getByLabel("功能名称").fill(title + "功能");
    await dialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(dialog).toBeHidden();
    await page
      .locator(".calm-feature-card")
      .filter({ hasText: title + "功能" })
      .getByRole("link", { name: "查看详情" })
      .click();
  } else await page.getByRole("link", { name: "模块任务" }).first().click();
  await page.getByRole("button", { name: "新建任务" }).click();
  const form = page.getByRole("dialog", { name: "新建任务" });
  await form.getByLabel("任务标题").fill(title);
  await form.getByLabel("负责人").selectOption({ label: runtime.user.name });
  await form.getByRole("button", { name: /保\s*存/ }).click();
  await expect(form).toBeHidden();
  const task = page.getByRole("dialog", { name: "任务详情" });
  const sourceUrl = new URL(
    (await task
      .getByRole("link", { name: "迭代记录草稿" })
      .getAttribute("href"))!,
    page.url(),
  );
  const url = new URL(page.url());
  url.searchParams.set("taskId", sourceUrl.searchParams.get("taskId")!);
  return { title, task, url: url.toString() };
}

async function createRecord(
  page: Page,
  runtime: Awaited<ReturnType<typeof loadRuntime>>,
  feature: boolean,
) {
  const { task } = await createTask(page, runtime, feature);
  await task.getByRole("button", { name: "完成任务", exact: true }).click();
  const form = page.getByRole("dialog", { name: "完成任务", exact: true });
  await form.getByLabel("是否产生实际功能变化").selectOption("yes");
  for (const label of [
    "为什么改、发现了什么问题",
    "改了什么、怎么改的",
    "改完效果如何、如何验证",
  ])
    await form.getByLabel(label).fill("F20来源内容");
  await form
    .getByLabel("还有什么问题（选填）")
    .fill("本次需要跟进的完整遗留原文");
  await form
    .getByRole("button", { name: "发布并完成任务", exact: true })
    .click();
  await expect(form).toBeHidden();
  await task.getByRole("link", { name: "查看已发布记录" }).click();
  const record = page.getByRole("region", { name: "正式记录详情" });
  await expect(record.getByText(/-CR-\d+ · v1 · 已发布/)).toBeVisible();
  return record;
}
for (const feature of [true, false])
  test(`F20 ${feature ? "FEATURE" : "MODULE"} 遗留转任务、来源双向链接和转换后稳定历史`, async ({
    browser,
  }) => {
    test.setTimeout(120000);
    const runtime = await loadRuntime(),
      { context, page } = await createAuthenticatedContext(browser, runtime);
    try {
      const record = await createRecord(page, runtime, feature);
      await record.getByRole("button", { name: "转为新任务" }).click();
      const dialog = page.getByRole("dialog", { name: "遗留问题转为新任务" });
      await expect(
        dialog.getByText("本次需要跟进的完整遗留原文"),
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "创建跟进任务" }),
      ).toBeDisabled();
      const title = `遗留跟进-${Date.now()}`;
      await dialog.getByLabel("跟进任务标题").fill(title);
      await dialog
        .getByLabel("跟进任务负责人")
        .selectOption({ label: runtime.user.name });
      if (feature)
        await dialog
          .getByLabel("跟进任务截止时间（选填）")
          .fill("2026-10-10T18:30");
      await dialog.getByRole("button", { name: "创建跟进任务" }).click();
      await expect(dialog).toBeHidden();
      const link = record.getByRole("link", {
        name: "查看跟进任务",
        exact: true,
      });
      await expect(link).toBeVisible();
      const target = await link.getAttribute("href");
      await link.click();
      const task = page.getByRole("dialog", { name: "任务详情" });
      await expect(
        task.getByRole("button", { name: "完成任务", exact: true }),
      ).toBeEnabled();
      await expect(task.locator(".task-status-history > li")).toHaveCount(1);
      await expect(task.getByText(/来源记录：.*-CR-/)).toBeVisible();
      if (feature) {
        await task
          .getByRole("button", { name: "编辑任务", exact: true })
          .click();
        const editTask = page.getByRole("dialog", {
          name: "编辑任务",
          exact: true,
        });
        await expect(editTask.getByLabel("截止时间")).toHaveValue(
          "2026-10-10T18:30",
        );
        await editTask.getByRole("button", { name: /取\s*消/ }).click();
        await expect(editTask).toBeHidden();
        // Opening the editor closes the detail drawer; return through the real task URL.
        await page.goto(target!);
      }
      await task.getByRole("link", { name: "查看遗留来源记录" }).click();
      await expect(
        record.getByRole("link", { name: "查看跟进任务", exact: true }),
      ).toHaveAttribute("href", target!);
      await expect(
        record.getByRole("button", { name: "转为新任务" }),
      ).toHaveCount(0);
      if (!feature) {
        for (const value of ["", "转换后的再次填写"]) {
          await record.getByRole("button", { name: "修订内容" }).click();
          const edit = page.getByRole("dialog", { name: "修订迭代记录" });
          await edit.getByLabel("还有什么问题（选填）").fill(value);
          await edit.getByRole("button", { name: "保存新版本" }).click();
          await expect(edit).toBeHidden();
          await expect(
            record.getByRole("link", { name: "查看跟进任务", exact: true }),
          ).toHaveAttribute("href", target!);
          await expect(
            record.getByRole("button", { name: "转为新任务" }),
          ).toHaveCount(0);
        }
        await record.getByLabel("较早版本").selectOption("1");
        await record.getByLabel("对照版本").selectOption("3");
        await expect(
          record.getByLabel("版本差异").getByText("本次需要跟进的完整遗留原文"),
        ).toBeVisible();
      }
    } finally {
      await context.close();
    }
  });
test("F20 其他页面修订造成409，保留任务输入并明确确认最新内容后转换", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const runtime = await loadRuntime(),
    { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    const record = await createRecord(page, runtime, false),
      url = page.url();
    await record.getByRole("button", { name: "转为新任务" }).click();
    const dialog = page.getByRole("dialog", { name: "遗留问题转为新任务" });
    await expect(dialog.getByText("本次需要跟进的完整遗留原文")).toBeVisible();
    await dialog.getByLabel("跟进任务标题").fill("冲突后保留的任务标题");
    await dialog
      .getByLabel("跟进任务负责人")
      .selectOption({ label: runtime.user.name });
    const other = await context.newPage();
    await other.goto(url);
    await other.getByRole("button", { name: "修订内容" }).click();
    const edit = other.getByRole("dialog", { name: "修订迭代记录" });
    await edit.getByLabel("还有什么问题（选填）").fill("并发修订后的最新遗留");
    await edit.getByRole("button", { name: "保存新版本" }).click();
    await expect(edit).toBeHidden();
    await other.close();
    await dialog.getByRole("button", { name: "创建跟进任务" }).click();
    await expect(
      dialog.getByRole("button", { name: "刷新转换预览" }),
    ).toBeVisible();
    await expect(dialog.getByLabel("跟进任务标题")).toHaveValue(
      "冲突后保留的任务标题",
    );
    await dialog.getByRole("button", { name: "刷新转换预览" }).click();
    await expect(dialog.getByText("并发修订后的最新遗留")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "创建跟进任务" }),
    ).toBeDisabled();
    await dialog.getByRole("button", { name: "确认使用最新预览" }).click();
    await dialog.getByRole("button", { name: "创建跟进任务" }).click();
    await expect(dialog).toBeHidden();
    await record
      .getByRole("link", { name: "查看跟进任务", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog", { name: "任务详情" })
        .getByText(/并发修订后的最新遗留/),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
