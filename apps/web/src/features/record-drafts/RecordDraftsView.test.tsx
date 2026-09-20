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
  remainingIssues: [],
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
    listRecordDrafts: vi.fn().mockResolvedValue({
      items: [item],
      nextCursor: null,
      hasMore: false,
    }),
    getRecordDraft: vi.fn().mockResolvedValue(item),
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
    ...overrides,
  } as unknown as InpulseApiClient;
}
function mountView(
  api: InpulseApiClient,
  path = "/records?projectId=1",
  currentUserId?: number,
  createToken = 0,
  onCanCreateChange?: (value: boolean) => void,
) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <RecordDraftsView
            client={api}
            currentUserId={currentUserId}
            createToken={createToken}
            onCanCreateChange={onCanCreateChange}
          />
        </QueryClientProvider>
      </ConfigProvider>
    </MemoryRouter>
  );
}
function mount(
  api: InpulseApiClient,
  path = "/records?projectId=1",
  currentUserId?: number,
) {
  render(mountView(api, path, currentUserId));
}
/** CalmSelect 交互：在弹窗内打开下拉并点选目标项（弹层项挂在 body 上，带 title 属性）。 */
async function pickInModal(
  modal: ReturnType<typeof within>,
  label: string,
  optionTitle: string,
) {
  const trigger = modal.getByLabelText(label).closest(".ant-select");
  if (!trigger) {
    throw new Error("select trigger not found for " + label);
  }
  fireEvent.mouseDown(trigger);
  fireEvent.click(await screen.findByTitle(optionTitle));
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
    await pickInModal(modal, "所属模块", "支付模块");
    fireEvent.click(modal.getByRole("button", { name: "保存草稿" }));
    await modal.findAllByText("请填写此项");
    expect(create).not.toHaveBeenCalled();
    for (const [label, value] of [
      ["迭代标题", item.title],
      ["改动原因", item.contextProblem],
      ["具体改动", item.changeSolution],
      ["改动效果", item.resultVerification],
    ])
      fireEvent.change(modal.getByLabelText(label!), { target: { value } });
    fireEvent.click(modal.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]![2]).toEqual({
      title: item.title,
      contextProblem: item.contextProblem,
      changeSolution: item.changeSolution,
      resultVerification: item.resultVerification,
      remainingIssues: [],
      scopeType: "MODULE",
      impactFeatureIds: [],
    });
    await waitFor(() =>
      expect(screen.getByText("暂无已知遗留问题")).toBeVisible(),
    );
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
    fireEvent.change(modal.getByLabelText("具体改动"), {
      target: { value: "我的方案" },
    });
    fireEvent.click(modal.getByRole("button", { name: "保存草稿" }));
    fireEvent.click(
      await modal.findByRole("button", { name: "加载最新草稿并合并" }),
    );
    expect(
      await modal.findByRole("button", { name: "应用合并" }),
    ).toBeDisabled();
    expect(modal.getByLabelText("具体改动")).toHaveValue("我的方案");
    await pickInModal(modal, "具体改动冲突", "保留我的输入");
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
  // 来源任务头部是卡片容器，新建按钮位于「来源草稿」标题行右侧而非裸排。
  expect(
    screen
      .getByRole("heading", { name: "来源标题", level: 2 })
      .closest(".draft-source-head"),
  ).not.toBeNull();
  expect(
    screen
      .getByRole("button", { name: "新建来源草稿" })
      .closest(".calm-section-title"),
  ).not.toBeNull();
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
  for (const label of ["改动原因", "具体改动", "改动效果"])
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
      remainingIssues: [],
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
  fireEvent.click(modal.getByRole("button", { name: "添加遗留问题" }));
  fireEvent.change(modal.getByLabelText("遗留问题（选填，可添加多条） 1"), {
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
    remainingIssues: [{ content: "补充" }],
  });
  expect(update.mock.calls[0]![5].headers["If-Match"]).toBe('"1"');
});

