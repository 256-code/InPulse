import React from "react";
import { describe, expect, it, vi } from "vitest";
import { ConfigProvider } from "antd";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  InpulseApiClient,
  ProjectMemberRecordItem,
  ProjectMemberUnfinishedTaskItem,
} from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";
import { ProjectMembersPageView } from "./ProjectMembersPageView";

const owner: ProjectMemberRecordItem = {
  membershipId: 10,
  projectId: 7,
  userId: 2,
  name: "开发者 C",
  avatarUrl: null,
  status: "ACTIVE",
  joinedAt: "2026-09-09T00:00:00.000Z",
  removedAt: null,
};

const removed: ProjectMemberRecordItem = {
  membershipId: 11,
  projectId: 7,
  userId: 4,
  name: "已移除成员",
  avatarUrl: null,
  status: "REMOVED",
  joinedAt: "2026-09-08T00:00:00.000Z",
  removedAt: "2026-09-09T00:00:00.000Z",
};

const unfinishedTask: ProjectMemberUnfinishedTaskItem = {
  taskId: 99,
  projectId: 7,
  moduleId: 12,
  featureId: 33,
  scopeType: "FEATURE",
  code: "SHOP-T-99",
  title: "待办功能",
  description: "描述",
  priority: "NORMAL",
  dueAt: null,
  workStatus: "TODO",
  assigneeId: 2,
  rowVersion: 4,
  impactFeatureIds: [33],
};

function mount(
  client: InpulseApiClient,
  authValue: {
    readonly reauthenticateAdmin?: () => Promise<void>;
  } = {},
) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AuthStateProvider value={authValue}>
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <ProjectMembersPageView projectId={7} client={client} />
        </QueryClientProvider>
      </AuthStateProvider>
    </ConfigProvider>,
  );
}

function baseClient() {
  return {
    listProjectMembers: vi.fn().mockResolvedValue({ items: [owner, removed] }),
    listProjectMemberUnfinishedTasks: vi.fn().mockResolvedValue({ items: [] }),
    getUserDirectory: vi.fn().mockResolvedValue({ items: [] }),
    issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "csrf-token" }),
  };
}

describe("ProjectMembersPageView", () => {
  it("lists project member history and opens remove confirmation", async () => {
    const client = baseClient() as unknown as InpulseApiClient;
    mount(client);

    await screen.findByText("开发者 C");
    expect(screen.getByText("已移除成员")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /移\s*除/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /移\s*除/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("移除项目成员")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        (
          client as unknown as {
            listProjectMemberUnfinishedTasks: ReturnType<typeof vi.fn>;
          }
        ).listProjectMemberUnfinishedTasks,
      ).toHaveBeenCalledWith(7, 2, expect.anything()),
    );
    expect(
      within(dialog).getByText("该成员没有未完成任务。"),
    ).toBeInTheDocument();
  });

  it("adds a candidate member through the generated client with security headers", async () => {
    const client = baseClient();
    client.listProjectMembers.mockResolvedValue({ items: [owner] });
    client.getUserDirectory.mockResolvedValue({
      items: [{ id: 3, name: "新成员", avatarUrl: null, isAdmin: false }],
    });
    const addProjectMember = vi.fn().mockResolvedValue({ member: owner });
    const api = {
      ...client,
      addProjectMember,
    } as unknown as InpulseApiClient;
    mount(api);

    await screen.findByText("开发者 C");
    fireEvent.click(screen.getByRole("button", { name: "添加成员" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: "选择成员：新成员" }),
    );
    fireEvent.click(within(dialog).getByRole("button", { name: "添加成员" }));

    await waitFor(() => expect(addProjectMember).toHaveBeenCalledTimes(1));
    expect(addProjectMember).toHaveBeenCalledWith(
      7,
      { userId: 3 },
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-csrf-token": "csrf-token",
          "Idempotency-Key": expect.stringContaining("project-member-add-"),
        }),
      }),
    );
    await screen.findByText("成员已添加，项目成员列表已更新。");
  });

  it("removes a member and sends the original unfinished task by default", async () => {
    const client = baseClient();
    client.listProjectMemberUnfinishedTasks.mockResolvedValue({
      items: [unfinishedTask],
    });
    const removeProjectMember = vi.fn().mockResolvedValue({
      member: {
        ...owner,
        status: "REMOVED",
        removedAt: "2026-09-09T01:00:00.000Z",
      },
      reassignedTaskIds: [],
      unfinishedTaskCount: 1,
    });
    const api = {
      ...client,
      removeProjectMember,
    } as unknown as InpulseApiClient;
    mount(api);

    await screen.findByText("开发者 C");
    fireEvent.click(screen.getByRole("button", { name: /移\s*除/ }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("SHOP-T-99");
    fireEvent.click(within(dialog).getByRole("button", { name: "确认移除" }));

    await waitFor(() => expect(removeProjectMember).toHaveBeenCalledTimes(1));
    expect(removeProjectMember).toHaveBeenCalledWith(
      7,
      2,
      { reassignments: [] },
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-csrf-token": "csrf-token",
          "Idempotency-Key": expect.stringContaining("project-member-remove-"),
        }),
      }),
    );
    await screen.findByText(/成员已移出项目/);
  });
});
