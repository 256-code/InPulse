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
