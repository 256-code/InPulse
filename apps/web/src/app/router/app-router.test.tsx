import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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

    expect(screen.getByText("InPulse")).toBeInTheDocument();
    expect(await screen.findByText("F-30 视觉壳")).toBeInTheDocument();
  });
});
