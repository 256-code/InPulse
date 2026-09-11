import { readTrimmedSecret } from "@inpulse/database/config";

/** WORM 对象锁配置：跟随 S3 Object Lock（COMPLIANCE/GOVERNANCE + 保留天数）。 */
export interface WormObjectLock {
  readonly mode: "COMPLIANCE" | "GOVERNANCE";
  readonly retainDays: number;
}

/**
 * WORM 凭据文件（`WORM_CREDENTIALS_FILE`）的解析结果。文件为 JSON：
 * `{ version: 1, endpoint, region, bucket, accessKeyId, secretAccessKey,
 *    prefix?, forcePathStyle?, objectLock? }`。
 */
export interface WormCredentials {
  readonly endpoint: URL;
  readonly region: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly prefix: string;
  readonly forcePathStyle: boolean;
  readonly objectLock: WormObjectLock | null;
}

/** 归档签名密钥文件：每行 `<version>:<64 hex>`，取最大版本为当前写入版本。 */
export interface ArchiveSigningKeyring {
  readonly currentVersion: number;
  readonly keys: ReadonlyMap<number, Buffer>;
}

export interface OpsConfig {
  readonly databaseUrl: string;
  readonly worm: WormCredentials;
  readonly signingKeyring: ArchiveSigningKeyring;
  readonly fetchTimeoutMs: number;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 归档数据库连接：生产稳态由 compose 以 `DB_HOST/DB_PORT/DB_NAME/DB_USER/
 * DB_PASSWORD_FILE` 注入（角色固定为 `audit_archive_writer`）；本地与集成测试可用
 * `ARCHIVE_DATABASE_URL` 直连，但生产模式禁止该变量（沿用 database 包的 fail closed 策略）。
 */
export async function resolveArchiveDatabaseUrl(): Promise<string> {
  const direct = process.env["ARCHIVE_DATABASE_URL"]?.trim();
  if (direct) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "ARCHIVE_DATABASE_URL is forbidden in production; use DB_PASSWORD_FILE",
      );
    }
    return direct;
  }

  const passwordFileName = "DB_PASSWORD_FILE";
  const passwordFile = required(passwordFileName);
  const password = await readTrimmedSecret(passwordFile, passwordFileName);
  const user = process.env["DB_USER"]?.trim() || "audit_archive_writer";
  const host = required("DB_HOST");
  const port = process.env["DB_PORT"]?.trim() || "5432";
  const database = process.env["DB_NAME"]?.trim() || "app";
  const url = new URL("postgresql://placeholder");
  url.username = user;
  url.password = password;
  url.hostname = host;
  url.port = port;
  url.pathname = `/${database}`;
  url.searchParams.set(
    "sslmode",
    process.env["DB_SSLMODE"]?.trim() || "require",
  );
  return url.toString();
}

export function parseSigningKeyring(text: string): ArchiveSigningKeyring {
  const keys = new Map<number, Buffer>();
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = /^(\d+):([0-9a-fA-F]{64})$/.exec(line);
    if (match === null) {
      throw new Error(
        `ARCHIVE_SIGNING_KEY_FILE line ${index + 1} must be <version>:<64 hex chars>`,
      );
    }
    const version = Number(match[1]);
    if (!Number.isSafeInteger(version) || version <= 0) {
      throw new Error(
        `invalid archive signing key version on line ${index + 1}`,
      );
    }
    keys.set(version, Buffer.from(match[2] as string, "hex"));
  }
  if (keys.size === 0) {
    throw new Error("ARCHIVE_SIGNING_KEY_FILE must contain at least one key");
  }
  const currentVersion = Math.max(...keys.keys());
  return { currentVersion, keys };
}

