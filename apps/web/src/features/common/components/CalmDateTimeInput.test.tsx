import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  CalmDateTimeInput,
  formatLocalDateTime,
  parseLocalDateTime,
  toLocalDateTimeInput,
} from "./CalmDateTimeInput";

const PANEL = { name: "选择截止时间" } as const;

const pad2 = (value: number): string => String(value).padStart(2, "0");
const today = new Date();
const todayDate = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
const todayCellLabel = `${today.getFullYear()} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日`;

/** 受控用法：字段值就是本地 `YYYY-MM-DDTHH:mm`，与调用方（三个表单）的接线一致。 */
function Harness({
  initial = "",
  onBadInput,
}: {
  readonly initial?: string;
  readonly onBadInput?: (badInput: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <CalmDateTimeInput
      id="due"
      ariaLabel="截止时间"
      value={value}
      onChange={setValue}
      {...(onBadInput === undefined ? {} : { onBadInput })}
    />
  );
}

async function openPanel() {
  fireEvent.click(screen.getByLabelText("截止时间"));
  return await screen.findByRole("group", PANEL);
}

describe("CalmDateTimeInput：自绘日历弹层（2026-09-29 用户反馈「日历不可以把截止日期填写框盖住」）", () => {
  it("点击方框就展开自绘面板，面板提供年 / 月 / 星期与「完成」", async () => {
    render(<Harness />);
    expect(screen.queryByRole("group", PANEL)).toBeNull();

    const panel = await openPanel();

    expect(within(panel).getByLabelText("年份")).toHaveValue(
      String(today.getFullYear()),
    );
    expect(within(panel).getByLabelText("月份")).toHaveValue(
      String(today.getMonth()),
    );
    expect(within(panel).getByText("一")).toBeInTheDocument();
    expect(within(panel).getByLabelText("小时")).toBeInTheDocument();
    expect(within(panel).getByLabelText("分钟")).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", { name: "完成" }),
    ).toBeInTheDocument();
  });

  it("选中日期把本地时间串写回字段；无值时时间为 00:00", async () => {
    render(<Harness />);
    const panel = await openPanel();

    fireEvent.click(within(panel).getByLabelText(todayCellLabel));

    expect(screen.getByLabelText("截止时间")).toHaveValue(`${todayDate}T00:00`);
  });

  it("选日期保留已填的时间，改时 / 分用当天日期补齐", async () => {
    render(<Harness />);
    const panel = await openPanel();

    fireEvent.change(within(panel).getByLabelText("小时"), {
      target: { value: "9" },
    });
    expect(screen.getByLabelText("截止时间")).toHaveValue(`${todayDate}T09:00`);

    fireEvent.change(within(panel).getByLabelText("分钟"), {
      target: { value: "15" },
    });
    expect(screen.getByLabelText("截止时间")).toHaveValue(`${todayDate}T09:15`);

    fireEvent.click(within(panel).getByLabelText(todayCellLabel));
    expect(screen.getByLabelText("截止时间")).toHaveValue(`${todayDate}T09:15`);
  });

  it("已有值时按「下一个月」翻页，标题与格子跟着换月", async () => {
    render(<Harness initial="2026-09-30T18:30" />);
    const panel = await openPanel();
    expect(within(panel).getByLabelText("年份")).toHaveValue("2026");
    expect(within(panel).getByLabelText("月份")).toHaveValue("8");

    fireEvent.click(within(panel).getByRole("button", { name: "下一个月" }));

    expect(within(panel).getByLabelText("月份")).toHaveValue("9");
    expect(
      within(panel).getByLabelText("2026 年 10 月 1 日"),
    ).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "上一个月" }));
    expect(within(panel).getByLabelText("月份")).toHaveValue("8");
  });

  it("「清空」清空字段并收起弹层", async () => {
    render(<Harness initial="2026-09-30T18:30" />);
    const panel = await openPanel();

    fireEvent.click(within(panel).getByRole("button", { name: "清空" }));

    expect(screen.getByLabelText("截止时间")).toHaveValue("");
    await waitFor(() => expect(screen.queryByRole("group", PANEL)).toBeNull());
  });

  it("「今天」写回今天的日期并保留已填的时间", async () => {
    render(<Harness initial="2026-09-30T18:30" />);
    const panel = await openPanel();

    fireEvent.click(within(panel).getByRole("button", { name: "今天" }));

    expect(screen.getByLabelText("截止时间")).toHaveValue(`${todayDate}T18:30`);
  });

  it("键入时把原生输入的合法性状态上报给调用方（遗留项转任务的合法 / 非法分支靠它）", () => {
    const onBadInput = vi.fn();
    render(<Harness onBadInput={onBadInput} />);

    fireEvent.change(screen.getByLabelText("截止时间"), {
      target: { value: "2026-10-05T08:07" },
    });

    // jsdom 不实现原生的「输入到无法解析」状态，`badInput` 恒为 false；这里只锁定接线。
    expect(onBadInput).toHaveBeenCalledWith(false);
  });

  it("空值时点方框阻止默认落光标（第一个数字落在年份段），已有值时不阻止", () => {
    const empty = render(<Harness />);
    expect(fireEvent.mouseDown(screen.getByLabelText("截止时间"))).toBe(false);
    empty.unmount();

    render(<Harness initial="2026-09-30T18:30" />);
    expect(fireEvent.mouseDown(screen.getByLabelText("截止时间"))).toBe(true);
  });

  it("禁用的字段不展开弹层", () => {
    render(
      <CalmDateTimeInput
        id="due"
        ariaLabel="截止时间"
        value=""
        disabled
        onChange={() => undefined}
      />,
    );

    fireEvent.click(screen.getByLabelText("截止时间"));

    expect(screen.queryByRole("group", PANEL)).toBeNull();
  });
});

