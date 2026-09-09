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
 *   node scripts/check_deploy_refs.mjs --env deploy/.env.deploy.test
 *   node scripts/check_deploy_refs.mjs --env deploy/.env.deploy.example  # 应被拒绝
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
];

// 生产镜像的 Dockerfile 与配套文件（技术设计 §11.1 / §11.2）。
const REQUIRED_DOCKERFILES = [
  "deploy/docker/api.Dockerfile",
  "deploy/docker/migration.Dockerfile",
  "deploy/docker/web.Dockerfile",
  "deploy/docker/db-bootstrap.Dockerfile",
];
const REQUIRED_DOCKER_ASSETS = [
  "deploy/docker/nginx.conf",
  "deploy/docker/healthcheck.mjs",
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
    if (!api.healthcheck) problems.push("api: healthcheck is required");
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
    if (migrate.restart !== "no") problems.push("migrate: restart must be no");
    const cmd = Array.isArray(migrate.command)
      ? migrate.command.join(" ")
      : String(migrate.command ?? "");
    if (!(cmd.includes("db:migrate") || cmd.includes("dist/src/migrate.js"))) {
      problems.push(
        "migrate: command must invoke db:migrate or dist/src/migrate.js",
      );
    }
    const env = migrate.environment ?? {};
    if (!env.MIGRATION_DB_PASSWORD_FILE) {
      problems.push(
        "migrate: environment must set MIGRATION_DB_PASSWORD_FILE (code reads it)",
      );
    }
  }

  const web = services.web;
  if (web) {
    if (!web.healthcheck) problems.push("web: healthcheck is required");
    const ports = (web.ports ?? []).map((p) => {
      if (typeof p === "string") return p;
      if (p && typeof p === "object") return `${p.published}:${p.target}`;
      return String(p);
    });
    if (!ports.includes("80:8080")) problems.push("web: must expose 80:8080");
    if (!ports.includes("443:8443")) problems.push("web: must expose 443:8443");
  }

  // 生产 `readTrimmedSecret` 要求 secret 为 /run/secrets 直接子项、owner-read-only
  // （mode 0400），且运行用户必须能读取。Compose 长语法在服务级声明 `uid/gid/mode`，
  // 必须与容器 user 的数值 uid/gid 一致，否则启动会 fail-closed。
  const numericUser = (value) => {
    const match = /^(\d+):(\d+)$/.exec(String(value ?? ""));
    return match ? { uid: match[1], gid: match[2] } : null;
  };
  for (const name of ["migrate", "api", "web"]) {
    const svc = services[name];
    if (!svc) continue;
    const user = numericUser(svc.user);
    if (!user) continue;
    for (const ref of svc.secrets ?? []) {
      if (typeof ref === "string") {
        problems.push(
          `${name}: secret \`${ref}\` must use long syntax with target/uid/gid/mode`,
        );
        continue;
      }
      if (ref.mode !== "0400") {
        problems.push(
          `${name}: secret \`${ref.source}\` must set mode 0400 (owner-only readable)`,
        );
      }
      if (ref.uid !== user.uid || ref.gid !== user.gid) {
        problems.push(
          `${name}: secret \`${ref.source}\` uid/gid must match container user ${svc.user}`,
        );
      }
      if (!ref.target || !/^\/run\/secrets\/[^/]+$/.test(ref.target)) {
        problems.push(
          `${name}: secret \`${ref.source}\` target must be a direct child of /run/secrets`,
        );
      }
    }
  }

  return problems;
}

/**
 * 校验生产 Dockerfile：
 *   - 每个 `FROM` 必须带 `@sha256:<64hex>` 且不含浮动 tag；
 *   - runtime 阶段必须存在非 root 数值 `USER`；
 *   - API 镜像必须内置 healthcheck.mjs；Web 镜像必须内置 nginx.conf。
 */
async function checkDockerfiles() {
  const problems = [];

  for (const file of [...REQUIRED_DOCKERFILES, ...REQUIRED_DOCKER_ASSETS]) {
    try {
      await readFile(file, "utf8");
    } catch {
      problems.push(`missing required Docker asset: ${file}`);
    }
  }

  for (const file of REQUIRED_DOCKERFILES) {
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }

    const fromLines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("FROM "));
    if (fromLines.length === 0) {
      problems.push(`${file}: no FROM directive`);
    }

    let runtimeUser = false;
    let hasHealthcheck = false;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (/^USER\s+\d+/.test(trimmed)) runtimeUser = true;
      if (/healthcheck\.mjs/.test(trimmed)) hasHealthcheck = true;
    }

    for (const from of fromLines) {
      if (!/@sha256:[0-9a-f]{64}\s*(?:AS\s+\w+)?\s*$/.test(from)) {
        problems.push(
          `${file}: FROM must be pinned to <tag>@sha256:<64hex>; got \`${from}\``,
        );
      }
      if (FORBIDDEN_TAG.test(from)) {
        problems.push(
          `${file}: FROM uses a forbidden/imprecise tag \`${from}\``,
        );
      }
    }

    // db-bootstrap 基于官方 postgres 镜像，以非 root `postgres` 用户运行，
    // 不要求数值 USER；其余自建镜像必须声明非 root 数值 USER。
    if (!runtimeUser && !file.endsWith("db-bootstrap.Dockerfile")) {
      problems.push(`${file}: runtime must declare a numeric USER`);
    }
    if (file.endsWith("api.Dockerfile") && !hasHealthcheck) {
      problems.push(`${file}: api image must include healthcheck.mjs`);
    }
  }

  const web = await readFile("deploy/docker/web.Dockerfile", "utf8").catch(
    () => "",
  );
  if (!/nginx\.conf/.test(web)) {
    problems.push("deploy/docker/web.Dockerfile: must copy nginx.conf");
  }

  for (const file of [
    "deploy/docker/api.Dockerfile",
    "deploy/docker/migration.Dockerfile",
  ]) {
    const text = await readFile(file, "utf8").catch(() => "");
    const runtime = text.split(/\bAS\s+runtime\b/i)[1] ?? "";
    if (!/rm\s+-rf\s+[^\n]*\/usr\/local\/lib\/node_modules/.test(runtime)) {
      problems.push(
        `${file}: Node runtime must remove bundled npm/corepack toolchain before non-root USER`,
      );
    }
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

  const dockerProblems = await checkDockerfiles();
  if (dockerProblems.length > 0) {
    for (const problem of dockerProblems) fail(problem);
    process.exit(exitCode);
    return;
  }

  info(
    `${count} image refs valid; compose config rendered; structure invariants and Dockerfile checks OK.`,
  );
  process.exit(exitCode);
}

main();
