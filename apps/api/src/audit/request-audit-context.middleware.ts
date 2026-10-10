import { Injectable, type NestMiddleware } from "@nestjs/common";

import {
  requestAuditMetaFrom,
  runWithRequestAuditMeta,
} from "./request-audit-context.js";

interface AuditContextRequest {
  readonly headers?: Record<string, string | readonly string[] | undefined>;
  readonly ip?: string;
  readonly socket?: { readonly remoteAddress?: string };
}

/**
 * 为每个已匹配路由建立请求级审计上下文。Express 的 `next()` 在同一同步调用栈内
 * 展开后续中间件与处理器，因此处理器链上的异步操作都继承该上下文。
 */
@Injectable()
export class RequestAuditContextMiddleware implements NestMiddleware {
  use(
    request: AuditContextRequest,
    _response: unknown,
    next: () => void,
  ): void {
    runWithRequestAuditMeta(requestAuditMetaFrom(request), next);
  }
}
