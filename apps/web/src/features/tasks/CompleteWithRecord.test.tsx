import React from "react";
import { ConfigProvider } from "antd";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { ApiError, type InpulseApiClient, type TaskItem } from "@generated/api";
import { CompleteWithRecord } from "./CompleteWithRecord";
const task: TaskItem = {
  id: 1,
  projectId: 2,
  moduleId: 3,
  featureId: 4,
  scopeType: "FEATURE",
  code: "SHOP-T-1",
  title: "任务标题",
  description: "",
  assigneeId: 5,
  creatorId: 5,
  priority: "NORMAL",
  workStatus: "TODO",
  lifecycleStatus: "ACTIVE",
  dueAt: null,
  rowVersion: 1,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
};
const draft = {
  id: 7,
  projectId: 2,
  moduleId: 3,
  featureId: 4,
  taskId: null,
  title: "已存草稿",
  rowVersion: 2,
  contextProblem: "问题",
  changeSolution: "方案",
  resultVerification: "验证",
  remainingIssues: "",
};
function mount(extra: object) {
  const api = {
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
    ...extra,
  } as unknown as InpulseApiClient;
  const done = vi.fn();
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider client={new QueryClient()}>
        <CompleteWithRecord item={task} api={api} writable onSuccess={done} />
      </QueryClientProvider>
    </ConfigProvider>,
  );
  return done;
}
it("requires core content and reuses the exact request key after uncertain failure", async () => {
  const completeTask = vi
    .fn()
    .mockRejectedValueOnce(Error("network"))
    .mockResolvedValue({
      task: { ...task, workStatus: "DONE" },
      record: { id: 7, projectId: 2 },
    });
  const done = mount({ completeTask });
  expect(screen.getByRole("button", { name: "发布并完成任务" })).toBeDisabled();
  for (const label of [
    "为什么改、发现了什么问题",
    "改了什么、怎么改的",
    "改完效果如何、如何验证",
  ])
    fireEvent.change(screen.getByLabelText(label), {
      target: { value: "真实内容" },
    });
  fireEvent.click(screen.getByRole("button", { name: "发布并完成任务" }));
  await screen.findByText("服务暂时不可用，输入和选择已保留，可重试。");
  expect(screen.getByLabelText("改了什么、怎么改的")).toHaveValue("真实内容");
  fireEvent.click(screen.getByRole("button", { name: "发布并完成任务" }));
  await waitFor(() => expect(done).toHaveBeenCalledOnce());
  expect(completeTask.mock.calls[0]).toEqual(completeTask.mock.calls[1]);
  expect(completeTask.mock.calls[0]![1]).toEqual({
    mode: "WITH_RECORD",
    expectedRowVersion: 1,
    record: {
      title: "任务标题",
      contextProblem: "真实内容",
      changeSolution: "真实内容",
      resultVerification: "真实内容",
      remainingIssues: "",
    },
  });
});
it("requires explicit draft selection and explicit confirmation of its changed content before retrying a conflict", async () => {
  const completeTask = vi
    .fn()
    .mockRejectedValueOnce(
      new ApiError(409, {
        code: "RECORD_VERSION_CONFLICT",
        message: "草稿版本变化",
        details: {},
        requestId: "r",
      }),
    )
    .mockResolvedValue({ task, record: { id: 7, projectId: 2 } });
  mount({
    completeTask,
    listRecordDrafts: vi.fn().mockResolvedValue({
      items: [draft, { ...draft, id: 8, featureId: 99, title: "不匹配草稿" }],
    }),
    getRecordDraft: vi
      .fn()
      .mockResolvedValue({ ...draft, title: "新版标题", rowVersion: 3 }),
    getTask: vi.fn().mockResolvedValue({ ...task, rowVersion: 2 }),
  });
  fireEvent.change(screen.getByLabelText("记录来源"), {
    target: { value: "draft" },
  });
  const select = await screen.findByLabelText("待发布草稿");
  expect(select).toHaveValue("");
  expect(
    screen.queryByRole("option", { name: /不匹配草稿/ }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "发布并完成任务" })).toBeDisabled();
  fireEvent.change(select, { target: { value: "7" } });
  fireEvent.click(screen.getByRole("button", { name: "发布并完成任务" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "加载最新任务和草稿" }),
  );
  await screen.findByText("最新草稿：新版标题（版本 3）");
  expect(screen.getByRole("button", { name: "发布并完成任务" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "确认使用最新草稿" }));
  fireEvent.click(screen.getByRole("button", { name: "发布并完成任务" }));
  await waitFor(() => expect(completeTask).toHaveBeenCalledTimes(2));
  expect(completeTask.mock.calls[1]![1]).toEqual({
    mode: "WITH_RECORD",
    expectedRowVersion: 2,
    recordDraftId: 7,
    recordExpectedRowVersion: 3,
  });
  expect(completeTask.mock.calls[1]![2].headers["Idempotency-Key"]).not.toBe(
    completeTask.mock.calls[0]![2].headers["Idempotency-Key"],
  );
});
