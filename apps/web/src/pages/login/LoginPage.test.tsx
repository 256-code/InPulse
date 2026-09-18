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

describe("LoginPage 登录入口（ADR-036）", () => {
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

  it("默认展示本地口令表单与统一身份认证入口，不再自动跳转", () => {
    renderLoginPage("?from=%2Fprojects%2F7");

    expect(window.location.replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("登录名")).toBeInTheDocument();
    expect(screen.getByLabelText("密码")).toBeInTheDocument();
    expect(screen.getByText("或以统一身份认证登录")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "使用统一身份认证登录" }),
    ).toBeInTheDocument();
  });

  it("点击统一身份认证图标入口时整页跳转并携带原始目标", () => {
    renderLoginPage("?from=%2Fprojects%2F7");

    fireEvent.click(
      screen.getByRole("button", { name: "使用统一身份认证登录" }),
    );

    expect(window.location.replace).toHaveBeenCalledWith(
      "/api/v1/auth/sso/start?returnTo=%2Fprojects%2F7",
    );
  });

  it("local=1 与默认渲染一致，同样不自动跳转", () => {
    renderLoginPage("?local=1&from=%2Fprojects");

    expect(window.location.replace).not.toHaveBeenCalled();
    expect(screen.getByLabelText("登录名")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "使用统一身份认证登录" }),
    ).toBeInTheDocument();
  });

  it("sso=disabled 时提示未启用并隐藏统一身份认证入口", () => {
    renderLoginPage("?local=1&sso=disabled");

    expect(screen.getByText(/统一身份认证未启用/)).toBeInTheDocument();
    expect(screen.getByLabelText("登录名")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "使用统一身份认证登录" }),
    ).toBeNull();
  });

  it("sso_error 时展示失败提示、保留本地表单与重试入口", () => {
    renderLoginPage("?sso_error=account-conflict&from=%2Fsearch");

    expect(window.location.replace).not.toHaveBeenCalled();
    expect(screen.getByText(/冲突/)).toBeInTheDocument();
    expect(screen.getByLabelText("登录名")).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "使用统一身份认证登录" }),
    );
    expect(window.location.replace).toHaveBeenCalledWith(
      "/api/v1/auth/sso/start?returnTo=%2Fsearch",
    );
  });

  it("已登录时回到原始目标且不跳转单点登录", async () => {
    renderLoginPage("?from=%2Fprojects", "authenticated");

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/projects");
    });
    expect(window.location.replace).not.toHaveBeenCalled();
  });

  it("登录状态异常时展示错误并保留本地入口", () => {
    renderLoginPage("", "error");

    expect(
      screen.getByText("无法确认登录状态，请刷新页面后重试。"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("登录名")).toBeInTheDocument();
  });
});
