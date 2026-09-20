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
import {
  ApiError,
  type InpulseApiClient,
  type ProjectItem,
  type ProjectListItem,
} from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";
import {
  ArchiveProjectModal,
  EditProjectModal,
  RequestProjectArchiveModal,
  RestoreProjectModal,
  ReviewProjectArchiveModal,
} from "./ProjectManagementModals";

const project: ProjectItem = {
  id: 7,
  code: "SHOP",
  name: "商城系统",
  description: "商城项目描述",
  status: "ACTIVE",
  hasCompletedTask: false,
  rowVersion: 3,
  createdBy: 1,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  memberCount: 2,
  stats: {
    activeModuleCount: 3,
    activeFeatureCount: 7,
    openTaskCount: 5,
    completedTaskCount: 1,
  },
};

function renderWithProviders(node: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
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
        {node}
      </AuthStateProvider>
    </QueryClientProvider>,
  );
}

describe("EditProjectModal", () => {
  it("submits name and description with CSRF, If-Match and idempotency headers", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const updateProject = vi.fn().mockResolvedValue({
      project: { ...project, name: "商城系统二期", rowVersion: 4 },
    });
    const client = {
      issueCsrfToken,
      updateProject,
    } as unknown as InpulseApiClient;
    const onUpdated = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <EditProjectModal
        open
        project={project}
        client={client}
        onUpdated={onUpdated}
        onClose={onClose}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "编辑项目" });
    const nameInput = within(dialog).getByLabelText("项目名称");
    fireEvent.change(nameInput, { target: { value: "商城系统二期" } });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "保存修改" }),
    );

    await waitFor(() => expect(updateProject).toHaveBeenCalledTimes(1));
    expect(updateProject).toHaveBeenCalledWith(
      7,
      { name: "商城系统二期", description: "商城项目描述" },
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-csrf-token": "csrf-1",
          "If-Match": '"3"',
          "Idempotency-Key": expect.any(String),
        }),
      }),
    );
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ name: "商城系统二期", rowVersion: 4 }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("surfaces version conflicts without closing the form", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const updateProject = vi.fn().mockRejectedValue(
      new ApiError(409, {
        code: "PROJECT_VERSION_CONFLICT",
        message: "项目版本已变化",
        details: {},
        requestId: "req-1",
      }),
    );
    const client = {
      issueCsrfToken,
      updateProject,
    } as unknown as InpulseApiClient;
    const onClose = vi.fn();
    renderWithProviders(
      <EditProjectModal
        open
        project={project}
        client={client}
        onUpdated={vi.fn()}
        onClose={onClose}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "编辑项目" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "保存修改" }),
    );

    expect(
      await within(dialog).findByText(
        "项目内容已被他人更新，请加载最新版本后重试。",
      ),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("组长或项目管理员可切换状态：走 If-Match 与幂等键，成功后不关闭弹窗", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const changeProjectStatus = vi.fn().mockResolvedValue({
      project: { ...project, status: "MAINTENANCE", rowVersion: 4 },
    });
    const client = {
      issueCsrfToken,
      changeProjectStatus,
    } as unknown as InpulseApiClient;
    const onStatusChanged = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <EditProjectModal
        open
        project={project}
        client={client}
        canChangeStatus
        onUpdated={vi.fn()}
        onStatusChanged={onStatusChanged}
        onClose={onClose}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "编辑项目" });
    const saveStatus = within(dialog).getByRole("button", {
      name: "保存状态",
    });
    expect(saveStatus).toBeDisabled();
    await userEvent.click(
      within(dialog).getByRole("button", { name: "维护中" }),
    );
    expect(saveStatus).not.toBeDisabled();
    await userEvent.click(saveStatus);

    await waitFor(() => expect(changeProjectStatus).toHaveBeenCalledTimes(1));
    expect(changeProjectStatus).toHaveBeenCalledWith(
      7,
      { status: "MAINTENANCE" },
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-csrf-token": "csrf-1",
          "If-Match": '"3"',
          "Idempotency-Key": expect.any(String),
        }),
      }),
    );
    expect(onStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ status: "MAINTENANCE", rowVersion: 4 }),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("已有完成任务时不能再退回「未开始」，越级切换「维护中」也置灰", async () => {
    const client = {
      issueCsrfToken: vi.fn(),
      changeProjectStatus: vi.fn(),
    } as unknown as InpulseApiClient;
    renderWithProviders(
      <EditProjectModal
        open
        project={{ ...project, hasCompletedTask: true }}
        client={client}
        canChangeStatus
        onUpdated={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "编辑项目" });
    expect(
      within(dialog).getByRole("button", { name: "未开始" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "维护中" }),
    ).not.toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "未开始" }).title).toBe(
      "项目里已经出现过已完成任务，不能再退回未开始",
    );
  });

  it("未开始的项目不能直接切到维护中", async () => {
    const client = {
      issueCsrfToken: vi.fn(),
      changeProjectStatus: vi.fn(),
    } as unknown as InpulseApiClient;
    renderWithProviders(
      <EditProjectModal
        open
        project={{ ...project, status: "NOT_STARTED" }}
        client={client}
        canChangeStatus
        onUpdated={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "编辑项目" });
    expect(within(dialog).getByRole("button", { name: "维护中" }).title).toBe(
      "未开始与维护中不能直接互相切换，请先切到进行中",
    );
    expect(
      within(dialog).getByRole("button", { name: "进行中" }),
    ).not.toBeDisabled();
  });

  it("维护中的项目不能直接切回未开始", async () => {
    const client = {
      issueCsrfToken: vi.fn(),
      changeProjectStatus: vi.fn(),
    } as unknown as InpulseApiClient;
    renderWithProviders(
      <EditProjectModal
        open
        project={{ ...project, status: "MAINTENANCE" }}
        client={client}
        canChangeStatus
        onUpdated={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "编辑项目" });
    expect(
      within(dialog).getByRole("button", { name: "未开始" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "进行中" }),
    ).not.toBeDisabled();
  });

  it("无状态变更权限时只展示标签，保存状态按钮不可用", async () => {
    const client = {
      issueCsrfToken: vi.fn(),
      changeProjectStatus: vi.fn(),
    } as unknown as InpulseApiClient;
    renderWithProviders(
      <EditProjectModal
        open
        project={project}
        client={client}
        onUpdated={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "编辑项目" });
    expect(within(dialog).queryByRole("button", { name: "维护中" })).toBeNull();
    expect(within(dialog).getByText("进行中")).toBeTruthy();
    expect(
      within(dialog).getByRole("button", { name: "保存状态" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText(
        "只有系统管理员、项目组长或项目管理员可以更改项目状态。",
      ),
    ).toBeTruthy();
  });
});

