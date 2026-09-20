import { isUnauthenticated } from "./auth-errors";

type SessionExpiredHandler = () => void;

let handler: SessionExpiredHandler | null = null;

/**
 * ADR-032：本地会话按签发时间计算有效期（默认 30 分钟，不随请求滑动续期），
 * 到期后任何受保护请求都会返回 401。AuthProvider 在这里登记回调，把认证态
 * 收敛为匿名，交给 RequireAuth 走 `/login` → 统一身份认证入口静默重登，
 * 而不是把用户停在「重试也无效」的报错上。
 */
export function registerSessionExpiredHandler(
  next: SessionExpiredHandler | null,
): void {
  handler = next;
}

/**
 * react-query 全局错误回调入口：只有 401 代表会话失效；403、404、409、500
 * 等一律保持各页面原有展示，不触发跳转。
 */
export function reportSessionExpired(error: unknown): void {
  if (!isUnauthenticated(error) || handler === null) {
    return;
  }
  handler();
}

/** 测试辅助：清空已登记的处理器，避免用例之间互相影响。 */
export function resetSessionExpiredHandler(): void {
  handler = null;
}
