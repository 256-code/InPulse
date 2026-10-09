import { expect } from "@playwright/test";
import { test } from "../helpers/admin-fixture.js";

import {
  createAuthenticatedContext,
  loginAdminViaUi,
} from "../helpers/auth-context.js";
import {
  calmSelectTrigger,
  pickCalmSelectOption,
} from "../helpers/calm-select.js";
import { createProjectViaUi } from "../helpers/project-create.js";
import { loadRuntime } from "../helpers/runtime.js";

test("创建项目后可在专属动态页看到 project.create 条目", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  const created = await createProjectViaUi(page, runtime, "ACT");
  await page.getByTestId("open-created-project-activity").click();

  await expect(page.getByRole("heading", { name: "项目动态" })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/\d+\/activity/);

  const item = page
    .locator('[data-testid^="activity-item-"]')
    .filter({ hasText: `创建了项目 ${created.name}` });
  await expect(item).toHaveCount(1);
  await expect(
    page.getByText(`创建了项目 ${created.name}`, { exact: true }),
  ).toBeVisible();

  const projectId = Number(
    page.url().match(/\/projects\/(\d+)\/activity/)?.[1],
  );
  expect(Number.isSafeInteger(projectId)).toBe(true);
  await expect(
    page.getByText(`项目 #${projectId}`, { exact: true }),
  ).toBeVisible();

  await context.close();
});

test("聚合动态默认包含管理员操作，按日条数取服务端全量", async ({
  browser,
  admin,
}) => {
  test.setTimeout(180_000);
  const runtime = await loadRuntime();
  const context = await browser.newContext({ baseURL: runtime.webBaseUrl });
  const page = await context.newPage();
  try {
    await loginAdminViaUi(page, runtime, admin);
    const created = await createProjectViaUi(page, runtime, "ACTG", {
      successTimeoutMs: 30_000,
    });

    // 2026-10-08：聚合视图由单条 listActivity 路由承载（全局键集分页），
    // 因此只追加不回插，日期旁条数是服务端按日全量而不是已加载条数。
    await page.goto("/activity");
    await expect(page.getByRole("heading", { name: "项目动态" })).toBeVisible();
    await expect(page.getByLabel("包含管理员操作")).toBeChecked();

    const item = page
      .locator('[data-testid^="activity-item-"]')
      .filter({ hasText: `创建了项目 ${created.name}` });
    await expect(item).toHaveCount(1);

    const firstDay = page.locator(".activity-day").first();
    const total = Number(
      (await firstDay.locator(".activity-day-toggle small").innerText()).match(
        /^\d+/,
      )?.[0],
    );
    const loaded = await firstDay
      .locator('[data-testid^="activity-item-"]')
      .count();
    expect(Number.isSafeInteger(total)).toBe(true);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeGreaterThanOrEqual(loaded);
  } finally {
    await context.close();
  }
});

test("项目动态锁定项目时，同一下拉可以换到其他项目或回到全部项目", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    const first = await createProjectViaUi(page, runtime, "ACTS");
    await page.getByTestId("open-created-project-activity").click();
    await expect(page).toHaveURL(/\/projects\/\d+\/activity/);
    const firstId = Number(
      page.url().match(/\/projects\/(\d+)\/activity/)?.[1],
    );
    expect(Number.isSafeInteger(firstId)).toBe(true);
    // 2026-10-09：项目详情页原先连项目下拉都不渲染，用户反馈没法换成其他项目。
    await expect(calmSelectTrigger(page, "项目")).toContainText(first.name);

    // 换项目的目标：再建一个项目，然后回到第一个项目的动态页做切换。
    const second = await createProjectViaUi(page, runtime, "ACTS2");
    await page.goto(`/projects/${firstId}/activity`);
    await expect(calmSelectTrigger(page, "项目")).toContainText(first.name);

    await pickCalmSelectOption(page, "项目", second.name);
    await expect(page).toHaveURL(/\/projects\/\d+\/activity$/);
    expect(page.url()).not.toContain(`/projects/${firstId}/`);
    await expect(calmSelectTrigger(page, "项目")).toContainText(second.name);
    await expect(
      page
        .locator('[data-testid^="activity-item-"]')
        .filter({ hasText: `创建了项目 ${second.name}` }),
    ).toHaveCount(1);

    await pickCalmSelectOption(page, "项目", "全部项目");
    await expect(page).toHaveURL(/\/activity$/);
    await expect(calmSelectTrigger(page, "项目")).toContainText("全部项目");

    // ADR-062：项目删除改为物理删除，动态筛选里不再有「已删除项目」档位。
    await calmSelectTrigger(page, "项目").click();
    await expect(page.getByRole("option", { name: "已删除项目" })).toHaveCount(
      0,
    );
    await page.keyboard.press("Escape");
  } finally {
    await context.close();
  }
});
