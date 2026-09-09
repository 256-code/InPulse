import { createParamDecorator, type ExecutionContext } from "@nestjs/common";

import { ContractValidationPipe } from "./contract-validation.pipe.js";

export const CONTRACT_OPERATION_METADATA = "inpulse:contract:operation";

export function Operation(operationId: string): MethodDecorator {
  return (
    _target: object,
    _propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) => {
    Reflect.defineMetadata(
      CONTRACT_OPERATION_METADATA,
      operationId,
      descriptor.value,
    );
  };
}

export function ContractBody(operationId: string): ParameterDecorator {
  return contractParam("body", operationId);
}

export function ContractQuery(operationId: string): ParameterDecorator {
  return contractParam("query", operationId);
}

export function ContractPath(operationId: string): ParameterDecorator {
  return contractParam("path", operationId);
}

export function ContractHeaders(operationId: string): ParameterDecorator {
  return contractParam("headers", operationId);
}

function contractParam(
  part: "body" | "query" | "path" | "headers",
  operationId: string,
): ParameterDecorator {
  const pipe = new ContractValidationPipe(operationId, part);
  return createParamDecorator((_data: unknown, context: ExecutionContext) => {
    const request = context.switchToHttp().getRequest<{
      readonly body?: unknown;
      readonly query?: unknown;
      readonly params?: unknown;
      readonly headers?: unknown;
    }>();
    const value =
      part === "body"
        ? request.body
        : part === "query"
          ? request.query
          : part === "path"
            ? request.params
            : request.headers;
    return pipe.transform(value);
  })();
}
