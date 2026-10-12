import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

import { FEATURE_TAG_LIMIT, FeatureTagsInput } from "./FeatureTagsInput";

const Harness: React.FC<{
  initial?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
}> = ({ initial = "", disabled = false, onChange }) => {
  const [value, setValue] = useState(initial);
  return (
    <FeatureTagsInput
      value={value}
      inputId="feature-tags"
      disabled={disabled}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
    />
  );
};

const openEntry = (): HTMLInputElement => {
  fireEvent.click(screen.getByRole("button", { name: "新标签" }));
  return screen.getByPlaceholderText<HTMLInputElement>("输入后按回车");
};

it("回车把草稿提交成胶囊，重复输入被忽略且不新增", () => {
  render(<Harness />);
  const entry = openEntry();
  fireEvent.change(entry, { target: { value: "支付" } });
  fireEvent.keyDown(entry, { key: "Enter" });
  expect(screen.getByText("支付")).toBeVisible();
  expect(entry.value).toBe("");
  fireEvent.change(entry, { target: { value: "支付" } });
  fireEvent.keyDown(entry, { key: "Enter" });
  expect(screen.getAllByText("支付")).toHaveLength(1);
});

it("失焦提交草稿，Esc 丢弃草稿并收回到「新标签」按钮", () => {
  render(<Harness />);
  const entry = openEntry();
  fireEvent.change(entry, { target: { value: "发货" } });
  fireEvent.blur(entry);
  expect(screen.getByText("发货")).toBeVisible();
  expect(screen.getByRole("button", { name: "新标签" })).toBeVisible();

  const again = openEntry();
  fireEvent.change(again, { target: { value: "丢弃" } });
  fireEvent.keyDown(again, { key: "Escape" });
  expect(screen.queryByText("丢弃")).toBeNull();
  expect(screen.getByRole("button", { name: "新标签" })).toBeVisible();
});

it("胶囊上的移除按钮把该标签从值里删掉", () => {
  const onChange = vi.fn();
  render(<Harness initial={"支付\n退款"} onChange={onChange} />);
  fireEvent.click(screen.getByRole("button", { name: "移除标签 支付" }));
  expect(onChange).toHaveBeenCalledWith("退款");
  expect(screen.queryByText("支付")).toBeNull();
  expect(screen.getByText("退款")).toBeVisible();
});

it("达到 50 个上限后拒绝第 51 个并给出提示", () => {
  const onChange = vi.fn();
  const initial = Array.from(
    { length: FEATURE_TAG_LIMIT },
    (_, index) => "标签" + (index + 1),
  ).join("\n");
  render(<Harness initial={initial} onChange={onChange} />);
  const entry = openEntry();
  fireEvent.change(entry, { target: { value: "第 51 个" } });
  fireEvent.keyDown(entry, { key: "Enter" });
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getByText("标签最多 50 个。")).toBeVisible();
  expect(entry.value).toBe("第 51 个");
});

it("禁用时不能再添加或移除标签", () => {
  render(<Harness initial={"支付"} disabled />);
  expect(screen.getByRole("button", { name: "新标签" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "移除标签 支付" })).toBeDisabled();
});
