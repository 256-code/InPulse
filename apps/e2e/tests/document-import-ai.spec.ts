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
  // 左栏默认是结构化草稿「内容梳理」：AI 改写后的草稿填在这里。
  await expect(dialog.getByTestId("document-import-draft")).toContainText(
    `AI 导入模块 ${marker}`,
  );
  // 上传文件后助手主动开口说一句（缺什么 / 或者「都齐了」），不需要用户先说话。
  await expect(
    dialog.getByTestId("document-import-assist-verdict"),
  ).toContainText(
    "另有 2 处建议补齐：截止时间 ×1（AI 导入任务）、任务描述 ×1（AI 导入任务）",
  );
  // 「预览文档」页签只读对照本地抽出的原文，不含 AI 改写。
  await dialog.getByRole("button", { name: "预览文档" }).click();
  const rawPane = dialog.getByLabel("导入文档内容");
  await expect(rawPane).toHaveValue(/需求文档（Playwright 运行时生成）/);
  await expect(rawPane).not.toHaveValue(/AI 导入模块/);
  await expect(rawPane).toHaveAttribute("readonly", "");

  // 草稿继续走既有链路：预览 → 确认导入 → 模块出现。
  await dialog.getByTestId("document-import-preview").click();
  await expect(dialog.getByTestId("document-import-summary")).toBeVisible();
  await dialog.getByTestId("document-import-apply").click();
  await expect(page.getByText(/文档导入完成/)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: `AI 导入模块 ${marker}`, exact: true }),
  ).toBeVisible();

  await context.close();
});
/**
 * ADR-071：整项目导入的初始成员必填、必须含全部任务负责人；创建者（本次导入人）
 * 也要写进名单——stub 从 system 提示词里取服务端注入的创建者姓名，与任务负责人一起写；
 * 前端对创建者去重，不会重复显示。
 */
test("ADR-071 整项目 AI 导入：草稿写出创建者与任务负责人", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  const marker = `AIE2E-${Date.now().toString(36).toUpperCase()}`;
  const docx = buildDocxFixture([
    "整项目需求（Playwright 运行时生成）",
    `模块标记 ${marker}`,
    `任务负责人：${runtime.member.loginName}`,
  ]);

  await page.goto("/projects");
  await page.getByTestId("import-project-document-button").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("选择文档进行分析").setInputFiles({
    name: "整项目需求.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: docx,
  });

  // 草稿的初始成员先写创建者（服务端注入姓名），再写全部任务负责人；助手不报成员缺口。
  await expect(dialog.getByTestId("document-import-draft")).toContainText(
    runtime.user.name,
  );
  await expect(dialog.getByTestId("document-import-draft")).toContainText(
    runtime.member.loginName,
  );
  await expect(
    dialog.getByTestId("document-import-assist-verdict"),
  ).not.toContainText("初始成员缺");

  // 预览放行（成员校验由服务端最终裁决）→ 导入成功。
  await dialog.getByTestId("document-import-preview").click();
  await expect(dialog.getByTestId("document-import-summary")).toBeVisible();
  await expect(dialog.getByTestId("document-import-issues")).toHaveCount(0);
  // ADR-071：服务端把创建者本人默认算进初始成员，预览名单里就有 TA。
  await expect(dialog.locator(".import-preview-meta")).toContainText(
    runtime.user.name,
  );
  await dialog.getByTestId("document-import-apply").click();
  // 导入落地：跳进新项目的模块页，模块已建好（成员落库由 API 集成测试精确断言）。
  await expect(page).toHaveURL(/\/projects\/\d+\/modules/);
  await expect(
    page.getByRole("heading", { name: `AI 导入模块 ${marker}`, exact: true }),
  ).toBeVisible();

  await context.close();
});

/**
 * 用户对助手说话必须有回应：此前那句只被当成「补充说明」拼进文档重跑一次，对话里
 * 不留任何回应，用户提「要补充什么」时看起来就像被无视了。
 *
 * 回执只点名**必填**：建议项（截止时间 / 任务描述）由顶部常驻结论逐条承载，不再每轮在
 * 对话里复读（2026-10-14 用户反馈「这个可选择性的补充重复次数太多了，不要每一次我和
 * ai 讲话就提醒我一下那些可以选择增加」）；必填缺口没变时也不再开口。
 */
