import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ConfigProvider } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  ApiError,
  type ActivityItem,
  type InpulseApiClient,
  type ProjectDeletionPage,
} from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";
import { ActivityPageView } from "./ActivityPageView";

const PROJECT = {
  id: 7,
  code: "INPULSE",
  name: "InPulse 研发交付平台",
  description: null,
  status: "ACTIVE" as const,
  rowVersion: 1,
  createdBy: 1,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  memberCount: 4,
  stats: {
    activeModuleCount: 2,
    activeFeatureCount: 5,
    openTaskCount: 3,
    completedTaskCount: 1,
  },
};

const DELETIONS: ProjectDeletionPage = {
  items: [
    {
      projectId: 41,
      code: "OLD-PLATFORM",
      name: "旧版交付平台",
      deletedAt: "2026-09-28T06:30:00.000000Z",
      deletedBy: { id: 812, name: "邵晨宇" },
      canRestore: true,
      canPurge: true,
    },
    {
      projectId: 12,
      code: "TEMP",
      name: "临时验证项目",
      deletedAt: "2026-09-27T01:05:00.000000Z",
      deletedBy: { id: 300, name: "林可" },
      canRestore: false,
      canPurge: false,
    },
  ],
  nextCursor: null,
  hasMore: false,
};

/** 删除项目同事务写入的动态投影；这里只桩删除行（服务端会连同删除前的历史一起下发）。 */
const DELETION_ROWS: readonly ActivityItem[] = [
  {
    id: "9001",
    projectId: 41,
    sourceEntityType: "PROJECT",
    sourceEntityId: 41,
    activityType: "PROJECT_DELETED",
    actorId: 812,
    summary: "删除了项目 旧版交付平台",
    occurredAt: "2026-09-28T06:30:00.000000Z",
  },
  {
    id: "9002",
    projectId: 12,
    sourceEntityType: "PROJECT",
    sourceEntityId: 12,
    activityType: "PROJECT_DELETED",
    actorId: 300,
    summary: "删除了项目 临时验证项目",
    occurredAt: "2026-09-27T01:05:00.000000Z",
  },
];

function createClient(overrides: Partial<InpulseApiClient> = {}) {
  return {
    // 服务端一次查询就返回整个范围内的全局倒序流（含已删除项目的历史）。
    listActivity: vi.fn().mockResolvedValue({
      items: [...DELETION_ROWS],
      nextCursor: null,
      hasMore: false,
      dayTotals: [],
      dayTotalsTruncated: false,
    }),
    getProjectActivity: vi.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
      dayTotals: [],
      dayTotalsTruncated: false,
    }),
    listProjects: vi.fn().mockResolvedValue({ items: [PROJECT] }),
    getUserDirectory: vi.fn().mockResolvedValue({
      items: [
        { id: 1, name: "特哥", avatarUrl: null, isAdmin: false },
        { id: 812, name: "邵晨宇", avatarUrl: null, isAdmin: true },
        { id: 300, name: "林可", avatarUrl: null, isAdmin: false },
      ],
    }),
    listProjectDeletions: vi.fn().mockResolvedValue(DELETIONS),
    ...overrides,
  } as unknown as InpulseApiClient;
}

/**
 * 关卡必须与应用一致：AppProviders 全局关掉了 antd「两字按钮插空格」，
 * 否则「取消」的可访问名会变成「取 消」，与真实界面不符。
 */
function mount(client: InpulseApiClient, projectId?: number) {
  return render(
    <ConfigProvider button={{ autoInsertSpace: false }}>
      <MemoryRouter>
        <AuthStateProvider
          value={{
            status: "authenticated",
            user: {
              id: 1,
              loginName: "tege",
              name: "特哥",
              email: null,
              avatarUrl: null,
              isAdmin: false,
              status: "ACTIVE",
            },
          }}
        >
          <QueryClientProvider
            client={
              new QueryClient({ defaultOptions: { queries: { retry: false } } })
            }
          >
            <ActivityPageView
              client={client}
              {...(projectId === undefined ? {} : { projectId })}
            />
          </QueryClientProvider>
        </AuthStateProvider>
      </MemoryRouter>
    </ConfigProvider>,
  );
}

