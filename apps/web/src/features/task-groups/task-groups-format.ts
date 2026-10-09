import {
  formatBeijingMonthDayCn,
  BEIJING_TIME_ZONE,
} from "@features/common/beijing-time";

/**
 * F-25 聚合组展示用的时间格式化：详情页页头与正文面板分处两个组件，
 * 共享同一份实现，避免页头与成员卡片出现两种日期写法。
 * 一律按北京时间渲染，与全站其他时间展示同一口径。
 */

export function formatDay(iso: string): string {
  return formatBeijingMonthDayCn(iso);
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-CN", {
    hour12: false,
    timeZone: BEIJING_TIME_ZONE,
  });
}
