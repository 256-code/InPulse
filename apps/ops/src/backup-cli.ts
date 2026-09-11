#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { readTrimmedSecret } from "@inpulse/database/config";

import {
  decryptBackupPackageFile,
  parseBackupManifest,
  runBackup,
  verifyBackupManifest,
} from "./backup.js";
import { loadBackupConfig, parseSigningKeyring } from "./config.js";

const USAGE = `用法：backup <子命令> [选项]

  backup                            执行一次加密逻辑备份并上传异机只读存储
  verify --file <path> [--manifest <path>]
                                    解密备份包并校验明文哈希；提供清单时同时验签

环境变量：DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD_FILE（或本地 BACKUP_DATABASE_URL）、
BACKUP_ENCRYPTION_KEY_FILE、OFFSITE_CREDENTIALS_FILE、BACKUP_LOCAL_DIR、
BACKUP_LOCAL_RETENTION_DAYS、BACKUP_PG_DUMP_PATH、BACKUP_GIT_SHA、BACKUP_IMAGE_REF、
BACKUP_FETCH_TIMEOUT_MS。verify 只读取 BACKUP_ENCRYPTION_KEY_FILE。
`;

function parseFlags(rest: readonly string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === undefined || !token.startsWith("--")) {
      throw new Error(`unexpected argument: ${token ?? ""}`);
    }
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`missing value for ${token}`);
    }
    flags.set(token, value);
    index += 1;
  }
  return flags;
}

async function loadVerifyKeyring() {
  const fileName = "BACKUP_ENCRYPTION_KEY_FILE";
  const file = process.env[fileName]?.trim();
  if (!file) {
    throw new Error(`Missing required environment variable: ${fileName}`);
  }
  return parseSigningKeyring(await readTrimmedSecret(file, fileName), fileName);
}

async function verifyCommand(flags: Map<string, string>): Promise<number> {
  const file = flags.get("--file");
  if (file === undefined) {
    throw new Error("verify requires --file");
  }
  const keyring = await loadVerifyKeyring();
  const decrypted = await decryptBackupPackageFile(file, keyring.keys);

  let manifestVerified = false;
  const manifestFile = flags.get("--manifest");
  if (manifestFile !== undefined) {
    const manifest = parseBackupManifest(await readFile(manifestFile, "utf8"));
    verifyBackupManifest(manifest, keyring.keys);
    if (manifest.payload.plaintextSha256 !== decrypted.plaintextSha256) {
      throw new Error("manifest plaintext hash does not match the package");
    }
    if (manifest.payload.ciphertextSha256 !== decrypted.ciphertextSha256) {
      throw new Error("manifest ciphertext hash does not match the package");
    }
    if (manifest.payload.ciphertextBytes !== decrypted.ciphertextBytes) {
      throw new Error("manifest ciphertext size does not match the package");
    }
    manifestVerified = true;
  }

  process.stdout.write(
    `${JSON.stringify({
      verified: true,
      kind: "backup",
      createdAt: decrypted.header.createdAt,
      pgDumpFormat: decrypted.header.pgDumpFormat,
      plaintextSha256: decrypted.plaintextSha256,
      plaintextBytes: decrypted.plaintextBytes,
      ciphertextSha256: decrypted.ciphertextSha256,
      ciphertextBytes: decrypted.ciphertextBytes,
      manifestVerified,
      signingKeyVersion: decrypted.header.signingKeyVersion,
    })}\n`,
  );
  return 0;
}

async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  const rest = argv.slice(1);
  if (command === undefined || command === "--help" || command === "-h") {
    process.stderr.write(USAGE);
    return command === undefined ? 1 : 0;
  }

  switch (command) {
    case "backup": {
      const config = await loadBackupConfig();
      const summary = await runBackup(config);
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      return 0;
    }
    case "verify": {
      return verifyCommand(parseFlags(rest));
    }
    default:
      process.stderr.write(USAGE);
      return 1;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`inpulse-backup: ${message}\n`);
    process.exitCode = 1;
  });
