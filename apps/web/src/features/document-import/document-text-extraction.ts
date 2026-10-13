/**
 * ADR-067 本地文档文本抽取（文件不离开浏览器，ADR-066 边界不变）。
 *
 * 支持三分支：'.txt' / '.md' / '.markdown' 直读；'.docx' 走 mammoth；
 * '.pdf' 走 pdfjs-dist + 同源 Web Worker 逐页抽取文本层；'.doc' / '.pptx' /
 * 图片等本地拒绝。mammoth 与 pdfjs-dist 都以动态 import 懒加载，只有用户实际
 * 选择对应文件时才会加载，不影响主包体积。
 *
 * 上限：文件 20 MiB（读取前拦截）；抽取结果与契约 text 上限一致为 200000
 * 字符（超出拒绝并提示精简）；超过 100000 字符返回非阻断提醒。
 */

import type { PDFDocumentProxy } from "pdfjs-dist";

export const DOCUMENT_EXTRACTION_FILE_MAX_BYTES = 20 * 1024 * 1024;
/** 与契约 DOCUMENT_IMPORT_MAX_TEXT_LENGTH（分析请求 text 上限）一致。 */
export const DOCUMENT_EXTRACTION_TEXT_MAX_LENGTH = 200_000;
export const DOCUMENT_EXTRACTION_LONG_TEXT_WARN_LENGTH = 100_000;

const SUPPORTED_EXTENSIONS = [
  ".txt",
  ".md",
  ".markdown",
  ".docx",
  ".pdf",
] as const;

/** 供 file input 的 accept 属性使用（扩展名 + 常见 MIME）。 */
export const DOCUMENT_EXTRACTION_ACCEPT = [
  ...SUPPORTED_EXTENSIONS,
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
].join(",");

export type DocumentExtractionErrorCode =
  | "UNSUPPORTED_TYPE"
  | "FILE_TOO_LARGE"
  | "READ_FAILED"
  | "DOCX_PARSE_FAILED"
  | "PDF_ENCRYPTED"
  | "PDF_PARSE_FAILED"
  | "EMPTY_TEXT"
  | "TEXT_TOO_LONG";

const EXTRACTION_ERROR_MESSAGES: Record<DocumentExtractionErrorCode, string> = {
  UNSUPPORTED_TYPE:
    "仅支持 .txt、.md、.markdown、.docx 或 .pdf 文件；.doc、.pptx 与图片请先转成受支持格式，或直接把内容粘贴到下方。",
  FILE_TOO_LARGE: "文件超过 20 MB 上限，请精简后重试或直接粘贴内容。",
  READ_FAILED: "文件读取失败，请重试或直接把内容粘贴到下方。",
  DOCX_PARSE_FAILED:
    "无法解析这个 Word 文档（可能已损坏），请另存为 .docx 后重试，或直接粘贴内容。",
  PDF_ENCRYPTED:
    "这个 PDF 有密码保护，无法本地读取；请先解除密码或直接粘贴内容。",
  PDF_PARSE_FAILED:
    "无法解析这个 PDF（可能已损坏或加密），请另存后重试或直接粘贴内容。",
  EMPTY_TEXT:
    "未提取到可用文本（可能是扫描件、加密文件或空文档），请直接粘贴内容或先转成文本。",
  TEXT_TOO_LONG: "文档超过 20 万字符上限，请精简或拆分成多份后再分析。",
};

export class DocumentExtractionError extends Error {
  readonly code: DocumentExtractionErrorCode;

  constructor(code: DocumentExtractionErrorCode) {
    super(EXTRACTION_ERROR_MESSAGES[code]);
    this.name = "DocumentExtractionError";
    this.code = code;
  }
}

export interface ExtractedDocumentText {
  readonly fileName: string;
  /** 已剔除 BOM、裁剪首尾空白的纯文本。 */
  readonly text: string;
  /** 非阻断提醒（超过 10 万字符）；null 表示无需提醒。 */
  readonly warning: string | null;
}

function fileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index < 0 ? "" : fileName.slice(index).toLowerCase();
}

export function isSupportedDocumentFileName(fileName: string): boolean {
  const extension = fileExtension(fileName);
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extension);
}

type MammothExtractRawText = (input: {
  arrayBuffer: ArrayBuffer;
}) => Promise<{ value: string }>;

async function readFileArrayBuffer(file: File): Promise<ArrayBuffer> {
  try {
    return await file.arrayBuffer();
  } catch {
    throw new DocumentExtractionError("READ_FAILED");
  }
}

async function readPlainText(file: File): Promise<string> {
  try {
    return await file.text();
  } catch {
    throw new DocumentExtractionError("READ_FAILED");
  }
}

