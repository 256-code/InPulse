import { randomBytes } from "node:crypto";

import { describe, expect, test } from "vitest";

import type { AuditChainHead } from "../src/checkpoint.js";
import {
  buildCheckpointEnvelope,
  encodeCheckpointEnvelope,
  parseCheckpointEnvelope,
  verifyCheckpointEnvelope,
} from "../src/checkpoint.js";
import type { ArchiveSigningKeyring } from "../src/config.js";

const key = randomBytes(32);
const keyring: ArchiveSigningKeyring = {
  currentVersion: 2,
  keys: new Map([
    [1, randomBytes(32)],
    [2, key],
  ]),
};

const head: AuditChainHead = {
  chainId: "PROJECT:42",
  projectId: 42,
  lastSequenceNo: 1234,
  lastHash: "ab".repeat(32),
  keyVersion: 3,
  headUpdatedAt: "2026-09-11T11:59:00.000000Z",
};

describe("审计链头检查点", () => {
  test("构造、编码与验签往返一致", () => {
    const generatedAt = new Date("2026-09-11T12:00:00.000Z");
    const envelope = buildCheckpointEnvelope(head, generatedAt, keyring);
    expect(envelope.payload.lastSequenceNo).toBe(1234);
    expect(envelope.payload.chainId).toBe("PROJECT:42");
    expect(envelope.signingKeyVersion).toBe(2);
    expect(envelope.signature).toMatch(/^[0-9a-f]{64}$/);

    const text = encodeCheckpointEnvelope(envelope).toString("utf8");
    expect(text.endsWith("\n")).toBe(true);
    const parsed = parseCheckpointEnvelope(text);
    verifyCheckpointEnvelope(parsed, keyring.keys);
    expect(parsed.payload.generatedAt).toBe("2026-09-11T12:00:00.000Z");
  });

  test("篡改 payload 或使用未知密钥版本验签失败", () => {
    const envelope = buildCheckpointEnvelope(head, new Date(), keyring);
    const tampered = {
      ...envelope,
      payload: { ...envelope.payload, lastSequenceNo: 9999 },
    };
    expect(() => verifyCheckpointEnvelope(tampered, keyring.keys)).toThrow(
      "verification failed",
    );
    const unknownVersion = { ...envelope, signingKeyVersion: 99 };
    expect(() =>
      verifyCheckpointEnvelope(unknownVersion, keyring.keys),
    ).toThrow("no archive signing key");
  });

  test("拒绝非法 envelope 结构", () => {
    expect(() => parseCheckpointEnvelope("{}")).toThrow("algorithm");
    expect(() =>
      parseCheckpointEnvelope(
        JSON.stringify({
          algorithm: "HMAC-SHA256",
          canonicalVersion: "JCS-1",
          signature: "x",
          signingKeyVersion: 1,
        }),
      ),
    ).toThrow("payload");
  });
});
