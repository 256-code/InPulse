import React from "react";
import { ConfigProvider } from "antd";
import { MemoryRouter } from "react-router-dom";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi } from "vitest";
import type { InpulseApiClient } from "@generated/api";
import type { MyTaskListItem } from "./my-tasks-types";
import { MyTaskDetailModal } from "./MyTaskDetailModal";

const task: MyTaskListItem = {
  taskId: 101,
  code: "T-101",
  title: "登录页缺少恢复码入口",
  projectId: 1,
  projectName: "InPulse 平台",
  moduleId: 11,
  moduleName: "访问控制",
  featureId: 111,
  featureName: "MFA 登录",
  scopeType: "FEATURE",
  workStatus: "TODO",
  lifecycleStatus: "ACTIVE",
  priority: "URGENT",
  dueAt: new Date(2026, 0, 3, 10).toISOString(),
  updatedAt: new Date(2026, 0, 4, 9, 30).toISOString(),
  completedAt: null,
  creatorId: 2,
  assignee: { userId: 1, name: "陈晓", avatarUrl: null },
  hasPublishedRecord: true,
  publishedRecordCount: 2,
  groupRole: "SOURCE",
  groupId: 501,
  githubLinkCount: 1,
};

function mount(api: InpulseApiClient, overrides: Partial<MyTaskListItem> = {}) {
  const onClose = vi.fn();
  const onOpenInCatalog = vi.fn();
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter initialEntries={["/tasks"]}>
          <MyTaskDetailModal
            open
            task={{ ...task, ...overrides }}
            onClose={onClose}
            onOpenInCatalog={onOpenInCatalog}
            client={api}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </ConfigProvider>,
  );
  return { onClose, onOpenInCatalog };
}

function apiOf(items: readonly { id: number; name: string }[] = []) {
  return {
    listExternalLinks: vi.fn().mockResolvedValue({
      projectId: 1,
      rowVersion: 2,
      writable: true,
      items: [],
    }),
    getUserDirectory: vi.fn().mockResolvedValue({ items }),
  } as unknown as InpulseApiClient;
}

it("shows the task header, badges and R-3 facts inside the modal", async () => {
  const api = apiOf([{ id: 2, name: "小潘" }]);
  mount(api);
  const dialog = await screen.findByRole("dialog", {
    name: /T-101 登录页缺少恢复码入口/,
  });
  expect(
    within(dialog).getByRole("heading", { name: "登录页缺少恢复码入口" }),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByText("InPulse 平台 / 访问控制 / MFA 登录"),
  ).toBeInTheDocument();
  expect(within(dialog).getByText("未完成")).toBeInTheDocument();
  expect(within(dialog).getByText("紧急优先级")).toBeInTheDocument();
  expect(within(dialog).getByText("来源任务")).toBeInTheDocument();
  expect(within(dialog).getByText("陈晓")).toBeInTheDocument();
  await waitFor(() =>
    expect(within(dialog).getByText("小潘")).toBeInTheDocument(),
  );
  expect(
    within(dialog).getByText("已发布 2 条（多个版本不重复计数）"),
  ).toBeInTheDocument();
  expect(within(dialog).getByText("1月3日")).toBeInTheDocument();
  // 合并来源任务才给出聚合组入口，且指向该来源所属的聚合组。
  expect(
    within(dialog).getByRole("button", { name: /查看主任务/ }),
  ).toBeInTheDocument();
});

it("loads the inline GitHub panel inside the modal", async () => {
  const api = apiOf();
  mount(api);
  await waitFor(() =>
    expect(api.listExternalLinks).toHaveBeenCalledWith("TASK", 101),
  );
  const dialog = await screen.findByRole("dialog", { name: /T-101/ });
  expect(
    within(dialog).getByRole("heading", { name: "GitHub 关联" }),
  ).toBeInTheDocument();
  expect(
    await within(dialog).findByText(/尚未关联 GitHub/),
  ).toBeInTheDocument();
  expect(
    within(dialog).getByRole("button", { name: "添加 GitHub 链接" }),
  ).toBeInTheDocument();
});

it("hides the group entry for tasks that are not merge sources", async () => {
  const api = apiOf();
  mount(api, { groupRole: null, groupId: null });
  const dialog = await screen.findByRole("dialog", { name: /T-101/ });
  expect(
    within(dialog).queryByRole("button", { name: /查看主任务/ }),
  ).toBeNull();
});

it("navigates to the catalog through onOpenInCatalog and closes through onClose", async () => {
  const user = userEvent.setup();
  const api = apiOf();
  const { onClose, onOpenInCatalog } = mount(api);
  await user.click(screen.getByRole("button", { name: "在功能档案中查看" }));
  expect(onOpenInCatalog).toHaveBeenCalledWith(task);
  await user.click(screen.getByRole("button", { name: "关闭" }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it("renders nothing without a selected task", () => {
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider client={new QueryClient()}>
        <MyTaskDetailModal open task={null} onClose={vi.fn()} />
      </QueryClientProvider>
    </ConfigProvider>,
  );
  expect(screen.queryByText("未完成")).toBeNull();
});
