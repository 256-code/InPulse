/**
 * F-25 聚合组展示用的时间格式化：详情页页头与正文面板分处两个组件，
 * 共享同一份实现，避免页头与成员卡片出现两种日期写法。
 */

export function formatDay(iso: string): string {
  const date = new Date(iso);
  return date.getMonth() + 1 + "月" + date.getDate() + "日";
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", { hour12: false });
}
