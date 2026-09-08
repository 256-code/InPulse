#!/usr/bin/env node
/**
 * 部署镜像引用 preflight（技术设计 v1.2.2 §11.1 / §11.2）。
 *
 * 职责：
 *   1. 校验所有 `*_IMAGE_REF` 匹配 `repository:tag@sha256:<64hex>`，拒绝空值、
 *      `latest/next/beta/rc/dev/local` 标签以及占位符（REPLACE_ME / TODO / <...>）。
 *   2. 渲染 `docker compose config --format json`，校验每个 service.image 都带 digest。
 *   3. 校验 §11.2 结构不变量：db 挂载 `/var/lib/postgresql`、read_only、cap_drop、
 *      migrate 一次性、api 等待 migrate 完成、web 仅暴露 80/443 等。
 *
 * 用法：
 *   node scripts/check_deploy_refs.mjs --env deploy/.env.deploy
 *   node scripts/check_deploy_refs.mjs --env deploy/.env.deploy.example
 *
 * 注意：真实 digest 只能由受信镜像仓库解析后写入，本脚本不生成也不伪造 digest。
 */

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const REF_PATTERN = /^[^:\s]+:[^@\s]+@sha256:[0-9a-f]{64}$/;
const FORBIDDEN_TAG =
  /\b(latest|next|beta|rc|dev|local|nightly|test|example|redacted)\b/i;
const PLACEHOLDER = /(REPLACE_ME|CHANGE_ME|TODO|placeholder|<[^>]*>)/i;

const REQUIRED_REFS = [
  "DB_IMAGE_REF",
  "MIGRATE_IMAGE_REF",
  "API_IMAGE_REF",
  "WEB_IMAGE_REF",
  "OPS_IMAGE_REF",
];

let exitCode = 0;

function fail(message) {
  process.stderr.write(`[check:deploy] ERROR: ${message}\n`);
  exitCode = 1;
}

function info(message) {
  process.stdout.write(`[check:deploy] ${message}\n`);
}

function parseArgs(argv) {
  const args = { env: "deploy/.env.deploy", compose: "deploy/compose.yaml" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--env" || arg === "--env-file") args.env = argv[i + 1];
    else if (arg === "--compose") args.compose = argv[i + 1];
  }
  return args;
}

async function loadEnv(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    fail(`environment file not found: ${file}`);
    return null;
  }
  const values = new Map();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const cleaned = line.replace(/^export\s+/, "");
    const eq = cleaned.indexOf("=");
    if (eq <= 0) continue;
    const key = cleaned.slice(0, eq).trim();
    let value = cleaned.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values.set(key, value);
  }
  return values;
}

function validateRef(label, value) {
  if (!value) {
    fail(`${label} is empty`);
    return false;
  }
  if (PLACEHOLDER.test(value)) {
    fail(
      `${label} contains a placeholder (\`${value}\`); real value must come from a trusted registry`,
    );
    return false;
  }
  if (!REF_PATTERN.test(value)) {
    fail(
      `${label} must be \`repository:tag@sha256:<64hex>\`, got \`${value}\``,
    );
    return false;
  }
  const tag = value.slice(0, value.indexOf("@")).split(":")[1] ?? "";
  if (!tag || FORBIDDEN_TAG.test(tag)) {
    fail(
      `${label} uses a non-pinned/imprecise tag \`${tag}\`; require an exact patch tag plus digest`,
    );
    return false;
  }
  return true;
}

function renderComposeJson({ env, compose }) {
  const projectDir = resolve(process.cwd(), "deploy");
  const result = spawnSync(
    "docker",
    [
      "compose",
      "--project-directory",
      projectDir,
      "-f",
      compose,
      "--env-file",
      env,
      "--profile",
      "operations",
      "config",
      "--format",
      "json",
    ],
    { encoding: "utf8" },
  );
  if (result.error) {
    fail(`unable to run docker compose: ${result.error.message}`);
    return null;
  }
  if (result.status !== 0) {
    fail(
      `docker compose config failed:\n${result.stderr || result.stdout || ""}`,
    );
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail("docker compose config did not produce valid JSON");
    return null;
  }
}

