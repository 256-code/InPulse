import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ApiError,
  type InpulseApiClient,
  type SearchItem,
} from "@generated/api";
import { SearchPageView } from "./SearchPageView";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("SearchPageView", () => {
  it("renders search results and loads the next page", async () => {
    const user = userEvent.setup();
    const getSearch = vi
      .fn()
      .mockResolvedValueOnce({
        items: [
          {
            projectId: 1,
            entityType: "PROJECT",
            entityId: 1,
            title: "InPulse 项目",
            summary: "项目摘要",
          } satisfies SearchItem,
        ],
        nextCursor: "cursor-1",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [
          {
            projectId: 1,
            entityType: "TASK",
            entityId: 2,
            title: "InPulse 任务",
            summary: "任务摘要",
          } satisfies SearchItem,
        ],
        nextCursor: null,
        hasMore: false,
      });
    const client = { getSearch } as unknown as InpulseApiClient;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <SearchPageView initialQuery="inpulse" client={client} />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("InPulse 项目")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByText("InPulse 任务")).toBeInTheDocument();
    expect(getSearch).toHaveBeenLastCalledWith({
      q: "inpulse",
      cursor: "cursor-1",
      limit: 20,
    });
  });

  it("shows a validation hint without calling the API for a short query", async () => {
    const getSearch = vi.fn();
    const client = { getSearch } as unknown as InpulseApiClient;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <SearchPageView initialQuery="a" client={client} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("搜索词需为 2～200 个字符"),
    ).toBeInTheDocument();
    expect(getSearch).not.toHaveBeenCalled();
  });

  it("shows a generic login message for a 401 response", async () => {
    const getSearch = vi.fn().mockRejectedValue(
      new ApiError(401, {
        code: "UNAUTHORIZED",
        message: "server-internal-message",
        details: {},
        requestId: "request-1",
      }),
    );
    const client = { getSearch } as unknown as InpulseApiClient;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <SearchPageView initialQuery="inpulse" client={client} />
      </QueryClientProvider>,
    );

    expect(
      await screen.findByText("登录状态已失效，请先登录后再使用全局搜索。"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("server-internal-message"),
    ).not.toBeInTheDocument();
  });
});
