import {
  buildSchemaComponents,
  resolveComponentRef,
  schemaRef,
  type JsonSchema,
  type SchemaComponents,
} from "./json-schema.js";
import {
  apiBasePath,
  routeRegistry,
  type RouteDefinition,
} from "./route-registry.js";

/** AGENTS.md 第 5 节固定的状态码语义。 */
export const statusDescriptions: Readonly<Record<string, string>> = {
  "200": "成功",
  "201": "已创建",
  "202": "已接受",
  "204": "成功且无响应体",
  "400": "请求格式或业务参数错误",
  "401": "未登录或 Session 失效",
  "403": "已登录但无全局权限",
  "404": "资源不存在或当前用户不可访问",
  "409": "版本冲突、重复操作或状态冲突",
  "422": "字段校验错误",
  "429": "限流",
  "500": "未预期错误，不向客户端泄露堆栈",
  "503": "服务未就绪（就绪探针未通过）",
};

export const apiDocumentVersion = "1.0.0";

export function pathParameters(path: string): readonly string[] {
  return [...path.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map(
    (match) => match[1]!,
  );
}

function isRecord(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function objectProperties(
  schemaRef: string,
  schemas: SchemaComponents,
): {
  properties: Readonly<Record<string, JsonSchema>>;
  required: ReadonlySet<string>;
} {
  const resolved = resolveComponentRef(schemaRef, schemas.components);
  const rawProperties = resolved.properties;
  if (!isRecord(rawProperties)) {
    throw new Error(
      `Schema ${schemaRef} must be an object to expand into OpenAPI parameters`,
    );
  }
  const properties: Record<string, JsonSchema> = {};
  for (const [key, value] of Object.entries(rawProperties)) {
    if (!isRecord(value)) {
      throw new Error(`Schema ${schemaRef}.${key} is not a JSON Schema object`);
    }
    properties[key] = value;
  }
  return {
    properties,
    required: new Set(
      Array.isArray(resolved.required) ? resolved.required.map(String) : [],
    ),
  };
}

function buildParameters(
  route: RouteDefinition,
  schemas: SchemaComponents,
): JsonSchema[] {
  const parameters: JsonSchema[] = [];
  const declared: Array<{
    location: "path" | "query" | "header";
    ref: string;
  }> = [];
  if (route.request.path !== "none") {
    declared.push({
      location: "path",
      ref: schemaRef(schemas, route.request.path),
    });
  }
  if (route.request.query !== "none") {
    declared.push({
      location: "query",
      ref: schemaRef(schemas, route.request.query),
    });
  }
  if (route.request.headers !== "none") {
    declared.push({
      location: "header",
      ref: schemaRef(schemas, route.request.headers),
    });
  }

  for (const entry of declared) {
    const { properties, required } = objectProperties(entry.ref, schemas);
    for (const [name, schema] of Object.entries(properties)) {
      const isPathParameter = entry.location === "path";
      const isArray = schema.type === "array";
      parameters.push({
        name,
        in: entry.location,
        required: isPathParameter ? true : required.has(name),
        schema,
        // 生成客户端把数组序列化为逗号分隔字符串（toQueryString 的 String(value)），
        // OpenAPI 必须按同一形式声明，避免文档与真实 wire format 不一致。
        ...(isArray && !isPathParameter
          ? { style: "form", explode: false }
          : {}),
      });
    }
  }
  return parameters;
}

function buildRequestBody(
  route: RouteDefinition,
  schemas: SchemaComponents,
): JsonSchema | undefined {
  if ("noBody" in route.request.body) {
    return undefined;
  }
  const content: JsonSchema = {};
  for (const binding of route.request.body.contentTypes) {
    content[binding.contentType] = {
      schema: { $ref: schemaRef(schemas, binding.schemaRef) },
    };
  }
  return { required: true, content };
}

function buildResponses(
  route: RouteDefinition,
  schemas: SchemaComponents,
): JsonSchema {
  const responses: JsonSchema = {};
  const statuses = Object.keys(route.responses).sort(
    (left, right) => Number(left) - Number(right),
  );
  for (const status of statuses) {
    const binding = route.responses[status]!;
    const description = statusDescriptions[status] ?? "见技术设计 4.2";
    if ("noBody" in binding) {
      // ADR-019：noBody 响应不得出现 OpenAPI content。
      responses[status] = { description };
      continue;
    }
    const content: JsonSchema = {};
    for (const entry of binding.body.contentTypes) {
      content[entry.contentType] = {
        schema: { $ref: schemaRef(schemas, entry.schemaRef) },
      };
    }
    responses[status] = { description, content };
  }
  return responses;
}

/** OpenAPI 是 Route Registry 的投影：策略元数据随操作一起生成，供 Guard 与客户端读取。 */
function policyExtension(route: RouteDefinition): JsonSchema {
  return {
    authPolicy: route.authPolicy,
    csrfPolicy: route.csrfPolicy,
    idempotencyPolicy: route.idempotencyPolicy,
    idempotencyExceptionAdr: route.idempotencyExceptionAdr,
    idempotencyContractVersion: route.idempotencyContractVersion,
    idempotencyFingerprintVersion: route.idempotencyFingerprintVersion,
    behaviorHeaders: route.behaviorHeaders,
    idempotencyReplayPolicy: route.idempotencyReplayPolicy,
    replayAuthorizationPolicy: route.replayAuthorizationPolicy,
    securityFlowPolicy: route.securityFlowPolicy,
    versionPolicy: route.versionPolicy,
    concurrencyPolicy: route.concurrencyPolicy,
    auditAction: route.auditAction,
  } as unknown as JsonSchema;
}

export function buildOpenApiDocument(
  routes: readonly RouteDefinition[],
  schemas: SchemaComponents,
): JsonSchema {
  const paths: Record<string, JsonSchema> = {};
  const ordered = [...routes].sort((left, right) =>
    left.path === right.path
      ? left.method.localeCompare(right.method)
      : left.path.localeCompare(right.path),
  );

  for (const route of ordered) {
    const operation: JsonSchema = {
      operationId: route.operationId,
      summary: route.summary,
      responses: buildResponses(route, schemas),
      "x-inpulse-policy": policyExtension(route),
    };
    const parameters = buildParameters(route, schemas);
    if (parameters.length > 0) {
      operation.parameters = parameters;
    }
    const requestBody = buildRequestBody(route, schemas);
    if (requestBody) {
      operation.requestBody = requestBody;
    }
    const pathItem = paths[route.path] ?? {};
    pathItem[route.method.toLowerCase()] = operation;
    paths[route.path] = pathItem;
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "InPulse API",
      version: apiDocumentVersion,
      description:
        "由 packages/api-contract 的 Schema Registry 与 Route Registry 生成，禁止手工修改。",
    },
    servers: [{ url: apiBasePath }],
    paths,
    components: { schemas: schemas.components },
  } as JsonSchema;
}

export function buildDefaultOpenApiDocument(): JsonSchema {
  return buildOpenApiDocument(routeRegistry, buildSchemaComponents());
}
