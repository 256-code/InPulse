import { expect, test } from "@playwright/test";

import {
  createAuthenticatedContext,
  loginViaUi,
} from "../helpers/auth-context.js";
import {
  buildDocxFixture,
  buildPdfFixture,
} from "../helpers/office-fixtures.js";
import { loadRuntime } from "../helpers/runtime.js";

/**
 * ADR-067 AI 辅助转换关键路径：stub 上游（本机回环，CI 不访问外网）走真实 UI。
 * 夹具在运行时生成：文档里写入本轮 E2E 用户的登录名（负责人必须是真实用户）
 * 与唯一标记（保证文档摘要不同，重复运行不会触发「已导入过」的 409）。
 */

interface CspViolation {
  readonly directive: string;
  readonly blockedUri: string;
  readonly sourceFile: string | null;
  readonly lineNumber: number | null;
  readonly columnNumber: number | null;
  readonly sample: string | null;
}

test("ADR-067 .docx 本地抽取 → 自动分析 → 草稿预览与导入", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  const marker = `AIE2E-${Date.now().toString(36).toUpperCase()}`;
  const docx = buildDocxFixture([
    "需求文档（Playwright 运行时生成）",
    `模块标记 ${marker}`,
    `任务负责人：${runtime.user.loginName}`,
  ]);

  await page.goto(`/projects/${String(runtime.projectId)}/modules`);
  await page.getByTestId("import-project-document-button").click();
  const dialog = page.getByRole("dialog");

  await dialog.getByLabel("选择文档进行分析").setInputFiles({
    name: "需求文档.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: docx,
  });

  // 本地抽取成功（文件名提示）→ 自动分析 → stub 草稿填入导入文本框。
  await expect(
    dialog.getByTestId("document-import-assist-source"),
  ).toContainText("需求文档.docx");
  await expect(
    dialog.getByTestId("document-import-assist-result"),
  ).toContainText("e2e-stub-model");
  await expect(dialog.getByLabel("导入文档内容")).toHaveValue(
    new RegExp(`AI 导入模块 ${marker}`),
  );

  // 草稿继续走既有链路：预览 → 确认导入 → 模块出现。
  await dialog.getByRole("button", { name: /预\s*览/ }).click();
  await expect(dialog.getByTestId("document-import-summary")).toBeVisible();
  await dialog.getByTestId("document-import-apply").click();
  await expect(page.getByText(/文档导入完成/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: `AI 导入模块 ${marker}`, exact: true }),
  ).toBeVisible();

  await context.close();
});

test("ADR-067 .pdf 本地抽取（Worker 资产与强制 CSP 实测）", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const context = await browser.newContext({ baseURL: runtime.webBaseUrl });
  await context.addInitScript(() => {
    const violations: CspViolation[] = [];
    (window as unknown as { __cspViolations: CspViolation[] }).__cspViolations =
      violations;
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push({
        directive: event.violatedDirective,
        blockedUri: event.blockedURI,
        // 诊断字段：定位违规的真实来源文件与行列。
        sourceFile: event.sourceFile,
        lineNumber: event.lineNumber,
        columnNumber: event.columnNumber,
        sample: event.sample,
      });
    });
  });
  const page = await context.newPage();
  await loginViaUi(page, runtime);

  const marker = `AIE2E-${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
  const pdf = buildPdfFixture([
    "E2E requirement document",
    `marker: ${marker}`,
    `owner: ${runtime.user.loginName}`,
  ]);

  await page.goto(`/projects/${String(runtime.projectId)}/modules`);
  await page.getByTestId("import-project-document-button").click();
  const dialog = page.getByRole("dialog");

  await dialog.getByLabel("选择文档进行分析").setInputFiles({
    name: "需求说明.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });

  // pdf.js 用同源 module Worker 抽取文本；worker 资产 / 动态 import 必须在强制
  // CSP 下加载成功（ADR-021 不放宽 script-src），且不产生任何安全策略违规。
  await expect(
    dialog.getByTestId("document-import-assist-result"),
  ).toContainText("e2e-stub-model", { timeout: 30_000 });
  await expect(dialog.getByLabel("导入文档内容")).toHaveValue(
    new RegExp(`AI 导入模块 ${marker}`),
  );

  const violations = await page.evaluate(
    () =>
      (window as unknown as { __cspViolations?: CspViolation[] })
        .__cspViolations ?? [],
  );
  expect(violations, JSON.stringify(violations)).toEqual([]);

  await context.close();
});
