import { expect, test } from "@playwright/test";

import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";
import { pickCalmSelectOption } from "../helpers/calm-select.js";

/**
 * F-29 项目主页（概览已并入模块与功能）/ F-32 任务中心的专属关键路径 E2E。
 * 两个页面默认注入服务端适配器（R-2 / R-3）：这里验证真实服务端数据进入
 * 视图（统计卡片、优先级筛选、遗留问题总数与优先级徽章）、仍无契约来源的
 * 条件按显式降级处理（关键词搜索只对已加载页生效并标注，「我创建的」经
 * ownership 参数接入服务端），
 * 以及 F-30 约定下筛选状态由 URL 承载。
 */

test("F-32 任务中心：真实任务进入列表，统计与优先级接线，筛选状态写入 URL", async ({
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
    await page.getByRole("button", { name: "新增功能" }).click();
    const featureDialog = page.getByRole("dialog", { name: "新增功能" });
    await featureDialog.getByLabel("功能名称").fill(featureName);
    await featureDialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(featureDialog).toBeHidden();
    await page
      .locator(".calm-feature-card")
      .filter({ hasText: featureName })
      .getByRole("link", { name: "查看详情" })
      .click();
    await page.getByRole("button", { name: "新建任务", exact: true }).click();
    const taskDialog = page.getByRole("dialog", { name: "新建任务" });
    await taskDialog.getByLabel("任务标题").fill(taskTitle);
    await pickCalmSelectOption(taskDialog, "负责人", runtime.user.name);
    await taskDialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(taskDialog).toBeHidden();

    await page.goto("/tasks");
    const center = page.getByTestId("task-center");
    await expect(center).toBeVisible();

    const notice = page.getByTestId("task-center-mock-notice");
    // 设计师稿 task-center.tsx 没有「接口说明」黄条：默认服务端适配器下页面只呈现
    // 统计、风险条与任务列表，骨架数据提示只在 mock 降级时出现。
    await expect(notice).toHaveCount(0);

    // 第二轮契约接线：统计卡片为服务端实时数字、优先级筛选可用；
    // 「我创建的」由 R-3 的 ownership 参数承载，可点击并走服务端过滤。
    await expect
      .poll(async () =>
        Number.parseInt(
          (await page
            .getByTestId("stat-my-open")
            .locator("strong")
            .textContent()) ?? "",
          10,
        ),
      )
      .toBeGreaterThan(0);
    await expect(page.getByLabel("搜索任务")).toBeEnabled();
    await expect(page.getByLabel("优先级")).toBeEnabled();
    await expect(page.getByRole("tab", { name: "我创建的" })).toBeEnabled();

    // 服务端真实数据：默认「我负责的 + 未完成」能看到刚创建的任务。
    const taskCard = page
      .locator(".calm-task-card")
      .filter({ hasText: taskTitle });
    await expect(taskCard).toBeVisible();
    await expect(taskCard).toContainText(runtime.user.name);
    await expect(taskCard.locator('[title="优先级：普通"]')).toHaveText("普通");
    await expect(taskCard).toContainText("未设置截止");

    // 切到「我创建的」：任务中心请求必须携带 scope=created 且状态写入 URL；
    // 本次刚用当前用户身份创建的任务（创建者=当前用户）仍然在列表中。
    const createdRequest = page.waitForRequest(
      (request) =>
        new URL(request.url()).pathname === "/api/v1/tasks" &&
        new URL(request.url()).searchParams.get("scope") === "created",
    );
    await page.getByRole("tab", { name: "我创建的" }).click();
    await createdRequest;
    await expect
      .poll(() => new URL(page.url()).searchParams.get("scope"))
      .toBe("created");
    await expect(taskCard).toBeVisible();

    // 切回「我负责的」：范围写回 URL 默认值（F-30 省略默认值），tab 选中态回位。
    // 只断言 UI 状态：该范围查询在 staleTime 窗口内命中缓存，不保证重新发请求。
    await page.getByRole("tab", { name: "我负责的" }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("scope"))
      .toBeNull();
    await expect(page.getByRole("tab", { name: "我负责的" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "我创建的" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await expect(taskCard).toBeVisible();

    // 关键词搜索、合并关系与 GitHub 关联没有服务端参数，但可在已加载页上本地筛选：
    // 控件保持可用，同时出现显式范围提示，不能把本地结果说成服务端收敛。
    await expect(page.getByTestId("task-center-local-note")).toHaveCount(0);
    await page.getByLabel("搜索任务").fill(taskTitle);
    const localNote = page.getByTestId("task-center-local-note");
    await expect(localNote).toContainText("本地筛选");
    await expect(localNote).toContainText("服务端暂未提供参数");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"))
      .toBe(taskTitle);
    await expect(taskCard).toBeVisible();
    await page.getByLabel("搜索任务").fill("无匹配任务的关键词-zzz");
    await expect(taskCard).toHaveCount(0);
    await page.getByLabel("搜索任务").fill("");
    await expect(taskCard).toBeVisible();
    await expect(page.getByTestId("task-center-local-note")).toHaveCount(0);

    // 优先级筛选已接入服务端：选中写入 URL，清除后 URL 不再携带。
    await pickCalmSelectOption(page, "优先级", "高");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("priority"))
      .toBe("HIGH");
    await pickCalmSelectOption(page, "优先级", "全部");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("priority"))
      .toBeNull();

    // F-30：筛选状态由 URL 承载，切换筛选即更新地址栏。
    await page
      .getByRole("group", { name: "工作状态" })
      .getByRole("button", { name: "已完成" })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("status"))
      .toBe("done");
    // 列表区块跟随工作状态：切到「已完成」后标题与空态都不能再写「未完成」。
    const taskListHeading = page.locator(".calm-section-title h3").first();
    await expect(taskListHeading).toHaveText("已完成");
    await expect(page.getByText("没有匹配的未完成任务")).toHaveCount(0);
    await expect(page.getByText("没有匹配的已完成任务")).toBeVisible();
    await page
      .getByRole("group", { name: "展示方式" })
      .getByRole("button", { name: "列表" })
      .click();
    await expect
      .poll(() => new URL(page.url()).searchParams.get("view"))
      .toBe("list");
    // 设计系统刻意把「更多筛选」触发按钮定为常驻 display:none：设计师稿的
    // design-system.css 与自带的视觉状态脚本（apps/e2e/scripts/visual-states.mjs）
    // 都按此约定，用 DOM 事件而不是可见点击展开筛选面板。这里沿用同一手法，
    // 断言（more=1 写入 URL、面板内容与可用性）保持不变。
    await page
      .locator(".task-toolbar > .secondary-button")
      .dispatchEvent("click");
    await expect
      .poll(() => new URL(page.url()).searchParams.get("more"))
      .toBe("1");
    await expect(
      page.getByText("显示已取消任务（不计入完成率）"),
    ).toBeVisible();
    await expect(
      page.getByLabel("显示已取消任务（不计入完成率）"),
    ).toBeEnabled();

    // 任务中心不再跳转：重新进入 /tasks（卡片视图）后点击卡片，在当前页面就地
    // 弹出功能档案同款的任务详情弹窗，写操作（编辑 / 完成任务 / 合并 / 关联链接）
    // 仍只有这一个入口；地址栏与筛选参数保持不变，关闭后仍停留在任务中心。
    await page.goto("/tasks");
    await expect(page.getByTestId("task-center")).toBeVisible();
    const navCard = page
      .locator(".calm-task-card")
      .filter({ hasText: taskTitle });
    await expect(navCard).toBeVisible();
    const taskCenterUrl = page.url();
    await navCard.click();
    const archiveDetail = page.getByRole("dialog", { name: "任务详情" });
    await expect(archiveDetail).toBeVisible();
    await expect(archiveDetail.getByText(taskTitle)).toBeVisible();
    await expect(
      archiveDetail.getByRole("button", { name: "编辑任务" }),
    ).toBeVisible();
    await expect(
      archiveDetail.getByRole("button", { name: "完成任务" }),
    ).toBeVisible();
    expect(page.url()).toBe(taskCenterUrl);
    await archiveDetail.getByRole("button", { name: "关闭" }).click();
    await expect(archiveDetail).toBeHidden();
    expect(page.url()).toBe(taskCenterUrl);
    await expect(page.getByTestId("task-center")).toBeVisible();

    await page.goto("/tasks");
    await expect(page.getByTestId("task-center")).toBeVisible();
    await page
      .getByTestId("task-center")
      .getByRole("button", { name: "遗留问题" })
      .click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/issues");
  } finally {
    await context.close();
  }
});

