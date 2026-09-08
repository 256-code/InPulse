import { isIP } from "node:net";

/**
 * 只把显式声明为受信的内部代理 CIDR 加入 Express trust proxy。
 * 未配置时默认 loopback，避免直接连接的用户通过伪造 `X-Forwarded-*`
 * 改变登录 IP 限流维度。
 */
export function trustedProxySetting(raw: string | undefined): string {
  const configured =
    raw
      ?.split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0) ?? [];
  const entries = configured.length === 0 ? ["loopback"] : configured;
  for (const entry of entries) {
    if (entry === "loopback") {
      continue;
    }
    const [address, prefix] = entry.split("/");
    if (prefix !== undefined) {
      const length = Number.parseInt(prefix, 10);
      const family = isIP(address ?? "");
      if (
        !/^\d{1,3}$/.test(prefix) ||
        length < 0 ||
        family === 0 ||
        length > (family === 4 ? 32 : 128)
      ) {
        throw new Error(`invalid TRUSTED_PROXY_CIDRS entry: ${entry}`);
      }
      continue;
    }
    if (isIP(entry) === 0) {
      throw new Error(`invalid TRUSTED_PROXY_CIDRS entry: ${entry}`);
    }
  }
  return entries.join(", ");
}
