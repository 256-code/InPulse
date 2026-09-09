import { verify } from "@node-rs/argon2";

import { describe, expect, test, vi } from "vitest";

import { ConcurrencyGate } from "../src/auth/concurrency-gate.js";
import { RecoveryCodeService } from "../src/auth/recovery-code.service.js";

describe("RecoveryCodeService", () => {
  test("生成 10 个唯一高熵恢复码并保存 Argon2id 哈希", async () => {
    const service = new RecoveryCodeService();
    const batch = await service.issueBatch();

    expect(batch.plaintextCodes).toHaveLength(10);
    expect(new Set(batch.plaintextCodes).size).toBe(10);
    expect(batch.plaintextCodes).toEqual(
      expect.arrayContaining([expect.stringMatching(/^[A-HJ-NP-Z2-9]{20}$/)]),
    );
    expect(batch.hashes).toHaveLength(10);
    for (const code of batch.plaintextCodes) {
      expect(batch.hashes.some((item) => item.codeHash.includes(code))).toBe(
        false,
      );
    }
    for (const hash of batch.hashes) {
      expect(hash.codeHash.startsWith("$argon2id$")).toBe(true);
    }

    expect(
      await verify(batch.hashes[0]!.codeHash, batch.plaintextCodes[0]!),
    ).toBe(true);
  });

  test("findMatchingHash 命中时返回对应 Argon2id 哈希", async () => {
    const service = new RecoveryCodeService();
    const batch = await service.issueBatch();

    const matched = await service.findMatchingHash(
      batch.plaintextCodes[2]!,
      batch.hashes,
    );

    expect(matched).toBe(batch.hashes[2]!.codeHash);
  });

  test("findMatchingHash 未命中时返回 undefined", async () => {
    const service = new RecoveryCodeService();
    const batch = await service.issueBatch();

    const matched = await service.findMatchingHash(
      "Z".repeat(20),
      batch.hashes,
    );

    expect(matched).toBeUndefined();
  });

  test("findMatchingHash 对空列表直接返回 undefined", async () => {
    const service = new RecoveryCodeService();

    const matched = await service.findMatchingHash("A".repeat(20), []);

    expect(matched).toBeUndefined();
  });

  test("findMatchingHash 对所有候选执行受限并发校验", async () => {
    const service = new RecoveryCodeService();
    const batch = await service.issueBatch();
    const spy = vi.spyOn(ConcurrencyGate.prototype, "run");
    try {
      const matched = await service.findMatchingHash(
        batch.plaintextCodes[0]!,
        batch.hashes,
      );

      expect(matched).toBe(batch.hashes[0]!.codeHash);
      expect(spy).toHaveBeenCalledTimes(batch.hashes.length);
    } finally {
      spy.mockRestore();
    }
  });
});
