import React from "react";
import { InpulseIcon, type InpulseIconName } from "./InpulseIcon";

export type CalmBadgeTone =
  "gray" | "blue" | "green" | "red" | "amber" | "violet" | "cyan";

export const CalmBadge: React.FC<{
  readonly children: React.ReactNode;
  readonly tone?: CalmBadgeTone;
  readonly title?: string;
}> = ({ children, tone = "gray", title }) => (
  <span className={"badge badge-" + tone} title={title}>
    {children}
  </span>
);

export const CalmEmptyState: React.FC<{
  readonly icon: InpulseIconName;
  readonly title: string;
  readonly description: string;
  readonly children?: React.ReactNode;
}> = ({ icon, title, description, children }) => (
  <div className="calm-empty calm-empty-state">
    <InpulseIcon name={icon} size={25} />
    <strong>{title}</strong>
    <p>{description}</p>
    {children}
  </div>
);

export const CalmSectionTitle: React.FC<{
  readonly title: string;
  readonly hint?: string;
  readonly children?: React.ReactNode;
}> = ({ title, hint, children }) => (
  <div className="calm-section-title">
    <div>
      <h3>{title}</h3>
      {hint ? <small>{hint}</small> : null}
    </div>
    {children}
  </div>
);

export const CalmSegmented = <T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  readonly value: T;
  readonly options: ReadonlyArray<{
    readonly value: T;
    readonly label: string;
  }>;
  readonly onChange: (value: T) => void;
  readonly label: string;
}) => (
  <div className="segmented" role="group" aria-label={label}>
    {options.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        className={value === option.value ? "selected" : ""}
        onClick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    ))}
  </div>
);

/**
 * C-3：设计师稿 task-modal 的「任务内容」标签栏（`calm-tabs`）——一行标签 +
 * 一根底部细线，选中态用 2px 下边框；内容区由调用方按 activeKey 渲染，
 * 标签文案（如 `迭代记录 3`、`合并与分支 · #12`）也由调用方组装。
 */
export const CalmTabs = <K extends string>({
  label,
  activeKey,
  items,
  onChange,
}: {
  readonly label: string;
  readonly activeKey: K;
  readonly items: ReadonlyArray<{
    readonly key: K;
    readonly label: React.ReactNode;
  }>;
  readonly onChange: (key: K) => void;
}) => (
  <div className="calm-tabs" role="tablist" aria-label={label}>
    {items.map((item) => (
      <button
        key={item.key}
        type="button"
        role="tab"
        aria-selected={activeKey === item.key}
        className={activeKey === item.key ? "selected" : ""}
        onClick={() => onChange(item.key)}
      >
        {item.label}
      </button>
    ))}
  </div>
);
