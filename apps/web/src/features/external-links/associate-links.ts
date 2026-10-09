import {
  ApiError,
  type ExternalLinkTargetPath,
  type InpulseApiClient,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";

/** 一条没关联上的链接与它原始的错误：调用方按原错误决定提示或重试。 */
export type LinkFailure = { readonly url: string; readonly error: unknown };

/**
 * 逐条把链接关联到目标上：链接是独立资源，服务端不搬运它们，因此先取目标当前的
 * 链接版本，再逐条用上一条响应回填的版本发 `If-Match`。409「已关联」按成功处理，
 * 其余失败逐条收集返回（一条失败不影响其余条目）；读取目标版本失败时整批算失败。
 * 调用方负责取 CSRF Token（一次签发可多次使用）与决定失败后的用户可见出口。
 */
export async function associateLinks(
  api: InpulseApiClient,
  targetType: ExternalLinkTargetPath["targetType"],
  targetId: number,
  urls: readonly string[],
  csrfToken: string,
): Promise<LinkFailure[]> {
  if (urls.length === 0) return [];
  let rowVersion: number;
  try {
    rowVersion = (await api.listExternalLinks(targetType, targetId)).rowVersion;
  } catch (error) {
    return urls.map((url) => ({ url, error }));
  }
  const failures: LinkFailure[] = [];
  for (const url of urls) {
    try {
      const added = await api.addExternalLink(
        targetType,
        targetId,
        { url },
        {
          headers: {
            "x-csrf-token": csrfToken,
            "If-Match": `"${rowVersion}"`,
            "Idempotency-Key": createIdempotencyKey("external-link"),
          },
        },
      );
      rowVersion = added.rowVersion;
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.code === "EXTERNAL_LINK_ALREADY_ASSOCIATED"
      )
        continue;
      failures.push({ url, error });
    }
  }
  return failures;
}
