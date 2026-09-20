import type { Locator } from "@playwright/test";

/** 迭代记录表单里遗留问题字段的完整可访问名（含"可添加多条"后缀）。 */
export const LEFTOVER_FIELD_LABEL = "遗留问题（选填，可添加多条）";

/**
 * 第 `position`（从 1 开始）条遗留问题的输入框。
 * 用精确匹配，避免 " 1" 命中 " 10"。
 */
export function leftoverField(scope: Locator, position: number): Locator {
  return scope.getByLabel(`${LEFTOVER_FIELD_LABEL} ${position}`, {
    exact: true,
  });
}

/**
 * 遗留问题自 2026-09-17 起是可增删的条目列表：先按需添加条目，再逐条填写。
 * `scope` 为承载该字段的表单容器（对话框或页面区块）。
 */
export async function fillLeftovers(
  scope: Locator,
  contents: readonly string[],
): Promise<void> {
  for (const [index, content] of contents.entries()) {
    await scope.getByRole("button", { name: "添加遗留问题" }).click();
    await leftoverField(scope, index + 1).fill(content);
  }
}
