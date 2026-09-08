import React from "react";
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthStateProvider } from "@features/auth/auth-context";
import { AppLayout } from "./AppLayout";

describe("AppLayout", () => {
  function renderLayout(ui: React.ReactElement) {
    return render(
      <AuthStateProvider
        value={{
          status: "authenticated",
          user: {
            id: 1,
            loginName: "developer",
            name: "开发者 C",
            email: null,
            avatarUrl: null,
            isAdmin: false,
            status: "ACTIVE",
          },
        }}
      >
        {ui}
      </AuthStateProvider>,
    );
  }

  it("renders the v1.0 workspace shell", () => {
    renderLayout(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<AppLayout />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("InPulse")).toBeInTheDocument();
    expect(screen.getAllByText("研发交付中心")).not.toHaveLength(0);
    expect(screen.getByText("项目与功能")).toBeInTheDocument();
    expect(screen.getByText("我的任务")).toBeInTheDocument();
    expect(screen.getByText("迭代记录")).toBeInTheDocument();
    expect(screen.getByText("成员与权限")).toBeInTheDocument();
    expect(screen.getByText("动态审计")).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("搜索项目、任务、功能..."),
    ).toBeInTheDocument();
  });

  it("navigates to a registered workspace route", async () => {
    const user = userEvent.setup();
    renderLayout(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<div>Home content</div>} />
            <Route path="projects" element={<div>Projects content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByText("项目与功能"));
    expect(await screen.findByText("Projects content")).toBeInTheDocument();
  });

  it("navigates to search when a query is submitted from the header", async () => {
    const user = userEvent.setup();
    renderLayout(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<AppLayout />}>
            <Route index element={<div>Home content</div>} />
            <Route path="search" element={<div>Search content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("全局搜索"), "inpulse{enter}");

    expect(await screen.findByText("Search content")).toBeInTheDocument();
  });
});