export function parseWormCredentials(
  text: string,
  options: { readonly requireHttps: boolean },
): WormCredentials {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("WORM_CREDENTIALS_FILE is not valid JSON");
  }
  if (!isRecord(parsed)) {
    throw new Error("WORM_CREDENTIALS_FILE must be a JSON object");
  }
  if (parsed["version"] !== 1) {
    throw new Error("WORM_CREDENTIALS_FILE version must be 1");
  }

  const endpointRaw = parsed["endpoint"];
  if (typeof endpointRaw !== "string" || endpointRaw.trim() === "") {
    throw new Error("WORM_CREDENTIALS_FILE endpoint is required");
  }
  let endpoint: URL;
  try {
    endpoint = new URL(endpointRaw);
  } catch {
    throw new Error("WORM_CREDENTIALS_FILE endpoint is not a URL");
  }
  if (endpoint.protocol !== "https:" && endpoint.protocol !== "http:") {
    throw new Error("WORM_CREDENTIALS_FILE endpoint must be http(s)");
  }
  if (options.requireHttps && endpoint.protocol !== "https:") {
    throw new Error(
      "WORM_CREDENTIALS_FILE endpoint must be https in production",
    );
  }

  const stringField = (name: string): string => {
    const value = parsed[name];
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error(`WORM_CREDENTIALS_FILE ${name} is required`);
    }
    return value.trim();
  };

  const prefixRaw = parsed["prefix"];
  const prefix = prefixRaw === undefined ? "inpulse/audit" : prefixRaw;
  if (typeof prefix !== "string" || prefix.trim() === "") {
    throw new Error("WORM_CREDENTIALS_FILE prefix must be a non-empty string");
  }

  const forcePathStyleRaw = parsed["forcePathStyle"];
  if (
    forcePathStyleRaw !== undefined &&
    typeof forcePathStyleRaw !== "boolean"
  ) {
    throw new Error("WORM_CREDENTIALS_FILE forcePathStyle must be a boolean");
  }

  let objectLock: WormObjectLock | null = null;
  const objectLockRaw = parsed["objectLock"];
  if (objectLockRaw !== undefined && objectLockRaw !== null) {
    if (!isRecord(objectLockRaw)) {
      throw new Error("WORM_CREDENTIALS_FILE objectLock must be an object");
    }
    const mode = objectLockRaw["mode"];
    if (mode !== "COMPLIANCE" && mode !== "GOVERNANCE") {
      throw new Error(
        "WORM_CREDENTIALS_FILE objectLock.mode must be COMPLIANCE or GOVERNANCE",
      );
    }
    const retainDays = objectLockRaw["retainDays"];
    if (
      typeof retainDays !== "number" ||
      !Number.isInteger(retainDays) ||
      retainDays < 1 ||
      retainDays > 36500
    ) {
      throw new Error(
        "WORM_CREDENTIALS_FILE objectLock.retainDays must be an integer between 1 and 36500",
      );
    }
    objectLock = { mode, retainDays };
  }

  return {
    endpoint,
    region: stringField("region"),
    bucket: stringField("bucket"),
    accessKeyId: stringField("accessKeyId"),
    secretAccessKey: stringField("secretAccessKey"),
    prefix: prefix.replace(/^\/+|\/+$/g, ""),
    forcePathStyle: forcePathStyleRaw === undefined ? true : forcePathStyleRaw,
    objectLock,
  };
}

export async function loadOpsConfig(): Promise<OpsConfig> {
  const databaseUrl = await resolveArchiveDatabaseUrl();

  const wormFileName = "WORM_CREDENTIALS_FILE";
  const wormText = await readTrimmedSecret(
    required(wormFileName),
    wormFileName,
  );
  const worm = parseWormCredentials(wormText, {
    requireHttps: process.env.NODE_ENV === "production",
  });

  const signingFileName = "ARCHIVE_SIGNING_KEY_FILE";
  const signingText = await readTrimmedSecret(
    required(signingFileName),
    signingFileName,
  );
  const signingKeyring = parseSigningKeyring(signingText);

  const timeoutRaw = process.env["ARCHIVE_FETCH_TIMEOUT_MS"]?.trim();
  const fetchTimeoutMs =
    timeoutRaw === undefined ? 30_000 : Number.parseInt(timeoutRaw, 10);
  if (!Number.isSafeInteger(fetchTimeoutMs) || fetchTimeoutMs < 1_000) {
    throw new Error("ARCHIVE_FETCH_TIMEOUT_MS must be an integer >= 1000");
  }

  return { databaseUrl, worm, signingKeyring, fetchTimeoutMs };
}
