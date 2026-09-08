import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InpulseApiClient } from "@generated/api";
import { ActivityPageView } from "./ActivityPageView";

describe("ActivityPageView", () => {
  it("renders project activity and shows the project scope", async () => {
    const getProjectActivity = vi.fn().mockResolvedValue({
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
      nextCursor: null,
      hasMore: false,
    });
    const client = { getProjectActivity } as unknown as InpulseApiClient;

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <ActivityPageView projectId={7} client={client} showAdminToggle />
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId("activity-item-1")).toBeInTheDocument();
    expect(screen.getAllByText("完成任务").length).toBeGreaterThan(0);
    expect(screen.getByText("项目 #7")).toBeInTheDocument();
    expect(screen.getByLabelText("包含管理员操作")).toBeInTheDocument();
    expect(getProjectActivity).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ limit: 20 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
