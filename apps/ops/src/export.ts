import { canonicalizeJson } from "@inpulse/canonical-json";

import {
  AUDIT_ARCHIVE_CANONICAL_VERSION,
  AUDIT_ARCHIVE_SIGNATURE_ALGORITHM,
  AUDIT_EXPORT_KDF_INFO,
  decryptAuditExport,
  encryptAuditExport,
  GCM_TAG_LENGTH,
  sha256Hex,
  signCanonicalJson,
  verifyCanonicalSignature,
} from "./crypto.js";
import type { ArchiveSigningKeyring } from "./config.js";

export const AUDIT_EXPORT_MAGIC = "INPULSE-AUDIT-EXPORT-1";
export const AUDIT_EXPORT_PACKAGE_VERSION = 1;
export const AUDIT_EXPORT_ALGORITHM = "AES-256-GCM";
export const AUDIT_EXPORT_KDF = "HKDF-SHA256";

/** 导出的一行原始审计（与 app.audit_logs 列一一对应，hash 为十六进制）。 */
export interface AuditExportRow {
  readonly chainId: string;
  readonly sequenceNo: number;
  readonly projectId: number | null;
  readonly actorType: string;
  readonly actorId: number | null;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly eventPayload: Readonly<Record<string, unknown>>;
  readonly requestId: string;
  readonly clientRequestId: string | null;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly occurredAt: string;
  readonly prevHash: string;
  readonly recordHash: string;
  readonly keyVersion: number;
  readonly canonicalVersion: string;
}

export interface AuditExportWindow {
  readonly from: Date;
  readonly to: Date;
}

export interface AuditExportHeader {
  readonly kind: "AUDIT_EXPORT_PACKAGE";
  readonly version: typeof AUDIT_EXPORT_PACKAGE_VERSION;
  readonly algorithm: typeof AUDIT_EXPORT_ALGORITHM;
  readonly kdf: typeof AUDIT_EXPORT_KDF;
  readonly kdfInfo: typeof AUDIT_EXPORT_KDF_INFO;
  readonly salt: string;
  readonly iv: string;
  readonly tagLength: number;
  readonly windowFrom: string;
  readonly windowTo: string;
  readonly rowCount: number;
  readonly plaintextSha256: string;
  readonly signingKeyVersion: number;
}

export interface AuditExportPackage {
  readonly header: AuditExportHeader;
  readonly ciphertext: Buffer;
}

const MAGIC_LINE = Buffer.from(`${AUDIT_EXPORT_MAGIC}\n`, "utf8");

/** 每行一条 JCS 规范化 JSON（对象键稳定排序，保证内容可重现）。 */
export function serializeAuditRows(rows: readonly AuditExportRow[]): Buffer {
  const lines = rows.map((row) => canonicalizeJson(row));
  return Buffer.from(lines.length === 0 ? "" : `${lines.join("\n")}\n`, "utf8");
}

export function buildAuditExportPackage(
  rows: readonly AuditExportRow[],
  window: AuditExportWindow,
  signingKeyring: ArchiveSigningKeyring,
): {
  readonly file: Buffer;
  readonly header: AuditExportHeader;
  readonly ciphertext: Buffer;
} {
  const key = signingKeyring.keys.get(signingKeyring.currentVersion);
  if (key === undefined) {
    throw new Error("archive signing keyring has no current key");
  }
  const plaintext = serializeAuditRows(rows);
  const encrypted = encryptAuditExport(plaintext, key);
  const header: AuditExportHeader = {
    kind: "AUDIT_EXPORT_PACKAGE",
    version: AUDIT_EXPORT_PACKAGE_VERSION,
    algorithm: AUDIT_EXPORT_ALGORITHM,
    kdf: AUDIT_EXPORT_KDF,
    kdfInfo: AUDIT_EXPORT_KDF_INFO,
    salt: encrypted.salt.toString("base64url"),
    iv: encrypted.iv.toString("base64url"),
    tagLength: GCM_TAG_LENGTH,
    windowFrom: window.from.toISOString(),
    windowTo: window.to.toISOString(),
    rowCount: rows.length,
    plaintextSha256: encrypted.plaintextSha256,
    signingKeyVersion: signingKeyring.currentVersion,
  };
  const file = Buffer.concat([
    MAGIC_LINE,
    Buffer.from(`${canonicalizeJson(header)}\n`, "utf8"),
    encrypted.ciphertext,
  ]);
  return { file, header, ciphertext: encrypted.ciphertext };
}

export function parseAuditExportPackage(file: Buffer): AuditExportPackage {
  const firstBreak = file.indexOf(0x0a);
  if (firstBreak < 0) {
    throw new Error("audit export package is missing the magic line");
  }
  if (file.subarray(0, firstBreak).toString("utf8") !== AUDIT_EXPORT_MAGIC) {
    throw new Error("audit export package magic mismatch");
  }
  const secondBreak = file.indexOf(0x0a, firstBreak + 1);
  if (secondBreak < 0) {
    throw new Error("audit export package is missing the header line");
  }
  const headerText = file
    .subarray(firstBreak + 1, secondBreak)
    .toString("utf8");
  let header: unknown;
  try {
    header = JSON.parse(headerText);
  } catch {
    throw new Error("audit export package header is not valid JSON");
  }
  if (typeof header !== "object" || header === null || Array.isArray(header)) {
    throw new Error("audit export package header must be an object");
  }
  const candidate = header as Record<string, unknown>;
  if (
    candidate["kind"] !== "AUDIT_EXPORT_PACKAGE" ||
    candidate["version"] !== AUDIT_EXPORT_PACKAGE_VERSION ||
    candidate["algorithm"] !== AUDIT_EXPORT_ALGORITHM ||
    candidate["kdf"] !== AUDIT_EXPORT_KDF
  ) {
    throw new Error("audit export package header is not supported");
  }
  return {
    header: header as unknown as AuditExportHeader,
    ciphertext: file.subarray(secondBreak + 1),
  };
}