function checkStructure(rendered) {
  const services = rendered.services ?? {};
  const problems = [];

  for (const name of ["db", "migrate", "api", "web"]) {
    if (!services[name]) problems.push(`missing ${name} service`);
  }

  for (const name of ["db", "migrate", "api", "web"]) {
    const svc = services[name];
    if (!svc) continue;
    if (svc.read_only !== true)
      problems.push(`${name}: read_only must be true`);
    if (!(svc.cap_drop ?? []).includes("ALL")) {
      problems.push(`${name}: cap_drop must include ALL`);
    }
  }

  const db = services.db;
  if (db) {
    const mount = (db.volumes ?? []).some(
      (v) =>
        typeof v === "object" && /\/var\/lib\/postgresql/.test(v.target ?? ""),
    );
    if (!mount)
      problems.push("db: must mount named volume at /var/lib/postgresql");
    if (!db.healthcheck) problems.push("db: healthcheck is required");
  }

  const api = services.api;
  if (api) {
    if (
      api.depends_on?.migrate?.condition !== "service_completed_successfully"
    ) {
      problems.push(
        "api: must wait for migrate service_completed_successfully",
      );
    }
    const env = api.environment ?? {};
    if (!env.RUNTIME_DB_PASSWORD_FILE) {
      problems.push(
        "api: environment must set RUNTIME_DB_PASSWORD_FILE (code reads it)",
      );
    }
  }

  const migrate = services.migrate;
  if (migrate) {
    const cmd = Array.isArray(migrate.command)
      ? migrate.command.join(" ")
      : String(migrate.command ?? "");
    if (!/db:migrate/.test(cmd))
      problems.push("migrate: command must invoke db:migrate");
    const env = migrate.environment ?? {};
    if (!env.MIGRATION_DB_PASSWORD_FILE) {
      problems.push(
        "migrate: environment must set MIGRATION_DB_PASSWORD_FILE (code reads it)",
      );
    }
  }

  const web = services.web;
  if (web) {
    const ports = (web.ports ?? []).map((p) => {
      if (typeof p === "string") return p;
      if (p && typeof p === "object") return `${p.published}:${p.target}`;
      return String(p);
    });
    if (!ports.includes("80:8080")) problems.push("web: must expose 80:8080");
    if (!ports.includes("443:8443")) problems.push("web: must expose 443:8443");
  }

  return problems;
}

async function main() {
  const { env, compose } = parseArgs(process.argv.slice(2));
  const envValues = await loadEnv(env);
  if (envValues === null) {
    process.exit(exitCode);
    return;
  }

  // 1. required IMAGE_REF present and valid
  let count = 0;
  for (const key of REQUIRED_REFS) {
    if (!envValues.has(key)) {
      fail(`${key} is missing from ${env}`);
      continue;
    }
    if (validateRef(key, envValues.get(key))) count += 1;
  }

  // 2. any other *_IMAGE_REF must also be valid (extra refs are allowed but checked)
  for (const [key, value] of envValues) {
    if (key.endsWith("_IMAGE_REF") && !REQUIRED_REFS.includes(key)) {
      validateRef(key, value);
    }
  }

  if (exitCode !== 0) {
    fail(
      `image ref(s) invalid; resolve them at a trusted registry before release`,
    );
    process.exit(exitCode);
  }

  // 3. compose render + image check + structure
  const rendered = renderComposeJson({ env, compose });
  if (rendered === null) {
    process.exit(exitCode);
    return;
  }

  for (const [name, svc] of Object.entries(rendered.services ?? {})) {
    const image = svc.image;
    if (!image) {
      fail(`service ${name} has no image`);
      continue;
    }
    validateRef(`service ${name} image`, image);
  }
  if (exitCode !== 0) {
    process.exit(exitCode);
    return;
  }

  const problems = checkStructure(rendered);
  if (problems.length > 0) {
    for (const problem of problems) fail(problem);
    process.exit(exitCode);
    return;
  }

  info(
    `${count} image refs valid; compose config rendered; structure invariants OK.`,
  );
  process.exit(exitCode);
}

main();
