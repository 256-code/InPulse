import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";

import { ApiHttpError } from "../http/contract-errors.js";
import {
  mutationSameOriginValidationError,
  type HttpHeaderBag,
} from "./csrf.http.js";

/**
 * 非安全方法与同源/Fetch Metadata 校验。作为 Guard 在 Nest 参数 Pipe 之前
 * 执行，保证 403 优先于 422，同时继续由 Controller 内层校验兜底。
 */
@Injectable()
export class StrictSameOriginGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<{ readonly headers: HttpHeaderBag }>();
    const failure = mutationSameOriginValidationError(request.headers);
    if (failure !== undefined) {
      throw new ApiHttpError(
        403,
        "CSRF_ORIGIN_REJECTED",
        "请求未通过同源或 Fetch Metadata 校验",
        { reason: failure },
      );
    }
    return true;
  }
}
