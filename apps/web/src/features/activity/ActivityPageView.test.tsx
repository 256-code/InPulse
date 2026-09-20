import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActivityPage, InpulseApiClient } from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";
import { ActivityPageView } from "./ActivityPageView";

const PROJECT = {
  id: 7,
  code: "INPULSE",
  name: "InPulse 研发交付平台",
  description: null,
  status: "ACTIVE" as const,
  rowVersion: 1,
  createdBy: 1,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  memberCount: 4,
  stats: {
    activeModuleCount: 2,
    activeFeatureCount: 5,
    openTaskCount: 3,
    completedTaskCount: 1,
  },
};

const ACTIVITY: ActivityPage = {
  items: [
    {
      id: "1",
      projectId: 7,
      sourceEntityType: "TASK",
      sourceEntityId: 3,
      activityType: "task.complete",
      actorId: 1,
      summary: "任务完成：F-01 用户登录与会话管理 交付",
      occurredAt: "2026-09-08T04:05:00.000Z",
    },
  ],
  nextCursor: null,
  hasMore: false,
};

function createClient(): InpulseApiClient {
  return {
    getProjectActivity: vi.fn().mockResolvedValue(ACTIVITY),
    listProjects: vi.fn().mockResolvedValue({ items: [PROJECT] }),
    getUserDirectory: vi.fn().mockResolvedValue({
      items: [{ id: 1, name: "特哥", avatarUrl: null, isAdmin: true }],
    }),
  } as unknown as InpulseApiClient;
}

function mount(client: InpulseApiClient, isAdmin: boolean) {
  return render(
    <MemoryRouter>
      <AuthStateProvider
        value={{
          status: "authenticated",
          user: {
            id: 1,
            loginName: "tege",
            name: "特哥",
            email: null,
            avatarUrl: null,
            isAdmin,
            status: "ACTIVE",
          },
        }}
      >
        <QueryClientProvider
          client={
            new QueryClient({ defaultOptions: { queries: { retry: false } } })
          }
        >
          <ActivityPageView projectId={7} client={client} />
        </QueryClientProvider>
      </AuthStateProvider>
    </MemoryRouter>,
  );
}

describe("ActivityPageView", () => {
  it("renders the designer activity row with real actor names and admin snapshot actions", async () => {
    const client = createClient();
    mount(client, true);

    expect(await screen.findByTestId("activity-item-1")).toBeInTheDocument();
    expect(screen.getByText("特哥")).toBeInTheDocument();
    expect(screen.getByText("完成任务")).toBeInTheDocument();
    expect(
      screen.getByText("F-01 用户登录与会话管理 交付"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("InPulse 研发交付平台 · 任务 #3"),
    ).toBeInTheDocument();
    expect(screen.getByText("项目 #7")).toBeInTheDocument();
    expect(screen.getByText("管理员可查看原始快照")).toBeInTheDocument();
    expect(screen.getByLabelText("包含管理员操作")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "原始快照 1" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "查看对象" }),
    ).toBeInTheDocument();

    expect(screen.getByText("审计规则")).toBeInTheDocument();
    expect(screen.getByText("BR-012 · 以下操作必须记录")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(7);

    const projectActivity = client.getProjectActivity as unknown as ReturnType<
      typeof vi.fn
    >;
    expect(projectActivity).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ limit: 20 }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("hides the snapshot action from non-admins", async () => {
    mount(createClient(), false);

    expect(await screen.findByTestId("activity-item-1")).toBeInTheDocument();
    expect(screen.getByText("仅管理员可查看原始快照")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "原始快照 1" })).toBeNull();
    expect(screen.queryByLabelText("包含管理员操作")).toBeNull();
  });
});
