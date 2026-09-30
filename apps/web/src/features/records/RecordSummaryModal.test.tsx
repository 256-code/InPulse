import React from "react";
import { ConfigProvider } from "antd";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  CurrentUserResponse,
  InpulseApiClient,
  ReadableRecord,
  RecordSummaryResponse,
} from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";
import { RecordSummaryModal } from "./RecordSummaryModal";

/**
 * F-33 总结弹窗明细的可展开行：整个横向区域可点，展开区复用正式记录详情的只读
 * 形态——补的是记录正文（改动原因 / 具体改动 / 改动效果）与遗留问题，而要点里的
 * 效果句是被服务端折叠并截断到 1000 字的摘要。
 *
 * 只读断言是这批的核心：总结是核对取数用的只读视图，展开不得带出不可变版本、
 * GitHub 关联与修订 / 作废入口，否则会把写动作搬进总结弹窗。
 */

const admin: CurrentUserResponse = {
  id: 1,
  loginName: "dev-a",
  name: "管理员",
  email: null,
  avatarUrl: null,
  isAdmin: true,
  status: "ACTIVE",
};

/** 要点句与正文四段刻意用不同文本，避免断言撞到明细行里已经渲染的事实。 */
const record: ReadableRecord = {
  id: 7,
  projectId: 1,
  moduleId: 2,
  featureId: null,
  scopeType: "MODULE",
  taskId: null,
  impactFeatureIds: [],
  handlerId: 1,
  authorId: 1,
  status: "PUBLISHED",
  code: "SHOP-CR-1",
  currentVersion: 1,
  publishedAt: "2026-09-21T02:00:00.000Z",
  rowVersion: 2,
  createdAt: "2026-09-21T02:00:00.000Z",
  updatedAt: "2026-09-21T02:00:00.000Z",
  title: "支付修正",
  contextProblem: "改动原因正文",
  changeSolution: "具体改动正文",
  resultVerification: "改动效果正文",
  remainingIssues: [],
  leftovers: [
    {
      id: 31,
      content: "遗留问题正文",
      status: "ACTIVE",
      rowVersion: 1,
      linkedTaskId: null,
    },
  ],
};

const summary: RecordSummaryResponse = {
  generatedAt: "2026-09-29T02:00:00.000Z",
  range: { from: "2026-01-01", to: "2026-12-31" },
  groupBy: "PROJECT",
  scope: { projectIds: [1], projectNames: ["支付项目"], member: null },
  totals: {
    projectCount: 1,
    moduleCount: 1,
    featureCount: 0,
    recordCount: 1,
    completedTaskCount: 0,
    missingRecordTaskCount: 0,
    leftoverCount: 1,
    closedLeftoverCount: 0,
  },
  sections: [
    {
      key: "1",
      projectId: 1,
      member: null,
      recordCount: 1,
      completedTaskCount: 0,
    },
  ],
  points: [
    {
      recordId: 7,
      recordCode: "SHOP-CR-1",
      projectId: 1,
      projectName: "支付项目",
      moduleId: 2,
      moduleName: "支付模块",
      featureId: null,
      featureName: null,
      title: "支付修正",
      detail: "要点句",
      author: { userId: 1, name: "管理员", avatarUrl: null },
      publishedAt: "2026-09-21T02:00:00.000Z",
      taskId: null,
      taskCode: null,
    },
  ],
  leftovers: [],
  gaps: [],
  truncated: false,
};

/**
 * 只读展开没有列表语境，名称由正式记录详情自己解析（与聚合组记录弹窗同一路径），
 * 因此这里要把项目详情、模块 / 功能清单与用户目录一并桩掉。
 */
function baseClient() {
  return {
    getRecordSummary: vi.fn().mockResolvedValue(summary),
    getChangeRecord: vi.fn().mockResolvedValue(record),
    listChangeRecordVersions: vi.fn().mockResolvedValue({ items: [] }),
    getProject: vi.fn().mockResolvedValue({
      project: { id: 1, name: "支付项目", status: "ACTIVE" },
    }),
    listModules: vi.fn().mockResolvedValue({
      items: [{ id: 2, projectId: 1, name: "支付模块" }],
    }),
    listFeatures: vi.fn().mockResolvedValue({ items: [] }),
    getUserDirectory: vi.fn().mockResolvedValue({
      items: [{ id: 1, name: "管理员", avatarUrl: null, isAdmin: true }],
    }),
  };
}

