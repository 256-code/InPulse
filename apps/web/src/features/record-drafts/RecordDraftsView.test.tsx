import React from "react";
import { ConfigProvider } from "antd";
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, it, expect, vi } from "vitest";
import {
  ApiError,
  type InpulseApiClient,
  type RecordDraftItem,
} from "@generated/api";
import { RecordDraftsView, mergeRecordDraft } from "./RecordDraftsView";
const item: RecordDraftItem = {
  id: 7,
  projectId: 1,
  moduleId: 2,
  featureId: null,
  scopeType: "MODULE",
  taskId: null,
  impactFeatureIds: [],
  authorId: 3,
  handlerId: 3,
  status: "DRAFT",
  code: null,
  currentVersion: 0,
  publishedAt: null,
  rowVersion: 1,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  title: "支付修正",
  contextProblem: "重复请求",
  changeSolution: "增加幂等",
  resultVerification: "并发通过",
  remainingIssues: "",
};
function client(overrides: object = {}) {
  return {
    listProjects: vi.fn().mockResolvedValue({
      items: [{ id: 1, name: "支付项目", status: "ACTIVE" }],
    }),
    listModules: vi.fn().mockResolvedValue({
      items: [{ id: 2, name: "支付模块", status: "ACTIVE" }],
    }),
    listFeatures: vi.fn().mockResolvedValue({ items: [] }),
    listRecordDrafts: vi.fn().mockResolvedValue({ items: [item] }),
    getRecordDraft: vi.fn().mockResolvedValue(item),
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
    ...overrides,
  } as unknown as InpulseApiClient;
}
function mount(api: InpulseApiClient, path = "/records?projectId=1") {
  render(
    <MemoryRouter initialEntries={[path]}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <RecordDraftsView client={api} />
        </QueryClientProvider>
      </ConfigProvider>
    </MemoryRouter>,
  );
}
describe("F-17 draft UI", () => {
  it("validates three sections and creates an independent draft through the client", async () => {
    const create = vi.fn().mockResolvedValue(item);
    mount(client({ createIndependentRecordDraft: create }));
    const button = await screen.findByRole("button", { name: "新建独立草稿" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    const modal = within(
      await screen.findByRole("dialog", { name: "新建独立草稿" }),
    );
    fireEvent.change(modal.getByLabelText("所属模块"), {
      target: { value: "2" },
    });
    fireEvent.click(modal.getByRole("button", { name: "保存草稿" }));
    await modal.findAllByText("请填写此项");
    expect(create).not.toHaveBeenCalled();
    for (const [label, value] of [
      ["迭代标题", item.title],
      ["为什么改、发现了什么问题", item.contextProblem],
      ["改了什么、怎么改的", item.changeSolution],
      ["改完效果如何、如何验证", item.resultVerification],
    ])
      fireEvent.change(modal.getByLabelText(label!), { target: { value } });
    fireEvent.click(modal.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]![2]).toEqual({
      title: item.title,
      contextProblem: item.contextProblem,
      changeSolution: item.changeSolution,
      resultVerification: item.resultVerification,
      remainingIssues: "",
      scopeType: "MODULE",
      impactFeatureIds: [],
    });
    expect(await screen.findByText("暂无已知遗留问题")).toBeVisible();
  });
  it("preserves conflicting local content and requires a field choice before a new version", async () => {
    const update = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(409, {
          code: "RECORD_VERSION_CONFLICT",
          message: "版本变化",
          requestId: "test",
          details: {},
        }),
      )
      .mockResolvedValue({ ...item, rowVersion: 3 });
    const get = vi
      .fn()
      .mockResolvedValueOnce(item)
      .mockResolvedValue({
        ...item,
        rowVersion: 2,
        changeSolution: "其他成员方案",
      });
    mount(
      client({ getRecordDraft: get, updateIndependentRecordDraft: update }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "查看草稿" }));
    fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
    const modal = within(
      await screen.findByRole("dialog", { name: "编辑草稿" }),
    );
    fireEvent.change(modal.getByLabelText("改了什么、怎么改的"), {
      target: { value: "我的方案" },
    });
    fireEvent.click(modal.getByRole("button", { name: "保存草稿" }));
    fireEvent.click(
      await modal.findByRole("button", { name: "加载最新草稿并合并" }),
    );
    expect(
      await modal.findByRole("button", { name: "应用合并" }),
    ).toBeDisabled();
    expect(modal.getByLabelText("改了什么、怎么改的")).toHaveValue("我的方案");
    fireEvent.change(modal.getByLabelText(/改了什么、怎么改的冲突/), {
      target: { value: "mine" },
    });
    fireEvent.click(modal.getByRole("button", { name: "应用合并" }));
    fireEvent.click(modal.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls[1]![2].changeSolution).toBe("我的方案");
    expect(update.mock.calls[1]![3].headers["If-Match"]).toBe('"2"');
  });
  it("merges disjoint changes without discarding local edits", () => {
    expect(
      mergeRecordDraft(
        item,
        { ...item, title: "我的标题" },
        { ...item, resultVerification: "新的验证" },
      ),
    ).toMatchObject({
      values: { title: "我的标题", resultVerification: "新的验证" },
      conflicts: [],
    });
  });
});
const source = {
  taskId: 8,
  projectId: 1,
  moduleId: 2,
  featureId: null,
  scopeType: "MODULE",
  title: "来源标题",
  assigneeId: 9,
  workStatus: "TODO",
  lifecycleStatus: "ACTIVE",
  rowVersion: 4,
  impactFeatureIds: [],
};
it("lists all source drafts without implicit selection and explicitly creates another with task version", async () => {
  const create = vi.fn().mockResolvedValue({ ...item, id: 10, taskId: 8 });
  const api = client({
    getTaskRecordDrafts: vi.fn().mockResolvedValue({
      source,
      items: [
        { ...item, taskId: 8 },
        { ...item, id: 9, taskId: 8, title: "另一草稿" },
      ],
    }),
    createTaskRecordDraft: create,
  });
  mount(api, "/records?projectId=1&moduleId=2&taskId=8");
  expect(
    await screen.findAllByRole("button", { name: "查看草稿" }),
  ).toHaveLength(2);
  expect(
    screen.queryByRole("region", { name: "草稿详情" }),
  ).not.toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "新建来源草稿" }));
  const modal = within(
    await screen.findByRole("dialog", { name: "新建来源草稿" }),
  );
  expect(modal.getByLabelText("迭代标题")).toHaveValue("来源标题");
  expect(modal.queryByLabelText("所属模块")).not.toBeInTheDocument();
  for (const label of [
    "为什么改、发现了什么问题",
    "改了什么、怎么改的",
    "改完效果如何、如何验证",
  ])
    fireEvent.change(modal.getByLabelText(label), {
      target: { value: "说明" },
    });
  fireEvent.click(modal.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(create.mock.calls[0]!.slice(0, 4)).toEqual([
    1,
    2,
    8,
    {
      title: null,
      contextProblem: "说明",
      changeSolution: "说明",
      resultVerification: "说明",
      remainingIssues: "",
    },
  ]);
  expect(create.mock.calls[0]![4].headers["If-Match"]).toBe('"4"');
});
it("continues the selected source draft through the workflow without copying source fields", async () => {
  const draft = { ...item, taskId: 8 };
  const update = vi.fn().mockResolvedValue({ ...draft, rowVersion: 2 });
  const api = client({
    getTaskRecordDrafts: vi.fn().mockResolvedValue({ source, items: [draft] }),
    getRecordDraft: vi.fn().mockResolvedValue(draft),
    updateTaskRecordDraft: update,
  });
  mount(api, "/records?projectId=1&moduleId=2&taskId=8");
  fireEvent.click(await screen.findByRole("button", { name: "查看草稿" }));
  fireEvent.click(await screen.findByRole("button", { name: "继续编辑" }));
  const modal = within(await screen.findByRole("dialog", { name: "编辑草稿" }));
  fireEvent.change(modal.getByLabelText("还有什么问题（选填）"), {
    target: { value: "补充" },
  });
  fireEvent.click(modal.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  expect(update.mock.calls[0]!.slice(0, 4)).toEqual([1, 2, 8, 7]);
  expect(update.mock.calls[0]![4]).toEqual({
    title: item.title,
    contextProblem: item.contextProblem,
    changeSolution: item.changeSolution,
    resultVerification: item.resultVerification,
    remainingIssues: "补充",
  });
  expect(update.mock.calls[0]![5].headers["If-Match"]).toBe('"1"');
});
