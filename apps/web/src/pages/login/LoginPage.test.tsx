import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  AuthStateProvider,
  type AuthStatus,
} from "@features/auth/auth-context";
import { LoginPage } from "./LoginPage";

const originalLocation = window.location;

function CurrentLocationProbe() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
    </span>
  );
}

function renderLoginPage(
  search: string,
  status: AuthStatus = "anonymous",
): void {
  render(
    <MemoryRouter initialEntries={["/login" + search]}>
      <AuthStateProvider
        value={{
          status,
          user: null,
          errorMessage: "无法确认登录状态，请刷新页面后重试。",
        }}
      >
        <CurrentLocationProbe />
        <LoginPage />
      </AuthStateProvider>
    </MemoryRouter>,
  );
}

describe("LoginPage 登录入口（ADR-080 直达单点登录）", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: {
        href: originalLocation.href,
        origin: originalLocation.origin,
        assign: vi.fn(),
        replace: vi.fn(),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: originalLocation,
    });
  });

  it("匿名访问默认整页跳转统一身份认证并携带原始目标", () => {
    renderLoginPage("?from=%2Fprojects%2F7");

    expect(window.location.replace).toHaveBeenCalledWith(
      "/api/v1/auth/sso/start?returnTo=%2Fprojects%2F7",
    );
    expect(screen.getByTestId("login-transition")).toBeInTheDocument();
    expect(screen.getByText("正在跳转到统一身份认证…")).toBeInTheDocument();
    expect(screen.queryByLabelText("登录名")).toBeNull();
  });

  it("缺少 from 时默认回到站点根路径", () => {
    renderLoginPage("");

    expect(window.location.replace).toHaveBeenCalledWith(
      "/api/v1/auth/sso/start?returnTo=%2F",
    );
  });

  it("登录状态未知时先展示加载态且不自动跳转", () => {
    renderLoginPage("", "loading");

    expect(window.location.replace).not.toHaveBeenCalled();
    expect(screen.getByText("正在确认登录状态…")).toBeInTheDocument();
    expect(screen.queryByLabelText("登录名")).toBeNull();
  });

  it("local=1 渲染本地应急口令表单且不自动跳转", () => {
    renderLoginPage("?local=1&from=%2Fprojects");

    expect(window.location.replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("登录名")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "使用统一身份认证登录" }),
    ).toBeNull();
  });

  it("sso=disabled 回落显示未启用提示与本地表单且不自动跳转", () => {
    renderLoginPage("?local=1&sso=disabled&from=%2Fprojects");

    expect(window.location.replace).not.toHaveBeenCalled();
    expect(screen.getByText(/统一身份认证未启用/)).toBeInTheDocument();
    expect(screen.getByLabelText("登录名")).toBeInTheDocument();
  });

  it("sso_error 回落只显示错误与手动重试，点击后才重新发起 SSO", () => {
    renderLoginPage("?sso_error=account-conflict");

    expect(window.location.replace).not.toHaveBeenCalled();
    expect(screen.getByText(/冲突/)).toBeInTheDocument();
    expect(screen.queryByLabelText("登录名")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "重新登录" }));

    expect(window.location.replace).toHaveBeenCalledWith(
      "/api/v1/auth/sso/start?returnTo=%2F",
    );
  });

  it("已登录时回到原始目标且不跳转单点登录", async () => {
    renderLoginPage("?from=%2Fprojects", "authenticated");

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/projects");
    });
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it("登录状态异常时展示错误与手动重试且不自动跳转", () => {
    renderLoginPage("", "error");

    expect(window.location.replace).not.toHaveBeenCalled();
    expect(
      screen.getByText("无法确认登录状态，请刷新页面后重试。"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "重新登录" }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("登录名")).toBeNull();
  });
});
