import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Input } from "antd";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  DOCUMENT_IMPORT_TEMPLATE,
  type InpulseApiClient,
  type ProjectDocumentImportPreviewResponse,
  type ProjectDocumentImportResult,
} from "@generated/api";
import { useAuth } from "@features/auth/auth-context";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  describeDocumentImportAssistError,
  describeDocumentImportError,
  documentImportIssuesFromError,
  DOCUMENT_IMPORT_MAX_TEXT_LENGTH,
  useApplyDocumentImport,
  useAssistDocumentImport,
  usePreviewDocumentImport,
  type DocumentImportIssueView,
  type DocumentImportMode,
} from "./document-import-query";
import {
  DOCUMENT_EXTRACTION_ACCEPT,
  DocumentExtractionError,
  extractDocumentText,
  type ExtractedDocumentText,
} from "./document-text-extraction";

const ISSUE_DISPLAY_LIMIT = 20;

export function downloadDocumentImportTemplate(): void {
  // jsdom 没有 createObjectURL；测试环境直接跳过下载动作。
  if (typeof URL.createObjectURL !== "function") return;
  const blob = new Blob([DOCUMENT_IMPORT_TEMPLATE], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "inpulse-document-import-template.md";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

const DOCUMENT_IMPORT_FILE_EXTENSIONS = [".md", ".markdown", ".txt"] as const;
/** 文件字节上限：UTF-8 最坏 4 字节/字符，1 MiB 与 20 万字符正文上限配合做读取前第一道校验。 */
const DOCUMENT_IMPORT_MAX_FILE_BYTES = 1_048_576;

type Stage = "INPUT" | "PREVIEW";

export interface DocumentImportModalProps {
  readonly open: boolean;
  readonly mode: DocumentImportMode;
  readonly projectId?: number | undefined;
  readonly client?: InpulseApiClient | undefined;
  readonly onClose: () => void;
  readonly onImported: (result: ProjectDocumentImportResult) => void;
}

/**
 * ADR-064 固定模板导入（粘贴 / 本地文本文件 → 只读预览 → 单事务执行），
 * ADR-067 追加可选的 AI 辅助区块：选择文档（本地抽取，文件不上传）或粘贴
 * 原文 → 服务端生成模板草稿 → 填入文本框（已有内容先二次确认）→ 用户检查
 * 后仍走既有预览与确认导入。AI 草稿永不直接写库。
 */
export const DocumentImportModal: React.FC<DocumentImportModalProps> = ({
  open,
  mode,
  projectId,
  client,
  onClose,
  onImported,
}) => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canConfigureAiAssist = user?.isAdmin === true;
  const [stage, setStage] = useState<Stage>("INPUT");
  const [documentText, setDocumentText] = useState("");
  const [preview, setPreview] =
    useState<ProjectDocumentImportPreviewResponse | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  // ADR-067 AI 区状态：assistText 是用户粘贴的原文；选择文档抽取的文本单独持有，
  // 不入 assistText（避免覆盖用户输入）；生成成功后草稿填入 documentText。
  const [assistText, setAssistText] = useState("");
  const [assistSourceName, setAssistSourceName] = useState<string | null>(null);
  const [assistWarning, setAssistWarning] = useState<string | null>(null);
  const [assistNotice, setAssistNotice] = useState<string | null>(null);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [assistModel, setAssistModel] = useState<string | null>(null);
  const [assistIssues, setAssistIssues] = useState<
    readonly DocumentImportIssueView[]
  >([]);
  const [assistExtracting, setAssistExtracting] = useState(false);
  const [pendingOverwrite, setPendingOverwrite] = useState<string | null>(null);
  const previewMutation = usePreviewDocumentImport({ mode, projectId, client });
  const applyMutation = useApplyDocumentImport({ mode, projectId, client });
  const assistMutation = useAssistDocumentImport({ mode, client });

  useEffect(() => {
    if (!open) return;
    setStage("INPUT");
    setDocumentText("");
    setPreview(null);
    setLocalError(null);
    setFileName(null);
    setAssistText("");
    setAssistSourceName(null);
    setAssistWarning(null);
    setAssistNotice(null);
    setAssistError(null);
    setAssistModel(null);
    setAssistIssues([]);
    setAssistExtracting(false);
    setPendingOverwrite(null);
    previewMutation.reset();
    applyMutation.reset();
    assistMutation.reset();
  }, [open]);

  const issues: readonly DocumentImportIssueView[] = useMemo(() => {
    if (preview !== null) {
      return preview.issues;
    }
    return documentImportIssuesFromError(previewMutation.error);
  }, [preview, previewMutation.error]);
  const errorIssueCount = issues.filter(
    (issue) => issue.severity === "ERROR",
  ).length;
  const canApply =
    preview !== null && preview.canApply && errorIssueCount === 0;
  const busy = previewMutation.isPending || applyMutation.isPending;
  const assistBusy = assistExtracting || assistMutation.isPending;

  const fileInputRef = useRef<HTMLInputElement>(null);
  const assistFileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    // 允许连续两次选择同一个文件。
    event.currentTarget.value = "";
    if (file === undefined) return;
    const lowerName = file.name.toLowerCase();
    const supported = DOCUMENT_IMPORT_FILE_EXTENSIONS.some((extension) =>
      lowerName.endsWith(extension),
    );
    if (!supported) {
      setFileName(null);
      setLocalError("只支持 .md、.markdown 或 .txt 文本文件。");
      return;
    }
    if (file.size > DOCUMENT_IMPORT_MAX_FILE_BYTES) {
      setFileName(null);
      setLocalError("文件超过 1 MB 上限，请精简后重试。");
      return;
    }
    let text: string;
    try {
      // BOM 由后端规范化时剔除；前端先去掉，避免文本框首行出现不可见字符。
      text = (await file.text()).replace(/^\uFEFF/, "");
    } catch {
      setFileName(null);
      setLocalError("文件读取失败，请重试或直接把内容粘贴进来。");
      return;
    }
    if (text.length > DOCUMENT_IMPORT_MAX_TEXT_LENGTH) {
      setFileName(null);
      setLocalError("文件内容过长（超过 20 万字符），请精简后重试。");
      return;
    }
    setFileName(file.name);
    setDocumentText(text);
    setLocalError(null);
  };

  /** 草稿填入导入文本框：文本框已有内容时先弹确认，不静默覆盖。 */
  const applyAssistDraft = (markdown: string): void => {
    if (documentText.trim().length === 0) {
      setDocumentText(markdown);
      return;
    }
    setPendingOverwrite(markdown);
  };

  const startAssist = async (rawText: string): Promise<void> => {
    const trimmed = rawText.trim();
    if (trimmed.length === 0) {
      setAssistError("请先粘贴要分析的内容，或选择文档后再分析。");
      return;
    }
    setAssistError(null);
    setAssistNotice(null);
    setAssistIssues([]);
    setAssistModel(null);
    try {
      const result = await assistMutation.mutateAsync(trimmed);
      setAssistModel(result.model);
      setAssistIssues(result.issues);
      applyAssistDraft(result.markdown);
    } catch (error) {
      setAssistError(describeDocumentImportAssistError(error));
    }
  };

  const handleAssistFileSelected = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.currentTarget.files?.[0];
    // 允许连续两次选择同一个文件。
    event.currentTarget.value = "";
    if (file === undefined) return;
    setAssistError(null);
    setAssistNotice(null);
    setAssistExtracting(true);
    let extracted: ExtractedDocumentText;
    try {
      extracted = await extractDocumentText(file);
    } catch (error) {
      setAssistExtracting(false);
      setAssistSourceName(null);
      setAssistWarning(null);
      setAssistError(
        error instanceof DocumentExtractionError
          ? error.message
          : "文件读取失败，请重试或直接把内容粘贴进来。",
      );
      return;
    }
    setAssistExtracting(false);
    setAssistSourceName(extracted.fileName);
    setAssistWarning(extracted.warning);
    // ADR-067：选择文档抽取成功后自动分析一次；不自动重试。
    await startAssist(extracted.text);
  };

  const handleConfirmOverwrite = (): void => {
    if (pendingOverwrite === null) return;
    setDocumentText(pendingOverwrite);
    setPendingOverwrite(null);
    setAssistNotice(null);
  };

  const handleCancelOverwrite = (): void => {
    setPendingOverwrite(null);
    setAssistNotice(
      "已保留导入文本框中的原内容；如需使用这次 AI 草稿，请先清空文本框后重新分析。",
    );
  };

  const handlePreview = async () => {
    const trimmed = documentText.trim();
    if (trimmed.length === 0) {
      setLocalError("请粘贴内容或选择文件后再预览。");
      return;
    }
    setLocalError(null);
    try {
      const result = await previewMutation.mutateAsync(trimmed);
      setPreview(result);
      setStage("PREVIEW");
    } catch {
      // 422 的行级问题从错误明细里提取后展示；其它错误给通用提示。
      setPreview(null);
      setStage("PREVIEW");
    }
  };

  const handleApply = async () => {
    if (preview === null) return;
    try {
      const result = await applyMutation.mutateAsync({
        document: documentText.trim(),
        expectedDigest: preview.digest,
      });
      onImported(result);
    } catch (error) {
      // 错误由 applyMutation.error 渲染；摘要不一致时退回输入态重新预览。
      if (error instanceof ApiError && error.code === "DOCUMENT_IMPORT_STALE") {
        setPreview(null);
        setStage("INPUT");
      }
    }
  };

  const handleBack = () => {
    setStage("INPUT");
    setPreview(null);
    previewMutation.reset();
    applyMutation.reset();
  };

  const handleCancel = () => {
    if (!busy) {
      onClose();
    }
  };

  const summaryPanel =
    preview === null ? null : (
      <>
        <div className="import-summary" data-testid="document-import-summary">
          <p>
            计划创建模块 {preview.summary.moduleCreateCount} 个、功能{" "}
            {preview.summary.featureCreateCount} 个、任务{" "}
            {preview.summary.taskCreateCount} 个；复用模块{" "}
            {preview.summary.moduleReuseCount} 个、功能{" "}
            {preview.summary.featureReuseCount} 个。
          </p>
          {preview.project !== null ? (
            <p>
              项目：{preview.project.name}（{preview.project.code}）
              {preview.project.codeAvailable ? "，编码可用" : "，编码已被占用"}
              ；将自动加入 {preview.summary.memberAddCount}{" "}
              位成员（含任务负责人）。
            </p>
          ) : null}
        </div>
        {preview.duplicate !== null ? (
          <Alert
            showIcon
            type="error"
            title={
              "这份文档已经导入过：项目 " +
              String(preview.duplicate.projectId) +
              "，操作人 " +
              preview.duplicate.actorName
            }
          />
        ) : null}
        {preview.modules.length > 0 ? (
          <ul className="import-plan-list">
            {preview.modules.map((module) => (
              <li key={"module-" + module.line}>
                {module.action === "REUSE" ? "复用模块" : "新建模块"}：
                {module.name}
              </li>
            ))}
          </ul>
        ) : null}
        {preview.features.length > 0 ? (
          <ul className="import-plan-list">
            {preview.features.map((feature) => (
              <li key={"feature-" + feature.line}>
                {feature.action === "REUSE" ? "复用功能" : "新建功能"}：
                {feature.moduleName} / {feature.name}
              </li>
            ))}
          </ul>
        ) : null}
        {preview.tasks.length > 0 ? (
          <ul className="import-plan-list">
            {preview.tasks.map((task) => (
              <li key={"task-" + task.line}>
                {task.scope === "FEATURE" ? "功能级任务" : "模块级任务"}：
                {task.title}
                （负责人：
                {task.assignees.map((item) => item.name).join("、")}）
              </li>
            ))}
          </ul>
        ) : null}
        {!canApply && errorIssueCount === 0 ? (
          <Alert
            showIcon
            type="warning"
            title={
              preview.duplicate !== null
                ? "该文档已导入过，不能重复导入。"
                : "当前计划不可执行：项目编码已被占用，请修改文档后重新预览。"
            }
          />
        ) : null}
      </>
    );

  const issuesPanel =
    issues.length > 0 ? (
      <div data-testid="document-import-issues">
        {issues.slice(0, ISSUE_DISPLAY_LIMIT).map((issue, index) => (
          <Alert
            key={index}
            showIcon
            type={issue.severity === "ERROR" ? "error" : "warning"}
            title={"第 " + String(issue.line) + " 行：" + issue.message}
          />
        ))}
        {issues.length > ISSUE_DISPLAY_LIMIT ? (
          <p>还有 {issues.length - ISSUE_DISPLAY_LIMIT} 条问题未显示。</p>
        ) : null}
      </div>
    ) : null;

  const errorMessage =
    localError ??
    (applyMutation.isError
      ? describeDocumentImportError(applyMutation.error)
      : previewMutation.isError
        ? describeDocumentImportError(previewMutation.error)
        : null);
  return (
    <>
      <Modal
        className="catalog-modal"
        size="lg"
        title={
          mode === "NEW_PROJECT" ? "从文档导入整项目" : "从文档导入模块与功能"
        }
        destroyOnHidden
        mask={{ closable: false }}
        open={open}
        onCancel={handleCancel}
        footer={
          stage === "INPUT" ? (
            <>
              <Button disabled={busy} onClick={handleCancel}>
                取消
              </Button>
              <Button
                type="primary"
                loading={previewMutation.isPending}
                disabled={busy || assistBusy}
                onClick={() => void handlePreview()}
              >
                预览
              </Button>
            </>
          ) : (
            <>
              <Button disabled={busy} onClick={handleBack}>
                返回修改
              </Button>
              <Button
                type="primary"
                data-testid="document-import-apply"
                disabled={!canApply}
                loading={applyMutation.isPending}
                onClick={() => void handleApply()}
              >
                确认导入
              </Button>
            </>
          )
        }
      >
        <div className="dialog-form">
          {errorMessage !== null ? (
            <div data-testid="document-import-error">
              <Alert showIcon type="error" title={errorMessage} />
            </div>
          ) : null}
          {stage === "INPUT" ? (
            <>
              <p>
                粘贴固定模板文档后先预览；预览只读、不写入任何数据，确认后才会在单个事务内创建。
                负责人会自动加入项目成员，模块与功能按名称精确匹配复用、不覆盖现有内容。
              </p>
              <div
                className="import-assist-panel"
                data-testid="document-import-assist"
              >
                <div className="import-assist-title">
                  <span>AI 辅助（可选）：把你自己的项目文档转成模板草稿</span>
                  {canConfigureAiAssist ? (
                    <Button
                      type="link"
                      size="small"
                      data-testid="document-import-assist-settings"
                      onClick={() => navigate("/settings?tab=aiAssist")}
                    >
                      配置
                    </Button>
                  ) : null}
                </div>
                <p className="import-assist-note">
                  文件只在浏览器本地抽取文本、不会上传原文件；抽取后的文本将经服务端发送到管理员配置的
                  AI 服务用于生成草稿，请勿包含敏感信息。AI
                  只生成草稿，仍需检查并预览确认后才写入。
                </p>
                <Input.TextArea
                  aria-label="AI 分析原文"
                  value={assistText}
                  rows={4}
                  disabled={assistBusy}
                  placeholder={
                    "把需求文档、方案或排期粘贴到这里（不需要符合固定模板），然后点「开始分析」"
                  }
                  onChange={(event) => {
                    setAssistText(event.currentTarget.value);
                    setAssistError(null);
                  }}
                />
                <div className="calm-section-actions">
                  <Button
                    type="primary"
                    data-testid="document-import-assist-run"
                    loading={assistBusy}
                    disabled={busy}
                    onClick={() => void startAssist(assistText)}
                  >
                    开始分析
                  </Button>
                  <Button
                    data-testid="document-import-assist-file"
                    disabled={busy || assistBusy}
                    onClick={() => assistFileInputRef.current?.click()}
                  >
                    <InpulseIcon name="upload" size={15} />
                    选择文档并分析
                  </Button>
                </div>
                <p className="import-file-hint">
                  支持 .txt、.md、.markdown、.docx、.pdf（单文件不超过 20
                  MB；扫描件、.doc、.pptx 请直接粘贴内容）。
                </p>
                {assistSourceName !== null ? (
                  <p
                    className="import-file-hint"
                    data-testid="document-import-assist-source"
                  >
                    已读取文件：{assistSourceName}
                  </p>
                ) : null}
                {assistWarning !== null ? (
                  <Alert showIcon type="warning" title={assistWarning} />
                ) : null}
                {assistNotice !== null ? (
                  <Alert showIcon type="info" title={assistNotice} />
                ) : null}
                {assistError !== null ? (
                  <div data-testid="document-import-assist-error">
                    <Alert showIcon type="error" title={assistError} />
                  </div>
                ) : null}
              </div>
              <div
                className="import-format-guide"
                data-testid="document-import-format-guide"
              >
                <p className="import-format-guide-title">格式速查</p>
                <ul>
                  <li>
                    标题：<code># 项目：名称</code> → <code>## 模块：名称</code>{" "}
                    → <code>### 功能：名称</code> → <code>#### 任务：标题</code>
                  </li>
                  <li>
                    字段行：<code>- 字段名：值</code>；以 <code>&gt;</code>{" "}
                    开头的说明行会被忽略（可以保留）
                  </li>
                  <li>
                    必填：整项目导入的<strong>项目编码</strong>
                    （大写字母开头）与每个任务的
                    <strong>负责人</strong>（写登录名或姓名）
                  </li>
                  <li>
                    任务字段：<code>负责人</code>、<code>优先级</code>
                    （普通/高/紧急）、
                    <code>截止</code>（YYYY-MM-DD）、<code>描述</code>
                    ；模块级任务可写 <code>影响功能</code>
                  </li>
                  <li>直接粘贴带 ``` 围栏的整段文本也可以：围栏行会被忽略</li>
                </ul>
              </div>
              {assistModel !== null ? (
                <p
                  className="import-file-hint"
                  data-testid="document-import-assist-result"
                >
                  AI 草稿已就绪（模型：{assistModel}
                  ），请检查下方文本框内容后再预览。
                </p>
              ) : null}
              {assistIssues.length > 0 ? (
                <div data-testid="document-import-assist-issues">
                  {assistIssues
                    .slice(0, ISSUE_DISPLAY_LIMIT)
                    .map((issue, index) => (
                      <Alert
                        key={index}
                        showIcon
                        type={issue.severity === "ERROR" ? "error" : "warning"}
                        title={
                          "AI 草稿第 " +
                          String(issue.line) +
                          " 行：" +
                          issue.message
                        }
                      />
                    ))}
                  {assistIssues.length > ISSUE_DISPLAY_LIMIT ? (
                    <p>
                      还有 {assistIssues.length - ISSUE_DISPLAY_LIMIT}{" "}
                      条问题未显示。
                    </p>
                  ) : null}
                </div>
              ) : null}
              <Input.TextArea
                aria-label="导入文档内容"
                value={documentText}
                rows={14}
                maxLength={DOCUMENT_IMPORT_MAX_TEXT_LENGTH}
                placeholder={
                  "# 项目：商城系统\n- 项目编码：SHOP\n## 模块：支付"
                }
                disabled={busy}
                onChange={(event) => {
                  setDocumentText(event.currentTarget.value);
                  setLocalError(null);
                }}
              />
              {fileName !== null ? (
                <p
                  className="import-file-hint"
                  data-testid="document-import-file-hint"
                >
                  已读取文件：{fileName}，内容已填入上方，可编辑后预览。
                </p>
              ) : null}
              <div className="calm-section-actions">
                <Button
                  type="link"
                  disabled={busy || assistBusy}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <InpulseIcon name="upload" size={15} />
                  选择文件
                </Button>
                <Button
                  type="link"
                  onClick={downloadDocumentImportTemplate}
                  disabled={busy}
                >
                  <InpulseIcon name="fileText" size={15} />
                  下载模板
                </Button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,.txt,text/markdown,text/plain"
                aria-label="选择文档文件"
                hidden
                onChange={(event) => void handleFileSelected(event)}
              />
              <input
                ref={assistFileInputRef}
                type="file"
                accept={DOCUMENT_EXTRACTION_ACCEPT}
                aria-label="选择文档进行分析"
                hidden
                onChange={(event) => void handleAssistFileSelected(event)}
              />
            </>
          ) : (
            <>
              {summaryPanel}
              {issuesPanel}
            </>
          )}
        </div>
      </Modal>
      {/* 覆盖确认必须与主弹层平级：rc-dialog 会 memo 化 children，挂在子树内拿不到 open 更新。 */}
      <Modal
        className="catalog-modal"
        size="md"
        title="覆盖文本框当前内容？"
        tone="warning"
        icon="alert"
        destroyOnHidden
        open={pendingOverwrite !== null}
        onCancel={handleCancelOverwrite}
        footer={
          <>
            <Button onClick={handleCancelOverwrite}>取消</Button>
            <Button
              type="primary"
              data-testid="document-import-assist-overwrite"
              onClick={handleConfirmOverwrite}
            >
              覆盖
            </Button>
          </>
        }
      >
        <div className="dialog-form">
          <p>
            导入文本框已有内容，AI
            生成的草稿将替换当前内容；问题清单已在上一步列出。是否继续？
          </p>
        </div>
      </Modal>
    </>
  );
};

export default DocumentImportModal;
