import { beforeEach, describe, expect, it, vi } from "vitest";
import { extractRawText } from "mammoth";
import { GlobalWorkerOptions, getDocument } from "pdfjs-dist";
import {
  DOCUMENT_EXTRACTION_FILE_MAX_BYTES,
  extractDocumentText,
  isSupportedDocumentFileName,
} from "./document-text-extraction";

/**
 * ADR-067 本地抽取：txt/md 直读、docx（mammoth）、pdf（pdfjs-dist）三分支。
 * 两个解析依赖在此用 vi.mock 替换为桩（真实浏览器路径由 E2E 覆盖），
 * 断言分支选择、参数形状、长度/空文本边界与错误码映射。
 */
// mammoth 是 CJS（export =）：打包环境下动态 import 同时给出 default 与命名导出，
// 这里按同样形状提供两者（vitest 的 mock 命名空间访问未定义的 default 会直接抛错）。
vi.mock("mammoth", () => {
  const extractRawText = vi.fn();
  return { extractRawText, default: { extractRawText } };
});
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: vi.fn(),
}));
vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({
  default: "pdf-worker-url",
}));

const extractRawTextMock = vi.mocked(extractRawText);
const getDocumentMock = vi.mocked(getDocument);

interface FakeFileOptions {
  readonly size?: number;
  readonly text?: string;
  readonly buffer?: ArrayBuffer;
}

/** 不依赖 jsdom Blob 实现的最小 File 桩。 */
function fakeFile(name: string, options: FakeFileOptions = {}): File {
  return {
    name,
    size:
      options.size ?? options.text?.length ?? options.buffer?.byteLength ?? 0,
    text: () => Promise.resolve(options.text ?? ""),
    arrayBuffer: () => Promise.resolve(options.buffer ?? new ArrayBuffer(0)),
  } as unknown as File;
}

function pdfLoadingTask(document: unknown): ReturnType<typeof getDocument> {
  return {
    promise: Promise.resolve(document),
    destroy: vi.fn().mockResolvedValue(undefined),
  } as unknown as ReturnType<typeof getDocument>;
}

function simplePdfDocument(pages: readonly (readonly string[])[]) {
  return {
    numPages: pages.length,
    getPage: vi.fn(async (pageNumber: number) => ({
      getTextContent: async () => ({
        items: (pages[pageNumber - 1] ?? []).map((str) => ({
          str,
          hasEOL: false,
        })),
      }),
    })),
  };
}

beforeEach(() => {
  extractRawTextMock.mockReset();
  getDocumentMock.mockReset();
  GlobalWorkerOptions.workerSrc = "";
});

