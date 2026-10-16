import { expect, test } from "@playwright/test";

import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { pickFirstCalmSelectOption } from "../helpers/calm-select.js";
import { fillLeftovers } from "../helpers/record-leftovers.js";
import { loadRuntime } from "../helpers/runtime.js";

/**
 * F-33 生成总结（ADR-075/076）：取数范围 → 确定性正文 → AI 按一句话要求改写 →
 * 逐段编辑与回退 → 范围变更丢弃改写稿 → 上游限流提示。
 *
 * 两条标记分别落在「记录标题」与「AI 要求」里：stub 上游把两侧命中的标记回显进
 * 改写稿，因此断言命中即证明事实正文与用户要求都真的到达了上游，而不是界面自造。
 */
test("F-33 生成总结：事实取数、AI 改写、逐段回退、范围变更丢弃与上游限流提示", async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);
  // 「复制正文」读剪贴板：Chromium 默认不授权，按来源显式申请。
  await context.grantPermissions(["clipboard-read", "clipboard-write"], {
    origin: runtime.webBaseUrl,
  });
  try {
    const stamp = Date.now().toString(36).toUpperCase();
    const factsMarker = `AIE2EFACT${stamp}`;
    const requirementMarker = `AIE2EREQ${stamp}`;
    const title = `总结取数-${factsMarker}`;
    const requirement = `给领导看，先给结论 ${requirementMarker}`;
    const editedText = `手动改写 ${factsMarker}`;

    // 先造一条范围内的事实：生成总结只统计已发布的迭代记录与遗留问题。
    await page.goto(`/records?projectId=${String(runtime.projectId)}`);
    await page.getByRole("button", { name: "新建迭代记录" }).click();
    const draft = page.getByRole("dialog", { name: "新建迭代记录" });
    await pickFirstCalmSelectOption(draft, "所属模块");
    await draft.getByLabel("迭代标题").fill(title);
    await draft.getByLabel("改动原因").fill("生成总结 E2E");
    await draft.getByLabel("具体改动").fill("按范围取事实并交给 AI 改写");
    await draft.getByLabel("改动效果").fill("总结正文可逐段确认");
    await fillLeftovers(draft, ["生成总结后的待跟进项"]);
    await draft.getByRole("button", { name: "保存草稿" }).click();
    await expect(draft).toBeHidden();
    await page.getByRole("button", { name: "发布记录", exact: true }).click();
    const publish = page.getByRole("dialog", { name: "发布迭代记录" });
    await publish.getByRole("button", { name: "确认发布" }).click();
    await expect(publish).toBeHidden();

    // 1. 确定性正文：范围、计数与事实都来自服务端取数。
    await page.getByRole("button", { name: "生成总结", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "生成总结" });
    await expect(modal).toBeVisible();
    await expect(modal.locator(".summary-footer-count")).toContainText(
      /已归纳 \d+ 条迭代记录/,
    );
    const local = modal.locator('article.summary-doc[data-source="local"]');
    await expect(local).toBeVisible();
    await expect(local.locator("h3")).toContainText("年度总结");
    await expect(local).toContainText(factsMarker);
    await expect(local).toContainText("生成总结后的待跟进项");

    // 2. 明细视图与总结共用同一份取数：切回来正文仍在。
    await modal.getByRole("button", { name: "查看明细" }).click();
    await expect(modal.locator(".summary-detail-table")).toContainText(
      factsMarker,
    );
    await modal.getByRole("button", { name: "返回总结" }).click();
    await expect(local).toBeVisible();

    // 3. AI 改写：浮层先给默认态，写要求后才声明「将按这句要求改写」。
    await modal.getByRole("button", { name: "AI 助手" }).click();
    const pop = modal.getByRole("dialog", { name: "AI 助手" });
    await expect(pop).toBeVisible();
    await expect(pop.locator(".summary-ai-applied")).toHaveText(
      "还没提要求：将按现有结构生成",
    );
    await expect(
      pop.locator(".summary-ai-chip", { hasText: "突出遗留风险" }),
    ).toBeVisible();
    await pop.getByLabel("对总结的要求").fill(requirement);
    await expect(pop.locator(".summary-ai-applied")).toHaveText(
      "将按这句要求改写当前范围",
    );
    await pop.locator("button.summary-ai-generate").click();
    await expect(pop).toBeHidden();
    const assist = modal.locator('article.summary-doc[data-source="assist"]');
    await expect(assist).toBeVisible();
    await expect(local).toBeHidden();
    await expect(assist.locator(".summary-ai-heading")).toContainText(
      requirementMarker,
    );
    await expect(assist.locator(".summary-ai-list li")).toHaveCount(2);
    await expect(assist).toContainText(factsMarker);
    // stub 上游在事实那行带了 `**`（真实模型的习惯）：弹窗按纯文本清洗，
    // 不能把星号原样渲染给用户。
    await expect(assist).not.toContainText("**");

    // 4. 逐段编辑 → 复制正文带手动改动 → 单段回退。
    const editables = assist.locator(".summary-ai-edit");
    expect(await editables.count()).toBeGreaterThan(1);
    await editables.first().fill(editedText);
    // 「回退这句」只在所在段落 hover / 聚焦时出现（record-summary.css）。
    const firstSection = assist.locator(".summary-ai-sec").first();
    await expect(firstSection).toHaveAttribute("data-edited", "true");
    const revertLink = modal.locator(".summary-revert-link");
    await expect(revertLink).toBeVisible();
    await modal.getByRole("button", { name: "复制正文" }).click();
    const copied = await page.evaluate(async () =>
      navigator.clipboard.readText(),
    );
    expect(copied).toContain(editedText);
    await firstSection.hover();
    await firstSection.locator("button.summary-ai-revert").click();
    await expect(firstSection).toHaveAttribute("data-edited", "false");
    await expect(revertLink).toBeHidden();

    // 5. 失败不改正文：上游限流按固定文案提示，已生成的改写稿保留。
    await modal.getByRole("button", { name: "AI 助手" }).click();
    const retryPop = modal.getByRole("dialog", { name: "AI 助手" });
    await retryPop.getByLabel("对总结的要求").fill("AIE2ERATELIMIT");
    await retryPop.locator("button.summary-ai-generate").click();
    await expect(retryPop.locator(".summary-ai-error")).toHaveText(
      "AI 服务请求过于频繁（上游限流），请稍后重试。",
    );
    await expect(assist).toContainText(requirementMarker);

    // 6. 标签来自上次成功的要求（本地记忆，不入库）：输入框里是上一步失败时的
    //    要求，所以这个标签一开始未选中，点一下即把片段拼进输入框。
    const chip = retryPop.locator(".summary-ai-chip", { hasText: "给领导看" });
    await expect(chip).toHaveAttribute("title", "来自上次要求");
    await expect(chip).toHaveAttribute("aria-pressed", "false");
    await chip.click();
    await expect(chip).toHaveAttribute("aria-pressed", "true");
    await expect(retryPop.getByLabel("对总结的要求")).toHaveValue(
      "AIE2ERATELIMIT，给领导看",
    );

    // 7. 范围一变，已生成的改写稿与当前事实不再一致：直接丢弃。
    await modal.getByRole("button", { name: "本月", exact: true }).click();
    await expect(assist).toBeHidden();
    await expect(local).toBeVisible();
  } finally {
    await context.close();
  }
});
