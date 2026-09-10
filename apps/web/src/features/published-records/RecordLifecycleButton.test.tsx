import React from "react";
import { ConfigProvider } from "antd";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import {
  ApiError,
  type PublishedRecord,
  type ReadableRecord,
  type InpulseApiClient,
} from "@generated/api";
import { RecordLifecycleButton } from "./RecordLifecycleButton";
vi.mock("@features/auth/AdminReauthenticateModal", () => ({
  AdminReauthenticateModal: () => <p>双因子验证测试入口</p>,
}));
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

function mount(api: InpulseApiClient, record: ReadableRecord = item) {
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider client={new QueryClient()}>
        <RecordLifecycleButton item={record} api={api} onChanged={() => {}} />
      </QueryClientProvider>
    </ConfigProvider>,
  );
  fireEvent.click(
    screen.getByRole("button", {
      name: record.status === "VOID" ? "恢复记录" : "作废记录",
    }),
  );
}
it("requires reason, sends If-Match and preserves input/key on retry", async () => {
  const save = vi
    .fn()
    .mockRejectedValueOnce(Error("network"))
    .mockResolvedValue({ id: 7, projectId: 1, status: "VOID", rowVersion: 3 });
  const api = {
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
    voidChangeRecord: save,
  } as unknown as InpulseApiClient;
  mount(api);
  expect(screen.getByRole("button", { name: "确认作废记录" })).toBeDisabled();
  fireEvent.change(screen.getByLabelText("作废原因"), {
    target: { value: "  误发布  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认作废记录" }));
  await screen.findByText("暂时无法操作，原因已保留，可重试。");
  expect(screen.getByLabelText("作废原因")).toHaveValue("  误发布  ");
  fireEvent.click(screen.getByRole("button", { name: "确认作废记录" }));
  await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
  expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
  expect(save.mock.calls[0]).toMatchObject([
    1,
    7,
    { reason: "误发布" },
    { headers: { "If-Match": '"2"' } },
  ]);
});
it("409 requires loading current state and explicit confirmation before restoring", async () => {
  const voided = {
    ...item,
    status: "VOID" as const,
    rowVersion: 3,
    voidedAt: item.updatedAt,
    voidReason: "已有原因",
  };
  const save = vi
    .fn()
    .mockRejectedValue(
      new ApiError(409, {
        code: "RECORD_STATE_CONFLICT",
        message: "冲突",
        details: {},
        requestId: "r",
      }),
    );
  const restore = vi
    .fn()
    .mockResolvedValue({
      id: 7,
      projectId: 1,
      status: "PUBLISHED",
      rowVersion: 4,
    });
  const api = {
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
    voidChangeRecord: save,
    restoreChangeRecord: restore,
    getChangeRecord: vi.fn().mockResolvedValue(voided),
  } as unknown as InpulseApiClient;
  mount(api);
  fireEvent.change(screen.getByLabelText("作废原因"), {
    target: { value: "需要处理" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认作废记录" }));
  await screen.findByText(
    "记录或父级状态已变化。请加载最新状态，核对后重新确认。",
  );
  expect(screen.getByRole("button", { name: "确认作废记录" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "加载最新状态" }));
  await screen.findByLabelText("恢复原因");
  expect(restore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "确认恢复记录" }));
  await waitFor(() => expect(restore).toHaveBeenCalledOnce());
  expect(restore.mock.calls[0]).toMatchObject([
    1,
    7,
    { reason: "需要处理" },
    { headers: { "If-Match": '"3"' } },
  ]);
});
it("keeps the reason while opening dual-factor reauthentication", async () => {
  const api = {
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
    voidChangeRecord: vi
      .fn()
      .mockRejectedValue(
        new ApiError(403, {
          code: "ADMIN_REAUTH_REQUIRED",
          message: "验证",
          details: {},
          requestId: "r",
        }),
      ),
  } as unknown as InpulseApiClient;
  mount(api);
  fireEvent.change(screen.getByLabelText("作废原因"), {
    target: { value: "保留此原因" },
  });
  fireEvent.click(screen.getByRole("button", { name: "确认作废记录" }));
  await screen.findByText("双因子验证测试入口");
  expect(screen.getByLabelText("作废原因")).toHaveValue("保留此原因");
});