describe("扩展名与大小上限", () => {
  it("支持 .txt/.md/.markdown/.docx/.pdf，大小写不敏感", () => {
    for (const name of [
      "需求.txt",
      "需求.MD",
      "需求.Markdown",
      "方案.docx",
      "方案.PDF",
    ]) {
      expect(isSupportedDocumentFileName(name)).toBe(true);
    }
    for (const name of [
      "旧文档.doc",
      "演示.pptx",
      "图片.png",
      "无扩展名",
      "",
    ]) {
      expect(isSupportedDocumentFileName(name)).toBe(false);
    }
  });

  it("不支持的扩展名本地拒绝（.doc/.pptx 等）", async () => {
    await expect(
      extractDocumentText(fakeFile("旧文档.doc")),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    await expect(
      extractDocumentText(fakeFile("演示.pptx")),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_TYPE" });
    expect(extractRawTextMock).not.toHaveBeenCalled();
    expect(getDocumentMock).not.toHaveBeenCalled();
  });

  it("超过 20 MiB 的文件在读取前拒绝", async () => {
    const file = fakeFile("大文件.docx", {
      size: DOCUMENT_EXTRACTION_FILE_MAX_BYTES + 1,
    });
    await expect(extractDocumentText(file)).rejects.toMatchObject({
      code: "FILE_TOO_LARGE",
    });
    expect(extractRawTextMock).not.toHaveBeenCalled();
  });

  it("超过 20 万字符拒绝并提示精简", async () => {
    await expect(
      extractDocumentText(fakeFile("超长.md", { text: "字".repeat(200_001) })),
    ).rejects.toMatchObject({ code: "TEXT_TOO_LONG" });
  });

  it("超过 10 万字符给出非阻断提醒，恰为 10 万不提醒", async () => {
    const long = await extractDocumentText(
      fakeFile("长.md", { text: "字".repeat(100_001) }),
    );
    expect(long.warning).toContain("超过 10 万字符");
    const exact = await extractDocumentText(
      fakeFile("正好.md", { text: "字".repeat(100_000) }),
    );
    expect(exact.warning).toBeNull();
  });

  it("纯文本读取：剥离 BOM 并裁剪首尾空白", async () => {
    const result = await extractDocumentText(
      fakeFile("需求.md", { text: "\uFEFF  # 需求\n内容  " }),
    );
    expect(result).toEqual({
      fileName: "需求.md",
      text: "# 需求\n内容",
      warning: null,
    });
  });

  it("全空白文本判定为未提取到可用文本", async () => {
    await expect(
      extractDocumentText(fakeFile("空.md", { text: "   \n  " })),
    ).rejects.toMatchObject({ code: "EMPTY_TEXT" });
  });
});

describe("docx 分支（mammoth）", () => {
  it("把 ArrayBuffer 交给 extractRawText 并返回裁剪后的文本", async () => {
    extractRawTextMock.mockResolvedValue({
      value: " 段落一\n段落二 ",
      messages: [],
    });
    const buffer = new ArrayBuffer(16);
    const result = await extractDocumentText(
      fakeFile("方案.docx", { buffer, size: 16 }),
    );
    expect(extractRawTextMock).toHaveBeenCalledWith({ arrayBuffer: buffer });
    expect(result.text).toBe("段落一\n段落二");
  });

  it("解析失败映射为 DOCX_PARSE_FAILED", async () => {
    extractRawTextMock.mockRejectedValue(new Error("boom"));
    await expect(
      extractDocumentText(fakeFile("坏.docx", { buffer: new ArrayBuffer(8) })),
    ).rejects.toMatchObject({ code: "DOCX_PARSE_FAILED" });
  });

  it("抽取结果为空映射为 EMPTY_TEXT", async () => {
    extractRawTextMock.mockResolvedValue({ value: "   ", messages: [] });
    await expect(
      extractDocumentText(
        fakeFile("空文档.docx", { buffer: new ArrayBuffer(8) }),
      ),
    ).rejects.toMatchObject({ code: "EMPTY_TEXT" });
  });
});

describe("pdf 分支（pdfjs-dist + 同源 Worker）", () => {
  it("逐页抽取文本并拼接，workerSrc 指向 ?url 资产", async () => {
    getDocumentMock.mockReturnValue(
      pdfLoadingTask(simplePdfDocument([["第一页文本"], ["第二页文本"]])),
    );
    const result = await extractDocumentText(
      fakeFile("方案.pdf", { buffer: new ArrayBuffer(8) }),
    );
    expect(result.text).toBe("第一页文本\n\n第二页文本");
    expect(GlobalWorkerOptions.workerSrc).toBe("pdf-worker-url");
    expect(getDocumentMock).toHaveBeenCalledWith({
      data: expect.any(Uint8Array),
      useSystemFonts: false,
      useWasm: false,
    });
  });

  it("加密 PDF 映射为 PDF_ENCRYPTED 并销毁加载任务", async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    const error = Object.assign(new Error("No password given"), {
      name: "PasswordException",
    });
    getDocumentMock.mockReturnValue({
      promise: Promise.reject(error),
      destroy,
    } as unknown as ReturnType<typeof getDocument>);
    await expect(
      extractDocumentText(fakeFile("加密.pdf", { buffer: new ArrayBuffer(8) })),
    ).rejects.toMatchObject({ code: "PDF_ENCRYPTED" });
    expect(destroy).toHaveBeenCalled();
  });

  it("非加密解析失败映射为 PDF_PARSE_FAILED", async () => {
    getDocumentMock.mockReturnValue({
      promise: Promise.reject(new Error("Invalid PDF structure")),
      destroy: vi.fn().mockResolvedValue(undefined),
    } as unknown as ReturnType<typeof getDocument>);
    await expect(
      extractDocumentText(fakeFile("损坏.pdf", { buffer: new ArrayBuffer(8) })),
    ).rejects.toMatchObject({ code: "PDF_PARSE_FAILED" });
  });

  it("无可抽取文本（扫描件）映射为 EMPTY_TEXT", async () => {
    getDocumentMock.mockReturnValue(
      pdfLoadingTask(simplePdfDocument([[], []])),
    );
    await expect(
      extractDocumentText(
        fakeFile("扫描件.pdf", { buffer: new ArrayBuffer(8) }),
      ),
    ).rejects.toMatchObject({ code: "EMPTY_TEXT" });
  });
});
