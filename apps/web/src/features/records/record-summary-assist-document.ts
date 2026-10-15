/**
 * ADR-076 迭代总结 AI 改写的正文模型。
 *
 * 模型返回的是一整段 Markdown 文本；弹窗要能让用户「一句一句改」，所以这里把它
 * 切成可逐段编辑的段落（标题 / 段落 / 列表项）。同一份解析结果同时承担两件事：
 * 渲染可编辑正文，以及「复制正文」导出的纯文本——避免编辑视图与复制口径漂移。
 *
 * 不引入任何 Markdown 解析依赖：只需要识别标题、列表项与普通段落三类，其余
 * 行按普通段落原样保留（ADR-076 明确不新增依赖）。
 */

export type SummaryAssistSegmentKind = "heading" | "paragraph" | "bullet";

export interface SummaryAssistSegment {
  /** 段落在本文档内的稳定标识（s0、s1…），供编辑态与单段回退定位。 */
  readonly key: string;
  readonly kind: SummaryAssistSegmentKind;
  /** 模型返回的原文；单段回退就是恢复成它。 */
  readonly orig: string;
}

export interface SummaryAssistDocument {
  readonly segments: readonly SummaryAssistSegment[];
}

/**
 * 渲染单位：连续列表项合成一个 `ul`，标题与段落各自成块。
 * 判别联合（而不是「segments 数组恰好一个」）是为了让调用方不必做下标访问。
 */
export type SummaryAssistUnit =
  | {
      readonly kind: "heading" | "paragraph";
      readonly segment: SummaryAssistSegment;
    }
  | {
      readonly kind: "bullets";
      readonly key: string;
      readonly segments: readonly SummaryAssistSegment[];
    };

const FENCE = /^\s*```/;
const HEADING = /^#{1,6}\s+(.*)$/;
const BULLET = /^[-*+]\s+(.*)$/;

const segmentOf = (
  index: number,
  kind: SummaryAssistSegmentKind,
  text: string,
): SummaryAssistSegment => ({
  key: `s${String(index)}`,
  kind,
  orig: text,
});

/**
 * 把模型返回的正文切成段落。防御性地去掉代码围栏（提示词已禁止输出，但模型
 * 偶尔仍会包一层），围栏内的行同样按正文处理而不是丢弃。
 */
export function parseSummaryAssistMarkdown(
  markdown: string,
): SummaryAssistDocument {
  const segments: SummaryAssistSegment[] = [];
  for (const rawLine of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const text = rawLine.trim();
    if (text === "") continue;
    if (FENCE.test(text)) continue;
    const heading = HEADING.exec(text);
    if (heading !== null && heading[1] !== undefined) {
      segments.push(segmentOf(segments.length, "heading", heading[1].trim()));
      continue;
    }
    const bullet = BULLET.exec(text);
    if (bullet !== null && bullet[1] !== undefined) {
      segments.push(segmentOf(segments.length, "bullet", bullet[1].trim()));
      continue;
    }
    segments.push(segmentOf(segments.length, "paragraph", text));
  }
  return { segments };
}

/** 连续列表项合成一个渲染单位；标题与段落各自成块。 */
export function groupSummaryAssistSegments(
  document: SummaryAssistDocument,
): readonly SummaryAssistUnit[] {
  const units: SummaryAssistUnit[] = [];
  for (const segment of document.segments) {
    if (segment.kind !== "bullet") {
      units.push({ kind: segment.kind, segment });
      continue;
    }
    const last = units[units.length - 1];
    if (last !== undefined && last.kind === "bullets") {
      units[units.length - 1] = {
        kind: "bullets",
        key: last.key,
        segments: [...last.segments, segment],
      };
      continue;
    }
    units.push({ kind: "bullets", key: segment.key, segments: [segment] });
  }
  return units;
}

/**
 * 编辑后的正文文本：与「复制正文」共用，未编辑的段回落到模型原文。
 * 标题输出 `## ` 前缀，列表项输出 `- ` 前缀，段落原样输出。
 */
export function summaryAssistDocumentToText(
  document: SummaryAssistDocument,
  edited: Readonly<Record<string, string>>,
): string {
  const lines: string[] = [];
  for (const segment of document.segments) {
    const text = edited[segment.key] ?? segment.orig;
    if (segment.kind === "bullet") {
      lines.push(`- ${text}`);
      continue;
    }
    if (lines.length > 0) lines.push("");
    lines.push(segment.kind === "heading" ? `## ${text}` : text);
  }
  return lines.join("\n");
}

/** 已被手动改动的段数：以「当前文本与模型原文不同」为准，不数编辑次数。 */
export function countEditedAssistSegments(
  document: SummaryAssistDocument,
  edited: Readonly<Record<string, string>>,
): number {
  let count = 0;
  for (const segment of document.segments) {
    if (
      edited[segment.key] !== undefined &&
      edited[segment.key] !== segment.orig
    ) {
      count += 1;
    }
  }
  return count;
}
