import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InpulseApiClient } from "@generated/api";
import { ActivityIndexPageView } from "./ActivityIndexPageView";

describe("ActivityIndexPageView", () => {
  it("searches accessible projects and opens their activity timeline", async () => {
    const user = userEvent.setup();
    const getSearch = vi.fn().mockResolvedValue({
      items: [
        {
          projectId: 7,
          entityType: "PROJECT",
          entityId: 7,
          title: "商城系统",
          summary: "SHOP · 商城项目描述",
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
    const client = { getSearch } as unknown as InpulseApiClient;
    const onOpenProject = vi.fn();

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <ActivityIndexPageView client={client} onOpenProject={onOpenProject} />
      </QueryClientProvider>,
    );

    expect(screen.getByText("先找到你要查看的项目")).toBeInTheDocument();
    await user.type(screen.getByLabelText("搜索项目"), "商城");
    await user.click(await screen.findByTestId("activity-project-7"));

    expect(getSearch).toHaveBeenCalledWith(
      expect.objectContaining({ q: "商城", limit: 20 }),
    );
    expect(onOpenProject).toHaveBeenCalledWith(7);
  });
});