describe("ADR-050 项目删除记录", () => {
  it("删除记录作为普通动态行混排，不再是独立台账", async () => {
    const client = createClient();
    mount(client);

    const row = await screen.findByTestId("activity-item-9001");
    expect(row).toHaveTextContent("邵晨宇");
    expect(row).toHaveTextContent("删除项目");
    expect(row).toHaveTextContent("旧版交付平台");
    // 项目名来自删除台账：已删除项目不在项目列表里，不能退化成「项目 #41」。
    expect(row).toHaveTextContent("旧版交付平台 · 项目 #41");
    expect(screen.getByTestId("activity-item-9002")).toHaveTextContent(
      "临时验证项目",
    );

    // 独立区块与其文案整体下线。
    expect(screen.queryByTestId("activity-project-deletions")).toBeNull();
    expect(screen.queryByText("项目删除记录")).toBeNull();
    // 删除记录指向的项目已不存在，不提供「查看对象」死链。
    expect(screen.queryByLabelText("查看对象")).toBeNull();

    // 已删除项目不在项目列表里，靠服务端把「授权范围 + 已删除项目」一并下发，
    // 否则读不到这两行。「全部项目」不再在前端枚举项目，因此只发一次请求。
    const feed = client.listActivity as unknown as ReturnType<typeof vi.fn>;
    expect(feed).toHaveBeenCalledTimes(1);
    expect(feed).toHaveBeenCalledWith(
      { limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const listDeletions = client.listProjectDeletions as unknown as ReturnType<
      typeof vi.fn
    >;
    expect(listDeletions).toHaveBeenCalledWith(
      { limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("项目内动态不请求删除记录，也不出现已删除项目的行", async () => {
    const client = createClient({ listProjectDeletions: vi.fn() } as never);
    mount(client, 7);

    expect(await screen.findByText("项目 #7")).toBeInTheDocument();
    expect(
      await screen.findByText("当前范围内还没有可展示的活动投影。"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("activity-item-9001")).toBeNull();
    expect(client.listProjectDeletions).not.toHaveBeenCalled();
  });

  it("搜索词同样过滤删除行动态，不匹配时给出空态", async () => {
    mount(createClient());
    await screen.findByTestId("activity-item-9001");

    const search = screen.getByLabelText("搜索动态");
    await userEvent.clear(search);
    await userEvent.type(search, "临时验证");

    expect(screen.getByTestId("activity-item-9002")).toBeInTheDocument();
    expect(screen.queryByTestId("activity-item-9001")).toBeNull();

    await userEvent.clear(search);
    await userEvent.type(search, "不存在的项目");
    expect(screen.getByText("没有匹配的动态")).toBeInTheDocument();
  });

  it("还没有删除记录时照常渲染其他动态", async () => {
    const client = createClient({
      listProjectDeletions: vi.fn().mockResolvedValue({
        items: [],
        nextCursor: null,
        hasMore: false,
      }),
      // 没有已删除项目时服务端范围里就没有它们的行，首页只剩普通动态。
      listActivity: vi.fn().mockResolvedValue({
        items: [],
        nextCursor: null,
        hasMore: false,
        dayTotals: [],
        dayTotalsTruncated: false,
      }),
    } as never);
    mount(client);

    expect(
      await screen.findByText("当前范围内还没有可展示的活动投影。"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("activity-item-9001")).toBeNull();
  });

  it("删除记录读取失败时降级：仍展示动态，不把台账失败扩散成页面错误", async () => {
    const client = createClient({
      listProjectDeletions: vi.fn().mockRejectedValue(new Error("boom")),
      listActivity: vi.fn().mockResolvedValue({
        items: [
          {
            id: "9100",
            projectId: 7,
            sourceEntityType: "PROJECT",
            sourceEntityId: 7,
            activityType: "PROJECT_CREATED",
            actorId: 1,
            summary: "创建了项目 InPulse 研发交付平台",
            occurredAt: "2026-09-08T00:00:00.000000Z",
          },
        ],
        nextCursor: null,
        hasMore: false,
        dayTotals: [],
        dayTotalsTruncated: false,
      }),
    } as never);
    mount(client);

    const row = await screen.findByTestId("activity-item-9100");
    expect(row).toHaveTextContent("创建项目");

    // 台账失败只影响项目名回退与「已删除项目」筛选，不影响动态本身。
    const feed = client.listActivity as unknown as ReturnType<typeof vi.fn>;
    expect(feed).toHaveBeenCalledTimes(1);
    expect(feed).toHaveBeenCalledWith(
      { limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});

describe("ADR-051 删除行的还原与彻底删除", () => {
  it("按服务端下发的 canRestore / canPurge 渲染入口", async () => {
    mount(createClient());

    const restorable = await screen.findByTestId("activity-item-9001");
    expect(within(restorable).getByTestId("restore-project-41")).toBeTruthy();
    expect(within(restorable).getByTestId("purge-project-41")).toBeTruthy();
    // 两个入口都不再是「查看对象」死链。
    expect(within(restorable).queryByLabelText("查看对象")).toBeNull();

    const plain = await screen.findByTestId("activity-item-9002");
    expect(within(plain).queryByTestId("restore-project-12")).toBeNull();
    expect(within(plain).queryByTestId("purge-project-12")).toBeNull();
  });

  it("还原项目直接发送，不带 If-Match", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-9" });
    const restoreProject = vi.fn().mockResolvedValue({});
    mount(
      createClient({
        issueCsrfToken,
        restoreProject,
      } as never),
    );

    await userEvent.click(await screen.findByTestId("restore-project-41"));

    await waitFor(() => expect(restoreProject).toHaveBeenCalledTimes(1));
    const [projectId, init] = restoreProject.mock.calls[0] as [
      number,
      { headers: Record<string, string> },
    ];
    expect(projectId).toBe(41);
    expect(init.headers["x-csrf-token"]).toBe("csrf-9");
    expect(init.headers["Idempotency-Key"]).toEqual(expect.any(String));
    expect(init.headers["If-Match"]).toBeUndefined();
  });

  it("彻底删除先二次确认，确认后才发请求", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-9" });
    const purgeProject = vi.fn().mockResolvedValue({});
    mount(
      createClient({
        issueCsrfToken,
        purgeProject,
      } as never),
    );

    await userEvent.click(await screen.findByTestId("purge-project-41"));
    expect(screen.getByText("确认彻底删除项目")).toBeInTheDocument();
    expect(purgeProject).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(purgeProject).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId("purge-project-41"));
    await userEvent.click(screen.getByTestId("confirm-purge-project-41"));

    await waitFor(() => expect(purgeProject).toHaveBeenCalledTimes(1));
    expect(purgeProject.mock.calls[0]?.[0]).toBe(41);
  });

  it("写路径失败时按错误码给出文案，不隐藏入口", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-9" });
    const restoreProject = vi.fn().mockRejectedValue(
      new ApiError(403, {
        code: "PROJECT_RESTORE_FORBIDDEN",
        message: "forbidden",
        details: {},
        requestId: "req-1",
      }),
    );
    mount(
      createClient({
        issueCsrfToken,
        restoreProject,
      } as never),
    );

    await userEvent.click(await screen.findByTestId("restore-project-41"));

    expect(
      await screen.findByText("只有项目组长或系统管理员可以还原项目。"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("restore-project-41")).toBeInTheDocument();
  });
});

describe("已删除项目的完整动态过程", () => {
  /** 删除 → 还原 → 再删除：同一项目留下两条删除记录，历史行也随项目一并下发。 */
  const ROWS: readonly ActivityItem[] = [
    {
      id: "9003",
      projectId: 41,
      sourceEntityType: "PROJECT",
      sourceEntityId: 41,
      activityType: "PROJECT_DELETED",
      actorId: 812,
      summary: "删除了项目 旧版交付平台",
      occurredAt: "2026-09-28T08:00:00.000000Z",
    },
    {
      id: "9001",
      projectId: 41,
      sourceEntityType: "PROJECT",
      sourceEntityId: 41,
      activityType: "PROJECT_DELETED",
      actorId: 812,
      summary: "删除了项目 旧版交付平台",
      occurredAt: "2026-09-28T06:30:00.000000Z",
    },
    {
      id: "9000",
      projectId: 41,
      sourceEntityType: "PROJECT",
      sourceEntityId: 41,
      activityType: "PROJECT_CREATED",
      actorId: 812,
      summary: "创建了项目 旧版交付平台",
      occurredAt: "2026-09-20T01:00:00.000000Z",
    },
  ];

  function mountWithHistory() {
    return mount(
      createClient({
        listActivity: vi.fn().mockResolvedValue({
          items: [...ROWS],
          nextCursor: null,
          hasMore: false,
          dayTotals: [{ day: "2026-09-28", count: 2 }],
          dayTotalsTruncated: false,
        }),
      } as never),
    );
  }

  it("多次删除只让最新一条保留还原与彻底删除", async () => {
    mountWithHistory();

    const latest = await screen.findByTestId("activity-item-9003");
    expect(within(latest).getByTestId("restore-project-41")).toBeTruthy();
    expect(within(latest).getByTestId("purge-project-41")).toBeTruthy();

    // 更早的删除记录保留为过程，但不代表项目当前状态，没有操作入口。
    const earlier = screen.getByTestId("activity-item-9001");
    expect(within(earlier).queryByTestId("restore-project-41")).toBeNull();
    expect(within(earlier).queryByTestId("purge-project-41")).toBeNull();
  });

  it("删除前的历史动态一并展示，且不给已不存在项目留跳转死链", async () => {
    mountWithHistory();

    const created = await screen.findByTestId("activity-item-9000");
    expect(created).toHaveTextContent("创建项目");
    expect(created).toHaveTextContent("旧版交付平台");
    expect(within(created).queryByLabelText("查看对象")).toBeNull();

    // 删除行同样不回退成「项目 #41」，项目名由删除台账补齐。
    expect(screen.getByTestId("activity-item-9003")).toHaveTextContent(
      "旧版交付平台 · 项目 #41",
    );
  });

  it("项目筛选下拉提供「已删除项目」选项", async () => {
    mountWithHistory();
    await screen.findByTestId("activity-item-9003");

    await userEvent.click(screen.getByLabelText("项目"));
    expect(await screen.findByTitle("已删除项目")).toBeInTheDocument();
  });
});
