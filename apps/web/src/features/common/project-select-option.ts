import type { ProjectItem } from "@generated/api";

import type { CalmSelectOption } from "./components/CalmSelect";
import {
  projectLifecycleLabel,
  projectLifecycleTone,
} from "./resource-lifecycle";

/**
 * 项目 → CalmSelect rich 选项的唯一映射：图标块 + 名称 + 成员数副标题 + 状态徽标。
 * 任务中心、迭代记录、遗留问题、项目动态与审计链五处项目筛选器共用，
 * 避免字段口径与降级策略漂移。
 *
 * 契约上 `code` / `status` / `memberCount` 必填；这里仍对缺失值降级
 * （空图标块、隐藏徽标、0 名成员），保证精简桩数据或字段回归只影响
 * 单个选项的展示，不会让整页渲染崩溃。
 */
export function projectSelectOption(project: ProjectItem): CalmSelectOption {
  const code = typeof project.code === "string" ? project.code : "";
  const memberCount =
    typeof project.memberCount === "number" ? project.memberCount : 0;
  const statusText =
    typeof project.status === "string"
      ? projectLifecycleLabel(project.status)
      : "";
  return {
    value: String(project.id),
    label: project.name,
    description: String(memberCount) + " 名活跃成员",
    iconText: code.slice(0, 2).toUpperCase(),
    badge:
      statusText.length > 0
        ? {
            text: statusText,
            tone: projectLifecycleTone(project.status, "blue"),
          }
        : undefined,
  };
}
