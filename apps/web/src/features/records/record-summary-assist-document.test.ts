import { describe, expect, it } from "vitest";
import {
  countEditedAssistSegments,
  groupSummaryAssistSegments,
  parseSummaryAssistMarkdown,
  summaryAssistDocumentToText,
} from "./record-summary-assist-document";

// ADR-076 正文模型：模型返回的是整段 Markdown，弹窗要能逐段编辑并把编辑结果原样
// 复制出去。这里锁三件事——段落切分（标题/列表项/段落）、渲染分组（连续列表项合成
// 一个 ul）、以及「编辑后的正文」与「复制正文」共用同一份文本口径。

const MARKDOWN = [
  "2026 年度总结",
  "",
  "## 整体概览",
  "本期范围内共 2 个项目、5 条迭代记录。",
  "",
  "## 二、项目进展",
  "- **商城系统**：支付链路重构上线。",
  "- **会员中心**：等级体系灰度完成。",
  "",
  "建议下一季度补齐缺口任务。",
].join("\n");

describe("parseSummaryAssistMarkdown", () => {
  it("把标题、段落与列表项切成稳定编号的段落，空行不占段", () => {
    const document = parseSummaryAssistMarkdown(MARKDOWN);
    expect(document.segments.map((segment) => segment.key)).toEqual([
      "s0",
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "s6",
    ]);
    expect(document.segments.map((segment) => segment.kind)).toEqual([
      "paragraph",
      "heading",
      "paragraph",
      "heading",
      "bullet",
      "bullet",
      "paragraph",
    ]);
    expect(document.segments[0]?.orig).toBe("2026 年度总结");
    expect(document.segments[4]?.orig).toBe("**商城系统**：支付链路重构上线。");
  });

  it("忽略代码围栏标记本身，围栏内的正文照常保留", () => {
    const document = parseSummaryAssistMarkdown(
      ["```markdown", "## 概览", "正文", "```"].join("\n"),
    );
    // 围栏内的 `## 概览` 仍是标题段：解析器剥掉井号只留文字。
    expect(document.segments.map((segment) => segment.kind)).toEqual([
      "heading",
      "paragraph",
    ]);
    expect(document.segments.map((segment) => segment.orig)).toEqual([
      "概览",
      "正文",
    ]);
  });

  it("全空正文切成零段，弹窗据此回落而不是渲染空卡", () => {
    expect(parseSummaryAssistMarkdown("\n\n").segments).toHaveLength(0);
  });
});

describe("groupSummaryAssistSegments", () => {
  it("连续列表项合成一个渲染单位，标题与段落各自成块", () => {
    const units = groupSummaryAssistSegments(
      parseSummaryAssistMarkdown(MARKDOWN),
    );
    expect(units.map((unit) => unit.kind)).toEqual([
      "paragraph",
      "heading",
      "paragraph",
      "heading",
      "bullets",
      "paragraph",
    ]);
    const bullets = units[4];
    expect(bullets?.kind === "bullets" ? bullets.segments.length : 0).toBe(2);
  });
});

describe("summaryAssistDocumentToText", () => {
  it("未编辑时按 Markdown 还原：标题带 ##，列表项带 -", () => {
    const text = summaryAssistDocumentToText(
      parseSummaryAssistMarkdown(MARKDOWN),
      {},
    );
    expect(text).toContain("## 整体概览");
    expect(text).toContain("- **商城系统**：支付链路重构上线。");
    expect(text.split("\n")[0]).toBe("2026 年度总结");
  });

  it("编辑过的段替换文本，其余段保持模型原文", () => {
    const document = parseSummaryAssistMarkdown(MARKDOWN);
    const text = summaryAssistDocumentToText(document, {
      s2: "本期共完成 2 个项目。",
    });
    expect(text).toContain("本期共完成 2 个项目。");
    expect(text).not.toContain("本期范围内共 2 个项目、5 条迭代记录。");
    expect(text).toContain("- **会员中心**：等级体系灰度完成。");
  });
});

describe("countEditedAssistSegments", () => {
  it("只数真正改动过的段，回退到原文的段不再计数", () => {
    const document = parseSummaryAssistMarkdown(MARKDOWN);
    expect(countEditedAssistSegments(document, {})).toBe(0);
    expect(countEditedAssistSegments(document, { s1: "改过的标题" })).toBe(1);
    expect(
      countEditedAssistSegments(document, {
        s1: "改过的标题",
        s4: "**商城系统**：支付链路重构上线。",
      }),
    ).toBe(1);
  });
});
