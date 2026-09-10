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
for (const feature of [true, false])
  test(`F19 ${feature ? "FEATURE" : "MODULE"} 内联记录发布并完成任务`, async ({
    browser,
  }) => {
    test.setTimeout(120000);
    const runtime = await loadRuntime(),
      { context, page } = await createAuthenticatedContext(browser, runtime);
    try {
      const { task, title } = await createTask(page, runtime, feature);
      await task.getByRole("button", { name: "完成任务", exact: true }).click();
      const form = page.getByRole("dialog", { name: "完成任务", exact: true });
      await form.getByLabel("是否产生实际功能变化").selectOption("yes");
      for (const label of [
        "为什么改、发现了什么问题",
        "改了什么、怎么改的",
        "改完效果如何、如何验证",
      ])
        await form.getByLabel(label).fill("真实组合流程");
      await form.getByLabel("还有什么问题（选填）").fill("需要后续跟进");
      await form
        .getByRole("button", { name: "发布并完成任务", exact: true })
        .click();
      await expect(form).toBeHidden();
      await expect(
        task.getByRole("button", { name: "重新打开", exact: true }),
      ).toBeEnabled();
      await expect(task.locator(".task-status-history > li")).toHaveCount(2);
      await task.getByRole("link", { name: "查看已发布记录" }).click();
      const record = page.getByRole("region", { name: "正式记录详情" });
      await expect(
        record.getByRole("heading", { name: title, exact: true }),
      ).toBeVisible();
      await expect(record.getByText(/-CR-\d+ · v1 · 已发布/)).toBeVisible();
      await record.getByRole("link", { name: "查看来源任务" }).click();
      await expect(
        task.getByRole("button", { name: "重新打开", exact: true }),
      ).toBeEnabled();
    } finally {
      await context.close();
    }
  });
test("F19 草稿超限失败保留待办和选择，修正草稿后可发布并完成", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const runtime = await loadRuntime(),
    { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    const { task, url } = await createTask(page, runtime, false);
    await task.getByRole("link", { name: "迭代记录草稿" }).click();
    await page.getByRole("button", { name: "新建来源草稿" }).click();
    const draft = page.getByRole("dialog", { name: "新建来源草稿" });
    for (const label of [
      "为什么改、发现了什么问题",
      "改了什么、怎么改的",
      "改完效果如何、如何验证",
    ])
      await draft.getByLabel(label).fill("可保留的完整内容");
    await draft.getByLabel("还有什么问题（选填）").fill("文".repeat(10001));
    await draft.getByRole("button", { name: "保存草稿" }).click();
    await expect(draft).toBeHidden();
    await page.goto(url);
    await task.getByRole("button", { name: "完成任务", exact: true }).click();
    const form = page.getByRole("dialog", { name: "完成任务", exact: true });
    await form.getByLabel("是否产生实际功能变化").selectOption("yes");
    await form.getByLabel("记录来源").selectOption("draft");
    await form.getByLabel("待发布草稿").selectOption({ index: 1 });
    const selection = await form.getByLabel("待发布草稿").inputValue();
    await form
      .getByRole("button", { name: "发布并完成任务", exact: true })
      .click();
    await expect(
      form.getByText(/发布和正式修订的遗留问题最多10000字符/),
    ).toBeVisible();
    await expect(form.getByLabel("待发布草稿")).toHaveValue(selection);
    await expect(task.locator(".task-status-history > li")).toHaveCount(1);
    await form.getByRole("link", { name: "打开草稿继续编辑" }).click();
    await page.getByRole("button", { name: "继续编辑" }).click();
    const edit = page.getByRole("dialog", { name: "编辑草稿" });
    await edit.getByLabel("还有什么问题（选填）").fill("后续跟进");
    await edit.getByRole("button", { name: "保存草稿" }).click();
    await expect(edit).toBeHidden();
    await page.goto(url);
    await task.getByRole("button", { name: "完成任务", exact: true }).click();
    await form.getByLabel("是否产生实际功能变化").selectOption("yes");
    await form.getByLabel("记录来源").selectOption("draft");
    await form.getByLabel("待发布草稿").selectOption(selection);
    await form
      .getByRole("button", { name: "发布并完成任务", exact: true })
      .click();
    await expect(form).toBeHidden();
    await expect(
      task.getByRole("button", { name: "重新打开", exact: true }),
    ).toBeEnabled();
    await task.getByRole("link", { name: "查看已发布记录" }).click();
    await expect(
      page
        .getByRole("region", { name: "正式记录详情" })
        .getByText("后续跟进", { exact: true })
        .first(),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