/** 解密导出包并校验明文 SHA-256；密钥缺失、认证失败或哈希不符时抛错。 */
export function decryptAuditExportPackage(
  file: Buffer,
  keys: ReadonlyMap<number, Buffer>,
): { readonly header: AuditExportHeader; readonly plaintext: Buffer } {
  const parsed = parseAuditExportPackage(file);
  const key = keys.get(parsed.header.signingKeyVersion);
  if (key === undefined) {
    throw new Error(
      `no archive signing key for version ${parsed.header.signingKeyVersion}`,
    );
  }
  const plaintext = decryptAuditExport(
    parsed.ciphertext,
    key,
    Buffer.from(parsed.header.iv, "base64url"),
    Buffer.from(parsed.header.salt, "base64url"),
  );
  if (sha256Hex(plaintext) !== parsed.header.plaintextSha256) {
    throw new Error("audit export plaintext hash mismatch");
  }
  return { header: parsed.header, plaintext };
}

export interface AuditExportManifestPayload {
  readonly kind: "AUDIT_EXPORT_MANIFEST";
  readonly version: 1;
  readonly generatedAt: string;
  readonly windowFrom: string;
  readonly windowTo: string;
  readonly rowCount: number;
  readonly plaintextSha256: string;
  readonly ciphertextSha256: string;
  readonly ciphertextBytes: number;
  readonly packageObjectKey: string;
}

export interface AuditExportManifestEnvelope {
  readonly payload: AuditExportManifestPayload;
  readonly algorithm: typeof AUDIT_ARCHIVE_SIGNATURE_ALGORITHM;
  readonly canonicalVersion: typeof AUDIT_ARCHIVE_CANONICAL_VERSION;
  readonly signingKeyVersion: number;
  readonly signature: string;
}

export function buildAuditExportManifest(
  header: AuditExportHeader,
  ciphertext: Buffer,
  packageObjectKey: string,
  generatedAt: Date,
  signingKeyring: ArchiveSigningKeyring,
): AuditExportManifestEnvelope {
  const key = signingKeyring.keys.get(signingKeyring.currentVersion);
  if (key === undefined) {
    throw new Error("archive signing keyring has no current key");
  }
  const payload: AuditExportManifestPayload = {
    kind: "AUDIT_EXPORT_MANIFEST",
    version: 1,
    generatedAt: generatedAt.toISOString(),
    windowFrom: header.windowFrom,
    windowTo: header.windowTo,
    rowCount: header.rowCount,
    plaintextSha256: header.plaintextSha256,
    ciphertextSha256: sha256Hex(ciphertext),
    ciphertextBytes: ciphertext.length,
    packageObjectKey,
  };
  return {
    payload,
    algorithm: AUDIT_ARCHIVE_SIGNATURE_ALGORITHM,
    canonicalVersion: AUDIT_ARCHIVE_CANONICAL_VERSION,
    signingKeyVersion: signingKeyring.currentVersion,
    signature: signCanonicalJson(payload, key),
  };
}

export function encodeAuditExportManifest(
  envelope: AuditExportManifestEnvelope,
): Buffer {
  return Buffer.from(`${canonicalizeJson(envelope)}\n`, "utf8");
}

export function parseAuditExportManifest(
  text: string,
): AuditExportManifestEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("audit export manifest is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("audit export manifest must be a JSON object");
  }
  const envelope = parsed as Record<string, unknown>;
  if (envelope["algorithm"] !== AUDIT_ARCHIVE_SIGNATURE_ALGORITHM) {
    throw new Error("audit export manifest algorithm must be HMAC-SHA256");
  }
  if (envelope["canonicalVersion"] !== AUDIT_ARCHIVE_CANONICAL_VERSION) {
    throw new Error("audit export manifest canonicalVersion must be JCS-1");
  }
  if (
    typeof envelope["payload"] !== "object" ||
    envelope["payload"] === null ||
    Array.isArray(envelope["payload"])
  ) {
    throw new Error("audit export manifest payload is missing");
  }
  return envelope as unknown as AuditExportManifestEnvelope;
}

export function verifyAuditExportManifest(
  envelope: AuditExportManifestEnvelope,
  keys: ReadonlyMap<number, Buffer>,
): void {
  const key = keys.get(envelope.signingKeyVersion);
  if (key === undefined) {
    throw new Error(
      `no archive signing key for version ${envelope.signingKeyVersion}`,
    );
  }
  if (!verifyCanonicalSignature(envelope.payload, key, envelope.signature)) {
    throw new Error("audit export manifest signature verification failed");
  }
  if (envelope.payload.kind !== "AUDIT_EXPORT_MANIFEST") {
    throw new Error("audit export manifest kind mismatch");
  }
}
