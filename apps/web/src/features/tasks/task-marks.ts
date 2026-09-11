import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { InpulseApiClient, TaskGroupMembershipItem } from "@generated/api";

/**
 * F-25 步骤 3 / C-1 任务记录标记：R-5 listTaskGroupMemberships 的前端接线。
 *
 * 页面级一次批量：当前页任务 ID 去重升序后按 R-5 的 1..100 上限分块，常规页面
 * 只有一块（即一次请求），禁止按任务逐个请求（A 裁决 §10.4 与裁决修订 D-1 §11.4）。
 *
 * 响应覆盖请求中每一个有权 taskId：无权或不存在不出现，**未入组**任务以
 * groupId / groupRole 为 null 返回且计数照常，因此「未入组」必须按条目本身判断，
 * 不能按条目缺失判断。读取失败返回空标记集合：调用方据此隐藏关系入口，
 * 不得回退为逐个请求。任务基础 DTO 不扩展（Q-03 与 D-1.1）。
 */

export const TASK_MARK_IDS_MAX = 100;

export interface TaskMark {
  readonly groupId: number | null;
  readonly groupRole: "MAIN" | "SOURCE" | null;
  readonly publishedRecordCount: number;
}

/** 去重升序后按 1..100 分块；空列表返回空数组（不产生请求）。 */
export function chunkTaskMarkIds(
  ids: readonly number[],
): readonly (readonly number[])[] {
  const unique = [...new Set(ids)].sort((left, right) => left - right);
  const chunks: number[][] = [];
  for (let index = 0; index < unique.length; index += TASK_MARK_IDS_MAX)
    chunks.push(unique.slice(index, index + TASK_MARK_IDS_MAX));
  return chunks;
}

/** R-5 条目按 taskId 建索引；重复 taskId 由服务端 422 拒绝，这里取后写值。 */
export function toTaskMarkMap(
  items: readonly TaskGroupMembershipItem[],
): ReadonlyMap<number, TaskMark> {
  return new Map(
    items.map((item) => [
      item.taskId,
      {
        groupId: item.groupId,
        groupRole: item.groupRole,
        publishedRecordCount: item.publishedRecordCount,
      },
    ]),
  );
}

const EMPTY_MARKS: ReadonlyMap<number, TaskMark> = new Map();

/**
 * 读取页面内全部任务的聚合关系与已发布迭代记录条数。
 * 查询键是去重升序后的 ID 串，任务集合变化时整批重新读取。
 */
export function useTaskMarks(
  api: InpulseApiClient,
  taskIds: readonly number[],
): ReadonlyMap<number, TaskMark> {
  const key = useMemo(
    () => [...new Set(taskIds)].sort((left, right) => left - right).join(","),
    [taskIds],
  );
  const query = useQuery({
    queryKey: ["task-marks", key],
    enabled: key.length > 0,
    retry: false,
    queryFn: async ({ signal }) => {
      const chunks = chunkTaskMarkIds(
        key.length === 0 ? [] : key.split(",").map((value) => Number(value)),
      );
      const pages = await Promise.all(
        chunks.map((chunk) =>
          api.listTaskGroupMemberships({ taskIds: [...chunk] }, { signal }),
        ),
      );
      return toTaskMarkMap(pages.flatMap((page) => page.items));
    },
  });
  return query.data ?? EMPTY_MARKS;
}
