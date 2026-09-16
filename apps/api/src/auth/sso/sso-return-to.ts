/** 未提供 return_to 时的回跳目标。 */
export const DEFAULT_SSO_RETURN_TO = "/";

const RETURN_TO_MAX_LENGTH = 2000;
/** 控制字符（含 DEL）判定：用码点比较，避免正则字面量里的控制字符。 */
function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x1f || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}
const PLACEHOLDER_ORIGIN = "https://inpulse.invalid";

function hasUnsafeCharacters(value: string): boolean {
  return (
    value.includes("\\") ||
    hasControlCharacters(value) ||
    /%5c/i.test(value) ||
    /%00/i.test(value)
  );
}

function decodeOnce(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

/**
 * 校验 SSO 回跳目标（ADR-032）：只接受站内相对路径，丢弃 fragment，
 * 拒绝协议相对地址（`//host`）、反斜杠、控制字符与双重编码的绕过写法，
 * 防止开放重定向。非法或缺失时返回 null，由调用方回落到默认目标。
 */
export function normalizeReturnTo(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > RETURN_TO_MAX_LENGTH) {
    return null;
  }
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return null;
  }
  if (hasUnsafeCharacters(trimmed)) {
    return null;
  }
  const decoded = decodeOnce(trimmed);
  if (decoded === undefined || hasUnsafeCharacters(decoded)) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== PLACEHOLDER_ORIGIN) {
    return null;
  }
  const path = `${parsed.pathname}${parsed.search}`;
  return path.startsWith("/") ? path : null;
}
