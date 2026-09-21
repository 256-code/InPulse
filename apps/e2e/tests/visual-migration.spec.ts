import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

test("captures the migrated command palette, notification popover and activity pages", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  const output = path.join(process.env.TEMP ?? ".", "inpulse-visual");
  mkdirSync(output, { recursive: true });

  await page.goto("/projects");
  await expect(page.getByRole("heading", { name: "项目与功能" })).toBeVisible();
  await page.screenshot({ path: path.join(output, "01-projects.png") });

  const suffix = Date.now().toString(16).slice(-8).toUpperCase();
  const code = `VIS${suffix}`;
  const name = `视觉迁移项目 ${code}`;
  await page.getByTestId("create-project-button").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("项目名称").fill(name);
  await dialog.getByLabel("项目编码").fill(code.toLowerCase());
  await dialog.getByLabel("项目描述").fill("用于迁移后的活动页视觉检查。");
  await dialog.getByRole("button", { name: "创建项目" }).click();
  await expect(page.getByText("项目创建成功", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "打开全局搜索" }).click();
  const palette = page.getByRole("dialog", { name: "全局搜索" });
  await expect(palette).toBeVisible();
  await palette.getByLabel("全局搜索关键词").fill(code);
  await expect(palette.getByText(/已找到/)).toBeVisible();
  await page.screenshot({ path: path.join(output, "02-command-palette.png") });
  await page.keyboard.press("Escape");

  // 通知铃铛已收敛到侧栏底部工具条，exact 名称固定匹配该按钮。
  await page.getByRole("button", { name: "通知", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "通知中心" })).toBeVisible();
  await page.screenshot({
    path: path.join(output, "03-notification-popover.png"),
  });
  await page
    .getByRole("button", { name: `打开通知：已加入项目 ${name}` })
    .click();

  await expect(page.getByRole("heading", { name: "项目动态" })).toBeVisible();
  await expect(page.getByText(/创建了项目/)).toBeVisible();
  await page.screenshot({ path: path.join(output, "04-project-activity.png") });

  // 侧栏目录树：展开某个项目后，罗列区必须完整展示所有项目行，
  // 不能再把其它项目挤进内滚动区（产品要求 2026-09-21）。
  await expect(page.locator(".nav-tree-panel")).toBeVisible();
  const treeLayout = await page.evaluate(() => {
    const panel = document.querySelector(".nav-tree-panel");
    const list = document.querySelector(".project-tree-scroll");
    if (panel === null || list === null) {
      throw new Error("侧栏目录树未渲染");
    }
    const panelBottom = Math.round(panel.getBoundingClientRect().bottom);
    const rows = Array.from(
      document.querySelectorAll(
        ".project-tree-scroll > .tree-project > .tree-row",
      ),
    ).map((row) => {
      const rect = row.getBoundingClientRect();
      return {
        text: row.textContent,
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
      };
    });
    return {
      overflowY: getComputedStyle(list).overflowY,
      listClientHeight: list.clientHeight,
      listScrollHeight: list.scrollHeight,
      panelBottom: panelBottom,
      rows: rows,
    };
  });
  // 先看用户可见的症状：每个项目行都完整落在罗列区盒子里，没有被裁掉。
  expect(treeLayout.rows.length).toBeGreaterThan(1);
  for (const row of treeLayout.rows) {
    expect(row.bottom).toBeLessThanOrEqual(treeLayout.panelBottom);
  }
  // 再看实现约束：罗列区自己不再限高，展开内容不会把它变成内滚动区。
  expect(treeLayout.overflowY).toBe("visible");
  expect(treeLayout.listScrollHeight).toBe(treeLayout.listClientHeight);

  await page.goto("/activity");
  await expect(page.getByRole("heading", { name: "项目动态" })).toBeVisible();
  await page.getByLabel("搜索动态").fill(code);
  await expect(page.getByTestId(/^activity-item-/)).toBeVisible();
  await page.screenshot({ path: path.join(output, "05-activity-index.png") });

  await context.close();
});
