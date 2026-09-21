#!/usr/bin/env node

/**
 * InPulse 本地开发启动：检查 PostgreSQL -> 构建 API -> 启动 API（可选 Casdoor SSO）-> 启动 Vite。
 *
 * 统一身份认证（ADR-032）配置来源，按优先级：
 *   1. 当前进程环境变量 SSO_ISSUER / SSO_CLIENT_ID / SSO_CLIENT_SECRET_FILE / SSO_REDIRECT_URI；
 *   2. --env-file 指定的配置文件（默认 deploy/.env.dev.local，被 .gitignore 忽略）。
 * 两者都拿不到完整配置时，按 fail closed 以本地口令登录启动，并在结束时打印启用方法。
 *
 * 本脚本只服务本地开发，不参与 CI 门禁；生产部署走 deploy/compose.yaml。
 *
 * 用法：
 *   node scripts/dev-start.mjs
 *   node scripts/dev-start.mjs --skip-build
 *   node scripts/dev-start.mjs --local-only
 *   node scripts/dev-start.mjs --env-file path/to/.env.dev.local
 */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { createConnection } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, ".data");
const LOG_DIR = path.join(DATA_DIR, "dev");
const KEYRING_DIR = path.join(DATA_DIR, "keyrings");
const DB_CONTAINER = "inpulse-pg";
const DB_PORT = 55432;
const API_PORT = 3000;
const WEB_PORT = 5173;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;
const SSO_KEYS = [
  "SSO_ISSUER",
  "SSO_CLIENT_ID",
  "SSO_CLIENT_SECRET_FILE",
  "SSO_REDIRECT_URI",
];

const USAGE = `InPulse 本地开发启动

  node scripts/dev-start.mjs [选项]

选项：
  --skip-build        跳过 API 构建（dist 已是最新时使用）
  --local-only        强制关闭统一身份认证，按本地口令登录启动
  --env-file <路径>   统一身份认证配置文件，默认 deploy/.env.dev.local
  -h, --help          显示本帮助`;

function parseArguments(argv) {
  const options = {
    skipBuild: false,
    localOnly: false,
    help: false,
    envFile: path.join(ROOT, "deploy", ".env.dev.local"),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--skip-build") {
      options.skipBuild = true;
    } else if (argument === "--local-only") {
      options.localOnly = true;
    } else if (argument === "--env-file") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error("--env-file 需要一个路径参数");
      }
      options.envFile = path.resolve(value);
      index += 1;
    } else if (argument === "-h" || argument === "--help") {
      options.help = true;
    } else {
      throw new Error(`未知参数：${argument}`);
    }
  }
  return options;
}

function readEnvFile(file) {
  const values = {};
  if (!existsSync(file)) {
    return values;
  }
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator < 1) {
      continue;
    }
    values[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim();
  }
  return values;
}

function resolveSso(options, fileValues) {
  if (options.localOnly) {
    return { enabled: false, reason: "已通过 --local-only 关闭" };
  }
  const flag = (process.env["SSO_ENABLED"] ?? fileValues["SSO_ENABLED"] ?? "")
    .trim()
    .toLowerCase();
  if (flag === "0" || flag === "false") {
    return { enabled: false, reason: "配置中 SSO_ENABLED 为假值" };
  }
  const values = {};
  const missing = [];
  for (const key of SSO_KEYS) {
    const value = (process.env[key] ?? fileValues[key] ?? "").trim();
    values[key] = value;
    if (value.length === 0) {
      missing.push(key);
    }
  }
  if (missing.length > 0) {
    return { enabled: false, reason: `${missing.join("、")} 未配置` };
  }
  if (!existsSync(values["SSO_CLIENT_SECRET_FILE"])) {
    return {
      enabled: false,
      reason: `Secret 文件不存在：${values["SSO_CLIENT_SECRET_FILE"]}`,
    };
  }
  return { enabled: true, values };
}

function ensureKeyrings() {
  mkdirSync(KEYRING_DIR, { recursive: true });
  const created = [];
  for (const name of [
    "session.keyring",
    "idempotency.keyring",
    "audit.keyring",
  ]) {
    const target = path.join(KEYRING_DIR, name);
    if (existsSync(target)) {
      continue;
    }
    writeFileSync(target, `1:${randomBytes(32).toString("hex")}\n`, "utf8");
    created.push(name);
  }
  return created;
}

function capture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  return { status: result.status ?? 1, stdout: result.stdout ?? "" };
}

function runPnpm(commandLine) {
  // 用单条命令字符串配合 shell，避免在 Windows 上把 .cmd 与参数数组混用（Node DEP0190 警告）。
  const result = spawnSync(commandLine, {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
  });
  if (result.status !== 0) {
    throw new Error(`${commandLine} 失败，退出码 ${result.status}`);
  }
}

function relativeToRoot(target) {
  return path.relative(ROOT, target).split(path.sep).join("/");
}

