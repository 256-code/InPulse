import {
  routeRegistry,
  schemaRegistry,
  type RouteDefinition,
  type SchemaName,
} from "@inpulse/api-contract";
import type { ContractRequestPart, ZodErrorLike } from "./contract-errors.js";

export interface ContractSchema {
  safeParse(
    value: unknown,
  ):
    | { readonly success: true; readonly data: unknown }
    | { readonly success: false; readonly error: ZodErrorLike };
  /**
   * Zod object 的 shape 键名。请求头校验只提取声明的字段，避免 Express
   * 自动附加的 host/connection 等真实头部被 `.strict()` 当成未知字段拒绝。
   */
  readonly headerKeys?: readonly string[];
}

const routesByOperationId = new Map(
  routeRegistry.map((route) => [route.operationId, route]),
);

export function getContractRoute(operationId: string): RouteDefinition {
  const route = routesByOperationId.get(operationId);
  if (route === undefined) {
    throw new Error(`Route Registry has no operationId ${operationId}`);
  }
  return route;
}

export function getRequestSchema(
  operationId: string,
  part: ContractRequestPart,
): ContractSchema | undefined {
  const route = getContractRoute(operationId);
  if (part === "body") {
    if ("noBody" in route.request.body) {
      return undefined;
    }
    const json = route.request.body.contentTypes.find(
      (contentType) => contentType.contentType === "application/json",
    );
    return json === undefined ? undefined : resolveSchema(json.schemaRef);
  }
  const ref = route.request[part];
  return ref === "none" ? undefined : resolveSchema(ref);
}

export function getResponseSchema(
  operationId: string,
  status: number,
): ContractSchema | undefined {
  const responses = getContractRoute(operationId).responses;
  const binding = responses[String(status)];
  if (binding === undefined || "noBody" in binding) {
    return undefined;
  }
  const json = binding.body.contentTypes.find(
    (contentType) => contentType.contentType === "application/json",
  );
  return json === undefined ? undefined : resolveSchema(json.schemaRef);
}

function resolveSchema(ref: SchemaName): ContractSchema {
  const entry = schemaRegistry[ref];
  if (entry === undefined) {
    throw new Error(`Schema Registry has no schema ${ref}`);
  }
  const objectSchema = entry.schema as unknown as {
    readonly shape?: Readonly<Record<string, unknown>>;
  };
  return {
    safeParse: (value) => entry.schema.safeParse(value),
    headerKeys: Object.keys(objectSchema.shape ?? {}),
  };
}
