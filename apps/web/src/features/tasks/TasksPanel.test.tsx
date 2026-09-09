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
    listTasks: vi.fn().mockResolvedValue({ items: [item] }),
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
        <TasksPanel
          projectId={2}
          moduleId={3}
          featureId={4}
          writable={writable}
          client={api}
        />
      </QueryClientProvider>
    </ConfigProvider>,
  );
}
describe("F-14 task editing", () => {
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
