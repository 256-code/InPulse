import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type InpulseApiClient,
  type ProjectDocumentImportPreviewResponse,
  type ProjectDocumentImportResult,
} from "@generated/api";
import {
  DOCUMENT_IMPORT_TEMPLATE,
  DocumentImportModal,
} from "./DocumentImportModal";

/**
 * ADR-064 文档导入弹窗：固定模板粘贴 → 只读预览 → 单事务执行。
 * jsdom 没有 createObjectURL，模板下载按钮不做行为断言。
 */
const DOCUMENT = "# 项目：商城系统\n- 项目编码：SHOP";

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

interface MountOptions {
  readonly preview?: ProjectDocumentImportPreviewResponse | undefined;
  readonly previewError?: unknown;
  readonly applyError?: unknown;
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
  const issueCsrfToken = vi
    .fn()
    .mockResolvedValue({ csrfToken: "a".repeat(43) });
  const client = {
    issueCsrfToken,
    previewProjectDocumentImport,
    importProjectDocument,
  } as unknown as InpulseApiClient;
  const onImported = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter>
          <DocumentImportModal
            open
            mode="PROJECT"
            projectId={2}
            client={client}
            onClose={onClose}
            onImported={onImported}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </ConfigProvider>,
  );
  return {
    client,
    onImported,
    onClose,
    importProjectDocument,
    previewProjectDocumentImport,
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

async function pasteAndPreview(document: string = DOCUMENT) {
  pasteDocument(document);
  fireEvent.click(screen.getByRole("button", { name: /预\s*览/ }));
  await screen.findByTestId("document-import-summary");
}

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