describe("ArchiveProjectModal", () => {
  it("shows the unfinished task reminder and archives with a reason", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const getProjectArchivePreview = vi
      .fn()
      .mockResolvedValue({ projectId: 7, unfinishedTaskCount: 5 });
    const archiveProject = vi.fn().mockResolvedValue({
      project: { ...project, status: "ARCHIVED", rowVersion: 4 },
    });
    const client = {
      issueCsrfToken,
      getProjectArchivePreview,
      archiveProject,
    } as unknown as InpulseApiClient;
    const onArchived = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <ArchiveProjectModal
        open
        project={project}
        client={client}
        onArchived={onArchived}
        onClose={onClose}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "归档项目" });
    expect(
      await within(dialog).findByText("该项目仍有 5 个未完成任务"),
    ).toBeTruthy();

    fireEvent.change(within(dialog).getByLabelText("归档原因"), {
      target: { value: "项目已交付，暂停迭代" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "确认归档" }),
    );

    await waitFor(() => expect(archiveProject).toHaveBeenCalledTimes(1));
    expect(archiveProject).toHaveBeenCalledWith(
      7,
      { reason: "项目已交付，暂停迭代" },
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-csrf-token": "csrf-1",
          "If-Match": '"3"',
          "Idempotency-Key": expect.any(String),
        }),
      }),
    );
    expect(onArchived).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ARCHIVED" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("requires a reason before submitting", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const getProjectArchivePreview = vi
      .fn()
      .mockResolvedValue({ projectId: 7, unfinishedTaskCount: 0 });
    const archiveProject = vi.fn();
    const client = {
      issueCsrfToken,
      getProjectArchivePreview,
      archiveProject,
    } as unknown as InpulseApiClient;
    renderWithProviders(
      <ArchiveProjectModal
        open
        project={project}
        client={client}
        onArchived={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "归档项目" });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "确认归档" }),
    );

    expect(await within(dialog).findByText("请填写归档原因")).toBeTruthy();
    expect(archiveProject).not.toHaveBeenCalled();
  });

  it("shows the administrator permission copy on 403 ADMIN_REQUIRED", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const getProjectArchivePreview = vi
      .fn()
      .mockResolvedValue({ projectId: 7, unfinishedTaskCount: 0 });
    const archiveProject = vi.fn().mockRejectedValue(
      new ApiError(403, {
        code: "ADMIN_REQUIRED",
        message: "internal-forbidden",
        details: { reason: "not-admin" },
        requestId: "req-2",
      }),
    );
    const client = {
      issueCsrfToken,
      getProjectArchivePreview,
      archiveProject,
    } as unknown as InpulseApiClient;
    renderWithProviders(
      <ArchiveProjectModal
        open
        project={project}
        client={client}
        onArchived={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "归档项目" });
    fireEvent.change(within(dialog).getByLabelText("归档原因"), {
      target: { value: "项目已交付" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "确认归档" }),
    );

    expect(
      await within(dialog).findByText("只有系统管理员可以归档或恢复项目。"),
    ).toBeTruthy();
    expect(within(dialog).queryByText("internal-forbidden")).toBeNull();
  });
});

