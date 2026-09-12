import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { AuthStateProvider } from "@features/auth/auth-context";
import { RequireAuth, RequireAdmin, buildLoginRedirect } from "./auth-guard";

function LoginRouteProbe() {
  const location = useLocation();
  return (
    <div>
      <span>Login Page</span>
      <span data-testid="login-search">{location.search}</span>
    </div>
  );
}

describe("RequireAuth & RequireAdmin", () => {
  const ProtectedComponent: React.FC = () => <div>Protected Content</div>;

  it("shows loading indicator when auth status is loading", () => {
    render(
      <MemoryRouter initialEntries={["/protected"]}>
        <AuthStateProvider value={{ status: "loading", user: null }}>
          <RequireAuth>
            <ProtectedComponent />
          </RequireAuth>
        </AuthStateProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("auth-loading")).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("redirects anonymous visitors to the login page with the original target", () => {
    render(
      <MemoryRouter initialEntries={["/projects/7?tab=1"]}>
        <AuthStateProvider value={{ status: "anonymous", user: null }}>
          <Routes>
            <Route
              path="*"
              element={
                <RequireAuth>
                  <ProtectedComponent />
                </RequireAuth>
              }
            />
            <Route path="/login" element={<LoginRouteProbe />} />
          </Routes>
        </AuthStateProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Login Page")).toBeInTheDocument();
    expect(screen.getByTestId("login-search")).toHaveTextContent(
      "?from=%2Fprojects%2F7%3Ftab%3D1",
    );
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("never redirects back to the login route itself", () => {
    expect(buildLoginRedirect("/login", "")).toBe("/login");
    expect(buildLoginRedirect("/", "")).toBe("/login?from=%2F");
    expect(buildLoginRedirect("//evil.example.com", "")).toBe("/login");
  });

  it("shows an auth error state without rendering protected content", () => {
    render(
      <MemoryRouter initialEntries={["/protected"]}>
        <AuthStateProvider
          value={{
            status: "error",
            user: null,
            errorMessage: "无法确认登录状态，请稍后重试。",
          }}
        >
          <RequireAuth>
            <ProtectedComponent />
          </RequireAuth>
        </AuthStateProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("auth-anonymous")).toBeInTheDocument();
    expect(screen.getByText("登录状态异常")).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("renders protected content when user is authenticated", () => {
    render(
      <MemoryRouter initialEntries={["/protected"]}>
        <AuthStateProvider
          value={{
            status: "authenticated",
            user: {
              id: 1,
              loginName: "test",
              name: "测试用户",
              email: null,
              avatarUrl: null,
              isAdmin: false,
              status: "ACTIVE",
            },
          }}
        >
          <RequireAuth>
            <ProtectedComponent />
          </RequireAuth>
        </AuthStateProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });

  it("blocks non-admin user from admin area", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <AuthStateProvider
          value={{
            status: "authenticated",
            user: {
              id: 2,
              loginName: "user",
              name: "普通用户",
              email: null,
              avatarUrl: null,
              isAdmin: false,
              status: "ACTIVE",
            },
          }}
        >
          <RequireAdmin>
            <ProtectedComponent />
          </RequireAdmin>
        </AuthStateProvider>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("admin-forbidden")).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("allows admin user to access admin area", () => {
    render(
      <MemoryRouter initialEntries={["/settings"]}>
        <AuthStateProvider
          value={{
            status: "authenticated",
            user: {
              id: 3,
              loginName: "admin",
              name: "管理员",
              email: null,
              avatarUrl: null,
              isAdmin: true,
              status: "ACTIVE",
            },
          }}
        >
          <RequireAdmin>
            <ProtectedComponent />
          </RequireAdmin>
        </AuthStateProvider>
      </MemoryRouter>,
    );

    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });
});
