import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { InpulseApiClient } from "@generated/api";
import { AppProviders } from "../providers/AppProviders";
import { AppErrorBoundary } from "../errors/AppErrorBoundary";
import { AppRouter } from "./AppRouter";

describe("AppRouter integration", () => {
  it("mounts AppRouter inside AppProviders and AppErrorBoundary", async () => {
    const authClient = {
      getCurrentUser: vi.fn().mockResolvedValue({
        id: 1,
        loginName: "developer",
        name: "开发者 C",
        email: null,
        avatarUrl: null,
        isAdmin: false,
        status: "ACTIVE",
      }),
    } as unknown as InpulseApiClient;

    render(
      <AppErrorBoundary>
        <AppProviders authClient={authClient}>
          <AppRouter />
        </AppProviders>
      </AppErrorBoundary>,
    );

    expect(
      screen.getByRole("img", { name: "Libiao Robotics | InPulse" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "任务中心" }),
    ).toBeInTheDocument();
  });

  it("redirects the merged project overview address to the project modules page", async () => {
    const authClient = {
      getCurrentUser: vi.fn().mockResolvedValue({
        id: 1,
        loginName: "developer",
        name: "开发者 C",
        email: null,
        avatarUrl: null,
        isAdmin: false,
        status: "ACTIVE",
      }),
    } as unknown as InpulseApiClient;

    // 项目概览已与「模块与功能」合并：旧地址不应再停留在 /overview。
    window.history.pushState({}, "", "/projects/7/overview");
    try {
      render(
        <AppErrorBoundary>
          <AppProviders authClient={authClient}>
            <AppRouter />
          </AppProviders>
        </AppErrorBoundary>,
      );

      await waitFor(() =>
        expect(window.location.pathname).toBe("/projects/7/modules"),
      );
    } finally {
      window.history.pushState({}, "", "/");
    }
  });

  it("keeps the app shell and renders the branded 404 for unknown paths", async () => {
    const authClient = {
      getCurrentUser: vi.fn().mockResolvedValue({
        id: 1,
        loginName: "developer",
        name: "开发者 C",
        email: null,
        avatarUrl: null,
        isAdmin: false,
        status: "ACTIVE",
      }),
    } as unknown as InpulseApiClient;

    window.history.pushState({}, "", "/definitely-not-a-route");
    try {
      render(
        <AppErrorBoundary>
          <AppProviders authClient={authClient}>
            <AppRouter />
          </AppProviders>
        </AppErrorBoundary>,
      );

      expect(await screen.findByTestId("route-not-found")).toBeInTheDocument();
      expect(
        screen.getByRole("img", { name: "Libiao Robotics | InPulse" }),
      ).toBeInTheDocument();
      expect(screen.queryByText(/Hey developer/u)).not.toBeInTheDocument();
    } finally {
      window.history.pushState({}, "", "/");
    }
  });
});
