import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { SearchPage } from "./SearchPage";

describe("SearchPage", () => {
  it("loads search results from the q URL parameter", async () => {
    const getSearch = vi.fn().mockResolvedValue({
      items: [
        {
          projectId: 1,
          entityType: "FEATURE",
          entityId: 3,
          title: "InPulse 功能",
          summary: "功能摘要",
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
    const client = { getSearch } as unknown as InpulseApiClient;

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
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
});
