import React from "react";
import { ConfigProvider } from "antd";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { ApiError, type InpulseApiClient, type TaskItem } from "@generated/api";
import { TasksPanel } from "./TasksPanel";
import { mergeTask, taskEdit } from "./task-query";

const item: TaskItem = {
  id: 1,
  projectId: 2,
  moduleId: 3,
  featureId: 4,
  scopeType: "FEATURE",
  code: "PR-T-1",
  title: "退款任务",
  description: "原说明",
  assigneeId: 5,
  creatorId: 5,
  priority: "NORMAL",
  dueAt: null,
  workStatus: "TODO",
  lifecycleStatus: "ACTIVE",
  rowVersion: 1,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
};
function client(overrides: object = {}) {
  return {
    getTaskStatusHistory: vi.fn().mockResolvedValue({ items: [] }),
    getModuleTaskStatusHistory: vi.fn().mockResolvedValue({ items: [] }),
    listTasks: vi.fn().mockResolvedValue({ items: [item] }),
    listTaskGroupMemberships: vi.fn().mockResolvedValue({ items: [] }),
    listTaskAssignees: vi.fn().mockResolvedValue({
      items: [{ id: 5, name: "项目成员", avatarUrl: null }],
    }),
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
    getFeature: vi.fn().mockResolvedValue({ status: "ACTIVE" }),
    ...overrides,
  } as unknown as InpulseApiClient;
}
function mount(api: InpulseApiClient, writable = true) {
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter>
          <TasksPanel
            projectId={2}
            moduleId={3}
            featureId={4}
            writable={writable}
            client={api}
          />
        </MemoryRouter>
      </QueryClientProvider>
    </ConfigProvider>,
  );
}
describe("F-14 task editing", () => {
  it("keeps actual changes TODO and preserves completion input across a version conflict", async () => {
    const completeTask = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(409, {
          code: "TASK_VERSION_CONFLICT",
          message: "版本变化",
          details: {},
          requestId: "test",
        }),
      )
      .mockResolvedValue({
        task: { ...item, workStatus: "DONE", rowVersion: 3 },
        record: null,
      });
    mount(
      client({
        completeTask,
        getTask: vi.fn().mockResolvedValue({ ...item, rowVersion: 2 }),
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "任务详情" }));
    fireEvent.click(screen.getByRole("button", { name: "完成任务" }));
    // Ant Design assigns the same aria title ID to nested dialogs in NODE_ENV=test.
    // Locate this dialog through its labeled field; real-browser E2E verifies its name.
    const modal = within(
      (await screen.findByLabelText("是否产生实际功能变化")).closest(
        '[role="dialog"]',
      ) as HTMLElement,
    );
    fireEvent.change(modal.getByLabelText("是否产生实际功能变化"), {
      target: { value: "yes" },
    });
    expect(
      modal.getByRole("button", { name: "发布并完成任务" }),
    ).toBeDisabled();
    expect(completeTask).not.toHaveBeenCalled();
    fireEvent.change(modal.getByLabelText("是否产生实际功能变化"), {
      target: { value: "no" },
    });
    fireEvent.change(modal.getByLabelText("完成原因"), {
      target: { value: "技术调研" },
    });
    fireEvent.change(modal.getByLabelText("完成补充说明"), {
      target: { value: "保留我的说明" },
    });
    fireEvent.click(modal.getByRole("button", { name: "确认完成任务" }));
    fireEvent.click(
      await modal.findByRole("button", { name: "加载最新任务状态" }),
    );
    await waitFor(() =>
      expect(modal.getByRole("button", { name: "确认完成任务" })).toBeEnabled(),
    );
    expect(modal.getByLabelText("完成补充说明")).toHaveValue("保留我的说明");
    fireEvent.click(modal.getByRole("button", { name: "确认完成任务" }));
    await waitFor(() => expect(completeTask).toHaveBeenCalledTimes(2));
    expect(completeTask.mock.calls[1]![1]).toEqual({
      expectedRowVersion: 2,
      mode: "WITHOUT_RECORD",
      completionReason: "技术调研",
      note: "保留我的说明",
    });
    expect(completeTask.mock.calls[1]![2].headers["If-Match"]).toBe('"2"');
    expect(completeTask.mock.calls[1]![2].headers["Idempotency-Key"]).not.toBe(
      completeTask.mock.calls[0]![2].headers["Idempotency-Key"],
    );
  });
  it("defaults to TODO and retains all history without displaying an incomplete completion rate", async () => {
    mount(
      client({
        listTasks: vi.fn().mockResolvedValue({
          items: [
            item,
            { ...item, id: 2, title: "历史完成", workStatus: "DONE" },
            { ...item, id: 3, title: "历史取消", workStatus: "CANCELED" },
            {
              ...item,
              id: 4,
              title: "无效历史",
              workStatus: "DONE",
              lifecycleStatus: "INVALID",
            },
          ],
        }),
      }),
    );
    await screen.findByText(item.title);
    expect(screen.queryByText("历史完成")).not.toBeInTheDocument();
    expect(screen.queryByText(/完成率/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("任务状态筛选"), {
      target: { value: "CANCELED" },
    });
    expect(screen.getByText("历史取消")).toBeVisible();
    fireEvent.change(screen.getByLabelText("任务状态筛选"), {
      target: { value: "DONE" },
    });
    expect(screen.getByText("历史完成")).toBeVisible();
    expect(screen.getByText("无效历史")).toBeVisible();
    fireEvent.change(screen.getByLabelText("任务状态筛选"), {
      target: { value: "ALL" },
    });
    for (const title of [item.title, "历史完成", "历史取消", "无效历史"])
      expect(screen.getByText(title)).toBeVisible();
    expect(screen.queryByText(/完成率/)).not.toBeInTheDocument();
  });
  it("compares impact sets semantically and requires a three-way choice", () => {
    const base = { ...taskEdit(item), impactFeatureIds: [2] };
    expect(
      mergeTask(
        base,
        { ...base, impactFeatureIds: [2, 3] },
        { ...base, impactFeatureIds: [2, 4] },
      ).conflicts,
    ).toEqual(["impactFeatureIds"]);
    expect(
      mergeTask(
        base,
        { ...base, impactFeatureIds: [2] },
        { ...base, title: "新标题" },
      ).conflicts,
    ).toEqual([]);
  });
  it("shows a MODULE reference only once and directs editing to its module", async () => {
    const module = {
      ...item,
      featureId: null,
      scopeType: "MODULE",
      impactFeatureIds: [4],
    };
    mount(
      client({ listTasks: vi.fn().mockResolvedValue({ items: [module] }) }),
    );
    await screen.findByText("模块级任务 · 引用");
    expect(screen.getByText("任务数：1（按唯一任务计）")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "任务详情" }));
    expect(
      await screen.findByRole("link", { name: "打开模块任务" }),
    ).toHaveAttribute("href", "/projects/2/modules/3/tasks?taskId=1");
    expect(screen.getByRole("button", { name: "编辑任务" })).toBeDisabled();
  });
  it("merges untouched fields and requires choice for conflicting assignee/due date", () => {
    const base = taskEdit(item);
    const draft = {
      ...base,
      title: "我的标题",
      assigneeId: 6,
      dueAt: "2026-09-10T00:00:00Z",
    };
    const latest = {
      ...base,
      description: "他人说明",
      assigneeId: 7,
      dueAt: "2026-09-11T00:00:00Z",
    };
    expect(mergeTask(base, draft, latest)).toEqual({
      values: { ...draft, description: "他人说明" },
      conflicts: ["assigneeId", "dueAt"],
    });
  });
  it("retains identical retry key after uncertain failure and changes key with semantics", async () => {
    const createTask = vi.fn().mockRejectedValue(new Error("lost response"));
    mount(
      client({
        listTasks: vi.fn().mockResolvedValue({ items: [] }),
        createTask,
      }),
    );
    await screen.findByText("暂无任务");
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    fireEvent.change(screen.getByLabelText("任务标题"), {
      target: { value: "新任务" },
    });
    fireEvent.change(screen.getByLabelText("负责人"), {
      target: { value: "5" },
    });
    const save = screen.getByRole("button", { name: /保\s*存/ });
    fireEvent.click(save);
    await screen.findByText("任务服务暂时不可用，输入已保留，可重试。");
    fireEvent.click(save);
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(2));
    expect(createTask.mock.calls[0]![4].headers["Idempotency-Key"]).toBe(
      createTask.mock.calls[1]![4].headers["Idempotency-Key"],
    );
    await waitFor(() => expect(save).not.toHaveClass("ant-btn-loading"));
    fireEvent.change(screen.getByLabelText("任务标题"), {
      target: { value: "改了标题" },
    });
    fireEvent.click(save);
    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(3));
    expect(createTask.mock.calls[2]![4].headers["Idempotency-Key"]).not.toBe(
      createTask.mock.calls[1]![4].headers["Idempotency-Key"],
    );
  });
  it("requires selecting the conflicting title before submitting latest If-Match", async () => {
    const latest = {
      ...item,
      title: "他人标题",
      description: "他人说明",
      rowVersion: 2,
    };
    const updateTask = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(409, {
          code: "TASK_VERSION_CONFLICT",
          message: "版本变化",
          details: {},
          requestId: "r",
        }),
      )
      .mockResolvedValue({ ...latest, title: "我的标题", rowVersion: 3 });
    mount(client({ getTask: vi.fn().mockResolvedValue(latest), updateTask }));
    await screen.findByText("退款任务");
    fireEvent.click(screen.getByRole("button", { name: "任务详情" }));
    fireEvent.click(await screen.findByRole("button", { name: "编辑任务" }));
    const modal = within(screen.getByRole("dialog", { name: "编辑任务" }));
    fireEvent.change(modal.getByLabelText("任务标题"), {
      target: { value: "我的标题" },
    });
    fireEvent.click(modal.getByRole("button", { name: /保\s*存/ }));
    fireEvent.click(
      await modal.findByRole("button", { name: "加载最新版本后继续编辑" }),
    );
    await modal.findByText("任务标题存在冲突");
    expect(modal.getByRole("button", { name: /保\s*存/ })).toBeDisabled();
    fireEvent.click(modal.getByRole("button", { name: "保留我的任务标题" }));
    fireEvent.click(modal.getByRole("button", { name: "应用合并结果" }));
    expect(modal.getByLabelText("任务说明")).toHaveValue("他人说明");
    fireEvent.click(modal.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(updateTask).toHaveBeenCalledTimes(2));
    expect(updateTask.mock.calls[1]![5].headers["If-Match"]).toBe('"2"');
  });
  it("shows read failure/retry and disables creation in archived feature", async () => {
    mount(
      client({ listTasks: vi.fn().mockRejectedValue(new Error("offline")) }),
      false,
    );
    await screen.findByRole("button", { name: "重试任务列表" });
    expect(screen.getByRole("button", { name: "新建任务" })).toBeDisabled();
  });
  it("does not invent selectable global users or default assignee", async () => {
    mount(client());
    await screen.findByText("退款任务");
    fireEvent.click(screen.getByRole("button", { name: "新建任务" }));
    fireEvent.change(screen.getByLabelText("任务标题"), {
      target: { value: "新任务" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("请选择负责人");
  });
});

function GroupRouteProbe() {
  const { groupId } = useParams();
  return <p>{"聚合组 #" + groupId}</p>;
}
function mountWithGroupRoute(api: InpulseApiClient, writable = true) {
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter initialEntries={["/features/4"]}>
          <Routes>
            <Route
              path="/features/4"
              element={
                <TasksPanel
                  projectId={2}
                  moduleId={3}
                  featureId={4}
                  writable={writable}
                  client={api}
                />
              }
            />
            <Route path="/task-groups/:groupId" element={<GroupRouteProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ConfigProvider>,
  );
}
describe("F-23 merge entry", () => {
  it("opens the merge modal from the task detail dialog", async () => {
    mount(client());
    fireEvent.click(await screen.findByRole("button", { name: "任务详情" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "合并到主任务" }),
    );
    expect(
      await screen.findByLabelText(/主任务（搜索任务编号或标题/),
    ).toBeInTheDocument();
  });
});
describe("C-1 任务聚合标记（R-5 页面级一次批量）", () => {
  const source: TaskItem = { ...item, id: 1, title: "来源任务甲" };
  const ungrouped: TaskItem = { ...item, id: 2, title: "未入组任务乙" };
  const main: TaskItem = { ...item, id: 3, title: "主任务丙" };
  const marks = {
    items: [
      { taskId: 1, groupId: 501, groupRole: "SOURCE", publishedRecordCount: 2 },
      { taskId: 2, groupId: null, groupRole: null, publishedRecordCount: 0 },
    ],
  } as const;
  it("marks every card from one batch call and hides the entry for ungrouped tasks", async () => {
    const listTaskGroupMemberships = vi.fn().mockResolvedValue(marks);
    mount(
      client({
        listTasks: vi.fn().mockResolvedValue({ items: [source, ungrouped] }),
        listTaskGroupMemberships,
      }),
    );
    const sourceCard = (await screen.findByText("来源任务甲")).closest(
      "article",
    ) as HTMLElement;
    expect(await within(sourceCard).findByText("来源任务")).toBeInTheDocument();
    expect(
      await within(sourceCard).findByText("迭代记录 2 条"),
    ).toBeInTheDocument();
    const ungroupedCard = screen
      .getByText("未入组任务乙")
      .closest("article") as HTMLElement;
    expect(within(ungroupedCard).queryByText("来源任务")).toBeNull();
    expect(within(ungroupedCard).queryByText("主任务")).toBeNull();
    expect(within(ungroupedCard).queryByText(/迭代记录/)).toBeNull();
    await waitFor(() =>
      expect(listTaskGroupMemberships).toHaveBeenCalledTimes(1),
    );
    expect(listTaskGroupMemberships.mock.calls[0]![0]).toEqual({
      taskIds: [1, 2],
    });
  });
  it("shows badge, record count and the main-task entry in the detail dialog, then routes to the group", async () => {
    mountWithGroupRoute(
      client({
        listTasks: vi.fn().mockResolvedValue({ items: [source] }),
        listTaskGroupMemberships: vi.fn().mockResolvedValue(marks),
      }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "任务详情" }));
    const dialog = await screen.findByRole("dialog", { name: "任务详情" });
    expect(await within(dialog).findByText("来源任务")).toBeInTheDocument();
    expect(within(dialog).getByText("迭代记录 2 条")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /查看主任务/ }));
    expect(await screen.findByText("聚合组 #501")).toBeInTheDocument();
  });
  it("keeps the main task badge but hides the main-task entry on the MAIN task itself", async () => {
    mount(
      client({
        listTasks: vi.fn().mockResolvedValue({ items: [main] }),
        listTaskGroupMemberships: vi.fn().mockResolvedValue({
          items: [
            {
              taskId: 3,
              groupId: 501,
              groupRole: "MAIN",
              publishedRecordCount: 0,
            },
          ],
        }),
      }),
    );
    const mainCard = (await screen.findByText("主任务丙")).closest(
      "article",
    ) as HTMLElement;
    expect(await within(mainCard).findByText("主任务")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "任务详情" }));
    const dialog = await screen.findByRole("dialog", { name: "任务详情" });
    expect(await within(dialog).findByText("主任务")).toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /查看主任务/ }),
    ).toBeNull();
    expect(within(dialog).queryByText(/迭代记录 \d+ 条/)).toBeNull();
  });
});
