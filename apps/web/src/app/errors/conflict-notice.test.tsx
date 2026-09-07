import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConflictNotice } from "./ConflictNotice";

describe("ConflictNotice", () => {
  it("renders conflict warning with default message", () => {
    render(<ConflictNotice />);
    expect(screen.getByTestId("conflict-notice")).toBeInTheDocument();
    expect(screen.getByText("数据冲突（409 Conflict）")).toBeInTheDocument();
    expect(screen.getByText(/为防止数据覆盖/)).toBeInTheDocument();
  });

  it("calls onReload callback when reload button is clicked", () => {
    const handleReload = vi.fn();
    render(<ConflictNotice onReload={handleReload} />);

    const reloadBtn = screen.getByRole("button", { name: "重新加载最新数据" });
    expect(reloadBtn).toBeInTheDocument();

    fireEvent.click(reloadBtn);
    expect(handleReload).toHaveBeenCalledTimes(1);
  });
});
