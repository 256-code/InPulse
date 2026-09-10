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
} from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";
import {
  ArchiveProjectModal,
  EditProjectModal,
  RestoreProjectModal,
} from "./ProjectManagementModals";

const project: ProjectItem = {
  id: 7,
  code: "SHOP",
  name: "商城系统",
  description: "商城项目描述",
  status: "ACTIVE",
  rowVersion: 3,
  createdBy: 1,
  createdAt: "2026-09-09T00:00:00.000Z",
  updatedAt: "2026-09-09T00:00:00.000Z",
  memberCount: 2,
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

    const dialog = await screen.findByRole("dialog");
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

    const dialog = await screen.findByRole("dialog");
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

    const dialog = await screen.findByRole("dialog");
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

    const dialog = await screen.findByRole("dialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "确认归档" }),
    );

    expect(await within(dialog).findByText("请填写归档原因")).toBeTruthy();
    expect(archiveProject).not.toHaveBeenCalled();
  });

  it("opens the admin reauthentication modal on 403 ADMIN_REAUTH_REQUIRED", async () => {
    const issueCsrfToken = vi.fn().mockResolvedValue({ csrfToken: "csrf-1" });
    const getProjectArchivePreview = vi
      .fn()
      .mockResolvedValue({ projectId: 7, unfinishedTaskCount: 0 });
    const archiveProject = vi.fn().mockRejectedValue(
      new ApiError(403, {
        code: "ADMIN_REAUTH_REQUIRED",
        message: "需要最近 5 分钟内完成密码与当前 TOTP 双重认证",
        details: { reason: "reauth-expired" },
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

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("归档原因"), {
      target: { value: "项目已交付" },
    });
    await userEvent.click(
      within(dialog).getByRole("button", { name: "确认归档" }),
    );

    expect(
      await within(dialog).findByText(
        "请先完成管理员安全验证，再继续归档或恢复项目。",
      ),
    ).toBeTruthy();
    expect(await screen.findByText("管理员安全验证")).toBeTruthy();
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

    const dialog = await screen.findByRole("dialog");
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
