import React from "react";
import { describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActivityPage, InpulseApiClient } from "@generated/api";
import { useActivityInfiniteQuery } from "./activity-query";

function createQueryWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return {
    queryClient,
    wrapper: ({ children }: { readonly children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  };
}

describe("useActivityInfiniteQuery", () => {
  it("sends project scope and follows the next cursor", async () => {
    const getProjectActivity = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            id: "1",
            projectId: 7,
            sourceEntityType: "TASK",
            sourceEntityId: 3,
            activityType: "TASK_COMPLETED",
            actorId: 1,
            summary: "完成任务",
            occurredAt: "2026-09-08T00:00:00.000Z",
          },
        ],
        nextCursor: "cursor-1",
        hasMore: true,
      } satisfies ActivityPage)
      .mockResolvedValueOnce({
        items: [],
        nextCursor: null,
        hasMore: false,
      } satisfies ActivityPage);
    const client = { getProjectActivity } as unknown as InpulseApiClient;
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () =>
        useActivityInfiniteQuery({
          projectId: 7,
          client,
          includeAdminOnly: true,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(getProjectActivity).toHaveBeenCalledWith(
      7,
      { cursor: undefined, includeAdminOnly: true, limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    await act(async () => {
      await result.current.fetchNextPage();
    });
    expect(getProjectActivity).toHaveBeenLastCalledWith(
      7,
      { cursor: "cursor-1", includeAdminOnly: true, limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
