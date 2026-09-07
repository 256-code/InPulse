import { describe, expect, test } from "vitest";

import {
  renderClientSource,
  renderTypesSource,
  pathParametersOf,
} from "../src/client.js";
import {
  computeRouteFingerprint,
  mergeFingerprintHistory,
} from "../src/fingerprints.js";
import {
  buildSchemaComponents,
  collectLeafPaths,
  type JsonSchema,
  type SchemaComponents,
} from "../src/json-schema.js";
import { buildOpenApiDocument } from "../src/openapi.js";
import { routeRegistry } from "../src/route-registry.js";
import { makeRoute, objectSchema, syntheticSchemas } from "./helpers.js";

const parameterSchemas: SchemaComponents = {
  components: {
    ...syntheticSchemas.components,
    ThingPath: objectSchema({ thingId: { type: "integer" } }),
    ThingQuery: objectSchema({ expand: { type: "string" } }, []),
    ThingBody: objectSchema({ name: { type: "string" } }),
  },
  rootRefs: {
    ...syntheticSchemas.rootRefs,
    ThingPath: "#/components/schemas/ThingPath",
    ThingQuery: "#/components/schemas/ThingQuery",
    ThingBody: "#/components/schemas/ThingBody",
  },
};

describe("OpenAPI 3.1 生成", () => {
  test("真实 Registry 生成 3.1 文档、servers 与组件", () => {
    const document = buildOpenApiDocument(
      routeRegistry,
      buildSchemaComponents(),
    );
    expect(document.openapi).toBe("3.1.0");
    expect(document.servers).toEqual([{ url: "/api/v1" }]);
    const operation = (document.paths as Record<string, JsonSchema>)[
      "/health"
    ] as JsonSchema;
    const get = operation["get"] as JsonSchema;
    expect(get["operationId"]).toBe("getHealth");
    expect((get["x-inpulse-policy"] as JsonSchema)["authPolicy"]).toBe("none");
    expect(
      (
        ((get["responses"] as JsonSchema)["200"] as JsonSchema)[
          "content"
        ] as JsonSchema
      )["application/json"],
    ).toEqual({ schema: { $ref: "#/components/schemas/HealthResponse" } });
  });

  test("noBody 响应不得出现 content", () => {
    const route = makeRoute({
      method: "POST",
      path: "/things",
      operationId: "createThing",
      csrfPolicy: "required",
      responses: { "204": { noBody: true } },
    });
    const document = buildOpenApiDocument([route], syntheticSchemas);
    const responses = (
      (document.paths as Record<string, JsonSchema>)["/things"] as JsonSchema
    )["post"] as JsonSchema;
    const noContent = (responses["responses"] as JsonSchema)[
      "204"
    ] as JsonSchema;
    expect(noContent).toEqual({ description: "成功且无响应体" });
    expect(noContent).not.toHaveProperty("content");
  });

  test("path 与 query Schema 展开为 OpenAPI parameters", () => {
    const route = makeRoute({
      method: "POST",
      path: "/things/{thingId}",
      operationId: "updateThing",
      csrfPolicy: "required",
      request: {
        path: "ThingPath",
        query: "ThingQuery",
        headers: "none",
        body: { noBody: true },
      },
    });
    const document = buildOpenApiDocument([route], parameterSchemas);
    const operation = (
      (document.paths as Record<string, JsonSchema>)[
        "/things/{thingId}"
      ] as JsonSchema
    )["post"] as JsonSchema;
    expect(operation["parameters"]).toEqual([
      {
        name: "thingId",
        in: "path",
        required: true,
        schema: { type: "integer" },
      },
      {
        name: "expand",
        in: "query",
        required: false,
        schema: { type: "string" },
      },
    ]);
  });

  test("请求体按 Content-Type 绑定 Schema", () => {
    const route = makeRoute({
      method: "POST",
      path: "/things",
      operationId: "createThing",
      csrfPolicy: "required",
      request: {
        path: "none",
        query: "none",
        headers: "none",
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ThingBody" },
          ],
        },
      },
    });
    const document = buildOpenApiDocument([route], parameterSchemas);
    const operation = (
      (document.paths as Record<string, JsonSchema>)["/things"] as JsonSchema
    )["post"] as JsonSchema;
    expect(operation["requestBody"]).toEqual({
      required: true,
      content: {
        "application/json": {
          schema: { $ref: "#/components/schemas/ThingBody" },
        },
      },
    });
  });
});

