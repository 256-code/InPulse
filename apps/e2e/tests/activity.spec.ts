import { expect, test } from "@playwright/test";

import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { createProjectViaUi } from "../helpers/project-create.js";
import { loadRuntime } from "../helpers/runtime.js";

test("创建项目后可在专属动态页看到 project.create 条目", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  const created = await createProjectViaUi(page, runtime, "ACT");
  await page.getByTestId("open-created-project-activity").click();

  await expect(page.getByRole("heading", { name: "项目动态" })).toBeVisible();
  await expect(page).toHaveURL(/\/projects\/\d+\/activity/);

  const item = page
    .locator('[data-testid^="activity-item-"]')
    .filter({ hasText: `创建了项目 ${created.name}` });
  await expect(item).toHaveCount(1);
  await expect(
    page.getByText(`创建了项目 ${created.name}`, { exact: true }),
  ).toBeVisible();

  const projectId = Number(
    page.url().match(/\/projects\/(\d+)\/activity/)?.[1],
  );
  expect(Number.isSafeInteger(projectId)).toBe(true);
  await expect(
    page.getByText(`项目 #${projectId}`, { exact: true }),
  ).toBeVisible();

  await context.close();
});
