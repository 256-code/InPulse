import type { RouteDefinition } from "@inpulse/api-contract";

import {
  buildIdempotencyDigest,
  idempotencyDigestFormat,
  type IdempotencyHmacKey,
} from "./digest.js";

export type HttpHeaderValue = string | readonly string[] | undefined;
export type HttpHeaderBag = Readonly<Record<string, HttpHeaderValue>>;
export type QueryValue = string | readonly string[];

export interface IdempotencyHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly pathParams: Readonly<Record<string, string>>;
  readonly query: Readonly<Record<string, unknown>>;
  readonly headers: HttpHeaderBag;
  readonly body: unknown;
}

export const IDEMPOTENCY_KEY_HEADER = "idempotency-key";

export function getHeader(
  headers: HttpHeaderBag,
  name: string,
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return typeof value === "string" ? value : undefined;
}

function getHeaderDigestValue(headers: HttpHeaderBag, name: string): string {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value.join(",");
  }
  return typeof value === "string" ? value : "";
}

export type IdempotencyKeyProblem = "missing" | "invalid";

/**
 * Idempotency-Key 只做格式校验，不进入请求摘要。
 * 长度与数据库约束一致，拒绝换行与首尾空白。
 */
export function idempotencyKeyProblem(
  headers: HttpHeaderBag,
): IdempotencyKeyProblem | undefined {
  const value = getHeader(headers, IDEMPOTENCY_KEY_HEADER);
  if (value === undefined || value.length === 0) {
    return "missing";
  }
  if (
    value.length < 16 ||
    value.length > 128 ||
    value.trim() !== value ||
    /[\r\n]/.test(value)
  ) {
    return "invalid";
  }
  return undefined;
}

/** 规范 query：字段名排序，字符串与字符串数组原样保留重复值语义。 */
export function normalizeQuery(
  query: Readonly<Record<string, unknown>>,
): Record<string, QueryValue> {
  const result: Record<string, QueryValue> = {};
  for (const key of Object.keys(query).sort()) {
    const value = query[key];
    if (typeof value === "string") {
      result[key] = value;
      continue;
    }
    if (
      Array.isArray(value) &&
      value.every((item) => typeof item === "string")
    ) {
      result[key] = [...value] as string[];
      continue;
    }
    throw new Error(
      `query parameter ${key} must be a string or an array of strings`,
    );
  }
  return result;
}

function pathParameterNames(routePath: string): string[] {
  return [...routePath.matchAll(/\{([A-Za-z0-9_-]+)\}/g)].map(
    (match) => match[1]!,
  );
}

function normalizePathParams(
  routePath: string,
  pathParams: Readonly<Record<string, string>>,
): Record<string, string> {
  const expected = pathParameterNames(routePath).sort();
  const actual = Object.keys(pathParams).sort();
  if (
    expected.length !== actual.length ||
    expected.some((name, index) => name !== actual[index])
  ) {
    throw new Error(
      `route path parameters do not match {${expected.join(", ")}}`,
    );
  }
  const normalized: Record<string, string> = {};
  for (const key of actual) {
    normalized[key] = pathParams[key]!;
  }
  return normalized;
}

function normalizeContentType(headers: HttpHeaderBag): string {
  const raw = getHeader(headers, "content-type");
  if (raw === undefined) {
    return "";
  }
  return raw.split(";")[0]!.trim().toLowerCase();
}

/**
 * 按 Route Registry 生成规范幂等请求摘要。
 * Cookie、Authorization、CSRF、追踪头、请求关联 ID 与 Idempotency-Key
 * 均不进入摘要；行为头缺失时以空字符串参与，保证缺席也改变摘要。
 */
export function buildIdempotencyRequestDigest(
  route: RouteDefinition,
  request: IdempotencyHttpRequest,
  hmacKey: IdempotencyHmacKey,
): string {
  const pathParams = normalizePathParams(route.path, request.pathParams);
  const query = normalizeQuery(request.query);
  const noBody =
    "noBody" in route.request.body && route.request.body.noBody === true;
  const contentType =
    noBody === true ? "none" : normalizeContentType(request.headers);
  const behaviorNames =
    route.behaviorHeaders === "none" ? [] : route.behaviorHeaders;
  const behaviorHeaders: Record<string, string> = {};
  for (const name of behaviorNames) {
    behaviorHeaders[name] = getHeaderDigestValue(request.headers, name);
  }

  return buildIdempotencyDigest(
    {
      method: request.method.toUpperCase(),
      operationId: route.operationId,
      idempotencyContractVersion: route.idempotencyContractVersion,
      digestFormat: idempotencyDigestFormat,
      requestSchemaVersion:
        route.idempotencyFingerprintVersion === "none"
          ? "none"
          : route.idempotencyFingerprintVersion,
      pathParams,
      query,
      contentType,
      behaviorHeaders,
      body: noBody === true ? null : (request.body ?? null),
      ifMatch: getHeader(request.headers, "if-match"),
    },
    hmacKey,
  );
}