/**
 * '.docx' 抽取：mammoth 以 CJS 发布（export =），打包器与 Node 环境下
 * 动态 import 的落点分别是 default 与模块命名空间本身，这里两者都兼容。
 */
async function extractDocxText(file: File): Promise<string> {
  const arrayBuffer = await readFileArrayBuffer(file);
  let mammothModule: unknown;
  try {
    mammothModule = await import("mammoth");
  } catch {
    throw new DocumentExtractionError("DOCX_PARSE_FAILED");
  }
  const mammoth = ((mammothModule as { default?: unknown }).default ??
    mammothModule) as { extractRawText?: MammothExtractRawText };
  if (typeof mammoth.extractRawText !== "function") {
    throw new DocumentExtractionError("DOCX_PARSE_FAILED");
  }
  try {
    const result = await mammoth.extractRawText({ arrayBuffer });
    return result.value;
  } catch {
    throw new DocumentExtractionError("DOCX_PARSE_FAILED");
  }
}

function isPdfPasswordError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ((error as { name?: unknown }).name === "PasswordException") return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && message.includes("No password given");
}

/**
 * '.pdf' 抽取：worker 资产用 '?url' 导入，pdf.js 以同源 module worker 加载
 * （CSP default-src 'self' 已覆盖 worker-src 回退，不需要放宽策略）。
 */
async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await readFileArrayBuffer(file);
  let pdfjs: typeof import("pdfjs-dist");
  let workerUrl: string;
  try {
    const [pdfjsModule, workerModule] = await Promise.all([
      import("pdfjs-dist"),
      import("pdfjs-dist/build/pdf.worker.mjs?url"),
    ]);
    pdfjs = pdfjsModule;
    workerUrl = workerModule.default;
  } catch {
    throw new DocumentExtractionError("PDF_PARSE_FAILED");
  }
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(arrayBuffer),
    useSystemFonts: false,
    // pdf.js 6.x 默认把 PostScript 函数编译为 WebAssembly（需要 CSP
    // 'wasm-unsafe-eval'）。ADR-021 不放宽 script-src，这里关闭 wasm 路径，
    // 回退到纯 JS 实现（文本抽取不使用 wasm）。
    useWasm: false,
  });
  let pdfDocument: PDFDocumentProxy;
  try {
    pdfDocument = await loadingTask.promise;
  } catch (error) {
    await loadingTask.destroy().catch(() => undefined);
    if (isPdfPasswordError(error)) {
      throw new DocumentExtractionError("PDF_ENCRYPTED");
    }
    throw new DocumentExtractionError("PDF_PARSE_FAILED");
  }
  try {
    const pageTexts: string[] = [];
    for (
      let pageNumber = 1;
      pageNumber <= pdfDocument.numPages;
      pageNumber += 1
    ) {
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      let pageText = "";
      for (const item of content.items) {
        if (!("str" in item)) continue;
        pageText += item.str;
        if (item.hasEOL) pageText += "\n";
      }
      pageTexts.push(pageText);
    }
    return pageTexts.join("\n\n");
  } catch {
    throw new DocumentExtractionError("PDF_PARSE_FAILED");
  } finally {
    // pdf.js 6.x：销毁统一走 loading task（同时释放文档与本次创建的 worker）。
    await loadingTask.destroy();
  }
}

function finalizeExtracted(
  fileName: string,
  raw: string,
): ExtractedDocumentText {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (text.length === 0) {
    throw new DocumentExtractionError("EMPTY_TEXT");
  }
  if (text.length > DOCUMENT_EXTRACTION_TEXT_MAX_LENGTH) {
    throw new DocumentExtractionError("TEXT_TOO_LONG");
  }
  const warning =
    text.length > DOCUMENT_EXTRACTION_LONG_TEXT_WARN_LENGTH
      ? "文档较长（超过 10 万字符），模型上下文可能不足以完整分析，建议精简或分段生成。"
      : null;
  return { fileName, text, warning };
}

/**
 * 把本地文件抽取为纯文本；失败时抛出携带固定中文提示的
 * DocumentExtractionError（调用方直接展示 error.message）。
 */
export async function extractDocumentText(
  file: File,
): Promise<ExtractedDocumentText> {
  if (!isSupportedDocumentFileName(file.name)) {
    throw new DocumentExtractionError("UNSUPPORTED_TYPE");
  }
  if (file.size > DOCUMENT_EXTRACTION_FILE_MAX_BYTES) {
    throw new DocumentExtractionError("FILE_TOO_LARGE");
  }
  const extension = fileExtension(file.name);
  let raw: string;
  if (extension === ".docx") {
    raw = await extractDocxText(file);
  } else if (extension === ".pdf") {
    raw = await extractPdfText(file);
  } else {
    raw = await readPlainText(file);
  }
  return finalizeExtracted(file.name, raw);
}
