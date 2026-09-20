import { expect, type Locator, type Page } from "@playwright/test";

/**
 * CalmSelect（antd Select）交互辅助。
 *
 * 触发器是 `div.ant-select`（内部 input 带 aria-label），弹层通过 portal 挂到
 * body 上。选项必须按当前下拉的 listbox 精确定位：刚关闭的弹层在退出动画期间
 * 仍是 `:visible`，全局查选项会命中旧弹层里的隐藏项而永久卡住。
 * 选项 title 即 CalmSelect 的 option label：字符串精确匹配，版本号这类含
 * 动态时间的用正则。
 */

function pageOf(scope: Page | Locator): Page {
  const candidate = scope as Locator;
  return typeof candidate.page === "function"
    ? candidate.page()
    : (scope as Page);
}

/**
 * 带 aria-label 的 antd Select 根节点（其文本即当前选中项）。
 * 触发器由输入框的 `.ant-select` 祖先定位：在弹窗作用域下 filter({ has })
 * 不会跨根重定位内层定位器，祖先轴是唯一在两个作用域都稳定的写法。
 */
export function calmSelectTrigger(
  scope: Page | Locator,
  label: string,
): Locator {
  return scope
    .getByLabel(label)
    .first()
    .locator(
      'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " ant-select ")][1]',
    );
}

/** 打开下拉并返回该触发器自己的 listbox（用 aria-controls 精确匹配）。 */
async function openListbox(
  scope: Page | Locator,
  label: string,
): Promise<Locator> {
  const page = pageOf(scope);
  const input = scope.getByLabel(label).first();
  await calmSelectTrigger(scope, label).click();
  const listId = await input.getAttribute("aria-controls");
  const listbox =
    listId === null || listId === ""
      ? page.locator('.ant-select-dropdown:visible [role="listbox"]').last()
      : page.locator('[role="listbox"][id="' + listId + '"]');
  await expect(listbox).toBeVisible();
  return listbox;
}

/** 点开 CalmSelect 并选择目标选项（按选项 title 匹配）。 */
export async function pickCalmSelectOption(
  scope: Page | Locator,
  label: string,
  option: string | RegExp,
): Promise<void> {
  const listbox = await openListbox(scope, label);
  const item =
    typeof option === "string"
      ? listbox.getByTitle(option, { exact: true })
      : listbox.getByTitle(option);
  await item.first().click();
}

/** 按下标点选（等价旧 selectOption({ index })：0 是「请选择…」占位项）。 */
export async function pickCalmSelectOptionByIndex(
  scope: Page | Locator,
  label: string,
  index: number,
): Promise<void> {
  const listbox = await openListbox(scope, label);
  await listbox.locator(".ant-select-item-option").nth(index).click();
}
