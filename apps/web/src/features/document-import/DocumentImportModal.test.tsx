import React from "react";
import { ConfigProvider } from "antd";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiError,
  DOCUMENT_IMPORT_TEMPLATE,
  type CurrentUserResponse,
  type DocumentImportAssistResponse,
  type InpulseApiClient,
  type ProjectDocumentImportPreviewResponse,
  type ProjectDocumentImportResult,
} from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";
import { DocumentImportModal } from "./DocumentImportModal";
import type { DocumentImportMode } from "./document-import-query";
import {
  DocumentExtractionError,
  extractDocumentText,
} from "./document-text-extraction";

/**
 * ADR-064 文档导入弹窗：固定模板粘贴 → 只读预览 → 单事务执行。
 * ADR-067 追加 AI 辅助区块：本地抽取（此处 mock 抽取模块，真实分支有独立单测）
 * → 生成草稿 → 覆盖确认 → 填入文本框。
 * jsdom 没有 createObjectURL，模板下载按钮不做行为断言。
 */
vi.mock("./document-text-extraction", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./document-text-extraction")>();
  return { ...actual, extractDocumentText: vi.fn() };
});

const extractDocumentTextMock = vi.mocked(extractDocumentText);

const DOCUMENT = "# 项目：商城系统\n- 项目编码：SHOP";
const ASSIST_MARKDOWN = "# 项目：商城系统\n- 项目编码：MALL";

const okAssist: DocumentImportAssistResponse = {
  markdown: ASSIST_MARKDOWN,
  model: "stub-model",
  issues: [],
};

const okPreview: ProjectDocumentImportPreviewResponse = {
  digest: "a".repeat(64),
  templateVersion: "1",
  project: null,
  summary: {
    moduleCount: 1,
    featureCount: 1,
    taskCount: 1,
    moduleCreateCount: 1,
    moduleReuseCount: 0,
    featureCreateCount: 1,
    featureReuseCount: 0,
    taskCreateCount: 1,
    memberAddCount: 0,
  },
  modules: [{ line: 4, name: "支付", action: "CREATE", moduleId: null }],
  features: [
    {
      line: 6,
      moduleName: "支付",
      name: "微信支付退款回调",
      action: "CREATE",
      featureId: null,
    },
  ],
  tasks: [
    {
      line: 8,
      scope: "FEATURE",
      moduleName: "支付",
      featureName: "微信支付退款回调",
      title: "修复重复回调",
      assignees: [{ token: "zhang", userId: 9, name: "张三" }],
      priority: "HIGH",
      dueAt: null,
    },
  ],
  issues: [],
  canApply: true,
  duplicate: null,
};

const okResult: ProjectDocumentImportResult = {
  projectId: 12,
  projectCode: "SHOP",
  digest: "a".repeat(64),
  counts: {
    modules: 1,
    features: 1,
    tasks: 1,
    reusedModules: 0,
    reusedFeatures: 0,
    addedMembers: 0,
  },
  modules: [{ id: 31, code: "SHOP-M-1" }],
  features: [{ id: 41, code: "SHOP-F-1", moduleId: 31 }],
  tasks: [
    {
      id: 51,
      code: "SHOP-T-1",
      moduleId: 31,
      featureId: 41,
      scopeType: "FEATURE",
    },
  ],
};

const adminUser: CurrentUserResponse = {
  id: 1,
  loginName: "admin",
  name: "管理员",
  email: null,
  avatarUrl: null,
  isAdmin: true,
  status: "ACTIVE",
};

function LocationProbe(): React.ReactElement {
  const location = useLocation();
  return (
    <div data-testid="location">{location.pathname + location.search}</div>
  );
}

interface MountOptions {
  readonly preview?: ProjectDocumentImportPreviewResponse | undefined;
  readonly previewError?: unknown;
  readonly applyError?: unknown;
  readonly assist?: DocumentImportAssistResponse | undefined;
  readonly assistError?: unknown;
  readonly mode?: DocumentImportMode | undefined;
  readonly admin?: boolean | undefined;
}

