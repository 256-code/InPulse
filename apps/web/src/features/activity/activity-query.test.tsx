import React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ActivityItem,
  ActivityPage,
  InpulseApiClient,
} from "@generated/api";
import { mergeActivityPages, useActivityFeedQuery } from "./activity-query";

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

function activityItem(patch: Partial<ActivityItem>): ActivityItem {
  return {
    id: "1",
    projectId: 7,
    sourceEntityType: "TASK",
    sourceEntityId: 3,
    activityType: "task.complete",
    actorId: 1,
    summary: "任务完成：完成任务",
    occurredAt: "2026-09-08T00:00:00.000Z",
    ...patch,
  };
}

const PAGE_BY_REQUEST: Readonly<Record<string, ActivityPage>> = {
  "7:": {
    items: [activityItem({ id: "1", projectId: 7 })],
    nextCursor: "cursor-7",
    hasMore: true,
  },
  "9:": {
    items: [
      activityItem({
        id: "2",
        projectId: 9,
        occurredAt: "2026-09-08T00:00:09.000Z",
      }),
    ],
    nextCursor: null,
    hasMore: false,
  },
  "7:cursor-7": {
    items: [
      activityItem({
        id: "3",
        projectId: 7,
        occurredAt: "2026-09-07T00:00:00.000Z",
      }),
    ],
    nextCursor: null,
    hasMore: false,
  },
};

function createActivityClient() {
  const getProjectActivity = vi.fn(
    (projectId: number, params: { readonly cursor?: string }) => {
      const page = PAGE_BY_REQUEST[`${projectId}:${params.cursor ?? ""}`];
      if (!page) throw new Error(`unexpected request: ${projectId}`);
      return Promise.resolve(page);
    },
  );
  return {
    getProjectActivity,
    client: { getProjectActivity } as unknown as InpulseApiClient,
  };
}

interface FeedProbeProps {
  readonly client: InpulseApiClient;
}

function FeedProbe({ client }: FeedProbeProps) {
  const query = useActivityFeedQuery({
    projectIds: [7, 9],
    client,
    includeAdminOnly: true,
  });
  return (
    <div>
      <span data-testid="page-count">{query.data?.pages.length ?? 0}</span>
      <span data-testid="has-next">{String(query.hasNextPage)}</span>
      <span data-testid="item-count">
        {mergeActivityPages(query.data?.pages ?? []).length}
      </span>
      <button type="button" onClick={() => void query.fetchNextPage()}>
        加载更多
      </button>
    </div>
  );
}

describe("mergeActivityPages", () => {
  it("orders the merged stream by time desc and id desc", () => {
    const merged = mergeActivityPages([
      {
        items: [
          activityItem({ id: "3", occurredAt: "2026-09-08T00:00:05.000Z" }),
          activityItem({ id: "1", occurredAt: "2026-09-08T00:00:01.000Z" }),
        ],
        next: null,
      },
      {
        items: [
          activityItem({ id: "4", occurredAt: "2026-09-08T00:00:05.000Z" }),
          activityItem({
            id: "2",
            projectId: 9,
            occurredAt: "2026-09-08T00:00:03.000Z",
          }),
        ],
        next: null,
      },
    ]);

    expect(merged.map((item) => item.id)).toEqual(["4", "3", "2", "1"]);
  });
});

describe("useActivityFeedQuery", () => {
  it("aggregates every project and follows each project cursor", async () => {
    const { getProjectActivity, client } = createActivityClient();
    const { queryClient } = createQueryWrapper();

    render(
      <QueryClientProvider client={queryClient}>
        <FeedProbe client={client} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("page-count").textContent).toBe("1"),
    );
    expect(getProjectActivity).toHaveBeenCalledWith(
      7,
      { includeAdminOnly: true, limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(getProjectActivity).toHaveBeenCalledWith(
      9,
      { includeAdminOnly: true, limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByTestId("has-next").textContent).toBe("true");
    expect(screen.getByTestId("item-count").textContent).toBe("2");

    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));

    await waitFor(() =>
      expect(screen.getByTestId("page-count").textContent).toBe("2"),
    );
    // 只有 7 号项目还有下一页，9 号项目不再发请求。
    expect(getProjectActivity).toHaveBeenLastCalledWith(
      7,
      { cursor: "cursor-7", includeAdminOnly: true, limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(getProjectActivity).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId("has-next").textContent).toBe("false");
    expect(screen.getByTestId("item-count").textContent).toBe("3");
  });

  it("does not request anything when the scope is empty", async () => {
    const { getProjectActivity, client } = createActivityClient();
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useActivityFeedQuery({ projectIds: [], client }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.fetchStatus).toBe("idle"));
    expect(getProjectActivity).not.toHaveBeenCalled();
  });
});