describe("RestoreProjectModal", () => {
  it("restores an archived project with a reason", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const restoreProject = vi.fn().mockResolvedValue({
      project: { ...project, status: "ACTIVE", rowVersion: 5 },
    });
    const client = {
      issueCsrfToken,
      restoreProject,
    } as unknown as InpulseApiClient;
    const onRestored = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <RestoreProjectModal
        open
        project={{ ...project, status: "ARCHIVED", rowVersion: 4 }}
        client={client}
        onRestored={onRestored}
        onClose={onClose}
      />,
    );

    const dialog = await screen.findByRole("dialog", { name: "恢复项目" });
    fireEvent.change(within(dialog).getByLabelText("恢复原因"), {
      target: { value: "项目重启" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "确认恢复" }),
    );

    await waitFor(() => expect(restoreProject).toHaveBeenCalledTimes(1));
    expect(restoreProject).toHaveBeenCalledWith(
      7,
      { reason: "项目重启" },
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-csrf-token": "csrf-1",
          "If-Match": '"4"',
          "Idempotency-Key": expect.any(String),
        }),
      }),
    );
    expect(onRestored).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ACTIVE" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

const listedProject: ProjectListItem = {
  ...project,
  currentUserRole: "LEADER",
  pendingArchiveRequest: {
    id: 21,
    requestedBy: 9,
    requestedByName: "组长甲",
    reason: "本阶段交付结束",
    requestedAt: "2026-09-16T02:00:00.000Z",
  },
};

