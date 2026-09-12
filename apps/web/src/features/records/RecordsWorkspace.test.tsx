import React from "react";
import { ConfigProvider } from "antd";
import { describe, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  CurrentUserResponse,
  InpulseApiClient,
  ReadableRecord,
} from "@generated/api";
import { AuthStateProvider } from "@features/auth/auth-context";
import { RecordsWorkspace } from "./RecordsWorkspace";

vi.mock("@features/record-drafts/RecordDraftsView", () => ({
  RecordDraftsView: (props: {
    readonly createToken?: number;
    readonly currentUserId?: number;
    readonly onCanCreateChange?: (value: boolean) => void;
  }) => {
    React.useEffect(() => {
      props.onCanCreateChange?.(true);
    }, [props.onCanCreateChange]);
    return (
      <p data-testid="drafts-block">
        草稿令牌 {props.createToken} · 当前用户 {props.currentUserId}
      </p>
    );
  },
}));

const member: CurrentUserResponse = {
  id: 3,
  loginName: "dev-c",
  name: "开发者 C",
  email: null,
  avatarUrl: null,
  isAdmin: false,
  status: "ACTIVE",
};
const admin: CurrentUserResponse = { ...member, id: 1, isAdmin: true };
const first: ReadableRecord = {
  id: 7,
  projectId: 1,
  moduleId: 2,
  featureId: null,
  scopeType: "MODULE",
  taskId: null,
  impactFeatureIds: [],
  handlerId: 3,
  authorId: 3,
  status: "PUBLISHED",
  code: "SHOP-CR-1",
  currentVersion: 2,
  publishedAt: "2026-09-10T02:00:00.000Z",
  rowVersion: 3,
  createdAt: "2026-09-10T02:00:00.000Z",
  updatedAt: "2026-09-10T02:00:00.000Z",
  title: "支付修正",
  contextProblem: "重复请求",
  changeSolution: "增加幂等",
  resultVerification: "并发通过",
  remainingIssues: "",
  leftoverItem: null,
  leftovers: [],
};
const second: ReadableRecord = {
  ...first,
  id: 8,
  code: "SHOP-CR-2",
  taskId: 9,
  title: "风控修正",
  changeSolution: "补充风控规则",
  publishedAt: "2026-09-11T02:00:00.000Z",
  createdAt: "2026-09-11T02:00:00.000Z",
  updatedAt: "2026-09-11T02:00:00.000Z",
};

function baseClient() {
  return {
    listProjects: vi.fn().mockResolvedValue({
      items: [
        { id: 1, name: "支付项目", status: "ACTIVE" },
        { id: 2, name: "风控项目", status: "ACTIVE" },
      ],
    }),
    listChangeRecords: vi.fn().mockResolvedValue({
      items: [first, second],
      nextCursor: null,
      hasMore: false,
    }),
    getChangeRecord: vi.fn().mockResolvedValue(first),
    listChangeRecordVersions: vi.fn().mockResolvedValue({ items: [] }),
  };
}

function mount(
  client: InpulseApiClient,
  path: string,
  user: CurrentUserResponse = member,
) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <AuthStateProvider value={{ status: "authenticated", user }}>
        <MemoryRouter initialEntries={[path]}>
          <QueryClientProvider
            client={
              new QueryClient({ defaultOptions: { queries: { retry: false } } })
            }
          >
            <RecordsWorkspace client={client} />
          </QueryClientProvider>
        </MemoryRouter>
      </AuthStateProvider>
    </ConfigProvider>,
  );
}

