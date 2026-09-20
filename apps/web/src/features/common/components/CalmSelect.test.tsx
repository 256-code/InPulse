import React from "react";
import { ConfigProvider } from "antd";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { avatarColorOf, CalmSelect, type CalmSelectOption } from "./CalmSelect";

const statusOptions: readonly CalmSelectOption[] = [
  { value: "TODO", label: "未完成", dotColor: "#1467d8" },
  { value: "DONE", label: "已完成", dotColor: "#4a9278" },
  { value: "CANCELED", label: "已取消", dotColor: "#a0adb9" },
  { value: "ALL", label: "全部状态" },
];

const memberOptions: readonly CalmSelectOption[] = [
  { value: 5, label: "林晚晴" },
  { value: 7, label: "周子昂", description: "可保留" },
  { value: 9, label: "陈默" },
];

const projectOptions: readonly CalmSelectOption[] = [
  {
    value: 1,
    label: "InPulse 平台",
    description: "24 名成员",
    badge: { text: "进行中", tone: "blue" },
  },
  {
    value: 2,
    label: "数据中台",
    description: "12 名成员",
    badge: { text: "维护中", tone: "gray" },
  },
];

function mount(ui: React.ReactElement) {
  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>{ui}</ConfigProvider>,
  );
}

function openSelect(container: HTMLElement) {
  const trigger = container.querySelector(".ant-select");
  if (!trigger) {
    throw new Error("ant-select trigger not found");
  }
  fireEvent.mouseDown(trigger);
}

function dropdownOf() {
  const dropdown = document.querySelector(".ant-select-dropdown");
  if (!dropdown) {
    throw new Error("dropdown not found");
  }
  return dropdown as HTMLElement;
}

describe("CalmSelect", () => {
  it("menu 形态：触发器显示当前值，选择后回调新值且选中项带对勾", () => {
    const onChange = vi.fn();
    const view = mount(
      <CalmSelect
        value="TODO"
        onChange={onChange}
        options={statusOptions}
        ariaLabel="任务状态筛选"
      />,
    );
    const trigger = view.container.querySelector(".ant-select-content");
    expect(trigger?.textContent).toBe("未完成");

    openSelect(view.container);
    const dropdown = dropdownOf();
    expect(within(dropdown).getByText("已完成")).toBeInTheDocument();
    expect(within(dropdown).getByText("全部状态")).toBeInTheDocument();
    // 选中项渲染对勾。
    expect(
      dropdown.querySelectorAll(
        ".ant-select-item-option-selected .calm-select-check",
      ),
    ).toHaveLength(1);

    fireEvent.click(within(dropdown).getByText("已完成"));
    expect(onChange).toHaveBeenCalledWith("DONE");
  });

  it("member 形态：默认可以输入搜索并按姓名与说明过滤", () => {
    const view = mount(
      <CalmSelect
        value={5}
        onChange={() => {}}
        options={memberOptions}
        appearance="member"
        ariaLabel="负责人"
      />,
    );
    openSelect(view.container);
    const dropdown = dropdownOf();
    expect(within(dropdown).getByText("周子昂")).toBeInTheDocument();

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "可保留" } });
    expect(within(dropdown).queryByText("林晚晴")).not.toBeInTheDocument();
    expect(within(dropdown).getByText("周子昂")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "陈" } });
    expect(within(dropdown).queryByText("周子昂")).not.toBeInTheDocument();
    expect(within(dropdown).getByText("陈默")).toBeInTheDocument();
  });

  it("rich 形态：渲染副标题与状态徽标", () => {
    const view = mount(
      <CalmSelect
        value={1}
        onChange={() => {}}
        options={projectOptions}
        appearance="rich"
        ariaLabel="选择项目"
      />,
    );
    openSelect(view.container);
    const dropdown = dropdownOf();
    expect(within(dropdown).getByText("InPulse 平台")).toBeInTheDocument();
    expect(within(dropdown).getByText("24 名成员")).toBeInTheDocument();
    expect(within(dropdown).getByText("12 名成员")).toBeInTheDocument();
    expect(within(dropdown).getByText("进行中")).toBeInTheDocument();
    expect(within(dropdown).getByText("维护中")).toBeInTheDocument();
  });

  it("禁用时点击不会打开选项列表", () => {
    const view = mount(
      <CalmSelect
        value="TODO"
        onChange={() => {}}
        options={statusOptions}
        disabled
        ariaLabel="任务状态筛选"
      />,
    );
    openSelect(view.container);
    expect(view.container.querySelector(".ant-select-item-option")).toBeNull();
  });

  it("头像色板按姓名取稳定色", () => {
    expect(avatarColorOf("林晚晴")).toBe(avatarColorOf("林晚晴"));
    expect(avatarColorOf("")).toBeTruthy();
  });
});
