import { hash } from "@node-rs/argon2";
import { describe, expect, test } from "vitest";

import {
  ARGON2ID_OPTIONS,
  PasswordService,
} from "../src/auth/password.service.js";

describe("PasswordService", () => {
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
});
