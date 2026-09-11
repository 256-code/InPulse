/**
 * JSON Canonicalization Scheme（RFC 8785）的确定性序列化。
 *
 * 两处使用方需要完全一致的规范化语义：
 * - 幂等请求摘要的“JCS 规范化 body”（apps/api）；
 * - 审计归档的链头检查点与导出清单签名（apps/ops）。
 *
 * 规则：对象键按 UTF-16 code unit 升序排列；字符串/数字交给 ECMAScript 序列化；
 * 拒绝非有限数字与 JSON 不支持的值（undefined、函数、BigInt、Symbol）。
 */

function assertJsonValue(value: unknown, path: string): void {
  if (value === undefined) {
    throw new Error(`JCS: undefined value at ${path}`);
  }
  if (typeof value === "function" || typeof value === "symbol") {
    throw new Error(`JCS: unsupported value at ${path}`);
  }
  if (typeof value === "bigint") {
    throw new Error(`JCS: BigInt is not supported at ${path}`);
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new Error(`JCS: non-finite number at ${path}`);
  }
}

function sortKeys(left: string, right: string): number {
  // JS 字符串比较按 UTF-16 code unit 字典序，与 RFC 8785 一致。
  return left < right ? -1 : left > right ? 1 : 0;
}

function serialize(value: unknown, path: string): unknown {
  assertJsonValue(value, path);

  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    // JSON.stringify 使用 ECMAScript Number 序列化，即最短往返表示，符合 JCS。
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => serialize(item, `${path}[${index}]`));
  }
  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error(`JCS: non-plain object at ${path}`);
    }
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    for (const key of Object.keys(source).sort(sortKeys)) {
      out[key] = serialize(source[key], `${path}.${key}`);
    }
    return out;
  }

  throw new Error(`JCS: unsupported value at ${path}`);
}

export function canonicalizeJson(value: unknown): string {
  return JSON.stringify(serialize(value, "$"));
}
