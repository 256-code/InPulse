import React from "react";

/** 设计师稿 `catalog.tsx` 的 `.project-logo` 只定义了三种色系。 */
const LOGO_TONES = ["cyan", "blue", "amber"] as const;

/** 项目没有色字段，用编码派生稳定色系，保证同一项目每次渲染颜色一致。 */
export function projectLogoTone(code: string): string {
  let sum = 0;
  for (const char of code) {
    sum = (sum + char.charCodeAt(0)) % 997;
  }
  return LOGO_TONES[sum % LOGO_TONES.length] ?? "blue";
}

export interface ProjectLogoProps {
  readonly code: string;
  readonly className?: string | undefined;
}

/**
 * 项目标识。设计师稿用项目类型占位，仓库没有该字段，
 * 因此取项目编码前两位，完整编码通过 `title` 与卡片页脚给出。
 */
export const ProjectLogo: React.FC<ProjectLogoProps> = ({
  code,
  className,
}) => (
  <span
    className={
      "project-logo " +
      projectLogoTone(code) +
      (className === undefined ? "" : " " + className)
    }
    title={code}
  >
    {code.slice(0, 2).toUpperCase()}
  </span>
);
