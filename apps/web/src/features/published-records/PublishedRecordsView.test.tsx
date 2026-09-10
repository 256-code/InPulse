import React from "react";
import { it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { InpulseApiClient, ChangeRecordVersion } from "@generated/api";
import {
  PublishedRecordsView,
  compareRecordVersions,
} from "./PublishedRecordsView";
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
  remainingIssues: "",
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
};
it("compares exact immutable version content and identifies unchanged fields", () => {
  const diff = compareRecordVersions(first, second);
  expect(diff.filter((x) => x.changed)).toEqual([
    {
      field: "resultVerification",
      label: "改完效果如何、如何验证",
      before: "初次验证",
      after: "追加并发验证",
      changed: true,
    },
  ]);
});
it("loads real version data and permits selecting historical snapshots", async () => {
  const api = {
    listProjects: vi
      .fn()
      .mockResolvedValue({ items: [{ id: 1, name: "支付项目" }] }),
    listChangeRecords: vi.fn().mockResolvedValue({ items: [item] }),
    getChangeRecord: vi.fn().mockResolvedValue(item),
    listChangeRecordVersions: vi
      .fn()
      .mockResolvedValue({ items: [second, first] }),
  } as unknown as InpulseApiClient;
  render(
    <MemoryRouter
      initialEntries={["/records?view=published&projectId=1&publishedId=7"]}
    >
      <QueryClientProvider client={new QueryClient()}>
        <PublishedRecordsView client={api} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const diff = within(await screen.findByRole("generic", { name: "版本差异" }));
  expect(diff.getByText("初次验证")).toBeVisible();
  expect(diff.getByText("追加并发验证")).toBeVisible();
  fireEvent.change(screen.getByLabelText("对照版本"), {
    target: { value: "1" },
  });
  expect(diff.getAllByText("初次验证")).toHaveLength(2);
  expect(api.listChangeRecordVersions).toHaveBeenCalledWith(
    1,
    7,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
});
