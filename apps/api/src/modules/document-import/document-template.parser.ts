import { createHash } from "node:crypto";

import {
  DOCUMENT_IMPORT_MAX_FEATURES,
  DOCUMENT_IMPORT_MAX_MODULES,
  DOCUMENT_IMPORT_MAX_TASKS,
  DOCUMENT_IMPORT_MAX_TOTAL_ENTITIES,
  type DocumentImportIssue,
} from "@inpulse/api-contract";

/**
 * ADR-064 固定模板解析器（纯函数，无数据库访问）。
 *
 * 语法（每行一个语义单元，空行忽略）：
 *   # 项目：商城系统
 *   - 项目编码：SHOP
 *   - 项目说明：……
 *   - 初始成员：wangwu, zhaoliu
 *   ## 模块：支付
 *   - 说明：……
 *   ### 功能：微信支付退款回调
 *   - 当前说明：…… / - 验收标准：…… / - 标签：a, b
 *   #### 任务：修复重复回调
 *   - 负责人：zhangsan, 张三 / - 优先级：高 / - 截止：2026-10-30 / - 描述：……
 *   ### 任务：升级 SDK
 *   - 影响功能：微信支付退款回调
 *
 * 语义校验（负责人解析、模块/功能复用、重复导入、编码占用）不在本文件，
 * 由 Workflow 在事务内完成；本文件只输出语法与文档内一致性级别的问题。
 */

export type ParsedTaskPriority = "NORMAL" | "HIGH" | "URGENT";
export type ParsedTaskScope = "FEATURE" | "MODULE";

export interface ParsedTask {
  readonly line: number;
  readonly scope: ParsedTaskScope;
  readonly title: string;
  readonly assigneeTokens: readonly string[];
  readonly priority: ParsedTaskPriority;
  readonly dueAt: string | null;
  readonly description: string;
  readonly impactFeatureNames: readonly string[];
}

export interface ParsedFeature {
  readonly line: number;
  readonly name: string;
  readonly currentBehavior: string;
  readonly acceptanceCriteria: string | null;
  readonly tags: readonly string[];
  readonly tasks: readonly ParsedTask[];
}

export interface ParsedModule {
  readonly line: number;
  readonly name: string;
  readonly description: string;
  readonly features: readonly ParsedFeature[];
  readonly tasks: readonly ParsedTask[];
}

export interface ParsedProjectSection {
  readonly line: number;
  readonly name: string;
  readonly code: string | null;
  readonly description: string;
  readonly memberTokens: readonly string[];
}

export interface ParsedDocument {
  readonly digest: string;
  readonly project: ParsedProjectSection | null;
  readonly modules: readonly ParsedModule[];
  readonly issues: readonly DocumentImportIssue[];
}

export const DOCUMENT_IMPORT_NAME_MAX = 200;
export const DOCUMENT_IMPORT_FEATURE_NAME_MAX = 500;
export const DOCUMENT_IMPORT_TASK_TITLE_MAX = 500;
export const DOCUMENT_IMPORT_DESCRIPTION_MAX = 20_000;
export const DOCUMENT_IMPORT_FEATURE_TEXT_MAX = 50_000;
export const DOCUMENT_IMPORT_TASK_DESCRIPTION_MAX = 50_000;
export const DOCUMENT_IMPORT_MAX_TAGS = 50;
export const DOCUMENT_IMPORT_MAX_ASSIGNEES_PER_TASK = 20;
export const DOCUMENT_IMPORT_MAX_MEMBER_TOKEN_LENGTH = 200;
const PROJECT_CODE_RE = /^[A-Z][A-Z0-9_]{1,31}$/;
const DUE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const FIELD_RE = /^[-*]\s+(.*)$/;
const FIELD_SPLIT_RE = /^([^：:\n]{1,50})[：:]\s*([\s\S]*)$/;

/** 摘要口径固定为「去 BOM、CRLF→LF」后的 UTF-8 文本（ADR-064，与迁移注释一致）。 */
export function normalizeDocumentText(text: string): string {
  return text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}

export function documentDigest(text: string): string {
  return createHash("sha256")
    .update(normalizeDocumentText(text), "utf8")
    .digest("hex");
}

/** 文档内名称/令牌的规范化比较口径：trim + 小写（模块名唯一索引同口径）。 */
export function normalizeDocumentName(value: string): string {
  return value.trim().toLowerCase();
}

