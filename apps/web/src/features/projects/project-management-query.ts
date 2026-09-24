import { useMemo, useRef } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type InpulseApiClient,
  type ProjectEditRequest,
  type ProjectStatusChangeRequest,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";

export type ProjectManagementAction = "update" | "status";

export function describeProjectManagementError(
  error: unknown,
  action: ProjectManagementAction,
): string {
  const actionLabel = action === "update" ? "编辑" : "状态变更";
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "登录状态已失效，请重新登录后再操作项目。";
    }
    if (error.status === 403) {
      return "安全校验未通过，请刷新页面后重试。";
    }
    if (error.status === 404) return "项目不存在或你已无权访问。";
    if (error.status === 409) {
      if (error.code === "PROJECT_VERSION_CONFLICT") {
        return "项目内容已被他人更新，请加载最新版本后重试。";
      }
      if (error.code === "PROJECT_STATE_CONFLICT") {
        return "项目已处于所选状态，请刷新后重试。";
      }
      if (error.code === "PROJECT_MAINTENANCE_TASKS_OPEN") {
        return "项目下仍有未完成、也未归档的任务，请先完成或归档全部任务再切换为维护中。";
      }
      if (error.code === "PROJECT_STATUS_NOT_STARTED_LOCKED") {
        return "项目里已经出现过已完成任务，不能再退回「未开始」。";
      }
      if (error.code === "PROJECT_STATUS_LEVEL_SKIP") {
        return "「未开始」与「维护中」不能直接互相切换，请先切到「进行中」。";
      }
      return "项目状态已变化，请刷新列表后重试。";
    }
    if (error.status === 422) {
      return "请检查项目名称或描述。";
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

/**
 * ADR-039/ADR-043：本项目任意活跃成员或系统管理员手动切换项目生命周期状态；
 * 项目只有未开始 / 进行中 / 维护中三态，归档与恢复已随项目归档一并下线。
 * 进入维护中要求项目下任务全部收尾（否则 409），「维护中」本身不通知，
 * 「未开始 → 进行中」会由服务端通知全体活跃成员。
 */
export function useChangeProjectStatus(
  projectId: number,
  client?: InpulseApiClient,
) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const cache = useQueryClient();
  const retryKey = useRetryKey();

  return useMutation({
    retry: false,
    mutationFn: async (input: {
      readonly status: ProjectStatusChangeRequest["status"];
      readonly rowVersion: number;
    }) => {
      const key = retryKey(
        JSON.stringify([projectId, input.rowVersion, input.status]),
        "project-status",
      );
      const csrf = await api.issueCsrfToken();
      return api.changeProjectStatus(
        projectId,
        { status: input.status },
        { headers: mutationHeaders(csrf.csrfToken, key, input.rowVersion) },
      );
    },
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
