import { useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type InpulseApiClient,
  type ProjectMemberReassignmentItem,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";

export function isAdminReauthRequired(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error &&
    (error as { readonly status: unknown }).status === 403 &&
    (error as { readonly code: unknown }).code === "ADMIN_REAUTH_REQUIRED"
  );
}

export function projectMemberErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401)
      return "登录状态已失效，请重新登录后再查看项目成员。";
    if (error.status === 403) {
      return error.code === "ADMIN_REAUTH_REQUIRED"
        ? "请先完成管理员安全验证，再继续项目成员管理。"
        : "只有系统管理员可以管理项目成员。";
    }
    if (error.status === 404) return "项目或成员不存在，或你已无权访问。";
    if (error.status === 409) {
      if (error.code === "PROJECT_MEMBER_ALREADY_ACTIVE")
        return "该用户已经是项目活跃成员。";
      if (error.code === "PROJECT_MEMBER_PROJECT_ARCHIVED")
        return "项目已归档，不能变更项目成员。";
      if (error.code === "PROJECT_MEMBER_TASK_NOT_REASSIGNABLE")
        return "待改派任务已发生变化，请重新加载后重试。";
      return "项目成员状态已变化，请刷新列表后重试。";
    }
    if (error.status === 422) return "请检查成员信息或任务改派参数。";
    if (error.status === 429) return "请求过于频繁，请稍后重试。";
  }
  return "项目成员服务暂时不可用，请重试。";
}

function mutationHeaders(
  csrfToken: string,
  idempotencyKey: string,
): Readonly<Record<string, string>> {
  return {
    "x-csrf-token": csrfToken,
    "Idempotency-Key": idempotencyKey,
  };
}

export function useProjectMembers(
  projectId: number,
  client?: InpulseApiClient,
) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const cache = useQueryClient();
  const addRetryKey = useRef<{ signature: string; key: string } | null>(null);
  const removeRetryKey = useRef<{ signature: string; key: string } | null>(
    null,
  );

  const query = useQuery({
    queryKey: ["project-members", projectId],
    queryFn: ({ signal }) => api.listProjectMembers(projectId, { signal }),
    retry: false,
    enabled: Number.isInteger(projectId) && projectId > 0,
  });

  const addMutation = useMutation({
    retry: false,
    mutationFn: async (input: { readonly userId: number }) => {
      const signature = JSON.stringify([projectId, input.userId]);
      if (addRetryKey.current?.signature !== signature) {
        addRetryKey.current = {
          signature,
          key: createIdempotencyKey("project-member-add"),
        };
      }
      const csrf = await api.issueCsrfToken();
      return api.addProjectMember(
        projectId,
        { userId: input.userId },
        {
          headers: mutationHeaders(csrf.csrfToken, addRetryKey.current.key),
        },
      );
    },
    onSuccess: async () => {
      addRetryKey.current = null;
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["project-members", projectId] }),
        cache.invalidateQueries({ queryKey: ["projects"] }),
      ]);
    },
  });

  const removeMutation = useMutation({
    retry: false,
    mutationFn: async (input: {
      readonly userId: number;
      readonly reassignments: readonly ProjectMemberReassignmentItem[];
    }) => {
      const signature = JSON.stringify([
        projectId,
        input.userId,
        input.reassignments,
      ]);
      if (removeRetryKey.current?.signature !== signature) {
        removeRetryKey.current = {
          signature,
          key: createIdempotencyKey("project-member-remove"),
        };
      }
      const csrf = await api.issueCsrfToken();
      return api.removeProjectMember(
        projectId,
        input.userId,
        { reassignments: [...input.reassignments] },
        {
          headers: mutationHeaders(csrf.csrfToken, removeRetryKey.current.key),
        },
      );
    },
    onSuccess: async () => {
      removeRetryKey.current = null;
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["project-members", projectId] }),
        cache.invalidateQueries({ queryKey: ["projects"] }),
        cache.invalidateQueries({
          queryKey: ["project-member-unfinished-tasks", projectId],
        }),
      ]);
    },
  });

  return { query, addMutation, removeMutation };
}

export function useProjectMemberUnfinishedTasks(
  projectId: number,
  userId: number | undefined,
  client?: InpulseApiClient,
  enabled = true,
) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  return useQuery({
    queryKey: ["project-member-unfinished-tasks", projectId, userId],
    queryFn: ({ signal }) =>
      api.listProjectMemberUnfinishedTasks(projectId, userId!, { signal }),
    retry: false,
    enabled:
      enabled &&
      Number.isInteger(projectId) &&
      projectId > 0 &&
      Number.isInteger(userId) &&
      userId! > 0,
  });
}
