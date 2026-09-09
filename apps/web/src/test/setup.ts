import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";

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
