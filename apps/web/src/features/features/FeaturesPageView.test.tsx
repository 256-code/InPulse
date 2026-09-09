import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type InpulseApiClient,
  type FeatureItem,
} from "@generated/api";
import { FeaturesPageView } from "./FeaturesPageView";
import { AuthStateProvider } from "@features/auth/auth-context";

const item: FeatureItem = {
  id: 3,
  projectId: 2,
  name: "退款功能",
  currentBehavior: "",
  moduleId: 4,
  code: "PR-F-1",
  createdBy: 1,
  tags: [],
  status: "ACTIVE",
  rowVersion: 1,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  archivedAt: null,
};
function mount(client: InpulseApiClient, admin = false) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AuthStateProvider>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <FeaturesPageView
            projectId={2}
            moduleId={4}
            isAdmin={admin}
            client={client}
          />
        </QueryClientProvider>
      </AuthStateProvider>
    </ConfigProvider>,
  );
}
describe("F-13 forms", () => {
  it("reuses the key for an uncertain retry and changes it when semantics change", async () => {
    const createFeature = vi.fn().mockRejectedValue(new Error("response lost"));
    const client = {
      listFeatures: vi.fn().mockResolvedValue({ items: [] }),
      findSimilarFeatures: vi.fn().mockResolvedValue({ items: [] }),
      issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
      createFeature,
    } as unknown as InpulseApiClient;
    mount(client);
    await screen.findByText("暂无功能");
    fireEvent.click(screen.getByRole("button", { name: "新建功能" }));
    fireEvent.change(screen.getByLabelText("功能名称"), {
      target: { value: "退款" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await screen.findByText("功能服务暂时不可用，请重试。");
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(createFeature).toHaveBeenCalledTimes(2));
    expect(createFeature.mock.calls[0]![3].headers["Idempotency-Key"]).toBe(
      createFeature.mock.calls[1]![3].headers["Idempotency-Key"],
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /保\s*存/ })).not.toHaveClass(
        "ant-btn-loading",
      ),
    );
    fireEvent.change(screen.getByLabelText("功能名称"), {
      target: { value: "退款回调" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(createFeature).toHaveBeenCalledTimes(3));
    expect(createFeature.mock.calls[2]![3].headers["Idempotency-Key"]).not.toBe(
      createFeature.mock.calls[1]![3].headers["Idempotency-Key"],
    );
  });
  it("merges a name draft with a concurrently changed currentBehavior before using the latest version", async () => {
    const original = { ...item, currentBehavior: "编辑前说明" };
    const latest = {
      ...original,
      currentBehavior: "其他人更新的说明",
      tags: ["别人更新的标签"],
      rowVersion: 2,
    };
    const client = {
      listFeatures: vi
        .fn()
        .mockResolvedValueOnce({ items: [original] })
        .mockResolvedValue({ items: [latest] }),
      issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
      updateFeature: vi
        .fn()
        .mockRejectedValueOnce(
          new ApiError(409, {
            code: "FEATURE_VERSION_CONFLICT",
            message: "版本冲突",
            details: {},
            requestId: "test",
          }),
        )
        .mockResolvedValue({ ...latest, name: "我的新名称", rowVersion: 3 }),
    } as unknown as InpulseApiClient;
    mount(client);
    fireEvent.click(await screen.findByRole("button", { name: /编\s*辑/ }));
    fireEvent.change(screen.getByLabelText("功能名称"), {
      target: { value: "我的新名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await screen.findByText(/输入已保留/);
    fireEvent.click(
      screen.getByRole("button", { name: "加载最新版本后继续编辑" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("当前功能说明")).toHaveValue(
        "其他人更新的说明",
      ),
    );
    expect(screen.getByLabelText("功能名称")).toHaveValue("我的新名称");
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(client.updateFeature).toHaveBeenCalledTimes(2));
    expect(client.updateFeature).toHaveBeenLastCalledWith(
      2,
      4,
      3,
      {
        name: "我的新名称",
        currentBehavior: "其他人更新的说明",
        tags: ["别人更新的标签"],
      },
      expect.objectContaining({
        headers: expect.objectContaining({ "If-Match": '"2"' }),
      }),
    );
  });

  it.each(["我的", "最新"] as const)(
    "requires an explicit choice when both edit the same field: %s",
    async (choice) => {
      const original = { ...item, currentBehavior: "编辑前说明" };
      const latest = {
        ...original,
        currentBehavior: "其他人更新的说明",
        rowVersion: 2,
      };
      const client = {
        listFeatures: vi
          .fn()
          .mockResolvedValueOnce({ items: [original] })
          .mockResolvedValue({ items: [latest] }),
        issueCsrfToken: vi
          .fn()
          .mockResolvedValue({ csrfToken: "a".repeat(43) }),
        updateFeature: vi
          .fn()
          .mockRejectedValueOnce(
            new ApiError(409, {
              code: "FEATURE_VERSION_CONFLICT",
              message: "版本冲突",
              details: {},
              requestId: "test",
            }),
          )
          .mockResolvedValue({ ...latest, rowVersion: 3 }),
      } as unknown as InpulseApiClient;
      mount(client);
      fireEvent.click(await screen.findByRole("button", { name: /编\s*辑/ }));
      fireEvent.change(screen.getByLabelText("当前功能说明"), {
        target: { value: "我的说明草稿" },
      });
      fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
      await screen.findByText(/输入已保留/);
      fireEvent.click(
        screen.getByRole("button", { name: "加载最新版本后继续编辑" }),
      );
      await screen.findByText("当前功能说明存在冲突");
      expect(
        screen.getByText("编辑前说明", { exact: true }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("我的说明草稿", { selector: "dd" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText("其他人更新的说明", { selector: "dd" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /保\s*存/ })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "应用合并结果" }),
      ).toBeDisabled();
      expect(client.updateFeature).toHaveBeenCalledTimes(1);
      fireEvent.click(
        screen.getByRole("button", {
          name:
            choice === "我的" ? "保留我的当前功能说明" : "采用最新当前功能说明",
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "应用合并结果" }));
      const expectedDescription =
        choice === "我的" ? "我的说明草稿" : "其他人更新的说明";
      expect(screen.getByLabelText("当前功能说明")).toHaveValue(
        expectedDescription,
      );
      fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
      await waitFor(() =>
        expect(client.updateFeature).toHaveBeenCalledTimes(2),
      );
      expect(client.updateFeature).toHaveBeenLastCalledWith(
        2,
        4,
        3,
        { name: original.name, currentBehavior: expectedDescription, tags: [] },
        expect.objectContaining({
          headers: expect.objectContaining({ "If-Match": '"2"' }),
        }),
      );
    },
  );
  it("allows member editing and preserves input on 409 without admin buttons", async () => {
    const client = {
      listFeatures: vi.fn().mockResolvedValue({ items: [item] }),
      issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
      updateFeature: vi.fn().mockRejectedValue(
        new ApiError(409, {
          code: "FEATURE_VERSION_CONFLICT",
          message: "冲突",
          details: {},
          requestId: "test",
        }),
      ),
    } as unknown as InpulseApiClient;
    mount(client);
    await screen.findByText("退款功能");
    expect(
      screen.queryByRole("button", { name: /归\s*档/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /编\s*辑/ }));
    fireEvent.change(screen.getByLabelText("功能名称"), {
      target: { value: "保留的新名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await screen.findByText(/输入已保留/);
    expect(screen.getByLabelText("功能名称")).toHaveValue("保留的新名称");
    fireEvent.click(
      screen.getByRole("button", { name: "加载最新版本后继续编辑" }),
    );
    await waitFor(() => expect(client.listFeatures).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("功能名称")).toHaveValue("保留的新名称");
  });
  it("shows retry on list failure", async () => {
    const client = {
      listFeatures: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ items: [] }),
    } as unknown as InpulseApiClient;
    mount(client);
    fireEvent.click(await screen.findByRole("button", { name: /重\s*试/ }));
    await screen.findByText("暂无功能");
  });
  it("requires an archive reason and sends the selected version as an admin", async () => {
    const client = {
      listFeatures: vi.fn().mockResolvedValue({ items: [item] }),
      issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
      archiveFeature: vi
        .fn()
        .mockResolvedValue({ ...item, status: "ARCHIVED", rowVersion: 2 }),
    } as unknown as InpulseApiClient;
    mount(client, true);
    fireEvent.click(await screen.findByRole("button", { name: /归\s*档/ }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "管理员安全验证" }),
      ).toBeVisible(),
    );
    fireEvent.click(screen.getByRole("button", { name: /确\s*认/ }));
    await screen.findByText("请填写操作原因");
    expect(client.archiveFeature).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("操作原因"), {
      target: { value: "暂时封存" },
    });
    fireEvent.click(screen.getByRole("button", { name: /确\s*认/ }));
    await waitFor(() =>
      expect(client.archiveFeature).toHaveBeenCalledWith(
        2,
        4,
        3,
        { reason: "暂时封存" },
        expect.objectContaining({
          headers: expect.objectContaining({
            "If-Match": '"1"',
            "x-csrf-token": "a".repeat(43),
          }),
        }),
      ),
    );
    await screen.findByText("功能操作成功");
  });
  it("offers restore instead of edit for archived features", async () => {
    const client = {
      listFeatures: vi.fn().mockResolvedValue({
        items: [{ ...item, status: "ARCHIVED", rowVersion: 2 }],
      }),
    } as unknown as InpulseApiClient;
    mount(client, true);
    await screen.findByRole("button", { name: /恢\s*复/ });
    expect(
      screen.queryByRole("button", { name: /编\s*辑/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /归\s*档/ }),
    ).not.toBeInTheDocument();
  });
});
