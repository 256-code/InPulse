import { expect, test, type Page } from "@playwright/test";
import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { fillLeftovers } from "../helpers/record-leftovers.js";
import {
  calmSelectTrigger,
  pickCalmSelectOption,
  pickCalmSelectOptionByIndex,
} from "../helpers/calm-select.js";
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
    await page.getByRole("button", { name: "新增功能" }).click();
    const dialog = page.getByRole("dialog", { name: "新增功能" });
    await dialog.getByLabel("功能名称").fill(title + "功能");
    await dialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(dialog).toBeHidden();
    await page
      .locator(".calm-feature-card")
      .filter({ hasText: title + "功能" })
      .getByRole("link", { name: "查看详情" })
      .click();
  } else await page.getByRole("link", { name: "模块任务" }).first().click();
  await page.getByRole("button", { name: "新建任务", exact: true }).click();
  const form = page.getByRole("dialog", { name: "新建任务" });
  await form.getByLabel("任务标题").fill(title);
  await pickCalmSelectOption(form, "负责人", runtime.user.name);
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
      await form.getByRole("button", { name: /有，填写迭代记录/ }).click();
      for (const label of ["改动原因", "具体改动", "改动效果"])
        await form.getByLabel(label).fill("真实组合流程");
      await fillLeftovers(form, ["需要后续跟进"]);
      await form
        .getByRole("button", { name: "发布并完成任务", exact: true })
        .click();
      await expect(form).toBeHidden();
      await expect(
        task.getByRole("button", { name: "重新打开", exact: true }),
      ).toBeEnabled();
      await expect(task.locator(".task-status-history > li")).toHaveCount(2);
      await task.getByRole("link", { name: "查看已发布记录" }).click();
      // 设计师稿把记录标题、编号与状态徽章放在卡片摘要行，展开区只承载正文与操作。
      const summary = page
        .locator("details.record-card")
        .filter({ hasText: title })
        .locator("summary");
      await expect(summary).toContainText(title);
      await expect(summary).toContainText(/-CR-\d+ · v1 · 发布/);
      await expect(summary.locator(".record-summary-badges")).toContainText(
        "已发布",
      );
      const record = page.getByRole("region", { name: "正式记录详情" });
      await expect(record).toBeVisible();
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
    // 草稿与正式版本共用字段上限，超限只能在发布阶段由搜索容量触发；API 请求体默认上限
    // 100KB，因此只能用单字节字符：33600×3 越过 100000 字符的搜索文本上限，请求体约 100KB。
    const filler = "a".repeat(33600);
    for (const label of ["改动原因", "具体改动", "改动效果"])
      await draft.getByLabel(label).fill(filler);
    await draft.getByRole("button", { name: "保存草稿" }).click();
    await expect(draft).toBeHidden();
    await page.goto(url);
    await task.getByRole("button", { name: "完成任务", exact: true }).click();
    const form = page.getByRole("dialog", { name: "完成任务", exact: true });
    await form.getByRole("button", { name: /有，填写迭代记录/ }).click();
    await pickCalmSelectOption(form, "记录来源", "选择已有草稿");
    await pickCalmSelectOptionByIndex(form, "待发布草稿", 1);
    const selection = (
      await calmSelectTrigger(form, "待发布草稿").innerText()
    ).trim();
    // 草稿编辑后 rowVersion 递增，选项标题尾部的「版本 N」不再稳定；第二轮用
    // 「标题 · 草稿 #id」这段前缀匹配，保证仍然锁定同一条草稿。
    const draftRef = new RegExp(
      selection
        .split("· 版本")[0]!
        .trim()
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    );
    await form
      .getByRole("button", { name: "发布并完成任务", exact: true })
      .click();
    await expect(form.getByText(/超出发布容量/)).toBeVisible();
    await expect(calmSelectTrigger(form, "待发布草稿")).toHaveText(selection);
    await expect(task.locator(".task-status-history > li")).toHaveCount(1);
    await form.getByRole("link", { name: "打开草稿继续编辑" }).click();
    await page.getByRole("button", { name: "继续编辑" }).click();
    const edit = page.getByRole("dialog", { name: "编辑草稿" });
    for (const label of ["改动原因", "具体改动", "改动效果"])
      await edit.getByLabel(label).fill("可保留的完整内容");
    await fillLeftovers(edit, ["后续跟进"]);
    await edit.getByRole("button", { name: "保存草稿" }).click();
    await expect(edit).toBeHidden();
    await page.goto(url);
    await task.getByRole("button", { name: "完成任务", exact: true }).click();
    await form.getByRole("button", { name: /有，填写迭代记录/ }).click();
    await pickCalmSelectOption(form, "记录来源", "选择已有草稿");
    await pickCalmSelectOption(form, "待发布草稿", draftRef);
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