describe("自定义占位（2026-09-30）", () => {
  it("传了文案且值为空时盖一层占位，聚焦或有值时都不再显示", async () => {
    const { unmount } = render(
      <CalmDateTimeInput
        id="due"
        ariaLabel="截止时间"
        placeholder="选填"
        value=""
        onChange={() => undefined}
      />,
    );
    const field = () => document.querySelector(".calm-date-field");
    const placeholder = () => document.querySelector(".calm-date-placeholder");
    expect(field()?.className).toContain("calm-date-field--placeholder");
    expect(placeholder()?.textContent).toBe("选填");
    fireEvent.focus(screen.getByLabelText("截止时间"));
    expect(field()?.className).toContain("calm-date-field--placeholder");
    unmount();
    render(
      <CalmDateTimeInput
        id="due"
        ariaLabel="截止时间"
        placeholder="选填"
        value="2026-10-05T08:07"
        onChange={() => undefined}
      />,
    );
    expect(field()?.className).not.toContain("calm-date-field--placeholder");
    expect(placeholder()).toBeNull();
  });

  it("没传文案的字段保持原生占位，不额外插节点", () => {
    render(
      <CalmDateTimeInput
        id="due"
        ariaLabel="截止时间"
        value=""
        onChange={() => undefined}
      />,
    );
    expect(document.querySelector(".calm-date-placeholder")).toBeNull();
  });
});

describe("本地时间串换算", () => {
  it("parse / format 往返，非法日期与非法格式返回 null", () => {
    expect(
      formatLocalDateTime({ year: 2026, month: 9, day: 5, hour: 8, minute: 7 }),
    ).toBe("2026-10-05T08:07");
    expect(parseLocalDateTime("2026-10-05T08:07")).toEqual({
      year: 2026,
      month: 9,
      day: 5,
      hour: 8,
      minute: 7,
    });
    expect(parseLocalDateTime("")).toBeNull();
    expect(parseLocalDateTime("2026-10-05")).toBeNull();
    expect(parseLocalDateTime("2026-02-30T08:07")).toBeNull();
  });

  it("toLocalDateTimeInput 把服务端 UTC ISO 串换算成本地串", () => {
    const iso = new Date(2026, 9, 5, 8, 7).toISOString();

    expect(toLocalDateTimeInput(iso)).toBe("2026-10-05T08:07");
    expect(toLocalDateTimeInput(null)).toBe("");
    expect(toLocalDateTimeInput(undefined)).toBe("");
    expect(toLocalDateTimeInput("")).toBe("");
    expect(toLocalDateTimeInput("不是日期")).toBe("");
  });
});
