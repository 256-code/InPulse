import { useState, type Ref } from "react";
import { Popover } from "antd";

import { InpulseIcon } from "./InpulseIcon";
import "./calm-date-picker.css";

/**
 * 自绘截止时间选择器（2026-09-29 用户反馈「日历不可以把截止日期填写框盖住」）。
 *
 * 原生 `datetime-local` 的日历弹层由浏览器绘制、位置不可控：实测字段较窄时它会把弹层摆到
 * 输入框左侧，直接压住输入框本身和相邻字段（`showPicker()` 与点右侧日历图标两条路径位置
 * 完全相同），CSS 改不了。这里保留原生输入框负责键入（沿用它的逐段编辑、`validity.badInput`
 * 与 `YYYY-MM-DDTHH:mm` 值格式），把日历换成 antd Popover 承载的自绘面板：永远贴在字段下方，
 * 下方空间不足时翻到字段上方，绝不覆盖字段。
 *
 * 项目未引入 dayjs（antd `DatePicker` 需要它，新增生产依赖按 AGENTS.md 第 4 节只能走独立
 * PR），因此日历格子用原生 `Date` 手写。
 */

const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** 本地时间分量；`month` 从 0 起（与 `Date` 一致）。 */
export interface CalmDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

const pad2 = (value: number): string => String(value).padStart(2, "0");

/** 拼本地 `YYYY-MM-DDTHH:mm`。不能用 `toISOString()`：它会按时区偏移改掉日期。 */
export function formatLocalDateTime(parts: CalmDateTimeParts): string {
  const date = `${parts.year}-${pad2(parts.month + 1)}-${pad2(parts.day)}`;
  return `${date}T${pad2(parts.hour)}:${pad2(parts.minute)}`;
}

/** 解析本地 `YYYY-MM-DDTHH:mm`；格式不符或日期不存在（如 02-30）时返回 null。 */
/** 服务端 UTC ISO 串 → 输入框要的本地 `YYYY-MM-DDTHH:mm`；空值、非法日期一律返回空串。 */
export function toLocalDateTimeInput(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return "";
  return formatLocalDateTime({
    year: at.getFullYear(),
    month: at.getMonth(),
    day: at.getDate(),
    hour: at.getHours(),
    minute: at.getMinutes(),
  });
}
export function parseLocalDateTime(value: string): CalmDateTimeParts | null {
  const matched = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (matched === null) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]) - 1;
  const day = Number(matched[3]);
  const hour = Number(matched[4]);
  const minute = Number(matched[5]);
  const at = new Date(year, month, day, hour, minute);
  if (
    at.getFullYear() !== year ||
    at.getMonth() !== month ||
    at.getDate() !== day ||
    at.getHours() !== hour ||
    at.getMinutes() !== minute
  ) {
    return null;
  }
  return { year, month, day, hour, minute };
}

const WEEK_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;
const MONTH_LABELS = [
  "1 月",
  "2 月",
  "3 月",
  "4 月",
  "5 月",
  "6 月",
  "7 月",
  "8 月",
  "9 月",
  "10 月",
  "11 月",
  "12 月",
] as const;
const HOURS: readonly number[] = Array.from(
  { length: 24 },
  (_item, index) => index,
);
const MINUTES: readonly number[] = Array.from(
  { length: 60 },
  (_item, index) => index,
);

/** 周一开头的当月网格：补齐前后整周，最多 6 行；末行整行属于下个月时收成 5 行。 */
function monthGrid(year: number, month: number): Date[] {
  const offset = (new Date(year, month, 1).getDay() + 6) % 7;
  const days: Date[] = [];
  for (let index = 0; index < 42; index += 1) {
    days.push(new Date(year, month, 1 - offset + index));
  }
  const sixthRow = days[35];
  return sixthRow !== undefined && sixthRow.getMonth() !== month
    ? days.slice(0, 35)
    : days;
}

const sameDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

interface CalmDatePanelProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly onDismiss: () => void;
}

