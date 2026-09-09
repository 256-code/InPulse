import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { map, type Observable } from "rxjs";

import { CONTRACT_OPERATION_METADATA } from "./contract.decorators.js";
import { ContractResponseError } from "./contract-errors.js";
import { getResponseSchema } from "./contract-runtime.js";

/**
 * 从 @Operation 元数据读取 operationId，再按实际响应状态选择
 * Route Registry 的响应 Schema 校验并剔除未知字段。
 */
@Injectable()
export class ContractResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const operationId = Reflect.getMetadata(
      CONTRACT_OPERATION_METADATA,
      context.getHandler(),
    ) as string | undefined;
    if (operationId === undefined) {
      return next.handle();
    }

    return next.handle().pipe(
      map((body: unknown) => {
        const response = context
          .switchToHttp()
          .getResponse<{ statusCode: number }>();
        const status = response.statusCode;
        const schema = getResponseSchema(operationId, status);
        if (schema === undefined) {
          return body;
        }
        const parsed = schema.safeParse(body);
        if (!parsed.success) {
          throw new ContractResponseError(operationId, status);
        }
        return parsed.data;
      }),
    );
  }
}
