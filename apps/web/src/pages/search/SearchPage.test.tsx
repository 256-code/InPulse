import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { InpulseApiClient, SearchItem } from "@generated/api";
import { SearchPage } from "./SearchPage";

function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

describe("SearchPage", () => {
  it("loads search results from the q URL parameter", async () => {
    const getSearch = vi.fn().mockResolvedValue({
      items: [
        {
          projectId: 1,
          entityType: "FEATURE",
          entityId: 3,
          moduleId: 2,
          featureId: 3,
          recordId: null,
          title: "InPulse 功能",
          summary: "功能摘要",
        } satisfies SearchItem,
      ],
      nextCursor: null,
      hasMore: false,
    });
    const client = { getSearch } as unknown as InpulseApiClient;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={["/search?q=inpulse"]}>
          <Routes>
            <Route path="/search" element={<SearchPage client={client} />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("InPulse 功能")).toBeInTheDocument();
    expect(getSearch).toHaveBeenCalledWith({
      q: "inpulse",
      cursor: undefined,
      limit: 20,
    });
  });

  it("navigates to the result's own page instead of staying on the search page", async () => {
    const user = userEvent.setup();
    const getSearch = vi.fn().mockResolvedValue({
      items: [
        {
          projectId: 1,
          entityType: "FEATURE",
          entityId: 3,
          moduleId: 2,
          featureId: 3,
          recordId: null,
          title: "InPulse 功能",
          summary: "功能摘要",
        } satisfies SearchItem,
      ],
      nextCursor: null,
      hasMore: false,
    });
    const client = { getSearch } as unknown as InpulseApiClient;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <MemoryRouter initialEntries={["/search?q=inpulse"]}>
          <Routes>
            <Route path="/search" element={<SearchPage client={client} />} />
            <Route
              path="/projects/:projectId/modules/:moduleId/features/:featureId"
              element={<div>功能档案落地页</div>}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    await user.click(await screen.findByRole("link", { name: /InPulse 功能/ }));
    expect(await screen.findByText("功能档案落地页")).toBeInTheDocument();
  });
});
