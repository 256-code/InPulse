import type { JsonSchema, SchemaComponents } from "../src/json-schema.js";
import type { RouteDefinition } from "../src/route-registry.js";

export const objectSchema = (
  properties: Record<string, JsonSchema>,
  required: readonly string[] = Object.keys(properties),
): JsonSchema => ({
  type: "object",
  properties,
  required: [...required],
  additionalProperties: false,
});

export const syntheticSchemas: SchemaComponents = {
  components: {
    ErrorResponse: objectSchema({
      code: { type: "string" },
      message: { type: "string" },
      details: { type: "object", additionalProperties: {} },
      requestId: { type: "string" },
    }),
    HealthResponse: objectSchema({ status: { type: "string", const: "ok" } }),
    ReplayResponse: objectSchema({
      id: { type: "integer" },
      nested: objectSchema({ value: { type: "string" } }),
      secret: { type: "string" },
    }),
  },
  rootRefs: {
    ErrorResponse: "#/components/schemas/ErrorResponse",
    HealthResponse: "#/components/schemas/HealthResponse",
    ReplayResponse: "#/components/schemas/ReplayResponse",
  },
};

const baseRoute: RouteDefinition = {
  method: "GET",
  path: "/health",
  operationId: "getHealth",
  summary: "测试用路由。",
  request: {
    path: "none",
    query: "none",
    headers: "none",
    body: { noBody: true },
  },
  responses: {
    "200": {
      body: {
        contentTypes: [
          { contentType: "application/json", schemaRef: "HealthResponse" },
        ],
      },
    },
  },
  authPolicy: "none",
  csrfPolicy: "none",
  idempotencyPolicy: "none",
  idempotencyExceptionAdr: "none",
  idempotencyContractVersion: "none",
  idempotencyFingerprintVersion: "none",
  behaviorHeaders: "none",
  idempotencyReplayPolicy: "none",
  replayAuthorizationPolicy: "none",
  securityFlowPolicy: "none",
  versionPolicy: "none",
  concurrencyPolicy: "none",
  auditAction: "none",
};

/** 测试可以注入合成 Schema 名，因此覆盖字段按 unknown 处理。 */
export type RouteOverrides = Partial<Record<keyof RouteDefinition, unknown>>;

export function makeRoute(overrides: RouteOverrides = {}): RouteDefinition {
  return { ...baseRoute, ...overrides } as unknown as RouteDefinition;
}

export function writeRoute(overrides: RouteOverrides = {}): RouteDefinition {
  return makeRoute({
    method: "POST",
    path: "/replayable",
    operationId: "createReplayable",
    csrfPolicy: "required",
    idempotencyPolicy: "idempotencyRequired",
    idempotencyContractVersion: "1.0.0",
    idempotencyFingerprintVersion: "1.0.0",
    behaviorHeaders: [],
    responses: {
      "201": {
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ReplayResponse" },
          ],
        },
      },
    },
    idempotencyReplayPolicy: {
      version: "1.0.0",
      success: {
        "201": {
          body: {
            responseSchemaRef: "ReplayResponse",
            safeBodyFieldPaths: ["id", "nested.value", "secret"],
          },
        },
      },
    },
    replayAuthorizationPolicy: { version: "1.0.0", actorOnly: true },
    ...overrides,
  });
}
