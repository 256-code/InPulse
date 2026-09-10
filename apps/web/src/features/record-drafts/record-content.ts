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
  contextProblem: "为什么改、发现了什么问题",
  changeSolution: "改了什么、怎么改的",
  resultVerification: "改完效果如何、如何验证",
  remainingIssues: "还有什么问题（选填）",
};
export function mergeRecordDraft(
  base: RecordDraftContent,
  draft: RecordDraftContent,
  latest: RecordDraftContent,
) {
  const values = { ...latest };
  const conflicts: Field[] = [];
  for (const field of fields) {
    if (draft[field] === base[field]) continue;
    if (latest[field] !== base[field] && latest[field] !== draft[field])
      conflicts.push(field);
    values[field] = draft[field];
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
