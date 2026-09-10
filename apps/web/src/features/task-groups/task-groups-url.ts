/**
 * F-25 聚合组记录筛选的 URL 状态（F-30：筛选状态由 URL 承载，页面不保留内部副本）。
 *
 * 参数 task=<成员任务 id>：缺省或非法值表示「全部记录」；与默认值相同的项不写入
 * URL。解析规则与 my-tasks-url.ts 一致：正整数，上限 2147483647。
 */

export const TASK_GROUP_MEMBER_PARAM = "task";

export function readTaskGroupMemberTaskId(
  params: URLSearchParams,
): number | null {
  const raw = params.get(TASK_GROUP_MEMBER_PARAM);
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 2147483647)
    return null;
  return parsed;
}

export function writeTaskGroupMemberTaskId(
  params: URLSearchParams,
  memberTaskId: number | null,
): URLSearchParams {
  const next = new URLSearchParams(params);
  if (
    memberTaskId === null ||
    !Number.isInteger(memberTaskId) ||
    memberTaskId < 1 ||
    memberTaskId > 2147483647
  ) {
    next.delete(TASK_GROUP_MEMBER_PARAM);
    return next;
  }
  next.set(TASK_GROUP_MEMBER_PARAM, String(memberTaskId));
  return next;
}
