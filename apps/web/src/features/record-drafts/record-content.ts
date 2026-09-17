import type { RecordDraftContent } from "@generated/api";
export const fields = [
  "title",
  "contextProblem",
  "changeSolution",
  "resultVerification",
  "remainingIssues",
] as const;
export type Field = (typeof fields)[number];
export const labels: Record<Field, string> = {
  title: "迭代标题",
  contextProblem: "改动原因",
  changeSolution: "具体改动",
  resultVerification: "改动效果",
  remainingIssues: "遗留问题（选填，可添加多条）",
};
/** 遗留问题条目：发布后的条目带稳定 id，草稿与新建时省略。 */
export type LeftoverEntry = RecordDraftContent["remainingIssues"][number];
/** 遗留问题在只读展示与版本对比里的文本投影：逐条换行拼接。 */
export const leftoverText = (entries: readonly LeftoverEntry[]) =>
  entries
    .map((entry) => entry.content)
    .join("\n")
    .trim();
/** 逐字段文本投影，供版本差异与冲突提示等纯文本展示复用。 */
export const fieldText = (content: RecordDraftContent, field: Field) =>
  field === "remainingIssues"
    ? leftoverText(content.remainingIssues)
    : content[field];
const equalField = (
  a: RecordDraftContent,
  b: RecordDraftContent,
  field: Field,
) =>
  field === "remainingIssues"
    ? JSON.stringify(a.remainingIssues) === JSON.stringify(b.remainingIssues)
    : a[field] === b[field];
export function mergeRecordDraft(
  base: RecordDraftContent,
  draft: RecordDraftContent,
  latest: RecordDraftContent,
) {
  const values = { ...latest };
  const conflicts: Field[] = [];
  for (const field of fields) {
    if (equalField(draft, base, field)) continue;
    if (!equalField(latest, base, field) && !equalField(latest, draft, field))
      conflicts.push(field);
    (values as Record<Field, unknown>)[field] = (
      draft as Record<Field, unknown>
    )[field];
  }
  return { values, conflicts };
}

export const recordContent = (
  item: RecordDraftContent,
): RecordDraftContent => ({
  title: item.title,
  contextProblem: item.contextProblem,
  changeSolution: item.changeSolution,
  resultVerification: item.resultVerification,
  remainingIssues: item.remainingIssues,
});
