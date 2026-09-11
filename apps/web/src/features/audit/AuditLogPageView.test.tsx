import React from "react";
import { ConfigProvider } from "antd";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type AuditLogItem,
  type AuditLogPage,
  type InpulseApiClient,
} from "@generated/api";
import { AuthProvider, AuthStateProvider } from "@features/auth/auth-context";
import { AuditLogPageView } from "./AuditLogPageView";

const systemItem: AuditLogItem = {
  chainId: "SYSTEM",
  sequenceNo: 12,
  projectId: null,
  actorType: "USER",
  actorId: 1,
  action: "admin.user.create",
  targetType: "USER",
  targetId: "2",
  eventPayload: { loginName: "bob", reason: "阶段联调" },
  requestId: "request-1",
  clientRequestId: "client-9",
  ipAddress: "10.0.0.8",
  userAgent: "vitest-agent",
  occurredAt: "2026-09-11T08:00:00.000Z",
  prevHash: "a".repeat(64),
  recordHash: "b".repeat(64),
  keyVersion: 1,
  canonicalVersion: "JCS-1",
};

const projectItem: AuditLogItem = {
  ...systemItem,
  chainId: "PROJECT:7",
  sequenceNo: 3,
  projectId: 7,
  action: "project.update",
  targetType: "PROJECT",
  targetId: "7",
};

const project = {
  id: 7,
  code: "AGV",
  name: "AGV 智能搬运平台",
  description: "",
  status: "ACTIVE" as const,
  rowVersion: 1,
  createdBy: 1,
  createdAt: "2026-09-08T00:00:00.000Z",
  updatedAt: "2026-09-08T00:00:00.000Z",
  memberCount: 4,
};

function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function mount(client: InpulseApiClient) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AuthStateProvider value={{}}>
        <QueryClientProvider client={queryClient()}>
          <AuditLogPageView client={client} />
        </QueryClientProvider>
      </AuthStateProvider>
    </ConfigProvider>,
  );
}

function mountWithAuth(client: InpulseApiClient) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AuthProvider client={client}>
        <QueryClientProvider client={queryClient()}>
          <AuditLogPageView client={client} />
        </QueryClientProvider>
      </AuthProvider>
    </ConfigProvider>,
  );
}

function page(items: readonly AuditLogItem[]): AuditLogPage {
  return { items: [...items], nextCursor: null, hasMore: false };
}

