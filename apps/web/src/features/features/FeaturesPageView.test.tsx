import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
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
  acceptanceCriteria: "",
  moduleId: 4,
  code: "PR-F-1",
  createdBy: 1,
  tags: [],
  status: "ACTIVE",
  rowVersion: 1,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  archivedAt: null,
  stats: { openTaskCount: 0, recordCount: 0 },
};
/**
 * 功能视图会读模块列表用于项目内导航、读模块级任务用于页头计数；
 * 这里默认给空列表，需要断言导航的用例在传入的 client 上显式提供
 * listModules / listModuleTasks 覆盖即可。
 */
const withModules = (client: InpulseApiClient): InpulseApiClient =>
  Object.assign(
    {
      listModules: vi.fn().mockResolvedValue({ items: [] }),
      listModuleTasks: vi.fn().mockResolvedValue({ items: [] }),
      listModuleTaskAssignees: vi.fn().mockResolvedValue({ items: [] }),
    },
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
    fireEvent.click(screen.getByRole("button", { name: "新增功能" }));
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
      acceptanceCriteria: "",
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
    fireEvent.click(await screen.findByRole("button", { name: "编辑功能" }));
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
        acceptanceCriteria: "",
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
        acceptanceCriteria: "",
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
      fireEvent.click(await screen.findByRole("button", { name: "编辑功能" }));
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
        {
          name: original.name,
          currentBehavior: expectedDescription,
          acceptanceCriteria: "",
          tags: [],
        },
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
      screen.queryByRole("button", { name: "归档功能" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "编辑功能" }));
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
    // ADR-034：归档入口在编辑弹窗底部，列表卡片不再提供归档按钮。
    fireEvent.click(await screen.findByRole("button", { name: "编辑功能" }));
    fireEvent.click(await screen.findByTestId("feature-modal-lifecycle"));
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
    await screen.findByRole("button", { name: "恢复功能" });
    expect(
      screen.queryByRole("button", { name: "编辑功能" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "归档功能" }),
    ).not.toBeInTheDocument();
  });
});

describe("功能卡", () => {
  const withStats = {
    ...item,
    stats: { openTaskCount: 7, recordCount: 5 },
  };
  const CardListRoute: React.FC = () => (
    <FeaturesPageView
      projectId={2}
      moduleId={4}
      isAdmin={false}
      client={cardClient}
    />
  );
  const cardClient = withModules({
    listFeatures: vi.fn().mockResolvedValue({ items: [withStats] }),
    findSimilarFeatures: vi.fn().mockResolvedValue({ items: [] }),
  } as unknown as InpulseApiClient);
  const mountCardList = () =>
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
                  element={<CardListRoute />}
                />
                <Route
                  path="/projects/:projectId/modules/:moduleId/features/:featureId"
                  element={<div>功能详情页</div>}
                />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </AuthStateProvider>
      </ConfigProvider>,
    );

  it("shows the open task and iteration counts in the card footer", async () => {
    mountCardList();
    expect(await screen.findByText(/7 项待办/)).toBeInTheDocument();
    expect(screen.getByText(/5 条迭代/)).toBeInTheDocument();
  });

  it("opens the feature detail when the card body itself is clicked", async () => {
    mountCardList();
    fireEvent.click(await screen.findByRole("heading", { name: "退款功能" }));
    await screen.findByText("功能详情页");
  });

  it("keeps 查看详情 as the single link inside the card", async () => {
    mountCardList();
    const links = await screen.findAllByRole("link", { name: "查看详情" });
    expect(links).toHaveLength(1);
    expect(links[0]!.getAttribute("href")).toBe(
      "/projects/2/modules/4/features/3",
    );
    expect(
      links[0]!.closest(".calm-feature-card")?.getAttribute("role"),
    ).toBeNull();
  });
});

