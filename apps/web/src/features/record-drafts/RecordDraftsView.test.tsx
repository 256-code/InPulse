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
    listMyRecordDrafts: vi.fn().mockResolvedValue({
      items: [],
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
  currentUserName?: string,
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
            currentUserName={currentUserName}
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
    const api = client({ createIndependentRecordDraft: create });
    const canCreate = vi.fn();
    const { rerender } = render(
      mountView(api, "/records?projectId=1", undefined, 0, canCreate),
    );
    // 新建入口已收到页头 CTA：等可写后再推进令牌，等价于点一次页头按钮。
    await waitFor(() => expect(canCreate).toHaveBeenLastCalledWith(true));
    rerender(mountView(api, "/records?projectId=1", undefined, 1, canCreate));
    const modal = within(
      await screen.findByRole("dialog", { name: "新建迭代记录" }),
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
  it("selects several impact features through the multi-select and sends them all", async () => {
    const create = vi.fn().mockResolvedValue(item);
    const api = client({
      createIndependentRecordDraft: create,
      listFeatures: vi.fn().mockResolvedValue({
        items: [
          { id: 11, name: "用户登录与会话管理", status: "ACTIVE" },
          { id: 12, name: "用户管理", status: "ACTIVE" },
          { id: 13, name: "已归档功能", status: "ARCHIVED" },
        ],
      }),
    });
    const canCreate = vi.fn();
    const { rerender } = render(
      mountView(api, "/records?projectId=1", undefined, 0, canCreate),
    );
    await waitFor(() => expect(canCreate).toHaveBeenLastCalledWith(true));
    rerender(mountView(api, "/records?projectId=1", undefined, 1, canCreate));
    const modal = within(
      await screen.findByRole("dialog", { name: "新建迭代记录" }),
    );
    await pickInModal(modal, "所属模块", "支付模块");
    // 影响功能是多选下拉：打开一次连点两项，触发器把已选项渲染成 chips。
    const trigger = modal.getByLabelText("影响功能").closest(".ant-select");
    if (!trigger) {
      throw new Error("影响功能下拉未找到");
    }
    fireEvent.mouseDown(trigger);
    fireEvent.click(await screen.findByTitle("用户登录与会话管理"));
    fireEvent.click(await screen.findByTitle("用户管理"));
    await waitFor(() =>
      expect(
        trigger.querySelectorAll(".ant-select-selection-item").length,
      ).toBe(2),
    );
    for (const [label, value] of [
      ["迭代标题", item.title],
      ["改动原因", item.contextProblem],
      ["具体改动", item.changeSolution],
      ["改动效果", item.resultVerification],
    ])
      fireEvent.change(modal.getByLabelText(label!), { target: { value } });
    fireEvent.click(modal.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]![2]).toMatchObject({
      scopeType: "MODULE",
      impactFeatureIds: [11, 12],
    });
  });
  it("shows the draft title in the modal header instead of repeating it in the body", async () => {
    mount(client(), "/records?projectId=1&recordId=7");
    const dialog = await screen.findByRole("dialog", { name: "草稿详情" });
    // 弹层标题是记录标题本身，眉标是「草稿」（同正式记录详情弹层的写法）。
    expect(
      await within(dialog).findByRole("heading", {
        name: "支付修正",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("草稿", { selector: ".detail-label" }),
    ).toBeInTheDocument();
    const detail = within(
      await screen.findByRole("region", { name: "草稿详情" }),
    );
    // 正文不再重复标题，也不再出现与弹层标题同级的第二个 h2。
    expect(detail.queryByRole("heading", { name: "支付修正" })).toBeNull();
    expect(detail.getByText(/记录作者/)).toBeInTheDocument();
    expect(
      detail.getByRole("heading", { name: "改动原因", level: 3 }),
    ).toBeInTheDocument();
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
    fireEvent.click(await screen.findByRole("button", { name: /支付修正/ }));
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
    await screen.findAllByRole("button", { name: /继续编辑/ }),
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
  // 带来源任务时发布由任务完成流程（F-19）负责：弹窗里没有发布入口，
  //「保存草稿」仍是唯一的主按钮，不会退成淡蓝次级。
  expect(modal.queryByRole("button", { name: "新建迭代" })).toBeNull();
  expect(modal.getByRole("button", { name: "保存草稿" }).className).toContain(
    "primary-button",
  );
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
  fireEvent.click(await screen.findByRole("button", { name: /支付修正/ }));
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

it("lists project drafts as flat cards and opens one straight away", async () => {
  mount(client());
  const cards = await screen.findAllByRole("button", { name: /继续编辑/ });
  expect(cards).toHaveLength(1);
  expect(within(cards[0]!).getByText("支付修正")).toBeVisible();
  fireEvent.click(cards[0]!);
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "草稿详情" })).toBeVisible(),
  );
});
it("lists my drafts across projects, labels the owning project and opens it", async () => {
  const getRecordDraft = vi
    .fn()
    .mockResolvedValue({ ...item, id: 21, projectId: 5 });
  const listMyRecordDrafts = vi.fn().mockResolvedValue({
    items: [
      {
        draft: { ...item, id: 21, projectId: 5 },
        projectName: "风控项目",
        moduleName: "风控模块",
        featureName: null,
      },
    ],
    nextCursor: null,
    hasMore: false,
  });
  render(
    mountView(
      client({ listMyRecordDrafts, getRecordDraft }),
      "/records",
      3,
      0,
      undefined,
      "开发者 C",
    ),
  );
  // 全部项目视图也要展示草稿箱：标题变成跨项目汇总的「我的草稿」。
  expect(
    await screen.findByRole("heading", { name: "我的草稿" }),
  ).toBeVisible();
  expect(listMyRecordDrafts).toHaveBeenCalledWith(
    { limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  const card = await screen.findByRole("button", { name: /继续编辑/ });
  // 卡片带上草稿所属的项目名，避免跨项目视图里分不清归属。
  expect(within(card).getByText("风控项目 / 风控模块")).toBeVisible();
  // 服务端不回填作者名，用登录用户名兜底，而不是「名称暂不可用」。
  expect(card).toHaveTextContent("开发者 C");
  fireEvent.click(card);
  // 打开的是草稿自己的项目 + 记录，而不是 URL 里空缺的 projectId。
  expect(getRecordDraft).toHaveBeenCalledWith(
    5,
    21,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  await waitFor(() =>
    expect(screen.getByRole("dialog", { name: "草稿详情" })).toBeVisible(),
  );
});
it("saves the draft and publishes it when the new-iteration action is used", async () => {
  const create = vi.fn().mockResolvedValue({ ...item, id: 12, rowVersion: 1 });
  const publishChangeRecord = vi.fn().mockResolvedValue({
    ...item,
    id: 12,
    rowVersion: 2,
    status: "PUBLISHED",
    code: "PAY-CR-1",
    currentVersion: 1,
    publishedAt: "2026-09-10T01:00:00.000Z",
  });
  const api = client({
    createIndependentRecordDraft: create,
    publishChangeRecord,
  });
  const canCreate = vi.fn();
  const { rerender } = render(
    mountView(api, "/records?projectId=1", undefined, 0, canCreate),
  );
  await waitFor(() => expect(canCreate).toHaveBeenLastCalledWith(true));
  rerender(mountView(api, "/records?projectId=1", undefined, 1, canCreate));
  const modal = within(
    await screen.findByRole("dialog", { name: "新建迭代记录" }),
  );
  await pickInModal(modal, "所属模块", "支付模块");
  // 页脚两个动作：「保存草稿」退成淡蓝次级，右侧是主按钮「新建迭代」。
  expect(modal.getByRole("button", { name: "保存草稿" }).className).toContain(
    "soft-blue-button",
  );
  const publish = modal.getByRole("button", { name: "新建迭代" });
  expect(publish.className).toContain("primary-button");
  for (const [label, value] of [
    ["迭代标题", item.title],
    ["改动原因", item.contextProblem],
    ["具体改动", item.changeSolution],
    ["改动效果", item.resultVerification],
  ])
    fireEvent.change(modal.getByLabelText(label!), { target: { value } });
  fireEvent.click(publish);
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  await waitFor(() => expect(publishChangeRecord).toHaveBeenCalledOnce());
  // 发布必须带刚建出来的草稿版本：If-Match 用创建响应的 rowVersion。
  expect(publishChangeRecord.mock.calls[0]!.slice(0, 3)).toEqual([1, 12, {}]);
  const init = publishChangeRecord.mock.calls[0]![3];
  expect(init.headers["If-Match"]).toBe(
    String.fromCharCode(34) + "1" + String.fromCharCode(34),
  );
  expect(init.headers["x-csrf-token"]).toBe("a".repeat(43));
  expect(typeof init.headers["Idempotency-Key"]).toBe("string");
  // 发布成功直接落到正式记录：弹窗关闭且不会再打开草稿详情。
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "新建迭代记录" })).toBeNull(),
  );
  expect(screen.queryByRole("dialog", { name: "草稿详情" })).toBeNull();
});
it("keeps the created draft and edits it in place when publishing fails", async () => {
  const create = vi.fn().mockResolvedValue({ ...item, id: 12, rowVersion: 1 });
  const update = vi.fn().mockResolvedValue({ ...item, id: 12, rowVersion: 2 });
  const publishChangeRecord = vi.fn().mockRejectedValue(
    new ApiError(422, {
      code: "RECORD_CONTENT_TOO_LARGE",
      message: "正文超出搜索容量",
      requestId: "test",
      details: {},
    }),
  );
  const api = client({
    createIndependentRecordDraft: create,
    updateIndependentRecordDraft: update,
    publishChangeRecord,
  });
  const canCreate = vi.fn();
  const { rerender } = render(
    mountView(api, "/records?projectId=1", undefined, 0, canCreate),
  );
  await waitFor(() => expect(canCreate).toHaveBeenLastCalledWith(true));
  rerender(mountView(api, "/records?projectId=1", undefined, 1, canCreate));
  const modal = within(
    await screen.findByRole("dialog", { name: "新建迭代记录" }),
  );
  await pickInModal(modal, "所属模块", "支付模块");
  for (const [label, value] of [
    ["迭代标题", item.title],
    ["改动原因", item.contextProblem],
    ["具体改动", item.changeSolution],
    ["改动效果", item.resultVerification],
  ])
    fireEvent.change(modal.getByLabelText(label!), { target: { value } });
  fireEvent.click(modal.getByRole("button", { name: "新建迭代" }));
  await waitFor(() => expect(publishChangeRecord).toHaveBeenCalledOnce());
  // 草稿已经落库：弹窗留在原地并切到这条草稿的编辑态，输入不丢。
  const retry = await modal.findByRole("button", { name: "保存并发布" });
  expect(modal.getByLabelText("迭代标题")).toHaveValue(item.title);
  fireEvent.click(retry);
  await waitFor(() => expect(update).toHaveBeenCalledOnce());
  // 重试走的是更新同一条草稿，没有第二条创建。
  expect(update.mock.calls[0]!.slice(0, 2)).toEqual([1, 12]);
  expect(update.mock.calls[0]![2].title).toBe(item.title);
  expect(create).toHaveBeenCalledOnce();
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
    await screen.findByRole("dialog", { name: "新建迭代记录" }),
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

it("收起草稿箱：空草稿时只留标题行，不渲染内容区与「暂无草稿」空态", async () => {
  mount(
    client({
      listRecordDrafts: vi.fn().mockResolvedValue({
        items: [],
        nextCursor: null,
        hasMore: false,
      }),
    }),
  );
  // 空草稿箱是「收起」而不是「整块消失」：标题行仍在，内容区不占竖向空间。
  expect(
    await screen.findByRole("heading", { name: "项目草稿" }),
  ).toBeVisible();
  await waitFor(() =>
    expect(document.querySelector("#record-draft-list")).toBeNull(),
  );
  expect(screen.queryByText("暂无草稿")).toBeNull();
});

it("展开草稿箱：有草稿时默认照旧平铺卡片", async () => {
  mount(client());
  expect(
    await screen.findByRole("heading", { name: "项目草稿" }),
  ).toBeVisible();
  await waitFor(() =>
    expect(document.querySelector("#record-draft-list")).not.toBeNull(),
  );
  expect(
    await screen.findAllByRole("button", { name: /继续编辑/ }),
  ).toHaveLength(1);
});

it("全部项目视图的空草稿箱同样收起，标题仍是「我的草稿」", async () => {
  render(mountView(client(), "/records", 3));
  expect(
    await screen.findByRole("heading", { name: "我的草稿" }),
  ).toBeVisible();
  await waitFor(() =>
    expect(document.querySelector("#record-draft-list")).toBeNull(),
  );
});

it("来源任务的空草稿箱收起，标题行的「新建来源草稿」入口保留", async () => {
  const api = client({
    getTaskRecordDrafts: vi.fn().mockResolvedValue({ source, items: [] }),
  });
  mount(api, "/records?projectId=1&moduleId=2&taskId=8");
  expect(
    await screen.findByRole("button", { name: "新建来源草稿" }),
  ).toBeVisible();
  await waitFor(() =>
    expect(document.querySelector("#record-draft-list")).toBeNull(),
  );
});

it("草稿读取失败时内容区仍然展开，保留错误与重试入口", async () => {
  mount(
    client({
      listRecordDrafts: vi
        .fn()
        .mockRejectedValue(new ApiError(500, { code: "boom" })),
    }),
  );
  expect(
    await screen.findByRole("button", { name: "重试草稿列表" }),
  ).toBeVisible();
});
