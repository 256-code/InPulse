import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  type CurrentUserResponse,
  type InpulseApiClient,
  type LeftoverItemPage,
  type MyTaskPage,
} from "@generated/api";
import { useAuth } from "@features/auth/auth-context";
import { invalidateShellCounters } from "@shared/api/shell-counters";
import { RequireAuth } from "../auth/auth-guard";
import { useShellCounters } from "../layout/shell-data";
import { AppProviders, getCspNonce } from "./AppProviders";

const NONCE = "0123456789abcdef0123456789abcdef";

function appendNonceMeta(nonce: string): void {
  const meta = document.createElement("meta");
  meta.setAttribute("property", "csp-nonce");
  meta.setAttribute("nonce", nonce);
  document.head.appendChild(meta);
}

afterEach(() => {
  for (const meta of document.querySelectorAll('meta[property="csp-nonce"]')) {
    meta.remove();
  }
});

describe("getCspNonce", () => {
  it("reads the per-response nonce injected by Vite or Nginx", () => {
    appendNonceMeta(NONCE);
    expect(getCspNonce()).toBe(NONCE);
  });

  it("returns undefined when the bootstrap meta tag is absent", () => {
    expect(getCspNonce()).toBeUndefined();
  });
});

const currentUser: CurrentUserResponse = {
  id: 1,
  loginName: "developer",
  name: "开发者 C",
  email: null,
  avatarUrl: null,
  isAdmin: false,
  status: "ACTIVE",
};

function apiError(status: number): ApiError {
  return new ApiError(status, {
    code: "ERROR",
    message: "请求失败",
    details: {},
    requestId: "request-id",
  });
}

/**
 * 会话过期后受保护请求返回 401：等认证态确认后再发请求，模拟页面进入后
 * 才拿到 401 的真实时序。
 */
function ExpiredSessionProbe(): React.ReactElement {
  const { status } = useAuth();
  useQuery({
    queryKey: ["expired-session-probe"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: () => Promise.reject(apiError(401)),
  });
  return <div>项目页内容</div>;
}

function ForbiddenProbe(): React.ReactElement {
  const { status } = useAuth();
  useQuery({
    queryKey: ["forbidden-probe"],
    enabled: status === "authenticated",
    retry: false,
    queryFn: () => Promise.reject(apiError(403)),
  });
  return <div>项目页内容</div>;
}

function LoginRouteProbe(): React.ReactElement {
  const location = useLocation();
  return (
    <div>
      <span>登录页</span>
      <span data-testid="login-search">{location.search}</span>
    </div>
  );
}

function renderProtected(probe: React.ReactElement): void {
  const client = {
    getCurrentUser: vi.fn().mockResolvedValue(currentUser),
  } as unknown as InpulseApiClient;
  render(
    <AppProviders authClient={client}>
      <MemoryRouter initialEntries={["/projects/7"]}>
        <Routes>
          <Route
            path="/projects/7"
            element={<RequireAuth>{probe}</RequireAuth>}
          />
          <Route path="/login" element={<LoginRouteProbe />} />
        </Routes>
      </MemoryRouter>
    </AppProviders>,
  );
}

describe("会话失效恢复（ADR-032）", () => {
  it("已认证会话下的 401 收敛为匿名并跳到登录页，由登录页静默重走 SSO", async () => {
    renderProtected(<ExpiredSessionProbe />);

    expect(await screen.findByText("登录页")).toBeInTheDocument();
    expect(screen.getByTestId("login-search")).toHaveTextContent(
      "?from=%2Fprojects%2F7",
    );
    expect(screen.queryByText("项目页内容")).not.toBeInTheDocument();
  });

  it("403 等非 401 错误保持页面原样，不把用户赶去重新登录", async () => {
    renderProtected(<ForbiddenProbe />);

    expect(await screen.findByText("项目页内容")).toBeInTheDocument();
    expect(screen.queryByText("登录页")).not.toBeInTheDocument();
  });
});

/**
 * 侧栏导航计数（任务中心未完成 / 遗留问题未闭环）是服务端聚合的派生值：
 * 写操作成功后必须重新取数，否则新建 / 完成任务、发布记录产生遗留项、
 * 遗留问题转任务后，数字要刷新页面才更新（2026-09-22 修）。
 */
describe("侧栏计数随写操作更新", () => {
  function shellClientFixture() {
    const listMyTasks = vi
      .fn<() => Promise<MyTaskPage>>()
      .mockResolvedValue({ stats: { myOpen: 3 } } as MyTaskPage);
    const listLeftoverItems = vi
      .fn<() => Promise<LeftoverItemPage>>()
      .mockResolvedValue({ items: [], nextCursor: null, hasMore: false });
    return {
      listMyTasks,
      listLeftoverItems,
      client: { listMyTasks, listLeftoverItems } as unknown as InpulseApiClient,
    };
  }

  it("写操作成功后重新取数，无需刷新页面", async () => {
    const { client, listMyTasks, listLeftoverItems } = shellClientFixture();

    function ShellCounterProbe(): React.ReactElement {
      const counters = useShellCounters({ client });
      const write = useMutation({ mutationFn: () => Promise.resolve(null) });
      return (
        <>
          <span data-testid="shell-counters">
            {counters.myOpenTaskCount ?? "-"}
          </span>
          <button type="button" onClick={() => write.mutate()}>
            写操作
          </button>
        </>
      );
    }

    renderProtected(<ShellCounterProbe />);
    const write = await screen.findByRole("button", { name: "写操作" });
    await waitFor(() => expect(listMyTasks).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listLeftoverItems).toHaveBeenCalledTimes(1));

    fireEvent.click(write);

    // 侧栏计数带 60 秒 staleTime：只有写成功后失效它才会重新取数。
    await waitFor(() => expect(listMyTasks).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listLeftoverItems).toHaveBeenCalledTimes(2));
  });

  // 部分写操作在组件里直接调用生成客户端后自行失效查询键（不经过 mutation），
  // 它们共用同一个失效入口，键前缀与服务端取数方必须保持一致。
  it("直接调用生成客户端的写路径使用同一失效入口", async () => {
    const { client, listMyTasks, listLeftoverItems } = shellClientFixture();

    function DirectWriteProbe(): React.ReactElement {
      const counters = useShellCounters({ client });
      const cache = useQueryClient();
      return (
        <>
          <span data-testid="shell-counters">
            {counters.myOpenTaskCount ?? "-"}
          </span>
          <button
            type="button"
            onClick={() => void invalidateShellCounters(cache)}
          >
            直接写
          </button>
        </>
      );
    }

    renderProtected(<DirectWriteProbe />);
    const write = await screen.findByRole("button", { name: "直接写" });
    await waitFor(() => expect(listMyTasks).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listLeftoverItems).toHaveBeenCalledTimes(1));

    fireEvent.click(write);

    await waitFor(() => expect(listMyTasks).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listLeftoverItems).toHaveBeenCalledTimes(2));
  });
});