test("F-29 项目主页：服务端真实指标（含遗留问题总数）与入口导航", async ({
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
    // 设计师稿 catalog.tsx 的项目详情页没有「接口说明」黄条：服务端适配器下
    // 页面只呈现头部、指标条与两个面板，骨架数据提示只在 mock 降级时出现。
    await expect(notice).toHaveCount(0);

    // 指标卡按用户确认的口径只展示任务/记录/成员/遗留四项：
    // 「活跃模块」「活跃功能」已从展示层取消（服务端仍返回该统计）。
    await expect(page.getByTestId("overview-metric-modules")).toHaveCount(0);
    await expect(page.getByTestId("overview-metric-features")).toHaveCount(0);

    // 服务端指标异步加载：轮询等待真实值渲染完成，避免读到初始占位。
    // 成员数是 fixture 项目必然 > 0 的服务端真实值（创建者自动成为成员）。
    const memberCount = page
      .getByTestId("overview-metric-members")
      .locator("strong");
    await expect.poll(() => memberCount.textContent()).toContain(" 人");
    await expect
      .poll(async () =>
        Number.parseInt((await memberCount.textContent()) ?? "", 10),
      )
      .toBeGreaterThan(0);
    // 其余指标以数字形态渲染（fixture 项目尚无已发布记录与遗留问题，值为 0）。
    for (const key of ["tasks", "records", "leftovers"]) {
      const metric = page
        .getByTestId("overview-metric-" + key)
        .locator("strong");
      await expect
        .poll(async () =>
          /^\d+$/.test((await metric.textContent())?.trim() ?? ""),
        )
        .toBe(true);
    }

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

    // 项目概览已与「模块与功能」合并：旧地址整体重定向到项目主页，
    // 重定向后仍是同一套项目头部 + 指标 + 面板。
    await page.goto("/projects/" + runtime.projectId + "/overview");
    await expect
      .poll(() => new URL(page.url()).pathname)
      .toBe("/projects/" + runtime.projectId + "/modules");
    await expect(page.getByTestId("project-overview")).toBeVisible();

    // 2026-09-19：项目头部的「全部项目」返回入口已按用户要求移除，
    // 返回项目列表改由公共侧栏「项目列表」承担，这里不再断言该按钮。
  } finally {
    await context.close();
  }
});
