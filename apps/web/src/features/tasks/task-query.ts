import { useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type InpulseApiClient,
  type TaskEditRequest,
  type TaskItem,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";

export interface TaskScope {
  projectId: number;
  moduleId: number;
  featureId: number;
}
export const taskFields = [
  "title",
  "description",
  "priority",
  "assigneeId",
  "dueAt",
] as const;
export type TaskField = (typeof taskFields)[number];
export function taskEdit(item: TaskItem): TaskEditRequest {
  return {
    title: item.title,
    description: item.description,
    priority: item.priority,
    assigneeId: item.assigneeId,
    dueAt: item.dueAt,
  };
}
export function mergeTask(
  base: TaskEditRequest,
  draft: TaskEditRequest,
  latest: TaskEditRequest,
) {
  const values = { ...latest };
  const conflicts: TaskField[] = [];
  for (const field of taskFields) {
    if (draft[field] === base[field]) continue;
    if (latest[field] !== base[field] && latest[field] !== draft[field])
      conflicts.push(field);
    Object.assign(values, { [field]: draft[field] });
  }
  return { values, conflicts };
}
export function taskError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录状态已失效，请重新登录。";
    if (error.status === 404) return "任务或功能不存在，或你已无权访问。";
    if (error.status === 403) return "权限或安全校验未通过，请重新登录后重试。";
    if (error.status === 409)
      return `${error.message}。输入已保留，请加载最新版本后继续编辑。`;
    if (error.status === 422)
      return `${error.message}，请检查字段及负责人是否仍为项目活跃成员。`;
    if (error.status === 429) return "请求过于频繁，请稍后重试。";
  }
  return "任务服务暂时不可用，输入已保留，可重试。";
}
export function useTasks(scope: TaskScope, client?: InpulseApiClient) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const cache = useQueryClient();
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const args = [scope.projectId, scope.moduleId, scope.featureId] as const;
  const query = useQuery({
    queryKey: ["tasks", ...args],
    queryFn: ({ signal }) => api.listTasks(...args, { signal }),
    retry: false,
  });
  const members = useQuery({
    queryKey: ["task-assignees", ...args],
    queryFn: ({ signal }) => api.listTaskAssignees(...args, { signal }),
    retry: false,
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: async ({
      item,
      edit,
    }: {
      item?: TaskItem;
      edit: TaskEditRequest;
    }) => {
      const body = { ...edit, title: edit.title.trim() };
      const signature = JSON.stringify([
        ...args,
        item?.id,
        item?.rowVersion,
        body,
      ]);
      if (retry.current?.signature !== signature)
        retry.current = { signature, key: createIdempotencyKey("task") };
      const csrf = await api.issueCsrfToken();
      const init = {
        headers: {
          "x-csrf-token": csrf.csrfToken,
          "Idempotency-Key": retry.current.key,
          ...(item ? { "If-Match": `"${item.rowVersion}"` } : {}),
        },
      };
      return item
        ? api.updateTask(...args, item.id, body, init)
        : api.createTask(...args, body, init);
    },
    onSuccess: async () => {
      retry.current = null;
      await Promise.all(
        ["tasks", "activity", "search", "notifications"].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });
  return { api, query, members, mutation };
}