it("loads the next draft page with the server cursor", async () => {
  const nextItem = { ...item, id: 8, title: "第二页草稿" };
  const listRecordDrafts = vi
    .fn()
    .mockResolvedValueOnce({
      items: [item],
      nextCursor: "cursor-1",
      hasMore: true,
    })
    .mockResolvedValueOnce({
      items: [nextItem],
      nextCursor: null,
      hasMore: false,
    });
  mount(client({ listRecordDrafts }));
  expect(await screen.findByText("支付修正")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
  expect(await screen.findByText("第二页草稿")).toBeVisible();
  expect(listRecordDrafts).toHaveBeenLastCalledWith(
    1,
    { limit: 20, cursor: "cursor-1" },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});

it("lists my drafts across projects through the global query and opens the owning project", async () => {
  const listMyRecordDrafts = vi.fn().mockResolvedValue({
    items: [
      {
        draft: { ...item, id: 21, projectId: 5, title: "跨项目草稿" },
        projectName: "风控项目",
        moduleName: "风控模块",
        featureName: null,
      },
    ],
    nextCursor: null,
    hasMore: false,
  });
  const getRecordDraft = vi
    .fn()
    .mockResolvedValue({ ...item, id: 21, projectId: 5, title: "跨项目草稿" });
  mount(
    client({ listMyRecordDrafts, getRecordDraft }),
    "/records?projectId=1",
    3,
  );
  const strip = await screen.findByRole("region", { name: "我的草稿" });
  expect(within(strip).getByText("跨项目草稿")).toBeVisible();
  expect(within(strip).getByText("风控项目 / 风控模块")).toBeVisible();
  expect(listMyRecordDrafts).toHaveBeenCalledWith(
    { limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  fireEvent.click(within(strip).getByRole("button", { name: "跨项目草稿" }));
  await waitFor(() =>
    expect(getRecordDraft).toHaveBeenCalledWith(
      5,
      21,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ),
  );
});

it("creates an independent draft in the project chosen inside the dialog from the all-projects view", async () => {
  const create = vi
    .fn()
    .mockResolvedValue({ ...item, id: 12, projectId: 2, moduleId: 9 });
  const listModules = vi.fn().mockResolvedValue({
    items: [{ id: 9, name: "风控模块", status: "ACTIVE" }],
  });
  const api = client({
    listProjects: vi.fn().mockResolvedValue({
      items: [
        { id: 1, name: "支付项目", status: "ACTIVE" },
        { id: 2, name: "风控项目", status: "ACTIVE" },
      ],
    }),
    listModules,
    createIndependentRecordDraft: create,
  });
  const canCreate = vi.fn();
  const { rerender } = render(mountView(api, "/records", 3, 0, canCreate));
  // 「全部项目」下只要存在可写项目就允许发起创建。
  await waitFor(() => expect(canCreate).toHaveBeenLastCalledWith(true));
  rerender(mountView(api, "/records", 3, 1, canCreate));
  const modal = within(
    await screen.findByRole("dialog", { name: "新建独立草稿" }),
  );
  // 未选项目前不请求模块，也不能提交。
  expect(listModules).not.toHaveBeenCalled();
  expect(modal.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  await pickInModal(modal, "所属项目", "风控项目");
  // 项目确定后模块选项来自所选项目：打开下拉确认后点选。
  await pickInModal(modal, "所属模块", "风控模块");
  expect(listModules).toHaveBeenCalledWith(
    2,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  for (const [label, value] of [
    ["迭代标题", "风控修正"],
    ["改动原因", "说明"],
    ["具体改动", "说明"],
    ["改动效果", "说明"],
  ])
    fireEvent.change(modal.getByLabelText(label!), { target: { value } });
  fireEvent.click(modal.getByRole("button", { name: "保存草稿" }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(create.mock.calls[0]!.slice(0, 2)).toEqual([2, 9]);
});

it("reports the header action as unavailable when every visible project is archived", async () => {
  const canCreate = vi.fn();
  const archived = client({
    listProjects: vi.fn().mockResolvedValue({
      items: [{ id: 1, name: "支付项目", status: "ARCHIVED" }],
    }),
  });
  render(mountView(archived, "/records", 3, 0, canCreate));
  await waitFor(() => expect(canCreate).toHaveBeenLastCalledWith(false));
});