describe("客户端生成", () => {
  test("生成自包含类型且常量字段成为字面量类型", () => {
    const source = renderTypesSource(syntheticSchemas);
    expect(source).toContain(
      'export type HealthResponse = {\n  readonly status: "ok";\n};',
    );
    expect(source).toContain(
      "readonly details: Readonly<Record<string, unknown>>;",
    );
    expect(source).not.toContain("any");
  });

  test("路径参数、查询与请求体都进入方法签名", () => {
    const route = makeRoute({
      method: "POST",
      path: "/things/{thingId}",
      operationId: "updateThing",
      csrfPolicy: "required",
      request: {
        path: "ThingPath",
        query: "ThingQuery",
        headers: "none",
        body: {
          contentTypes: [
            { contentType: "application/json", schemaRef: "ThingBody" },
          ],
        },
      },
      responses: {
        "200": {
          body: {
            contentTypes: [
              { contentType: "application/json", schemaRef: "ReplayResponse" },
            ],
          },
        },
      },
    });
    const source = renderClientSource([route], parameterSchemas);
    expect(source).toContain(
      "updateThing(thingId: number, query: ThingQuery, body: ThingBody, init?: ApiRequestInit)",
    );
    expect(source).toContain(
      'return send<ReplayResponse>(options, "POST", `/things/${encodeURIComponent(String(thingId))}`, toQueryString(query), init, body);',
    );
    expect(source).toContain('export const apiBasePath = "/api/v1";');
  });

  test("204 路由使用 sendEmpty，并且不生成未使用的 helper", () => {
    const route = makeRoute({
      method: "POST",
      path: "/things",
      operationId: "createThing",
      csrfPolicy: "required",
      responses: { "204": { noBody: true } },
    });
    const source = renderClientSource([route], syntheticSchemas);
    expect(source).toContain(
      "createThing(init?: ApiRequestInit): Promise<void>;",
    );
    expect(source).toContain("async function sendEmpty(");
    expect(source).not.toContain("async function send<");
    expect(source).not.toContain("function toQueryString(");
  });

  test("真实 Registry 生成的客户端只包含已登记路由", () => {
    const source = renderClientSource(routeRegistry, buildSchemaComponents());
    expect(source).toContain(
      "getHealth(init?: ApiRequestInit): Promise<HealthResponse>;",
    );
    expect(source).toContain(
      'return send<HealthResponse>(options, "GET", "/health", "", init);',
    );
  });

  test("无法表达的 Schema 必须失败而不是退化成 any", () => {
    expect(() =>
      renderTypesSource({
        components: { Weird: { not: "supported" } },
        rootRefs: { Weird: "#/components/schemas/Weird" },
      }),
    ).toThrow(/Unsupported JSON Schema node/);
  });
});

describe("叶子字段与契约 fingerprint", () => {
  test("collectLeafPaths 覆盖嵌套对象、数组与 record", () => {
    const schemas: SchemaComponents = {
      components: {
        Nested: objectSchema({
          id: { type: "integer" },
          child: objectSchema({ value: { type: "string" } }),
          items: {
            type: "array",
            items: objectSchema({ tag: { type: "string" } }),
          },
          meta: { type: "object", additionalProperties: { type: "string" } },
        }),
      },
      rootRefs: { Nested: "#/components/schemas/Nested" },
    };
    expect(
      collectLeafPaths(schemas.rootRefs["Nested"]!, schemas.components),
    ).toEqual(["child.value", "id", "items[].tag", "meta.*"]);
  });

  test("path 参数解析", () => {
    expect(pathParametersOf("/tasks/{taskId}/groups/{groupId}")).toEqual([
      "taskId",
      "groupId",
    ]);
  });

  test("fingerprint 稳定且随行为头变化", () => {
    const route = makeRoute({
      method: "POST",
      path: "/things",
      operationId: "createThing",
      csrfPolicy: "required",
      idempotencyPolicy: "idempotencyRequired",
      idempotencyContractVersion: "1.0.0",
      idempotencyFingerprintVersion: "1.0.0",
      behaviorHeaders: ["If-Match"],
    });
    const first = computeRouteFingerprint(route, syntheticSchemas);
    expect(first).toBe(computeRouteFingerprint(route, syntheticSchemas));
    expect(first).not.toBe(
      computeRouteFingerprint(
        { ...route, behaviorHeaders: ["If-Match", "Accept-Language"] },
        syntheticSchemas,
      ),
    );
  });

  test("mergeFingerprintHistory 只追加新版本，不覆盖既有版本", () => {
    const route = makeRoute({
      method: "POST",
      path: "/things",
      operationId: "createThing",
      csrfPolicy: "required",
      idempotencyPolicy: "idempotencyRequired",
      idempotencyContractVersion: "1.1.0",
      idempotencyFingerprintVersion: "1.0.0",
      behaviorHeaders: [],
    });
    const existing = {
      createThing: [{ version: "1.0.0", fingerprint: "a".repeat(64) }],
    };
    const merged = mergeFingerprintHistory(existing, [route], syntheticSchemas);
    expect(merged["createThing"]).toHaveLength(2);
    expect(merged["createThing"]?.[1]?.version).toBe("1.1.0");

    const sameVersion = mergeFingerprintHistory(
      {
        createThing: [
          {
            version: "1.1.0",
            fingerprint: "b".repeat(64),
          },
        ],
      },
      [route],
      syntheticSchemas,
    );
    expect(sameVersion["createThing"]?.[0]?.fingerprint).toBe("b".repeat(64));
  });

  test("GET 路由不产生 fingerprint 记录", () => {
    expect(
      mergeFingerprintHistory({}, [makeRoute()], syntheticSchemas),
    ).toEqual({});
  });
});
