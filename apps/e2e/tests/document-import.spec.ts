import { expect, test } from "@playwright/test";

import { createAuthenticatedContext } from "../helpers/auth-context.js";
import { loadRuntime } from "../helpers/runtime.js";

test("F-32 从文档导入整项目：预览、创建、模块可见与重复导入拦截", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  const suffix = Date.now().toString(16).slice(-8).toUpperCase();
  const code = `F32${suffix}`;
  const name = `F-32 文档导入项目 ${code}`;
  const document = [
    `# 项目：${name}`,
    `- 项目编码：${code}`,
    "- 项目说明：由 Playwright 文档导入创建，验证整项目导入关键路径。",
    `- 初始成员：${runtime.member.loginName}`,
    "",
    "## 模块：文档导入模块",
    "- 说明：整项目导入的模块。",
    "",
    "### 功能：文档导入功能",
    "- 当前说明：导入时写入的初始说明。",
    "",
    "#### 任务：文档导入任务",
    `- 负责人：${runtime.member.loginName}`,
  ].join("\n");

  await page.goto("/projects");
  await page.getByTestId("import-project-document-button").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("导入文档内容").fill(document);
  await dialog.getByRole("button", { name: /预\s*览/ }).click();

  await expect(dialog.getByTestId("document-import-summary")).toBeVisible();
  await expect(dialog.getByText(/计划创建模块 1 个/)).toBeVisible();
  await expect(dialog.getByText("新建模块：文档导入模块")).toBeVisible();

  await dialog.getByTestId("document-import-apply").click();
  await expect(page).toHaveURL(/\/projects\/\d+\/modules/);
  await expect(
    page.getByRole("heading", { name: "文档导入模块", exact: true }),
  ).toBeVisible();

  // 功能落在模块内：点击模块卡片进入功能列表。
  await page
    .getByRole("heading", { name: "文档导入模块", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "文档导入功能", exact: true }),
  ).toBeVisible();

  // 同一文档再次导入：预览给出重复提示，确认按钮禁用。
  await page.goto("/projects");
  await page.getByTestId("import-project-document-button").click();
  const again = page.getByRole("dialog");
  await again.getByLabel("导入文档内容").fill(document);
  await again.getByRole("button", { name: /预\s*览/ }).click();
  await expect(again.getByText("该文档已导入过，不能重复导入。")).toBeVisible();
  await expect(again.getByTestId("document-import-apply")).toBeDisabled();

  await context.close();
});

test("F-32 项目内从文档导入多个模块与功能", async ({ browser }) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  const suffix = Date.now().toString(16).slice(-6).toUpperCase();
  const moduleA = `批次模块甲 ${suffix}`;
  const moduleB = `批次模块乙 ${suffix}`;
  const document = [
    `## 模块：${moduleA}`,
    "- 说明：批量导入的模块甲。",
    "",
    "### 功能：批次功能甲",
    "- 当前说明：批量导入的功能甲。",
    "",
    "#### 任务：批次任务甲",
    // 项目内导入（模式 A）要求负责人已是项目活跃成员：夹具项目里只有 E2E 用户本人。
    `- 负责人：${runtime.user.loginName}`,
    "",
    `## 模块：${moduleB}`,
  ].join("\n");

  await page.goto(`/projects/${runtime.projectId}/modules`);
  await page.getByTestId("import-project-document-button").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("导入文档内容").fill(document);
  await dialog.getByRole("button", { name: /预\s*览/ }).click();
  await expect(dialog.getByText(/计划创建模块 2 个/)).toBeVisible();
  await dialog.getByTestId("document-import-apply").click();

  await expect(page.getByText(/文档导入完成：新建 2 个模块/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: moduleA, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: moduleB, exact: true }),
  ).toBeVisible();

  await context.close();
});

test("F-32 文档导入弹窗在矮窗口下页脚不被裁切、正文可滚动（布局回归）", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  // 模拟「窗口没全屏」：620px 高度下，弹窗内容（引导语 + 格式速查 + 14 行文本框）必然超过可用高度。
  await page.setViewportSize({ width: 1280, height: 620 });
  await page.goto("/projects");
  await page.getByTestId("import-project-document-button").click();
  const dialog = page.getByRole("dialog");

  // 页脚（取消 / 预览）必须完整落在视口内，不能被 overflow 裁掉。
  const preview = dialog.getByRole("button", { name: /预\s*览/ });
  await expect(preview).toBeVisible();
  await expect(preview).toBeInViewport();
  const box = await preview.boundingBox();
  expect(box, "预览按钮应有布局盒").not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(620);

  // 正文容器收缩并内部滚动：内容高于可视区，但弹窗自身不溢出。
  const metrics = await dialog.locator(".dialog-form").evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
  }));
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);

  // 内容保持自然高度（14 行文本框不被压缩成一小条），靠滚动而不是压扁来适配。
  const textareaBox = await dialog.getByLabel("导入文档内容").boundingBox();
  expect(textareaBox, "文本框应有布局盒").not.toBeNull();
  expect(textareaBox!.height).toBeGreaterThan(200);

  // 能真正滚动到底部的文件操作行。
  const pickFile = dialog.getByRole("button", { name: "选择文件" });
  await pickFile.scrollIntoViewIfNeeded();
  await expect(pickFile).toBeInViewport();

  await context.close();
});
