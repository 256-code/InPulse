import React, { useEffect, useRef, useState } from "react";

import { InpulseIcon } from "./InpulseIcon";
import "./back-to-top.css";

/** 滚动超过这个距离（≈一屏的三分之一）才显示按钮，短小的页面不出现。 */
const SHOW_AFTER_PX = 400;

/**
 * 从节点向上找最近的可滚动祖先。弹层里的正文是弹层自己的滚动区
 * （`.project-workspace-modal-body`），按钮和它在同一棵 DOM 里，不需要外部传 ref；
 * 整页页面走 window，不经过这里。
 */
function nearestScroller(node: HTMLElement | null): HTMLElement | null {
  let current = node?.parentElement ?? null;
  while (current !== null) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return current;
    current = current.parentElement;
  }
  return null;
}

export interface BackToTopProps {
  /**
   * 弹层内（记录视图装进项目主页弹窗）用：正文不是整页而是内部滚动区，
   * 因此监听最近的可滚动祖先、回顶也回它；按钮位置同时改由
   * `.back-to-top.is-inset` 锚在滚动区内容区的右下角（弹层盒子自身是 fixed，
   * 沿用视口级 fixed 会飘到弹层外面）。
   */
  readonly inset?: boolean | undefined;
}

/**
 * 回到顶部按钮（2026-10-08 用户要求：迭代记录 / 项目动态 / 审计日志这类长列表页）。
 *
 * 三条口径（改动前请先读）：
 * 1. **两种滚动来源**：整页页面监听 window、回顶用 `window.scrollTo`；`inset` 时改监听
 *    最近的可滚动祖先、回顶用 `element.scrollTo`，其余行为一致。
 * 2. **只在跨过阈值那次重渲染**：scroll 事件高频触发，`setVisible` 收到相同值时
 *    React 会跳过更新，因此滚动过程中不产生额外渲染。
 * 3. **隐藏态可访问性**：CSS 用 `visibility: hidden` 兜住「不可点击、不可聚焦、
 *    读屏跳过」，不靠 `aria-hidden`（它管不住键盘焦点）。
 */
export function BackToTop({ inset = false }: BackToTopProps = {}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const scrollerRef = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const scroller = inset ? nearestScroller(buttonRef.current) : null;
    scrollerRef.current = scroller;
    const update = () => {
      const offset = scroller === null ? window.scrollY : scroller.scrollTop;
      const next = offset > SHOW_AFTER_PX;
      setVisible((prev) => (prev === next ? prev : next));
    };
    // 立即测一次：带着滚动位置回到页面（history 恢复）时不必等第一次滚动。
    update();
    const target: HTMLElement | Window = scroller ?? window;
    target.addEventListener("scroll", update, { passive: true });
    return () => target.removeEventListener("scroll", update);
  }, [inset]);

  const scrollToTop = () => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const behavior = reduced ? "auto" : "smooth";
    const scroller = scrollerRef.current;
    if (inset && scroller !== null) {
      scroller.scrollTo({ top: 0, behavior });
      return;
    }
    window.scrollTo({ top: 0, behavior });
  };

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`back-to-top${inset ? " is-inset" : ""}${visible ? " is-visible" : ""}`}
      aria-label="回到顶部"
      title="回到顶部"
      onClick={scrollToTop}
    >
      <InpulseIcon name="arrowUp" size={18} />
    </button>
  );
}
