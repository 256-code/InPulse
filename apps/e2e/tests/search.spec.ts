import { expect, test } from "@playwright/test";

import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

test("登录用户通过全局搜索页面找到 E2E 投影", async ({ browser }) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  await page.goto(`/search?q=${encodeURIComponent(runtime.searchQuery)}`);
  await expect(page.getByTestId("search-result-item")).toBeVisible();
  await expect(page.getByText(runtime.projectTitle)).toBeVisible();

  await context.close();
});

test("无权限项目的搜索结果不会出现在全局搜索", async ({ browser }) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  await page.goto(`/search?q=${encodeURIComponent(runtime.hiddenSearchQuery)}`);
  await expect(page.getByText("未找到匹配结果", { exact: true })).toBeVisible();
  await expect(page.getByTestId("search-result-item")).toHaveCount(0);
  await expect(page.getByText(runtime.hiddenProjectTitle)).toHaveCount(0);

  await context.close();
});

test("无匹配关键词显示空态", async ({ browser }) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  await page.goto(
    `/search?q=${encodeURIComponent(runtime.missingSearchQuery)}`,
  );
  await expect(page.getByText("未找到匹配结果", { exact: true })).toBeVisible();
  await expect(page.getByTestId("search-result-item")).toHaveCount(0);

  await context.close();
});

test("签名游标通过加载更多返回后续分页", async ({ browser }) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  await page.goto(`/search?q=${encodeURIComponent(runtime.pageSearchQuery)}`);
  await expect(page.getByTestId("search-result-item")).toHaveCount(20);

  const loadMore = page.getByRole("button", { name: "加载更多" });
  await expect(loadMore).toBeVisible();
  await loadMore.click();

  await expect(page.getByTestId("search-result-item")).toHaveCount(
    runtime.pageSearchTotal,
  );
  await expect(loadMore).toHaveCount(0);

  await context.close();
});

test("中文短词与特殊标识符可被 PGroonga 检索", async ({ browser }) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  await page.goto(
    `/search?q=${encodeURIComponent(runtime.chineseSearchQuery)}`,
  );
  await expect(
    page.getByText(runtime.chineseSearchTitle, { exact: true }),
  ).toBeVisible();

  await page.goto(
    `/search?q=${encodeURIComponent(runtime.specialSearchQuery)}`,
  );
  await expect(
    page.getByText(runtime.specialSearchTitle, { exact: true }),
  ).toBeVisible();

  await context.close();
});
