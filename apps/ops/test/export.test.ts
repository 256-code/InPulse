import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import type { ArchiveSigningKeyring } from "../src/config.js";
import type { AuditExportRow } from "../src/export.js";
import {
  AUDIT_EXPORT_MAGIC,
  buildAuditExportManifest,
  buildAuditExportPackage,
  decryptAuditExportPackage,
  encodeAuditExportManifest,
  parseAuditExportManifest,
  parseAuditExportPackage,
  serializeAuditRows,
  verifyAuditExportManifest,
} from "../src/export.js";

const key = randomBytes(32);
const keyring: ArchiveSigningKeyring = {
  currentVersion: 1,
  keys: new Map([[1, key]]),
};

const row: AuditExportRow = {
  chainId: "SYSTEM",
  sequenceNo: 7,
  projectId: null,
  actorType: "SYSTEM",
  actorId: null,
  action: "USER_CREATED",
  targetType: "USER",
  targetId: "3",
  eventPayload: { loginName: "seed", nested: { b: 1, a: 2 } },
  requestId: "req-1",
  clientRequestId: null,
  ipAddress: null,
  userAgent: null,
  occurredAt: "2026-09-10T12:00:00.000000Z",
  prevHash: "ab".repeat(32),
  recordHash: "cd".repeat(32),
  keyVersion: 1,
  canonicalVersion: "JCS-1",
};

const window = {
  from: new Date("2026-09-10T00:00:00.000Z"),
  to: new Date("2026-09-11T00:00:00.000Z"),
};

describe("审计明细导出包", () => {
  test("行序列化为 JCS JSONL（嵌套对象键稳定）", () => {
    const text = serializeAuditRows([row]).toString("utf8");
    expect(text.endsWith("\n")).toBe(true);
    const parsed = JSON.parse(text.trim()) as AuditExportRow;
    expect(text.trim()).toBe(
      JSON.stringify(
        JSON.parse(JSON.stringify(parsed)),
        Object.keys(parsed).sort().length > 0 ? undefined : undefined,
      ),
    );
    expect(text).toContain('"nested":{"a":2,"b":1}');
    expect(serializeAuditRows([]).length).toBe(0);
  });

  test("打包、解析与解密往返一致", () => {
    const built = buildAuditExportPackage([row], window, keyring);
    expect(
      built.file.subarray(0, AUDIT_EXPORT_MAGIC.length).toString("utf8"),
    ).toBe(AUDIT_EXPORT_MAGIC);
    const parsed = parseAuditExportPackage(built.file);
    expect(parsed.header.rowCount).toBe(1);
    const decrypted = decryptAuditExportPackage(built.file, keyring.keys);
    const lines = decrypted.plaintext.toString("utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "")).toEqual(JSON.parse(JSON.stringify(row)));
  });

  test("篡改密文或 magic 校验失败", () => {
    const built = buildAuditExportPackage([row], window, keyring);
    const tampered = Buffer.from(built.file);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 0xff;
    expect(() => decryptAuditExportPackage(tampered, keyring.keys)).toThrow();

    const badMagic = Buffer.from(built.file);
    badMagic.write("X", 0);
    expect(() => parseAuditExportPackage(badMagic)).toThrow("magic");
  });

  test("清单签名、哈希绑定与验签", () => {
    const built = buildAuditExportPackage([row], window, keyring);
    const packageKey = "inpulse/audit/exports/date=2026-09-10/package.enc";
    const manifest = buildAuditExportManifest(
      built.header,
      built.ciphertext,
      packageKey,
      new Date("2026-09-11T00:10:00.000Z"),
      keyring,
    );
    const text = encodeAuditExportManifest(manifest).toString("utf8");
    const parsed = parseAuditExportManifest(text);
    verifyAuditExportManifest(parsed, keyring.keys);
    expect(parsed.payload.packageObjectKey).toBe(packageKey);
    expect(parsed.payload.rowCount).toBe(1);

    const tampered = {
      ...parsed,
      payload: { ...parsed.payload, rowCount: 999 },
    };
    expect(() => verifyAuditExportManifest(tampered, keyring.keys)).toThrow(
      "verification failed",
    );
  });
});