describe("F-08 audit page", () => {
  it("reads the SYSTEM chain by default and renders raw audit rows", async () => {
    const getAuditLogs = vi.fn().mockResolvedValue(page([systemItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    expect(await screen.findByText("admin.user.create")).toBeInTheDocument();
    expect(getAuditLogs.mock.calls[0]?.[0]).toEqual({ limit: 50 });
    expect(screen.getByText("用户 #1")).toBeInTheDocument();
    expect(screen.getByText("USER #2")).toBeInTheDocument();
    expect(
      screen.getByText("链 SYSTEM · 序号 12 · 系统级"),
    ).toBeInTheDocument();
    expect(screen.queryByText("加载更多")).not.toBeInTheDocument();
  });

  it("switches to a project chain and sends the project scope", async () => {
    const user = userEvent.setup();
    const getAuditLogs = vi.fn().mockResolvedValue(page([projectItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    await screen.findByText("project.update");
    await user.selectOptions(
      screen.getByLabelText("审计链"),
      String(project.id),
    );

    await waitFor(() =>
      expect(getAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({ projectId: 7, limit: 50 }),
        expect.anything(),
      ),
    );
    expect(await screen.findByText("project.update")).toBeInTheDocument();
    expect(
      screen.getByText("链 PROJECT:7 · 序号 3 · 项目 #7"),
    ).toBeInTheDocument();
  });

  it("only applies filters after the query button is pressed", async () => {
    const getAuditLogs = vi.fn().mockResolvedValue(page([systemItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);
    await screen.findByText("admin.user.create");
    expect(getAuditLogs).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText("动作码"), {
      target: { value: "project.update" },
    });
    fireEvent.change(screen.getByLabelText("操作人 ID"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: "2026-09-01T08:00" },
    });
    expect(getAuditLogs).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() =>
      expect(getAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({
          action: "project.update",
          actorId: 3,
          from: new Date("2026-09-01T08:00").toISOString(),
        }),
        expect.anything(),
      ),
    );
  });

  it("rejects invalid filters before calling the server", async () => {
    const getAuditLogs = vi.fn().mockResolvedValue(page([systemItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);
    await screen.findByText("admin.user.create");

    fireEvent.change(screen.getByLabelText("操作人 ID"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "操作人 ID 必须是正整数。",
    );
    expect(getAuditLogs).toHaveBeenCalledTimes(1);
  });

  it("opens the raw snapshot modal with payload, hashes and request metadata", async () => {
    const user = userEvent.setup();
    const getAuditLogs = vi.fn().mockResolvedValue(page([systemItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    await user.click(
      await screen.findByRole("button", { name: "查看原始快照 序号 12" }),
    );
    expect(await screen.findByText("原始审计快照")).toBeInTheDocument();
    const payload = screen.getByTestId("audit-snapshot-payload");
    expect(payload.textContent ?? "").toMatch(/"loginName":\s*"bob"/);
    expect(screen.getByText("request-1")).toBeInTheDocument();
    expect(screen.getByText("client-9")).toBeInTheDocument();
    expect(screen.getByText("10.0.0.8")).toBeInTheDocument();
    expect(screen.getByText("vitest-agent")).toBeInTheDocument();
    expect(screen.getByText("b".repeat(64))).toBeInTheDocument();
    expect(
      screen.getByText(
        "审计日志不允许删除；原始快照仅系统管理员可见，读取本身已留痕。",
      ),
    ).toBeInTheDocument();
  });

  it("follows the signed cursor through load more", async () => {
    const user = userEvent.setup();
    const getAuditLogs = vi
      .fn()
      .mockResolvedValueOnce({
        items: [systemItem],
        nextCursor: "cursor-1",
        hasMore: true,
      } satisfies AuditLogPage)
      .mockResolvedValueOnce(page([projectItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    await user.click(await screen.findByRole("button", { name: "加载更多" }));
    await waitFor(() =>
      expect(getAuditLogs).toHaveBeenLastCalledWith(
        { cursor: "cursor-1", limit: 50 },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("project.update")).toBeInTheDocument();
    expect(screen.queryByText("加载更多")).not.toBeInTheDocument();
  });

  it("opens admin reauthentication on 403 and reloads after success", async () => {
    const user = userEvent.setup();
    const getAuditLogs = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiError(403, {
          code: "ADMIN_REAUTH_REQUIRED",
          message: "needs reauth",
          details: {},
          requestId: "reauth",
        }),
      )
      .mockResolvedValueOnce(page([systemItem]));
    const reauthenticateAdmin = vi.fn().mockResolvedValue(undefined);
    const client = {
      getCurrentUser: vi.fn().mockResolvedValue({
        id: 1,
        loginName: "admin",
        name: "管理员",
        email: null,
        avatarUrl: null,
        isAdmin: true,
        status: "ACTIVE",
      }),
      issueCsrfToken: vi.fn().mockResolvedValue({ csrfToken: "csrf-token" }),
      reauthenticateAdmin,
      getAuditLogs,
      listProjects: vi.fn().mockResolvedValue({ items: [] }),
    } as unknown as InpulseApiClient;
    mountWithAuth(client);

    const dialog = await screen.findByRole("dialog", {
      name: "管理员安全验证",
    });
    const typedValue = "vitest-reauth-value";
    await user.type(within(dialog).getByLabelText("管理员密码"), typedValue);
    await user.type(within(dialog).getByLabelText("6 位验证码"), "123456");
    await user.click(within(dialog).getByRole("button", { name: "验证身份" }));

    expect(await screen.findByText("admin.user.create")).toBeInTheDocument();
    expect(reauthenticateAdmin).toHaveBeenCalledWith(
      { password: typedValue, code: "123456" },
      { headers: { "x-csrf-token": "csrf-token" } },
    );
    expect(
      screen.getByText("管理员安全验证已完成，正在重新读取原始审计。"),
    ).toBeInTheDocument();
  });

  it("maps read failures to safe copy with a retry entry", async () => {
    const getAuditLogs = vi.fn().mockRejectedValue(
      new ApiError(422, {
        code: "VALIDATION_FAILED",
        message: "internal-detail",
        details: {},
        requestId: "r",
      }),
    );
    const listProjects = vi.fn().mockResolvedValue({ items: [] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    expect(await screen.findByText("原始审计读取失败")).toBeInTheDocument();
    expect(screen.getByText(/游标已过期/)).toBeInTheDocument();
    expect(screen.queryByText("internal-detail")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });
});