async function ensureDatabase() {
  console.log("[1/4] 检查本地 PostgreSQL 容器 ...");
  const started = capture("docker", ["start", DB_CONTAINER]);
  if (started.status !== 0) {
    throw new Error(
      `容器 ${DB_CONTAINER} 不可用：请先启动 Docker，并按 database/README.md 初始化本地 PostgreSQL 18 + PGroonga 实例（容器名 ${DB_CONTAINER}，端口 ${DB_PORT}）。`,
    );
  }
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (capture("docker", ["exec", DB_CONTAINER, "pg_isready"]).status === 0) {
      console.log(`  就绪：127.0.0.1:${DB_PORT}（容器 ${DB_CONTAINER}）`);
      return;
    }
    await delay(1000);
  }
  throw new Error(
    `容器 ${DB_CONTAINER} 未在 90 秒内就绪，请检查 docker logs ${DB_CONTAINER}。`,
  );
}

function buildApi(skipBuild) {
  console.log("[2/4] 构建 API ...");
  if (skipBuild) {
    console.log("  已跳过（--skip-build）");
    return;
  }
  // API 运行时按 package exports 从 workspace 依赖的 dist 解析（如
  // @inpulse/api-contract）；只构建 apps/api 会让这些包停留在旧产物，
  // 出现「响应契约校验失败」等假故障，因此连同依赖一起构建。
  runPnpm("pnpm --filter @inpulse/api... build");
  console.log("  构建完成：apps/api 及其 workspace 依赖的 dist");
}

function stopPortOwner(port) {
  const pids = new Set();
  if (process.platform === "win32") {
    const output = capture("netstat", ["-ano", "-p", "tcp"]).stdout;
    for (const line of output.split(/\r?\n/)) {
      const match = line
        .trim()
        .match(/^TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)$/);
      if (match && Number(match[1]) === port) {
        pids.add(match[2]);
      }
    }
    for (const pid of pids) {
      spawnSync("taskkill", ["/pid", pid, "/t", "/f"], { stdio: "ignore" });
    }
  } else {
    const output = capture("lsof", [
      "-ti",
      `tcp:${port}`,
      "-sTCP:LISTEN",
    ]).stdout;
    for (const pid of output.split(/\s+/).filter(Boolean)) {
      pids.add(pid);
      try {
        process.kill(Number(pid), "SIGTERM");
      } catch {
        pids.delete(pid);
      }
    }
  }
  return pids.size;
}

function canConnect(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => {
      resolve(false);
    });
  });
}

async function waitForPort(port, name, logFile, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await canConnect(port)) {
      return;
    }
    await delay(500);
  }
  throw new Error(
    `${name} 未在 ${timeoutMs / 1000} 秒内监听 ${port}，请查看 ${relativeToRoot(logFile)}。`,
  );
}

function buildApiEnvironment(fileValues, sso) {
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PORT: String(API_PORT),
    DATABASE_URL:
      fileValues["DATABASE_URL"] ??
      `postgresql://app_runtime@127.0.0.1:${DB_PORT}/app`,
    AUDIT_DATABASE_URL:
      fileValues["AUDIT_DATABASE_URL"] ??
      `postgresql://audit_reader@127.0.0.1:${DB_PORT}/app`,
    SESSION_HASH_KEYRING_FILE: path.join(KEYRING_DIR, "session.keyring"),
    SESSION_HASH_KEYRING_TEST_PATH: "1",
    SESSION_HASH_KEY_VERSION: "1",
    IDEMPOTENCY_FINGERPRINT_KEYRING_FILE: path.join(
      KEYRING_DIR,
      "idempotency.keyring",
    ),
    IDEMPOTENCY_FINGERPRINT_KEYRING_TEST_PATH: "1",
    IDEMPOTENCY_FINGERPRINT_KEY_VERSION: "1",
    AUDIT_HMAC_KEYRING_FILE: path.join(KEYRING_DIR, "audit.keyring"),
    AUDIT_HMAC_KEYRING_TEST_PATH: "1",
    AUDIT_HMAC_KEY_VERSION: "1",
  };
  // 清掉继承来的 SSO 变量，避免与本次解析结果混用。
  for (const key of [
    ...SSO_KEYS,
    "SSO_ENABLED",
    "SSO_CLIENT_SECRET_TEST_PATH",
  ]) {
    delete env[key];
  }
  if (!sso.enabled) {
    return env;
  }
  env["SSO_ENABLED"] = "1";
  env["SSO_ISSUER"] = sso.values["SSO_ISSUER"];
  env["SSO_CLIENT_ID"] = sso.values["SSO_CLIENT_ID"];
  env["SSO_CLIENT_SECRET_FILE"] = sso.values["SSO_CLIENT_SECRET_FILE"];
  env["SSO_REDIRECT_URI"] =
    sso.values["SSO_REDIRECT_URI"] || `${WEB_ORIGIN}/api/v1/auth/sso/callback`;
  // 本地 Secret 位于 /run/secrets 之外，按仓库规则只允许 NODE_ENV=test 加该开关读取（技术设计 §7）。
  env["SSO_CLIENT_SECRET_TEST_PATH"] = "1";
  return env;
}

