import React from "react";
import { ConfigProvider } from "antd";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type {
  InpulseApiClient,
  TaskGroupDetailResponse,
  TaskGroupMemberDetail,
  TaskGroupRecordItem,
  TaskGroupRecordLink,
  TaskGroupRecordPage,
} from "@generated/api";
import { TaskGroupPageView } from "./TaskGroupPageView";
import type { TaskGroupAdapter } from "./task-groups-types";

const mainMember: TaskGroupMemberDetail = {
  taskId: 101,
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
  publishedRecordCount: 2,
};

const activeSource: TaskGroupMemberDetail = {
  ...mainMember,
  taskId: 102,
  taskCode: "PR-T-2",
  title: "重复回调分支",
  role: "SOURCE",
  sourceKind: "ACTIVE",
  joinedAt: "2026-09-02T12:00:00.000Z",
  publishedRecordCount: 1,
};

const historicalSource: TaskGroupMemberDetail = {
  ...mainMember,
  taskId: 103,
  taskCode: "PR-T-3",
  title: "历史来源分支",
  role: "SOURCE",
  sourceKind: "HISTORICAL",
  joinedAt: "2026-09-02T13:00:00.000Z",
};

const detachedSource: TaskGroupMemberDetail = {
  ...mainMember,
  taskId: 104,
  taskCode: "PR-T-4",
  title: "已解除分支",
  role: "SOURCE",
  sourceKind: "ACTIVE",
  memberStatus: "DETACHED",
  detachedAt: "2026-09-05T12:00:00.000Z",
  detachReason: "两个任务实际不重复",
  joinedAt: "2026-09-02T14:00:00.000Z",
};

const snapshotLink: TaskGroupRecordLink = {
  linkId: 301,
  displayUrl: "https://github.com/256-code/InPulse/pull/1",
  kind: "PULL_REQUEST",
  repository: "256-code/InPulse",
  externalNumber: "1",
  externalSha: "abcdef1234567",
  titleSnapshot: "补齐退款",
  stateSnapshot: "merged",
  createdAt: "2026-09-03T12:00:00.000Z",
};

const publishedRecord: TaskGroupRecordItem = {
  recordId: 201,
  code: "PR-R-1",
  title: "发布退款补齐",
  recordStatus: "PUBLISHED",
  taskId: 101,
  sourceLabel: "主任务",
  featureId: 4,
  publishedAt: "2026-09-03T12:00:00.000Z",
  externalLinks: [snapshotLink],
};

const voidRecord: TaskGroupRecordItem = {
  ...publishedRecord,
  recordId: 202,
  code: "PR-R-2",
  title: "作废的退款记录",
  recordStatus: "VOID",
  taskId: 102,
  sourceLabel: "PR-T-2",
  featureId: null,
  externalLinks: [],
};

function detail(
  group: Partial<TaskGroupDetailResponse["group"]> = {},
  members: TaskGroupMemberDetail[] = [
    mainMember,
    activeSource,
    historicalSource,
    detachedSource,
  ],
): TaskGroupDetailResponse {
  return {
    group: {
      groupId: 5,
      projectId: 2,
      code: "TG-5",
      name: "退款聚合组",
      status: "ACTIVE",
      createdAt: "2026-09-01T12:00:00.000Z",
      closedAt: null,
      rowVersion: 1,
      ...group,
    },
    members,
  };
}

function recordPage(
  items: TaskGroupRecordItem[],
  nextCursor: string | null = null,
): TaskGroupRecordPage {
  return { items, nextCursor, hasMore: nextCursor !== null };
}

function createAdapter(
  overrides: Partial<TaskGroupAdapter> = {},
): TaskGroupAdapter {
  return {
    source: "server",
    notice: "测试接口说明：记录为关联时刻快照。",
    fetchTaskGroup: vi.fn().mockResolvedValue(detail()),
    fetchTaskGroupRecords: vi
      .fn()
      .mockResolvedValue(recordPage([publishedRecord, voidRecord])),
    ...overrides,
  };
}

const api = {} as InpulseApiClient;

function mount(
  options: {
    adapter?: TaskGroupAdapter;
    memberTaskId?: number | null;
    onMemberTaskIdChange?: (memberTaskId: number | null) => void;
    onBackToTasks?: () => void;
  } = {},
) {
  const adapter = options.adapter ?? createAdapter();
  const onMemberTaskIdChange = options.onMemberTaskIdChange ?? vi.fn();
  const onBackToTasks = options.onBackToTasks ?? vi.fn();
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <TaskGroupPageView
          groupId={5}
          adapter={adapter}
          api={api}
          memberTaskId={options.memberTaskId ?? null}
          onMemberTaskIdChange={onMemberTaskIdChange}
          onBackToTasks={onBackToTasks}
        />
      </QueryClientProvider>
    </ConfigProvider>,
  );
  return { adapter, onMemberTaskIdChange, onBackToTasks };
}

