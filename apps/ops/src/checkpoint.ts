import { canonicalizeJson } from "@inpulse/canonical-json";

import {
  AUDIT_ARCHIVE_CANONICAL_VERSION,
  AUDIT_ARCHIVE_SIGNATURE_ALGORITHM,
  signCanonicalJson,
  verifyCanonicalSignature,
} from "./crypto.js";
import type { ArchiveSigningKeyring } from "./config.js";

/** app.audit_chain_heads 中一条链的当前头（F-08 步骤 6 检查点输入）。 */
export interface AuditChainHead {
  readonly chainId: string;
  readonly projectId: number | null;
  readonly lastSequenceNo: number;
  /** record_hash 十六进制（64 字符）。 */
  readonly lastHash: string;
  readonly keyVersion: number;
  /** 链头最后更新时间（ISO 8601 UTC）。 */
  readonly headUpdatedAt: string;
}

export interface AuditCheckpointPayload {
  readonly kind: "AUDIT_CHAIN_CHECKPOINT";
  readonly version: 1;
  readonly generatedAt: string;
  readonly chainId: string;
  readonly projectId: number | null;
  readonly lastSequenceNo: number;
  readonly lastHash: string;
  readonly keyVersion: number;
  readonly headUpdatedAt: string;
}

export interface AuditCheckpointEnvelope {
  readonly payload: AuditCheckpointPayload;
  readonly algorithm: typeof AUDIT_ARCHIVE_SIGNATURE_ALGORITHM;
  readonly canonicalVersion: typeof AUDIT_ARCHIVE_CANONICAL_VERSION;
  /** 归档签名密钥版本（独立于审计 HMAC key 版本）。 */
  readonly signingKeyVersion: number;
  readonly signature: string;
}

export function buildCheckpointEnvelope(
  head: AuditChainHead,
  generatedAt: Date,
  signingKeyring: ArchiveSigningKeyring,
): AuditCheckpointEnvelope {
  const key = signingKeyring.keys.get(signingKeyring.currentVersion);
  if (key === undefined) {
    throw new Error("archive signing keyring has no current key");
  }
  const payload: AuditCheckpointPayload = {
    kind: "AUDIT_CHAIN_CHECKPOINT",
    version: 1,
    generatedAt: generatedAt.toISOString(),
    chainId: head.chainId,
    projectId: head.projectId,
    lastSequenceNo: head.lastSequenceNo,
    lastHash: head.lastHash,
    keyVersion: head.keyVersion,
    headUpdatedAt: head.headUpdatedAt,
  };
  return {
    payload,
    algorithm: AUDIT_ARCHIVE_SIGNATURE_ALGORITHM,
    canonicalVersion: AUDIT_ARCHIVE_CANONICAL_VERSION,
    signingKeyVersion: signingKeyring.currentVersion,
    signature: signCanonicalJson(payload, key),
  };
}

/** 检查点对象内容：整段 envelope 的 JCS 规范化 + 末尾换行。 */
export function encodeCheckpointEnvelope(
  envelope: AuditCheckpointEnvelope,
): Buffer {
  return Buffer.from(`${canonicalizeJson(envelope)}\n`, "utf8");
}

export function parseCheckpointEnvelope(text: string): AuditCheckpointEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("checkpoint is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("checkpoint must be a JSON object");
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope["algorithm"] !== AUDIT_ARCHIVE_SIGNATURE_ALGORITHM) {
    throw new Error("checkpoint algorithm must be HMAC-SHA256");
  }
  if (envelope["canonicalVersion"] !== AUDIT_ARCHIVE_CANONICAL_VERSION) {
    throw new Error("checkpoint canonicalVersion must be JCS-1");
  }
  if (typeof envelope["signature"] !== "string") {
    throw new Error("checkpoint signature is missing");
  }
  if (typeof envelope["signingKeyVersion"] !== "number") {
    throw new Error("checkpoint signingKeyVersion is missing");
  }
  const payload = envelope["payload"];
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    throw new Error("checkpoint payload is missing");
  }
  return envelope as unknown as AuditCheckpointEnvelope;
}

/** 校验检查点签名；缺少对应版本密钥或签名不匹配时抛错。 */
export function verifyCheckpointEnvelope(
  envelope: AuditCheckpointEnvelope,
  keys: ReadonlyMap<number, Buffer>,
): void {
  const key = keys.get(envelope.signingKeyVersion);
  if (key === undefined) {
    throw new Error(
      `no archive signing key for version ${envelope.signingKeyVersion}`,
    );
  }
  if (!verifyCanonicalSignature(envelope.payload, key, envelope.signature)) {
    throw new Error("checkpoint signature verification failed");
  }
}