describe("RecordsWorkspace", () => {
  it("requires a project before loading records and disables the header action", async () => {
    const client = baseClient();
    mount(client as unknown as InpulseApiClient, "/records");
    expect(
      screen.getByRole("heading", { name: "迭代记录" }),
    ).toBeInTheDocument();
    expect(screen.getByText("研发记录 / 0 条")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "记录一次迭代" })).toBeDisabled();
    expect(
      await screen.findByText("请先选择项目", { selector: "strong" }),
    ).toBeVisible();
    expect(client.listChangeRecords).not.toHaveBeenCalled();
  });

  it("groups published records by publish date and opens the record from the url", async () => {
    const client = baseClient();
    const { container } = mount(
      client as unknown as InpulseApiClient,
      "/records?projectId=1&publishedId=7",
    );
    expect(await screen.findByText("支付修正")).toBeVisible();
    expect(screen.getByText("风控修正")).toBeVisible();
    expect(container.querySelectorAll(".timeline-block")).toHaveLength(2);
    expect(
      await screen.findByRole("region", { name: "正式记录详情" }),
    ).toBeVisible();
    expect(client.listChangeRecords).toHaveBeenCalledWith(
      1,
      { status: "PUBLISHED", limit: 20 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(client.getChangeRecord).toHaveBeenCalledWith(
      1,
      7,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("loads a record outside the loaded page as a standalone detail", async () => {
    const client = baseClient();
    mount(
      client as unknown as InpulseApiClient,
      "/records?projectId=1&publishedId=99",
    );
    await screen.findByText("支付修正");
    expect(
      await screen.findByRole("region", { name: "正式记录详情" }),
    ).toBeVisible();
    expect(client.getChangeRecord).toHaveBeenCalledWith(
      1,
      99,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("filters the loaded records by keyword and source without a server round trip", async () => {
    const client = baseClient();
    mount(client as unknown as InpulseApiClient, "/records?projectId=1");
    await screen.findByText("支付修正");
    const calls = client.listChangeRecords.mock.calls.length;
    fireEvent.change(screen.getByLabelText("来源"), {
      target: { value: "TASK" },
    });
    expect(screen.queryByText("支付修正")).not.toBeInTheDocument();
    expect(screen.getByText("风控修正")).toBeVisible();
    expect(
      screen.getByText(/列表筛选只在当前已加载的 2 条内生效/),
    ).toBeVisible();
    fireEvent.change(screen.getByLabelText("搜索迭代记录"), {
      target: { value: "支付" },
    });
    expect(await screen.findByText("没有匹配的迭代记录")).toBeVisible();
    expect(client.listChangeRecords.mock.calls.length).toBe(calls);
  });

  it("switches the project in the toolbar and drops the expanded record", async () => {
    const client = baseClient();
    mount(
      client as unknown as InpulseApiClient,
      "/records?projectId=1&publishedId=7",
    );
    await screen.findByRole("region", { name: "正式记录详情" });
    fireEvent.change(screen.getByLabelText("项目"), { target: { value: "2" } });
    await waitFor(() =>
      expect(client.listChangeRecords).toHaveBeenLastCalledWith(
        2,
        { status: "PUBLISHED", limit: 20 },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    expect(
      screen.queryByRole("region", { name: "正式记录详情" }),
    ).not.toBeInTheDocument();
  });

  it("offers the voided status filter to administrators only", async () => {
    const client = baseClient();
    const view = mount(
      client as unknown as InpulseApiClient,
      "/records?projectId=1",
    );
    const group = screen.getByRole("group", { name: "记录状态" });
    expect(
      within(group).queryByRole("button", { name: "已作废" }),
    ).not.toBeInTheDocument();
    view.unmount();
    const adminClient = baseClient();
    mount(
      adminClient as unknown as InpulseApiClient,
      "/records?projectId=1",
      admin,
    );
    const adminGroup = screen.getByRole("group", { name: "记录状态" });
    fireEvent.click(within(adminGroup).getByRole("button", { name: "已作废" }));
    await waitFor(() =>
      expect(adminClient.listChangeRecords).toHaveBeenLastCalledWith(
        1,
        { status: "VOID", limit: 20 },
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });

  it("loads the next record page with the server cursor", async () => {
    const client = baseClient();
    client.listChangeRecords
      .mockResolvedValueOnce({
        items: [first],
        nextCursor: "cursor-1",
        hasMore: true,
      })
      .mockResolvedValueOnce({
        items: [second],
        nextCursor: null,
        hasMore: false,
      });
    mount(client as unknown as InpulseApiClient, "/records?projectId=1");
    expect(await screen.findByText("支付修正")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "加载更多" }));
    expect(await screen.findByText("风控修正")).toBeVisible();
    expect(client.listChangeRecords).toHaveBeenLastCalledWith(
      1,
      { status: "PUBLISHED", limit: 20, cursor: "cursor-1" },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("passes the current user and an increasing create token to the draft block", async () => {
    const client = baseClient();
    mount(client as unknown as InpulseApiClient, "/records?projectId=1");
    expect(await screen.findByTestId("drafts-block")).toHaveTextContent(
      "草稿令牌 0 · 当前用户 3",
    );
    const cta = screen.getByRole("button", { name: "记录一次迭代" });
    await waitFor(() => expect(cta).toBeEnabled());
    fireEvent.click(cta);
    expect(screen.getByTestId("drafts-block")).toHaveTextContent(
      "草稿令牌 1 · 当前用户 3",
    );
  });
});
