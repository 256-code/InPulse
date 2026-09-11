/**
 * F-20 遗留问题页组件测试：未闭环/已闭环分桶、来源与跟进任务入口、
 * 转为任务入口（转换弹窗以桩替换，避免在列表测试中加载真实预览）。
 */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  type InpulseApiClient,
  type LeftoverListItem,
  type LeftoverItemPage,
} from "@generated/api";
import type { TaskLocation } from "@features/tasks/task-links";
import { IssuesPageView } from "./IssuesPageView";

vi.mock("@features/published-records/ConvertLeftoverTask", () => ({
  LeftoverTaskConvertModal: (props: {
    readonly target: { readonly recordId: number };
  }) => <div data-testid="convert-modal">转换 {props.target.recordId}</div>,
}));

const openItem: LeftoverListItem = {
  leftoverItemId: 8,
  recordId: 7,
  recordCode: "CR-201",
  recordTitle: "充电策略支持参数配置",
  projectId: 1,
  projectName: "AGV 智能搬运平台",
  moduleId: 2,
  moduleName: "任务调度",
  featureId: 3,
  featureName: "充电任务编排",
  author: { userId: 3, name: "陈晓", avatarUrl: null },
  publishedAt: "2026-08-18T03:00:00.000Z",
  content: "高峰期多车同时等待充电的调度策略仍需优化。",
  status: "ACTIVE",
  sourceTask: {
    taskId: 105,
    code: "T-105",
    projectId: 1,
    moduleId: 2,
    featureId: 3,
  },
  followupTask: null,
};

const followupItem: LeftoverListItem = {
  ...openItem,
  leftoverItemId: 9,
  content: "低密度场景下的提前量仍需单独标定。",
  followupTask: {
    taskId: 140,
    code: "T-140",
    projectId: 1,
    moduleId: 2,
    featureId: null,
  },
};

const convertPage: LeftoverItemPage = {
  items: [openItem, followupItem],
  nextCursor: "cursor-1",
  hasMore: true,
};

const resolvedItem: LeftoverListItem = {
  ...openItem,
  leftoverItemId: 4,
  recordCode: "CR-224",
  content: "高密度场景下的动态阈值仍由 T-135 跟进。",
  status: "RESOLVED",
  followupTask: null,
};

const closedItem: LeftoverListItem = {
  ...openItem,
  leftoverItemId: 3,
  recordCode: "CR-212",
  content: "密集场景提前量已转为任务。",
  status: "CONVERTED",
  followupTask: {
    taskId: 141,
    code: "T-141",
    projectId: 1,
    moduleId: 2,
    featureId: 3,
  },
};

const closedPage: LeftoverItemPage = {
  items: [closedItem, resolvedItem],
  nextCursor: null,
  hasMore: false,
};

interface ClientOptions {
  readonly open?: LeftoverItemPage;
  readonly closed?: LeftoverItemPage;
  readonly openError?: Error;
  readonly onOpen?: (query: unknown) => void;
}

const createClient = (options: ClientOptions = {}) => {
  const listLeftoverItems = vi.fn(
    (query: { readonly bucket?: string; readonly cursor?: string }) => {
      options.onOpen?.(query);
      if (query.bucket === "CLOSED") {
        return Promise.resolve(options.closed ?? closedPage);
      }
      if (options.openError) return Promise.reject(options.openError);
      if (query.cursor === "cursor-1") {
        return Promise.resolve({
          items: [{ ...resolvedItem, leftoverItemId: 10 }],
          nextCursor: null,
          hasMore: false,
        } satisfies LeftoverItemPage);
      }
      return Promise.resolve(options.open ?? convertPage);
    },
  );
  return {
    client: { listLeftoverItems } as unknown as InpulseApiClient,
    listLeftoverItems,
  };
};

interface RenderOptions extends ClientOptions {
  readonly onBackToRecords?: () => void;
  readonly onOpenTask?: (task: TaskLocation) => void;
}

