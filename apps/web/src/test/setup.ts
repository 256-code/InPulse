import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/react";
import { afterEach } from "vitest";

// CI 的 4 vCPU runner 上，懒加载 chunk 冷启动与 Ant Design 过渡帧会让默认 1s 的异步查询超时
//（`TasksPage.test.tsx` 的详情弹窗、`app-router.test.tsx` 的默认路由都踩过）。这里全局放宽
// `findBy*`/`waitFor` 的默认预算；单处显式传 `timeout` 的用例仍以显式值为准。
configure({ asyncUtilTimeout: 4_000 });

// jsdom 环境补齐 ResizeObserver 与 matchMedia mock，确保 Ant Design 正常运行
class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof window !== "undefined") {
  window.ResizeObserver = MockResizeObserver;

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Ant Design 的 useDelayState 在测试结束前可能留下真实 timer，
// jsdom teardown 后回调会访问 window 并产生 unhandled error。每个用例结束后统一清理。
const nativeSetTimeout = globalThis.setTimeout as unknown as (
  handler: TimerHandler,
  timeout?: number,
  ...args: unknown[]
) => unknown;
const nativeClearTimeout = globalThis.clearTimeout as unknown as (
  id: unknown,
) => void;
const pendingTimeouts = new Set<unknown>();

globalThis.setTimeout = ((
  handler: TimerHandler,
  timeout?: number,
  ...args: unknown[]
) => {
  const id =
    typeof handler === "function"
      ? nativeSetTimeout(handler, timeout, ...args)
      : nativeSetTimeout(handler, timeout);
  pendingTimeouts.add(id);
  return id;
}) as typeof globalThis.setTimeout;

globalThis.clearTimeout = ((id: unknown) => {
  pendingTimeouts.delete(id);
  nativeClearTimeout(id);
}) as typeof globalThis.clearTimeout;

afterEach(() => {
  for (const id of pendingTimeouts) {
    nativeClearTimeout(id);
  }
  pendingTimeouts.clear();
});
