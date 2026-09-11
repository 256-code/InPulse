#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import { readTrimmedSecret } from "@inpulse/database/config";

import {
  parseCheckpointEnvelope,
  verifyCheckpointEnvelope,
} from "./checkpoint.js";
import { loadOpsConfig, parseSigningKeyring } from "./config.js";
import { sha256Hex } from "./crypto.js";
import {
  decryptAuditExportPackage,
  parseAuditExportManifest,
  parseAuditExportPackage,
  verifyAuditExportManifest,
} from "./export.js";
import { runCheckpoint, runExport } from "./run.js";

const USAGE = `用法：audit-archive <子命令> [选项]

  checkpoint                        为每条审计链写签名链头检查点到 WORM
  export [--from <ISO>] [--to <ISO>]  导出加密审计明细 + 签名清单（默认前一 UTC 自然日）
  both                              先 checkpoint 再 export
  verify checkpoint --file <path>   校验检查点签名
  verify export --file <path> [--manifest <path>]
                                    解密导出包并校验明文哈希；提供清单时同时验签

环境变量：DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD_FILE（或本地 ARCHIVE_DATABASE_URL）、
WORM_CREDENTIALS_FILE、ARCHIVE_SIGNING_KEY_FILE、ARCHIVE_FETCH_TIMEOUT_MS。
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

function parseDateFlag(
  flags: Map<string, string>,
  name: string,
): Date | undefined {
  const raw = flags.get(name);
  if (raw === undefined) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${name} is not a valid ISO timestamp: ${raw}`);
  }
  return date;
}

async function loadVerifyKeyring() {
  const fileName = "ARCHIVE_SIGNING_KEY_FILE";
  const file = process.env[fileName]?.trim();
  if (!file) {
    throw new Error(`Missing required environment variable: ${fileName}`);
  }
  return parseSigningKeyring(await readTrimmedSecret(file, fileName));
}

async function verifyCheckpointCommand(
  flags: Map<string, string>,
): Promise<number> {
  const file = flags.get("--file");
  if (file === undefined) throw new Error("verify checkpoint requires --file");
  const keyring = await loadVerifyKeyring();
  const envelope = parseCheckpointEnvelope(await readFile(file, "utf8"));
  verifyCheckpointEnvelope(envelope, keyring.keys);
  process.stdout.write(
    `${JSON.stringify({
      verified: true,
      kind: "checkpoint",
      chainId: envelope.payload.chainId,
      lastSequenceNo: envelope.payload.lastSequenceNo,
      lastHash: envelope.payload.lastHash,
      generatedAt: envelope.payload.generatedAt,
      signingKeyVersion: envelope.signingKeyVersion,
    })}\n`,
  );
  return 0;
}

async function verifyExportCommand(
  flags: Map<string, string>,
): Promise<number> {
  const file = flags.get("--file");
  if (file === undefined) throw new Error("verify export requires --file");
  const keyring = await loadVerifyKeyring();
  const raw = await readFile(file);
  const { header, plaintext } = decryptAuditExportPackage(raw, keyring.keys);

  let manifestVerified = false;
  const manifestFile = flags.get("--manifest");
  if (manifestFile !== undefined) {
    const manifest = parseAuditExportManifest(
      await readFile(manifestFile, "utf8"),
    );
    verifyAuditExportManifest(manifest, keyring.keys);
    const ciphertext = parseAuditExportPackage(raw).ciphertext;
    if (manifest.payload.plaintextSha256 !== header.plaintextSha256) {
      throw new Error("manifest plaintext hash does not match the package");
    }
    if (manifest.payload.ciphertextSha256 !== sha256Hex(ciphertext)) {
      throw new Error("manifest ciphertext hash does not match the package");
    }
    if (manifest.payload.rowCount !== header.rowCount) {
      throw new Error("manifest rowCount does not match the package");
    }
    manifestVerified = true;
  }

  process.stdout.write(
    `${JSON.stringify({
      verified: true,
      kind: "export",
      windowFrom: header.windowFrom,
      windowTo: header.windowTo,
      rowCount: header.rowCount,
      plaintextBytes: plaintext.length,
      plaintextSha256: header.plaintextSha256,
      manifestVerified,
      signingKeyVersion: header.signingKeyVersion,
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
    case "checkpoint": {
      const config = await loadOpsConfig();
      const summary = await runCheckpoint(config);
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      return 0;
    }
    case "export": {
      const flags = parseFlags(rest);
      const from = parseDateFlag(flags, "--from");
      const to = parseDateFlag(flags, "--to");
      if ((from === undefined) !== (to === undefined)) {
        throw new Error("--from 与 --to 必须同时提供");
      }
      if (
        from !== undefined &&
        to !== undefined &&
        from.getTime() >= to.getTime()
      ) {
        throw new Error("--from 必须早于 --to");
      }
      const config = await loadOpsConfig();
      const summary = await runExport(
        config,
        {},
        from === undefined || to === undefined ? undefined : { from, to },
      );
      process.stdout.write(`${JSON.stringify(summary)}\n`);
      return 0;
    }
    case "both": {
      const config = await loadOpsConfig();
      const checkpoint = await runCheckpoint(config);
      const exported = await runExport(config);
      process.stdout.write(
        `${JSON.stringify({ checkpoint, export: exported })}\n`,
      );
      return 0;
    }
    case "verify": {
      const subcommand = rest[0];
      const flags = parseFlags(rest.slice(1));
      if (subcommand === "checkpoint") {
        return verifyCheckpointCommand(flags);
      }
      if (subcommand === "export") {
        return verifyExportCommand(flags);
      }
      throw new Error("verify 需要子命令 checkpoint 或 export");
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
    process.stderr.write(`audit-archive: ${message}\n`);
    process.exitCode = 1;
  });
