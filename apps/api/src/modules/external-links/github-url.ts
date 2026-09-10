/**
 * GitHub 外部链接的规范化与类型识别（技术设计 §5.7 / ADR-022）。
 *
 * 只保存用户提交的 HTTPS GitHub 链接，不保存 Token、不发起网络请求。
 * 规范化必须先用标准 URL Parser 解析，禁止用字符串前缀判断域名：
 * 只接受 `https://github.com/`、固定 scheme 与 host、拒绝用户信息与非默认
 * 端口、移除默认端口与 fragment，并对允许保留的 query 参数建立白名单。
 */

const GITHUB_HOST = "github.com";
const HTTPS_DEFAULT_PORT = "443";

/** 允许保留的 query 参数白名单（其余一律丢弃，避免把无关状态写进唯一键）。 */
const ALLOWED_QUERY_PARAMETERS = new Set(["page", "q", "tab"]);

export type ExternalLinkKind = "ISSUE" | "PULL_REQUEST" | "COMMIT" | "OTHER";

export interface NormalizedGitHubUrl {
  readonly displayUrl: string;
  readonly normalizedUrl: string;
  readonly kind: ExternalLinkKind;
  readonly repository: string | null;
  readonly externalNumber: string | null;
  readonly externalSha: string | null;
}

export class InvalidGitHubUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidGitHubUrlError";
  }
}

/**
 * 解析并规范化 GitHub HTTPS 链接；任何不符合策略的输入都抛错，
 * 调用方不得回退到原始字符串。
 */
export function normalizeGitHubUrl(raw: string): NormalizedGitHubUrl {
  const displayUrl = raw.trim();
  if (displayUrl.length === 0 || displayUrl.length > 2048) {
    throw new InvalidGitHubUrlError("链接长度必须在 1 到 2048 之间");
  }

  let parsed: URL;
  try {
    parsed = new URL(displayUrl);
  } catch {
    throw new InvalidGitHubUrlError("链接不是合法的 URL");
  }

  if (parsed.protocol !== "https:") {
    throw new InvalidGitHubUrlError("只接受 https 协议的 GitHub 链接");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new InvalidGitHubUrlError("链接不得包含用户信息");
  }
  if (parsed.port !== "" && parsed.port !== HTTPS_DEFAULT_PORT) {
    throw new InvalidGitHubUrlError("链接不得使用非默认端口");
  }
  if (parsed.hostname.toLowerCase() !== GITHUB_HOST) {
    throw new InvalidGitHubUrlError("只接受 github.com 的链接");
  }

  // 用原始（已编码）pathname 构造规范 URL，避免解码后回写改变语义；
  // 分段解析单独做一次 decodeURIComponent 用于类型识别。
  const pathname = normalizePathname(parsed.pathname);
  const segments = decodedPathSegments(parsed.pathname);
  const external = inferExternalReference(segments);
  const query = normalizeQuery(parsed.searchParams);
  const normalizedUrl = `https://${GITHUB_HOST}${pathname}${query}`;
  if (normalizedUrl.length > 2048) {
    throw new InvalidGitHubUrlError("链接长度必须在 1 到 2048 之间");
  }

  return {
    displayUrl,
    normalizedUrl,
    kind: external.kind,
    repository: external.repository,
    externalNumber: external.externalNumber,
    externalSha: external.externalSha,
  };
}

function normalizePathname(pathname: string): string {
  const trimmed =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.replace(/\/+$/, "")
      : pathname;
  return trimmed.length === 0 ? "/" : trimmed;
}

function decodedPathSegments(pathname: string): readonly string[] {
  const segments = pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => {
      try {
        const decoded = decodeURIComponent(segment);
        if (decoded.includes("/")) {
          throw new InvalidGitHubUrlError("链接包含非法转义字符");
        }
        return decoded;
      } catch {
        throw new InvalidGitHubUrlError("链接包含非法转义字符");
      }
    });
  return segments;
}

function inferExternalReference(segments: readonly string[]): {
  readonly kind: ExternalLinkKind;
  readonly repository: string | null;
  readonly externalNumber: string | null;
  readonly externalSha: string | null;
} {
  const [owner, repository] = segments;
  const repositorySlug =
    owner !== undefined && repository !== undefined
      ? `${owner}/${repository}`
      : null;
  if (
    repositorySlug !== null &&
    (repositorySlug.length > 201 || /\s/.test(repositorySlug))
  ) {
    throw new InvalidGitHubUrlError("仓库路径格式或长度无效");
  }
  const extra = segments.slice(2);

  if (repositorySlug === null || extra.length === 0) {
    return {
      kind: "OTHER",
      repository: repositorySlug,
      externalNumber: null,
      externalSha: null,
    };
  }

  if (extra[0] === "issues" && isPositiveInteger(extra[1])) {
    return {
      kind: "ISSUE",
      repository: repositorySlug,
      externalNumber: extra[1]!,
      externalSha: null,
    };
  }
  if (extra[0] === "pull" && isPositiveInteger(extra[1])) {
    return {
      kind: "PULL_REQUEST",
      repository: repositorySlug,
      externalNumber: extra[1]!,
      externalSha: null,
    };
  }
  if (extra[0] === "commit" && isCommitSha(extra[1])) {
    return {
      kind: "COMMIT",
      repository: repositorySlug,
      externalNumber: null,
      externalSha: extra[1]!.toLowerCase(),
    };
  }

  return {
    kind: "OTHER",
    repository: repositorySlug,
    externalNumber: null,
    externalSha: null,
  };
}

function isPositiveInteger(value: string | undefined): boolean {
  if (value === undefined || !/^[0-9]+$/.test(value)) {
    return false;
  }
  const number = Number.parseInt(value, 10);
  return Number.isSafeInteger(number) && number > 0;
}

function isCommitSha(value: string | undefined): boolean {
  return value !== undefined && /^[0-9a-fA-F]{7,64}$/.test(value);
}

function normalizeQuery(searchParams: URLSearchParams): string {
  const kept = [...searchParams.entries()]
    .filter(([key]) => ALLOWED_QUERY_PARAMETERS.has(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) =>
      leftKey === rightKey
        ? leftValue.localeCompare(rightValue)
        : leftKey.localeCompare(rightKey),
    );
  if (kept.length === 0) {
    return "";
  }
  const normalized = new URLSearchParams();
  for (const [key, value] of kept) {
    normalized.append(key, value);
  }
  return `?${normalized.toString()}`;
}