function mount(options: MountOptions = {}) {
  const previewProjectDocumentImport =
    options.previewError === undefined
      ? vi.fn().mockResolvedValue(options.preview ?? okPreview)
      : vi.fn().mockRejectedValue(options.previewError);
  const importProjectDocument =
    options.applyError === undefined
      ? vi.fn().mockResolvedValue(okResult)
      : vi.fn().mockRejectedValue(options.applyError);
  const assistDocumentImport =
    options.assistError === undefined
      ? vi.fn().mockResolvedValue(options.assist ?? okAssist)
      : vi.fn().mockRejectedValue(options.assistError);
  const issueCsrfToken = vi
    .fn()
    .mockResolvedValue({ csrfToken: "a".repeat(43) });
  const client = {
    issueCsrfToken,
    previewProjectDocumentImport,
    importProjectDocument,
    assistDocumentImport,
  } as unknown as InpulseApiClient;
  const onImported = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AuthStateProvider
        value={{
          status: "authenticated",
          user: options.admin ? adminUser : null,
        }}
      >
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <MemoryRouter>
          <DocumentImportModal
            open
            mode={options.mode ?? "PROJECT"}
            projectId={2}
            client={client}
            onClose={onClose}
            onImported={onImported}
          />
          <LocationProbe />
          </MemoryRouter>
        </QueryClientProvider>
      </AuthStateProvider>
    </ConfigProvider>,
  );
  return {
    client,
    onImported,
    onClose,
    importProjectDocument,
    previewProjectDocumentImport,
    assistDocumentImport,
    issueCsrfToken,
  };
}

function pasteDocument(document: string = DOCUMENT): void {
  fireEvent.change(screen.getByLabelText("导入文档内容"), {
    target: { value: document },
  });
}

function pickFile(file: File): void {
  fireEvent.change(screen.getByLabelText("选择文档文件"), {
    target: { files: [file] },
  });
}

function pickAssistFile(file: File): void {
  fireEvent.change(screen.getByLabelText("选择文档进行分析"), {
    target: { files: [file] },
  });
}

function importTextarea(): HTMLTextAreaElement {
  return screen.getByLabelText("导入文档内容") as HTMLTextAreaElement;
}

async function pasteAndPreview(document: string = DOCUMENT) {
  pasteDocument(document);
  fireEvent.click(screen.getByRole("button", { name: /预\s*览/ }));
  await screen.findByTestId("document-import-summary");
}

beforeEach(() => {
  extractDocumentTextMock.mockReset();
});

