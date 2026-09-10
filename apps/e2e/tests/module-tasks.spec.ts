import { expect, test } from "@playwright/test";
import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

test("F-15 单份模块任务影响两功能，引用计数与增删关系持久化", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    await page.goto(`/projects/${runtime.projectId}/modules`);
    const suffix = Date.now();
    const moduleName = `模块任务隔离-${suffix}`;
    await page.getByRole("button", { name: "新建模块" }).click();
    const moduleDialog = page.getByRole("dialog", { name: "新建模块" });
    await moduleDialog.getByLabel("模块名称").fill(moduleName);
    await moduleDialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(moduleDialog).toBeHidden();
    const moduleCard = page
      .locator(".calm-feature-card")
      .filter({ hasText: moduleName });
    await moduleCard.getByRole("link", { name: "查看功能" }).click();
    const listUrl = page.url();
    const moduleId = listUrl.match(/modules\/(\d+)/)![1];
    const names = [`影响甲-${suffix}`, `影响乙-${suffix}`];
    const featureUrls: string[] = [];
    for (const name of names) {
      await page.goto(listUrl);
      await page.getByRole("button", { name: "新建功能" }).click();
      const dialog = page.getByRole("dialog", { name: "新建功能" });
      await dialog.getByLabel("功能名称").fill(name);
      await dialog.getByRole("button", { name: /保\s*存/ }).click();
      await expect(dialog).toBeHidden();
      await page
        .locator(".calm-feature-card")
        .filter({ hasText: name })
        .getByRole("link", { name: "查看详情" })
        .click();
      featureUrls.push(page.url());
    }
    await page.goto(`/projects/${runtime.projectId}/modules`);
    await moduleCard.getByRole("link", { name: "模块任务" }).click();
    await page.getByRole("button", { name: "新建任务" }).click();
    const create = page.getByRole("dialog", { name: "新建任务" });
    const title = `公共任务-${suffix}`;
    await create.getByLabel("任务标题").fill(title);
    await create
      .getByLabel("负责人")
      .selectOption({ label: runtime.user.name });
    await create.getByLabel(names[0]!, { exact: true }).check();
    await create.getByLabel(names[1]!, { exact: true }).check();
    await create.getByRole("button", { name: /保\s*存/ }).click();
    await expect(create).toBeHidden();
    await expect(
      page.getByRole("dialog", { name: "任务详情" }).getByText(/影响功能：/),
    ).toContainText(names[0]!);
    for (const url of featureUrls) {
      await page.goto(url);
      await expect(
        page.getByText("模块级任务 · 引用", { exact: true }),
      ).toBeVisible();
      await expect(page.getByText("任务数：1（按唯一任务计）")).toBeVisible();
      await page
        .getByRole("article")
        .filter({ has: page.getByText(title, { exact: true }) })
        .getByRole("button", { name: "任务详情" })
        .click();
      await expect(
        page.getByRole("button", { name: "编辑任务" }),
      ).toBeDisabled();
    }
    await page.getByRole("link", { name: "打开模块任务" }).click();
    await page.getByRole("button", { name: "编辑任务" }).click();
    const edit = page.getByRole("dialog", { name: "编辑任务" });
    await edit.getByLabel(names[0]!, { exact: true }).uncheck();
    await edit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(edit).toBeHidden();
    await page.goto(featureUrls[0]!);
    await expect(page.getByText("暂无任务", { exact: true })).toBeVisible();
    await page.goto(featureUrls[1]!);
    await expect(page.getByText("任务数：1（按唯一任务计）")).toBeVisible();
    await page.goto(`/projects/${runtime.projectId}/modules/${moduleId}/tasks`);
    await page
      .getByRole("article")
      .filter({ has: page.getByText(title, { exact: true }) })
      .getByRole("button", { name: "任务详情" })
      .click();
    await page.getByRole("button", { name: "编辑任务" }).click();
    await edit.getByLabel(names[0]!, { exact: true }).check();
    await edit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(edit).toBeHidden();
    await page.reload();
    await expect(page.getByText("任务数：1（按唯一任务计）")).toBeVisible();
    await page.goto(featureUrls[0]!);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(page.getByText("任务数：1（按唯一任务计）")).toBeVisible();
    await page.goto("/notifications");
    await page.getByText(`任务指派：${title}`, { exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/modules/${moduleId}/tasks\\?taskId=`),
    );
    await expect(page.getByRole("dialog", { name: "任务详情" })).toBeVisible();
  } finally {
    await context.close();
  }
});