const renderView = (options: RenderOptions = {}) => {
  const { client } = createClient(options);
  const onBackToRecords = options.onBackToRecords ?? vi.fn();
  const onOpenTask = options.onOpenTask ?? vi.fn();
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <IssuesPageView
        client={client}
        onBackToRecords={onBackToRecords}
        onOpenTask={onOpenTask}
      />
    </QueryClientProvider>,
  );
  return { onBackToRecords, onOpenTask };
};

describe("IssuesPageView", () => {
  it("renders open leftovers with badge, record code, content and origin", async () => {
    renderView();
    const row = await screen.findByTestId("leftover-item-8");
    expect(within(row).getByText("待闭环")).toBeInTheDocument();
    expect(within(row).getByText("CR-201")).toBeInTheDocument();
    expect(
      within(row).getByText("高峰期多车同时等待充电的调度策略仍需优化。"),
    ).toBeInTheDocument();
    expect(
      within(row).getByText(
        "来自「充电策略支持参数配置」 · AGV 智能搬运平台 / 任务调度 / 充电任务编排 · 陈晓 · 2026-08-18",
      ),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: /来源任务 T-105/ }),
    ).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: /转为任务/ }),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 条未闭环/)).toBeInTheDocument();
  });
  it("opens the source and follow-up tasks through onOpenTask", async () => {
    const { onOpenTask } = renderView();
    const user = userEvent.setup();
    const sourceRow = await screen.findByTestId("leftover-item-8");
    await user.click(
      within(sourceRow).getByRole("button", { name: /来源任务 T-105/ }),
    );
    expect(onOpenTask).toHaveBeenLastCalledWith({
      projectId: 1,
      moduleId: 2,
      featureId: 3,
      taskId: 105,
    });

    const followupRow = await screen.findByTestId("leftover-item-9");
    await user.click(
      within(followupRow).getByRole("button", { name: /查看跟进任务 T-140/ }),
    );
    expect(onOpenTask).toHaveBeenLastCalledWith({
      projectId: 1,
      moduleId: 2,
      featureId: null,
      taskId: 140,
    });
  });

  it("opens the convert modal only for open items without a follow-up task", async () => {
    renderView();
    const user = userEvent.setup();
    const row = await screen.findByTestId("leftover-item-8");
    await user.click(within(row).getByRole("button", { name: /转为任务/ }));
    expect(await screen.findByTestId("convert-modal")).toHaveTextContent(
      "转换 7",
    );
  });

  it("renders closed leftovers inside a collapsible history block", async () => {
    renderView();
    expect(
      await screen.findByText("已闭环 2 条 · 已生成跟进任务"),
    ).toBeInTheDocument();
    const converted = await screen.findByTestId("leftover-item-3");
    expect(within(converted).getByText("已闭环")).toBeInTheDocument();
    expect(
      within(converted).getByRole("button", { name: /查看跟进任务 T-141/ }),
    ).toBeInTheDocument();
    expect(
      within(converted).queryByRole("button", { name: /转为任务/ }),
    ).toBeNull();
    const resolved = await screen.findByTestId("leftover-item-4");
    expect(
      within(resolved).queryByRole("button", { name: /转为任务|查看跟进任务/ }),
    ).toBeNull();
  });

  it("renders the empty state when nothing is open", async () => {
    renderView({
      open: { items: [], nextCursor: null, hasMore: false },
      closed: { items: [], nextCursor: null, hasMore: false },
    });
    expect(await screen.findByText("没有待闭环的遗留问题")).toBeInTheDocument();
    expect(screen.queryByText(/已闭环 .* 条/)).toBeNull();
  });

  it("renders an error alert when the open bucket fails", async () => {
    renderView({ openError: new Error("boom") });
    expect(
      await screen.findByText("遗留问题服务暂时不可用，请稍后重试。"),
    ).toBeInTheDocument();
  });

  it("loads the next signed-cursor page on demand", async () => {
    const seen: unknown[] = [];
    renderView({ onOpen: (query) => seen.push(query) });
    const user = userEvent.setup();
    await screen.findByTestId("leftover-item-8");
    await user.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByTestId("leftover-item-10")).toBeInTheDocument();
    await waitFor(() =>
      expect(seen).toContainEqual({
        bucket: "OPEN",
        limit: 20,
        cursor: "cursor-1",
      }),
    );
  });
});
