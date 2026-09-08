import { describe, expect, test } from "vitest";

import { readCommittedFingerprints } from "../src/artifacts.js";
import { computeRouteFingerprint } from "../src/fingerprints.js";
import { routeRegistry } from "../src/route-registry.js";
import type { RouteDefinition } from "../src/route-registry.js";
import { validateRouteRegistry, type Finding } from "../src/validate.js";
import {
  makeRoute,
  objectSchema,
  syntheticSchemas,
  writeRoute,
} from "./helpers.js";

function rulesOf(
  routes: readonly RouteDefinition[],
  fingerprints: Parameters<typeof validateRouteRegistry>[2] = {},
  sensitive: Parameters<typeof validateRouteRegistry>[3] = {},
): string[] {
  return validateRouteRegistry(
    routes,
    syntheticSchemas,
    fingerprints,
    sensitive,
  ).map((finding: Finding) => finding.rule);
}

function writeFingerprints(route: RouteDefinition, version = "1.0.0") {
  return {
    [route.operationId]: [
      {
        version,
        fingerprint: computeRouteFingerprint(route, syntheticSchemas),
      },
    ],
  };
}

describe("Route Registry 完整性", () => {
  test("已登记的真实 Registry 通过全部规则", async () => {
    expect(
      validateRouteRegistry(
        routeRegistry,
        undefined,
        await readCommittedFingerprints(),
      ),
    ).toEqual([]);
  });

  test("缺少任一策略字段都会失败", () => {
    const route = makeRoute();
    delete (route as unknown as Record<string, unknown>).auditAction;
    expect(rulesOf([route])).toContain("policy-completeness");
  });

  test("request 缺少显式字段也会失败", () => {
    const route = makeRoute();
    delete (route.request as unknown as Record<string, unknown>).headers;
    expect(rulesOf([route])).toContain("policy-completeness");
  });

  test("ADR-019：写方法不得登记 idempotencyPolicy none", () => {
    const route = makeRoute({
      method: "POST",
      path: "/things",
      operationId: "createThing",
      csrfPolicy: "required",
    });
    expect(rulesOf([route])).toContain("idempotency-default");
  });

  test("ADR-019：GET 不得登记 idempotencyRequired", () => {
    const route = writeRoute({ method: "GET", csrfPolicy: "none" });
    expect(rulesOf([route], writeFingerprints(route))).toContain(
      "idempotency-default",
    );
  });

  test("ADR-023：安全方法上的 allowlist securityFlow 必须被接受", () => {
    const route = makeRoute({
      method: "GET",
      path: "/auth/csrf",
      operationId: "issueCsrfToken",
      idempotencyPolicy: "securityFlow",
      idempotencyExceptionAdr: "ADR-023",
      securityFlowPolicy: {
        singleConsumptionOrNaturalIdempotency: "每次签发新 Token",
        clientRecoveryPath: "再次签发",
      },
    });
    const rules = rulesOf([route]);
    expect(rules).not.toContain("idempotency-default");
    expect(rules).not.toContain("security-flow");
  });

  test("写方法必须要求 CSRF，安全方法必须为 none", () => {
    expect(rulesOf([writeRoute({ csrfPolicy: "none" })])).toContain("csrf");
    expect(rulesOf([makeRoute({ csrfPolicy: "required" })])).toContain("csrf");
  });

  test("ADR-023：allowlist 之外的路由不得登记 securityFlow", () => {
    const route = makeRoute({
      method: "POST",
      path: "/things",
      operationId: "createThing",
      csrfPolicy: "required",
      idempotencyPolicy: "securityFlow",
      idempotencyExceptionAdr: "ADR-023",
      securityFlowPolicy: {
        singleConsumptionOrNaturalIdempotency: "条件更新",
        clientRecoveryPath: "重试",
      },
    });
    expect(rulesOf([route])).toContain("security-flow");
  });

  test("ADR-023：allowlist 内的 operationId 必须且只能登记 securityFlow", () => {
    const route = makeRoute({
      method: "POST",
      path: "/auth/login",
      operationId: "login",
      csrfPolicy: "required",
    });
    expect(rulesOf([route])).toContain("security-flow");
  });

  test("统一错误模型：4xx/5xx 必须绑定 ErrorResponse", () => {
    const route = makeRoute({
      responses: {
        "200": {
          body: {
            contentTypes: [
              { contentType: "application/json", schemaRef: "HealthResponse" },
            ],
          },
        },
        "404": {
          body: {
            contentTypes: [
              { contentType: "application/json", schemaRef: "HealthResponse" },
            ],
          },
        },
      },
    });
    expect(rulesOf([route])).toContain("response-schema");
  });

  test("noBody 只允许 204，204 必须是 noBody", () => {
    expect(
      rulesOf([
        makeRoute({ responses: { "204": { body: { contentTypes: [] } } } }),
      ]),
    ).toContain("responses");
    expect(
      rulesOf([makeRoute({ responses: { "200": { noBody: true } } })]),
    ).toContain("responses");
  });

  test("状态码必须在固定语义集合内", () => {
    expect(
      rulesOf([makeRoute({ responses: { "418": { noBody: true } } })]),
    ).toContain("responses");
  });

  test("path 参数必须与 request.path Schema 精确一致", () => {
    const schemas = {
      components: {
        ...syntheticSchemas.components,
        ThingPath: objectSchema({ thingId: { type: "integer" } }),
      },
      rootRefs: {
        ...syntheticSchemas.rootRefs,
        ThingPath: "#/components/schemas/ThingPath",
      },
    };
    const route = makeRoute({
      path: "/things/{thingId}/other",
      request: {
        path: "ThingPath",
        query: "none",
        headers: "none",
        body: { noBody: true },
      },
    });
    const findings = validateRouteRegistry([route], schemas, {}, {});
    expect(findings.map((finding) => finding.rule)).not.toContain(
      "request-schema",
    );

    const mismatched = makeRoute({
      path: "/things/{otherId}",
      request: {
        path: "ThingPath",
        query: "none",
        headers: "none",
        body: { noBody: true },
      },
    });
    expect(
      validateRouteRegistry([mismatched], schemas, {}, {}).map(
        (finding) => finding.rule,
      ),
    ).toContain("request-schema");
  });

  test("重放策略必须逐个覆盖已声明的 2xx 状态", () => {
    const route = writeRoute({
      idempotencyReplayPolicy: { version: "1.0.0", success: {} },
    });
    expect(rulesOf([route], writeFingerprints(route))).toContain(
      "replay-policy",
    );
  });

  test("重放策略的 Schema 引用必须与响应 Schema 精确一致", () => {
    const route = writeRoute({
      idempotencyReplayPolicy: {
        version: "1.0.0",
        success: {
          "201": {
            body: {
              responseSchemaRef: "HealthResponse",
              safeBodyFieldPaths: ["status"],
            },
          },
        },
      },
    });
    expect(rulesOf([route], writeFingerprints(route))).toContain(
      "replay-policy",
    );
  });

  test("safeBodyFieldPaths 不得越界且必须穷尽", () => {
    const outOfSchema = writeRoute({
      idempotencyReplayPolicy: {
        version: "1.0.0",
        success: {
          "201": {
            body: {
              responseSchemaRef: "ReplayResponse",
              safeBodyFieldPaths: ["id", "nested.value", "secret", "ghost"],
            },
          },
        },
      },
    });
    expect(rulesOf([outOfSchema], writeFingerprints(outOfSchema))).toContain(
      "replay-fields",
    );

    const incomplete = writeRoute({
      idempotencyReplayPolicy: {
        version: "1.0.0",
        success: {
          "201": {
            body: {
              responseSchemaRef: "ReplayResponse",
              safeBodyFieldPaths: ["id"],
            },
          },
        },
      },
    });
    expect(rulesOf([incomplete], writeFingerprints(incomplete))).toContain(
      "replay-fields",
    );
  });

  test("敏感字段禁止进入重放策略", () => {
    const route = writeRoute();
    expect(
      rulesOf([route], writeFingerprints(route), {
        ReplayResponse: ["secret"],
      }),
    ).toContain("replay-fields");
  });

  test("none/securityFlow 路由的重放与授权策略必须为 none", () => {
    const route = makeRoute({
      idempotencyReplayPolicy: { version: "1.0.0", success: {} },
    });
    expect(rulesOf([route])).toContain("replay-policy");
  });

  test("缺少契约 fingerprint 记录必须失败", () => {
    expect(rulesOf([writeRoute()])).toContain("contract-fingerprint");
  });

  test("契约内容变化但未升级版本必须失败", () => {
    const route = writeRoute();
    const findings = rulesOf([route], {
      createReplayable: [{ version: "1.0.0", fingerprint: "0".repeat(64) }],
    });
    expect(findings).toContain("contract-fingerprint");
  });

  test("契约版本不得复用且必须递增", () => {
    const route = writeRoute();
    const fingerprint = computeRouteFingerprint(route, syntheticSchemas);
    const findings = rulesOf([route], {
      createReplayable: [
        { version: "1.0.0", fingerprint },
        { version: "1.0.0", fingerprint },
      ],
    });
    expect(findings).toContain("contract-fingerprint");
  });

  test("lockOrder 必须是固定锁序的子序列", () => {
    const route = makeRoute({
      concurrencyPolicy: {
        rowVersion: "required",
        lockOrder: ["task", "project"],
        retry: "有限重试",
      },
    });
    expect(rulesOf([route])).toContain("lock-order");
  });

  test("使用 If-Match 的幂等路由必须把它列入 behaviorHeaders", () => {
    const route = writeRoute({
      versionPolicy: {
        apiVersion: "v1",
        schemaVersion: "1.0.0",
        ifMatch: "required",
      },
      behaviorHeaders: [],
    });
    expect(rulesOf([route], writeFingerprints(route))).toContain(
      "fingerprint-headers",
    );
  });

  test("operationId 与 method+path 必须唯一", () => {
    expect(rulesOf([makeRoute(), makeRoute()])).toContain("uniqueness");
  });
});
