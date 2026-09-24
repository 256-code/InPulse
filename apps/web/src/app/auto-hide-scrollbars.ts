/**
 * 全站滚动条按需显形（2026-09-24 产品要求「所有的滚轮条不用的时候是隐藏的」）。
 * 原生没有「这个容器正在滚动」的 CSS 状态，靠 :hover 也做不到——指针停在窗口里就算悬停，
 * 常显的根滚动条会一直亮着；因此在捕获阶段收听全站 scroll，把可见状态写成元素上的
 * data-scrolling 属性，配色与槽宽见 styles/design-system.css 顶部。
 */
const VISIBLE_ATTRIBUTE = "data-scrolling";

/** 停手后 thumb 多停留一会儿，滚动过程中才不会闪烁。 */
const HIDE_DELAY_MS = 1000;

export function installAutoHideScrollbars(target: Document): () => void {
  const hideTimers = new Map<Element, ReturnType<typeof setTimeout>>();

  const handleScroll = (event: Event) => {
    // scroll 不冒泡，只能在捕获阶段收；根滚动条的 target 是 document 本身。
    const scrolled =
      event.target === target ? target.documentElement : event.target;
    if (!(scrolled instanceof Element)) {
      return;
    }
    scrolled.setAttribute(VISIBLE_ATTRIBUTE, "");
    const pending = hideTimers.get(scrolled);
    if (pending !== undefined) {
      clearTimeout(pending);
    }
    hideTimers.set(
      scrolled,
      setTimeout(() => {
        hideTimers.delete(scrolled);
        scrolled.removeAttribute(VISIBLE_ATTRIBUTE);
      }, HIDE_DELAY_MS),
    );
  };

  target.addEventListener("scroll", handleScroll, true);

  return () => {
    target.removeEventListener("scroll", handleScroll, true);
    for (const [scrolled, timer] of hideTimers) {
      clearTimeout(timer);
      scrolled.removeAttribute(VISIBLE_ATTRIBUTE);
    }
    hideTimers.clear();
  };
}
