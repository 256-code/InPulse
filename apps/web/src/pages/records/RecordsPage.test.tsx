import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import RecordsPage from "./RecordsPage";

vi.mock("@features/records/RecordsWorkspace", () => ({
  RecordsWorkspace: () => <p>记录工作区内容</p>,
}));

describe("RecordsPage", () => {
  it("renders the single-page records workspace", () => {
    const { container } = render(<RecordsPage />);
    expect(screen.getByText("记录工作区内容")).toBeInTheDocument();
    expect(container.querySelector(".records-page")).not.toBeNull();
  });
});
