import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";
import { AppLayout } from "./AppLayout";

describe("AppLayout", () => {
  const notificationClient = {
    getNotificationUnreadCount: vi.fn().mockResolvedValue({ unreadCount: 2 }),
  } as unknown as InpulseApiClient;

  function renderLayout(ui: React.ReactElement) {
    return render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
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
        </AuthStateProvider>
      </QueryClientProvider>,
    );
  }

  it("renders the v1.0 workspace shell", async () => {
    renderLayout(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<AppLayout notificationClient={notificationClient} />}
          />
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
    await screen.findByRole("button", { name: "通知" });
    expect(notificationClient.getNotificationUnreadCount).toHaveBeenCalled();
  });

  it("navigates to a registered workspace route", async () => {
    const user = userEvent.setup();
    renderLayout(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<AppLayout notificationClient={notificationClient} />}
          >
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
          <Route
            path="/"
            element={<AppLayout notificationClient={notificationClient} />}
          >
            <Route index element={<div>Home content</div>} />
            <Route path="search" element={<div>Search content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.type(screen.getByLabelText("全局搜索"), "inpulse{enter}");

    expect(await screen.findByText("Search content")).toBeInTheDocument();
  });

  it("navigates to notifications from the header bell", async () => {
    const user = userEvent.setup();
    renderLayout(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="/"
            element={<AppLayout notificationClient={notificationClient} />}
          >
            <Route index element={<div>Home content</div>} />
            <Route
              path="notifications"
              element={<div>Notifications content</div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "通知" }));

    expect(
      await screen.findByText("Notifications content"),
    ).toBeInTheDocument();
  });
});
