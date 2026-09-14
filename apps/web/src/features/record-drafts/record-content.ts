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
  remainingIssues: "遗留问题（选填）",
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
