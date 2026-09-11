import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ProjectItem } from "@generated/api";
import { ProjectOverviewPageView } from "./ProjectOverviewPageView";
import type {
  ProjectOverviewAdapter,
  ProjectOverviewResult,
} from "./project-overview-types";

const project: ProjectItem = {
  id: 1,
  code: "INP",
  name: "InPulse 平台",
  description: "平台项目描述",
  status: "ACTIVE",
  rowVersion: 2,
  createdBy: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  memberCount: 3,
};

const overviewResult: ProjectOverviewResult = {
  stats: {
    activeModules: 4,
    activeFeatures: 11,
    openTasks: 6,
    publishedRecords: 9,
    openLeftovers: 1,
  },
  recentIterations: [
    {
      recordId: 301,
      code: "R-301",
      title: "迭代一",
      featureName: "任务中心",
      publishedAt: "2026-09-09T08:00:00.000Z",
    },
    {
      recordId: 302,
      code: "R-302",
      title: "迭代二",
      featureName: null,
      publishedAt: "2026-09-06T08:00:00.000Z",
    },
  ],
  leftovers: [
    {
      leftoverId: 21,
      summary: "遗留一",
      recordCode: "R-021",
      recordTitle: "登录安全复核",
    },
  ],
};

const createAdapter = (
  result: ProjectOverviewResult = overviewResult,
): ProjectOverviewAdapter & {
  fetchProjectOverview: ReturnType<typeof vi.fn>;
} => ({
  source: "mock",
  notice: "测试项目概览骨架",
  fetchProjectOverview: vi.fn().mockResolvedValue(result),
});

interface RenderOverrides {
  readonly adapter?: ProjectOverviewAdapter;
  readonly project?: ProjectItem | null;
  readonly projectError?: string;
  readonly modules?: readonly { readonly id: number; readonly name: string }[];
}

const projectModules = [
  { id: 3, name: "未分类模块" },
  { id: 4, name: "退款模块" },
];

const renderView = (overrides: RenderOverrides = {}) => {
  const handlers = {
    onRetryProject: vi.fn(),
    onBackToProjects: vi.fn(),
    onOpenModules: vi.fn(),
    onOpenMembers: vi.fn(),
    onOpenRecords: vi.fn(),
    onOpenIssues: vi.fn(),
    onOpenModule: vi.fn(),
    onOpenOverview: vi.fn(),
  };
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <ProjectOverviewPageView
        projectId={1}
        project={overrides.project === undefined ? project : overrides.project}
        projectLoading={false}
        onRetryProject={handlers.onRetryProject}
        onBackToProjects={handlers.onBackToProjects}
        onOpenModules={handlers.onOpenModules}
        onOpenMembers={handlers.onOpenMembers}
        onOpenRecords={handlers.onOpenRecords}
        onOpenIssues={handlers.onOpenIssues}
        modules={overrides.modules ?? projectModules}
        onOpenModule={handlers.onOpenModule}
        onOpenOverview={handlers.onOpenOverview}
        adapter={overrides.adapter ?? createAdapter()}
        {...(overrides.projectError === undefined
          ? {}
          : { projectError: overrides.projectError })}
      />
    </QueryClientProvider>,
  );
  return handlers;
};

