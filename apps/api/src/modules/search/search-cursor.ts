import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { SESSION_HMAC_KEYRING } from "../../auth/auth.constants.js";
import { VersionedHmacKeyring } from "../../auth/keyring.js";

/** 与 Session Token 使用同一版本化 keyring，但通过独立 domain 分隔用途。 */
const SEARCH_CURSOR_DOMAIN = "inpulse.search-cursor.v1:";

/** 候选实现：游标签发后 15 分钟过期，最终 TTL 由 A 在正式契约中定案。 */
export const SEARCH_CURSOR_TTL_MS = 15 * 60 * 1_000;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const BASE64URL_HASH_LENGTH = 43;

interface SearchCursorPayload {
  readonly v: number;
  readonly u: number;
  readonly q: string;
  readonly a: string;
  readonly e: number;
}

export interface SearchCursorEncodeInput {
  readonly actorUserId: number;
  readonly normalizedQuery: string;
  readonly afterId: bigint;
  readonly nowMs?: number;
}

export interface SearchCursorDecodeContext {
  readonly actorUserId: number;
  readonly normalizedQuery: string;
  readonly nowMs?: number;
}

export type SearchCursorErrorReason =
  | "malformed"
  | "signature"
  | "version"
  | "expired"
  | "actor-mismatch"
  | "query-mismatch";

export class SearchCursorError extends Error {
  readonly reason: SearchCursorErrorReason;

  constructor(reason: SearchCursorErrorReason, message: string) {
    super(message);
    this.name = "SearchCursorError";
    this.reason = reason;
  }
}

function queryHash(normalizedQuery: string): string {
  return createHash("sha256")
    .update(`${SEARCH_CURSOR_DOMAIN}\0${normalizedQuery}`, "utf8")
    .digest("base64url");
}

function sign(payload: string, key: Buffer): Buffer {
  return createHmac("sha256", key)
    .update(`${SEARCH_CURSOR_DOMAIN}${payload}`, "utf8")
    .digest();
}

function fail(reason: SearchCursorErrorReason, message: string): never {
  throw new SearchCursorError(reason, message);
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function parsePayload(raw: string): SearchCursorPayload {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    fail("malformed", "search cursor payload is not valid JSON");
  }
  if (typeof value !== "object" || value === null) {
    fail("malformed", "search cursor payload must be an object");
  }

  const payload = value as Partial<SearchCursorPayload>;
  if (!positiveInteger(payload.v ?? 0)) {
    fail("malformed", "search cursor key version is invalid");
  }
  if (!positiveInteger(payload.u ?? 0)) {
    fail("malformed", "search cursor actor id is invalid");
  }
  if (
    typeof payload.q !== "string" ||
    payload.q.length !== BASE64URL_HASH_LENGTH ||
    !BASE64URL_PATTERN.test(payload.q)
  ) {
    fail("malformed", "search cursor query hash is invalid");
  }
  if (typeof payload.a !== "string" || !/^[1-9][0-9]*$/.test(payload.a)) {
    fail("malformed", "search cursor after id is invalid");
  }
  if (!positiveInteger(payload.e ?? 0)) {
    fail("malformed", "search cursor expiry is invalid");
  }

  return {
    v: payload.v!,
    u: payload.u!,
    q: payload.q,
    a: payload.a,
    e: payload.e!,
  };
}

/**
 * 搜索游标：base64url(payload).base64url(HMAC-SHA256)。Token 绑定 keyring
 * 版本、actor、规范化查询和 afterId，并带绝对过期时间；校验失败统一由
 * SearchQueryService 映射为 422 invalid-cursor。
 */
@Injectable()
export class SearchCursorService {
  constructor(
    @Inject(SESSION_HMAC_KEYRING)
    private readonly keyring: VersionedHmacKeyring,
  ) {}

  encode(input: SearchCursorEncodeInput): string {
    const nowMs = input.nowMs ?? Date.now();
    const expiresAt = nowMs + SEARCH_CURSOR_TTL_MS;
    if (input.afterId <= 0n) {
      throw new Error("search cursor afterId must be a positive bigint");
    }

    const payload: SearchCursorPayload = {
      v: this.keyring.currentVersion,
      u: input.actorUserId,
      q: queryHash(input.normalizedQuery),
      a: input.afterId.toString(),
      e: expiresAt,
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
    context: SearchCursorDecodeContext,
  ): bigint {
    if (cursor === undefined) {
      return 0n;
    }

    const separator = cursor.indexOf(".");
    if (
      separator <= 0 ||
      separator === cursor.length - 1 ||
      cursor.indexOf(".", separator + 1) !== -1
    ) {
      fail("malformed", "search cursor must contain one payload and signature");
    }
    const encoded = cursor.slice(0, separator);
    const signatureRaw = cursor.slice(separator + 1);
    if (
      !BASE64URL_PATTERN.test(encoded) ||
      !BASE64URL_PATTERN.test(signatureRaw)
    ) {
      fail("malformed", "search cursor contains invalid base64url characters");
    }

    const payload = parsePayload(encoded);
    let key: Buffer;
    try {
      key = this.keyring.keyFor(payload.v);
    } catch {
      fail("version", "search cursor key version is not available");
    }

    const expected = sign(encoded, key);
    const provided = Buffer.from(signatureRaw, "base64url");
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(expected, provided)
    ) {
      fail("signature", "search cursor signature is invalid");
    }

    const nowMs = context.nowMs ?? Date.now();
    if (nowMs >= payload.e) {
      fail("expired", "search cursor has expired");
    }
    if (payload.u !== context.actorUserId) {
      fail("actor-mismatch", "search cursor actor does not match");
    }
    if (payload.q !== queryHash(context.normalizedQuery)) {
      fail("query-mismatch", "search cursor query does not match");
    }

    return BigInt(payload.a);
  }
}
