import React from "react";
import { ConfigProvider } from "antd";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import {
  ApiError,
  type PublishedRecord,
  type InpulseApiClient,
} from "@generated/api";
import { EditPublishedRecord } from "./EditPublishedRecord";
const item: PublishedRecord = {
  id: 7,
  projectId: 1,
  moduleId: 2,
  featureId: null,
  scopeType: "MODULE",
  taskId: null,
  impactFeatureIds: [],
  handlerId: 3,
  authorId: 3,
  status: "PUBLISHED",
  code: "SHOP-CR-1",
  currentVersion: 1,
  rowVersion: 2,
  publishedAt: "2026-09-10T00:00:00.000Z",
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  title: "支付修订",
  contextProblem: "问题",
  changeSolution: "原方案",
  resultVerification: "验证",
  remainingIssues: "需要跟进",
  leftovers: [{ id: 9, content: "需要跟进", status: "ACTIVE", rowVersion: 1 }],
  leftoverItem: { id: 9, status: "ACTIVE", rowVersion: 1, linkedTaskId: null },
};
function mount(api: InpulseApiClient) {
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider client={new QueryClient()}>
        <EditPublishedRecord item={item} api={api} writable />
      </QueryClientProvider>
    </ConfigProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "修订内容" }));
}
it("requires explicit resolution and preserves the same key and input when retrying a failed request", async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(new Error("network"))
    .mockResolvedValue({ ...item, currentVersion: 2 });
  const api = {
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
    createChangeRecordVersion: save,
  } as unknown as InpulseApiClient;
  mount(api);
  fireEvent.change(screen.getByLabelText("还有什么问题（选填）"), {
    target: { value: "" },
  });
  expect(screen.getByRole("button", { name: "保存新版本" })).toBeDisabled();
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "确认遗留问题已解决，清空本版本内容",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "保存新版本" }));
  await screen.findByText("服务暂时不可用，输入已保留，可重试。");
  expect(screen.getByLabelText("还有什么问题（选填）")).toHaveValue("");
  fireEvent.click(screen.getByRole("button", { name: "保存新版本" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
  expect(save.mock.calls[0]![2]).toMatchObject({
    remainingIssues: "",
    confirmLeftoverResolved: true,
  });
  expect(save.mock.calls[0]![3]).toMatchObject({
    headers: { "If-Match": '"2"', "X-Record-Version": "1" },
  });
});
it("retains input on conflict and requires choosing before saving against the latest two versions", async () => {
  const latest = {
    ...item,
    currentVersion: 2,
    rowVersion: 3,
    changeSolution: "其他人的方案",
  };
  const save = vi
    .fn()
    .mockRejectedValueOnce(
      new ApiError(409, {
        code: "RECORD_VERSION_CONFLICT",
        message: "版本冲突",
        details: {},
        requestId: "r",
      }),
    )
    .mockResolvedValue({ ...latest, currentVersion: 3 });
  const api = {
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
    createChangeRecordVersion: save,
    getChangeRecord: vi.fn().mockResolvedValue(latest),
  } as unknown as InpulseApiClient;
  mount(api);
  fireEvent.change(screen.getByLabelText("改了什么、怎么改的"), {
    target: { value: "我的方案" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存新版本" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "加载最新版本并合并" }),
  );
  await screen.findByText("最新内容：其他人的方案");
  expect(screen.getByLabelText("改了什么、怎么改的")).toHaveValue("我的方案");
  expect(screen.getByRole("button", { name: "应用合并" })).toBeDisabled();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "mine" } });
  fireEvent.click(screen.getByRole("button", { name: "应用合并" }));
  fireEvent.click(screen.getByRole("button", { name: "保存新版本" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[1]![2]).toMatchObject({ changeSolution: "我的方案" });
  expect(save.mock.calls[1]![3]).toMatchObject({
    headers: { "If-Match": '"3"', "X-Record-Version": "2" },
  });
  expect(save.mock.calls[0]![3].headers["Idempotency-Key"]).not.toBe(
    save.mock.calls[1]![3].headers["Idempotency-Key"],
  );
});
