import { expect, test } from "@playwright/test";
import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

test("成员创建编辑模块、解决并发字段冲突，且弹层已无归档入口", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    await page.goto(`/projects/${runtime.projectId}/modules`);
    await expect(
      page.getByRole("heading", { name: runtime.projectName }),
    ).toBeVisible();
    const name = `模块-${Date.now()}`;
    await page.getByRole("button", { name: "新增模块" }).first().click();
    const dialog = page.getByRole("dialog", { name: "新增模块" });
    await dialog.getByLabel("模块名称").fill(name);
    await dialog.getByLabel("模块说明").fill("模块纵切片 E2E");
    await dialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(dialog).toBeHidden();
    const card = page.locator(".catalog-module-wrap").filter({ hasText: name });
    await card.getByRole("button", { name: "编辑模块" }).click();
    const edit = page.getByRole("dialog", { name: "编辑模块" });
    // ADR-044：模块层面已下线归档，弹层只剩保存/取消与并发冲突处理。
    await expect(edit.getByRole("button", { name: /保s*存/ })).toBeVisible();
    await expect(edit.getByRole("button", { name: "归档模块" })).toHaveCount(0);
    await expect(edit.getByLabel("操作原因")).toHaveCount(0);
    await edit.getByLabel("模块名称").fill(`${name}-已修改`);

    const other = await context.newPage();
    await other.goto(`/projects/${runtime.projectId}/modules`);
    const otherCard = other
      .locator(".catalog-module-wrap")
      .filter({ hasText: name });
    await otherCard.getByRole("button", { name: "编辑模块" }).click();
    const otherEdit = other.getByRole("dialog", { name: "编辑模块" });
    await otherEdit.getByLabel("模块说明").fill("另一窗口更新的说明");
    await otherEdit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(otherEdit).toBeHidden();

    await edit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(edit.getByText(/输入已保留/)).toBeVisible();
    await edit.getByRole("button", { name: "加载最新版本后继续编辑" }).click();
    await expect(edit.getByLabel("模块说明")).toHaveValue("另一窗口更新的说明");
    await expect(edit.getByLabel("模块名称")).toHaveValue(`${name}-已修改`);
    await edit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(edit).toBeHidden();
    await expect(
      card.getByRole("heading", { name: `${name}-已修改`, exact: true }),
    ).toBeVisible();
    await expect(
      card.getByText("另一窗口更新的说明", { exact: true }),
    ).toBeVisible();

    await card.getByRole("button", { name: "编辑模块" }).click();
    await edit.getByLabel("模块说明").fill("本窗口的说明草稿");
    await other.reload();
    await otherCard.getByRole("button", { name: "编辑模块" }).click();
    await otherEdit.getByLabel("模块说明").fill("另一窗口再次更新说明");
    await otherEdit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(otherEdit).toBeHidden();
    await edit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(edit.getByText(/输入已保留/)).toBeVisible();
    await edit.getByRole("button", { name: "加载最新版本后继续编辑" }).click();
    await expect(edit.getByText("模块说明存在冲突")).toBeVisible();
    await expect(edit.getByRole("button", { name: /保\s*存/ })).toBeDisabled();
    await edit.getByRole("button", { name: "采用最新模块说明" }).click();
    await edit.getByRole("button", { name: "应用合并结果" }).click();
    await edit.getByRole("button", { name: /保\s*存/ }).click();
    await expect(edit).toBeHidden();
    await page.reload();
    await expect(
      card.getByText("另一窗口再次更新说明", { exact: true }),
    ).toBeVisible();
    await other.close();
    await page.reload();
    await expect(
      card.getByRole("heading", { name: `${name}-已修改`, exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
