import type { ReadableRecord } from "@generated/api";

/**
 * B-3a：记录列表的本地筛选与日期分组。
 * 主任务 / 来源任务的拆分需要任务组合并关系（R-5），本轮只提供可在记录
 * 数据内判定的来源：任务来源、模块级影响、功能直接创建；跨项目与全文检索
 * 由 B-3b 的服务端筛选取代。
 */
export type RecordSourceFilter = "ALL" | "TASK" | "MODULE" | "FEATURE";

export const RECORD_SOURCE_FILTERS: ReadonlyArray<{
  readonly value: RecordSourceFilter;
  readonly label: string;
}> = [
  { value: "ALL", label: "全部来源" },
  { value: "TASK", label: "任务来源" },
  { value: "MODULE", label: "模块级影响" },
  { value: "FEATURE", label: "功能直接创建" },
];

export const RECORD_SEARCH_PLACEHOLDER =
  "搜索编号、标题、原因、改动、验证或遗留问题";

export function matchesRecordSource(
  record: ReadableRecord,
  filter: RecordSourceFilter,
) {
  if (filter === "TASK") return record.taskId !== null;
  if (filter === "MODULE") return record.scopeType === "MODULE";
  if (filter === "FEATURE") return record.taskId === null;
  return true;
}

export function recordSearchText(record: ReadableRecord) {
  return [
    record.code,
    record.title,
    record.contextProblem,
    record.changeSolution,
    record.resultVerification,
    record.remainingIssues,
  ]
    .join(" ")
    .toLowerCase();
}

export function filterRecords(
  records: readonly ReadableRecord[],
  options: { readonly query: string; readonly source: RecordSourceFilter },
) {
  const term = options.query.trim().toLowerCase();
  return records.filter(
    (record) =>
      matchesRecordSource(record, options.source) &&
      (!term || recordSearchText(record).includes(term)),
  );
}

export function recordDateKey(publishedAt: string) {
  return publishedAt.slice(0, 10);
}

function recordDateLabel(key: string) {
  const date = new Date(`${key}T00:00:00`);
  return Number.isFinite(date.getTime())
    ? date.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : key;
}

/** 服务端已按 published_at DESC 分页；这里只把当前已加载页按发布日分组。 */
export function groupRecordsByDate(records: readonly ReadableRecord[]) {
  const groups = new Map<string, ReadableRecord[]>();
  for (const record of records) {
    const key = recordDateKey(record.publishedAt);
    const group = groups.get(key);
    if (group) group.push(record);
    else groups.set(key, [record]);
  }
  return Array.from(groups.entries())
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => ({
      key,
      label: recordDateLabel(key),
      records: items,
    }));
}
