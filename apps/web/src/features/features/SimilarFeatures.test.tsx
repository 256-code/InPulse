import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { InpulseApiClient } from "@generated/api";
import { SimilarFeatures } from "./SimilarFeatures";

it("debounces names and never shows a late response for an obsolete query", async () => {
  let resolveOld!: (value: unknown) => void;
  const old = new Promise((resolve) => {
    resolveOld = resolve;
  });
  const find = vi
    .fn()
    .mockReturnValueOnce(old)
    .mockResolvedValue({
      items: [
        {
          id: 8,
          projectId: 2,
          moduleId: 4,
          code: "PR-F-8",
          name: "新候选",
          status: "ACTIVE",
        },
      ],
    });
  const client = { findSimilarFeatures: find } as unknown as InpulseApiClient;
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (name: string) => (
    <QueryClientProvider client={cache}>
      <SimilarFeatures projectId={2} moduleId={4} name={name} client={client} />
    </QueryClientProvider>
  );
  const result = render(view("旧名称"));
  expect(find).not.toHaveBeenCalled();
  await waitFor(() => expect(find).toHaveBeenCalledTimes(1));
  result.rerender(view("新名称"));
  await waitFor(() => expect(find).toHaveBeenCalledTimes(2));
  await screen.findByRole("link", { name: /新候选/ });
  await act(async () => {
    resolveOld({
      items: [
        {
          id: 7,
          projectId: 2,
          moduleId: 4,
          code: "PR-F-7",
          name: "过期候选",
          status: "ACTIVE",
        },
      ],
    });
  });
  expect(screen.queryByText(/过期候选/)).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /新候选/ })).toHaveAttribute(
    "href",
    "/projects/2/modules/4/features/8",
  );
});
