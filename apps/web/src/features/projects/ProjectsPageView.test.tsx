import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { InpulseApiClient, ProjectItem } from "@generated/api";
import { ProjectsPageView } from "./ProjectsPageView";

const project: ProjectItem = {
  id: 2,
  code: "INPULSE" as ProjectItem["code"],
  name: "InPulse 研发交付平台",
  description: "研发交付平台",
  status: "ACTIVE",
  rowVersion: 1,
  createdBy: 1,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  memberCount: 4,
  stats: { activeModuleCount: 8, activeFeatureCount: 32, openTaskCount: 3 },
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
});
