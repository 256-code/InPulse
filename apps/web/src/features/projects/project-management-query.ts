import { useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type InpulseApiClient,
  type ProjectEditRequest,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";

export type ProjectManagementAction = "update" | "archive" | "restore";

export function describeProjectManagementError(
  error: unknown,
  action: ProjectManagementAction,
): string {
  const actionLabel =
    action === "update" ? "编辑" : action === "archive" ? "归档" : "恢复";
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "登录状态已失效，请重新登录后再操作项目。";
    }
    if (error.status === 403) {
      if (error.code === "ADMIN_REAUTH_REQUIRED") {
        return "请先完成管理员安全验证，再继续归档或恢复项目。";
      }
      if (error.code === "ADMIN_REQUIRED") {
        return "只有系统管理员可以归档或恢复项目。";
      }
      return "安全校验未通过，请刷新页面后重试。";
    }
    if (error.status === 404) return "项目不存在或你已无权访问。";
    if (error.status === 409) {
      if (error.code === "PROJECT_VERSION_CONFLICT") {
        return "项目内容已被他人更新，请加载最新版本后重试。";
      }
      if (error.code === "PROJECT_ARCHIVED") {
        return "项目已归档，项目只读；需要先恢复后才能编辑。";
      }
      if (error.code === "PROJECT_STATE_CONFLICT") {
        return action === "archive"
          ? "项目已归档，不能重复归档。"
          : "项目当前未归档，无法恢复。";
      }
      return "项目状态已变化，请刷新列表后重试。";
    }
    if (error.status === 422) {
      return "请检查项目名称、描述或归档原因。";
    }
    if (error.status === 429) return "请求过于频繁，请稍后重试。";
  }
  return `项目${actionLabel}暂时失败，请稍后重试。`;
}

interface RetryKey {
  readonly signature: string;
  readonly key: string;
}

function useRetryKey() {
  const ref = useRef<RetryKey | null>(null);
  return (signature: string, prefix: string): string => {
    if (ref.current?.signature !== signature) {
      ref.current = { signature, key: createIdempotencyKey(prefix) };
    }
    return ref.current.key;
  };
}

function mutationHeaders(
  csrfToken: string,
  idempotencyKey: string,
  rowVersion: number,
): Readonly<Record<string, string>> {
  return {
    "x-csrf-token": csrfToken,
    "Idempotency-Key": idempotencyKey,
    "If-Match": `"${rowVersion}"`,
  };
}

export function useUpdateProject(projectId: number, client?: InpulseApiClient) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const cache = useQueryClient();
  const retryKey = useRetryKey();

  return useMutation({
    retry: false,
    mutationFn: async (input: {
      readonly edit: ProjectEditRequest;
      readonly rowVersion: number;
    }) => {
      const key = retryKey(
        JSON.stringify([projectId, input.rowVersion, input.edit]),
        "project-update",
      );
      const csrf = await api.issueCsrfToken();
      return api.updateProject(projectId, input.edit, {
        headers: mutationHeaders(csrf.csrfToken, key, input.rowVersion),
      });
    },
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useArchiveProject(
  projectId: number,
  client?: InpulseApiClient,
) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const cache = useQueryClient();
  const retryKey = useRetryKey();

  return useMutation({
    retry: false,
    mutationFn: async (input: {
      readonly reason: string;
      readonly rowVersion: number;
    }) => {
      const key = retryKey(
        JSON.stringify([projectId, input.rowVersion, input.reason]),
        "project-archive",
      );
      const csrf = await api.issueCsrfToken();
      return api.archiveProject(
        projectId,
        { reason: input.reason },
        { headers: mutationHeaders(csrf.csrfToken, key, input.rowVersion) },
      );
    },
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useRestoreProject(
  projectId: number,
  client?: InpulseApiClient,
) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const cache = useQueryClient();
  const retryKey = useRetryKey();

  return useMutation({
    retry: false,
    mutationFn: async (input: {
      readonly reason: string;
      readonly rowVersion: number;
    }) => {
      const key = retryKey(
        JSON.stringify([projectId, input.rowVersion, input.reason]),
        "project-restore",
      );
      const csrf = await api.issueCsrfToken();
      return api.restoreProject(
        projectId,
        { reason: input.reason },
        { headers: mutationHeaders(csrf.csrfToken, key, input.rowVersion) },
      );
    },
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export function useProjectArchivePreview(
  projectId: number | null,
  client?: InpulseApiClient,
  enabled = true,
) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  return useQuery({
    queryKey: ["project-archive-preview", projectId],
    queryFn: ({ signal }) =>
      api.getProjectArchivePreview(projectId as number, { signal }),
    retry: false,
    enabled:
      enabled &&
      projectId !== null &&
      Number.isInteger(projectId) &&
      projectId > 0,
  });
}
