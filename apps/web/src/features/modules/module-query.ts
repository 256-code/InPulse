import { useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type InpulseApiClient,
  type ModuleEditRequest,
  type ModuleItem,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";

/** ADR-044：模块层面已下线归档，模块命令只有新建与编辑。 */
export type ModuleChange = {
  action: "create" | "update";
  item?: ModuleItem;
  name: string;
  description: string;
};
export function moduleErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return `${error.message}。输入已保留，请检查冲突并加载最新版本后继续编辑。`;
    }
    if (error.status === 401) return "登录状态已失效，请重新登录。";
    if (error.status === 404) return "项目或模块不存在，或你已无权访问。";
    if (error.status === 403)
      return "你没有执行此操作的权限，或安全校验未通过。";
    if (error.status === 422) return "请检查模块名称或描述。";
  }
  return "模块服务暂时不可用，请重试。";
}

export function useModules(projectId: number, client?: InpulseApiClient) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const cache = useQueryClient();
  const retryKey = useRef<{ signature: string; key: string } | null>(null);
  const query = useQuery({
    queryKey: ["modules", projectId],
    queryFn: ({ signal }) => api.listModules(projectId, { signal }),
    retry: false,
    enabled: Number.isInteger(projectId) && projectId > 0,
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: async (change: ModuleChange) => {
      const edit: ModuleEditRequest = {
        name: change.name.trim(),
        description: change.description,
      };
      const signature = JSON.stringify([
        projectId,
        change.action,
        change.item?.id,
        change.item?.rowVersion,
        edit,
      ]);
      if (retryKey.current?.signature !== signature)
        retryKey.current = { signature, key: createIdempotencyKey("module") };
      const csrf = await api.issueCsrfToken();
      const init = {
        headers: {
          "x-csrf-token": csrf.csrfToken,
          "Idempotency-Key": retryKey.current.key,
          ...(change.item ? { "If-Match": `"${change.item.rowVersion}"` } : {}),
        },
      };
      if (change.action === "create")
        return api.createModule(projectId, edit, init);
      if (!change.item) throw new Error("Module selection missing");
      return api.updateModule(projectId, change.item.id, edit, init);
    },
    onSuccess: async () => {
      retryKey.current = null;
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["modules", projectId] }),
        cache.invalidateQueries({ queryKey: ["activity", projectId] }),
        cache.invalidateQueries({ queryKey: ["search"] }),
      ]);
    },
  });
  return { query, mutation };
}
