import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  WecomRobotDecryptError,
  WecomRobotEncryptionUnavailableError,
  decryptWecomRobotSecret,
  encryptWecomRobotSecret,
  loadWecomRobotEncryptionKeyring,
  parseWecomRobotEncryptionKeyring,
  wecomRobotSecretHint,
} from "../src/modules/wecom-robot/wecom-robot-secret-keyring.js";

const KEY_A = "ab".repeat(32);
const KEY_B = "cd".repeat(32);

describe("parseWecomRobotEncryptionKeyring", () => {
  test("解析多版本 keyring：注释、空行与空白忽略", () => {
    const keyring = parseWecomRobotEncryptionKeyring(
      "# 主密钥\n\n1:" + KEY_A + "\n2:" + KEY_B + "\n",
      2,
    );
    expect(keyring.currentVersion).toBe(2);
    expect(keyring.keys.size).toBe(2);
    expect(keyring.keys.get(1)?.length).toBe(32);
  });

  test("fail closed：非法版本 / 非法行 / 短密钥 / 重复版本 / 空 keyring / 缺当前版本", () => {
    const cases: readonly (readonly [string, number])[] = [
      ["1:" + KEY_A, 0],
      ["not-a-keyring-line", 1],
      ["1:" + "ab".repeat(8), 1],
      ["1:" + KEY_A + "\n1:" + KEY_A, 1],
      ["# 只有注释", 1],
      ["1:" + KEY_A, 3],
    ];
    for (const [content, version] of cases) {
      expect(() => parseWecomRobotEncryptionKeyring(content, version)).toThrow(
        WecomRobotEncryptionUnavailableError,
      );
    }
  });
});

describe("encryptWecomRobotSecret / decryptWecomRobotSecret", () => {
  test("往返一致：密文为 nonce||tag||body 且绑定当前版本", () => {
    const keyring = parseWecomRobotEncryptionKeyring("1:" + KEY_A, 1);
    const encrypted = encryptWecomRobotSecret("secret-value-1234", keyring);
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.ciphertext.length).toBeGreaterThan(12 + 16);
    expect(
      decryptWecomRobotSecret(
        encrypted.ciphertext,
        encrypted.keyVersion,
        keyring,
      ),
    ).toBe("secret-value-1234");
  });

  test("篡改 body 或 tag 任一字节 → WecomRobotDecryptError", () => {
    const keyring = parseWecomRobotEncryptionKeyring("1:" + KEY_A, 1);
    const encrypted = encryptWecomRobotSecret("secret-value-1234", keyring);
    const bodyTampered = Buffer.from(encrypted.ciphertext);
    bodyTampered[bodyTampered.length - 1] =
      bodyTampered[bodyTampered.length - 1]! ^ 0x01;
    expect(() => decryptWecomRobotSecret(bodyTampered, 1, keyring)).toThrow(
      WecomRobotDecryptError,
    );
    const tagTampered = Buffer.from(encrypted.ciphertext);
    tagTampered[12] = tagTampered[12]! ^ 0x01;
    expect(() => decryptWecomRobotSecret(tagTampered, 1, keyring)).toThrow(
      WecomRobotDecryptError,
    );
  });

  test("换别的版本密钥解密被 GCM 拒绝；未知版本 → 主密钥不可用", () => {
    const keyring = parseWecomRobotEncryptionKeyring(
      "1:" + KEY_A + "\n2:" + KEY_B,
      2,
    );
    const encrypted = encryptWecomRobotSecret("secret-value-1234", keyring);
    expect(() =>
      decryptWecomRobotSecret(encrypted.ciphertext, 1, keyring),
    ).toThrow(WecomRobotDecryptError);
    expect(() =>
      decryptWecomRobotSecret(encrypted.ciphertext, 9, keyring),
    ).toThrow(WecomRobotEncryptionUnavailableError);
  });

  test("过短密文 → WecomRobotDecryptError", () => {
    const keyring = parseWecomRobotEncryptionKeyring("1:" + KEY_A, 1);
    expect(() => decryptWecomRobotSecret(Buffer.alloc(10), 1, keyring)).toThrow(
      WecomRobotDecryptError,
    );
  });
});

describe("loadWecomRobotEncryptionKeyring", () => {
  test("路径必须位于 /run/secrets；临时路径需要显式测试开关", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inpulse-wecom-robot-key-"));
    const file = join(directory, "wecom-robot.keyring");
    await writeFile(file, "1:" + KEY_A + "\n", "utf8");
    try {
      expect(() => loadWecomRobotEncryptionKeyring({})).toThrow(
        WecomRobotEncryptionUnavailableError,
      );
      expect(() =>
        loadWecomRobotEncryptionKeyring({
          WECOM_ROBOT_ENCRYPTION_KEY_FILE: "./secrets/wecom-robot.keyring",
        }),
      ).toThrow(WecomRobotEncryptionUnavailableError);
      expect(() =>
        loadWecomRobotEncryptionKeyring({
          NODE_ENV: "test",
          WECOM_ROBOT_ENCRYPTION_KEY_FILE: file,
        }),
      ).toThrow(WecomRobotEncryptionUnavailableError);
      const keyring = loadWecomRobotEncryptionKeyring({
        NODE_ENV: "test",
        WECOM_ROBOT_ENCRYPTION_KEY_TEST_PATH: "1",
        WECOM_ROBOT_ENCRYPTION_KEY_FILE: file,
        WECOM_ROBOT_ENCRYPTION_KEY_VERSION: "1",
      });
      expect(keyring.currentVersion).toBe(1);
      expect(() =>
        loadWecomRobotEncryptionKeyring({
          NODE_ENV: "test",
          WECOM_ROBOT_ENCRYPTION_KEY_TEST_PATH: "1",
          WECOM_ROBOT_ENCRYPTION_KEY_FILE: join(directory, "missing.keyring"),
        }),
      ).toThrow(WecomRobotEncryptionUnavailableError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("wecomRobotSecretHint", () => {
  test("尾 4 位；短密钥整体返回", () => {
    const testSecret = "inpulse-test-robot-secret-1";
    expect(wecomRobotSecretHint(testSecret)).toBe(testSecret.slice(-4));
    expect(wecomRobotSecretHint("abc")).toBe("abc");
  });
});