describe("F-25 task group view", () => {
  it("renders the main task first with role badges, member meta and the interface notice", async () => {
    const { onBackToTasks } = mount();
    await screen.findByText("退款主任务");
    const items = screen.getAllByTestId(/^task-group-member-/);
    expect(items.map((item) => item.dataset.testid)).toEqual([
      "task-group-member-101",
      "task-group-member-102",
      "task-group-member-103",
      "task-group-member-104",
    ]);
    const main = within(screen.getByTestId("task-group-member-101"));
    expect(main.getByText("主任务")).toBeInTheDocument();
    expect(
      main.getByText(/负责人 李四 · 已发布记录 2 条 · 合并于 9月1日 · 功能 #4/),
    ).toBeInTheDocument();
    expect(screen.getByTestId("task-group-notice")).toHaveTextContent(
      "测试接口说明：记录为关联时刻快照。",
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "任务中心" }));
    expect(onBackToTasks).toHaveBeenCalledTimes(1);
  });

  it("marks detached members and guides historical branches to the main task", async () => {
    mount();
    await screen.findByText("退款主任务");
    expect(screen.getByTestId("task-group-detached-104").textContent).toContain(
      "解除合并：两个任务实际不重复",
    );
    expect(screen.getByTestId("task-group-historical-103")).toHaveTextContent(
      "历史来源分支：后续工作建议归入主任务 PR-T-1。",
    );
    expect(screen.queryByTestId("task-group-detached-102")).toBeNull();
  });

  it("exposes the unmerge entry only for active source members", async () => {
    mount();
    await screen.findByText("退款主任务");
    expect(
      within(screen.getByTestId("task-group-member-102")).getByRole("button", {
        name: "解除合并",
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("task-group-member-103")).getByRole("button", {
        name: "解除合并",
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("task-group-member-104")).queryByRole(
        "button",
        { name: "解除合并" },
      ),
    ).toBeNull();
    expect(
      within(screen.getByTestId("task-group-member-101")).queryByRole(
        "button",
        { name: "解除合并" },
      ),
    ).toBeNull();
  });

  it("drives the record filter through the URL owner and the adapter query", async () => {
    const { adapter, onMemberTaskIdChange } = mount();
    await screen.findByText("退款主任务");
    expect(adapter.fetchTaskGroupRecords).toHaveBeenCalledWith(5, {});
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "来源任务 PR-T-2" }));
    await waitFor(() => expect(onMemberTaskIdChange).toHaveBeenCalledWith(102));
    await user.click(screen.getByRole("button", { name: "全部记录" }));
    expect(onMemberTaskIdChange).toHaveBeenCalledWith(null);
  });

  it("queries the filtered branch when the URL carries a member task id", async () => {
    const { adapter } = mount({ memberTaskId: 102 });
    await screen.findByText("退款主任务");
    await waitFor(() =>
      expect(adapter.fetchTaskGroupRecords).toHaveBeenCalledWith(5, {
        memberTaskId: 102,
      }),
    );
  });

  it("falls back to all records when the URL filter is not a group member", async () => {
    const { adapter } = mount({ memberTaskId: 999 });
    await screen.findByText("退款主任务");
    await waitFor(() =>
      expect(adapter.fetchTaskGroupRecords).toHaveBeenCalledWith(5, {}),
    );
    expect(screen.getByRole("button", { name: "全部记录" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("renders void badges and snapshots, then loads more with the cursor", async () => {
    const adapter = createAdapter({
      fetchTaskGroupRecords: vi
        .fn()
        .mockResolvedValueOnce(
          recordPage([publishedRecord, voidRecord], "cursor-1"),
        )
        .mockResolvedValueOnce(recordPage([])),
    });
    mount({ adapter });
    await screen.findByText("发布退款补齐");
    expect(
      within(screen.getByTestId("task-group-record-202")).getByText("已作废"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("task-group-link-snapshot-301"),
    ).toHaveTextContent("快照：补齐退款 · merged");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "加载更多" }));
    await waitFor(() =>
      expect(adapter.fetchTaskGroupRecords).toHaveBeenLastCalledWith(5, {
        cursor: "cursor-1",
      }),
    );
  });

  it("warns when the group is closed and renders empty states", async () => {
    const adapter = createAdapter({
      fetchTaskGroup: vi
        .fn()
        .mockResolvedValue(
          detail(
            { status: "CLOSED", closedAt: "2026-09-08T12:00:00.000Z" },
            [],
          ),
        ),
      fetchTaskGroupRecords: vi.fn().mockResolvedValue(recordPage([])),
    });
    mount({ adapter });
    await screen.findByText(/聚合组已关闭/);
    expect(screen.getByText("暂无组成员")).toBeInTheDocument();
    expect(screen.getByText("暂无迭代记录")).toBeInTheDocument();
  });
});