describe("ProjectOverviewPageView", () => {
  it("renders the project identity from the injected project port", async () => {
    renderView();

    expect(screen.getByText("INP / PROJECT")).toBeInTheDocument();
    expect(screen.getByText("InPulse 平台")).toBeInTheDocument();
    expect(screen.getByText("正常")).toBeInTheDocument();
    await screen.findByTestId("overview-metric-members");
    expect(
      within(screen.getByTestId("overview-metric-members")).getByText("3 人"),
    ).toBeInTheDocument();
  });

  it("renders the overview metrics from the adapter", async () => {
    renderView();

    const modules = await screen.findByTestId("overview-metric-modules");
    expect(await within(modules).findByText("4")).toBeInTheDocument();
    expect(
      await within(screen.getByTestId("overview-metric-features")).findByText(
        "11",
      ),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByTestId("overview-metric-tasks")).findByText("6"),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByTestId("overview-metric-records")).findByText(
        "9",
      ),
    ).toBeInTheDocument();
    expect(
      await within(screen.getByTestId("overview-metric-leftovers")).findByText(
        "1",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("project-overview-mock-notice"),
    ).toHaveTextContent("骨架数据");
  });

  it("renders recent iterations and routes 查看全部 to records", async () => {
    const handlers = renderView();
    const user = userEvent.setup();

    const row = await screen.findByRole("button", { name: /迭代一/ });
    expect(row).toHaveTextContent("任务中心：迭代一");
    expect(row).toHaveTextContent("R-301");

    await user.click(screen.getByRole("button", { name: /查看全部/ }));
    expect(handlers.onOpenRecords).toHaveBeenCalledTimes(1);
    await user.click(row);
    expect(handlers.onOpenRecords).toHaveBeenCalledTimes(2);
  });

  it("routes the leftover entries to the issues page", async () => {
    const handlers = renderView();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: /进入遗留问题/ }),
    );
    expect(handlers.onOpenIssues).toHaveBeenCalledTimes(1);

    const row = await screen.findByRole("button", { name: /遗留一/ });
    expect(row).toHaveTextContent("来自 R-021 登录安全复核");
    await user.click(row);
    expect(handlers.onOpenIssues).toHaveBeenCalledTimes(2);
  });

  it("degrades the contract gaps on the server source", async () => {
    renderView({
      adapter: {
        source: "server",
        notice: "服务端适配器测试",
        fetchProjectOverview: () =>
          Promise.resolve({
            stats: {
              activeModules: 4,
              activeFeatures: 11,
              openTasks: 6,
              publishedRecords: 9,
              openLeftovers: null,
            },
            recentIterations: [],
            leftovers: [
              {
                leftoverId: 21,
                summary: "遗留一",
                recordCode: "R-021",
                recordTitle: null,
              },
            ],
          }),
      },
    });

    expect(
      screen.getByTestId("project-overview-mock-notice"),
    ).toHaveTextContent("接口说明");
    const leftovers = await screen.findByTestId("overview-metric-leftovers");
    expect(await within(leftovers).findByText("—")).toBeInTheDocument();
    expect(within(leftovers).getByText("契约未提供总数")).toBeInTheDocument();
    const row = await screen.findByRole("button", { name: /遗留一/ });
    expect(row).toHaveTextContent("来自 R-021");
    expect(row).not.toHaveTextContent("登录安全复核");
  });

  it("shows empty states when the adapter returns no rows", async () => {
    renderView({
      adapter: createAdapter({
        stats: {
          activeModules: 0,
          activeFeatures: 0,
          openTasks: 0,
          publishedRecords: 0,
          openLeftovers: 0,
        },
        recentIterations: [],
        leftovers: [],
      }),
    });
    expect(await screen.findByText("暂无已发布记录")).toBeInTheDocument();
    expect(screen.getByText("没有待闭环的遗留问题")).toBeInTheDocument();
  });

  it("surfaces the adapter error message", async () => {
    renderView({
      adapter: {
        source: "mock",
        notice: "测试失败路径",
        fetchProjectOverview: () => Promise.reject(new Error("boom")),
      },
    });
    expect(
      await screen.findByText("项目概览暂时不可用，请稍后重试。"),
    ).toBeInTheDocument();
  });

  it("shows the project error with a retry action", async () => {
    const handlers = renderView({
      projectError: "项目不存在或已无权访问。",
    });
    const user = userEvent.setup();
    expect(
      await screen.findByText("项目不存在或已无权访问。"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));
    expect(handlers.onRetryProject).toHaveBeenCalledTimes(1);
  });

  it("renders the project context navigation with the overview entry active", async () => {
    const handlers = renderView();
    const nav = screen.getByRole("navigation", { name: "项目内导航" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["项目概览", "未分类模块", "退款模块"]);
    expect(within(nav).getByRole("button", { name: "项目概览" })).toHaveClass(
      "active",
    );
    const user = userEvent.setup();
    await user.click(within(nav).getByRole("button", { name: "退款模块" }));
    expect(handlers.onOpenModule).toHaveBeenCalledWith(4);
  });

  it("keeps the navigation on the overview entry for a project without modules", () => {
    renderView({ modules: [] });
    const nav = screen.getByRole("navigation", { name: "项目内导航" });
    expect(within(nav).getAllByRole("button")).toHaveLength(1);
    expect(within(nav).getByRole("button")).toHaveClass("active");
  });
});
