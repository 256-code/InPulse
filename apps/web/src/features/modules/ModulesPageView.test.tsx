import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type InpulseApiClient,
  type ModuleItem,
} from "@generated/api";
import { ModulesPageView } from "./ModulesPageView";
import { AuthStateProvider } from "@features/auth/auth-context";

const item: ModuleItem = {
  id: 3,
  projectId: 2,
  name: "未分类模块",
  description: "",
  kind: "UNCLASSIFIED",
  status: "ACTIVE",
  sortOrder: 0,
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
          <ModulesPageView projectId={2} isAdmin={admin} client={client} />
        </QueryClientProvider>
      </AuthStateProvider>
    </ConfigProvider>,
  );
}
describe("F-12 forms", () => {
  it("merges a name draft with a concurrently changed description before using the latest version", async () => {
    const original = { ...item, description: "编辑前说明" };
    const latest = {
      ...original,
      description: "其他人更新的说明",
      rowVersion: 2,
    };
    const client = {
      listModules: vi
        .fn()
        .mockResolvedValueOnce({ items: [original] })
        .mockResolvedValue({ items: [latest] }),
      issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
      updateModule: vi
        .fn()
        .mockRejectedValueOnce(
          new ApiError(409, {
            code: "MODULE_VERSION_CONFLICT",
            message: "版本冲突",
            details: {},
            requestId: "test",
          }),
        )
        .mockResolvedValue({ ...latest, name: "我的新名称", rowVersion: 3 }),
    } as unknown as InpulseApiClient;
    mount(client);
    fireEvent.click(await screen.findByRole("button", { name: /编\s*辑/ }));
    fireEvent.change(screen.getByLabelText("模块名称"), {
      target: { value: "我的新名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await screen.findByText(/输入已保留/);
    fireEvent.click(
      screen.getByRole("button", { name: "加载最新版本后继续编辑" }),
    );
    await waitFor(() =>
      expect(screen.getByLabelText("模块说明")).toHaveValue("其他人更新的说明"),
    );
    expect(screen.getByLabelText("模块名称")).toHaveValue("我的新名称");
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(client.updateModule).toHaveBeenCalledTimes(2));
    expect(client.updateModule).toHaveBeenLastCalledWith(
      2,
      3,
      { name: "我的新名称", description: "其他人更新的说明" },
      expect.objectContaining({
        headers: expect.objectContaining({ "If-Match": '"2"' }),
      }),
    );
  });

  it.each(["我的", "最新"] as const)(
    "requires an explicit choice when both edit the same field: %s",
    async (choice) => {
      const original = { ...item, description: "编辑前说明" };
      const latest = {
        ...original,
        description: "其他人更新的说明",
        rowVersion: 2,
      };
      const client = {
        listModules: vi
          .fn()
          .mockResolvedValueOnce({ items: [original] })
          .mockResolvedValue({ items: [latest] }),
        issueCsrfToken: vi
          .fn()
          .mockResolvedValue({ csrfToken: "a".repeat(43) }),
        updateModule: vi
          .fn()
          .mockRejectedValueOnce(
            new ApiError(409, {
              code: "MODULE_VERSION_CONFLICT",
              message: "版本冲突",
              details: {},
              requestId: "test",
            }),
          )
          .mockResolvedValue({ ...latest, rowVersion: 3 }),
      } as unknown as InpulseApiClient;
      mount(client);
      fireEvent.click(await screen.findByRole("button", { name: /编\s*辑/ }));
      fireEvent.change(screen.getByLabelText("模块说明"), {
        target: { value: "我的说明草稿" },
      });
      fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
      await screen.findByText(/输入已保留/);
      fireEvent.click(
        screen.getByRole("button", { name: "加载最新版本后继续编辑" }),
      );
      await screen.findByText("模块说明存在冲突");
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
      expect(client.updateModule).toHaveBeenCalledTimes(1);
      fireEvent.click(
        screen.getByRole("button", {
          name: choice === "我的" ? "保留我的模块说明" : "采用最新模块说明",
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "应用合并结果" }));
      const expectedDescription =
        choice === "我的" ? "我的说明草稿" : "其他人更新的说明";
      expect(screen.getByLabelText("模块说明")).toHaveValue(
        expectedDescription,
      );
      fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
      await waitFor(() => expect(client.updateModule).toHaveBeenCalledTimes(2));
      expect(client.updateModule).toHaveBeenLastCalledWith(
        2,
        3,
        { name: original.name, description: expectedDescription },
        expect.objectContaining({
          headers: expect.objectContaining({ "If-Match": '"2"' }),
        }),
      );
    },
  );
  it("allows unclassified editing and preserves input on 409 without admin buttons", async () => {
    const client = {
      listModules: vi.fn().mockResolvedValue({ items: [item] }),
      issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
      updateModule: vi.fn().mockRejectedValue(
        new ApiError(409, {
          code: "MODULE_VERSION_CONFLICT",
          message: "冲突",
          details: {},
          requestId: "test",
        }),
      ),
    } as unknown as InpulseApiClient;
    mount(client);
    await screen.findByText("未分类模块");
    expect(
      screen.queryByRole("button", { name: /归\s*档/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /编\s*辑/ }));
    fireEvent.change(screen.getByLabelText("模块名称"), {
      target: { value: "保留的新名称" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await screen.findByText(/输入已保留/);
    expect(screen.getByLabelText("模块名称")).toHaveValue("保留的新名称");
    fireEvent.click(
      screen.getByRole("button", { name: "加载最新版本后继续编辑" }),
    );
    await waitFor(() => expect(client.listModules).toHaveBeenCalledTimes(2));
    expect(screen.getByLabelText("模块名称")).toHaveValue("保留的新名称");
  });
  it("shows retry on list failure", async () => {
    const client = {
      listModules: vi
        .fn()
        .mockRejectedValueOnce(new Error("offline"))
        .mockResolvedValue({ items: [] }),
    } as unknown as InpulseApiClient;
    mount(client);
    fireEvent.click(await screen.findByRole("button", { name: /重\s*试/ }));
    await screen.findByText("暂无模块");
  });
  it("requires an archive reason and sends the selected version as an admin", async () => {
    const client = {
      listModules: vi.fn().mockResolvedValue({ items: [item] }),
      issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
      archiveModule: vi
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
    expect(client.archiveModule).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("操作原因"), {
      target: { value: "暂时封存" },
    });
    fireEvent.click(screen.getByRole("button", { name: /确\s*认/ }));
    await waitFor(() =>
      expect(client.archiveModule).toHaveBeenCalledWith(
        2,
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
    await screen.findByText("模块操作成功");
  });
  it("offers restore instead of edit for archived modules", async () => {
    const client = {
      listModules: vi.fn().mockResolvedValue({
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
