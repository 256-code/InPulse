import { expect } from "@playwright/test";
import { test } from "../helpers/admin-fixture.js";

import {
  createAuthenticatedContext,
  loginAdminViaUi,
} from "../helpers/auth-context.js";
import { pickCalmSelectOptions } from "../helpers/calm-select.js";
import { loadRuntime } from "../helpers/runtime.js";

test("普通成员可查看并管理本项目成员，不能读取其他项目", async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    await page.goto(`/projects/${runtime.projectId}/members`);
    // 只读视图复用管理员页的视觉语言：h1 为项目名，成员渲染为
    // .calm-member-card 卡片；不再提供旧的 `.project-members` 列表结构。
    const members = page.locator(".settings-panel");
    await expect(
      page.getByRole("heading", { name: runtime.projectName, level: 1 }),
    ).toBeVisible();
    await expect(members).toBeVisible();
    await expect(
      members
        .locator(".calm-member-card")
        .filter({ hasText: runtime.user.name }),
    ).toHaveCount(1);
    await expect(
      members.getByRole("button", { name: "添加成员" }),
    ).toBeVisible();
    // ADR-039：项目内管理权对全体活跃成员等同，视图不再按角色降级——普通成员
    // （此处即项目创建者）同样看到完整管理入口。授权仍由服务端强制，同文件末尾
    // 的隐藏项目 404 断言覆盖。
    await expect(
      members
        .locator(".calm-member-card")
        .filter({ hasText: runtime.user.name })
        .getByRole("button", { name: /移\s*除/ }),
    ).toBeVisible();

    const forbidden = page.waitForResponse((response) =>
      response
        .url()
        .endsWith(`/api/v1/projects/${runtime.hiddenProjectId}/active-members`),
    );
    await page.goto(`/projects/${runtime.hiddenProjectId}/members`);
    expect((await forbidden).status()).toBe(404);
    await expect(
      page.getByText("项目或成员不存在，或你已无权访问。", { exact: true }),
    ).toBeVisible();
    await expect(page.locator(".calm-member-card")).toHaveCount(0);
    await expect(
      page.getByText(runtime.member.name, { exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("管理员完成成员添加与移除，并校验不存在项目的读取边界", async ({
  browser,
  admin,
}) => {
  test.setTimeout(180_000);
  const runtime = await loadRuntime();
  const context = await browser.newContext({ baseURL: runtime.webBaseUrl });
  const page = await context.newPage();
  const memberCard = page
    .locator(".calm-member-card")
    .filter({ hasText: runtime.member.name })
    .last();

  try {
    await loginAdminViaUi(page, runtime, admin);
    await page.goto(`/projects/${runtime.projectId}/members`);
    await expect(
      page.getByRole("heading", { name: runtime.projectName, exact: true }),
    ).toBeVisible();

    await expect(page.getByRole("heading", { name: "项目成员" })).toBeVisible();
    await expect(
      page.locator(".calm-member-card").filter({ hasText: runtime.user.name }),
    ).toHaveCount(1);

    await page.getByRole("button", { name: "添加成员" }).click();
    const addDialog = page.getByRole("dialog", { name: "添加项目成员" });
    // 搜索框是真实 <input>：宿主表单会给它加边框、内边距与聚焦光环，触发器里因此
    // 会多出一个「空输入小方框」。真实浏览器里锁定它已被复位。
    const triggerInput = addDialog
      .locator(".calm-select-multiple .ant-select-input")
      .first();
    await expect(triggerInput).toHaveCount(1);
    await expect(triggerInput).toHaveCSS("border-top-width", "0px");
    await expect(triggerInput).toHaveCSS("padding-left", "0px");
    await expect(triggerInput).toHaveCSS("box-shadow", "none");
    await pickCalmSelectOptions(addDialog, "选择要添加的用户", [
      runtime.member.name,
    ]);
    await addDialog.getByRole("button", { name: "添加成员" }).click();
    await expect(
      page.getByText("已添加 1 位项目成员，项目成员列表已更新。"),
    ).toBeVisible();
    await expect(
      memberCard.getByText("活跃成员", { exact: true }),
    ).toBeVisible();

    await memberCard.getByRole("button", { name: /移\s*除/ }).click();
    const removeDialog = page.getByRole("dialog", { name: "移除项目成员" });
    await expect(
      removeDialog.getByText(`确认从项目中移除 ${runtime.member.name}？`, {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      removeDialog.getByText("该成员没有未完成任务。", { exact: true }),
    ).toBeVisible();
    await removeDialog.getByRole("button", { name: "确认移除" }).click();
    await expect(
      page.getByText(
        "成员已移出项目，未改派任务保留原负责人且该成员已失去处理权限。",
      ),
    ).toBeVisible();
    await expect(memberCard.getByText("已移除", { exact: true })).toBeVisible();
    await expect(
      memberCard.getByText("历史记录已保留", { exact: true }),
    ).toBeVisible();
    await expect(memberCard.locator(".member-removed-note")).toBeVisible();

    await page.goto("/projects/999999999/members");
    await expect(
      page.getByText("项目成员加载失败", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("项目或成员不存在，或你已无权访问。", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
  }
});
