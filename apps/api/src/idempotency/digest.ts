import { createHmac, type KeyObject } from "node:crypto";

import { canonicalizeJson } from "./jcs.js";

/** 幂等请求摘要的格式标识（随幂等契约版本一并发散）。 */
export const idempotencyDigestFormat = "jcs-hmac-sha256-v1";

/**
 * 幂等请求摘要的全部语义输入。
 *
 * 参与摘要的字段（技术设计/AGENTS 第 6 节）：
 * 大写 method、operationId、幂等契约版本、摘要格式与请求 Schema 版本、
 * Schema 解析后的 path 参数、规范 query、规范 Content-Type、
 * Route Registry 声明的全部行为相关请求头、JCS 规范化 body；
 * 使用版本头的路由必须在 `ifMatch` 携带 `If-Match` 值。
 *
 * 明确排除（不得进入摘要）：Cookie、Authorization、CSRF、追踪头、Idempotency-Key。
 * 这些字段不在此类型中，调用方也不得传入。
 */
export interface IdempotencyDigestInput {
  readonly method: string;
  readonly operationId: string;
  readonly idempotencyContractVersion: string;
  readonly digestFormat: string;
  readonly requestSchemaVersion: string;
  readonly pathParams: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, string | readonly string[]>>;
  readonly contentType: string;
  readonly behaviorHeaders: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly ifMatch: string | undefined;
}

export type IdempotencyHmacKey = string | Buffer | KeyObject;

/**
 * 构造幂等请求摘要。
 *
 * 使用独立、带版本密钥的 HMAC-SHA-256（密钥由调用方按幂等契约版本派生/加载，
 * 本函数不接触 Secret 本身）。body 经 JCS 规范化；对象键与数组顺序只保留结构，
 * 字段顺序不影响摘要。
 */
export function buildIdempotencyDigest(
  input: IdempotencyDigestInput,
  hmacKey: IdempotencyHmacKey,
): string {
  const payload = {
    method: input.method.toUpperCase(),
    operationId: input.operationId,
    idempotencyContractVersion: input.idempotencyContractVersion,
    digestFormat: input.digestFormat,
    requestSchemaVersion: input.requestSchemaVersion,
    pathParams: input.pathParams,
    query: input.query,
    contentType: input.contentType,
    behaviorHeaders: input.behaviorHeaders,
    body: input.body,
    ...(input.ifMatch === undefined ? {} : { ifMatch: input.ifMatch }),
  };

  const canonical = canonicalizeJson(payload);
  return createHmac("sha256", hmacKey).update(canonical, "utf8").digest("hex");
}