describe("ADR-064 文档导入弹窗（项目内导入）", () => {
  it("预览只读展示计划，确认后先取 CSRF 再带幂等键执行并回调结果", async () => {
    const { client, onImported } = mount();
    await pasteAndPreview();

    expect(client.previewProjectDocumentImport).toHaveBeenCalledWith(2, {
      document: DOCUMENT,
    });
    expect(screen.getByText(/计划创建模块 1 个/)).toBeTruthy();
    expect(screen.getByText("新建模块：支付")).toBeTruthy();
    expect(
      screen.getByText("功能级任务：修复重复回调（负责人：张三）"),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId("document-import-apply"));

    await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1));
    expect(onImported).toHaveBeenCalledWith(okResult);
    expect(client.importProjectDocument).toHaveBeenCalledWith(
      2,
      { document: DOCUMENT, expectedDigest: okPreview.digest },
      {
        headers: {
          "x-csrf-token": "a".repeat(43),
          "Idempotency-Key": expect.stringMatching(/^document-import-/),
        },
      },
    );
  });

  it("存在 ERROR 行级问题时确认导入禁用并展示问题清单", async () => {
    mount({
      preview: {
        ...okPreview,
        canApply: false,
        issues: [
          {
            severity: "ERROR",
            line: 3,
            code: "MISSING_FEATURE_SECTION",
            message: "功能缺少当前说明",
          },
        ],
      },
    });
    await pasteAndPreview();

    expect(screen.getByText("第 3 行：功能缺少当前说明")).toBeTruthy();
    const apply = screen.getByTestId("document-import-apply");
    expect((apply as HTMLButtonElement).disabled).toBe(true);
  });

  it("同一文档已导入过时给出重复提示并禁用确认", async () => {
    mount({
      preview: {
        ...okPreview,
        canApply: false,
        duplicate: {
          projectId: 12,
          importedAt: "2026-10-10T00:00:00.000Z",
          actorName: "张三",
        },
      },
    });
    await pasteAndPreview();

    expect(screen.getByText("该文档已导入过，不能重复导入。")).toBeTruthy();
    const apply = screen.getByTestId("document-import-apply");
    expect((apply as HTMLButtonElement).disabled).toBe(true);
  });

  it("预览 422 时展示行级问题与固定错误文案", async () => {
    mount({
      previewError: new ApiError(422, {
        code: "DOCUMENT_IMPORT_INVALID",
        message: "文档校验失败",
        details: {
          issues: [
            {
              severity: "ERROR",
              line: 2,
              code: "MISSING_PROJECT_CODE",
              message: "缺少项目编码",
            },
          ],
        },
        requestId: "test",
      }),
    });
    pasteDocument();
    fireEvent.click(screen.getByRole("button", { name: /预\s*览/ }));

    expect(await screen.findByText("第 2 行：缺少项目编码")).toBeTruthy();
    expect(
      screen.getByText("文档存在错误，请修正问题清单后重新预览。"),
    ).toBeTruthy();
  });

  it("执行时摘要过期（409）退回输入阶段重新预览", async () => {
    const { onImported } = mount({
      applyError: new ApiError(409, {
        code: "DOCUMENT_IMPORT_STALE",
        message: "stale",
        details: {},
        requestId: "test",
      }),
    });
    await pasteAndPreview();
    fireEvent.click(screen.getByTestId("document-import-apply"));

    expect(
      await screen.findByText("文档内容与预览结果不一致，请重新预览后再导入。"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /预\s*览/ })).toBeTruthy();
    expect(onImported).not.toHaveBeenCalled();
  });

  it("空文档点击预览给出本地提示且不发请求", async () => {
    const { client } = mount();
    pasteDocument("   ");
    fireEvent.click(screen.getByRole("button", { name: /预\s*览/ }));

    expect(
      await screen.findByText("请粘贴内容或选择文件后再预览。"),
    ).toBeTruthy();
    expect(client.previewProjectDocumentImport).not.toHaveBeenCalled();
  });

  it("展示格式速查区块，模板自带字段名与忽略规则说明（ADR-065）", () => {
    mount();
    const guide = screen.getByTestId("document-import-format-guide");
    expect(guide.textContent).toContain("格式速查");
    expect(guide.textContent).toContain("项目编码");
    expect(guide.textContent).toContain("负责人");
    expect(guide.textContent).toContain("- 字段名：值");
    expect(DOCUMENT_IMPORT_TEMPLATE).toContain("项目编码");
    expect(DOCUMENT_IMPORT_TEMPLATE).toContain("负责人（必填");
    expect(DOCUMENT_IMPORT_TEMPLATE).toContain(
      "说明行（以 > 开头）与代码围栏行",
    );
    expect(DOCUMENT_IMPORT_TEMPLATE).toContain("不要自创、不要改名");
  });

  it("选择 .md 文件后读取内容填入文本框并剥离 BOM（ADR-066）", async () => {
    const { client } = mount();
    const file = new File(["\uFEFF" + DOCUMENT], "商城系统.md", {
      type: "text/markdown",
    });
    pickFile(file);

    const textarea = screen.getByLabelText(
      "导入文档内容",
    ) as HTMLTextAreaElement;
    await waitFor(() => expect(textarea.value).toBe(DOCUMENT));
    expect(
      screen.getByTestId("document-import-file-hint").textContent,
    ).toContain("商城系统.md");

    fireEvent.click(screen.getByRole("button", { name: /预\s*览/ }));
    await screen.findByTestId("document-import-summary");
    expect(client.previewProjectDocumentImport).toHaveBeenCalledWith(2, {
      document: DOCUMENT,
    });
  });

  it("非文本扩展名的文件被拒绝且不发请求（ADR-066）", async () => {
    const { client } = mount();
    pickFile(new File(["%PDF-1.4"], "spec.pdf", { type: "application/pdf" }));

    expect(
      await screen.findByText("只支持 .md、.markdown 或 .txt 文本文件。"),
    ).toBeTruthy();
    const textarea = screen.getByLabelText(
      "导入文档内容",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
    expect(client.previewProjectDocumentImport).not.toHaveBeenCalled();
  });

  it("超过 1 MB 的文件被拒绝且不发请求（ADR-066）", async () => {
    const { client } = mount();
    pickFile(
      new File([new Uint8Array(1_048_577)], "big.md", {
        type: "text/markdown",
      }),
    );

    expect(
      await screen.findByText("文件超过 1 MB 上限，请精简后重试。"),
    ).toBeTruthy();
    expect(client.previewProjectDocumentImport).not.toHaveBeenCalled();
  });
});

