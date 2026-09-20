/**
 * 兼容 F-18 多条化之前的历史 payload：`remainingIssues` 在库里曾是单段文本。
 * 读取时归一化为条目数组；旧记录至多一条遗留项，其稳定 id 由版本快照取回。
 */
export function normalizedLeftoverEntries(
  value: unknown,
  snapshotIds: readonly number[],
): unknown {
  if (typeof value !== "string") return value ?? [];
  const content = value.trim();
  if (content.length === 0) return [];
  return snapshotIds.length === 1
    ? [{ id: snapshotIds[0], content }]
    : [{ content }];
}
