import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InpulseApiClient } from "@generated/api";
import { CommandPalette } from "./CommandPalette";

describe("CommandPalette", () => {
  it("searches through the generated client and opens the search page for a result", async () => {
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
    const onClose = vi.fn();
    const onNavigate = vi.fn();
    const onOpenSearch = vi.fn();

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <CommandPalette
          open
          client={client}
          onClose={onClose}
          onNavigate={onNavigate}
          onOpenSearch={onOpenSearch}
        />
      </QueryClientProvider>,
    );

    expect(
      screen.getByRole("dialog", { name: "全局搜索" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^打开任务中心/ }),
    ).toBeInTheDocument();
    await user.type(screen.getByLabelText("全局搜索关键词"), "inpulse");

    expect(getSearch).toHaveBeenCalledWith(
      expect.objectContaining({ q: "inpulse", limit: 20 }),
    );
    await user.click(
      await screen.findByRole("button", { name: /^搜索“inpulse”/ }),
    );
    expect(onOpenSearch).toHaveBeenCalledWith("inpulse");
    expect(onClose).toHaveBeenCalled();
  });

  it("closes with Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <CommandPalette
          open
          onClose={onClose}
          onNavigate={vi.fn()}
          onOpenSearch={vi.fn()}
        />
      </QueryClientProvider>,
    );

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });
});
