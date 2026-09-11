import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { SESSION_HMAC_KEYRING } from "../auth/auth.constants.js";
import { VersionedHmacKeyring } from "../auth/keyring.js";

/** 与 Session Token 使用同一版本化 keyring，通过独立 domain 分隔用途。 */
const AUDIT_CURSOR_DOMAIN = "inpulse.audit-cursor.v1:";

/** 原始审计游标 TTL 与搜索游标一致：15 分钟。 */
export const AUDIT_CURSOR_TTL_MS = 15 * 60 * 1_000;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const BASE64URL_HASH_LENGTH = 43;

interface AuditCursorPayload {
  readonly v: number;
  readonly u: number;
  readonly q: string;
  readonly a: string;
  readonly e: number;
}

export interface AuditCursorEncodeInput {
  readonly actorUserId: number;
  /** 查询条件指纹（链 ID 与全部过滤条件的规范化文本），不得包含返回正文。 */
  readonly queryFingerprint: string;
  readonly afterSequenceNo: number;
  readonly nowMs?: number;
}

export interface AuditCursorDecodeContext {
  readonly actorUserId: number;
  readonly queryFingerprint: string;
  readonly nowMs?: number;
}

export type AuditCursorErrorReason =
  | "malformed"
  | "signature"
  | "version"
  | "expired"
  | "actor-mismatch"
  | "query-mismatch";

export class AuditCursorError extends Error {
  readonly reason: AuditCursorErrorReason;

  constructor(reason: AuditCursorErrorReason, message: string) {
    super(message);
    this.name = "AuditCursorError";
    this.reason = reason;
  }
}

function fingerprintHash(queryFingerprint: string): string {
  return createHash("sha256")
    .update(`${AUDIT_CURSOR_DOMAIN}\0${queryFingerprint}`, "utf8")
    .digest("base64url");
}

function sign(payload: string, key: Buffer): Buffer {
  return createHmac("sha256", key)
    .update(`${AUDIT_CURSOR_DOMAIN}${payload}`, "utf8")
    .digest();
}

function fail(reason: AuditCursorErrorReason, message: string): never {
  throw new AuditCursorError(reason, message);
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function parsePayload(raw: string): AuditCursorPayload {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    fail("malformed", "audit cursor payload is not valid JSON");
  }
  if (typeof value !== "object" || value === null) {
    fail("malformed", "audit cursor payload must be an object");
  }

  const payload = value as Partial<AuditCursorPayload>;
  if (!positiveInteger(payload.v ?? 0)) {
    fail("malformed", "audit cursor key version is invalid");
  }
  if (!positiveInteger(payload.u ?? 0)) {
    fail("malformed", "audit cursor actor id is invalid");
  }
  if (
    typeof payload.q !== "string" ||
    payload.q.length !== BASE64URL_HASH_LENGTH ||
    !BASE64URL_PATTERN.test(payload.q)
  ) {
    fail("malformed", "audit cursor query hash is invalid");
  }
  if (typeof payload.a !== "string" || !/^[1-9][0-9]*$/.test(payload.a)) {
    fail("malformed", "audit cursor after sequence is invalid");
  }
  if (!positiveInteger(payload.e ?? 0)) {
    fail("malformed", "audit cursor expiry is invalid");
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
 * 原始审计游标：base64url(payload).base64url(HMAC-SHA256)。Token 绑定
 * keyring 版本、操作者、查询条件指纹（链 ID 与过滤条件）和 afterSequenceNo，
 * 并带绝对过期时间；校验失败统一由 AuditQueryService 映射为 422。
 */
@Injectable()
export class AuditCursorService {
  constructor(
    @Inject(SESSION_HMAC_KEYRING)
    private readonly keyring: VersionedHmacKeyring,
  ) {}

  encode(input: AuditCursorEncodeInput): string {
    const nowMs = input.nowMs ?? Date.now();
    const expiresAt = nowMs + AUDIT_CURSOR_TTL_MS;
    if (!positiveInteger(input.afterSequenceNo)) {
      throw new Error(
        "audit cursor afterSequenceNo must be a positive integer",
      );
    }

    const payload: AuditCursorPayload = {
      v: this.keyring.currentVersion,
      u: input.actorUserId,
      q: fingerprintHash(input.queryFingerprint),
      a: String(input.afterSequenceNo),
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
    context: AuditCursorDecodeContext,
  ): number {
    if (cursor === undefined) {
      return 0;
    }

    const separator = cursor.indexOf(".");
    if (
      separator <= 0 ||
      separator === cursor.length - 1 ||
      cursor.indexOf(".", separator + 1) !== -1
    ) {
      fail("malformed", "audit cursor must contain one payload and signature");
    }
    const encoded = cursor.slice(0, separator);
    const signatureRaw = cursor.slice(separator + 1);
    if (
      !BASE64URL_PATTERN.test(encoded) ||
      !BASE64URL_PATTERN.test(signatureRaw)
    ) {
      fail("malformed", "audit cursor contains invalid base64url characters");
    }

    const payload = parsePayload(encoded);
    let key: Buffer;
    try {
      key = this.keyring.keyFor(payload.v);
    } catch {
      fail("version", "audit cursor key version is not available");
    }

    const expected = sign(encoded, key);
    const provided = Buffer.from(signatureRaw, "base64url");
    if (
      provided.length !== expected.length ||
      !timingSafeEqual(expected, provided)
    ) {
      fail("signature", "audit cursor signature is invalid");
    }

    const nowMs = context.nowMs ?? Date.now();
    if (nowMs >= payload.e) {
      fail("expired", "audit cursor has expired");
    }
    if (payload.u !== context.actorUserId) {
      fail("actor-mismatch", "audit cursor actor does not match");
    }
    if (payload.q !== fingerprintHash(context.queryFingerprint)) {
      fail("query-mismatch", "audit cursor query does not match");
    }

    const afterSequenceNo = Number(payload.a);
    if (!Number.isSafeInteger(afterSequenceNo) || afterSequenceNo <= 0) {
      fail("malformed", "audit cursor after sequence is out of range");
    }
    return afterSequenceNo;
  }
}
