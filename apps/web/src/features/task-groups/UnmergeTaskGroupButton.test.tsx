import React from "react";
import { ConfigProvider } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { ApiError, type InpulseApiClient } from "@generated/api";
import { UnmergeTaskGroupButton } from "./UnmergeTaskGroupButton";

const unmerged = {
  group: {
    groupId: 5,
    projectId: 2,
    code: "TG-5",
    name: "退款聚合组",
    status: "CLOSED",
    createdAt: "2026-09-01T12:00:00.000Z",
    closedAt: "2026-09-09T12:00:00.000Z",
    rowVersion: 2,
  },
  detachedMembers: [
    {
      taskId: 102,
      taskCode: "PR-T-2",
      title: "重复回调分支",
      detachedAt: "2026-09-09T12:00:00.000Z",
    },
  ],
};

function createApi() {
  const unmergeTaskGroup = vi.fn().mockResolvedValue(unmerged);
  const issueCsrfToken = vi
    .fn()
    .mockResolvedValue({ csrfToken: "a".repeat(43) });
  return {
    api: { issueCsrfToken, unmergeTaskGroup } as unknown as InpulseApiClient,
    unmergeTaskGroup,
    issueCsrfToken,
  };
}

function mount(
  options: {
    api?: InpulseApiClient;
    closesGroup?: boolean;
    onReload?: () => Promise<void>;
  } = {},
) {
  const onReload = options.onReload ?? vi.fn().mockResolvedValue(undefined);
  const onChanged = vi.fn();
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <UnmergeTaskGroupButton
          groupId={5}
          member={{ taskId: 102, taskCode: "PR-T-2", title: "重复回调分支" }}
          closesGroup={options.closesGroup ?? false}
          api={options.api ?? createApi().api}
          onReload={onReload}
          onChanged={onChanged}
        />
      </QueryClientProvider>
    </ConfigProvider>,
  );
  return { onReload, onChanged };
}

describe("F-24 unmerge task group", () => {
  it("requires a second confirmation and submits with CSRF and idempotency headers", async () => {
    const { api, unmergeTaskGroup, issueCsrfToken } = createApi();
    const { onChanged } = mount({ api });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "解除合并" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/PR-T-2 重复回调分支 将恢复为独立任务/),
    ).toBeInTheDocument();
    await user.type(
      within(dialog).getByLabelText("解除原因（选填）"),
      "  两个任务实际不重复  ",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "确认解除合并" }),
    );
    await waitFor(() =>
      expect(unmergeTaskGroup).toHaveBeenCalledWith(
        { sourceTaskId: 102, unmergeReason: "两个任务实际不重复" },
        {
          headers: {
            "x-csrf-token": "a".repeat(43),
            "Idempotency-Key": expect.any(String),
          },
        },
      ),
    );
    expect(issueCsrfToken).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends a null reason when the field stays empty", async () => {
    const { api, unmergeTaskGroup } = createApi();
    mount({ api });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "解除合并" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "确认解除合并" }),
    );
    await waitFor(() =>
      expect(unmergeTaskGroup).toHaveBeenCalledWith(
        { sourceTaskId: 102, unmergeReason: null },
        expect.anything(),
      ),
    );
  });

  it("keeps the input and refreshes the latest state on 409", async () => {
    const { api, unmergeTaskGroup } = createApi();
    unmergeTaskGroup.mockRejectedValueOnce(
      new ApiError(409, {
        code: "TASK_GROUP_STATE_CONFLICT",
        message: "conflict",
        details: {},
        requestId: "request-id",
      }),
    );
    const onReload = vi.fn().mockResolvedValue(undefined);
    mount({ api, onReload });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "解除合并" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("解除原因（选填）"),
      "保留的我输入",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "确认解除合并" }),
    );
    await screen.findByText(/关系或任务状态已变化/);
    expect(
      within(dialog).getByRole("button", { name: "确认解除合并" }),
    ).toBeDisabled();
    await user.click(
      within(dialog).getByRole("button", { name: "加载最新状态" }),
    );
    await waitFor(() => expect(onReload).toHaveBeenCalledTimes(1));
    expect(within(dialog).getByLabelText("解除原因（选填）")).toHaveValue(
      "保留的我输入",
    );
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", { name: "确认解除合并" }),
      ).toBeEnabled(),
    );
  });

  it("explains that only active source members can be unmerged", async () => {
    const { api, unmergeTaskGroup } = createApi();
    unmergeTaskGroup.mockRejectedValueOnce(
      new ApiError(422, {
        code: "VALIDATION_FAILED",
        message: "invalid",
        details: {},
        requestId: "request-id",
      }),
    );
    mount({ api });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "解除合并" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "确认解除合并" }),
    );
    await screen.findByText(/仅活跃来源分支可以解除合并/);
  });

  it("warns when the group will close after this unmerge", async () => {
    mount({ closesGroup: true });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "解除合并" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/最后一个活跃来源分支/),
    ).toBeInTheDocument();
  });
});
