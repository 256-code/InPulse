import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type InpulseApiClient,
} from "@generated/api";

export interface UserDirectoryQueryOptions {
  readonly client?: InpulseApiClient | undefined;
  readonly enabled?: boolean;
}

export function describeUserDirectoryError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) {
      return "登录状态已失效，请重新登录后再选择成员。";
    }
    if (error.status === 429) {
      return "用户目录请求过于频繁，请稍后重试。";
    }
  }
  return "用户目录暂时不可用，请稍后重试。";
}

export function useUserDirectoryQuery({
  client,
  enabled = true,
}: UserDirectoryQueryOptions) {
  const apiClient = useMemo(() => client ?? createApiClient(), [client]);
  return useQuery({
    queryKey: ["users", "directory"],
    queryFn: async () => (await apiClient.getUserDirectory()).items,
    enabled,
    staleTime: 60_000,
  });
}
