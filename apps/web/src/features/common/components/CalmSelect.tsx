import React from "react";
import { Select } from "antd";
import { CalmBadge, type CalmBadgeTone } from "./Calm";
import { InpulseIcon } from "./InpulseIcon";
import "./calm-select.css";

/**
 * 通用下拉选择器：基于 antd Select，复用其键盘、ARIA 与弹层行为，视觉上提供
 * 三种形态（对齐设计评审的三种下拉风格）。
 *
 * - \`menu\`：浅色菜单（圆点 + 中性灰选中底 + 对勾），适合状态/优先级这类短选项。
 * - \`rich\`：富信息项（方形图标 + 标题/副标题 + 状态徽标），适合项目切换。
 * - \`member\`：成员选项（头像 + 姓名 + 勾选），默认开启输入搜索。
 * - \`notion\`：Notion 风极简面板（暖黑文字、紧凑行、多层柔和阴影），适合层级/范围切换。
 */
export type CalmSelectAppearance = "menu" | "rich" | "member" | "notion";

export interface CalmSelectOption {
  readonly value: number | string;
  readonly label: string;
  /** rich 副标题 / member 补充说明（如「可保留」）。 */
  readonly description?: string | undefined;
  /** notion：选项与触发器前缀 emoji（如 🎯）。 */
  readonly emoji?: string | undefined;
  /** menu：选项左侧圆点颜色（状态色）。 */
  readonly dotColor?: string | undefined;
  /** rich：图标方块内短文字；缺省取 label 首字。 */
  readonly iconText?: string | undefined;
  /** rich：图标方块底色；缺省按名称取稳定色。 */
  readonly iconColor?: string | undefined;
  /** rich：右侧徽标。 */
  readonly badge?:
    | { readonly text: string; readonly tone?: CalmBadgeTone | undefined }
    | undefined;
  /** member：头像地址；缺省用姓名首字色块。 */
  readonly avatarUrl?: string | null | undefined;
  readonly disabled?: boolean | undefined;
}

export interface CalmSelectProps {
  readonly value: number | string | null | undefined;
  readonly onChange: (value: number | string) => void;
  readonly onBlur?: (() => void) | undefined;
  readonly options: readonly CalmSelectOption[];
  readonly appearance?: CalmSelectAppearance | undefined;
  readonly placeholder?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly loading?: boolean | undefined;
  /** 是否允许输入搜索；member 形态默认开启。 */
  readonly searchable?: boolean | undefined;
  readonly className?: string | undefined;
  readonly ariaLabel?: string | undefined;
  /** 触发器内部输入框的 id；与 <label htmlFor> 配合保持表单语义。 */
  readonly id?: string | undefined;
  /** 触发器宽度（数字按 px）；不设置时随内容自适应。 */
  readonly width?: number | string | undefined;
}

/** 成员头像色板：与设计系统的好友色一致，按姓名取稳定色。 */
const AVATAR_COLORS = [
  "#1467d8",
  "#7a5af5",
  "#4a9278",
  "#c9821a",
  "#c0453f",
  "#2f7d9e",
] as const;

export function avatarColorOf(name: string): string {
  let hash = 0;
  for (const char of name) {
    const code = char.codePointAt(0) ?? 0;
    hash = (hash * 31 + code) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length] ?? "#1467d8";
}

const iconTextOf = (option: CalmSelectOption) =>
  option.iconText ?? option.label.slice(0, 1);

const OptionAvatar: React.FC<{ readonly option: CalmSelectOption }> = ({
  option,
}) =>
  option.avatarUrl ? (
    <img className="calm-select-avatar" src={option.avatarUrl} alt="" />
  ) : (
    <span
      className="calm-select-avatar"
      aria-hidden="true"
      style={{ background: avatarColorOf(option.label) }}
    >
      {option.label.slice(0, 1)}
    </span>
  );

