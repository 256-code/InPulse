#!/usr/bin/env node

// Secret 扫描门禁（AGENTS.md 第 7 节）：
// - 仓库内不得出现私钥、平台 Token、带口令的连接串或字面量口令；
// - .env.example 只允许非敏感变量名与 /run/secrets/* 路径，不得放示例值；
// - 测试夹具中的假 Argon2/bcrypt 哈希按目录豁免，其他位置一律拒绝。
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PRIVATE_KEY = /-----BEGIN(?: [A-Z0-9 ]+)? PRIVATE KEY-----/;
const PLATFORM_TOKENS =
  /\b(?:AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|sk-[A-Za-z0-9]{20,}|AIza[0-9A-Za-z_-]{35})\b/;
const CREDENTIAL_URL =
  /\b(?:postgres|postgresql|mysql|mongodb|redis|amqp|https?|ftp):\/\/([^/\s:@]+):([^@\s/]+)@/gi;
// 只拦截带引号的字面量；未加引号的形式仅在配置类文件中检查，
// 避免把 `url.password = password` 这类变量赋值误判为 Secret。
const SENSITIVE_QUOTED_ASSIGNMENT =
  /\b(password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|signing[_-]?key|private[_-]?key|hmac[_-]?key|kek)\b\s*[:=]\s*(["'])([^\s"']{8,})\2/gi;
const SENSITIVE_WORD =
  "(?:password|passwd|passphrase|secret|token|api[_-]?key|access[_-]?key|signing[_-]?key|private[_-]?key|hmac[_-]?key|kek)";
// 配置文件里的键常带前缀（例如 POSTGRES_PASSWORD），因此允许前后缀。
const SENSITIVE_PLAIN_ASSIGNMENT = new RegExp(
  `^[ \\t-]*[A-Za-z0-9_]*${SENSITIVE_WORD}[A-Za-z0-9_]*[ \\t]*[:=][ \\t]*([^\\s"'#][^\\s#]{7,})[ \\t]*$`,
  "gim",
);
const CONFIG_EXTENSIONS = new Set([
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".conf",
  ".env",
]);
// 只有完整的 Argon2/bcrypt 编码哈希才算 Secret 泄露；
// `LIKE '$argon2id$%'` 这类 CHECK 约束前缀不在拦截范围。
const PASSWORD_HASH =
  /(?:\$(?:argon2i|argon2d|argon2id)\$v=\d+\$m=\d+,t=\d+,p=\d+\$[^\s$]{6,}\$[A-Za-z0-9+/=]{16,}|\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53})/;
const ENV_FILE = /(?:^|\/)\.env(?:\.|$)/;
const SENSITIVE_ENV_KEY =
  /^(?:[A-Z0-9_]*(?:PASSWORD|SECRET|TOKEN|KEY|URL))[A-Z0-9_]*$/;

const ALLOWED_PLACEHOLDERS = new Set([
  "...",
  "<password>",
  "<secret>",
  "<token>",
  "****",
  "changeme-not-allowed",
  "none",
  "null",
  "true",
  "false",
]);

const problems = [];

function relative(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

function listedFiles() {
  const result = spawnSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: ROOT, encoding: null, maxBuffer: 32 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    throw new Error(result.stderr?.toString("utf8") || "git ls-files failed");
  }
  return result.stdout
    .toString("utf8")
    .split("\0")
    .filter(Boolean)
    .map((name) => path.resolve(ROOT, name));
}

function isAllowedValue(value) {
  if (ALLOWED_PLACEHOLDERS.has(value.toLowerCase())) {
    return true;
  }
  if (
    value.startsWith("${") ||
    value.startsWith("#{") ||
    value.startsWith("{{")
  ) {
    return true;
  }
  if (value.startsWith("/run/secrets/")) {
    return true;
  }
  if (/^%[A-Za-z0-9_]+%$/.test(value)) {
    return true;
  }
  if (/^(?:process\.env|env|os\.environ)\b/.test(value)) {
    return true;
  }
  if (/^[A-Z0-9_]*(?:FILE|PATH)$/.test(value)) {
    return true;
  }
  return false;
}

function lineOf(source, index) {
  return source.slice(0, index).split("\n").length;
}

function scanFile(file) {
  const buffer = readFileSync(file);
  if (buffer.includes(0)) {
    return;
  }
  const source = buffer.toString("utf8");
  const local = relative(file);
  const isTestFile = /(?:^|\/)(?:test|tests|__tests__|poc)(?:\/|$)/.test(local);

  const keyMatch = source.match(PRIVATE_KEY);
  if (keyMatch) {
    problems.push(
      `${local}:${lineOf(source, keyMatch.index)}: 私钥内容不得进入仓库`,
    );
  }

  const tokenMatch = source.match(PLATFORM_TOKENS);
  if (tokenMatch) {
    problems.push(
      `${local}:${lineOf(source, tokenMatch.index)}: 平台 Token 不得进入仓库`,
    );
  }

  for (const match of source.matchAll(CREDENTIAL_URL)) {
    if (!isAllowedValue(match[2])) {
      problems.push(
        `${local}:${lineOf(source, match.index)}: 连接串不得内嵌口令，使用 *_FILE 或 /run/secrets/*`,
      );
    }
  }

  for (const match of source.matchAll(SENSITIVE_QUOTED_ASSIGNMENT)) {
    if (!isAllowedValue(match[3])) {
      problems.push(
        `${local}:${lineOf(source, match.index)}: 敏感字段 "${match[1]}" 不得赋字面量值`,
      );
    }
  }

  if (CONFIG_EXTENSIONS.has(path.extname(local)) || ENV_FILE.test(local)) {
    for (const match of source.matchAll(SENSITIVE_PLAIN_ASSIGNMENT)) {
      if (!isAllowedValue(match[1])) {
        problems.push(
          `${local}:${lineOf(source, match.index)}: 配置文件不得写入敏感字面量`,
        );
      }
    }
  }

  if (PASSWORD_HASH.test(source) && !isTestFile) {
    const index = source.search(PASSWORD_HASH);
    problems.push(
      `${local}:${lineOf(source, index)}: 口令哈希只允许出现在测试夹具中`,
    );
  }

  if (ENV_FILE.test(local)) {
    source.split(/\r?\n/).forEach((line, lineNumber) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return;
      }
      const separator = trimmed.indexOf("=");
      if (separator < 0) {
        problems.push(
          `${local}:${lineNumber + 1}: .env 行必须是 KEY=VALUE 形式`,
        );
        return;
      }
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim();
      if (!SENSITIVE_ENV_KEY.test(key)) {
        return;
      }
      if (value.length > 0 && !value.startsWith("/run/secrets/")) {
        problems.push(
          `${local}:${lineNumber + 1}: ${key} 只能为空或指向 /run/secrets/*，不得放示例值`,
        );
      }
    });
  }
}

function main() {
  const files = listedFiles();
  for (const file of files) {
    try {
      scanFile(file);
    } catch (error) {
      if (error?.code !== "EISDIR" && error?.code !== "ENOENT") {
        problems.push(`${relative(file)}: 扫描失败 ${error.message}`);
      }
    }
  }

  if (problems.length > 0) {
    console.error("Secret 扫描失败：");
    for (const problem of [...new Set(problems)].sort()) {
      console.error(`- ${problem}`);
    }
    return 1;
  }
  console.log(
    `Secret 扫描通过：检查了 ${files.length} 个受版本控制或待提交的文件。`,
  );
  return 0;
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(
    `Secret 扫描失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
