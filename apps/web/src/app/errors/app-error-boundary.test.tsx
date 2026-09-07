import React, { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppErrorBoundary } from "./AppErrorBoundary";

describe("AppErrorBoundary", () => {
  const ThrowError: React.FC<{ shouldThrow?: boolean }> = ({
    shouldThrow = true,
  }) => {
    if (shouldThrow) {
      throw new Error("Simulated UI Crash");
    }
    return <div>Normal Content</div>;
  };

  it("renders children when no error is thrown", () => {
    render(
      <AppErrorBoundary>
        <div>Normal Content</div>
      </AppErrorBoundary>,
    );

    expect(screen.getByText("Normal Content")).toBeInTheDocument();
  });

  it("renders fallback UI when child throws", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <AppErrorBoundary>
        <ThrowError />
      </AppErrorBoundary>,
    );

    expect(screen.getByTestId("app-error-boundary")).toBeInTheDocument();
    expect(screen.getByText("Simulated UI Crash")).toBeInTheDocument();

    spy.mockRestore();
  });

  it("allows resetting error state on retry", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const TestParent: React.FC = () => {
      const [shouldThrow, setShouldThrow] = useState(true);
      return (
        <div>
          <button onClick={() => setShouldThrow(false)}>Fix Error</button>
          <AppErrorBoundary>
            <ThrowError shouldThrow={shouldThrow} />
          </AppErrorBoundary>
        </div>
      );
    };

    render(<TestParent />);
    expect(screen.getByTestId("app-error-boundary")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Fix Error"));
    fireEvent.click(screen.getByText("重新加载页面"));

    expect(screen.getByText("Normal Content")).toBeInTheDocument();

    spy.mockRestore();
  });
});