it("功能详情：标签进标题行、验收标准排在功能任务之后", async () => {
  const api = {
    listFeatures: vi.fn().mockResolvedValue({
      items: [
        {
          ...item,
          currentBehavior: "退款回原支付渠道",
          acceptanceCriteria: "响应低于 500ms",
          tags: ["支付", "退款"],
        },
      ],
    }),
    getProject: vi.fn().mockResolvedValue({ project: { id: 2, name: "项目" } }),
  } as unknown as InpulseApiClient;
  mountDetail(api, item.id);

  // 功能说明只保留标题下方那一处，正文不再重复同名区块。
  expect(await screen.findByText("退款回原支付渠道")).toBeVisible();
  expect(
    screen.queryByRole("heading", { name: "当前功能说明" }),
  ).not.toBeInTheDocument();

  // 标签是标题行的小徽章，夹在状态与更新时间之间。
  await screen.findByText("退款回原支付渠道");
  const badgeRow = document.querySelector(".task-modal-badges");
  expect(badgeRow).not.toBeNull();
  const badges = Array.from(badgeRow?.children ?? []).map(
    (node) => node.textContent ?? "",
  );
  expect(badges.slice(-3)).toEqual([
    "支付",
    "退款",
    expect.stringContaining("更新"),
  ]);
  // 功能编号不在页头徽章行展示（仍保留在右侧「功能档案」里）。
  expect(badgeRow?.textContent ?? "").not.toContain(item.code);

  // 验收标准落在功能任务之后。
  const tasks = screen.getByRole("heading", { name: "功能任务" });
  const acceptance = screen.getByRole("heading", { name: "验收标准" });
  expect(
    tasks.compareDocumentPosition(acceptance) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

it("功能概览显示验收标准，编辑时保留并提交", async () => {
  const updateFeature = vi.fn().mockResolvedValue({
    ...item,
    acceptanceCriteria: "响应低于 400ms",
    rowVersion: 2,
  });
  const api = {
    listFeatures: vi.fn().mockResolvedValue({
      items: [{ ...item, acceptanceCriteria: "响应低于 500ms" }],
    }),
    getProject: vi.fn().mockResolvedValue({ project: { id: 2, name: "项目" } }),
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
    updateFeature,
  } as unknown as InpulseApiClient;
  mountDetail(api, item.id);
  expect(await screen.findByText("响应低于 500ms")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "编辑功能" }));
  const field = await screen.findByLabelText("验收标准（选填）");
  expect(field).toHaveValue("响应低于 500ms");
  fireEvent.change(field, { target: { value: "响应低于 400ms" } });
  fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
  await waitFor(() =>
    expect(updateFeature).toHaveBeenCalledWith(
      2,
      4,
      item.id,
      expect.objectContaining({ acceptanceCriteria: "响应低于 400ms" }),
      expect.anything(),
    ),
  );
});

describe("功能归档入口权限（ADR-034）", () => {
  const project = {
    id: 2,
    code: "PR",
    name: "项目",
    description: null,
    status: "ACTIVE" as const,
    rowVersion: 1,
    createdBy: 1,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
    memberCount: 2,
    stats: {
      activeModuleCount: 1,
      activeFeatureCount: 1,
      openTaskCount: 0,
      completedTaskCount: 0,
    },
  };
  const archivedItem: FeatureItem = {
    ...item,
    status: "ARCHIVED",
    rowVersion: 2,
    archivedAt: "2026-09-10T00:00:00.000Z",
  };
  const lifecycleClient = (
    role: string | null,
    items: FeatureItem[] = [item],
  ) =>
    ({
      listFeatures: vi.fn().mockResolvedValue({ items }),
      getProject: vi.fn().mockResolvedValue({ project, currentUserRole: role }),
      issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "a".repeat(43) }),
      archiveFeature: vi
        .fn()
        .mockResolvedValue({ ...item, status: "ARCHIVED", rowVersion: 2 }),
      restoreFeature: vi
        .fn()
        .mockResolvedValue({ ...item, status: "ACTIVE", rowVersion: 3 }),
    }) as unknown as InpulseApiClient;

  it("普通成员看不到归档与恢复入口", async () => {
    mount(lifecycleClient("MEMBER"));
    await screen.findByText("退款功能");
    expect(screen.queryByTestId("feature-lifecycle-3")).toBeNull();
    expect(screen.queryByRole("button", { name: "归档功能" })).toBeNull();
    expect(screen.queryByRole("button", { name: "恢复功能" })).toBeNull();
  });

  it("组长在编辑弹窗底部归档，按钮文案为「归档」", async () => {
    const client = lifecycleClient("LEADER");
    mount(client);
    fireEvent.click(await screen.findByRole("button", { name: "编辑功能" }));
    const trigger = await screen.findByTestId("feature-modal-lifecycle");
    // antd 会在 CJK 两字按钮里插入空格，按正则断言文案。
    expect(trigger.textContent).toMatch(/归\s*档/);
    fireEvent.click(trigger);
    fireEvent.change(await screen.findByLabelText("操作原因"), {
      target: { value: "弹窗内归档" },
    });
    fireEvent.click(screen.getByRole("button", { name: /确\s*认/ }));
    await waitFor(() =>
      expect(client.archiveFeature).toHaveBeenCalledWith(
        2,
        4,
        3,
        { reason: "弹窗内归档" },
        expect.objectContaining({ headers: expect.anything() }),
      ),
    );
  });

  it("卡片与编辑弹窗都不再提供归档按钮给普通成员", async () => {
    mount(lifecycleClient("MEMBER"));
    fireEvent.click(await screen.findByRole("button", { name: "编辑功能" }));
    await screen.findByLabelText("功能名称");
    expect(screen.queryByTestId("feature-modal-lifecycle")).toBeNull();
  });

  it("项目管理员同样在编辑弹窗底部看到归档入口", async () => {
    mount(lifecycleClient("PROJECT_ADMIN"));
    fireEvent.click(await screen.findByRole("button", { name: "编辑功能" }));
    expect(
      (await screen.findByTestId("feature-modal-lifecycle")).textContent,
    ).toMatch(/归\s*档/);
  });

  it("已归档功能只在卡片保留恢复入口，组长可直接恢复", async () => {
    const client = lifecycleClient("LEADER", [archivedItem]);
    mount(client);
    expect(screen.queryByRole("button", { name: "归档功能" })).toBeNull();
    fireEvent.click(await screen.findByTestId("feature-lifecycle-3"));
    fireEvent.change(await screen.findByLabelText("操作原因"), {
      target: { value: "恢复使用" },
    });
    fireEvent.click(screen.getByRole("button", { name: /确\s*认/ }));
    await waitFor(() =>
      expect(client.restoreFeature).toHaveBeenCalledWith(
        2,
        4,
        3,
        { reason: "恢复使用" },
        expect.objectContaining({ headers: expect.anything() }),
      ),
    );
  });
});
