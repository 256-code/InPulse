import { expect, test } from "@playwright/test";
import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { createProjectViaUi } from "../helpers/project-create.js";
import { loadRuntime } from "../helpers/runtime.js";

test("B-3b 全部项目跨项目清单、名称回填与全局我的草稿", async ({ browser }) => {
  test.setTimeout(180000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  try {
    // 新建第二个项目（创建者自动成为成员），用于验证跨项目读取。
    const project = await createProjectViaUi(page, runtime, "E2EFEED");
    await page.goto("/records");
    await expect(page.getByLabel("项目")).toHaveValue("");
    await page.getByLabel("项目").selectOption({ label: project.name });
    await expect(page.getByLabel("项目")).not.toHaveValue("");
    const projectId = new URL(page.url()).searchParams.get("projectId");
    expect(projectId).not.toBeNull();

    const title = `跨项目记录-${Date.now()}`;
    await page.getByRole("button", { name: "新建独立草稿" }).click();
    const draft = page.getByRole("dialog", { name: "新建独立草稿" });
    await draft.getByLabel("所属模块").selectOption({ index: 1 });
    await draft.getByLabel("迭代标题").fill(title);
    await draft
      .getByLabel("为什么改、发现了什么问题")
      .fill("B-3b 跨项目清单问题");
    await draft.getByLabel("改了什么、怎么改的").fill("B-3b 跨项目清单方案");
    await draft
      .getByLabel("改完效果如何、如何验证")
      .fill("B-3b 跨项目清单验证");
    await draft.getByRole("button", { name: "保存草稿" }).click();
    await expect(draft).toBeHidden();
    await expect(
      page.getByRole("region", { name: "草稿详情" }).getByText(title),
    ).toBeVisible();

    // 我的草稿条带：B-3b 起跨项目并回填项目 / 模块名称。
    const strip = page.getByRole("region", { name: "我的草稿" });
    await expect(strip.getByText(title)).toBeVisible();
    await expect(strip.getByText(`${project.name} / 未分类`)).toBeVisible();

    await page.getByRole("button", { name: "发布记录", exact: true }).click();
    const publish = page.getByRole("dialog", { name: "发布迭代记录" });
    await publish.getByRole("button", { name: "确认发布" }).click();
    await expect(publish).toBeHidden();
    await expect(
      page
        .getByRole("region", { name: "正式记录详情" })
        .getByText(/-CR-\d+ · v1 · 已发布/),
    ).toBeVisible();

    // 默认全部项目：不选项目即可看到刚发布的记录，并带回项目名称。
    await page.goto("/records");
    await expect(page.getByLabel("项目")).toHaveValue("");
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
    await expect(
      page
        .getByRole("region", { name: "正式记录详情" })
        .getByText(/-CR-\d+ · v1 · 已发布/),
    ).toBeVisible();
    await page.screenshot({
      path: "test-results/b3b-cross-project-feed.png",
      fullPage: true,
    });
  } finally {
    await context.close();
  }
});
