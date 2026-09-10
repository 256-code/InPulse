import { expect, test, type Page } from "@playwright/test";
import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";
async function add(page: Page, url: string, label: string) {
  const modal = page.getByRole("dialog", { name: "GitHub 链接", exact: true });
  await modal.getByLabel("GitHub URL").fill(url);
  await modal.getByRole("button", { name: "确认添加" }).click();
  await expect(
    modal.getByRole("link", { name: label, exact: true }),
  ).toBeVisible();
  const link = modal.getByRole("link", { name: label, exact: true });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  return modal;
}
test("F22 project, feature and task multi-links persist; duplicate and unsafe links are explained", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const runtime = await loadRuntime(),
    { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    await page.goto("/projects");
    const project = page
      .locator(".project-card")
      .filter({ hasText: runtime.projectTitle.split(" ").at(-1)! });
    await project.getByRole("button", { name: "GitHub 链接" }).click();
    let modal = await add(
      page,
      "https://github.com/inpulse/core/issues/22001",
      "Issue #22001",
    );
    await modal.getByRole("button", { name: "关闭关联" }).click();
    await page.goto(`/search?q=${encodeURIComponent(runtime.searchQuery)}`);
    await expect(
      page
        .getByTestId("search-result-item")
        .filter({ hasText: runtime.projectTitle }),
    ).toBeVisible();
    await page.goto(`/projects/${runtime.projectId}/modules`);
    await page.getByRole("link", { name: "查看功能" }).first().click();
    await page.getByRole("button", { name: "新建功能" }).click();
    const create = page.getByRole("dialog", { name: "新建功能" }),
      name = "链接功能" + Date.now();
    await create.getByLabel("功能名称").fill(name);
    await create.getByRole("button", { name: /保\s*存/ }).click();
    await expect(create).toBeHidden();
    await page
      .locator(".calm-feature-card")
      .filter({ hasText: name })
      .getByRole("link", { name: "查看详情" })
      .click();
    await page
      .getByRole("button", { name: "GitHub 链接", exact: true })
      .click();
    modal = await add(
      page,
      "https://GitHub.com:443/inpulse/core/releases/tag/v2.6.0?utm_source=test#notes",
      "Release v2.6.0",
    );
    await modal
      .getByLabel("GitHub URL")
      .fill("https://github.com/inpulse/core/releases/tag/v2.6.0");
    await modal.getByRole("button", { name: "确认添加" }).click();
    await expect(modal.getByText("该链接已关联，请勿重复添加。")).toBeVisible();
    await modal.getByRole("button", { name: "加载最新关联" }).click();
    await expect(modal.getByRole("button", { name: "确认添加" })).toBeEnabled();
    await modal
      .getByLabel("GitHub URL")
      .fill("https://github.com.evil.test/inpulse/core");
    await modal.getByRole("button", { name: "确认添加" }).click();
    await expect(modal.getByText(/链接无效/)).toBeVisible();
    await modal.getByRole("button", { name: "关闭关联" }).click();
    await page.getByRole("button", { name: "新建任务" }).click();
    const task = page.getByRole("dialog", { name: "新建任务" });
    await task.getByLabel("任务标题").fill("GitHub任务");
    await task.getByLabel("负责人").selectOption({ label: runtime.user.name });
    await task.getByRole("button", { name: /保\s*存/ }).click();
    await expect(task).toBeHidden();
    const detail = page.getByRole("dialog", { name: "任务详情" });
    await detail.getByRole("button", { name: "GitHub 链接" }).click();
    modal = await add(
      page,
      "https://github.com/inpulse/core/pull/22002",
      "PR #22002",
    );
    await add(
      page,
      "https://github.com/inpulse/core/commit/0ab12cd34ef",
      "Commit 0ab12cd34ef",
    );
    await modal.getByRole("button", { name: "关闭关联" }).click();
    await page.reload();
    await page.getByRole("button", { name: "任务详情", exact: true }).click();
    await detail.getByRole("button", { name: "GitHub 链接" }).click();
    await expect(modal.getByRole("link", { name: "PR #22002" })).toBeVisible();
    await modal.getByRole("button", { name: "解除 PR #22002" }).click();
    await modal.getByRole("button", { name: "确认解除关联" }).click();
    await expect(modal.getByRole("link", { name: "PR #22002" })).toHaveCount(0);
    await expect(
      modal.getByRole("link", { name: "Commit 0ab12cd34ef" }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/f22-task-links.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
test("F22 draft links survive publication and revision without changing old version", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const runtime = await loadRuntime(),
    { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    await page.goto(`/records?projectId=${runtime.projectId}`);
    await page.getByRole("button", { name: "新建独立草稿" }).click();
    const draft = page.getByRole("dialog", { name: "新建独立草稿" });
    await draft.getByLabel("所属模块").selectOption({ index: 1 });
    await draft.getByLabel("迭代标题").fill("F22记录" + Date.now());
    await draft.getByLabel("为什么改、发现了什么问题").fill("原始问题");
    await draft.getByLabel("改了什么、怎么改的").fill("原始方案");
    await draft.getByLabel("改完效果如何、如何验证").fill("原始验证");
    await draft.getByRole("button", { name: "保存草稿" }).click();
    await expect(draft).toBeHidden();
    await page
      .getByRole("region", { name: "草稿详情" })
      .getByRole("button", { name: "GitHub 链接" })
      .click();
    let modal = await add(
      page,
      "https://github.com/inpulse/core/issues/22003",
      "Issue #22003",
    );
    await modal.getByRole("button", { name: "关闭关联" }).click();
    await page.getByRole("button", { name: "发布记录", exact: true }).click();
    const publish = page.getByRole("dialog", { name: "发布迭代记录" });
    await publish.getByRole("button", { name: "确认发布" }).click();
    await expect(publish).toBeHidden();
    const detail = page.getByRole("region", { name: "正式记录详情" });
    await detail.getByRole("button", { name: "GitHub 链接" }).click();
    await expect(
      modal.getByRole("link", { name: "Issue #22003" }),
    ).toBeVisible();
    modal = await add(
      page,
      "https://github.com/inpulse/core/pull/22004",
      "PR #22004",
    );
    await modal.getByRole("button", { name: "关闭关联" }).click();
    await detail.getByRole("button", { name: "修订内容" }).click();
    const edit = page.getByRole("dialog", { name: "修订迭代记录" });
    await edit.getByLabel("改了什么、怎么改的").fill("修订方案");
    await edit.getByRole("button", { name: "保存新版本" }).click();
    await expect(edit).toBeHidden();
    await expect(detail.getByText(/-CR-\d+ · v2 · 已发布/)).toBeVisible();
    await detail.getByLabel("较早版本").selectOption("1");
    await detail.getByLabel("对照版本").selectOption("2");
    await expect(
      detail.getByLabel("版本差异").getByText("原始方案"),
    ).toBeVisible();
    await detail.getByRole("button", { name: "GitHub 链接" }).click();
    await expect(
      modal.getByRole("link", { name: "Issue #22003" }),
    ).toBeVisible();
    await expect(modal.getByRole("link", { name: "PR #22004" })).toBeVisible();
    await modal.getByRole("button", { name: "关闭关联" }).click();
    await page.goto("/search?q=22004");
    await expect(page.getByText(/F22记录/).first()).toBeVisible();
  } finally {
    await context.close();
  }
});