test("ADR-069 用户发问后助手回一句：必填齐了只说一句，建议清单不复读", async ({
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
  // AI 草稿已落成「已应用」的草稿：再补一句话不会弹覆盖确认。
  await expect(dialog.getByTestId("document-import-draft")).toContainText(
    `AI 导入模块 ${marker}`,
  );
  // 建议项只在顶部常驻结论里逐条点名（对话区不再复读），这里先钉住结论本身。
  await expect(
    dialog.getByTestId("document-import-assist-verdict"),
  ).toContainText(
    "另有 2 处建议补齐：截止时间 ×1（AI 导入任务）、任务描述 ×1（AI 导入任务）",
  );

  await dialog.getByLabel("补充说明").fill("要补充什么");
  await dialog.getByTestId("document-import-assist-run").click();

  // 发言时立刻回的那句：实机上模型那一轮可能改写了草稿、再补一条，这里只取第一条。
  const replies = dialog.locator(".import-msg", {
    hasText: "我重新核对了一遍",
  });
  await expect(replies.first()).toBeVisible({ timeout: 30_000 });
  await expect(replies.first()).toContainText("必填都齐了");
  // 建议清单不进每轮回执：那两项建议在对话气泡里一个字都不出现。
  await expect(replies.first()).not.toContainText("建议补齐");
  await expect(replies.first()).not.toContainText("截止时间");

  // 再发第二句：必填缺口没变，助手不再念第二遍回执（本轮只留下一条落地汇报）。
  await dialog.getByLabel("补充说明").fill("再补充一句");
  await dialog.getByTestId("document-import-assist-run").click();
  await expect(
    dialog.locator(".import-msg", {
      hasText: /这一轮草稿没有变化|已按补充说明更新草稿/,
    }),
  ).toHaveCount(2, { timeout: 30_000 });
  await expect(replies).toHaveCount(1);

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
  await expect(dialog.getByTestId("document-import-draft")).toContainText(
    `AI 导入模块 ${marker}`,
    { timeout: 30_000 },
  );
  // 文本型 PDF 的原文进「预览文档」，仅供对照。
  await dialog.getByRole("button", { name: "预览文档" }).click();
  await expect(dialog.getByLabel("导入文档内容")).toHaveValue(
    /E2E requirement document/,
  );

  const violations = await page.evaluate(
    () =>
      (window as unknown as { __cspViolations?: CspViolation[] })
        .__cspViolations ?? [],
  );
  expect(violations, JSON.stringify(violations)).toEqual([]);

  await context.close();
});

/**
 * 拖放不再只认空态那个拖入区：左栏已经有草稿时（拖入区收起）把文件拖到工作台上
 * 也必须能分析——此前这种拖放是「拖进来没反应」，既不报错也不提示。
 */
test("ADR-067 已有草稿时把 PDF 拖到工作台上同样能分析（真实拖放）", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  const marker = `AIE2E-${Date.now().toString(36).toUpperCase()}`;
  const pdf = buildPdfFixture([
    "E2E requirement document",
    `marker: ${marker}`,
    `owner: ${runtime.user.loginName}`,
  ]);

  await page.goto(`/projects/${String(runtime.projectId)}/modules`);
  await page.getByTestId("import-project-document-button").click();
  const dialog = page.getByRole("dialog");

  // 先放一份草稿：空态拖入区随之收起，正是以前「拖进来没反应」的状态。
  await dialog.getByRole("button", { name: "直接粘贴文本" }).click();
  await dialog
    .getByLabel("导入文档内容")
    .fill("## 模块：已有模块\n- 说明：先放点内容在里面。");
  await dialog.getByRole("button", { name: "内容梳理" }).click();
  await expect(dialog.getByTestId("document-import-draft")).toContainText(
    "已有模块",
  );
  await expect(dialog.locator(".import-drop")).toHaveCount(0);

  const dataTransfer = await page.evaluateHandle(
    (payload: { base64: string; name: string; mimeType: string }) => {
      const binary = atob(payload.base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      const transfer = new DataTransfer();
      transfer.items.add(
        new File([bytes], payload.name, { type: payload.mimeType }),
      );
      return transfer;
    },
    {
      base64: pdf.toString("base64"),
      name: "需求说明.pdf",
      mimeType: "application/pdf",
    },
  );

  // 拖到左栏草稿上（不是那个已经收起的拖入区）：先看到落点提示，松手后开始分析。
  await dialog.locator(".import-pane").dispatchEvent("dragover", {
    dataTransfer,
  });
  await expect(
    dialog.getByTestId("document-import-drop-overlay"),
  ).toBeVisible();
  // 落点提示只罩左栏内容区（空态拖入区 / 草稿区），不再铺满整个工作台。
  const overlayBox = await dialog
    .getByTestId("document-import-drop-overlay")
    .boundingBox();
  const paneBodyBox = await dialog.locator(".import-pane-body").boundingBox();
  const assistBox = await dialog.locator(".import-assist").boundingBox();
  if (overlayBox === null || paneBodyBox === null || assistBox === null) {
    throw new Error("拖动时拿不到落点提示或栏位几何");
  }
  expect(overlayBox.x).toBeGreaterThanOrEqual(paneBodyBox.x - 1);
  expect(overlayBox.y).toBeGreaterThanOrEqual(paneBodyBox.y - 1);
  expect(overlayBox.x + overlayBox.width).toBeLessThanOrEqual(
    paneBodyBox.x + paneBodyBox.width + 1,
  );
  expect(overlayBox.y + overlayBox.height).toBeLessThanOrEqual(
    paneBodyBox.y + paneBodyBox.height + 1,
  );
  expect(overlayBox.x + overlayBox.width).toBeLessThanOrEqual(assistBox.x);

  await dialog.locator(".import-pane").dispatchEvent("drop", { dataTransfer });
  await expect(dialog.getByTestId("document-import-drop-overlay")).toHaveCount(
    0,
  );

  // 左栏原本有草稿：AI 结果直接落回草稿，不再弹覆盖确认（用户「不要每次都问一下」）。
  await expect(dialog.getByTestId("document-import-draft")).toContainText(
    `AI 导入模块 ${marker}`,
    { timeout: 30_000 },
  );
  await expect(
    dialog.getByTestId("document-import-assist-overwrite"),
  ).toHaveCount(0);

  await context.close();
});

/**
 * 中转站常挂推理型模型（响应里带 reasoning_content）：输出预算先被推理吃掉时，上游照样
 * 回 200，但 content 为空、finish_reason=length。此前这种「正文没机会输出」被归成
 * 「上游响应非法」，用户看到「AI 服务返回了无法识别的内容」——既指错了方向，也丢掉了
 * 「精简文档 / 调高最大输出 tokens」这两条真正的解法。
 */
test("ADR-067 推理占满输出上限：提示长度上限而不是「无法识别的内容」", async ({
  browser,
}) => {
  const runtime = await loadRuntime();
  const { context, page } = await createAuthenticatedContext(browser, runtime);

  await page.goto(`/projects/${String(runtime.projectId)}/modules`);
  await page.getByTestId("import-project-document-button").click();
  const dialog = page.getByRole("dialog");

  await dialog.getByRole("button", { name: "直接粘贴文本" }).click();
  await dialog
    .getByLabel("导入文档内容")
    .fill("## 模块：输出预算用例\n- 标记：AIE2E-OUTPUT-LIMIT");
  await dialog.getByRole("button", { name: "内容梳理" }).click();
  await dialog.getByLabel("补充说明").fill("按模板整理一下");
  await dialog.getByTestId("document-import-assist-run").click();

  const error = dialog.getByTestId("document-import-assist-error");
  await expect(error).toBeVisible({ timeout: 30_000 });
  await expect(error).toContainText("最大输出 tokens");
  await expect(error).not.toContainText("无法识别");
  // 提示后仍可继续：改文档或改补充说明再发一次。
  await expect(dialog.getByTestId("document-import-assist-run")).toBeEnabled();

  await context.close();
});