describe("RequestProjectArchiveModal", () => {
  it("submits the reason with CSRF and idempotency headers", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const requestProjectArchive = vi.fn().mockResolvedValue({ id: 31 });
    const client = {
      issueCsrfToken,
      requestProjectArchive,
    } as unknown as InpulseApiClient;
    const onRequested = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <RequestProjectArchiveModal
        open
        project={listedProject}
        client={client}
        onRequested={onRequested}
        onClose={onClose}
      />,
    );

    const dialog = await screen.findByRole("dialog", {
      name: "申请项目归档",
    });
    fireEvent.change(within(dialog).getByLabelText("归档申请原因"), {
      target: { value: "本阶段交付结束" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "提交归档申请" }),
    );

    await waitFor(() => expect(requestProjectArchive).toHaveBeenCalledTimes(1));
    expect(requestProjectArchive).toHaveBeenCalledWith(
      7,
      { reason: "本阶段交付结束" },
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-csrf-token": "csrf-1",
          "Idempotency-Key": expect.any(String),
        }),
      }),
    );
    expect(onRequested).toHaveBeenCalledWith({ id: 31 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("surfaces the open task conflict without closing the form", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const requestProjectArchive = vi.fn().mockRejectedValue(
      new ApiError(409, {
        code: "PROJECT_ARCHIVE_TASKS_OPEN",
        message: "项目下仍有 2 个未归档任务",
        details: {},
        requestId: "req-2",
      }),
    );
    const client = {
      issueCsrfToken,
      requestProjectArchive,
    } as unknown as InpulseApiClient;
    const onClose = vi.fn();
    renderWithProviders(
      <RequestProjectArchiveModal
        open
        project={listedProject}
        client={client}
        onRequested={vi.fn()}
        onClose={onClose}
      />,
    );

    const dialog = await screen.findByRole("dialog", {
      name: "申请项目归档",
    });
    fireEvent.change(within(dialog).getByLabelText("归档申请原因"), {
      target: { value: "本阶段交付结束" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "提交归档申请" }),
    );

    expect(
      await within(dialog).findByText(
        "项目下仍有未完成、也未归档的任务，请先在任务弹窗底部完成或归档全部任务再申请。",
      ),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ReviewProjectArchiveModal", () => {
  it("approves with If-Match and reports the archived project", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const approveProjectArchive = vi.fn().mockResolvedValue({
      project: { ...project, status: "ARCHIVED", rowVersion: 4 },
      currentUserRole: null,
    });
    const client = {
      issueCsrfToken,
      approveProjectArchive,
    } as unknown as InpulseApiClient;
    const onApproved = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <ReviewProjectArchiveModal
        open
        decision="approve"
        project={listedProject}
        client={client}
        onApproved={onApproved}
        onRejected={vi.fn()}
        onClose={onClose}
      />,
    );

    const dialog = await screen.findByRole("dialog", {
      name: "批准项目归档",
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "确认归档" }),
    );

    await waitFor(() => expect(approveProjectArchive).toHaveBeenCalledTimes(1));
    expect(approveProjectArchive).toHaveBeenCalledWith(
      7,
      21,
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-csrf-token": "csrf-1",
          "If-Match": '"3"',
          "Idempotency-Key": expect.any(String),
        }),
      }),
    );
    expect(onApproved).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ARCHIVED" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("rejects with an optional note and keeps the project active", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const rejectProjectArchive = vi.fn().mockResolvedValue({
      id: 21,
      status: "REJECTED",
      decisionNote: "任务尚未收尾",
    });
    const client = {
      issueCsrfToken,
      rejectProjectArchive,
    } as unknown as InpulseApiClient;
    const onRejected = vi.fn();
    const onClose = vi.fn();
    renderWithProviders(
      <ReviewProjectArchiveModal
        open
        decision="reject"
        project={listedProject}
        client={client}
        onApproved={vi.fn()}
        onRejected={onRejected}
        onClose={onClose}
      />,
    );

    const dialog = await screen.findByRole("dialog", {
      name: "驳回项目归档申请",
    });
    fireEvent.change(within(dialog).getByLabelText("驳回批注"), {
      target: { value: "任务尚未收尾" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "确认驳回" }),
    );

    await waitFor(() => expect(rejectProjectArchive).toHaveBeenCalledTimes(1));
    expect(rejectProjectArchive).toHaveBeenCalledWith(
      7,
      21,
      { note: "任务尚未收尾" },
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-csrf-token": "csrf-1",
          "Idempotency-Key": expect.any(String),
        }),
      }),
    );
    expect(onRejected).toHaveBeenCalledWith(
      expect.objectContaining({ status: "REJECTED" }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
