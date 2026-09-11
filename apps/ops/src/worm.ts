import type { WormCredentials } from "./config.js";
import { sha256Hex } from "./crypto.js";
import { rfc3986Encode, signAwsRequest } from "./sigv4.js";

export interface WormPutResult {
  readonly key: string;
  /** false 表示对象已存在（WORM 拒绝覆盖，视为幂等成功）。 */
  readonly created: boolean;
  readonly status: number;
}

export interface WormClientOptions {
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => Date;
}

const EMPTY_SHA256 = sha256Hex("");

/**
 * S3 兼容 WORM 对象存储的最小客户端：只实现归档所需的 PUT/GET，
 * 使用 SigV4 签名；对象锁（Object Lock）头由凭据配置驱动。
 * 覆盖已有对象时对象存储返回 409/412，视为“已存在”的幂等成功。
 */
export class WormClient {
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    private readonly credentials: WormCredentials,
    private readonly options: WormClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private sleep(ms: number): Promise<void> {
    if (this.options.sleep !== undefined) {
      return this.options.sleep(ms);
    }
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  buildObjectUrl(key: string): URL {
    const base = this.credentials.endpoint;
    const basePath = base.pathname.replace(/\/+$/, "");
    const encodedKey = key
      .split("/")
      .map((segment) => rfc3986Encode(segment))
      .join("/");
    if (this.credentials.forcePathStyle) {
      return new URL(
        `${base.protocol}//${base.host}${basePath}/${rfc3986Encode(this.credentials.bucket)}/${encodedKey}`,
      );
    }
    return new URL(
      `${base.protocol}//${this.credentials.bucket}.${base.host}${basePath}/${encodedKey}`,
    );
  }

  private credentialsForSigning() {
    return {
      accessKeyId: this.credentials.accessKeyId,
      secretAccessKey: this.credentials.secretAccessKey,
      region: this.credentials.region,
      service: "s3",
    };
  }

  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<WormPutResult> {
    const url = this.buildObjectUrl(key);
    const payloadHash = sha256Hex(body);
    const now = this.now();
    const headers: Record<string, string> = {
      host: url.host,
      "content-type": contentType,
      "x-amz-content-sha256": payloadHash,
    };
    const lock = this.credentials.objectLock;
    if (lock !== null) {
      headers["x-amz-object-lock-mode"] = lock.mode;
      headers["x-amz-object-lock-retain-until-date"] = new Date(
        now.getTime() + lock.retainDays * 86_400_000,
      ).toISOString();
    }
    const signed = signAwsRequest(
      { method: "PUT", url, headers, payloadHash, date: now },
      this.credentialsForSigning(),
    );

    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) {
        await this.sleep(500 * 2 ** (attempt - 1));
      }
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: "PUT",
          headers: signed,
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        lastError = error;
        continue;
      }
      if (response.status === 200 || response.status === 201) {
        return { key, created: true, status: response.status };
      }
      if (response.status === 409 || response.status === 412) {
        return { key, created: false, status: response.status };
      }
      if (response.status >= 500) {
        lastError = new Error(`WORM responded ${response.status} for ${key}`);
        continue;
      }
      throw new Error(`WORM put ${key} failed with status ${response.status}`);
    }
    throw new Error(
      `WORM put ${key} failed after retries: ${
        lastError instanceof Error ? lastError.message : String(lastError)
      }`,
    );
  }

  async getObject(key: string): Promise<Buffer> {
    const url = this.buildObjectUrl(key);
    const now = this.now();
    const signed = signAwsRequest(
      {
        method: "GET",
        url,
        headers: { host: url.host, "x-amz-content-sha256": EMPTY_SHA256 },
        payloadHash: EMPTY_SHA256,
        date: now,
      },
      this.credentialsForSigning(),
    );
    const response = await this.fetchImpl(url, {
      method: "GET",
      headers: signed,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (response.status === 404) {
      throw new Error(`WORM object not found: ${key}`);
    }
    if (!response.ok) {
      throw new Error(`WORM get ${key} failed with status ${response.status}`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
