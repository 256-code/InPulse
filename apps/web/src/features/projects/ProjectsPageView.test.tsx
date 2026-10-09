import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
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
    // 默认停在「未完成」档：进行中与未开始都在这一档。
    expect(screen.getByText("未开始").className).toContain("badge-cyan");
    expect(screen.getByText("进行中").className).toContain("badge-blue");
    expect(screen.queryByRole("heading", { name: "维护中项目" })).toBeNull();
    // 维护中归到另一档，切过去才可见。
    fireEvent.click(screen.getByRole("button", { name: "维护中" }));
    const card = screen
      .getByRole("heading", { name: "维护中项目" })
      .closest(".project-card");
    expect(card).not.toBeNull();
    expect(within(card as HTMLElement).getByText("维护中").className).toContain(
      "badge-violet",
    );
  });
});

const maintenanceEarly: ProjectListItem = {
  ...project,
  id: 11,
  code: "K1",
  name: "早维护",
  status: "MAINTENANCE",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const maintenanceLate: ProjectListItem = {
  ...project,
  id: 12,
  code: "K2",
  name: "晚维护",
  status: "MAINTENANCE",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

describe("项目列表生命周期滑块（2026-10-09 用户指示）", () => {
  it("两档各带数量，默认停在未完成档", () => {
    mount({ projects: [project, maintenanceEarly, maintenanceLate] });

    const open = screen.getByRole("button", { name: "未完成" });
    const maintenance = screen.getByRole("button", { name: "维护中" });
    expect(open).toHaveAttribute("aria-pressed", "true");
    expect(maintenance).toHaveAttribute("aria-pressed", "false");
    expect(within(open).getByText("1")).toBeInTheDocument();
    expect(within(maintenance).getByText("2")).toBeInTheDocument();
    // 维护中的卡片不在未完成档里。
    expect(screen.queryByText("早维护")).toBeNull();
  });

  it("维护中按进入维护的时间从近到远排列", () => {
    mount({ projects: [maintenanceEarly, maintenanceLate] });
    fireEvent.click(screen.getByRole("button", { name: "维护中" }));

    const names = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);
    expect(names).toEqual(["晚维护", "早维护"]);
  });

  it("搜索只在当前档内过滤，两档数字不随关键词变化", () => {
    mount({ projects: [project, maintenanceEarly, maintenanceLate] });
    fireEvent.change(screen.getByLabelText("搜索项目"), {
      target: { value: "早维护" },
    });

    expect(screen.getByText("没有匹配的项目")).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: "未完成" })).getByText("1"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("button", { name: "维护中" })).getByText("2"),
    ).toBeInTheDocument();
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