function spawnBackground(command, args, options) {
  mkdirSync(LOG_DIR, { recursive: true });
  const out = openSync(path.join(LOG_DIR, `${options.name}.out.log`), "a");
  const err = openSync(path.join(LOG_DIR, `${options.name}.err.log`), "a");
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["ignore", out, err],
  });
  child.unref();
  return child.pid ?? 0;
}

function requestOnce(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "GET" }, (res) => {
      res.resume();
      resolve({
        status: res.statusCode ?? 0,
        location: res.headers.location ?? "",
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function verifySso(issuer) {
  try {
    const response = await requestOnce(`${WEB_ORIGIN}/api/v1/auth/sso/start`);
    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.location.startsWith(issuer)
    ) {
      return `SSO 已启用 -> ${issuer}`;
    }
    return `SSO 未生效：/api/v1/auth/sso/start 返回 ${response.status} ${response.location}`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `SSO 状态未知（探测失败：${message}）`;
  }
}

function printSsoGuidance(reason) {
  console.log("");
  console.log(`提示：SSO 未启用（${reason}）。启用步骤：`);
  console.log(
    "  1. 复制 deploy/.env.dev.example 为 deploy/.env.dev.local（该文件名被 .gitignore 忽略）；",
  );
  console.log(
    "  2. 填入 Casdoor 应用签发的 SSO_CLIENT_ID 与 Client Secret 文件的绝对路径；",
  );
  console.log(
    `  3. 在 Casdoor 应用中登记回调地址 ${WEB_ORIGIN}/api/v1/auth/sso/callback；`,
  );
  console.log("  4. 重新运行 node scripts/dev-start.mjs。");
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return;
  }
  mkdirSync(LOG_DIR, { recursive: true });

  const fileValues = readEnvFile(options.envFile);
  const sso = resolveSso(options, fileValues);
  if (existsSync(options.envFile)) {
    console.log(`配置来源：${relativeToRoot(options.envFile)}`);
  }

  const createdKeyrings = ensureKeyrings();
  if (createdKeyrings.length > 0) {
    console.log(`已为本地开发生成 keyring：${createdKeyrings.join("、")}`);
  }

  await ensureDatabase();
  buildApi(options.skipBuild);

  console.log("[3/4] 启动 API ...");
  const stoppedApi = stopPortOwner(API_PORT);
  if (stoppedApi > 0) {
    console.log(`  已停止占用 ${API_PORT} 的旧进程（${stoppedApi} 个）`);
  }
  const apiPid = spawnBackground(
    process.execPath,
    ["--enable-source-maps", "dist/main.js"],
    {
      name: "api",
      cwd: path.join(ROOT, "apps", "api"),
      env: buildApiEnvironment(fileValues, sso),
    },
  );
  await waitForPort(API_PORT, "API", path.join(LOG_DIR, "api.err.log"));
  console.log(`  就绪：http://127.0.0.1:${API_PORT}（PID ${apiPid}）`);

  console.log("[4/4] 启动 Vite ...");
  const stoppedWeb = stopPortOwner(WEB_PORT);
  if (stoppedWeb > 0) {
    console.log(`  已停止占用 ${WEB_PORT} 的旧进程（${stoppedWeb} 个）`);
  }
  const webPid = spawnBackground(
    process.execPath,
    [
      path.join(ROOT, "apps", "web", "node_modules", "vite", "bin", "vite.js"),
      "--host",
      "127.0.0.1",
      "--strictPort",
    ],
    {
      name: "web",
      cwd: path.join(ROOT, "apps", "web"),
      env: { ...process.env, INPULSE_WEB_CSP: "report-only" },
    },
  );
  await waitForPort(WEB_PORT, "Vite", path.join(LOG_DIR, "web.err.log"));
  console.log(`  就绪：${WEB_ORIGIN}（PID ${webPid}）`);

  const ssoSummary = sso.enabled
    ? await verifySso(sso.values["SSO_ISSUER"])
    : "本地口令登录（SSO 已关闭）";

  console.log("");
  console.log("启动完成");
  console.log(`  前端:        ${WEB_ORIGIN}`);
  console.log(
    `  健康检查:    http://127.0.0.1:${API_PORT}/api/v1/health/ready`,
  );
  console.log(`  数据库:      127.0.0.1:${DB_PORT}（容器 ${DB_CONTAINER}）`);
  console.log(`  登录方式:    ${ssoSummary}`);
  console.log(`  本地应急入口: ${WEB_ORIGIN}/login?local=1`);
  console.log(`  日志:        ${relativeToRoot(LOG_DIR)}`);
  console.log(`  进程:        API ${apiPid} / Web ${webPid}`);

  if (!sso.enabled) {
    printSsoGuidance(sso.reason);
  }
}

try {
  await main();
} catch (error) {
  console.error(
    `启动失败：${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
