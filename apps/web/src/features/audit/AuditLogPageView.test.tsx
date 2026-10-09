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

const historicalReadTrailItem: AuditLogItem = {
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

// ADR-051：彻底删除项目，用于校验动作码已收进中文标签表。
const purgeItem: AuditLogItem = {
  ...systemItem,
  sequenceNo: 16,
  action: "project.purge",
  targetType: "PROJECT",
  targetId: "41",
  eventPayload: { code: "T1", name: "旧版交付平台" },
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

/**
 * 渲染前统一补两个默认 mock：用户目录（断言里就能看到人名而不是「用户 #N」）与
 * 删除记录台账（默认空页）；用例自带同名 mock 时以后者为准。
 */
function withUserDirectory(client: InpulseApiClient): InpulseApiClient {
  const defaults = {
    getUserDirectory: vi.fn().mockResolvedValue({
      items: [
        { id: 1, name: "邵昱宇", avatarUrl: null, isAdmin: true },
        { id: 2, name: "Bob", avatarUrl: null, isAdmin: false },
      ],
    }),
    listProjectDeletions: vi.fn().mockResolvedValue({
      items: [],
      nextCursor: null,
      hasMore: false,
    }),
  };
  return { ...defaults, ...client } as unknown as InpulseApiClient;
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
  it("默认读取「全部记录（所有链）」并渲染原始审计行（ADR-061）", async () => {
    const getAuditLogs = vi.fn().mockResolvedValue(page([systemItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    expect(await screen.findByText("创建用户")).toBeInTheDocument();
    expect(getAuditLogs.mock.calls[0]?.[0]).toEqual({
      chain: "all",
      limit: 50,
    });
    expect(screen.getByText("当前链：全部记录（所有链）")).toBeInTheDocument();
    expect(screen.getByText("邵昱宇")).toBeInTheDocument();
    expect(screen.getByText("对象：用户 Bob")).toBeInTheDocument();
    expect(screen.getByText("第 12 条 · 系统链")).toBeInTheDocument();
    expect(screen.queryByText("加载更多")).not.toBeInTheDocument();
  });

  it("可切回单链读取：SYSTEM 链不再携带 chain 参数", async () => {
    const getAuditLogs = vi.fn().mockResolvedValue(page([systemItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    await screen.findByText("创建用户");
    pickSelectOption("审计链", "SYSTEM 链（系统级）");

    // 缺省语义与改动前一致：不传 projectId / chain 即读 SYSTEM 链。
    await waitFor(() =>
      expect(getAuditLogs).toHaveBeenLastCalledWith(
        { limit: 50 },
        expect.anything(),
      ),
    );
    expect(screen.getByText("当前链：SYSTEM 链")).toBeInTheDocument();
  });

  it("动作候选不再列出已下线动作码，历史行仍按中文文案渲染（ADR-061）", async () => {
    const getAuditLogs = vi.fn().mockResolvedValue(page([systemItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    await screen.findByText("创建用户");
    const codes = Array.from(
      document.querySelectorAll<HTMLOptionElement>(
        "#audit-action-options option",
      ),
    ).map((option) => option.value);
    // 十个已下线动作码 + 仅测试写入的 SYSTEM_TEST 都不再是筛选候选。
    for (const retired of [
      "project.archive",
      "project.archive.request",
      "project.archive.reject",
      "module.archive",
      "module.restore",
      "feature.archive",
      "feature.restore",
      "task.archive",
      "task.unarchive",
      "AUDIT_LOG_READ",
      "SYSTEM_TEST",
    ]) {
      expect(codes).not.toContain(retired);
    }
    // 仍在产生记录的动作码必须保留。
    expect(codes).toContain("project.create");
    expect(codes).toContain("task.create");
    expect(codes).toContain("project.purge");
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

  it("把 project.purge 显示为中文动作，不泄露原始码（ADR-051 中文化）", async () => {
    const getAuditLogs = vi.fn().mockResolvedValue(page([purgeItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    expect(await screen.findByText("彻底删除项目")).toBeInTheDocument();
    expect(screen.queryByText("project.purge")).not.toBeInTheDocument();
  });

  it("renders historical AUDIT_LOG_READ rows as ordinary rows（ADR-060）", async () => {
    const getAuditLogs = vi
      .fn()
      .mockResolvedValue(page([historicalReadTrailItem, systemItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    // 读取留痕已下线：历史行照常渲染，页面上不再有隐藏开关与隐藏计数。
    expect(await screen.findByText("读取审计日志")).toBeInTheDocument();
    expect(screen.getByText("创建用户")).toBeInTheDocument();
    expect(screen.queryByLabelText("隐藏读取留痕")).not.toBeInTheDocument();
    expect(screen.queryByText(/本页已隐藏/)).not.toBeInTheDocument();
    expect(screen.queryByText("显示读取留痕")).not.toBeInTheDocument();
    expect(getAuditLogs.mock.calls[0]?.[0]).toEqual({
      chain: "all",
      limit: 50,
    });
  });

  it("switches to a project chain and sends the project scope", async () => {
    const getAuditLogs = vi.fn().mockResolvedValue(page([projectItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);

    await screen.findByText("更新项目");
    pickSelectOption("审计链", "PROJECT:" + project.id + " · " + project.name);

    // 切换审计对象只影响查询参数，不再产生任何留痕语义（ADR-060）。
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

  it("已删除项目的审计链仍可选中，并把项目名还原出来（ADR-050）", async () => {
    const deletedChainItem: AuditLogItem = {
      ...projectItem,
      chainId: "PROJECT:41",
      projectId: 41,
      sequenceNo: 9,
      action: "project.delete",
    };
    const getAuditLogs = vi.fn().mockResolvedValue(page([deletedChainItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount(
      withUserDirectory({
        getAuditLogs,
        listProjects,
        listProjectDeletions: vi.fn().mockResolvedValue({
          items: [
            {
              projectId: 41,
              code: "OLD",
              name: "旧版交付平台",
              deletedAt: "2026-09-28T06:30:00.000000Z",
              deletedBy: { id: 2, name: "Bob" },
            },
          ],
          nextCursor: null,
          hasMore: false,
        }),
      } as unknown as InpulseApiClient),
    );

    // 历史行直接命中已删除项目：没有台账就会退化成「项目 #41」。
    expect(
      await screen.findByText("第 9 条 · 项目 旧版交付平台"),
    ).toBeInTheDocument();
    expect(screen.queryByText("第 9 条 · 项目 #41")).not.toBeInTheDocument();

    // 下拉里补回这条已删除项目的审计链，并标明是谁删的。
    const trigger = screen.getByLabelText("审计链").closest(".ant-select");
    if (!trigger) {
      throw new Error("审计链 select trigger not found");
    }
    fireEvent.mouseDown(trigger);
    expect(await screen.findByText("已删除 · Bob 删除")).toBeInTheDocument();
    fireEvent.click(screen.getByTitle("PROJECT:41 · 旧版交付平台"));

    await waitFor(() =>
      expect(getAuditLogs).toHaveBeenLastCalledWith(
        { projectId: 41, limit: 50 },
        expect.anything(),
      ),
    );
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
    pickSelectOption("操作人", "邵昱宇");
    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: "2026-09-01T08:00" },
    });
    expect(getAuditLogs).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    await waitFor(() =>
      expect(getAuditLogs).toHaveBeenLastCalledWith(
        expect.objectContaining({
          action: "project.update",
          actorIds: [1],
          // 表单里填的 08:00 是北京时间，落到 UTC 是前一天 00:00。
          from: "2026-09-01T00:00:00.000Z",
        }),
        expect.anything(),
      ),
    );
  });

  it("rejects an inverted time range before calling the server", async () => {
    const getAuditLogs = vi.fn().mockResolvedValue(page([systemItem]));
    const listProjects = vi.fn().mockResolvedValue({ items: [project] });
    mount({ getAuditLogs, listProjects } as unknown as InpulseApiClient);
    await screen.findByText("创建用户");

    fireEvent.change(screen.getByLabelText("开始时间"), {
      target: { value: "2026-09-02T08:00" },
    });
    fireEvent.change(screen.getByLabelText("结束时间"), {
      target: { value: "2026-09-01T08:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "查询" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "开始时间必须早于结束时间",
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
      screen.getByText("审计日志不允许删除；原始快照仅系统管理员可见。"),
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
        { chain: "all", cursor: "cursor-1", limit: 50 },
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
