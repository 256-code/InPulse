import React from "react";
import { ConfigProvider } from "antd";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { it, expect, vi } from "vitest";
import {
  ApiError,
  type InpulseApiClient,
  type PublishedRecord,
} from "@generated/api";
import { ConvertLeftoverTask, parseFollowupDueAt } from "./ConvertLeftoverTask";
const item = {
  contextProblem: "问题",
  changeSolution: "方案",
  resultVerification: "验证",
  remainingIssues: "原文",
  taskId: null,
  handlerId: 3,
  authorId: 3,
  status: "PUBLISHED",
  code: "SHOP-CR-1",
  currentVersion: 1,
  publishedAt: "2026-09-10T00:00:00.000Z",
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  rowVersion: 2,
  impactFeatureIds: [4, 6],
  id: 7,
  projectId: 1,
  moduleId: 2,
  featureId: null,
  scopeType: "MODULE",
  title: "记录",
  leftoverItem: { id: 8, status: "ACTIVE", rowVersion: 1, linkedTaskId: null },
  leftovers: [{ id: 8, content: "原文", status: "ACTIVE", rowVersion: 1 }],
} as PublishedRecord;
const preview = {
  recordId: 7,
  recordVersion: 1,
  rowVersion: 2,
  leftoverItemId: 8,
  leftoverRowVersion: 1,
  status: "ACTIVE",
  content: "待跟进原文",
  inheritedImpacts: [{ id: 4, name: "支付" }],
  excludedImpacts: [{ id: 6, name: "旧功能" }],
  linkedTask: null,
};
const result = {
  projectId: 1,
  moduleId: 2,
  featureId: null,
  taskId: 10,
  recordId: 7,
  leftoverItemId: 8,
  recordVersion: 1,
  recordRowVersion: 3,
  leftoverRowVersion: 2,
  impactFeatureIds: [4],
};
function mount(extra: object) {
  const api = {
    previewLeftoverTask: vi.fn().mockResolvedValue(preview),
    listModuleTaskAssignees: vi
      .fn()
      .mockResolvedValue({ items: [{ id: 3, name: "成员" }] }),
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
    ...extra,
  } as unknown as InpulseApiClient;
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider client={new QueryClient()}>
        <ConvertLeftoverTask item={item} api={api} writable />
      </QueryClientProvider>
    </ConfigProvider>,
  );
}
async function open() {
  fireEvent.click(screen.getByRole("button", { name: "转为新任务" }));
  await screen.findByText("待跟进原文");
  await screen.findByRole("option", { name: "成员" });
  fireEvent.change(screen.getByLabelText("跟进任务负责人"), {
    target: { value: "3" },
  });
}
it("shows inherited/excluded history, retains input and reuses the key after uncertain failure", async () => {
  const convert = vi
    .fn()
    .mockRejectedValueOnce(Error("network"))
    .mockResolvedValue(result);
  mount({ convertLeftoverToTask: convert });
  await open();
  await waitFor(() =>
    expect(screen.getByText(/历史归档影响不加入新任务：旧功能/)).toBeVisible(),
  );
  fireEvent.change(screen.getByLabelText("跟进任务标题"), {
    target: { value: "我的跟进标题" },
  });
  fireEvent.change(screen.getByLabelText("跟进任务截止时间（选填）"), {
    target: { value: "2026-10-10T18:30" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建跟进任务" }));
  await screen.findByText("暂时无法转换，输入已保留，请重试。");
  expect(screen.getByLabelText("跟进任务标题")).toHaveValue("我的跟进标题");
  expect(screen.getByLabelText("跟进任务截止时间（选填）")).toHaveValue(
    "2026-10-10T18:30",
  );
  fireEvent.click(screen.getByRole("button", { name: "创建跟进任务" }));
  await screen.findByRole("link", { name: "查看跟进任务" });
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(convert.mock.calls[0]).toEqual(convert.mock.calls[1]);
  expect(convert.mock.calls[0]![2]).toMatchObject({
    leftoverItemId: 8,
    recordVersion: 1,
    expectedRowVersion: 2,
    leftoverExpectedRowVersion: 1,
    expectedImpactFeatureIds: [4],
    title: "我的跟进标题",
    assigneeId: 3,
    dueAt: new Date(2026, 9, 10, 18, 30).toISOString(),
  });
  expect(convert.mock.calls[0]![2]).not.toHaveProperty("description");
  expect(convert.mock.calls[0]![2]).not.toHaveProperty("projectId");
});
it("requires explicit confirmation after 409 impact/content change, retaining task input", async () => {
  const convert = vi
    .fn()
    .mockRejectedValueOnce(
      new ApiError(409, {
        code: "LEFTOVER_IMPACTS_CHANGED",
        message: "冲突",
        details: {},
        requestId: "test",
      }),
    )
    .mockResolvedValue({ ...result, impactFeatureIds: [] });
  mount({
    convertLeftoverToTask: convert,
    previewLeftoverTask: vi
      .fn()
      .mockResolvedValueOnce(preview)
      .mockRejectedValueOnce(Error("refresh network failure"))
      .mockResolvedValue({
        ...preview,
        rowVersion: 3,
        recordVersion: 2,
        content: "最新遗留全文",
        inheritedImpacts: [],
        excludedImpacts: [
          { id: 4, name: "支付" },
          { id: 6, name: "旧功能" },
        ],
      }),
  });
  await open();
  fireEvent.change(screen.getByLabelText("跟进任务标题"), {
    target: { value: "保留标题" },
  });
  fireEvent.change(screen.getByLabelText("跟进任务截止时间（选填）"), {
    target: { value: "2026-10-11T09:15" },
  });
  fireEvent.click(screen.getByRole("button", { name: "创建跟进任务" }));
  await screen.findByRole("button", { name: "刷新转换预览" });
  expect(
    await screen.findByRole("button", { name: "创建跟进任务" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "刷新转换预览" }));
  await screen.findByText("暂时无法转换，输入已保留，请重试。");
  expect(
    await screen.findByRole("button", { name: "创建跟进任务" }),
  ).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "刷新转换预览" }));
  await screen.findByText("最新遗留全文");
  expect(
    await screen.findByRole("button", { name: "创建跟进任务" }),
  ).toBeDisabled();
  expect(screen.getByLabelText("跟进任务标题")).toHaveValue("保留标题");
  expect(screen.getByLabelText("跟进任务截止时间（选填）")).toHaveValue(
    "2026-10-11T09:15",
  );
  fireEvent.click(screen.getByRole("button", { name: "确认使用最新预览" }));
  fireEvent.click(screen.getByRole("button", { name: "创建跟进任务" }));
  await waitFor(() => expect(convert).toHaveBeenCalledTimes(2));
  expect(convert.mock.calls[1]![2]).toMatchObject({
    title: "保留标题",
    recordVersion: 2,
    expectedRowVersion: 3,
    expectedImpactFeatureIds: [],
    dueAt: new Date(2026, 9, 11, 9, 15).toISOString(),
  });
  expect(convert.mock.calls[0]![3].headers["Idempotency-Key"]).not.toBe(
    convert.mock.calls[1]![3].headers["Idempotency-Key"],
  );
});
it("changes the key when the deadline changes and sends null when cleared", async () => {
  const convert = vi
    .fn()
    .mockRejectedValueOnce(Error("network"))
    .mockRejectedValueOnce(Error("network"))
    .mockResolvedValue(result);
  mount({ convertLeftoverToTask: convert });
  await open();
  const due = screen.getByLabelText("跟进任务截止时间（选填）");
  fireEvent.change(due, { target: { value: "2026-10-10T18:30" } });
  fireEvent.click(screen.getByRole("button", { name: "创建跟进任务" }));
  await screen.findByText("暂时无法转换，输入已保留，请重试。");
  fireEvent.change(due, { target: { value: "2026-10-12T08:45" } });
  fireEvent.click(screen.getByRole("button", { name: "创建跟进任务" }));
  await waitFor(() => expect(convert).toHaveBeenCalledTimes(2));
  await screen.findByText("暂时无法转换，输入已保留，请重试。");
  fireEvent.change(due, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: "创建跟进任务" }));
  await screen.findByRole("link", { name: "查看跟进任务" });
  expect(convert.mock.calls.map((call) => call[2].dueAt)).toEqual([
    new Date(2026, 9, 10, 18, 30).toISOString(),
    new Date(2026, 9, 12, 8, 45).toISOString(),
    null,
  ]);
  expect(
    new Set(
      convert.mock.calls.map((call) => call[3].headers["Idempotency-Key"]),
    ).size,
  ).toBe(3);
});
it("rejects malformed or overflowing local dates without throwing", () => {
  for (const value of [
    "invalid",
    "2026-02-30T12:00",
    "2026-13-01T00:00",
    "2026-10-10T25:00",
  ]) {
    expect(() => parseFollowupDueAt(value)).not.toThrow();
    expect(parseFollowupDueAt(value)).toBeUndefined();
  }
  expect(parseFollowupDueAt("")).toBeNull();
});
