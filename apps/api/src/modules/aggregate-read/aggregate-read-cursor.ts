import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { SESSION_HMAC_KEYRING } from "../../auth/auth.constants.js";
import { VersionedHmacKeyring } from "../../auth/keyring.js";

/** 与 Session / 搜索游标共用版本化 keyring，通过独立 domain 与命名空间分隔用途。 */
const AGGREGATE_READ_CURSOR_DOMAIN = "inpulse.aggregate-read-cursor.v1:";

/** 正式契约：游标签发后 15 分钟过期（C-006 / A 裁决 Q-10）。 */
export const AGGREGATE_READ_CURSOR_TTL_MS = 15 * 60 * 1_000;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const BASE64URL_HASH_LENGTH = 43;

export type AggregateReadCursorNamespace = "MY_TASKS" | "TASK_GROUP_RECORDS";

interface AggregateReadCursorPayload {
  readonly v: number;
  readonly u: number;
  readonly n: string;
  readonly f: string;
  readonly a: string;
  readonly e: number;
}

export interface AggregateReadCursorEncodeInput {
  readonly actorUserId: number;
  readonly namespace: AggregateReadCursorNamespace;
  /** 规范化筛选文本；必须稳定复现，否则解码按筛选不匹配拒绝。 */
  readonly filterKey: string;
  readonly afterId: number;
  readonly nowMs?: number;
}

export interface AggregateReadCursorDecodeContext {
  readonly actorUserId: number;
  readonly namespace: AggregateReadCursorNamespace;
  readonly filterKey: string;
  readonly nowMs?: number;
}

export type AggregateReadCursorErrorReason =
  | "malformed"
  | "signature"
  | "version"
  | "expired"
  | "actor-mismatch"
  | "namespace-mismatch"
  | "filter-mismatch";

export class AggregateReadCursorError extends Error {
  readonly reason: AggregateReadCursorErrorReason;

  constructor(reason: AggregateReadCursorErrorReason, message: string) {
    super(message);
    this.name = "AggregateReadCursorError";
    this.reason = reason;
  }
}

function filterHash(
  namespace: AggregateReadCursorNamespace,
  filterKey: string,
): string {
  return createHash("sha256")
    .update(`${AGGREGATE_READ_CURSOR_DOMAIN}${namespace}\0${filterKey}`, "utf8")
    .digest("base64url");
}

function sign(payload: string, key: Buffer): Buffer {
  return createHmac("sha256", key)
    .update(`${AGGREGATE_READ_CURSOR_DOMAIN}${payload}`, "utf8")
    .digest();
}

function fail(reason: AggregateReadCursorErrorReason, message: string): never {
  throw new AggregateReadCursorError(reason, message);
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function parsePayload(raw: string): AggregateReadCursorPayload {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    fail("malformed", "aggregate read cursor payload is not valid JSON");
  }
  if (typeof value !== "object" || value === null) {
    fail("malformed", "aggregate read cursor payload must be an object");
  }
  const payload = value as Partial<AggregateReadCursorPayload>;
  if (!positiveInteger(payload.v ?? 0)) {
    fail("malformed", "aggregate read cursor key version is invalid");
  }
  if (!positiveInteger(payload.u ?? 0)) {
    fail("malformed", "aggregate read cursor actor id is invalid");
  }
  if (
    typeof payload.n !== "string" ||
    payload.n.length === 0 ||
    payload.n.length > 64
  ) {
    fail("malformed", "aggregate read cursor namespace is invalid");
  }
  if (
    typeof payload.f !== "string" ||
    payload.f.length !== BASE64URL_HASH_LENGTH ||
    !BASE64URL_PATTERN.test(payload.f)
  ) {
    fail("malformed", "aggregate read cursor filter hash is invalid");
  }
  if (typeof payload.a !== "string" || !/^[1-9][0-9]*$/.test(payload.a)) {
    fail("malformed", "aggregate read cursor after id is invalid");
  }
  if (!positiveInteger(payload.e ?? 0)) {
    fail("malformed", "aggregate read cursor expiry is invalid");
  }
  return {
    v: payload.v!,
    u: payload.u!,
    n: payload.n!,
    f: payload.f!,
    a: payload.a,
    e: payload.e!,
  };
}

/**
 * 聚合读游标：base64url(payload).base64url(HMAC-SHA256)。Token 绑定 keyring 版本、
 * actor、命名空间、规范化筛选与 afterId，并带绝对过期时间；校验失败由聚合读服务
 * 统一映射为 422 invalid-cursor。
 */
@Injectable()
export class AggregateReadCursorService {
  constructor(
    @Inject(SESSION_HMAC_KEYRING)
    private readonly keyring: VersionedHmacKeyring,
  ) {}

  encode(input: AggregateReadCursorEncodeInput): string {
    const nowMs = input.nowMs ?? Date.now();
    if (!positiveInteger(input.afterId)) {
      throw new Error(
        "aggregate read cursor afterId must be a positive integer",
      );
    }
    const payload: AggregateReadCursorPayload = {
      v: this.keyring.currentVersion,
      u: input.actorUserId,
      n: input.namespace,
      f: filterHash(input.namespace, input.filterKey),
      a: String(input.afterId),
      e: nowMs + AGGREGATE_READ_CURSOR_TTL_MS,
    };
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    return `${encoded}.${sign(encoded, this.keyring.currentKey()).toString(
      "base64url",
    )}`;
  }

  decode(
    cursor: string | undefined,
    context: AggregateReadCursorDecodeContext,
  ): number | null {
    if (cursor === undefined) {
      return null;
    }
    const separator = cursor.indexOf(".");
    if (
      separator <= 0 ||
      separator === cursor.length - 1 ||
      cursor.indexOf(".", separator + 1) !== -1
    ) {
      fail(
        "malformed",
        "aggregate read cursor must contain one payload and signature",
      );
    }
    const encoded = cursor.slice(0, separator);
    const signatureRaw = cursor.slice(separator + 1);
    if (
      !BASE64URL_PATTERN.test(encoded) ||
      !BASE64URL_PATTERN.test(signatureRaw)
    ) {
      fail(
        "malformed",
        "aggregate read cursor contains invalid base64url characters",
      );
    }
    const payload = parsePayload(encoded);
    let key: Buffer;
    try {
      key = this.keyring.keyFor(payload.v);
    } catch {
      fail("version", "aggregate read cursor key version is not available");
    }
    const expected = sign(encoded, key);
    const provided = Buffer.from(signatureRaw, "base64url");
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(expected, provided)
    ) {
      fail("signature", "aggregate read cursor signature is invalid");
    }
    const nowMs = context.nowMs ?? Date.now();
    if (nowMs >= payload.e) {
      fail("expired", "aggregate read cursor has expired");
    }
    if (payload.u !== context.actorUserId) {
      fail("actor-mismatch", "aggregate read cursor actor does not match");
    }
    if (payload.n !== context.namespace) {
      fail(
        "namespace-mismatch",
        "aggregate read cursor namespace does not match",
      );
    }
    if (payload.f !== filterHash(context.namespace, context.filterKey)) {
      fail("filter-mismatch", "aggregate read cursor filter does not match");
    }
    const afterId = Number(payload.a);
    if (!positiveInteger(afterId)) {
      fail("malformed", "aggregate read cursor after id is out of range");
    }
    return afterId;
  }
}
