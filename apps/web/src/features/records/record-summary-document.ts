import type { RecordSummaryResponse } from "@generated/api";

/**
 * F-33 迭代总结正文的派生展示层。
 *
 * 服务端只返回事实（记录 / 已完成任务 / 遗留问题 / 缺口与计数），这里按事实
 * 拼出可读正文，与 R-7 聚合组「服务端只透传事实、派生展示值由客户端计算」
 * 同一分工。不引入任何服务端没有的数据，也不改写记录正文原文。
 */
export interface SummaryBullet {
  readonly label: string;
  readonly text: string;
}

export type SummaryBlock =
  | { readonly kind: "overview"; readonly text: string }
  | {
      readonly kind: "section";
      readonly heading: string;
      readonly bullets: readonly SummaryBullet[];
    }
  | {
      readonly kind: "issues";
      readonly heading: string;
      readonly lead: string;
      readonly items: readonly string[];
    }
  | {
      readonly kind: "gaps";
      readonly heading: string;
      readonly lead: string;
      readonly items: readonly string[];
    };

export interface SummaryDocument {
  readonly title: string;
  readonly scopeLine: string;
  readonly note: string;
  readonly blocks: readonly SummaryBlock[];
}

const CN_DIGITS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

const cnIndex = (index: number): string =>
  CN_DIGITS[index] ?? String(index + 1);

const day = (iso: string): string => iso.slice(0, 10);

const monthDay = (iso: string): string => {
  const date = day(iso);
  return `${String(Number(date.slice(5, 7)))}/${String(Number(date.slice(8, 10)))}`;
};

function documentTitle(from: string, to: string): string {
  const fromYear = from.slice(0, 4);
  const toYear = to.slice(0, 4);
  return fromYear === toYear && from.endsWith("-01-01") && to.endsWith("-12-31")
    ? `${fromYear} 年度总结`
    : `${from} 至 ${to} 迭代总结`;
}

export function buildSummaryDocument(
  data: RecordSummaryResponse,
): SummaryDocument {
  const projectNameById = new Map(
    data.scope.projectIds.map(
      (projectId, index) =>
        [projectId, data.scope.projectNames[index] ?? ""] as const,
    ),
  );
  const projectLabel = (projectId: number): string =>
    projectNameById.get(projectId) ?? "";
  const totals = data.totals;

  const overviewParts = [
    `范围内 ${String(totals.projectCount)} 个项目、${String(totals.moduleCount)} 个模块、${String(totals.featureCount)} 个功能累计沉淀 ${String(totals.recordCount)} 条迭代记录，覆盖 ${String(totals.completedTaskCount)} 个已完成任务。`,
    `共记录 ${String(totals.leftoverCount)} 条遗留问题，其中 ${String(totals.closedLeftoverCount)} 条已闭环。`,
  ];
  if (totals.missingRecordTaskCount > 0) {
    overviewParts.push(
      `另有 ${String(totals.missingRecordTaskCount)} 个已完成任务还没有对应的迭代记录。`,
    );
  }
  if (data.truncated) {
    overviewParts.push(
      "本次取数超过单次上限，正文与缺口分析均按已取到的部分给出，请缩小时间范围后再生成。",
    );
  }

  const blocks: SummaryBlock[] = [
    { kind: "overview", text: overviewParts.join("") },
  ];

  // 编号只数带标题的小节：整体概览不占号，与设计稿「一、二、三…」一致。
  let numbered = 0;

  for (const section of data.sections) {
    const isProject = section.projectId !== null;
    const name = isProject
      ? projectLabel(section.projectId ?? 0)
      : (section.member?.name ?? "");
    const points = data.points.filter((point) =>
      isProject
        ? point.projectId === section.projectId
        : point.author.userId === Number(section.key),
    );
    numbered += 1;
    blocks.push({
      kind: "section",
      heading: `${cnIndex(numbered - 1)}、${name} · ${String(section.recordCount)} 条记录 / ${String(section.completedTaskCount)} 个已完成任务`,
      bullets: points.map((point) => ({
        label: point.title,
        text: point.detail,
      })),
    });
  }

  const activeIssues = data.leftovers.filter(
    (issue) => issue.status === "ACTIVE",
  );
  if (data.leftovers.length > 0) {
    numbered += 1;
    const closed = data.leftovers.length - activeIssues.length;
    blocks.push({
      kind: "issues",
      heading: `${cnIndex(numbered - 1)}、遗留问题与风险`,
      lead: `范围内共 ${String(data.leftovers.length)} 条遗留问题，已闭环 ${String(closed)} 条，仍有 ${String(activeIssues.length)} 条待跟进。`,
      items: activeIssues.map(
        (issue) =>
          `${issue.content} —— 来自 ${issue.recordTitle}（${issue.projectName}）`,
      ),
    });
  }

  if (data.gaps.length > 0) {
    numbered += 1;
    blocks.push({
      kind: "gaps",
      heading: `${cnIndex(numbered - 1)}、还需要补什么`,
      lead: `有 ${String(data.gaps.length)} 个已完成任务没有对应的迭代记录，年终总结里最容易漏掉，建议优先补写：`,
      items: data.gaps.map(
        (gap) =>
          `${gap.title}（${gap.assignee.name} · ${monthDay(gap.completedAt)}）`,
      ),
    });
  }

  const memberLabel =
    data.scope.member === null ? "全体成员" : data.scope.member.name;
  return {
    title: documentTitle(data.range.from, data.range.to),
    scopeLine: `${data.scope.projectNames.join(" · ") || "全部项目"} ／ ${data.range.from} - ${data.range.to} ／ ${memberLabel}`,
    note:
      data.groupBy === "MEMBER"
        ? "按成员归纳：记录按作者、任务按负责人归属；一个人同时是记录作者与任务负责人时分别计数。"
        : "按项目归纳：只统计范围内已发布的迭代记录与已完成任务，作废记录与草稿不计入。",
    blocks,
  };
}

/** 与「复制正文」一致的纯文本形式（Markdown 小节标题 + 列表）。 */
export function summaryDocumentToText(document: SummaryDocument): string {
  const lines: string[] = [document.title, document.scopeLine, ""];
  for (const block of document.blocks) {
    if (block.kind === "overview") {
      lines.push("## 整体概览", block.text, "");
      continue;
    }
    if (block.kind === "section") {
      lines.push(`## ${block.heading}`);
      for (const bullet of block.bullets) {
        lines.push(`- **${bullet.label}**：${bullet.text}`);
      }
      lines.push("");
      continue;
    }
    lines.push(`## ${block.heading}`, block.lead);
    for (const item of block.items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }
  lines.push(document.note);
  return lines.join("\n");
}
