import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { InpulseApiClient, ProjectListItem } from "@generated/api";
import { ProjectsPageView } from "./ProjectsPageView";

const project: ProjectListItem = {
  id: 2,
  code: "INPULSE",
  name: "InPulse 研发交付平台",
  description: "研发交付平台",
  status: "ACTIVE",
  hasCompletedTask: false,
  rowVersion: 1,
  createdBy: 1,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  memberCount: 4,
  stats: {
    activeModuleCount: 8,
    activeFeatureCount: 32,
    openTaskCount: 3,
    completedTaskCount: 1,
  },
  currentUserRole: "MEMBER",
};

function mount(
  overrides: Partial<React.ComponentProps<typeof ProjectsPageView>>,
) {
  const onOpenModules = vi.fn();
  render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <ProjectsPageView
          creatorName="特哥"
          projects={[project]}
          onOpenModules={onOpenModules}
          client={{} as InpulseApiClient}
          {...overrides}
        />
      </QueryClientProvider>
    </ConfigProvider>,
  );
  return { onOpenModules };
}

describe("项目卡", () => {
  it("shows module, feature, task and member counts in the two footer rows", () => {
    mount({});
    expect(screen.getByText(/8 个模块/)).toBeInTheDocument();
    expect(screen.getByText(/32 个功能/)).toBeInTheDocument();
    expect(screen.getByText(/3 项待办/)).toBeInTheDocument();
    expect(screen.getByText(/4 位成员/)).toBeInTheDocument();
  });

  it("opens the module list when the card body itself is clicked", () => {
    const { onOpenModules } = mount({});
    fireEvent.click(
      screen.getByRole("heading", { name: "InPulse 研发交付平台" }),
    );
    expect(onOpenModules).toHaveBeenCalledWith(2);
  });

  it("opens the module list when the card body is activated by keyboard", () => {
    const { onOpenModules } = mount({});
    const card = screen
      .getByRole("heading", { name: "InPulse 研发交付平台" })
      .closest(".project-card")!;
    expect(card.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(card, { key: "Enter" });
    expect(onOpenModules).toHaveBeenCalledWith(2);
  });

  it("keeps card actions out of the card navigation", () => {
    const { onOpenModules } = mount({ isAdmin: true });
    fireEvent.click(screen.getByTestId("edit-project-2"));
    expect(onOpenModules).not.toHaveBeenCalled();
    expect(screen.getByText("编辑项目")).toBeInTheDocument();
  });

  it("keeps GitHub links off the project card, matching the design reference", () => {
    mount({});
    expect(screen.queryByRole("button", { name: "GitHub 链接" })).toBeNull();
  });

  it("项目状态标签直接映射三态，不再由完成任务数推导", () => {
    mount({
      projects: [
        {
          ...project,
          id: 3,
          code: "K1235",
          name: "未开始项目",
          status: "NOT_STARTED",
          stats: { ...project.stats, completedTaskCount: 9 },
        },
        project,
        {
          ...project,
          id: 4,
          code: "K1236",
          name: "维护中项目",
          status: "MAINTENANCE",
        },
      ],
    });
    expect(screen.getByText("未开始").className).toContain("badge-cyan");
    expect(screen.getByText("进行中").className).toContain("badge-blue");
    expect(screen.getByText("维护中").className).toContain("badge-violet");
  });
});

describe("项目归档入口下线（ADR-043）", () => {
  it("项目层面不再有归档入口，系统管理员也只能编辑与管理成员", () => {
    mount({ isAdmin: true });
    expect(screen.getByTestId("edit-project-2")).toBeInTheDocument();
    expect(screen.queryByTestId("archive-project-2")).toBeNull();
    expect(screen.queryByTestId("restore-project-2")).toBeNull();
    expect(screen.queryByTestId("request-archive-2")).toBeNull();
    expect(screen.queryByTestId("approve-archive-request-2")).toBeNull();
    expect(screen.queryByTestId("reject-archive-request-2")).toBeNull();
  });
});
