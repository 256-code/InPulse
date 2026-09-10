import { expect, test } from "@playwright/test";

import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

/**
 * F-29 项目概览 / F-32 任务中心的专属关键路径 E2E。
 * 两个页面默认注入服务端适配器（R-2 / R-3）：这里验证真实服务端数据进入
 * 视图、契约缺口按显式降级展示（统计与总数显示为「—」、筛选控件禁用并标注），
 * 以及 F-30 约定下筛选状态由 URL 承载。
 */

test("F-32 任务中心：真实任务进入列表，契约缺口显式降级，筛选状态写入 URL", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    const suffix = Date.now().toString(16).toUpperCase();
    const featureName = "任务中心-" + suffix;
    const taskTitle = "聚合读任务-" + suffix;

    await page.goto("/projects/" + runtime.projectId + "/modules");
    const moduleCard = page
      .locator(".calm-feature-card")
      .filter({ hasText: "未分类" })
      .first();
    await moduleCard.getByRole("link", { name: "查看功能" }).click();
    await page.getByRole("button", { name: "新建功能" }).click();
    const featureDialog = page.getByRole("dialog", { name: "新建功能" });
    await featureDialog.getByLabel("功能名称").fill(featureName);
    await featureDialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(featureDialog).toBeHidden();
    await page
      .locator(".calm-feature-card")
      .filter({ hasText: featureName })
      .getByRole("link", { name: "查看详情" })
      .click();
    await page.getByRole("button", { name: "新建任务" }).click();
    const taskDialog = page.getByRole("dialog", { name: "新建任务" });
    await taskDialog.getByLabel("任务标题").fill(taskTitle);
    await taskDialog
      .getByLabel("负责人")
      .selectOption({ label: runtime.user.name });
    await taskDialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(taskDialog).toBeHidden();

    await page.goto("/tasks");
    const center = page.getByTestId("task-center");
    await expect(center).toBeVisible();

    const notice = page.getByTestId("task-center-mock-notice");
    await expect(notice).toContainText("接口说明：");
    await expect(notice).toContainText("GET /api/v1/me/tasks");
    await expect(notice).toContainText("统计卡片");

    // 契约缺口显式降级：统计卡片为「—」，无契约来源的筛选控件禁用并标注。
    await expect(page.getByTestId("stat-my-open").locator("strong")).toHaveText(
      "—",
    );
    await expect(page.getByLabel("搜索任务")).toBeDisabled();
    await expect(page.getByLabel("优先级")).toBeDisabled();
    await expect(page.getByRole("tab", { name: "我创建的" })).toBeDisabled();

    // 服务端真实数据：默认「我负责的 + 未完成」能看到刚创建的任务。
    const taskCard = page
      .locator(".calm-task-card")
      .filter({ hasText: taskTitle });
    await expect(taskCard).toBeVisible();
    await expect(taskCard).toContainText(runtime.user.name);
    await expect(taskCard).not.toContainText("优先级");

    // F-30：筛选状态由 URL 承载，切换筛选即更新地址栏。
    await page
      .getByRole("group", { name: "工作状态" })
      .getByRole("button", { name: "已完成" })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("status"))
      .toBe("done");
    await expect(page.getByText("没有匹配的未完成任务")).toBeVisible();
    await page
      .getByRole("group", { name: "展示方式" })
      .getByRole("button", { name: "列表" })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("view"))
      .toBe("list");
    await page.getByRole("button", { name: /更多筛选/ }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("more"))
      .toBe("1");
    await expect(
      page.getByText("显示已取消任务（不计入完成率）"),
    ).toBeVisible();
    await expect(
      page.getByLabel("显示已取消任务（不计入完成率）"),
    ).toBeDisabled();

    await page
      .getByTestId("task-center")
      .getByRole("button", { name: "遗留问题" })
      .click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/issues");
  } finally {
    await context.close();
  }
});

test("F-29 项目概览：服务端真实指标、契约缺口降级与入口导航", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    await page.goto("/projects/" + runtime.projectId + "/overview");
    const overview = page.getByTestId("project-overview");
    await expect(overview).toBeVisible();
    await expect(
      overview.getByRole("heading", { name: runtime.projectName }),
    ).toBeVisible();

    const notice = page.getByTestId("project-overview-mock-notice");
    await expect(notice).toContainText("接口说明：");
    await expect(notice).toContainText("契约未提供遗留问题总数");

    // 服务端真实统计：fixture 项目至少 1 个活跃模块与 1 名成员。
    const moduleCount = await page
      .getByTestId("overview-metric-modules")
      .locator("strong")
      .textContent();
    expect(Number(moduleCount)).toBeGreaterThan(0);
    const memberCount = await page
      .getByTestId("overview-metric-members")
      .locator("strong")
      .textContent();
    expect(memberCount ?? "").toContain(" 人");
    expect(Number.parseInt(memberCount ?? "", 10)).toBeGreaterThan(0);
    await expect(
      page.getByTestId("overview-metric-leftovers").locator("strong"),
    ).toHaveText("—");

    await expect(page.getByRole("heading", { name: "最近迭代" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "待处理遗留问题" }),
    ).toBeVisible();
    await expect(page.getByText("暂无已发布记录")).toBeVisible();
    await expect(page.getByText("没有待闭环的遗留问题")).toBeVisible();

    await page.getByRole("button", { name: "查看全部" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/records");
    const recordsUrl = new URL(page.url());
    expect(recordsUrl.searchParams.get("view")).toBe("published");
    expect(recordsUrl.searchParams.get("projectId")).toBe(
      String(runtime.projectId),
    );

    await page.goto("/projects/" + runtime.projectId + "/overview");
    await page.getByRole("button", { name: "查看模块" }).click();
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe("/projects/" + runtime.projectId + "/modules");

    await page.goto("/projects/" + runtime.projectId + "/overview");
    await page.getByRole("button", { name: "全部项目" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/projects");
  } finally {
    await context.close();
  }
});