function CalmDatePanel({ value, onChange, onDismiss }: CalmDatePanelProps) {
  const selected = parseLocalDateTime(value);
  const today = new Date();
  const [view, setView] = useState(() => ({
    year: selected?.year ?? today.getFullYear(),
    month: selected?.month ?? today.getMonth(),
  }));
  const hour = selected?.hour ?? 0;
  const minute = selected?.minute ?? 0;

  const shiftMonth = (step: number) => {
    const next = new Date(view.year, view.month + step, 1);
    setView({ year: next.getFullYear(), month: next.getMonth() });
  };

  const commit = (parts: CalmDateTimeParts) =>
    onChange(formatLocalDateTime(parts));

  const pickDay = (day: Date) =>
    commit({
      year: day.getFullYear(),
      month: day.getMonth(),
      day: day.getDate(),
      hour,
      minute,
    });

  /** 改时/分：没有日期时以「今天」补齐，保证任何一步都写出完整的本地时间串。 */
  const pickTime = (nextHour: number, nextMinute: number) => {
    const base = selected ?? {
      year: today.getFullYear(),
      month: today.getMonth(),
      day: today.getDate(),
    };
    commit({ ...base, hour: nextHour, minute: nextMinute });
  };

  const years: number[] = [];
  for (
    let year = today.getFullYear() - 5;
    year <= today.getFullYear() + 10;
    year += 1
  ) {
    years.push(year);
  }
  if (!years.includes(view.year)) years.push(view.year);
  years.sort((left, right) => left - right);

  const cells = monthGrid(view.year, view.month);

  return (
    <div className="calm-date-panel" role="group" aria-label="选择截止时间">
      <div className="calm-date-head">
        <button
          type="button"
          className="calm-date-nav"
          aria-label="上一个月"
          onClick={() => shiftMonth(-1)}
        >
          <InpulseIcon name="chevronLeft" size={14} />
        </button>
        <select
          className="calm-date-select"
          aria-label="年份"
          value={view.year}
          onChange={(event) =>
            setView((current) => ({
              ...current,
              year: Number(event.target.value),
            }))
          }
        >
          {years.map((year) => (
            <option key={year} value={year}>
              {year} 年
            </option>
          ))}
        </select>
        <select
          className="calm-date-select"
          aria-label="月份"
          value={view.month}
          onChange={(event) =>
            setView((current) => ({
              ...current,
              month: Number(event.target.value),
            }))
          }
        >
          {MONTH_LABELS.map((label, index) => (
            <option key={label} value={index}>
              {label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="calm-date-nav"
          aria-label="下一个月"
          onClick={() => shiftMonth(1)}
        >
          <InpulseIcon name="chevronRight" size={14} />
        </button>
      </div>
      <div className="calm-date-week">
        {WEEK_LABELS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      <div className="calm-date-grid">
        {cells.map((cell) => {
          const isSelected =
            selected !== null &&
            sameDay(
              cell,
              new Date(selected.year, selected.month, selected.day),
            );
          const className = [
            "calm-date-cell",
            cell.getMonth() === view.month ? "" : "is-outside",
            sameDay(cell, today) ? "is-today" : "",
            isSelected ? "is-selected" : "",
          ]
            .filter((part) => part.length > 0)
            .join(" ");
          return (
            <button
              key={cell.getTime()}
              type="button"
              className={className}
              aria-pressed={isSelected}
              aria-label={`${cell.getFullYear()} 年 ${cell.getMonth() + 1} 月 ${cell.getDate()} 日`}
              onClick={() => pickDay(cell)}
            >
              {cell.getDate()}
            </button>
          );
        })}
      </div>
      <div className="calm-date-time">
        <span className="calm-date-time-label">时间</span>
        <select
          className="calm-date-select"
          aria-label="小时"
          value={hour}
          onChange={(event) => pickTime(Number(event.target.value), minute)}
        >
          {HOURS.map((item) => (
            <option key={item} value={item}>
              {pad2(item)}
            </option>
          ))}
        </select>
        <span className="calm-date-time-colon">:</span>
        <select
          className="calm-date-select"
          aria-label="分钟"
          value={minute}
          onChange={(event) => pickTime(hour, Number(event.target.value))}
        >
          {MINUTES.map((item) => (
            <option key={item} value={item}>
              {pad2(item)}
            </option>
          ))}
        </select>
      </div>
      <div className="calm-date-actions">
        <button
          type="button"
          className="calm-date-link"
          onClick={() => {
            onChange("");
            onDismiss();
          }}
        >
          清空
        </button>
        <button
          type="button"
          className="calm-date-link"
          onClick={() => {
            setView({ year: today.getFullYear(), month: today.getMonth() });
            commit({
              year: today.getFullYear(),
              month: today.getMonth(),
              day: today.getDate(),
              hour,
              minute,
            });
            onDismiss();
          }}
        >
          今天
        </button>
        <button type="button" className="calm-date-done" onClick={onDismiss}>
          完成
        </button>
      </div>
    </div>
  );
}

export interface CalmDateTimeInputProps {
  readonly id?: string | undefined;
  /** 本地 `YYYY-MM-DDTHH:mm`；空串表示未设置。 */
  readonly value: string;
  readonly onChange: (next: string) => void;
  /** 原生输入框 `validity.badInput` 变化（用户键入到无法解析的内容）时回调。 */
  readonly onBadInput?: ((badInput: boolean) => void) | undefined;
  readonly onBlur?: (() => void) | undefined;
  readonly disabled?: boolean | undefined;
  readonly ariaLabel?: string | undefined;
  readonly ariaInvalid?: boolean | undefined;
  readonly ariaDescribedBy?: string | undefined;
  readonly inputRef?: Ref<HTMLInputElement> | undefined;
}

/**
 * 截止时间字段：原生 `datetime-local` 负责键入，自绘日历弹层负责选日期。
 * 无障碍名由调用方的 `<label htmlFor>` 提供，因此 `id` 仍落在原生输入框上。
 */
export function CalmDateTimeInput({
  id,
  value,
  onChange,
  onBadInput,
  onBlur,
  disabled,
  ariaLabel,
  ariaInvalid,
  ariaDescribedBy,
  inputRef,
}: CalmDateTimeInputProps) {
  const [open, setOpen] = useState(false);
  const expanded = open && disabled !== true;

  return (
    <Popover
      open={expanded}
      // `content` 必须始终是一个可渲染的节点：antd 的 Popover 把它作为 Tooltip 的 `overlay`，
      // `overlay` 为空时 Tooltip 会判定「无标题」并把打开状态强行压回 false——弹层永远打不开
      //（2026-09-29 单测实测）。关闭态不会真的挂载面板：`destroyOnHidden` 与 rc-trigger 的
      // 按需渲染保证面板只在展开时存在，因此每次展开都会按当前值重新定位到对应月份。
      onOpenChange={(next) => setOpen(disabled === true ? false : next)}
      trigger="click"
      placement="bottomLeft"
      arrow={false}
      destroyOnHidden
      // 外壳尺寸 / 描边 / 阴影在 `calm-date-picker.css`：antd-adapter.css 为原型里的账户 / 通知
      // 气泡把 `.ant-popover-container` 压成 1×1 透明盒，只有 CSS 才能按特异性覆写回来。
      classNames={{ root: "calm-date-popover" }}
      content={
        <CalmDatePanel
          value={value}
          onChange={onChange}
          onDismiss={() => setOpen(false)}
        />
      }
    >
      <div className="calm-date-field">
        <input
          className="calm-date-input"
          type="datetime-local"
          {...(id === undefined ? {} : { id })}
          {...(inputRef === undefined ? {} : { ref: inputRef })}
          value={value}
          disabled={disabled === true}
          onMouseDown={(event) => {
            // 空值时阻止默认落光标：否则按点击坐标可能落到「日」段，第一个数字就不是年份。
            if (event.currentTarget.value === "") event.preventDefault();
          }}
          onClick={(event) => {
            if (event.currentTarget.value === "") event.currentTarget.focus();
          }}
          onChange={(event) => {
            onChange(event.target.value);
            onBadInput?.(event.target.validity.badInput);
          }}
          {...(onBlur === undefined ? {} : { onBlur })}
          {...(ariaLabel === undefined ? {} : { "aria-label": ariaLabel })}
          {...(ariaInvalid === undefined
            ? {}
            : { "aria-invalid": ariaInvalid })}
          {...(ariaDescribedBy === undefined
            ? {}
            : { "aria-describedby": ariaDescribedBy })}
        />
        <InpulseIcon
          name="calendar"
          size={15}
          className="calm-date-field-icon"
        />
      </div>
    </Popover>
  );
}
