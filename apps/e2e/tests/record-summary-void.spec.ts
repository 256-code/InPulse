import { expect, type Locator, type Page } from "@playwright/test";

import { test } from "../helpers/admin-fixture.js";
import {
  createAuthenticatedContext,
  loginAdminViaUi,
} from "../helpers/auth-context.js";
import { pickFirstCalmSelectOption } from "../helpers/calm-select.js";
import { loadRuntime } from "../helpers/runtime.js";

/** 打开「生成总结」并等确定性正文就位。 */
async function openSummary(
  page: Page,
): Promise<{ readonly modal: Locator; readonly body: Locator }> {
  await page.getByRole("button", { name: "生成总结", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "生成总结" });
  await expect(modal).toBeVisible();
  const body = modal.locator('article.summary-doc[data-source="local"]');
  await expect(body).toBeVisible();
  return { modal, body };
}

/** 底栏计数；还没取完数时返回 NaN，交给 expect.poll 重试。 */
async function summaryCount(modal: Locator): Promise<number> {
  const text = await modal.locator(".summary-footer-count").innerText();
  const matched = /(\d+) 条迭代记录/.exec(text);
  return matched === null ? Number.NaN : Number(matched[1]);
}

async function closeSummary(modal: Locator): Promise<void> {
  await modal.getByRole("button", { name: "关闭生成总结" }).click();
  await expect(modal).toBeHidden();
}

/**
 * F-33 × F-21 交叉：生成总结只统计「已发布」的迭代记录。总结正文的口径说明写着
 * 「作废记录与草稿不计入」，因此作废一条记录后它要退出总结与计数，恢复后再回来。
 * F-21 只覆盖记录自身的可见性、F-33 只覆盖取数与 AI 改写，这条不变量此前没有
 * 端到端用例；状态与总结计数不一致时，年终总结会把作废内容算进成果里。
 */
test("F-33 生成总结只统计已发布记录：作废退出范围、恢复回到范围", async ({
  browser,
  admin,
}) => {
  test.setTimeout(180_000);
  const runtime = await loadRuntime();
  const member = await createAuthenticatedContext(browser, runtime);
  const adminContext = await browser.newContext({
    baseURL: runtime.webBaseUrl,
  });
  const adminPage = await adminContext.newPage();
  try {
    const marker = `AIE2EVOID${Date.now().toString(36).toUpperCase()}`;
    const title = `作废不计数-${marker}`;
    const memberPage = member.page;

    // 1. 成员发布一条范围内的记录，并记下它自己的 URL 供管理员打开。
    await memberPage.goto(`/records?projectId=${String(runtime.projectId)}`);
    await memberPage.getByRole("button", { name: "新建迭代记录" }).click();
    const draft = memberPage.getByRole("dialog", { name: "新建迭代记录" });
    await pickFirstCalmSelectOption(draft, "所属模块");
    await draft.getByLabel("迭代标题").fill(title);
    await draft.getByLabel("改动原因").fill("作废前的问题");
    await draft.getByLabel("具体改动").fill("作废前的方案");
    await draft.getByLabel("改动效果").fill("作废前的验证");
    await draft.getByRole("button", { name: "保存草稿" }).click();
    await expect(draft).toBeHidden();
    await memberPage
      .getByRole("button", { name: "发布记录", exact: true })
      .click();
    const publish = memberPage.getByRole("dialog", { name: "发布迭代记录" });
    await publish.getByRole("button", { name: "确认发布" }).click();
    await expect(publish).toBeHidden();
    const recordUrl = memberPage.url();

    // 2. 作废前：记录在总结范围内，计数为 n。
    const first = await openSummary(memberPage);
    await expect(first.body).toContainText(marker);
    const count = await summaryCount(first.modal);
    expect(count).toBeGreaterThan(0);
    await closeSummary(first.modal);

    // 3. 管理员作废这条记录（作废原因必填）。
    await loginAdminViaUi(adminPage, runtime, admin);
    await adminPage.goto(recordUrl);
    const detail = adminPage.getByRole("region", { name: "正式记录详情" });
    await detail.getByRole("button", { name: "作废记录" }).click();
    const voidDialog = adminPage.getByRole("dialog", {
      name: "作废记录",
      exact: true,
    });
    await expect(
      voidDialog.getByRole("button", { name: "确认作废记录" }),
    ).toBeDisabled();
    await voidDialog.getByLabel("作废原因").fill("总结口径验证");
    await voidDialog.getByRole("button", { name: "确认作废记录" }).click();
    await expect(voidDialog).toBeHidden();

    // 4. 作废后：记录退出总结，计数少一条。
    const second = await openSummary(memberPage);
    await expect.poll(async () => summaryCount(second.modal)).toBe(count - 1);
    await expect(second.body).not.toContainText(marker);
    await closeSummary(second.modal);

    // 5. 恢复后：记录回到总结，计数复原。
    await detail.getByRole("button", { name: "恢复记录" }).click();
    const restoreDialog = adminPage.getByRole("dialog", {
      name: "恢复记录",
      exact: true,
    });
    await restoreDialog.getByLabel("恢复原因").fill("纠正误作废");
    await restoreDialog.getByRole("button", { name: "确认恢复记录" }).click();
    await expect(restoreDialog).toBeHidden();

    const third = await openSummary(memberPage);
    await expect.poll(async () => summaryCount(third.modal)).toBe(count);
    await expect(third.body).toContainText(marker);
    await closeSummary(third.modal);
  } finally {
    await member.context.close();
    await adminContext.close();
  }
});