function splitTokens(value: string): string[] {
  return value
    .split(/[,，、]/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function clamps(
  value: string,
  max: number,
): { text: string; overflow: boolean } {
  if (value.length <= max) {
    return { text: value, overflow: false };
  }
  return { text: value.slice(0, max), overflow: true };
}

const PRIORITY_ALIASES: Readonly<Record<string, ParsedTaskPriority>> = {
  普通: "NORMAL",
  高: "HIGH",
  紧急: "URGENT",
  normal: "NORMAL",
  high: "HIGH",
  urgent: "URGENT",
};

function parsePriority(
  value: string,
): { priority: ParsedTaskPriority } | undefined {
  const mapped = PRIORITY_ALIASES[value.trim().toLowerCase()];
  return mapped === undefined ? undefined : { priority: mapped };
}

function parseDueDate(value: string): { dueAt: string } | undefined {
  if (!DUE_DATE_RE.test(value)) {
    return undefined;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return undefined;
  }
  // 截止日按北京时间当日 23:59:59 落库，输出 UTC ISO 供契约与后续写入复用。
  return { dueAt: new Date(value + "T23:59:59+08:00").toISOString() };
}
type ContextKind = "project" | "module" | "feature" | "task";
type AddIssue = (
  severity: "ERROR" | "WARNING",
  line: number,
  code: string,
  message: string,
) => void;

interface TaskBuilder {
  line: number;
  scope: ParsedTaskScope;
  title: string;
  assigneeTokens: string[];
  priority: ParsedTaskPriority;
  dueAt: string | null;
  description: string;
  impactFeatureNames: string[];
  seen: Set<string>;
}

interface FeatureBuilder {
  line: number;
  name: string;
  currentBehavior: string;
  acceptanceCriteria: string | null;
  tags: string[];
  tasks: TaskBuilder[];
  seen: Set<string>;
}

interface ModuleBuilder {
  line: number;
  name: string;
  description: string;
  features: FeatureBuilder[];
  tasks: TaskBuilder[];
  seen: Set<string>;
}

interface ProjectBuilder {
  line: number;
  name: string;
  code: string | null;
  description: string;
  memberTokens: string[];
  seen: Set<string>;
}

function parseTokenList(
  rawValue: string,
  line: number,
  label: string,
  addIssue: AddIssue,
): string[] {
  const tokens = splitTokens(rawValue);
  const seen = new Set<string>();
  const result: string[] = [];
  for (const token of tokens) {
    if (token.length > DOCUMENT_IMPORT_MAX_MEMBER_TOKEN_LENGTH) {
      addIssue(
        "ERROR",
        line,
        "MEMBER_TOKEN_TOO_LONG",
        label +
          "「" +
          token.slice(0, 30) +
          "…」超过 " +
          String(DOCUMENT_IMPORT_MAX_MEMBER_TOKEN_LENGTH) +
          " 字符",
      );
      continue;
    }
    const key = normalizeDocumentName(token);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(token);
  }
  return result;
}

function parseTagList(
  rawValue: string,
  line: number,
  addIssue: AddIssue,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of splitTokens(rawValue)) {
    const key = tag.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(tag);
  }
  if (result.length > DOCUMENT_IMPORT_MAX_TAGS) {
    addIssue(
      "ERROR",
      line,
      "TAG_LIMIT_EXCEEDED",
      "单个功能的标签最多 " + String(DOCUMENT_IMPORT_MAX_TAGS) + " 个",
    );
  }
  return result.slice(0, DOCUMENT_IMPORT_MAX_TAGS);
}

function applyText(
  rawValue: string,
  max: number,
  line: number,
  label: string,
  addIssue: AddIssue,
): string {
  const clamped = clamps(rawValue, max);
  if (clamped.overflow) {
    addIssue(
      "ERROR",
      line,
      "FIELD_TOO_LONG",
      label + "超过 " + String(max) + " 字符，超出部分已截断",
    );
  }
  return clamped.text;
}

function handleField(input: {
  readonly context: ContextKind | null;
  readonly project: ProjectBuilder | null;
  readonly module: ModuleBuilder | null;
  readonly feature: FeatureBuilder | null;
  readonly task: TaskBuilder | null;
  readonly fieldName: string;
  readonly rawValue: string;
  readonly line: number;
  readonly addIssue: AddIssue;
}): void {
  const { context, fieldName, rawValue, line, addIssue } = input;
  if (context === null) {
    addIssue(
      "ERROR",
      line,
      "FIELD_OUTSIDE_SECTION",
      "字段行必须位于某个段落之内",
    );
    return;
  }
  const builder =
    context === "project"
      ? input.project
      : context === "module"
        ? input.module
        : context === "feature"
          ? input.feature
          : input.task;
  if (builder === null) {
    addIssue(
      "ERROR",
      line,
      "FIELD_OUTSIDE_SECTION",
      "字段行必须位于某个段落之内",
    );
    return;
  }
  if (builder.seen.has(fieldName)) {
    addIssue(
      "ERROR",
      line,
      "DUPLICATE_FIELD",
      "字段「" + fieldName + "」在当前段落内重复，请只保留一处",
    );
    return;
  }
  builder.seen.add(fieldName);

  if (context === "project") {
    const project = input.project!;
    if (fieldName === "项目编码") {
      if (rawValue === "") {
        return;
      }
      if (!PROJECT_CODE_RE.test(rawValue)) {
        addIssue(
          "ERROR",
          line,
          "PROJECT_CODE_INVALID",
          "项目编码必须以大写字母开头、仅含大写字母/数字/下划线，长度 2～32（如 SHOP）",
        );
        return;
      }
      project.code = rawValue;
      return;
    }
    if (fieldName === "项目说明") {
      project.description = applyText(
        rawValue,
        DOCUMENT_IMPORT_DESCRIPTION_MAX,
        line,
        "项目说明",
        addIssue,
      );
      return;
    }
    if (fieldName === "初始成员") {
      project.memberTokens = parseTokenList(
        rawValue,
        line,
        "初始成员",
        addIssue,
      );
      return;
    }
    addIssue(
      "ERROR",
      line,
      "UNKNOWN_FIELD",
      "项目段不支持字段「" + fieldName + "」",
    );
    return;
  }

  if (context === "module") {
    if (fieldName === "说明") {
      input.module!.description = applyText(
        rawValue,
        DOCUMENT_IMPORT_DESCRIPTION_MAX,
        line,
        "模块说明",
        addIssue,
      );
      return;
    }
    addIssue(
      "ERROR",
      line,
      "UNKNOWN_FIELD",
      "模块段不支持字段「" + fieldName + "」",
    );
    return;
  }

  if (context === "feature") {
    const feature = input.feature!;
    if (fieldName === "当前说明") {
      feature.currentBehavior = applyText(
        rawValue,
        DOCUMENT_IMPORT_FEATURE_TEXT_MAX,
        line,
        "当前说明",
        addIssue,
      );
      return;
    }
    if (fieldName === "验收标准") {
      feature.acceptanceCriteria =
        rawValue === ""
          ? null
          : applyText(
              rawValue,
              DOCUMENT_IMPORT_FEATURE_TEXT_MAX,
              line,
              "验收标准",
              addIssue,
            );
      return;
    }
    if (fieldName === "标签") {
      feature.tags = parseTagList(rawValue, line, addIssue);
      return;
    }
    addIssue(
      "ERROR",
      line,
      "UNKNOWN_FIELD",
      "功能段不支持字段「" + fieldName + "」",
    );
    return;
  }

  const task = input.task!;
  if (fieldName === "负责人") {
    const tokens = parseTokenList(rawValue, line, "负责人", addIssue);
    if (tokens.length > DOCUMENT_IMPORT_MAX_ASSIGNEES_PER_TASK) {
      addIssue(
        "ERROR",
        line,
        "ASSIGNEE_LIMIT_EXCEEDED",
        "单个任务的负责人最多 " +
          String(DOCUMENT_IMPORT_MAX_ASSIGNEES_PER_TASK) +
          " 人",
      );
    }
    task.assigneeTokens = tokens.slice(
      0,
      DOCUMENT_IMPORT_MAX_ASSIGNEES_PER_TASK,
    );
    return;
  }
  if (fieldName === "优先级") {
    if (rawValue === "") {
      return;
    }
    const parsed = parsePriority(rawValue);
    if (parsed === undefined) {
      addIssue(
        "ERROR",
        line,
        "PRIORITY_INVALID",
        "优先级只支持 普通 / 高 / 紧急（或 NORMAL / HIGH / URGENT）",
      );
      return;
    }
    task.priority = parsed.priority;
    return;
  }
  if (fieldName === "截止") {
    if (rawValue === "") {
      return;
    }
    const parsed = parseDueDate(rawValue);
    if (parsed === undefined) {
      addIssue(
        "ERROR",
        line,
        "DUE_DATE_INVALID",
        "截止日期必须为有效日期，格式 YYYY-MM-DD（如 2026-10-30）",
      );
      return;
    }
    task.dueAt = parsed.dueAt;
    return;
  }
  if (fieldName === "描述") {
    task.description = applyText(
      rawValue,
      DOCUMENT_IMPORT_TASK_DESCRIPTION_MAX,
      line,
      "任务描述",
      addIssue,
    );
    return;
  }
  if (fieldName === "影响功能") {
    if (task.scope !== "MODULE") {
      addIssue(
        "ERROR",
        line,
        "UNKNOWN_FIELD",
        "功能级任务不支持「影响功能」；影响关系只用于模块级任务",
      );
      return;
    }
    const names = splitTokens(rawValue).map((name) => {
      const clamped = clamps(name, DOCUMENT_IMPORT_FEATURE_NAME_MAX);
      if (clamped.overflow) {
        addIssue(
          "ERROR",
          line,
          "FIELD_TOO_LONG",
          "影响功能名称超过 " +
            String(DOCUMENT_IMPORT_FEATURE_NAME_MAX) +
            " 字符，超出部分已截断",
        );
      }
      return clamped.text;
    });
    const seen = new Set<string>();
    task.impactFeatureNames = names.filter((name) => {
      const key = normalizeDocumentName(name);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    return;
  }
  addIssue(
    "ERROR",
    line,
    "UNKNOWN_FIELD",
    "任务段不支持字段「" + fieldName + "」",
  );
}
export function parseDocumentTemplate(text: string): ParsedDocument {
  const digest = documentDigest(text);
  const normalized = normalizeDocumentText(text);
  const issues: DocumentImportIssue[] = [];
  const addIssue: AddIssue = (severity, line, code, message) => {
    issues.push({ severity, line, code, message });
  };
  const addError = (line: number, code: string, message: string): void => {
    addIssue("ERROR", line, code, message);
  };

  let project: ProjectBuilder | null = null;
  let modules: ModuleBuilder[] = [];
  let currentModule: ModuleBuilder | null = null;
  let currentFeature: FeatureBuilder | null = null;
  let currentTask: TaskBuilder | null = null;
  let context: ContextKind | null = null;
  let sawModuleOrDeeper = false;
  let sawContent = false;

  const lines = normalized.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const lineNo = index + 1;
    const trimmed = (lines[index] ?? "").trim();
    if (trimmed === "") {
      continue;
    }
    // ADR-065：说明行（以 > 开头的引用块）与代码围栏行（``` 或 ~~~）被忽略，
    // 便于模板文件自包含填写说明，也便于直接粘贴其它工具（含 AI）输出的带围栏文本；
    // 它们不算文档内容，只有说明行 / 围栏行的文档仍按空文档处理。
    if (
      trimmed.startsWith(">") ||
      trimmed.startsWith("```") ||
      trimmed.startsWith("~~~")
    ) {
      continue;
    }
    sawContent = true;

    const heading = HEADING_RE.exec(trimmed);
    if (heading !== null) {
      const depth = (heading[1] ?? "").length;
      const rest = (heading[2] ?? "").trim();
      const parts = FIELD_SPLIT_RE.exec(rest);
      if (parts === null) {
        addError(
          lineNo,
          "HEADING_INVALID",
          "标题行必须为「# 类型：名称」格式（如 # 项目：商城系统）",
        );
        continue;
      }
      const kind = (parts[1] ?? "").trim();
      const rawName = (parts[2] ?? "").trim();
      if (depth >= 5) {
        addError(lineNo, "HEADING_TOO_DEEP", "标题层级最多到四级（#### 任务）");
        continue;
      }
      if (depth === 1) {
        if (kind !== "项目") {
          addError(
            lineNo,
            "HEADING_KIND_MISMATCH",
            "一级标题必须是「# 项目：名称」",
          );
          continue;
        }
        if (project !== null) {
          addError(lineNo, "DUPLICATE_PROJECT_SECTION", "项目段只能出现一次");
          continue;
        }
        if (sawModuleOrDeeper) {
          addError(
            lineNo,
            "PROJECT_SECTION_NOT_FIRST",
            "项目段必须位于文档最前面；项目内导入的文档不应包含项目段",
          );
        }
        if (rawName === "") {
          addError(lineNo, "TITLE_NAME_REQUIRED", "项目名称不能为空");
        }
        const name = clamps(
          rawName === "" ? "（未命名）" : rawName,
          DOCUMENT_IMPORT_NAME_MAX,
        );
        if (name.overflow) {
          addError(
            lineNo,
            "FIELD_TOO_LONG",
            "项目名称超过 " +
              String(DOCUMENT_IMPORT_NAME_MAX) +
              " 字符，超出部分已截断",
          );
        }
        project = {
          line: lineNo,
          name: name.text,
          code: null,
          description: "",
          memberTokens: [],
          seen: new Set(),
        };
        currentModule = null;
        currentFeature = null;
        currentTask = null;
        context = "project";
        continue;
      }
      if (depth === 2) {
        if (kind !== "模块") {
          addError(
            lineNo,
            "HEADING_KIND_MISMATCH",
            "二级标题必须是「## 模块：名称」",
          );
          continue;
        }
        sawModuleOrDeeper = true;
        currentFeature = null;
        currentTask = null;
        if (rawName === "") {
          addError(lineNo, "TITLE_NAME_REQUIRED", "模块名称不能为空");
        }
        const name = clamps(
          rawName === "" ? "（未命名）" : rawName,
          DOCUMENT_IMPORT_NAME_MAX,
        );
        if (name.overflow) {
          addError(
            lineNo,
            "FIELD_TOO_LONG",
            "模块名称超过 " +
              String(DOCUMENT_IMPORT_NAME_MAX) +
              " 字符，超出部分已截断",
          );
        }
        const normalizedName = normalizeDocumentName(name.text);
        const existing = modules.find(
          (module) => normalizeDocumentName(module.name) === normalizedName,
        );
        if (existing !== undefined) {
          addError(
            lineNo,
            "DUPLICATE_MODULE_NAME",
            "与第 " +
              String(existing.line) +
              " 行的模块重名；同一文档内模块名不能重复",
          );
        }
        currentModule = {
          line: lineNo,
          name: name.text,
          description: "",
          features: [],
          tasks: [],
          seen: new Set(),
        };
        modules.push(currentModule);
        context = "module";
        continue;
      }
      if (depth === 3) {
        if (kind === "功能") {
          if (currentModule === null) {
            addError(
              lineNo,
              "FEATURE_OUTSIDE_MODULE",
              "功能必须位于某个「## 模块」之内",
            );
            continue;
          }
          currentTask = null;
          if (rawName === "") {
            addError(lineNo, "TITLE_NAME_REQUIRED", "功能名称不能为空");
          }
          const name = clamps(
            rawName === "" ? "（未命名）" : rawName,
            DOCUMENT_IMPORT_FEATURE_NAME_MAX,
          );
          if (name.overflow) {
            addError(
              lineNo,
              "FIELD_TOO_LONG",
              "功能名称超过 " +
                String(DOCUMENT_IMPORT_FEATURE_NAME_MAX) +
                " 字符，超出部分已截断",
            );
          }
          const normalizedName = normalizeDocumentName(name.text);
          const existing = currentModule.features.find(
            (feature) => normalizeDocumentName(feature.name) === normalizedName,
          );
          if (existing !== undefined) {
            addError(
              lineNo,
              "DUPLICATE_FEATURE_NAME",
              "与第 " +
                String(existing.line) +
                " 行的功能在模块「" +
                currentModule.name +
                "」内重名；同一模块内功能名不能重复",
            );
          }
          currentFeature = {
            line: lineNo,
            name: name.text,
            currentBehavior: "",
            acceptanceCriteria: null,
            tags: [],
            tasks: [],
            seen: new Set(),
          };
          currentModule.features.push(currentFeature);
          context = "feature";
          continue;
        }
        if (kind === "任务") {
          if (currentModule === null) {
            addError(
              lineNo,
              "TASK_OUTSIDE_MODULE",
              "模块级任务必须位于某个「## 模块」之内",
            );
            continue;
          }
          currentFeature = null;
          if (rawName === "") {
            addError(lineNo, "TITLE_NAME_REQUIRED", "任务标题不能为空");
          }
          const title = clamps(
            rawName === "" ? "（未命名）" : rawName,
            DOCUMENT_IMPORT_TASK_TITLE_MAX,
          );
          if (title.overflow) {
            addError(
              lineNo,
              "FIELD_TOO_LONG",
              "任务标题超过 " +
                String(DOCUMENT_IMPORT_TASK_TITLE_MAX) +
                " 字符，超出部分已截断",
            );
          }
          currentTask = {
            line: lineNo,
            scope: "MODULE",
            title: title.text,
            assigneeTokens: [],
            priority: "NORMAL",
            dueAt: null,
            description: "",
            impactFeatureNames: [],
            seen: new Set(),
          };
          currentModule.tasks.push(currentTask);
          context = "task";
          continue;
        }
        addError(
          lineNo,
          "HEADING_KIND_MISMATCH",
          "三级标题必须是「### 功能：名称」或「### 任务：名称」",
        );
        continue;
      }
      if (kind !== "任务") {
        addError(
          lineNo,
          "HEADING_KIND_MISMATCH",
          "四级标题必须是「#### 任务：名称」",
        );
        continue;
      }
      if (currentFeature === null) {
        addError(
          lineNo,
          "FEATURE_TASK_OUTSIDE_FEATURE",
          "四级任务必须位于某个「### 功能」之内",
        );
        continue;
      }
      if (rawName === "") {
        addError(lineNo, "TITLE_NAME_REQUIRED", "任务标题不能为空");
      }
      const title = clamps(
        rawName === "" ? "（未命名）" : rawName,
        DOCUMENT_IMPORT_TASK_TITLE_MAX,
      );
      if (title.overflow) {
        addError(
          lineNo,
          "FIELD_TOO_LONG",
          "任务标题超过 " +
            String(DOCUMENT_IMPORT_TASK_TITLE_MAX) +
            " 字符，超出部分已截断",
        );
      }
      currentTask = {
        line: lineNo,
        scope: "FEATURE",
        title: title.text,
        assigneeTokens: [],
        priority: "NORMAL",
        dueAt: null,
        description: "",
        impactFeatureNames: [],
        seen: new Set(),
      };
      currentFeature.tasks.push(currentTask);
      context = "task";
      continue;
    }

    const fieldMatch = FIELD_RE.exec(trimmed);
    if (fieldMatch !== null) {
      const parts = FIELD_SPLIT_RE.exec((fieldMatch[1] ?? "").trim());
      if (parts === null) {
        addError(
          lineNo,
          "FIELD_INVALID",
          "字段行必须为「- 字段名：值」格式（如 - 负责人：zhangsan）",
        );
        continue;
      }
      handleField({
        context,
        project,
        module: currentModule,
        feature: currentFeature,
        task: currentTask,
        fieldName: (parts[1] ?? "").trim(),
        rawValue: (parts[2] ?? "").trim(),
        line: lineNo,
        addIssue,
      });
      continue;
    }

    addError(
      lineNo,
      "LINE_UNRECOGNIZED",
      "无法识别的行；仅支持标题行、「- 字段：值」字段行、以 > 开头的说明行与 ``` 代码围栏（后两者会被忽略）",
    );
  }
  const addWarning = (line: number, code: string, message: string): void => {
    addIssue("WARNING", line, code, message);
  };

  if (!sawContent) {
    addError(1, "EMPTY_DOCUMENT", "文档为空：至少需要一个项目段或模块段");
  }

  const allTasks: TaskBuilder[] = [];
  for (const module of modules) {
    for (const task of module.tasks) {
      allTasks.push(task);
    }
    for (const feature of module.features) {
      for (const task of feature.tasks) {
        allTasks.push(task);
      }
    }
  }
  for (const task of allTasks) {
    if (task.assigneeTokens.length === 0) {
      addError(
        task.line,
        "ASSIGNEE_REQUIRED",
        "任务必须填写至少一名负责人（- 负责人：……）",
      );
    }
  }

  if (modules.length > DOCUMENT_IMPORT_MAX_MODULES) {
    addError(
      modules[DOCUMENT_IMPORT_MAX_MODULES]!.line,
      "LIMIT_EXCEEDED",
      "模块数量超过上限 " +
        String(DOCUMENT_IMPORT_MAX_MODULES) +
        "，超出部分不会执行",
    );
    modules = modules.slice(0, DOCUMENT_IMPORT_MAX_MODULES);
  }

  let featureKept = 0;
  let featureLimitReported = false;
  for (const module of modules) {
    const allowed = Math.max(0, DOCUMENT_IMPORT_MAX_FEATURES - featureKept);
    if (module.features.length > allowed) {
      if (!featureLimitReported) {
        addError(
          module.features[allowed]!.line,
          "LIMIT_EXCEEDED",
          "功能数量超过上限 " +
            String(DOCUMENT_IMPORT_MAX_FEATURES) +
            "，超出部分不会执行",
        );
        featureLimitReported = true;
      }
      module.features = module.features.slice(0, allowed);
    }
    featureKept += module.features.length;
  }

  const taskEntries: {
    module: ModuleBuilder;
    feature: FeatureBuilder | null;
    task: TaskBuilder;
  }[] = [];
  for (const module of modules) {
    for (const task of module.tasks) {
      taskEntries.push({ module, feature: null, task });
    }
    for (const feature of module.features) {
      for (const task of feature.tasks) {
        taskEntries.push({ module, feature, task });
      }
    }
  }
  taskEntries.sort((a, b) => a.task.line - b.task.line);
  if (taskEntries.length > DOCUMENT_IMPORT_MAX_TASKS) {
    addError(
      taskEntries[DOCUMENT_IMPORT_MAX_TASKS]!.task.line,
      "LIMIT_EXCEEDED",
      "任务数量超过上限 " +
        String(DOCUMENT_IMPORT_MAX_TASKS) +
        "，超出部分不会执行",
    );
  }
  const keptTasks = new Set(
    taskEntries.slice(0, DOCUMENT_IMPORT_MAX_TASKS).map((entry) => entry.task),
  );
  for (const module of modules) {
    module.tasks = module.tasks.filter((task) => keptTasks.has(task));
    for (const feature of module.features) {
      feature.tasks = feature.tasks.filter((task) => keptTasks.has(task));
    }
  }

  const entityLines = [
    ...modules.map((module) => module.line),
    ...modules.flatMap((module) =>
      module.features.map((feature) => feature.line),
    ),
    ...modules.flatMap((module) => [
      ...module.tasks.map((task) => task.line),
      ...module.features.flatMap((feature) =>
        feature.tasks.map((task) => task.line),
      ),
    ]),
  ].sort((a, b) => a - b);
  if (entityLines.length > DOCUMENT_IMPORT_MAX_TOTAL_ENTITIES) {
    addError(
      entityLines[DOCUMENT_IMPORT_MAX_TOTAL_ENTITIES]!,
      "LIMIT_EXCEEDED",
      "模块、功能与任务总数超过上限 " +
        String(DOCUMENT_IMPORT_MAX_TOTAL_ENTITIES),
    );
  }

  const seenTitles = new Map<string, number>();
  for (const entry of taskEntries) {
    if (!keptTasks.has(entry.task)) {
      continue;
    }
    const key = normalizeDocumentName(entry.task.title);
    const firstLine = seenTitles.get(key);
    if (firstLine === undefined) {
      seenTitles.set(key, entry.task.line);
    } else {
      addWarning(
        entry.task.line,
        "DUPLICATE_TASK_TITLE",
        "任务标题与第 " + String(firstLine) + " 行重复，请确认不是误写",
      );
    }
  }

  issues.sort((a, b) => a.line - b.line);

  return {
    digest,
    project:
      project === null
        ? null
        : {
            line: project.line,
            name: project.name,
            code: project.code,
            description: project.description,
            memberTokens: [...project.memberTokens],
          },
    modules: modules.map((module) => ({
      line: module.line,
      name: module.name,
      description: module.description,
      features: module.features.map((feature) => ({
        line: feature.line,
        name: feature.name,
        currentBehavior: feature.currentBehavior,
        acceptanceCriteria: feature.acceptanceCriteria,
        tags: [...feature.tags],
        tasks: feature.tasks.map(toParsedTask),
      })),
      tasks: module.tasks.map(toParsedTask),
    })),
    issues,
  };
}

function toParsedTask(task: TaskBuilder): ParsedTask {
  return {
    line: task.line,
    scope: task.scope,
    title: task.title,
    assigneeTokens: [...task.assigneeTokens],
    priority: task.priority,
    dueAt: task.dueAt,
    description: task.description,
    impactFeatureNames: [...task.impactFeatureNames],
  };
}
