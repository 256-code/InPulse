import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";
import { AUDIT_CHAIN_ID_MAX_LENGTH } from "@inpulse/api-contract";

import { SESSION_HMAC_KEYRING } from "../auth/auth.constants.js";
import { VersionedHmacKeyring } from "../auth/keyring.js";

/** 与 Session Token 使用同一版本化 keyring，通过独立 domain 分隔用途。 */
const AUDIT_CURSOR_DOMAIN = "inpulse.audit-cursor.v1:";

/** 原始审计游标 TTL 与搜索游标一致：15 分钟。 */
export const AUDIT_CURSOR_TTL_MS = 15 * 60 * 1_000;

const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const BASE64URL_HASH_LENGTH = 43;

/** `occurred_at` 由查询侧 to_char 产出：UTC ISO、必带 1..6 位小数秒与 Z。 */
const UTC_ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

interface AuditCursorPayload {
  readonly v: number;
  readonly u: number;
  readonly q: string;
  readonly a: string;
  readonly e: number;
  /** 跨链游标（ADR-061）才有：上一页最后一条的 chain_id。 */
  readonly c?: string;
  /** 跨链游标（ADR-061）才有：上一页最后一条的 occurred_at（UTC ISO）。 */
  readonly t?: string;
}

/** 游标位置：单链游标只有 sequenceNo，跨链游标另带对齐用的链坐标。 */
export interface AuditCursorPosition {
  readonly sequenceNo: number;
  /** 跨链游标：上一页最后一条的 `chain_id`。 */
  readonly chainId?: string;
  /** 跨链游标：上一页最后一条的 `occurred_at`（UTC ISO，微秒精度）。 */
  readonly occurredAt?: string;
}

export interface AuditCursorEncodeInput {
  readonly actorUserId: number;
  /** 查询条件指纹（链 ID 与全部过滤条件的规范化文本），不得包含返回正文。 */
  readonly queryFingerprint: string;
  readonly afterSequenceNo: number;
  /** 跨链分页才有：与 afterOccurredAt 成对提供。 */
  readonly afterChainId?: string;
  /** 跨链分页才有：与 afterChainId 成对提供。 */
  readonly afterOccurredAt?: string;
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
  if ((payload.c === undefined) !== (payload.t === undefined)) {
    fail("malformed", "audit cursor chain coordinates must be paired");
  }
  if (payload.c !== undefined) {
    if (
      typeof payload.c !== "string" ||
      payload.c.length === 0 ||
      payload.c.length > AUDIT_CHAIN_ID_MAX_LENGTH
    ) {
      fail("malformed", "audit cursor chain id is invalid");
    }
    if (typeof payload.t !== "string" || !UTC_ISO_PATTERN.test(payload.t)) {
      fail("malformed", "audit cursor occurred at is invalid");
    }
  }

  return {
    v: payload.v!,
    u: payload.u!,
    q: payload.q,
    a: payload.a,
    e: payload.e!,
    ...(payload.c !== undefined && payload.t !== undefined
      ? { c: payload.c, t: payload.t }
      : {}),
  };
}

/**
 * 原始审计游标：base64url(payload).base64url(HMAC-SHA256)。Token 绑定
 * keyring 版本、操作者、查询条件指纹（链 ID 与过滤条件）和位置坐标，并带
 * 绝对过期时间；单链分页只带 afterSequenceNo，跨链分页（ADR-061）另带
 * 上一页最后一条的 chainId 与 occurredAt。校验失败统一由 AuditQueryService
 * 映射为 422。
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
    if (
      (input.afterChainId === undefined) !==
      (input.afterOccurredAt === undefined)
    ) {
      throw new Error(
        "audit cursor chain coordinates must be provided together",
      );
    }

    const payload: AuditCursorPayload = {
      v: this.keyring.currentVersion,
      u: input.actorUserId,
      q: fingerprintHash(input.queryFingerprint),
      a: String(input.afterSequenceNo),
      e: expiresAt,
      ...(input.afterChainId !== undefined &&
      input.afterOccurredAt !== undefined
        ? { c: input.afterChainId, t: input.afterOccurredAt }
        : {}),
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
  ): AuditCursorPosition | null {
    if (cursor === undefined) {
      return null;
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
    return {
      sequenceNo: afterSequenceNo,
      ...(payload.c !== undefined && payload.t !== undefined
        ? { chainId: payload.c, occurredAt: payload.t }
        : {}),
    };
  }
}
