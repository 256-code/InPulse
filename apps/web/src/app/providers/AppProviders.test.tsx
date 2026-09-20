import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  ApiError,
  type CurrentUserResponse,
  type InpulseApiClient,
} from "@generated/api";
import { useAuth } from "@features/auth/auth-context";
import { RequireAuth } from "../auth/auth-guard";
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