export const CalmSelect: React.FC<CalmSelectProps> = ({
  value,
  onChange,
  onBlur,
  options,
  appearance = "menu",
  placeholder,
  disabled,
  loading,
  searchable,
  className,
  ariaLabel,
  id,
  width,
}) => {
  const withSearch = searchable ?? appearance === "member";
  /**
   * 选项值与当前值按字符串比对：项目筛选器一侧来自 URL/筛选参数（数字），
   * 另一侧由 projectSelectOption 统一产出字符串，精确匹配会让触发器回退成裸 id。
   */
  const valueKey = (raw: number | string | null | undefined) =>
    raw === null || raw === undefined ? "" : String(raw);
  const byValue = React.useMemo(() => {
    const map = new Map<string, CalmSelectOption>();
    for (const option of options) {
      const key = valueKey(option.value);
      if (!map.has(key)) {
        map.set(key, option);
      }
    }
    return map;
  }, [options]);

  const hasEmptyOption = byValue.has("");
  const selectedOption =
    value === null || value === undefined
      ? undefined
      : byValue.get(valueKey(value));
  const isPlaceholder = (raw: number | string | null | undefined) =>
    raw === null || raw === undefined || (raw === "" && !hasEmptyOption);

  const notionPrefix = (option: CalmSelectOption) =>
    option.emoji ? (
      <span className="calm-select-emoji" aria-hidden="true">
        {option.emoji}
      </span>
    ) : null;

  const richIcon = (option: CalmSelectOption) => (
    <span
      className="calm-select-rich-icon"
      style={{ background: option.iconColor ?? avatarColorOf(option.label) }}
    >
      {iconTextOf(option)}
    </span>
  );

  const renderTrigger = (raw: number | string | undefined) => {
    if (raw === undefined) {
      return null;
    }
    const option = byValue.get(valueKey(raw));
    if (!option) {
      return <span className="calm-select-trigger-label">{String(raw)}</span>;
    }
    if (appearance === "rich") {
      return (
        <span className="calm-select-trigger">
          {richIcon(option)}
          <span className="calm-select-trigger-label">{option.label}</span>
        </span>
      );
    }
    if (appearance === "member") {
      return (
        <span className="calm-select-trigger">
          <OptionAvatar option={option} />
          <span className="calm-select-trigger-label">{option.label}</span>
        </span>
      );
    }
    if (appearance === "notion") {
      return (
        <span className="calm-select-trigger">
          {notionPrefix(option)}
          <span className="calm-select-trigger-label">{option.label}</span>
        </span>
      );
    }
    return (
      <span className="calm-select-trigger">
        {option.dotColor ? (
          <span
            className="calm-select-dot"
            style={{ background: option.dotColor }}
          />
        ) : null}
        <span className="calm-select-trigger-label">{option.label}</span>
      </span>
    );
  };

  const check = (
    <InpulseIcon name="check" size={14} className="calm-select-check" />
  );

  const renderOption = (option: CalmSelectOption) => {
    const selected =
      value !== null &&
      value !== undefined &&
      valueKey(option.value) === valueKey(value);
    if (appearance === "rich") {
      return (
        <span className="calm-select-rich-item">
          {richIcon(option)}
          <span className="calm-select-rich-text">
            <span className="calm-select-rich-title">{option.label}</span>
            {option.description ? (
              <span className="calm-select-rich-desc">
                {option.description}
              </span>
            ) : null}
          </span>
          {option.badge ? (
            <CalmBadge tone={option.badge.tone ?? "blue"}>
              {option.badge.text}
            </CalmBadge>
          ) : selected ? (
            check
          ) : null}
        </span>
      );
    }
    if (appearance === "member") {
      return (
        <span className="calm-select-member-item">
          <OptionAvatar option={option} />
          <span className="calm-select-member-name">{option.label}</span>
          {option.description ? (
            <span className="calm-select-member-note">
              {option.description}
            </span>
          ) : null}
          {selected ? check : null}
        </span>
      );
    }
    if (appearance === "notion") {
      return (
        <span className="calm-select-notion-item">
          {notionPrefix(option)}
          <span className="calm-select-notion-label">{option.label}</span>
          {selected ? check : null}
        </span>
      );
    }
    return (
      <span className="calm-select-menu-item">
        {option.dotColor ? (
          <span
            className="calm-select-dot"
            style={{ background: option.dotColor }}
          />
        ) : null}
        <span className="calm-select-menu-label">{option.label}</span>
        {selected ? check : null}
      </span>
    );
  };

  const rootClass = [
    "calm-select",
    "calm-select-" + appearance,
    className ?? "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");

  return (
    <Select
      className={rootClass}
      classNames={{
        popup: { root: "calm-select-popup calm-select-popup-" + appearance },
      }}
      value={
        isPlaceholder(value)
          ? undefined
          : (selectedOption?.value ?? (value as number | string))
      }
      onChange={(next) => {
        if (next !== undefined) {
          onChange(next);
        }
      }}
      onBlur={() => onBlur?.()}
      options={options.map((option) => ({
        ...option,
        disabled: option.disabled ?? false,
      }))}
      labelRender={(label) => {
        const raw = label.value;
        return raw === undefined ? null : renderTrigger(raw);
      }}
      optionRender={(option) => {
        const data = option.data as unknown as CalmSelectOption | undefined;
        return data && data.label !== undefined ? renderOption(data) : null;
      }}
      placeholder={placeholder}
      disabled={disabled ?? false}
      loading={loading ?? false}
      showSearch={withSearch}
      filterOption={(input, option) => {
        const needle = input.trim().toLowerCase();
        if (needle.length === 0) {
          return true;
        }
        const data = option as unknown as CalmSelectOption;
        const haystack = (
          data.label +
          " " +
          (data.description ?? "")
        ).toLowerCase();
        return haystack.includes(needle);
      }}
      suffixIcon={<InpulseIcon name="chevronDown" size={14} />}
      popupMatchSelectWidth={false}
      {...(width === undefined ? {} : { style: { width } })}
      aria-label={ariaLabel}
      {...(id === undefined ? {} : { id })}
    />
  );
};
