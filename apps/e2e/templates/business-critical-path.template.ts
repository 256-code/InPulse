import { expect, test } from "@playwright/test";

import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

/**
 * 业务关键路径场景模板。
 *
 * 本文件位于 templates/，不会被 Playwright testDir 发现；需要新增场景时把
 * 本文件复制到 apps/e2e/tests/<domain>.spec.ts，并把 test 名称与断言替换为
 * 真实业务步骤。禁止使用 test.skip / test.fixme 掩盖未完成行为。
 */
test("template: replace with a business critical path", async ({ browser }) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  try {
    // Step 1: 通过生成客户端创建唯一业务数据；不要直接裸写 fetch/axios。
    // Step 2: 导航到目标页面并等待真实 UI 状态，避免依赖未完成的动画。
    // Step 3: 复用 runtime 中的用户/项目归属，验证跨项目不可见与 404 行为。
    // Step 4: 对写操作补充 409/422/幂等重放断言，并保持用例间数据隔离。
    await expect(page.getByText("业务页面标题")).toBeVisible();
  } finally {
    await context.close();
  }
});
