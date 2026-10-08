import React from "react";

/**
 * 2026-10-08 用户要求：列表页（项目动态 / 迭代记录 / 审计日志）滚动时标题与筛选条吸顶，
 * 分组头再吸在吸顶块下方。吸顶偏移必须等于吸顶块的真实高度——工具条在不同页面、不同宽度与
 * 不同筛选控件下都会折行，写死像素会让分组头浮在半空或被压在筛选条下面，所以量出来写进
 * CSS 变量 `--sticky-band-height`（消费方：`.activity-day-head`、`.timeline-day-head`）。
 *
 * 页面根元素的 ref 用来落变量：变量必须落在吸顶块与分组头的共同祖先上，两者是兄弟节点。
 */
export const useStickyBandOffset = (
  pageRef: React.RefObject<HTMLElement | null>,
  bandRef: React.RefObject<HTMLElement | null>,
  enabled = true,
): void => {
  React.useLayoutEffect(() => {
    if (!enabled) return undefined;
    const page = pageRef.current;
    const band = bandRef.current;
    if (page === null || band === null) return undefined;
    const apply = (): void => {
      // 向下取整：吸顶偏移比吸顶块略小，分组头顶边微微压在吸顶块下面，
      // 两者之间不会因为子像素取整露出一条比行还细的内容。
      const height = `${Math.floor(band.getBoundingClientRect().height)}px`;
      if (page.style.getPropertyValue("--sticky-band-height") !== height) {
        page.style.setProperty("--sticky-band-height", height);
      }
    };
    apply();
    if (typeof ResizeObserver === "undefined") {
      return () => page.style.removeProperty("--sticky-band-height");
    }
    const observer = new ResizeObserver(apply);
    observer.observe(band);
    return () => {
      observer.disconnect();
      page.style.removeProperty("--sticky-band-height");
    };
  }, [pageRef, bandRef, enabled]);
};
