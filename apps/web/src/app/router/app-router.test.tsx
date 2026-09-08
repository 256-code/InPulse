import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProviders } from "../providers/AppProviders";
import { AppErrorBoundary } from "../errors/AppErrorBoundary";
import { AppRouter } from "./AppRouter";

describe("AppRouter integration", () => {
  it("mounts AppRouter inside AppProviders and AppErrorBoundary", async () => {
    render(
      <AppErrorBoundary>
        <AppProviders>
          <AppRouter />
        </AppProviders>
      </AppErrorBoundary>,
    );

    expect(screen.getByText("InPulse")).toBeInTheDocument();
    expect(await screen.findByText("F-30 视觉壳")).toBeInTheDocument();
  });
});
