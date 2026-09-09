import { expect, test } from "@playwright/test";

import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

test("登录用户可打开站内通知页面", async ({ browser }) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  await page.goto("/notifications");
  await expect(page.getByText("站内通知", { exact: true })).toBeVisible();
  await expect(page.getByText("还没有通知")).toBeVisible();

  await context.close();
});
