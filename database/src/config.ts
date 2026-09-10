import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { dirname, posix } from "node:path";

const productionSecretRoot = "/run/secrets";

/**
 * 生产 Secret 必须是常规文件且模式位只允许属主读取：必须包含属主读位
 * （`0o400`），且不得包含组权限、其他权限或任一执行位（`0o177`）。
 * 任一条件不满足都 fail closed，不回退到敏感环境变量。
 */
export function isPrivateOwnerReadableFile(
  isFile: boolean,
  mode: number,
): boolean {
  const permissions = mode & 0o777;
  return isFile && (permissions & 0o400) !== 0 && (permissions & 0o177) === 0;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function readTrimmedSecret(path: string, label: string): Promise<string> {
  let pathToRead = path;

  if (process.env.NODE_ENV === "production") {
    const normalizedPath = posix.normalize(path);
    if (
      !posix.isAbsolute(path) ||
      normalizedPath !== path ||
      posix.dirname(normalizedPath) !== productionSecretRoot
    ) {
      throw new Error(
        `${label} must name a direct child of ${productionSecretRoot}`,
      );
    }

    const [resolvedRoot, resolvedPath, linkMetadata] = await Promise.all([
      realpath(productionSecretRoot),
      realpath(path),
      lstat(path),
    ]);
    if (
      linkMetadata.isSymbolicLink() ||
      dirname(resolvedPath) !== resolvedRoot
    ) {
      throw new Error(`${label} resolves outside ${productionSecretRoot}`);
    }

    const metadata = await stat(resolvedPath);
    if (!isPrivateOwnerReadableFile(metadata.isFile(), metadata.mode)) {
      throw new Error(`${label} is not a private owner-readable regular file`);
    }
    pathToRead = resolvedPath;
  }

  const value = (await readFile(pathToRead, "utf8")).trim();
  if (!value) {
    throw new Error(`${label} is empty`);
  }
  return value;
}

export async function resolveDatabaseUrl(
  purpose: "MIGRATION" | "RUNTIME" | "TEST_BOOTSTRAP",
): Promise<string> {
  const urlFileName = `${purpose}_DATABASE_URL_FILE`;
  const urlName =
    purpose === "RUNTIME" ? "DATABASE_URL" : `${purpose}_DATABASE_URL`;
  const urlFile = process.env[urlFileName]?.trim();

  if (urlFile) {
    return readTrimmedSecret(urlFile, urlFileName);
  }

  const directUrl = process.env[urlName]?.trim();
  if (directUrl) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `${urlName} is forbidden in production; use ${urlFileName} or a password file`,
      );
    }
    return directUrl;
  }

  if (purpose === "TEST_BOOTSTRAP") {
    throw new Error(
      `Set ${urlFileName} or ${urlName} for database integration tests`,
    );
  }

  const passwordFileName = `${purpose}_DB_PASSWORD_FILE`;
  const passwordFile = required(passwordFileName);
  const password = await readTrimmedSecret(passwordFile, passwordFileName);
  const user =
    process.env[`${purpose}_DB_USER`]?.trim() ??
    (purpose === "MIGRATION" ? "app_migrator" : "app_runtime");
  const host = required("DB_HOST");
  const port = process.env.DB_PORT?.trim() || "5432";
  const database = process.env.DB_NAME?.trim() || "app";
  const url = new URL("postgresql://placeholder");
  url.username = user;
  url.password = password;
  url.hostname = host;
  url.port = port;
  url.pathname = `/${database}`;
  url.searchParams.set("sslmode", process.env.DB_SSLMODE?.trim() || "require");
  return url.toString();
}
