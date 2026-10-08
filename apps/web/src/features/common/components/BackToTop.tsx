import React, { useEffect, useState } from "react";

import { InpulseIcon } from "./InpulseIcon";
import "./back-to-top.css";

/** 滚动超过这个距离（≈一屏的三分之一）才显示按钮，短小的页面不出现。 */
const SHOW_AFTER_PX = 400;

/**
 * 回到顶部按钮（2026-10-08 用户要求：迭代记录 / 项目动态 / 审计日志这类长列表页）。
 *
 * 三条口径（改动前请先读）：
 * 1. **页面级滚动**：主内容区不是内部滚动容器（`html { overflow-y: scroll }`），
 *    所以监听 window、回顶也用 `window.scrollTo`；哪天真换成内部滚动容器，两边都要改。
 * 2. **只在跨过阈值那次重渲染**：scroll 事件高频触发，`setVisible` 收到相同值时
 *    React 会跳过更新，因此滚动过程中不产生额外渲染。
 * 3. **隐藏态可访问性**：CSS 用 `visibility: hidden` 兜住「不可点击、不可聚焦、
 *    读屏跳过」，不靠 `aria-hidden`（它管不住键盘焦点）。
 */
export function BackToTop() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const update = () => {
      const next = window.scrollY > SHOW_AFTER_PX;
      setVisible((prev) => (prev === next ? prev : next));
    };
    // 立即测一次：带着滚动位置回到页面（history 恢复）时不必等第一次滚动。
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  const scrollToTop = () => {
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    window.scrollTo({ top: 0, behavior: reduced ? "auto" : "smooth" });
  };

  return (
    <button
      type="button"
      className={visible ? "back-to-top is-visible" : "back-to-top"}
      aria-label="回到顶部"
      title="回到顶部"
      onClick={scrollToTop}
    >
      <InpulseIcon name="arrowUp" size={18} />
    </button>
  );
}
