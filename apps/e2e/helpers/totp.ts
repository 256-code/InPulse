import { createHmac } from "node:crypto";

function decodeBase32(input: string): Buffer {
  const normalized = input.replace(/=+$/u, "").toUpperCase();
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const output: number[] = [];
  let bits = 0;
  let value = 0;
  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index < 0) {
      throw new Error("invalid Base32 in E2E TOTP helper");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function totpCode(secret: string, nowMs = Date.now()): string {
  const secretBytes = decodeBase32(secret);
  const step = Math.floor(nowMs / 30_000);
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step), 0);
  const digest = createHmac("sha1", secretBytes).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return (binary % 1_000_000).toString().padStart(6, "0");
}
