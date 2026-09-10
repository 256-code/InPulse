import React from "react";
import { ConfigProvider } from "antd";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type {
  InpulseApiClient,
  TaskGroupDetailResponse,
  TaskGroupMemberDetail,
  TaskGroupRecordPage,
} from "@generated/api";
import type { TaskGroupAdapter } from "@features/task-groups/task-groups-types";
import { TaskGroupPage } from "./TaskGroupPage";

const mainMember: TaskGroupMemberDetail = {
  taskId: 201,
  taskCode: "PR-T-1",
  title: "退款主任务",
  role: "MAIN",
  sourceKind: null,
  memberStatus: "ACTIVE",
  workStatus: "TODO",
  lifecycleStatus: "ACTIVE",
  moduleId: 3,
  featureId: 4,
  assignee: { userId: 7, name: "李四", avatarUrl: null },
  joinedAt: "2026-09-01T12:00:00.000Z",
  detachedAt: null,
  detachReason: null,
  publishedRecordCount: 1,
};

const sourceMember: TaskGroupMemberDetail = {
  ...mainMember,
  taskId: 202,
  taskCode: "PR-T-2",
  title: "重复回调分支",
  role: "SOURCE",
  sourceKind: "ACTIVE",
  joinedAt: "2026-09-02T12:00:00.000Z",
};

function detail(): TaskGroupDetailResponse {
  return {
    group: {
      groupId: 12,
      projectId: 2,
      code: "TG-12",
      name: "退款聚合组",
      status: "ACTIVE",
      createdAt: "2026-09-01T12:00:00.000Z",
      closedAt: null,
      rowVersion: 1,
    },
    members: [mainMember, sourceMember],
  };
}

function emptyPage(): TaskGroupRecordPage {
  return { items: [], nextCursor: null, hasMore: false };
}

function createAdapter(): TaskGroupAdapter {
  return {
    source: "server",
    notice: "测试接口说明",
    fetchTaskGroup: vi.fn().mockResolvedValue(detail()),
    fetchTaskGroupRecords: vi.fn().mockResolvedValue(emptyPage()),
  };
}

function mount(path: string, adapter: TaskGroupAdapter) {
  const api = {} as InpulseApiClient;
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/tasks" element={<div>任务中心占位</div>} />
            <Route
              path="/task-groups/:groupId"
              element={<TaskGroupPage client={api} adapter={adapter} />}
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ConfigProvider>,
  );
}

describe("F-25 task group page container", () => {
  it("rejects an invalid group id before loading data", async () => {
    const adapter = createAdapter();
    mount("/task-groups/abc", adapter);
    expect(await screen.findByText("聚合组地址无效")).toBeInTheDocument();
    expect(adapter.fetchTaskGroup).not.toHaveBeenCalled();
  });

  it("renders the injected adapter and returns to the task center", async () => {
    mount("/task-groups/12", createAdapter());
    await screen.findByText("退款主任务");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "任务中心" }));
    expect(await screen.findByText("任务中心占位")).toBeInTheDocument();
  });

  it("reads the member filter from the URL and keeps it updated", async () => {
    const adapter = createAdapter();
    mount("/task-groups/12?task=202", adapter);
    await screen.findByText("退款主任务");
    await waitFor(() =>
      expect(adapter.fetchTaskGroupRecords).toHaveBeenCalledWith(12, {
        memberTaskId: 202,
      }),
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "主任务" }));
    await waitFor(() =>
      expect(adapter.fetchTaskGroupRecords).toHaveBeenCalledWith(12, {
        memberTaskId: 201,
      }),
    );
  });

  it("ignores an invalid member filter value in the URL", async () => {
    const adapter = createAdapter();
    mount("/task-groups/12?task=abc", adapter);
    await screen.findByText("退款主任务");
    await waitFor(() =>
      expect(adapter.fetchTaskGroupRecords).toHaveBeenCalledWith(12, {}),
    );
  });
});
