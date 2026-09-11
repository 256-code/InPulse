import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ProjectContextNav } from "./ProjectContextNav";

const modules = [
  { id: 3, name: "未分类模块" },
  { id: 4, name: "退款模块" },
];

const mount = (
  active: number | "overview" | null,
  handlers: {
    onSelectOverview: () => void;
    onSelectModule: (moduleId: number) => void;
  },
) =>
  render(
    <ProjectContextNav
      modules={modules}
      active={active}
      onSelectOverview={handlers.onSelectOverview}
      onSelectModule={handlers.onSelectModule}
    />,
  );

const handlers = () => ({
  onSelectOverview: vi.fn(),
  onSelectModule: vi.fn(),
});

describe("项目内导航（设计师稿 catalog.tsx .project-context-nav）", () => {
  it("renders the overview entry followed by every module of the project", () => {
    mount("overview", handlers());
    const nav = screen.getByRole("navigation", { name: "项目内导航" });
    expect(
      within(nav)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["项目概览", "未分类模块", "退款模块"]);
  });

  it("marks the overview entry as the current page at project level", () => {
    mount("overview", handlers());
    const overview = screen.getByRole("button", { name: "项目概览" });
    expect(overview).toHaveClass("active");
    expect(overview).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "退款模块" })).not.toHaveClass(
      "active",
    );
  });

  it("marks the current module as the active entry at module level", () => {
    mount(4, handlers());
    const active = screen.getByRole("button", { name: "退款模块" });
    expect(active).toHaveClass("active");
    expect(active).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "项目概览" })).not.toHaveClass(
      "active",
    );
    expect(screen.getByRole("button", { name: "未分类模块" })).not.toHaveClass(
      "active",
    );
  });

  it("marks nothing when the current page is neither the overview nor a module", () => {
    mount(null, handlers());
    expect(
      screen
        .getAllByRole("button")
        .filter((button) => button.classList.contains("active")),
    ).toEqual([]);
  });

  it("reports the selected module id and the overview selection", async () => {
    const spies = handlers();
    mount(4, spies);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "未分类模块" }));
    expect(spies.onSelectModule).toHaveBeenCalledWith(3);
    await user.click(screen.getByRole("button", { name: "项目概览" }));
    expect(spies.onSelectOverview).toHaveBeenCalledTimes(1);
  });

  it("only renders the overview entry for a project without modules", () => {
    render(
      <ProjectContextNav
        modules={[]}
        active={null}
        onSelectOverview={vi.fn()}
        onSelectModule={vi.fn()}
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
