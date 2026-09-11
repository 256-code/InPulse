import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import RecordsPage from "./RecordsPage";

vi.mock("@features/record-drafts/RecordDraftsView", () => ({
  RecordDraftsView: () => <p>草稿视图内容</p>,
}));
vi.mock("@features/published-records/PublishedRecordsView", () => ({
  PublishedRecordsView: () => <p>已发布视图内容</p>,
}));

const renderPage = (entries: string) =>
  render(
    <MemoryRouter initialEntries={[entries]}>
      <RecordsPage />
    </MemoryRouter>,
  );

describe("RecordsPage", () => {
  it("renders the iteration record page header from the designer draft", () => {
    renderPage("/records?projectId=1");
    expect(screen.getByText("研发记录")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "迭代记录" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "只记录已经发生或已确认的变化。人员、时间、归属与版本全部自动生成。",
      ),
    ).toBeInTheDocument();
  });

  it("shows the draft view by default and marks it as selected", () => {
    renderPage("/records?projectId=1");
    expect(screen.getByText("草稿视图内容")).toBeInTheDocument();
    expect(
      within(screen.getByRole("group", { name: "记录视图" })).getByRole(
        "button",
        { name: "草稿" },
      ),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("switches between the draft and published record views without leaving the page", async () => {
    const user = userEvent.setup();
    renderPage("/records?projectId=1");
    const group = screen.getByRole("group", { name: "记录视图" });
    await user.click(within(group).getByRole("button", { name: "已发布记录" }));
    expect(screen.getByText("已发布视图内容")).toBeInTheDocument();
    expect(
      within(group).getByRole("button", { name: "已发布记录" }),
    ).toHaveAttribute("aria-pressed", "true");
    await user.click(within(group).getByRole("button", { name: "草稿" }));
    expect(screen.getByText("草稿视图内容")).toBeInTheDocument();
  });

  it("keeps the published view when the url already selects it", () => {
    renderPage("/records?view=published&projectId=1");
    expect(screen.getByText("已发布视图内容")).toBeInTheDocument();
    expect(screen.queryByText("草稿视图内容")).not.toBeInTheDocument();
  });
});
