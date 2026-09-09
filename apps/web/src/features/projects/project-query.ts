import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type CreateProjectRequest,
  type InpulseApiClient,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";

export interface ProjectMutationOptions {
  readonly client?: InpulseApiClient | undefined;
}

export function describeProjectListError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录状态已失效，请重新登录后再查看项目。";
    if (error.status === 404) return "项目不存在或已无权访问。";
    return "项目列表暂时无法加载，请稍后重试。";
  }
  return "项目列表暂时无法加载，请稍后重试。";
}

export function useProjects({ client }: ProjectMutationOptions = {}) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  return useQuery({
    queryKey: ["projects"],
    queryFn: ({ signal }) => apiClient.listProjects({ signal }),
    retry: false,
  });
}

export function describeCreateProjectError(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.status) {
      case 401:
        return "登录状态已失效，请重新登录后再创建项目。";
      case 403:
        return "安全校验未通过，请刷新页面后重试。";
      case 409:
        return "项目编码已存在或创建请求发生冲突，请刷新后重试。";
      case 422:
        return "项目名称、编码或描述格式不正确，请检查后重试。";
      case 429:
        return "创建项目请求过于频繁，请稍后重试。";
      default:
        return "项目创建暂时失败，请稍后重试。";
    }
  }
  return "项目创建暂时失败，请稍后重试。";
}

export function useCreateProject({ client }: ProjectMutationOptions = {}) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (request: CreateProjectRequest) => {
      const csrf = await apiClient.issueCsrfToken();
      return apiClient.createProject(request, {
        headers: {
          "x-csrf-token": csrf.csrfToken,
          "Idempotency-Key": createIdempotencyKey("create-project"),
        },
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}
