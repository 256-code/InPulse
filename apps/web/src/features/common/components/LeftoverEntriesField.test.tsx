import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { LeftoverEntriesField } from "./LeftoverEntriesField";

const wrap = (ui: React.ReactElement) =>
  render(<ConfigProvider>{ui}</ConfigProvider>);

it("renders every entry and appends an empty one on demand", () => {
  const onChange = vi.fn();
  wrap(
    <LeftoverEntriesField
      value={[{ id: 3, content: "第一条" }, { content: "第二条" }]}
      onChange={onChange}
    />,
  );
  expect(screen.getByLabelText("遗留问题 1")).toHaveValue("第一条");
  expect(screen.getByLabelText("遗留问题 2")).toHaveValue("第二条");
  fireEvent.click(screen.getByRole("button", { name: "添加遗留问题" }));
  expect(onChange).toHaveBeenCalledWith([
    { id: 3, content: "第一条" },
    { content: "第二条" },
    { content: "" },
  ]);
});

it("edits one entry in place and removes only the clicked row", () => {
  const onChange = vi.fn();
  wrap(
    <LeftoverEntriesField
      value={[{ content: "第一条" }, { content: "第二条" }]}
      onChange={onChange}
    />,
  );
  fireEvent.change(screen.getByLabelText("遗留问题 2"), {
    target: { value: "改过的第二条" },
  });
  expect(onChange).toHaveBeenCalledWith([
    { content: "第一条" },
    { content: "改过的第二条" },
  ]);
  fireEvent.click(screen.getAllByRole("button", { name: "移除" })[0]!);
  expect(onChange).toHaveBeenCalledWith([{ content: "第二条" }]);
});

it("keeps converted entries visible without a remove action", () => {
  const onChange = vi.fn();
  wrap(
    <LeftoverEntriesField
      value={[{ id: 8, content: "已转任务" }, { content: "新问题" }]}
      onChange={onChange}
      lockedIds={[8]}
    />,
  );
  expect(screen.getByText("已转任务，保留关联")).toBeInTheDocument();
  expect(screen.getByText("已转任务")).toBeInTheDocument();
  const removes = screen.getAllByRole("button", { name: "移除" });
  expect(removes).toHaveLength(1);
  fireEvent.click(removes[0]!);
  expect(onChange).toHaveBeenCalledWith([{ id: 8, content: "已转任务" }]);
});

it("shows the empty state and stops adding at the entry limit", () => {
  const { unmount } = wrap(
    <LeftoverEntriesField value={[]} onChange={() => {}} />,
  );
  expect(screen.getByText("暂无遗留问题。")).toBeInTheDocument();
  unmount();
  wrap(
    <LeftoverEntriesField
      value={Array.from({ length: 50 }, () => ({ content: "x" }))}
      onChange={() => {}}
    />,
  );
  expect(screen.getByRole("button", { name: "添加遗留问题" })).toBeDisabled();
});
