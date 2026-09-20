import React from "react";
import { it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ApiError,
  type InpulseApiClient,
  type ChangeRecordVersion,
} from "@generated/api";
import {
  PublishedRecordDetail,
  compareRecordVersions,
} from "./PublishedRecordDetail";
vi.mock("@features/auth/auth-context", () => ({
  useAuth: () => ({ user: { id: 3, isAdmin: false } }),
}));
const first: ChangeRecordVersion = {
  recordId: 7,
  projectId: 1,
  versionNo: 1,
  createdBy: 3,
  createdAt: "2026-09-10T00:00:00.000Z",
  title: "支付修订",
  contextProblem: "重复请求",
  changeSolution: "增加幂等",
  resultVerification: "初次验证",
  remainingIssues: [],
  leftovers: [],
};
const second: ChangeRecordVersion = {
  ...first,
  versionNo: 2,
  resultVerification: "追加并发验证",
};
const item = {
  ...second,
  id: 7,
  moduleId: 2,
  featureId: null,
  scopeType: "MODULE",
  taskId: null,
  handlerId: 3,
  authorId: 3,
  status: "PUBLISHED",
  code: "SHOP-CR-1",
  currentVersion: 2,
  publishedAt: first.createdAt,
  createdAt: first.createdAt,
  updatedAt: first.createdAt,
  rowVersion: 3,
  impactFeatureIds: [],
  leftovers: [],
};
function mountDetail(
  api: InpulseApiClient,
  { standalone = true }: { standalone?: boolean } = {},
) {
  return render(
    <MemoryRouter initialEntries={["/records?projectId=1&publishedId=7"]}>
      <QueryClientProvider client={new QueryClient()}>
        <PublishedRecordDetail
          projectId={1}
          recordId={7}
          client={api}
          writable
          standalone={standalone}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
it("compares exact immutable version content and identifies unchanged fields", () => {
  const diff = compareRecordVersions(first, second);
  expect(diff.filter((x) => x.changed)).toEqual([
    {
      field: "resultVerification",
      label: "改动效果",
      before: "初次验证",
      after: "追加并发验证",
      changed: true,
    },
  ]);
});
it("loads real version data and permits selecting historical snapshots", async () => {
  const api = {
    getChangeRecord: vi.fn().mockResolvedValue(item),
    listChangeRecordVersions: vi
      .fn()
      .mockResolvedValue({ items: [second, first] }),
  } as unknown as InpulseApiClient;
  mountDetail(api);
  const diff = within(await screen.findByRole("generic", { name: "版本差异" }));
  expect(diff.getByText("初次验证")).toBeVisible();
  expect(diff.getByText("追加并发验证")).toBeVisible();
  // 无变化字段不再渲染：标题等四项不应出现在差异区。
  expect(diff.queryByText("迭代标题")).toBeNull();
  const region = screen.getByRole("region", { name: "正式记录详情" });
  expect(within(region).getByText("SHOP-CR-1 · v2 · 已发布")).toBeVisible();
  const compareField = within(region).getByLabelText("对照版本");
  const compareTrigger = compareField.closest(".ant-select");
  if (!compareTrigger) {
    throw new Error("compare select not found");
  }
  fireEvent.mouseDown(compareTrigger);
  // 「较早版本」与「对照版本」选项文案相同：按 aria-owns 定位本次打开的弹层，避免选错。
  const listId = compareField.getAttribute("aria-owns") ?? "";
  const list = document.getElementById(listId) ?? document.body;
  fireEvent.click(within(list).getByTitle(/^v1 · /));
  expect(diff.getByText("这两个版本的内容完全一致。")).toBeVisible();
  expect(api.listChangeRecordVersions).toHaveBeenCalledWith(
    1,
    7,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});
it("renders the source task link and the four content sections", async () => {
  const api = {
    getChangeRecord: vi
      .fn()
      .mockResolvedValue({ ...item, taskId: 8, featureId: 2 }),
    listChangeRecordVersions: vi.fn().mockResolvedValue({ items: [second] }),
  } as unknown as InpulseApiClient;
  mountDetail(api);
  const region = await screen.findByRole("region", { name: "正式记录详情" });
  const source = await within(region).findByRole("link", {
    name: "查看来源任务",
  });
  expect(source).toHaveAttribute(
    "href",
    "/projects/1/modules/2/features/2?taskId=8",
  );
  expect(within(region).getByText("改动原因")).toBeVisible();
  expect(within(region).getByText("具体改动")).toBeVisible();
  expect(within(region).getByText("改动效果")).toBeVisible();
  expect(within(region).getByText("遗留问题")).toBeVisible();
});
it("explains a missing or unauthorized record without leaking existence", async () => {
  const api = {
    getChangeRecord: vi.fn().mockRejectedValue(
      new ApiError(404, {
        code: "NOT_FOUND",
        message: "不存在",
        requestId: "test",
        details: {},
      }),
    ),
    listChangeRecordVersions: vi.fn().mockResolvedValue({ items: [] }),
  } as unknown as InpulseApiClient;
  mountDetail(api);
  expect(await screen.findByText("记录不存在或当前无法访问。")).toBeVisible();
});
it("leaves the record identity to the card summary when not standalone", async () => {
  const api = {
    getChangeRecord: vi.fn().mockResolvedValue(item),
    listChangeRecordVersions: vi
      .fn()
      .mockResolvedValue({ items: [second, first] }),
  } as unknown as InpulseApiClient;
  mountDetail(api, { standalone: false });
  const region = await screen.findByRole("region", { name: "正式记录详情" });
  expect(await within(region).findByText("归属")).toBeVisible();
  expect(within(region).queryByText("支付修订")).toBeNull();
  expect(within(region).queryByText("SHOP-CR-1 · v2 · 已发布")).toBeNull();
});
it("hides the version comparison until a record has more than one version", async () => {
  const api = {
    getChangeRecord: vi.fn().mockResolvedValue(item),
    listChangeRecordVersions: vi.fn().mockResolvedValue({ items: [second] }),
  } as unknown as InpulseApiClient;
  mountDetail(api);
  const region = await screen.findByRole("region", { name: "正式记录详情" });
  expect(await within(region).findByText("归属")).toBeVisible();
  expect(within(region).queryByLabelText("较早版本")).toBeNull();
});
