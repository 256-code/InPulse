import { createHash, createHmac } from "node:crypto";

/** AWS Signature Version 4 凭据（S3 兼容对象存储）。 */
export interface AwsSigV4Credentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
  readonly service: string;
}

export interface SignAwsRequestInput {
  readonly method: string;
  readonly url: URL;
  /** 参与签名的请求头（至少含 host；可含 content-type、x-amz-*）。 */
  readonly headers: Readonly<Record<string, string>>;
  /** 请求体 SHA-256 十六进制（空体为 e3b0c442...）。 */
  readonly payloadHash: string;
  readonly date: Date;
}

const ALGORITHM = "AWS4-HMAC-SHA256";

/** RFC 3986 编码（SigV4 要求，encodeURIComponent 额外转义 !'()*）。 */
export function rfc3986Encode(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sha256Hex(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function canonicalUri(url: URL): string {
  // S3 使用单次编码路径，保留路径分隔符。
  const path = url.pathname === "" ? "/" : url.pathname;
  return path
    .split("/")
    .map((segment) => rfc3986Encode(decodeURIComponentSafe(segment)))
    .join("/");
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function canonicalQuery(url: URL): string {
  const pairs = [...url.searchParams.entries()];
  pairs.sort(([leftKey, leftValue], [rightKey, rightValue]) => {
    if (leftKey !== rightKey) return leftKey < rightKey ? -1 : 1;
    if (leftValue === rightValue) return 0;
    return leftValue < rightValue ? -1 : 1;
  });
  return pairs
    .map(([key, value]) => `${rfc3986Encode(key)}=${rfc3986Encode(value)}`)
    .join("&");
}

function normalizeHeaderValue(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function amzTimestamp(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString();
  const dateStamp = iso.slice(0, 10).replace(/-/g, "");
  const amzDate = `${dateStamp}T${iso.slice(11, 19).replace(/:/g, "")}Z`;
  return { amzDate, dateStamp };
}

/**
 * 对请求做 SigV4 签名，返回应随请求发送的完整头集合（含 Authorization、
 * x-amz-date、x-amz-content-sha256）。host 头由调用方提供（默认取 url.host）。
 */
export function signAwsRequest(
  input: SignAwsRequestInput,
  credentials: AwsSigV4Credentials,
): Record<string, string> {
  const { amzDate, dateStamp } = amzTimestamp(input.date);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) {
    headers[name.toLowerCase()] = normalizeHeaderValue(value);
  }
  headers["x-amz-date"] = amzDate;
  if (headers["host"] === undefined || headers["host"] === "") {
    headers["host"] = input.url.host;
  }

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames
    .map((name) => `${name}:${headers[name] ?? ""}\n`)
    .join("");
  const signedHeaders = sortedNames.join(";");
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(input.url),
    canonicalQuery(input.url),
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${credentials.region}/${credentials.service}/aws4_request`;
  const stringToSign = [
    ALGORITHM,
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(
      hmac(
        hmac(`AWS4${credentials.secretAccessKey}`, dateStamp),
        credentials.region,
      ),
      credentials.service,
    ),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey)
    .update(stringToSign, "utf8")
    .digest("hex");

  return {
    ...headers,
    authorization:
      `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
