import { hash } from "@node-rs/argon2";
import { describe, expect, test } from "vitest";

import {
  ARGON2ID_OPTIONS,
  PasswordService,
} from "../src/auth/password.service.js";

describe("PasswordService", () => {
  test("createHash 生成可验证的 Argon2id 编码哈希", async () => {
    const passwordValue = "new-user-password";
    const service = new PasswordService();
    const encoded = await service.createHash(passwordValue);

    expect(encoded.startsWith("$argon2id$")).toBe(true);
    expect(await service.verify(passwordValue, encoded)).toBe(true);
    expect(await service.verify("wrong-password", encoded)).toBe(false);
  });

  test("正确密码通过，错误密码失败", async () => {
    const passwordValue = "correct-password-for-test";
    const encoded = await hash(passwordValue, ARGON2ID_OPTIONS);
    const service = new PasswordService();

    expect(await service.verify("wrong-password", encoded)).toBe(false);
    expect(await service.verify(passwordValue, encoded)).toBe(true);
  });

  test("缺失哈希时执行等时校验并返回 false", async () => {
    const service = new PasswordService();
    expect(await service.verify("any-password", undefined)).toBe(false);
  });

  test("SSO 自动开通账号（password_hash 为 NULL）不会绕过校验或抛错", async () => {
    const service = new PasswordService();

    // ADR-032：JIT 开通账号没有本地口令，null 必须与缺失哈希同义（返回 false），
    // 否则会抛 TypeError 变成 500 而不是 401。
    expect(await service.verify("any-password", null)).toBe(false);
    expect(await service.verify("any-password", "")).toBe(false);
    expect(await service.verify("any-password", "not-an-argon2-hash")).toBe(
      false,
    );
  });
});
