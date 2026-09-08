const CODE_MAX_LENGTH = 32;
const CODE_RE = /^[A-Z][A-Z0-9_]{1,31}$/;

/** 预留编码：请求显式提供时原样保留；未提供时用 ASCII 派生。 */
export function resolveProjectCode(name: string, explicit?: string): string {
  if (explicit !== undefined) {
    if (!CODE_RE.test(explicit)) {
      throw new Error("invalid project code");
    }
    return explicit;
  }
  const derived = deriveCode(name);
  if (!CODE_RE.test(derived)) {
    throw new Error("unable to derive project code from name");
  }
  return derived;
}

/**
 * 从项目名派生默认编码。只保留 ASCII 字母/数字，空白转为下划线，去重连续下划线，
 * 大写化，长度限制在 2～32。截断后若以数字或下划线开头则前缀 P。
 */
export function deriveCode(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
  if (normalized.length === 0) {
    throw new Error("unable to derive project code from name");
  }
  let code = normalized.slice(0, CODE_MAX_LENGTH);
  if (/^[0-9_]/.test(code)) {
    code = `P${code}`.slice(0, CODE_MAX_LENGTH);
  }
  if (code.length < 2) {
    code = `P${code}`;
  }
  if (!CODE_RE.test(code)) {
    throw new Error("unable to derive project code from name");
  }
  return code;
}
