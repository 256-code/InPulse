import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  ApiError,
  type AuditLogItem,
  type AuditLogPage,
  type InpulseApiClient,
} from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";
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

const readTrailItem: AuditLogItem = {
  ...systemItem,
  sequenceNo: 13,
  action: "AUDIT_LOG_READ",
  targetType: "AUDIT_CHAIN",
  targetId: "SYSTEM",
  eventPayload: { returnedCount: 50, hasMore: true },
};

const taskItem: AuditLogItem = {
  ...systemItem,
  chainId: "PROJECT:7",
  sequenceNo: 14,
  projectId: 7,
  action: "task.status",
  targetType: "TASK",
  targetId: "9370",
  eventPayload: { after: { code: "INPULSE-T-59", title: "登录测试" } },
};

// 演示种子数据是平铺载荷，没有 after/before 包裹。
const seedFeatureItem: AuditLogItem = {
  ...systemItem,
  chainId: "PROJECT:7",
  sequenceNo: 15,
  projectId: 7,
  action: "feature.create",
  targetType: "FEATURE",
  targetId: "20",
  eventPayload: { code: "INPULSE-F-11", name: "工程基建" },
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
  stats: {
    activeModuleCount: 2,
    activeFeatureCount: 5,
    openTaskCount: 3,
    completedTaskCount: 1,
  },
};

function queryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

/** 渲染前统一补一个用户目录 mock，断言里就能看到人名而不是「用户 #N」。 */
function withUserDirectory(client: InpulseApiClient): InpulseApiClient {
  return {
    ...client,
    getUserDirectory: vi.fn().mockResolvedValue({
      items: [
        { id: 1, name: "邵昱宇", avatarUrl: null, isAdmin: true },
        { id: 2, name: "Bob", avatarUrl: null, isAdmin: false },
      ],
    }),
  } as unknown as InpulseApiClient;
}

function mount(client: InpulseApiClient) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AuthStateProvider value={{}}>
        <QueryClientProvider client={queryClient()}>
          <AuditLogPageView client={withUserDirectory(client)} />
        </QueryClientProvider>
      </AuthStateProvider>
    </ConfigProvider>,
  );
}

function page(items: readonly AuditLogItem[]): AuditLogPage {
  return { items: [...items], nextCursor: null, hasMore: false };
}

/** CalmSelect 交互：打开下拉并点选目标项（弹层项带 title 属性）。 */
function pickSelectOption(label: string, optionTitle: string) {
  const field = screen.getByLabelText(label);
  const trigger = field.closest(".ant-select");
  if (!trigger) {
    throw new Error("select trigger not found for " + label);
  }
  fireEvent.mouseDown(trigger);
  fireEvent.click(screen.getByTitle(optionTitle));
}

describe("F-08 audit page", () => {
  it("reads the SYSTEM chain by default and renders raw audit rows", async () => {
    const getAuditLogs = vi.fn().mockResolvedValue(page([systemItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    expect(await screen.findByText("创建用户")).toBeInTheDocument();
    expect(getAuditLogs.mock.calls[0]?.[0]).toEqual({ limit: 50 });
    expect(screen.getByText("邵昱宇")).toBeInTheDocument();
    expect(screen.getByText("对象：用户 Bob")).toBeInTheDocument();
    expect(screen.getByText("第 12 条 · 系统链")).toBeInTheDocument();
    expect(screen.queryByText("加载更多")).not.toBeInTheDocument();
  });

  it("labels entity targets with the code and name carried by the payload", async () => {
    const getAuditLogs = vi
      .fn()
      .mockResolvedValue(page([taskItem, seedFeatureItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    const taskLabel = "对象：任务 INPULSE-T-59「登录测试」";
    const featureLabel = "对象：功能 INPULSE-F-11「工程基建」";
    expect(await screen.findByText(taskLabel)).toBeInTheDocument();
    expect(screen.getByText(featureLabel)).toBeInTheDocument();
  });

  it("hides read-trail rows by default and reveals them on demand", async () => {
    const getAuditLogs = vi
      .fn()
      .mockResolvedValue(page([readTrailItem, systemItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    expect(await screen.findByText("创建用户")).toBeInTheDocument();
    expect(screen.queryByText("读取审计日志")).not.toBeInTheDocument();
    expect(screen.getByText("本页已隐藏 1 条读取留痕")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("隐藏读取留痕"));
    expect(await screen.findByText("读取审计日志")).toBeInTheDocument();
    expect(
      screen.queryByText("本页已隐藏 1 条读取留痕"),
    ).not.toBeInTheDocument();
  });

  it("switches to a project chain and sends the project scope", async () => {
    const getAuditLogs = vi.fn().mockResolvedValue(page([projectItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    await screen.findByText("更新项目");
    pickSelectOption("审计链", "PROJECT:" + project.id + " · " + project.name);

    // 切换审计对象开启一次新查看：不带 readTrail，服务端写读取留痕（ADR-041）。
    await waitFor(() =>
      expect(getAuditLogs).toHaveBeenLastCalledWith(
        { projectId: 7, limit: 50 },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("更新项目")).toBeInTheDocument();
    expect(
      screen.getByText("第 3 条 · 项目 AGV 智能搬运平台"),
    ).toBeInTheDocument();
  });

  it("only applies filters after the query button is pressed", async () => {
    const getAuditLogs = vi.fn().mockResolvedValue(page([systemItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);
    await screen.findByText("创建用户");
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
          // 筛选属于同一次查看，不写新留痕（ADR-041）。
          readTrail: "false",
        }),
        expect.anything(),
      ),
    );
  });

  it("rejects invalid filters before calling the server", async () => {
    const getAuditLogs = vi.fn().mockResolvedValue(page([systemItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);
    await screen.findByText("创建用户");

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
      await screen.findByRole("button", { name: "查看原始快照 第 12 条" }),
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
        // 分页是同一次查看的延续，不带新留痕（ADR-041）。
        { cursor: "cursor-1", limit: 50, readTrail: "false" },
        expect.anything(),
      ),
    );
    expect(await screen.findByText("更新项目")).toBeInTheDocument();
    expect(screen.queryByText("加载更多")).not.toBeInTheDocument();
  });

  it("shows the administrator permission copy when the read is forbidden", async () => {
    const getAuditLogs = vi.fn().mockRejectedValue(
      new ApiError(403, {
        code: "ADMIN_REQUIRED",
        message: "internal-forbidden",
        details: {},
        requestId: "forbidden",
      }),
    );
    const listProjects = vi.fn().mockResolvedValue({ items: [] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    expect(await screen.findByText("原始审计读取失败")).toBeInTheDocument();
    expect(
      screen.getByText("原始审计仅系统管理员可读取。"),
    ).toBeInTheDocument();
    expect(screen.queryByText("internal-forbidden")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
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
