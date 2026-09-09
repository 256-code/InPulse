import { randomBytes } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";
import { Injectable } from "@nestjs/common";

import { ConcurrencyGate } from "./concurrency-gate.js";
import type { RecoveryCodeHash } from "./mfa-recovery-code.repository.js";
import { ARGON2ID_OPTIONS } from "./password.service.js";

export const RECOVERY_CODE_COUNT = 10;
export const RECOVERY_CODE_LENGTH = 20;

const RECOVERY_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_RECOVERY_HASH_CONCURRENCY = 2;

export interface IssuedRecoveryCodes {
  readonly plaintextCodes: readonly string[];
  readonly hashes: readonly RecoveryCodeHash[];
}

/**
 * 恢复码生成与 Argon2id 哈希。明文只出现在单次响应，数据库只保存带独立
 * salt 与参数编码的哈希；CPU 密集哈希全部在事务外完成，不占用事务锁。
 */
@Injectable()
export class RecoveryCodeService {
  private readonly hashGate = new ConcurrencyGate(
    MAX_RECOVERY_HASH_CONCURRENCY,
  );

  async issueBatch(): Promise<IssuedRecoveryCodes> {
    const plaintextCodes = generateCodes();
    const hashes = await Promise.all(
      plaintextCodes.map((code) =>
        this.hashGate.run(() => hash(code, ARGON2ID_OPTIONS)),
      ),
    );
    return {
      plaintextCodes,
      hashes: hashes.map((codeHash) => ({ codeHash })),
    };
  }

  /**
   * 在事务外批量校验恢复码。所有候选 Hash 都执行 Argon2id 校验，
   * 成功后返回是否命中；数据库只保存哈希，调用方不得回传明文。
   */
  async verifyAny(
    code: string,
    hashes: readonly RecoveryCodeHash[],
  ): Promise<boolean> {
    return (await this.findMatchingHash(code, hashes)) !== undefined;
  }

  /**
   * 在事务外批量校验恢复码，并返回命中的 Argon2id 编码 Hash。
   * 所有候选 Hash 都执行校验以避免通过候选数量泄漏时序；调用方只能在
   * 随后的事务内通过该 Hash 条件消费，不得把明文写入数据库、日志或审计。
   */
  async findMatchingHash(
    code: string,
    hashes: readonly RecoveryCodeHash[],
  ): Promise<string | undefined> {
    if (hashes.length === 0) {
      return undefined;
    }
    const results = await Promise.all(
      hashes.map((hashRecord) =>
        this.hashGate.run(async () => {
          try {
            return await verify(hashRecord.codeHash, code);
          } catch {
            return false;
          }
        }),
      ),
    );
    const index = results.findIndex((matched) => matched);
    return index < 0 ? undefined : hashes[index]?.codeHash;
  }
}

function generateCodes(): readonly string[] {
  const codes = new Set<string>();
  while (codes.size < RECOVERY_CODE_COUNT) {
    const bytes = randomBytes(RECOVERY_CODE_LENGTH);
    let code = "";
    for (const byte of bytes) {
      code += RECOVERY_CODE_ALPHABET[byte % RECOVERY_CODE_ALPHABET.length]!;
    }
    codes.add(code);
  }
  return [...codes];
}
