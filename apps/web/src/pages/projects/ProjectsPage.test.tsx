import React from "react";
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { CreateProjectResponse, InpulseApiClient } from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";
import { ProjectsPage } from "./ProjectsPage";

const createdProject: CreateProjectResponse = {
  project: {
    id: 7,
    code: "SHOP",
    name: "商城系统",
    description: "商城项目描述",
    status: "ACTIVE",
    rowVersion: 1,
    createdBy: 1,
    createdAt: "2026-09-09T00:00:00.000Z",
    updatedAt: "2026-09-09T00:00:00.000Z",
  },
  members: [
    { userId: 1, status: "ACTIVE", joinedAt: "2026-09-09T00:00:00.000Z" },
  ],
  unclassifiedModuleId: 12,
};

describe("ProjectsPage", () => {
  it("creates a project and navigates to its activity page", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const getUserDirectory = vi.fn().mockResolvedValue({
      items: [{ id: 1, name: "开发者 C", avatarUrl: null, isAdmin: false }],
    });
    const createProject = vi.fn().mockResolvedValue(createdProject);
    const listProjects = vi.fn().mockResolvedValue({
      items: [
        {
          ...createdProject.project,
          memberCount: 1,
        },
      ],
    });
    const client = {
      issueCsrfToken,
      getUserDirectory,
      createProject,
      listProjects,
    } as unknown as InpulseApiClient;

    render(
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
              isAdmin: true,
              status: "ACTIVE",
            },
          }}
        >
          <MemoryRouter initialEntries={["/projects"]}>
            <Routes>
              <Route
                path="/projects"
                element={<ProjectsPage client={client} />}
              />
              <Route
                path="/projects/:projectId/activity"
                element={<div>Activity content</div>}
              />
              <Route
                path="/projects/:projectId/members"
                element={<div>Member content</div>}
              />
              <Route path="/search" element={<div>Search content</div>} />
            </Routes>
          </MemoryRouter>
        </AuthStateProvider>
      </QueryClientProvider>,
    );

    await waitFor(() => expect(listProjects).toHaveBeenCalledTimes(1));
    const projectName = await screen.findByText("商城系统");
    expect(projectName).toBeInTheDocument();
    expect(projectName.closest(".project-card")).toHaveTextContent("1 位成员");
    expect(screen.getByText("项目 / 1 个")).toBeInTheDocument();
    expect(projectName.closest(".project-card")).toHaveTextContent("查看模块");
    expect(screen.getByText("层级说明")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /管\s*理\s*成\s*员/ }),
    ).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "新建项目" }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("项目名称"), {
      target: { value: "商城系统" },
    });
    fireEvent.change(within(dialog).getByLabelText("项目编码"), {
      target: { value: "shop" },
    });
    fireEvent.change(within(dialog).getByLabelText("项目描述"), {
      target: { value: "商城项目描述" },
    });
    await user.click(within(dialog).getByRole("button", { name: "创建项目" }));

    await waitFor(() => expect(createProject).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("项目创建成功")).toBeInTheDocument();
    await user.click(screen.getByTestId("open-created-project-activity"));
    expect(await screen.findByText("Activity content")).toBeInTheDocument();
  }, 15_000);

  it("opens the admin member management page from a project card", async () => {
    const listProjects = vi.fn().mockResolvedValue({
      items: [
        {
          ...createdProject.project,
          memberCount: 1,
        },
      ],
    });
    const client = {
      getUserDirectory: vi.fn().mockResolvedValue({ items: [] }),
      listProjects,
    } as unknown as InpulseApiClient;

    render(
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
              isAdmin: true,
              status: "ACTIVE",
            },
          }}
        >
          <MemoryRouter initialEntries={["/projects"]}>
            <Routes>
              <Route
                path="/projects"
                element={<ProjectsPage client={client} />}
              />
              <Route
                path="/projects/:projectId/members"
                element={<div>Member content</div>}
              />
            </Routes>
          </MemoryRouter>
        </AuthStateProvider>
      </QueryClientProvider>,
    );

    const projectName = await screen.findByText("商城系统");
    const projectCard = projectName.closest(".project-card");
    expect(projectCard).not.toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /管\s*理\s*成\s*员/ }));
    expect(await screen.findByText("Member content")).toBeInTheDocument();
  });

  it("opens the archive reminder modal for admins from a project card", async () => {
    const listProjects = vi.fn().mockResolvedValue({
      items: [
        {
          ...createdProject.project,
          memberCount: 1,
        },
      ],
    });
    const getProjectArchivePreview = vi
      .fn()
      .mockResolvedValue({ projectId: 7, unfinishedTaskCount: 2 });
    const client = {
      getUserDirectory: vi.fn().mockResolvedValue({ items: [] }),
      listProjects,
      getProjectArchivePreview,
    } as unknown as InpulseApiClient;

    render(
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
              isAdmin: true,
              status: "ACTIVE",
            },
          }}
        >
          <MemoryRouter initialEntries={["/projects"]}>
            <Routes>
              <Route
                path="/projects"
                element={<ProjectsPage client={client} />}
              />
            </Routes>
          </MemoryRouter>
        </AuthStateProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("商城系统")).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /归\s*档/ }));
    expect(await screen.findByText("归档项目")).toBeInTheDocument();
    expect(
      await screen.findByText("该项目仍有 2 个未完成任务"),
    ).toBeInTheDocument();
  });
});
