import { expect, test } from "@playwright/test";
import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { createProjectViaUi } from "../helpers/project-create.js";
import { loadRuntime } from "../helpers/runtime.js";
import {
  calmSelectTrigger,
  pickCalmSelectOption,
} from "../helpers/calm-select.js";

test("B-3b 全部项目跨项目清单、名称回填与全局我的草稿", async ({ browser }) => {
  test.setTimeout(180000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    // 新建第二个项目（创建者自动成为成员），用于验证跨项目读取。
    const project = await createProjectViaUi(page, runtime, "E2EFEED");
    await page.goto("/records");
    await expect(calmSelectTrigger(page, "项目")).toContainText("全部项目");
    await pickCalmSelectOption(page, "项目", project.name);
    await expect(calmSelectTrigger(page, "项目")).toContainText(project.name);
    const projectId = new URL(page.url()).searchParams.get("projectId");
    expect(projectId).not.toBeNull();

    await page.goto(`/projects/${projectId}/modules`);
    // 页头动作区的「新增模块」已按产品要求删除，页面只剩区块标题行/空态一处入口。
    await page.getByRole("button", { name: "新增模块", exact: true }).click();
    const moduleDialog = page.getByRole("dialog", { name: "新增模块" });
    await moduleDialog.getByLabel("模块名称").fill("记录测试模块");
    await moduleDialog.getByRole("button", { name: /保\s*存/ }).click();
    await expect(moduleDialog).toBeHidden();
    await page.goto(`/records?projectId=${projectId}`);
    const title = `跨项目记录-${Date.now()}`;
    await page.getByRole("button", { name: "新建迭代记录" }).click();
    const draft = page.getByRole("dialog", { name: "新建迭代记录" });
    // 新建项目不会自动生成「未分类」占位模块：按名称选中本用例刚建的模块。
    await pickCalmSelectOption(draft, "所属模块", "记录测试模块");
    await draft.getByLabel("迭代标题").fill(title);
    await draft.getByLabel("改动原因").fill("B-3b 跨项目清单问题");
    await draft.getByLabel("具体改动").fill("B-3b 跨项目清单方案");
    await draft.getByLabel("改动效果").fill("B-3b 跨项目清单验证");
    await draft.getByRole("button", { name: "保存草稿" }).click();
    await expect(draft).toBeHidden();
    // 14808b1 起草稿标题渲染在弹层页头，不在 region「草稿详情」内。
    await expect(
      page
        .getByRole("dialog", { name: "草稿详情", exact: true })
        .getByText(title),
    ).toBeVisible();

    // 草稿箱：项目草稿平铺成卡片，不再有单独的「我的草稿」条带。
    const draftList = page.locator("#record-draft-list");
    await expect(draftList.getByText(title)).toBeVisible();
    await expect(draftList.getByText("记录测试模块")).toBeVisible();
    await page.getByRole("button", { name: "发布记录", exact: true }).click();
    const publish = page.getByRole("dialog", { name: "发布迭代记录" });
    await publish.getByRole("button", { name: "确认发布" }).click();
    await expect(publish).toBeHidden();
    await expect(
      page
        .getByRole("region", { name: "正式记录详情" })
        .getByRole("heading", { name: title }),
    ).toBeVisible();

    // 默认全部项目：不选项目即可看到刚发布的记录，并带回项目名称。
    await page.goto("/records");
    await expect(calmSelectTrigger(page, "项目")).toContainText("全部项目");
    // 全部项目视图同样展示草稿箱（跨项目汇总当前用户的草稿），标题为「我的草稿」。
    await expect(page.getByRole("heading", { name: "我的草稿" })).toBeVisible();
    const card = page.locator(".record-card").filter({ hasText: title });
    await expect(card).toBeVisible();
    await expect(card.getByText(`归属 ${project.name} /`)).toBeVisible();
    await expect(card).toContainText(runtime.user.name);

    // 服务端 q：跨项目关键词命中与空态都不依赖已加载页。
    await page.getByLabel("搜索迭代记录").fill(`无匹配-${Date.now()}`);
    await expect(page.getByText("没有匹配的迭代记录")).toBeVisible();
    await expect(card).toHaveCount(0);
    await page.getByLabel("搜索迭代记录").fill(title);
    await expect(card).toBeVisible();

    // 跨项目卡片按记录自身 projectId 打开详情（错误实现会停在加载态）。
    await card.locator("summary").click();
    await expect(card.locator("summary")).toContainText(/-CR-\d+ · v1 · 发布/);
    await expect(card.locator(".record-summary-badges")).toContainText(
      "已发布",
    );
    await expect(
      page.getByRole("region", { name: "正式记录详情" }),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/b3b-cross-project-feed.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