function mount(client: InpulseApiClient) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AuthStateProvider value={{ status: "authenticated", user: admin }}>
        <MemoryRouter initialEntries={["/records"]}>
          <QueryClientProvider
            client={
              new QueryClient({ defaultOptions: { queries: { retry: false } } })
            }
          >
            <RecordSummaryModal
              open
              onClose={() => undefined}
              client={client}
              defaultProjectId={0}
              projects={[]}
            />
          </QueryClientProvider>
        </MemoryRouter>
      </AuthStateProvider>
    </ConfigProvider>,
  );
}

const signalInit = expect.objectContaining({ signal: expect.any(AbortSignal) });

/** 取数完成前底栏按钮是禁用的（disabled={data === undefined}），先等它可用再点。 */
async function openDetail() {
  const toggle = await screen.findByRole("button", { name: "查看明细" });
  await waitFor(() => expect(toggle).toBeEnabled());
  fireEvent.click(toggle);
  // 进入明细后底栏按钮改成「返回总结」，以此确认模式已切换。
  await screen.findByRole("button", { name: "返回总结" });
  // 弹层刚打开时 rc-dialog 会短暂隐藏外层；用 waitFor 等它稳定，避免断言撞上过渡帧。
  await waitFor(() =>
    expect(screen.getByText("要点句", { selector: "small" })).toBeVisible(),
  );
}

describe("RecordSummaryModal 明细展开", () => {
  it("点行内任意位置就地展开记录正文与遗留问题，且不出现任何写入入口", async () => {
    const client = baseClient();
    mount(client as unknown as InpulseApiClient);
    await openDetail();
    // 默认收起：正文与遗留问题都不在页面上，也没有为任何一条记录发详情请求。
    expect(screen.queryByText("改动原因正文")).not.toBeInTheDocument();
    expect(screen.queryByText("遗留问题正文")).not.toBeInTheDocument();
    expect(client.getChangeRecord).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("要点句", { selector: "small" }), {
      bubbles: true,
    });

    expect(await screen.findByText("改动原因正文")).toBeVisible();
    expect(screen.getByText("具体改动正文")).toBeVisible();
    expect(screen.getByText("改动效果正文")).toBeVisible();
    expect(screen.getByText("遗留问题正文")).toBeVisible();
    expect(screen.getByText("未闭环")).toBeVisible();
    expect(client.getChangeRecord).toHaveBeenCalledWith(1, 7, signalInit);
    // 只读形态：不可变版本、GitHub 关联、修订与作废入口都不渲染、不发请求。
    expect(client.listChangeRecordVersions).not.toHaveBeenCalled();
    expect(screen.queryByText("GitHub 关联")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "修订内容" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "作废记录" }),
    ).not.toBeInTheDocument();
  });

  it("首列箭头同步展开态，再点一次收起并卸载展开区", async () => {
    const client = baseClient();
    mount(client as unknown as InpulseApiClient);
    await openDetail();
    const arrow = screen.getByRole("button", {
      name: "展开 SHOP-CR-1 的详细内容",
    });
    expect(arrow).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(arrow);
    expect(
      await screen.findByRole("button", { name: "收起 SHOP-CR-1 的详细内容" }),
    ).toHaveAttribute("aria-expanded", "true");
    // 展开态立刻生效，正文要等详情请求回来。
    expect(await screen.findByText("改动原因正文")).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "收起 SHOP-CR-1 的详细内容" }),
    );
    await waitFor(() =>
      expect(screen.queryByText("改动原因正文")).not.toBeInTheDocument(),
    );
    expect(
      screen.getByRole("button", { name: "展开 SHOP-CR-1 的详细内容" }),
    ).toHaveAttribute("aria-expanded", "false");
  });
});
