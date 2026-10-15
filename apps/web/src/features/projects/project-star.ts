import React from "react";

/**
 * 项目星标（「我的关注」）：每人各自一份，当前只存浏览器本地，不入库、不进契约。
 * 跨设备同步需要后端存「谁关注了哪个项目」，属于后续独立改动。
 */
const STARRED_PROJECTS_STORAGE_KEY = "inpulse.projects.starred";

/** 读取已星标项目 ID：内容损坏或存储不可用时按「没有星标」处理，不影响列表渲染。 */
export function readStarredProjectIds(): readonly number[] {
  try {
    const raw = globalThis.localStorage.getItem(STARRED_PROJECTS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is number =>
        typeof value === "number" && Number.isInteger(value) && value > 0,
    );
  } catch {
    return [];
  }
}

function writeStarredProjectIds(ids: readonly number[]): void {
  try {
    globalThis.localStorage.setItem(
      STARRED_PROJECTS_STORAGE_KEY,
      JSON.stringify(ids),
    );
  } catch {
    // 写入失败（隐私模式等）：本次会话内仍然生效，只是刷新后不再保留。
  }
}

/** 取反：已星标就移除，未星标就追加；不改变其它 ID 的相对顺序。 */
export function toggleStarredProjectId(
  ids: readonly number[],
  projectId: number,
): readonly number[] {
  return ids.includes(projectId)
    ? ids.filter((id) => id !== projectId)
    : [...ids, projectId];
}

export interface ProjectStars {
  readonly isStarred: (projectId: number) => boolean;
  readonly toggleStar: (projectId: number) => void;
}

/** 星标状态：点击即生效（不等服务端，也没有确认弹窗），并立即写回本地存储。 */
export function useProjectStars(): ProjectStars {
  const [starredIds, setStarredIds] = React.useState<readonly number[]>(
    readStarredProjectIds,
  );

  const toggleStar = React.useCallback((projectId: number) => {
    setStarredIds((current) => {
      const next = toggleStarredProjectId(current, projectId);
      writeStarredProjectIds(next);
      return next;
    });
  }, []);

  const isStarred = React.useCallback(
    (projectId: number) => starredIds.includes(projectId),
    [starredIds],
  );

  return { isStarred, toggleStar };
}
