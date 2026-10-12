import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Input } from "antd";
import {
  ApiError,
  type InpulseApiClient,
  type ProjectDocumentImportPreviewResponse,
  type ProjectDocumentImportResult,
} from "@generated/api";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  describeDocumentImportError,
  documentImportIssuesFromError,
  DOCUMENT_IMPORT_MAX_TEXT_LENGTH,
  useApplyDocumentImport,
  usePreviewDocumentImport,
  type DocumentImportIssueView,
  type DocumentImportMode,
} from "./document-import-query";

/**
 * 固定模板示例（ADR-064 语法 + ADR-065 说明行）；「下载模板」输出的就是这份文本。
 * 顶部以 > 开头的说明行会被解析器忽略，方便把格式规则与模板放在同一个文件里，
 * 也方便直接粘贴其它工具（含 AI）按此模板填写后的整段输出。
 */
export const DOCUMENT_IMPORT_TEMPLATE = [
  "> InPulse 文档导入模板（模板版本 1）",
  "> 填写说明：以下以 > 开头的行是说明行，导入时会被忽略，可以保留、也可以删除。",
  "> 1. 只认识三类行：",
  ">    - 标题行：# 项目：名称 / ## 模块：名称 / ### 功能：名称 / #### 任务：标题",
  ">    - 字段行：- 字段名：值（必须以 - 开头；冒号用全角「：」或半角「:」都可以）",
  ">    - 说明行（以 > 开头）与代码围栏行（``` 或 ~~~）会被忽略，不会导入",
  "> 2. 字段名必须与下面完全一致，不要自创、不要改名：",
  ">    项目段：- 项目编码（整项目导入时必填；大写字母开头，只用大写字母、数字、下划线，2-32 位）",
  ">            - 项目说明；- 初始成员（逗号分隔，写登录名或姓名）",
  ">    模块段：- 说明",
  ">    功能段：- 当前说明；- 验收标准；- 标签（逗号分隔）",
  ">    任务段：- 负责人（必填，逗号分隔，写登录名或姓名）",
  ">            - 优先级（普通 / 高 / 紧急，或 NORMAL / HIGH / URGENT；不填为普通）",
  ">            - 截止（必须 YYYY-MM-DD，例如 2026-12-31）；- 描述",
  ">            - 影响功能（只有模块级任务 ### 任务 可以写，逗号分隔）",
  "> 3. 层级：任务放在「#### 任务」下，或作为「### 任务」模块级任务；不要跳级、不要错位。",
  "> 4. 范围：从项目列表「从文档导入整项目」导入时，文档必须包含「# 项目」段；",
  ">    从模块页「从文档导入」导入已有项目时，不要写「# 项目」段。",
  "> 5. 负责人必须是系统里已有的用户（写登录名或姓名）；整项目导入时他们会自动加入项目成员。",
  "> 6. 没填的可选字段会按默认值处理；不要把示例放进代码块（围栏内的正文也会被解析）。",
  ">",
  "> 下面是示例结构，请把示例文字替换成你的真实内容（结构保留）：",
  "",
  "# 项目：商城系统",
  "- 项目编码：SHOP",
  "- 项目说明：一句话说明项目目标与范围",
  "- 初始成员：zhangsan, lisi",
  "",
  "## 模块：支付",
  "- 说明：支付与退款能力",
  "",
  "### 功能：微信支付退款回调",
  "- 当前说明：现在如何处理回调",
  "- 验收标准：处理完成后应满足的条件",
  "- 标签：支付, 重要",
  "",
  "#### 任务：修复重复回调",
  "- 负责人：zhangsan",
  "- 优先级：高",
  "- 截止：2026-12-31",
  "- 描述：问题背景与期望结果",
  "",
  "### 任务：模块级任务示例",
  "- 负责人：lisi",
  "- 影响功能：微信支付退款回调",
].join("\n");

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

export const DocumentImportModal: React.FC<DocumentImportModalProps> = ({
  open,
  mode,
  projectId,
  client,
  onClose,
  onImported,
}) => {
  const [stage, setStage] = useState<Stage>("INPUT");
  const [documentText, setDocumentText] = useState("");
  const [preview, setPreview] =
    useState<ProjectDocumentImportPreviewResponse | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const previewMutation = usePreviewDocumentImport({ mode, projectId, client });
  const applyMutation = useApplyDocumentImport({ mode, projectId, client });

  useEffect(() => {
    if (!open) return;
    setStage("INPUT");
    setDocumentText("");
    setPreview(null);
    setLocalError(null);
    setFileName(null);
    previewMutation.reset();
    applyMutation.reset();
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

  const fileInputRef = useRef<HTMLInputElement>(null);

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
              className="import-format-guide"
              data-testid="document-import-format-guide"
            >
              <p className="import-format-guide-title">格式速查</p>
              <ul>
                <li>
                  标题：<code># 项目：名称</code> → <code>## 模块：名称</code> →{" "}
                  <code>### 功能：名称</code> → <code>#### 任务：标题</code>
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
            <Input.TextArea
              aria-label="导入文档内容"
              value={documentText}
              rows={14}
              maxLength={DOCUMENT_IMPORT_MAX_TEXT_LENGTH}
              placeholder={"# 项目：商城系统\n- 项目编码：SHOP\n## 模块：支付"}
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
                disabled={busy}
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
          </>
        ) : (
          <>
            {summaryPanel}
            {issuesPanel}
          </>
        )}
      </div>
    </Modal>
  );
};

export default DocumentImportModal;
