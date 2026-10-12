import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import {
  DOCUMENT_IMPORT_MAX_MODULES,
  type DocumentImportIssue,
} from "@inpulse/api-contract";
import {
  documentDigest,
  parseDocumentTemplate,
} from "../src/modules/document-import/document-template.parser.js";

const FULL_DOCUMENT = [
  "# 项目：商城系统",
  "- 项目编码：SHOP",
  "- 项目说明：演示项目",
  "- 初始成员：wangwu, zhaoliu",
  "## 模块：支付",
  "- 说明：支付相关能力",
  "### 功能：退款回调",
  "- 当前说明：回调失败会重试",
  "- 验收标准：重复回调只入账一次",
  "- 标签：支付, 回调, 支付",
  "#### 任务：修复重复回调",
  "- 负责人：zhangsan, 张三",
  "- 优先级：高",
  "- 截止：2026-10-30",
  "- 描述：修复线上问题",
  "### 任务：升级 SDK",
  "- 负责人：zhangsan",
  "- 影响功能：退款回调",
].join("\n");

const IN_PROJECT_DOCUMENT = [
  "## 模块：订单",
  "### 功能：下单",
  "#### 任务：实现下单",
  "- 负责人：zhangsan",
].join("\n");

function codes(issues: readonly DocumentImportIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

function errors(issues: readonly DocumentImportIssue[]): DocumentImportIssue[] {
  return issues.filter((issue) => issue.severity === "ERROR");
}

describe("parseDocumentTemplate 语法", () => {
  test("完整文档解析出项目、模块、功能、任务与字段", () => {
    const result = parseDocumentTemplate(FULL_DOCUMENT);
    expect(result.issues).toEqual([]);
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.project).toMatchObject({
      line: 1,
      name: "商城系统",
      code: "SHOP",
      description: "演示项目",
      memberTokens: ["wangwu", "zhaoliu"],
    });
    expect(result.modules).toHaveLength(1);
    const module = result.modules[0]!;
    expect(module).toMatchObject({
      line: 5,
      name: "支付",
      description: "支付相关能力",
    });
    expect(module.features).toHaveLength(1);
    const feature = module.features[0]!;
    expect(feature).toMatchObject({
      line: 7,
      name: "退款回调",
      currentBehavior: "回调失败会重试",
      acceptanceCriteria: "重复回调只入账一次",
    });
    expect(feature.tags).toEqual(["支付", "回调"]);
    expect(feature.tasks).toHaveLength(1);
    const featureTask = feature.tasks[0]!;
    expect(featureTask).toMatchObject({
      line: 11,
      scope: "FEATURE",
      title: "修复重复回调",
      assigneeTokens: ["zhangsan", "张三"],
      priority: "HIGH",
      description: "修复线上问题",
      impactFeatureNames: [],
    });
    expect(featureTask.dueAt).toBe(
      new Date("2026-10-30T23:59:59+08:00").toISOString(),
    );
    expect(module.tasks).toHaveLength(1);
    expect(module.tasks[0]).toMatchObject({
      line: 16,
      scope: "MODULE",
      title: "升级 SDK",
      assigneeTokens: ["zhangsan"],
      priority: "NORMAL",
      dueAt: null,
      description: "",
      impactFeatureNames: ["退款回调"],
    });
  });

  test("项目内导入文档（无项目段）只解析模块与下级", () => {
    const result = parseDocumentTemplate(IN_PROJECT_DOCUMENT);
    expect(result.issues).toEqual([]);
    expect(result.project).toBeNull();
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0]!.features[0]!.tasks[0]!.title).toBe("实现下单");
  });

  test("摘要按去 BOM、CRLF→LF 归一化", () => {
    const lf = "## 模块：支付\n### 功能：退款\n";
    const crlf = "\uFEFF## 模块：支付\r\n### 功能：退款\r\n";
    expect(documentDigest(crlf)).toBe(documentDigest(lf));
    expect(parseDocumentTemplate(crlf).digest).toBe(documentDigest(lf));
  });

  test("未填写可选字段使用默认值", () => {
    const result = parseDocumentTemplate(
      ["## 模块：支付", "### 功能：退款", "#### 任务：t", "- 负责人：a"].join(
        "\n",
      ),
    );
    const module = result.modules[0]!;
    expect(module.description).toBe("");
    expect(module.features[0]!.currentBehavior).toBe("");
    expect(module.features[0]!.acceptanceCriteria).toBeNull();
    expect(module.features[0]!.tags).toEqual([]);
    const task = module.features[0]!.tasks[0]!;
    expect(task).toMatchObject({
      priority: "NORMAL",
      dueAt: null,
      description: "",
    });
  });

  test("英文冒号与星号列表同样识别", () => {
    const result = parseDocumentTemplate(
      ["## 模块: 支付", "* 说明: 你好"].join("\n"),
    );
    expect(result.issues).toEqual([]);
    expect(result.modules[0]!.description).toBe("你好");
  });

  test("空文档报 EMPTY_DOCUMENT", () => {
    const result = parseDocumentTemplate("   \n\n");
    expect(codes(result.issues)).toContain("EMPTY_DOCUMENT");
  });

  test("前端下载模板可被解析器接受（模板与解析器一致性）", () => {
    const source = readFileSync(
      new URL(
        "../../web/src/features/document-import/DocumentImportModal.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const start = source.indexOf("export const DOCUMENT_IMPORT_TEMPLATE = [");
    const end = source.indexOf('].join("\\n");', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const literal = source
      .slice(source.indexOf("[", start), end + 1)
      .replace(/,\s*\]$/, "]");
    const template = (JSON.parse(literal) as string[]).join("\n");
    const result = parseDocumentTemplate(template);
    expect(result.issues).toEqual([]);
    expect(result.project?.code).toBe("SHOP");
    expect(result.modules[0]?.name).toBe("支付");
    expect(result.modules[0]?.features[0]?.tasks[0]?.title).toBe(
      "修复重复回调",
    );
  });
  test("说明行与代码围栏行被忽略且不生效（ADR-065）", () => {
    const result = parseDocumentTemplate(
      [
        "> 填写说明：这一行会被忽略",
        "```markdown",
        "# 项目：商城系统",
        "> - 项目编码：WRONG",
        "- 项目编码：SHOP",
        "~~~",
        "## 模块：支付",
        "> ## 模块：假模块",
        "### 功能：退款",
        "#### 任务：t",
        "- 负责人：a",
        "```",
      ].join("\n"),
    );
    expect(result.issues).toEqual([]);
    expect(result.project?.code).toBe("SHOP");
    expect(result.modules).toHaveLength(1);
    expect(result.modules[0]!.name).toBe("支付");
    expect(result.modules[0]!.features[0]!.tasks).toHaveLength(1);
  });

  test("只含说明行与围栏行的文档按空文档处理（ADR-065）", () => {
    const result = parseDocumentTemplate(["> 说明", "```", "~~~"].join("\n"));
    expect(codes(result.issues)).toEqual(["EMPTY_DOCUMENT"]);
  });
  test("无法识别的行报 LINE_UNRECOGNIZED", () => {
    const result = parseDocumentTemplate(
      ["## 模块：支付", "这是一段说明"].join("\n"),
    );
    expect(codes(result.issues)).toContain("LINE_UNRECOGNIZED");
  });
});

describe("parseDocumentTemplate 结构校验", () => {
  test("未知字段按段落拒绝", () => {
    const result = parseDocumentTemplate(
      [
        "# 项目：P",
        "- 未知字段：x",
        "## 模块：支付",
        "- 未知字段：x",
        "### 功能：退款",
        "- 未知字段：x",
        "#### 任务：t",
        "- 负责人：a",
        "- 未知字段：x",
      ].join("\n"),
    );
    expect(
      codes(result.issues).filter((code) => code === "UNKNOWN_FIELD"),
    ).toHaveLength(4);
  });

  test("层级错误：功能在模块外、任务在错误层级", () => {
    const result = parseDocumentTemplate(
      ["### 功能：退款", "#### 任务：t", "### 任务：m"].join("\n"),
    );
    const found = codes(result.issues);
    expect(found).toContain("FEATURE_OUTSIDE_MODULE");
    expect(found).toContain("FEATURE_TASK_OUTSIDE_FEATURE");
    expect(found).toContain("TASK_OUTSIDE_MODULE");
  });

  test("文档内模块重名与功能重名", () => {
    const moduleDuplicate = parseDocumentTemplate(
      ["## 模块：支付", "## 模块：支付"].join("\n"),
    );
    expect(codes(moduleDuplicate.issues)).toContain("DUPLICATE_MODULE_NAME");
    const featureDuplicate = parseDocumentTemplate(
      ["## 模块：支付", "### 功能：退款", "### 功能：退款"].join("\n"),
    );
    expect(codes(featureDuplicate.issues)).toContain("DUPLICATE_FEATURE_NAME");
  });

  test("项目段重复与位置错误", () => {
    const result = parseDocumentTemplate(
      ["## 模块：支付", "# 项目：P", "# 项目：P2"].join("\n"),
    );
    const found = codes(result.issues);
    expect(found).toContain("PROJECT_SECTION_NOT_FIRST");
    expect(found).toContain("DUPLICATE_PROJECT_SECTION");
  });

  test("同段重复字段报 DUPLICATE_FIELD", () => {
    const result = parseDocumentTemplate(
      ["## 模块：支付", "- 说明：a", "- 说明：b"].join("\n"),
    );
    expect(codes(result.issues)).toContain("DUPLICATE_FIELD");
    expect(result.modules[0]!.description).toBe("a");
  });

  test("项目编码格式非法", () => {
    const result = parseDocumentTemplate(
      ["# 项目：P", "- 项目编码：shop-1"].join("\n"),
    );
    expect(codes(result.issues)).toContain("PROJECT_CODE_INVALID");
    expect(result.project!.code).toBeNull();
  });
});

describe("parseDocumentTemplate 任务校验", () => {
  test("负责人缺失报 ASSIGNEE_REQUIRED", () => {
    const result = parseDocumentTemplate(
      ["## 模块：支付", "### 任务：m"].join("\n"),
    );
    expect(codes(result.issues)).toContain("ASSIGNEE_REQUIRED");
  });

  test("优先级与截止非法值", () => {
    const result = parseDocumentTemplate(
      [
        "## 模块：支付",
        "### 任务：m",
        "- 负责人：a",
        "- 优先级：很高",
        "- 截止：2026-02-30",
      ].join("\n"),
    );
    const found = codes(result.issues);
    expect(found).toContain("PRIORITY_INVALID");
    expect(found).toContain("DUE_DATE_INVALID");
  });

  test("功能任务不允许影响功能字段", () => {
    const result = parseDocumentTemplate(
      [
        "## 模块：支付",
        "### 功能：退款",
        "#### 任务：t",
        "- 负责人：a",
        "- 影响功能：退款",
      ].join("\n"),
    );
    expect(codes(result.issues)).toContain("UNKNOWN_FIELD");
  });

  test("任务标题重复仅产生 WARNING", () => {
    const result = parseDocumentTemplate(
      [
        "## 模块：支付",
        "### 任务：重复标题",
        "- 负责人：a",
        "### 任务：重复标题",
        "- 负责人：a",
      ].join("\n"),
    );
    expect(errors(result.issues)).toEqual([]);
    const warning = result.issues.find(
      (issue) => issue.code === "DUPLICATE_TASK_TITLE",
    );
    expect(warning?.severity).toBe("WARNING");
    expect(warning?.line).toBe(4);
  });
});

describe("parseDocumentTemplate 限额", () => {
  test("模块超过上限时截断并报 LIMIT_EXCEEDED", () => {
    const lines: string[] = [];
    for (let index = 0; index < DOCUMENT_IMPORT_MAX_MODULES + 1; index += 1) {
      lines.push("## 模块：M" + String(index));
    }
    const result = parseDocumentTemplate(lines.join("\n"));
    expect(result.modules).toHaveLength(DOCUMENT_IMPORT_MAX_MODULES);
    expect(codes(result.issues)).toContain("LIMIT_EXCEEDED");
  });
});