describe("ADR-067 AI 辅助转换区块", () => {
  it("选择文档后本地抽取、自动分析，草稿填入文本框并展示问题清单", async () => {
    const { assistDocumentImport } = mount({
      assist: {
        markdown: ASSIST_MARKDOWN,
        model: "stub-model",
        issues: [
          {
            severity: "WARNING",
            line: 2,
            code: "MISSING_OWNER",
            message: "任务缺少负责人",
          },
        ],
      },
    });
    extractDocumentTextMock.mockResolvedValue({
      fileName: "需求文档.docx",
      text: "支付模块需要退款回调能力，负责人张三。",
      warning: null,
    });

    pickAssistFile(new File(["docx-bytes"], "需求文档.docx"));

    await waitFor(() =>
      expect(assistDocumentImport).toHaveBeenCalledWith({
        mode: "IN_PROJECT",
        text: "支付模块需要退款回调能力，负责人张三。",
      }),
    );
    expect(extractDocumentTextMock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(importTextarea().value).toBe(ASSIST_MARKDOWN));
    expect(
      screen.getByTestId("document-import-assist-source").textContent,
    ).toContain("需求文档.docx");
    expect(
      await screen.findByText("AI 草稿第 2 行：任务缺少负责人"),
    ).toBeTruthy();
    expect(
      screen.getByTestId("document-import-assist-result").textContent,
    ).toContain("stub-model");
  });

  it("整项目入口的分析请求使用 WHOLE_PROJECT 模式", async () => {
    const { assistDocumentImport } = mount({ mode: "NEW_PROJECT" });
    extractDocumentTextMock.mockResolvedValue({
      fileName: "需求.md",
      text: "整项目需求文本",
      warning: null,
    });

    pickAssistFile(new File(["x"], "需求.md"));

    await waitFor(() =>
      expect(assistDocumentImport).toHaveBeenCalledWith({
        mode: "WHOLE_PROJECT",
        text: "整项目需求文本",
      }),
    );
    await waitFor(() => expect(importTextarea().value).toBe(ASSIST_MARKDOWN));
  });

  it("文本框已有内容时先二次确认：取消不覆盖，确认才覆盖", async () => {
    mount();
    pasteDocument("已有内容");
    fireEvent.change(screen.getByLabelText("AI 分析原文"), {
      target: { value: "原始需求文本" },
    });
    fireEvent.click(screen.getByTestId("document-import-assist-run"));

    const overwriteDialog = await screen.findByRole("dialog", {
      name: /覆盖文本框当前内容/,
    });
    expect(importTextarea().value).toBe("已有内容");
    fireEvent.click(
      within(overwriteDialog).getByRole("button", { name: /取\s*消/ }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /覆盖文本框当前内容/ }),
      ).toBeNull(),
    );
    expect(importTextarea().value).toBe("已有内容");
    expect(screen.getByText(/已保留导入文本框中的原内容/)).toBeTruthy();

    fireEvent.click(screen.getByTestId("document-import-assist-run"));
    const secondDialog = await screen.findByRole("dialog", {
      name: /覆盖文本框当前内容/,
    });
    fireEvent.click(
      within(secondDialog).getByTestId("document-import-assist-overwrite"),
    );
    await waitFor(() => expect(importTextarea().value).toBe(ASSIST_MARKDOWN));
  });

  it("AI 未启用（503）时展示固定中文提示且入口不隐藏", async () => {
    const { assistDocumentImport } = mount({
      assistError: new ApiError(503, {
        code: "AI_ASSIST_DISABLED",
        message: "disabled",
        details: {},
        requestId: "test",
      }),
    });
    fireEvent.change(screen.getByLabelText("AI 分析原文"), {
      target: { value: "需求文本" },
    });
    fireEvent.click(screen.getByTestId("document-import-assist-run"));

    expect(
      await screen.findByText(
        "AI 辅助转换未启用或配置无效，请管理员在「成员与设置 → AI 辅助转换」中配置后重试。",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("document-import-assist")).toBeTruthy();
    expect(screen.getByTestId("document-import-assist-run")).toBeTruthy();
    expect(assistDocumentImport).toHaveBeenCalledTimes(1);
  });

  it("上游限流（503 + reason）时给出对应中文提示", async () => {
    mount({
      assistError: new ApiError(503, {
        code: "AI_ASSIST_UPSTREAM_FAILED",
        message: "upstream",
        details: { reason: "rate-limited" },
        requestId: "test",
      }),
    });
    fireEvent.change(screen.getByLabelText("AI 分析原文"), {
      target: { value: "需求文本" },
    });
    fireEvent.click(screen.getByTestId("document-import-assist-run"));

    expect(
      await screen.findByText("AI 服务请求过于频繁（上游限流），请稍后重试。"),
    ).toBeTruthy();
  });

  it("不支持的文档类型本地拒绝且不调分析接口", async () => {
    const { assistDocumentImport } = mount();
    extractDocumentTextMock.mockRejectedValue(
      new DocumentExtractionError("UNSUPPORTED_TYPE"),
    );

    pickAssistFile(new File(["old-doc"], "旧文档.doc"));

    expect(
      await screen.findByText(
        /仅支持 .txt、.md、.markdown、.docx 或 .pdf 文件/,
      ),
    ).toBeTruthy();
    expect(assistDocumentImport).not.toHaveBeenCalled();
    expect(importTextarea().value).toBe("");
  });

  it("AI 粘贴框为空时点击分析给出本地提示且不发请求", async () => {
    const { assistDocumentImport } = mount();
    fireEvent.click(screen.getByTestId("document-import-assist-run"));

    expect(
      await screen.findByText("请先粘贴要分析的内容，或选择文档后再分析。"),
    ).toBeTruthy();
    expect(assistDocumentImport).not.toHaveBeenCalled();
  });

  it("长文档抽取警告展示为非阻断提示并继续分析", async () => {
    const { assistDocumentImport } = mount();
    extractDocumentTextMock.mockResolvedValue({
      fileName: "长文档.md",
      text: "很长的需求文本",
      warning:
        "文档较长（超过 10 万字符），模型上下文可能不足以完整分析，建议精简或分段生成。",
    });

    pickAssistFile(new File(["x"], "长文档.md"));

    expect(
      await screen.findByText(
        "文档较长（超过 10 万字符），模型上下文可能不足以完整分析，建议精简或分段生成。",
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(assistDocumentImport).toHaveBeenCalledWith({
        mode: "IN_PROJECT",
        text: "很长的需求文本",
      }),
    );
  });

  it("普通成员看不到 AI 配置入口，管理员点击后跳到设置页 AI 页签", async () => {
    mount();
    expect(
      screen.queryByTestId("document-import-assist-settings"),
    ).not.toBeInTheDocument();
  });

  it("管理员点击「配置」跳到 /settings?tab=aiAssist", async () => {
    mount({ admin: true });
    fireEvent.click(screen.getByTestId("document-import-assist-settings"));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/settings?tab=aiAssist",
      ),
    );
  });
});
