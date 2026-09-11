import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import type {
  ProjectOverviewAdapter,
  ProjectOverviewQueryInput,
  ProjectOverviewResult,
} from "@features/project-overview/project-overview-types";
import { ProjectOverviewPage } from "./ProjectOverviewPage";

const project = {
  id: 1,
  code: "INP",
  name: "InPulse 平台",
  description: "平台项目描述",
  status: "ACTIVE" as const,
  rowVersion: 2,
  createdBy: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
  memberCount: 5,
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

const createAdapter = () => {
  const fetchProjectOverview = vi.fn(
    async (_input: ProjectOverviewQueryInput): Promise<ProjectOverviewResult> =>
      overviewResult,
  );
  const adapter: ProjectOverviewAdapter = {
    source: "mock",
    notice: "测试项目概览骨架",
    fetchProjectOverview,
  };
  return { adapter, fetchProjectOverview };
};

const renderPage = (entries: string) => {
  const { adapter, fetchProjectOverview } = createAdapter();
  const getProject = vi.fn().mockResolvedValue({ project });
  const listModules = vi.fn().mockResolvedValue({
    items: [{ id: 3, projectId: 1, name: "未分类模块", status: "ACTIVE" }],
  });
  const client = { getProject, listModules } as unknown as InpulseApiClient;
  render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false } },
        })
      }
    >
      <MemoryRouter initialEntries={[entries]}>
        <Routes>
          <Route
            path="/projects/:projectId/overview"
            element={<ProjectOverviewPage client={client} adapter={adapter} />}
          />
          <Route path="/projects" element={<div>全部项目页</div>} />
          <Route
            path="/projects/:projectId/modules"
            element={<div>模块页</div>}
          />
          <Route
            path="/projects/:projectId/modules/:moduleId/features"
            element={<div>功能列表页</div>}
          />
          <Route path="/issues" element={<div>遗留问题页</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { getProject, fetchProjectOverview, listModules };
};

describe("ProjectOverviewPage", () => {
  it("loads the project identity and overview for the route projectId", async () => {
    const { getProject, fetchProjectOverview } = renderPage(
      "/projects/1/overview",
    );

    expect(await screen.findByText("InPulse 平台")).toBeInTheDocument();
    await waitFor(() => expect(getProject).toHaveBeenCalledWith(1));
    await waitFor(() =>
      expect(fetchProjectOverview).toHaveBeenCalledWith({ projectId: 1 }),
    );
    expect(
      await screen.findByText("5 人", undefined, { timeout: 2000 }),
    ).toBeInTheDocument();
  });

  it("rejects an invalid project id in the URL", async () => {
    renderPage("/projects/abc/overview");
    expect(await screen.findByText("项目地址无效")).toBeInTheDocument();
  });

  it("navigates from the leftover entries to the issues page", async () => {
    renderPage("/projects/1/overview");
    const user = userEvent.setup();
    const row = await screen.findByRole("button", { name: /遗留一/ });
    await user.click(row);
    expect(await screen.findByText("遗留问题页")).toBeInTheDocument();
  });

  it("navigates back to the projects list", async () => {
    renderPage("/projects/1/overview");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /全部项目/ }));
    expect(await screen.findByText("全部项目页")).toBeInTheDocument();
  });

  it("loads the project modules into the project context navigation", async () => {
    const { listModules } = renderPage("/projects/1/overview");
    await waitFor(() =>
      expect(listModules).toHaveBeenCalledWith(1, {
        signal: expect.any(AbortSignal),
      }),
    );
    const nav = await screen.findByRole("navigation", { name: "项目内导航" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["项目概览", "未分类模块"]);
  });

  it("opens a module feature list from the project context navigation", async () => {
    renderPage("/projects/1/overview");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "未分类模块" }));
    expect(await screen.findByText("功能列表页")).toBeInTheDocument();
  });
});
