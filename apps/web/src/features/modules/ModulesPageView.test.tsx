import React from "react";
import { ConfigProvider } from "antd";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type InpulseApiClient,
  type ModuleItem,
} from "@generated/api";
import { ModulesPageView } from "./ModulesPageView";
import { AuthStateProvider } from "@features/auth/auth-context";

const item: ModuleItem = {
  code: "INP-M-1",
  id: 3,
  projectId: 2,
  name: "未分类模块",
  description: "",
  kind: "UNCLASSIFIED",
  sortOrder: 0,
  rowVersion: 1,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  stats: { activeFeatureCount: 0, openTaskCount: 0, completedTaskCount: 1 },
};
function mount(client: InpulseApiClient) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AuthStateProvider>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <MemoryRouter>
            <ModulesPageView projectId={2} client={client} />
          </MemoryRouter>
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
    await screen.findByRole("heading", { name: "未分类模块" });
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
  it("模块卡与编辑弹窗都不再有归档 / 恢复入口（ADR-044）", async () => {
    const client = {
      listModules: vi.fn().mockResolvedValue({ items: [item] }),
      issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
      getProject: vi.fn().mockResolvedValue({
        project: {
          id: 2,
          code: "INP",
          name: "项目",
          description: "",
          status: "ACTIVE",
          rowVersion: 1,
          createdBy: 9,
          createdAt: "2026-09-09T00:00:00.000Z",
          updatedAt: "2026-09-09T00:00:00.000Z",
          memberCount: 2,
          stats: {
            activeModuleCount: 1,
            activeFeatureCount: 0,
            openTaskCount: 0,
            completedTaskCount: 1,
          },
        },
        // 组长也没有归档入口：模块层面已下线归档，权限不再参与。
        currentUserRole: "LEADER",
      }),
    } as unknown as InpulseApiClient;
    mount(client);
    expect(
      screen.queryByRole("button", { name: /归\s*档/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /恢\s*复/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /编\s*辑/ }));
    const dialog = await screen.findByRole("dialog", { name: "编辑模块" });
    expect(
      within(dialog).queryByRole("button", { name: /归\s*档/ }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: /恢\s*复/ }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByLabelText("操作原因")).not.toBeInTheDocument();
  });
});

describe("模块卡", () => {
  const withStats = {
    ...item,
    stats: { activeFeatureCount: 3, openTaskCount: 2, completedTaskCount: 1 },
  };
  const mountRouted = (client: InpulseApiClient) =>
    render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <AuthStateProvider>
          <QueryClientProvider
            client={
              new QueryClient({ defaultOptions: { queries: { retry: false } } })
            }
          >
            <MemoryRouter initialEntries={["/projects/2/modules"]}>
              <Routes>
                <Route
                  path="/projects/:projectId/modules"
                  element={<ModulesPageView projectId={2} client={client} />}
                />
                <Route
                  path="/projects/:projectId/modules/:moduleId/features"
                  element={<div>功能列表页</div>}
                />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </AuthStateProvider>
      </ConfigProvider>,
    );
  it("shows the module feature and open task counts in the card footer", async () => {
    const client = {
      listModules: vi.fn().mockResolvedValue({ items: [withStats] }),
    } as unknown as InpulseApiClient;
    mountRouted(client);
    expect(await screen.findByText(/3 个功能/)).toBeInTheDocument();
    expect(screen.getByText(/2 项待办/)).toBeInTheDocument();
  });
  it("opens the feature list when the card body itself is clicked", async () => {
    const client = {
      listModules: vi.fn().mockResolvedValue({ items: [withStats] }),
    } as unknown as InpulseApiClient;
    mountRouted(client);
    fireEvent.click(await screen.findByRole("heading", { name: "未分类模块" }));
    await screen.findByText("功能列表页");
  });
  it("keeps 编辑模块 as the only control inside the card so card clicks stay unambiguous", async () => {
    const client = {
      listModules: vi.fn().mockResolvedValue({ items: [withStats] }),
    } as unknown as InpulseApiClient;
    mountRouted(client);
    const heading = await screen.findByRole("heading", { name: "未分类模块" });
    const card = heading.closest(".calm-feature-card") as HTMLElement;
    // 「查看功能」与整卡点击同义，已删除；卡内不再有任何链接。
    expect(within(card).queryByRole("link")).toBeNull();
    expect(within(card).getAllByRole("button")).toHaveLength(1);
    expect(
      within(card).getByRole("button", { name: "编辑模块" }),
    ).toBeInTheDocument();
    // 模块任务与归档入口已移出卡片：模块任务在模块页「模块级任务」页签，
    // 归档/恢复在编辑弹窗底部。
    expect(within(card).queryByText("模块任务")).toBeNull();
    expect(within(card).queryByText("归档模块")).toBeNull();
    expect(card.getAttribute("role")).toBeNull();
  });
  it("marks an active module without completed tasks as 未开始", async () => {
    const client = {
      listModules: vi.fn().mockResolvedValue({
        items: [
          {
            ...withStats,
            stats: { ...withStats.stats, completedTaskCount: 0 },
          },
        ],
      }),
    } as unknown as InpulseApiClient;
    mountRouted(client);
    const badge = await screen.findByText("未开始");
    expect(badge.className).toContain("badge-cyan");
  });
  it("按模块内是否已有完成任务分档：进行中 / 未开始（ADR-044 无归档档位）", async () => {
    const client = {
      listModules: vi.fn().mockResolvedValue({
        items: [
          withStats,
          {
            ...withStats,
            id: 4,
            code: "INP-M-2",
            name: "尚未开张的模块",
            stats: { ...withStats.stats, completedTaskCount: 0 },
          },
        ],
      }),
    } as unknown as InpulseApiClient;
    mountRouted(client);
    expect((await screen.findByText("进行中")).className).toContain(
      "badge-blue",
    );
    expect(screen.getByText("未开始").className).toContain("badge-cyan");
  });
});

describe("模块弹层的归档入口（ADR-044 已下线）", () => {
  const clientFor = (role: "LEADER" | "MEMBER" | null) =>
    ({
      listModules: vi.fn().mockResolvedValue({ items: [item] }),
      issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
      getProject: vi.fn().mockResolvedValue({
        project: {
          id: 2,
          code: "INP",
          name: "项目",
          description: "",
          status: "ACTIVE",
          rowVersion: 1,
          createdBy: 9,
          createdAt: "2026-09-09T00:00:00.000Z",
          updatedAt: "2026-09-09T00:00:00.000Z",
          memberCount: 2,
          stats: {
            activeModuleCount: 1,
            activeFeatureCount: 0,
            openTaskCount: 0,
            completedTaskCount: 1,
          },
        },
        currentUserRole: role,
      }),
    }) as unknown as InpulseApiClient;

  it.each(["LEADER", "MEMBER", null] as const)(
    "角色 %s 打开编辑弹窗都没有归档 / 恢复入口，也没有操作原因字段",
    async (role) => {
      const view = mount(clientFor(role));
      fireEvent.click(await screen.findByRole("button", { name: /编\s*辑/ }));
      const dialog = await screen.findByRole("dialog", { name: "编辑模块" });
      expect(
        within(dialog).queryByRole("button", { name: /归\s*档/ }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).queryByRole("button", { name: /恢\s*复/ }),
      ).not.toBeInTheDocument();
      expect(
        within(dialog).queryByLabelText("操作原因"),
      ).not.toBeInTheDocument();
      view.unmount();
    },
  );
});
