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
