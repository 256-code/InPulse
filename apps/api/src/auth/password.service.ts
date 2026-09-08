import { hashSync, verify, type Options } from "@node-rs/argon2";
import { Injectable } from "@nestjs/common";

import { ConcurrencyGate } from "./concurrency-gate.js";

// @node-rs/argon2 的 Algorithm 是 ambient const enum；NodeNext + verbatim
// syntax 不能运行时引用，Argon2id 的稳定数值为 2。
const ARGON2ID_ALGORITHM = 2;

/**
 * 候选并发上限：限制同一进程内并行的 Argon2id 计算，避免登录爆破耗尽 CPU。
 * 正式数值须结合生产机器基准由人工确认。
 */
const ARGON2_MAX_CONCURRENT_VERIFICATIONS = 4;

/**
 * ADR-011：密码固定使用 Argon2id，生产不得低于当前下限。
 * 参数随密码哈希持久化，因此校验时直接使用编码哈希中保存的参数。
 */
export const ARGON2ID_OPTIONS: Options = {
  memoryCost: 19 * 1024,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  algorithm: ARGON2ID_ALGORITHM,
};

const DUMMY_PASSWORD_INPUT = "inpulse-login-timing-equalization-dummy";

let dummyPasswordHash: string | undefined;

function ensureDummyPasswordHash(): string {
  dummyPasswordHash ??= hashSync(DUMMY_PASSWORD_INPUT, ARGON2ID_OPTIONS);
  return dummyPasswordHash;
}

/**
 * 密码校验。用户不存在、停用或编码哈希缺失时仍执行一次等时 Argon2id
 * 计算，避免通过响应时间枚举账号；失败路径不区分具体原因。
 */
@Injectable()
export class PasswordService {
  private readonly verificationGate = new ConcurrencyGate(
    ARGON2_MAX_CONCURRENT_VERIFICATIONS,
  );

  async verify(
    password: string,
    encodedHash: string | undefined,
  ): Promise<boolean> {
    return this.verificationGate.run(() =>
      this.verifyInsideGate(password, encodedHash),
    );
  }

  private async verifyInsideGate(
    password: string,
    encodedHash: string | undefined,
  ): Promise<boolean> {
    if (encodedHash === undefined || !encodedHash.startsWith("$argon2id$")) {
      await verify(ensureDummyPasswordHash(), password);
      return false;
    }

    try {
      return await verify(encodedHash, password);
    } catch {
      await verify(ensureDummyPasswordHash(), password);
      return false;
    }
  }
}
