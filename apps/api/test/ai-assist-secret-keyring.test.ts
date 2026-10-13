import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  AiAssistDecryptError,
  AiAssistEncryptionUnavailableError,
  aiAssistKeyHint,
  decryptAiAssistSecret,
  encryptAiAssistSecret,
  loadAiAssistEncryptionKeyring,
  parseAiAssistEncryptionKeyring,
} from "../src/modules/document-import/ai-assist-secret-keyring.js";

const KEY_A = "ab".repeat(32);
const KEY_B = "cd".repeat(32);

describe("parseAiAssistEncryptionKeyring", () => {
  test("解析多版本 keyring：注释、空行与空白忽略", () => {
    const keyring = parseAiAssistEncryptionKeyring(
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
      expect(() => parseAiAssistEncryptionKeyring(content, version)).toThrow(
        AiAssistEncryptionUnavailableError,
      );
    }
  });
});

describe("encryptAiAssistSecret / decryptAiAssistSecret", () => {
  test("往返一致：密文为 nonce||tag||body 且绑定当前版本", () => {
    const keyring = parseAiAssistEncryptionKeyring("1:" + KEY_A, 1);
    const encrypted = encryptAiAssistSecret("value-for-encryption", keyring);
    expect(encrypted.keyVersion).toBe(1);
    expect(encrypted.ciphertext.length).toBeGreaterThan(12 + 16);
    expect(
      decryptAiAssistSecret(
        encrypted.ciphertext,
        encrypted.keyVersion,
        keyring,
      ),
    ).toBe("value-for-encryption");
  });

  test("篡改 body 或 tag 任一字节 → AiAssistDecryptError", () => {
    const keyring = parseAiAssistEncryptionKeyring("1:" + KEY_A, 1);
    const encrypted = encryptAiAssistSecret("value-for-encryption", keyring);
    const bodyTampered = Buffer.from(encrypted.ciphertext);
    bodyTampered[bodyTampered.length - 1] =
      bodyTampered[bodyTampered.length - 1]! ^ 0x01;
    expect(() => decryptAiAssistSecret(bodyTampered, 1, keyring)).toThrow(
      AiAssistDecryptError,
    );
    const tagTampered = Buffer.from(encrypted.ciphertext);
    tagTampered[12] = tagTampered[12]! ^ 0x01;
    expect(() => decryptAiAssistSecret(tagTampered, 1, keyring)).toThrow(
      AiAssistDecryptError,
    );
  });

  test("换别的版本密钥解密被 GCM 拒绝；未知版本 → 主密钥不可用", () => {
    const keyring = parseAiAssistEncryptionKeyring(
      "1:" + KEY_A + "\n2:" + KEY_B,
      2,
    );
    const encrypted = encryptAiAssistSecret("value-for-encryption", keyring);
    expect(() =>
      decryptAiAssistSecret(encrypted.ciphertext, 1, keyring),
    ).toThrow(AiAssistDecryptError);
    expect(() =>
      decryptAiAssistSecret(encrypted.ciphertext, 9, keyring),
    ).toThrow(AiAssistEncryptionUnavailableError);
  });

  test("过短密文 → AiAssistDecryptError", () => {
    const keyring = parseAiAssistEncryptionKeyring("1:" + KEY_A, 1);
    expect(() => decryptAiAssistSecret(Buffer.alloc(10), 1, keyring)).toThrow(
      AiAssistDecryptError,
    );
  });
});

describe("loadAiAssistEncryptionKeyring", () => {
  test("路径必须位于 /run/secrets；临时路径需要显式测试开关", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inpulse-ai-assist-key-"));
    const file = join(directory, "ai-assist.keyring");
    await writeFile(file, "1:" + KEY_A + "\n", "utf8");
    try {
      expect(() => loadAiAssistEncryptionKeyring({})).toThrow(
        AiAssistEncryptionUnavailableError,
      );
      expect(() =>
        loadAiAssistEncryptionKeyring({
          AI_ASSIST_ENCRYPTION_KEY_FILE: "./secrets/ai-assist.keyring",
        }),
      ).toThrow(AiAssistEncryptionUnavailableError);
      expect(() =>
        loadAiAssistEncryptionKeyring({
          NODE_ENV: "test",
          AI_ASSIST_ENCRYPTION_KEY_FILE: file,
        }),
      ).toThrow(AiAssistEncryptionUnavailableError);
      const keyring = loadAiAssistEncryptionKeyring({
        NODE_ENV: "test",
        AI_ASSIST_ENCRYPTION_KEY_TEST_PATH: "1",
        AI_ASSIST_ENCRYPTION_KEY_FILE: file,
        AI_ASSIST_ENCRYPTION_KEY_VERSION: "1",
      });
      expect(keyring.currentVersion).toBe(1);
      expect(() =>
        loadAiAssistEncryptionKeyring({
          NODE_ENV: "test",
          AI_ASSIST_ENCRYPTION_KEY_TEST_PATH: "1",
          AI_ASSIST_ENCRYPTION_KEY_FILE: join(directory, "missing.keyring"),
        }),
      ).toThrow(AiAssistEncryptionUnavailableError);
      expect(() =>
        loadAiAssistEncryptionKeyring({
          NODE_ENV: "test",
          AI_ASSIST_ENCRYPTION_KEY_TEST_PATH: "1",
          AI_ASSIST_ENCRYPTION_KEY_FILE: file,
          AI_ASSIST_ENCRYPTION_KEY_VERSION: "9",
        }),
      ).toThrow(AiAssistEncryptionUnavailableError);
      expect(() =>
        loadAiAssistEncryptionKeyring({
          NODE_ENV: "test",
          AI_ASSIST_ENCRYPTION_KEY_TEST_PATH: "1",
          AI_ASSIST_ENCRYPTION_KEY_FILE: file,
          AI_ASSIST_ENCRYPTION_KEY_VERSION: "abc",
        }),
      ).toThrow(AiAssistEncryptionUnavailableError);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("未设置版本时默认为 1", async () => {
    const directory = await mkdtemp(join(tmpdir(), "inpulse-ai-assist-key-"));
    const file = join(directory, "ai-assist.keyring");
    await writeFile(file, "1:" + KEY_A + "\n", "utf8");
    try {
      const keyring = loadAiAssistEncryptionKeyring({
        NODE_ENV: "test",
        AI_ASSIST_ENCRYPTION_KEY_TEST_PATH: "1",
        AI_ASSIST_ENCRYPTION_KEY_FILE: file,
      });
      expect(keyring.currentVersion).toBe(1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("aiAssistKeyHint", () => {
  test("取尾 4 位；短于 4 位时整体返回", () => {
    expect(aiAssistKeyHint("1234567890")).toBe("7890");
    expect(aiAssistKeyHint("ab")).toBe("ab");
  });
});
