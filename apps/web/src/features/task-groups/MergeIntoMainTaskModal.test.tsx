import React from "react";
import { ConfigProvider } from "antd";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type InpulseApiClient,
  type SearchItem,
} from "@generated/api";
import { MergeIntoMainTaskModal } from "./MergeIntoMainTaskModal";

const task = { id: 101, code: "PR-T-1", title: "退款主任务", projectId: 2 };

const candidate: SearchItem = {
  projectId: 2,
  entityType: "TASK",
  entityId: 102,
  title: "重复回调任务 A",
  summary: "任务",
};
const selfCandidate: SearchItem = {
  ...candidate,
  entityId: 101,
  title: "退款主任务",
};
const otherProjectCandidate: SearchItem = {
  ...candidate,
  projectId: 3,
  entityId: 103,
  title: "其他项目任务",
};
const featureCandidate: SearchItem = {
  projectId: 2,
  entityType: "FEATURE",
  entityId: 104,
  title: "退款功能",
  summary: "功能",
};

const searchLabel = /主任务（搜索任务编号或标题/;

function createApi() {
  const getSearch = vi.fn().mockResolvedValue({
    items: [candidate, selfCandidate, otherProjectCandidate, featureCandidate],
    nextCursor: null,
    hasMore: false,
  });
  const mergeTaskGroup = vi.fn().mockResolvedValue({
    id: 7,
    projectId: 2,
    code: "TG-7",
    name: "退款聚合组",
    status: "ACTIVE",
    createdAt: "2026-09-10T12:00:00.000Z",
    closedAt: null,
    rowVersion: 1,
  });
  const issueCsrfToken = vi
    .fn()
    .mockResolvedValue({ csrfToken: "a".repeat(43) });
  return {
    api: {
      getSearch,
      mergeTaskGroup,
      issueCsrfToken,
    } as unknown as InpulseApiClient,
    getSearch,
    mergeTaskGroup,
    issueCsrfToken,
  };
}

function mount(options: { api?: InpulseApiClient } = {}) {
  const onMerged = vi.fn();
  const onClose = vi.fn();
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MergeIntoMainTaskModal
          open
          task={task}
          api={options.api ?? createApi().api}
          onClose={onClose}
          onMerged={onMerged}
        />
      </QueryClientProvider>
    </ConfigProvider>,
  );
  return { onMerged, onClose };
}

describe("F-23 merge into main task", () => {
  it("waits for two characters and the debounce before searching", async () => {
    const { api, getSearch } = createApi();
    mount({ api });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(searchLabel), "退");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    expect(getSearch).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(searchLabel), "款");
    await waitFor(() => expect(getSearch).toHaveBeenCalledTimes(1), {
      timeout: 2000,
    });
    expect(getSearch).toHaveBeenCalledWith({ q: "退款", limit: 20 });
  });

  it("keeps only same-project TASK candidates and excludes the source task", async () => {
    const { api, getSearch } = createApi();
    mount({ api });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(searchLabel), "退款");
    expect(await screen.findByText("重复回调任务 A")).toBeInTheDocument();
    expect(screen.queryByText("退款主任务")).toBeNull();
    expect(screen.queryByText("其他项目任务")).toBeNull();
    expect(screen.queryByText("退款功能")).toBeNull();
    expect(getSearch).toHaveBeenCalledWith({ q: "退款", limit: 20 });
  });

  it("submits with CSRF, idempotency key, branch kind and returns the group id", async () => {
    const { api, mergeTaskGroup, issueCsrfToken } = createApi();
    const { onMerged } = mount({ api });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(searchLabel), "退款");
    await user.click(
      await screen.findByRole("button", { name: /重复回调任务 A/ }),
    );
    expect(
      screen.getByText("已选择主任务：重复回调任务 A"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: /历史来源分支/ }));
    await user.type(
      screen.getByLabelText("合并说明（选填）"),
      "  合并不删历史  ",
    );
    await user.click(screen.getByRole("button", { name: "确认合并" }));
    await waitFor(() =>
      expect(mergeTaskGroup).toHaveBeenCalledWith(
        {
          sourceTaskId: 101,
          mainTaskId: 102,
          sourceKind: "HISTORICAL",
          mergeNote: "合并不删历史",
        },
        {
          headers: {
            "x-csrf-token": "a".repeat(43),
            "Idempotency-Key": expect.any(String),
          },
        },
      ),
    );
    expect(issueCsrfToken).toHaveBeenCalledTimes(1);
    expect(onMerged).toHaveBeenCalledWith(7);
  });

  it("requires a selected main task before submitting", async () => {
    const { api, mergeTaskGroup } = createApi();
    mount({ api });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "确认合并" }));
    expect(
      await screen.findByText("请先搜索并选择主任务。"),
    ).toBeInTheDocument();
    expect(mergeTaskGroup).not.toHaveBeenCalled();
  });

  it("offers a rescan after a state conflict", async () => {
    const { api, getSearch, mergeTaskGroup } = createApi();
    mergeTaskGroup.mockRejectedValueOnce(
      new ApiError(409, {
        code: "TASK_GROUP_STATE_CONFLICT",
        message: "conflict",
        details: {},
        requestId: "request-id",
      }),
    );
    mount({ api });
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(searchLabel), "退款");
    await user.click(
      await screen.findByRole("button", { name: /重复回调任务 A/ }),
    );
    await user.click(screen.getByRole("button", { name: "确认合并" }));
    expect(
      await screen.findByText(/来源任务已属于其他聚合组/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重新搜索" }));
    await waitFor(() => expect(getSearch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText(/已选择主任务/)).toBeNull());
  });
});
