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
 * 归档/备份数据库连接（角色由调用方指定）：生产稳态由 compose 以
 * `DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD_FILE` 注入；本地与集成测试可用
 * `<directUrlName>` 直连，但生产模式禁止该变量（沿用 database 包的 fail closed 策略）。
 */
export async function resolveRoleDatabaseUrl(options: {
  readonly directUrlName: string;
  readonly defaultUser: string;
}): Promise<string> {
  const direct = process.env[options.directUrlName]?.trim();
  if (direct) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `${options.directUrlName} is forbidden in production; use DB_PASSWORD_FILE`,
      );
    }
    return direct;
  }

  const passwordFileName = "DB_PASSWORD_FILE";
  const passwordFile = required(passwordFileName);
  const password = await readTrimmedSecret(passwordFile, passwordFileName);
  const user = process.env["DB_USER"]?.trim() || options.defaultUser;
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

export function parseSigningKeyring(
  text: string,
  fileName = "ARCHIVE_SIGNING_KEY_FILE",
): ArchiveSigningKeyring {
  const keys = new Map<number, Buffer>();
  for (const [index, rawLine] of text.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.length === 0) continue;
    const match = /^(\d+):([0-9a-fA-F]{64})$/.exec(line);
    if (match === null) {
      throw new Error(
        `${fileName} line ${index + 1} must be <version>:<64 hex chars>`,
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
    throw new Error(`${fileName} must contain at least one key`);
  }
  const currentVersion = Math.max(...keys.keys());
  return { currentVersion, keys };
}

export function parseWormCredentials(
  text: string,
  options: {
    readonly requireHttps: boolean;
    /** 缺省对象前缀（归档与备份各自独立）。 */
    readonly defaultPrefix?: string;
    /** 备份红线：归档/备份上传凭据必须对应至少该天数的对象锁。 */
    readonly requireObjectLockMinRetainDays?: number;
  },
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
  const prefix =
    prefixRaw === undefined
      ? (options.defaultPrefix ?? "inpulse/audit")
      : prefixRaw;
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

  if (options.requireObjectLockMinRetainDays !== undefined) {
    if (objectLock === null) {
      throw new Error(
        "upload credentials must set objectLock for offsite backup retention",
      );
    }
    if (objectLock.retainDays < options.requireObjectLockMinRetainDays) {
      throw new Error(
        "upload credentials objectLock.retainDays must be at least " +
          options.requireObjectLockMinRetainDays +
          " for offsite backup retention",
      );
    }
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

export async function resolveArchiveDatabaseUrl(): Promise<string> {
  return resolveRoleDatabaseUrl({
    directUrlName: "ARCHIVE_DATABASE_URL",
    defaultUser: "audit_archive_writer",
  });
}

/** 逻辑备份配置（技术设计 §11.5 / F-10.3）。 */
export interface BackupConfig {
  readonly databaseUrl: string;
  /** 本机密文目录（compose 卷 backup_encrypted 挂载点。生产默认 /backup）。 */
  readonly localDir: string;
  /** 本机密文保留天数（技术设计固定 7 天）。 */
  readonly localRetentionDays: number;
  /** pg_dump 可执行文件路径（生产镜像内置 PostgreSQL 18 客户端）。 */
  readonly pgDumpPath: string;
  /** 备份加密与清单签名共用的 keyring（<version>:<64 hex>）。 */
  readonly keyring: ArchiveSigningKeyring;
  /** 异机上传凭据（S3 兼容，必须带 >=30 天对象锁）。 */
  readonly upload: WormCredentials;
  readonly fetchTimeoutMs: number;
  /** 发布清单注入的 Git SHA；生产必填，进入签名清单。 */
  readonly gitSha: string | null;
  /** 发布清单注入的 ops 镜像引用；生产必填，进入签名清单。 */
  readonly imageRef: string | null;
}

function optionalReleaseField(name: string, pattern: RegExp): string | null {
  const raw = process.env[name]?.trim();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return null;
  }
  if (!pattern.test(raw)) {
    throw new Error(`${name} has an invalid format: ${raw}`);
  }
  return raw;
}

export async function loadBackupConfig(): Promise<BackupConfig> {
  const databaseUrl = await resolveRoleDatabaseUrl({
    directUrlName: "BACKUP_DATABASE_URL",
    defaultUser: "app_backup",
  });

  const keyFileName = "BACKUP_ENCRYPTION_KEY_FILE";
  const keyText = await readTrimmedSecret(required(keyFileName), keyFileName);
  const keyring = parseSigningKeyring(keyText, keyFileName);

  const uploadFileName = "OFFSITE_CREDENTIALS_FILE";
  const uploadText = await readTrimmedSecret(
    required(uploadFileName),
    uploadFileName,
  );
  const upload = parseWormCredentials(uploadText, {
    requireHttps: process.env.NODE_ENV === "production",
    defaultPrefix: "inpulse/backups",
    requireObjectLockMinRetainDays: 30,
  });

  const localDir = process.env["BACKUP_LOCAL_DIR"]?.trim() || "/backup";
  const retentionRaw = process.env["BACKUP_LOCAL_RETENTION_DAYS"]?.trim();
  const localRetentionDays =
    retentionRaw === undefined ? 7 : Number.parseInt(retentionRaw, 10);
  if (
    !Number.isSafeInteger(localRetentionDays) ||
    localRetentionDays < 1 ||
    localRetentionDays > 90
  ) {
    throw new Error(
      "BACKUP_LOCAL_RETENTION_DAYS must be an integer between 1 and 90",
    );
  }

  const pgDumpPath = process.env["BACKUP_PG_DUMP_PATH"]?.trim() || "pg_dump";

  const timeoutRaw = process.env["BACKUP_FETCH_TIMEOUT_MS"]?.trim();
  const fetchTimeoutMs =
    timeoutRaw === undefined ? 30_000 : Number.parseInt(timeoutRaw, 10);
  if (!Number.isSafeInteger(fetchTimeoutMs) || fetchTimeoutMs < 1_000) {
    throw new Error("BACKUP_FETCH_TIMEOUT_MS must be an integer >= 1000");
  }

  const gitSha = optionalReleaseField("BACKUP_GIT_SHA", /^[0-9a-f]{40}$/);
  const imageRef = optionalReleaseField(
    "BACKUP_IMAGE_REF",
    /^[^:\s]+:[^@\s]+@sha256:[0-9a-f]{64}$/,
  );

  return {
    databaseUrl,
    localDir,
    localRetentionDays,
    pgDumpPath,
    keyring,
    upload,
    fetchTimeoutMs,
    gitSha,
    imageRef,
  };
}
