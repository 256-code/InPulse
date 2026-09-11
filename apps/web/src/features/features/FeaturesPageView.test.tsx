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
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
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
/**
 * 功能视图会读模块列表用于项目内导航；这里默认给空列表，
 * 需要断言导航的用例在传入的 client 上显式提供 listModules 覆盖即可。
 */
const withModules = (client: InpulseApiClient): InpulseApiClient =>
  Object.assign(
    { listModules: vi.fn().mockResolvedValue({ items: [] }) },
    client,
  ) as unknown as InpulseApiClient;

function mount(client: InpulseApiClient, admin = false) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AuthStateProvider>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <MemoryRouter>
            <FeaturesPageView
              projectId={2}
              moduleId={4}
              isAdmin={admin}
              client={withModules(client)}
            />
          </MemoryRouter>
        </QueryClientProvider>
      </AuthStateProvider>
    </ConfigProvider>,
  );
}
function mountDetail(client: InpulseApiClient, featureId: number) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AuthStateProvider>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <MemoryRouter>
            <FeaturesPageView
              projectId={2}
              moduleId={4}
              featureId={featureId}
              isAdmin={false}
              client={withModules(client)}
            />
          </MemoryRouter>
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

  it("shows module siblings in the feature workspace using listFeatures", async () => {
    const listFeatures = vi.fn().mockResolvedValue({
      items: [item, { ...item, id: 4, code: "PR-F-2", name: "其他功能" }],
    });
    const client = {
      listFeatures,
      listTasks: vi.fn().mockResolvedValue({ items: [] }),
      listTaskAssignees: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as InpulseApiClient;
    mountDetail(client, 3);
    await screen.findByRole("heading", { name: "退款功能" });
    expect(listFeatures).toHaveBeenCalledWith(
      2,
      4,
      expect.objectContaining({}),
    );
    expect(screen.getByRole("link", { name: "退款功能" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "其他功能" })).toBeInTheDocument();
  });
});

const moduleRow = (id: number, name: string) => ({
  id,
  projectId: 2,
  name,
  description: "",
  kind: "UNCLASSIFIED" as const,
  status: "ACTIVE" as const,
  sortOrder: id,
  rowVersion: 1,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  archivedAt: null,
});

const moduleClient = (modules: readonly { id: number; name: string }[]) =>
  ({
    listFeatures: vi.fn().mockResolvedValue({ items: [] }),
    findSimilarFeatures: vi.fn().mockResolvedValue({ items: [] }),
    listModules: vi.fn().mockResolvedValue({ items: modules }),
  }) as unknown as InpulseApiClient;

describe("项目内导航", () => {
  it("renders the project overview entry plus the project modules with the current module active", async () => {
    mount(moduleClient([moduleRow(4, "退款模块"), moduleRow(5, "结算模块")]));
    const nav = screen.getByRole("navigation", {
      name: "项目内导航",
    });
    await within(nav).findByRole("button", { name: "结算模块" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["项目概览", "退款模块", "结算模块"]);
    expect(within(nav).getByRole("button", { name: "退款模块" })).toHaveClass(
      "active",
    );
    expect(
      within(nav).getByRole("button", { name: "项目概览" }),
    ).not.toHaveClass("active");
  });

  it("hides the navigation while a single feature is open", async () => {
    mountDetail(
      {
        listFeatures: vi.fn().mockResolvedValue({ items: [item] }),
        findSimilarFeatures: vi.fn().mockResolvedValue({ items: [] }),
        listTasks: vi.fn().mockResolvedValue({ items: [] }),
        listTaskAssignees: vi.fn().mockResolvedValue({ items: [] }),
      } as unknown as InpulseApiClient,
      3,
    );
    await screen.findByRole("heading", { name: "退款功能" });
    expect(
      screen.queryByRole("navigation", { name: "项目内导航" }),
    ).not.toBeInTheDocument();
  });

  it("switches to the selected module feature list and back to the project overview", async () => {
    const client = moduleClient([
      moduleRow(4, "退款模块"),
      moduleRow(5, "结算模块"),
    ]);
    const FeatureListRoute: React.FC = () => {
      const params = useParams();
      const moduleId = Number(params["moduleId"]);
      return (
        <>
          <FeaturesPageView
            projectId={2}
            moduleId={moduleId}
            isAdmin={false}
            client={client}
          />
          <p>{`当前模块 ${moduleId}`}</p>
        </>
      );
    };
    render(
      <ConfigProvider theme={{ token: { motion: false } }}>
        <AuthStateProvider>
          <QueryClientProvider
            client={
              new QueryClient({ defaultOptions: { queries: { retry: false } } })
            }
          >
            <MemoryRouter initialEntries={["/projects/2/modules/4/features"]}>
              <Routes>
                <Route
                  path="/projects/:projectId/modules/:moduleId/features"
                  element={<FeatureListRoute />}
                />
                <Route
                  path="/projects/:projectId/overview"
                  element={<div>项目概览页</div>}
                />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </AuthStateProvider>
      </ConfigProvider>,
    );
    await screen.findByText("当前模块 4");
    fireEvent.click(await screen.findByRole("button", { name: "结算模块" }));
    expect(await screen.findByText("当前模块 5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "结算模块" })).toHaveClass(
      "active",
    );
    fireEvent.click(screen.getByRole("button", { name: "项目概览" }));
    expect(await screen.findByText("项目概览页")).toBeInTheDocument();
  });
});
