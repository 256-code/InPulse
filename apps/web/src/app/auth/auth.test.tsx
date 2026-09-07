import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AuthStateProvider } from "./auth-context";
import { RequireAuth, RequireAdmin } from "./auth-guard";

describe("RequireAuth & RequireAdmin", () => {
  const ProtectedComponent: React.FC = () => <div>Protected Content</div>;

  it("shows loading indicator when auth status is loading", () => {
    render(
      <AuthStateProvider value={{ status: "loading", user: null }}>
        <RequireAuth>
          <ProtectedComponent />
        </RequireAuth>
      </AuthStateProvider>,
    );

    expect(screen.getByTestId("auth-loading")).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("shows login prompt when auth status is anonymous", () => {
    render(
      <AuthStateProvider value={{ status: "anonymous", user: null }}>
        <RequireAuth>
          <ProtectedComponent />
        </RequireAuth>
      </AuthStateProvider>,
    );

    expect(screen.getByTestId("auth-anonymous")).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("renders protected content when user is authenticated", () => {
    render(
      <AuthStateProvider
        value={{
          status: "authenticated",
          user: { id: 1, username: "test", isSystemAdmin: false },
        }}
      >
        <RequireAuth>
          <ProtectedComponent />
        </RequireAuth>
      </AuthStateProvider>,
    );

    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });

  it("blocks non-admin user from admin area", () => {
    render(
      <AuthStateProvider
        value={{
          status: "authenticated",
          user: { id: 2, username: "user", isSystemAdmin: false },
        }}
      >
        <RequireAdmin>
          <ProtectedComponent />
        </RequireAdmin>
      </AuthStateProvider>,
    );

    expect(screen.getByTestId("admin-forbidden")).toBeInTheDocument();
    expect(screen.queryByText("Protected Content")).not.toBeInTheDocument();
  });

  it("allows admin user to access admin area", () => {
    render(
      <AuthStateProvider
        value={{
          status: "authenticated",
          user: { id: 3, username: "admin", isSystemAdmin: true },
        }}
      >
        <RequireAdmin>
          <ProtectedComponent />
        </RequireAdmin>
      </AuthStateProvider>,
    );

    expect(screen.getByText("Protected Content")).toBeInTheDocument();
  });
});
