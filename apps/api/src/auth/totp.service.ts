import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import { Inject, Injectable } from "@nestjs/common";

import { TOTP_KEK_KEYRING } from "./auth.constants.js";
import { VersionedAeadKeyring } from "./totp-keyring.js";

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
export const TOTP_ISSUER = "InPulse";
export const TOTP_SECRET_BYTES = 20;
export const TOTP_ACCEPTED_STEP_OFFSETS = [-1, 0, 1] as const;

export interface EncryptedTotpSecret {
  readonly keyVersion: number;
  readonly nonce: Buffer;
  readonly ciphertext: Buffer;
  readonly authTag: Buffer;
}

/**
 * RFC 6238 TOTP 与独立 AEAD 封装。
 *
 * Secret 使用 160 bit 随机值、Base32 无填充编码；验证使用 SHA-1、30 秒、
 * 6 位数字，窗口为当前时间步 ±1。加密使用 AES-256-GCM 与版本化 TOTP KEK，
 * 每个密文使用独立 96 bit nonce。
 */
@Injectable()
export class TotpService {
  constructor(
    @Inject(TOTP_KEK_KEYRING)
    private readonly keyring: VersionedAeadKeyring,
  ) {}

  generateSecretBase32(): string {
    return encodeBase32(randomBytes(TOTP_SECRET_BYTES));
  }

  encryptSecret(secret: string): EncryptedTotpSecret {
    const nonce = randomBytes(12);
    const cipher = createCipheriv(
      "aes-256-gcm",
      this.keyring.currentKey(),
      nonce,
    );
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(decodeBase32(secret))),
      cipher.final(),
    ]);
    return {
      keyVersion: this.keyring.currentVersion,
      nonce,
      ciphertext,
      authTag: cipher.getAuthTag(),
    };
  }

  decryptSecret(secret: EncryptedTotpSecret): string {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.keyring.keyFor(secret.keyVersion),
      secret.nonce,
    );
    decipher.setAuthTag(secret.authTag);
    const plaintext = Buffer.concat([
      decipher.update(secret.ciphertext),
      decipher.final(),
    ]);
    return encodeBase32(plaintext);
  }

  verifyCode(
    secret: string,
    code: string,
    nowMs: number,
    lastAcceptedStep: number | null,
  ): number | undefined {
    if (!/^\d{6}$/.test(code)) {
      return undefined;
    }
    const secretBytes = decodeBase32(secret);
    const currentStep = Math.floor(nowMs / (TOTP_PERIOD_SECONDS * 1000));
    for (const offset of TOTP_ACCEPTED_STEP_OFFSETS) {
      const step = currentStep + offset;
      if (step === lastAcceptedStep) {
        continue;
      }
      if (constantTimeEquals(generateTotp(secretBytes, step), code)) {
        return step;
      }
    }
    return undefined;
  }

  buildOtpauthUri(secret: string, userId: number): string {
    const issuer = encodeURIComponent(TOTP_ISSUER);
    const account = encodeURIComponent(`admin-${userId}`);
    return `otpauth://totp/${issuer}:${account}?issuer=${issuer}&secret=${encodeURIComponent(secret)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`;
  }
}

function generateTotp(secret: Buffer, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step), 0);
  const digest = createHmac("sha1", secret).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  const modulus = 10 ** TOTP_DIGITS;
  return (binary % modulus).toString().padStart(TOTP_DIGITS, "0");
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function encodeBase32(bytes: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let output = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 0x1f]!;
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 0x1f]!;
  }
  return output;
}

function decodeBase32(input: string): Buffer {
  const normalized = input.replace(/=+$/u, "").toUpperCase();
  if (!/^[A-Z2-7]+$/.test(normalized)) {
    throw new Error("TOTP secret is not valid Base32");
  }
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const output: number[] = [];
  let bits = 0;
  let value = 0;
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}
