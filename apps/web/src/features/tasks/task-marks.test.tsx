import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { InpulseApiClient, TaskGroupMembershipItem } from "@generated/api";
import {
  chunkTaskMarkIds,
  TASK_MARK_IDS_MAX,
  toTaskMarkMap,
  useTaskMarks,
} from "./task-marks";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
function wrapper({ children }: { readonly children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("task marks helpers", () => {
  it("deduplicates and sorts ids before chunking at the R-5 upper bound", () => {
    expect(chunkTaskMarkIds([])).toEqual([]);
    expect(chunkTaskMarkIds([3, 1, 3, 2])).toEqual([[1, 2, 3]]);
    const many = Array.from(
      { length: TASK_MARK_IDS_MAX + 1 },
      (_, index) => TASK_MARK_IDS_MAX + 1 - index,
    );
    const chunks = chunkTaskMarkIds(many);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(TASK_MARK_IDS_MAX);
    expect(chunks[0]![0]).toBe(1);
    expect(chunks[1]).toEqual([TASK_MARK_IDS_MAX + 1]);
  });

  it("indexes the batch response by task id, keeping ungrouped entries", () => {
    const items: TaskGroupMembershipItem[] = [
      { taskId: 1, groupId: 9, groupRole: "MAIN", publishedRecordCount: 3 },
      { taskId: 2, groupId: null, groupRole: null, publishedRecordCount: 0 },
      { taskId: 3, groupId: 9, groupRole: "SOURCE", publishedRecordCount: 1 },
    ];
    const marks = toTaskMarkMap(items);
    expect(marks.get(1)).toEqual({
      groupId: 9,
      groupRole: "MAIN",
      publishedRecordCount: 3,
    });
    expect(marks.get(2)).toEqual({
      groupId: null,
      groupRole: null,
      publishedRecordCount: 0,
    });
    expect(marks.get(3)?.groupRole).toBe("SOURCE");
  });
});

describe("useTaskMarks", () => {
  it("reads the whole page with one sorted batch call", async () => {
    const listTaskGroupMemberships = vi.fn().mockResolvedValue({
      items: [
        { taskId: 2, groupId: null, groupRole: null, publishedRecordCount: 0 },
        { taskId: 1, groupId: 9, groupRole: "MAIN", publishedRecordCount: 3 },
      ],
    });
    const api = { listTaskGroupMemberships } as unknown as InpulseApiClient;
    const { result } = renderHook(() => useTaskMarks(api, [2, 1, 2]), {
      wrapper,
    });
    await waitFor(() => expect(result.current.size).toBe(2));
    expect(listTaskGroupMemberships).toHaveBeenCalledTimes(1);
    expect(listTaskGroupMemberships.mock.calls[0]![0]).toEqual({
      taskIds: [1, 2],
    });
    expect(result.current.get(1)?.publishedRecordCount).toBe(3);
    expect(result.current.get(2)).toEqual({
      groupId: null,
      groupRole: null,
      publishedRecordCount: 0,
    });
  });

  it("does not request marks without tasks", async () => {
    const listTaskGroupMemberships = vi.fn();
    const api = { listTaskGroupMemberships } as unknown as InpulseApiClient;
    const { result } = renderHook(() => useTaskMarks(api, []), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listTaskGroupMemberships).not.toHaveBeenCalled();
    expect(result.current.size).toBe(0);
  });

  it("degrades to an empty mark set when the batch read fails", async () => {
    const listTaskGroupMemberships = vi
      .fn()
      .mockRejectedValue(new Error("offline"));
    const api = { listTaskGroupMemberships } as unknown as InpulseApiClient;
    const { result } = renderHook(() => useTaskMarks(api, [5]), { wrapper });
    await waitFor(() =>
      expect(listTaskGroupMemberships).toHaveBeenCalledTimes(1),
    );
    await waitFor(() => expect(result.current.size).toBe(0));
  });
});
