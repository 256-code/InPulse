import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  parseControllerSource,
  parseGlobalPrefix,
  scanApiControllers,
  validateControllerBindings,
} from "../src/controller-bindings.js";
import {
  parseIdentityTable,
  parseSecurityFlowOperationIds,
  validatePermissionMatrix,
} from "../src/permission-checks.js";
import {
  permissionIdentities,
  permissionMatrix,
} from "../src/permission-matrix.js";
import { apiBasePath, routeRegistry } from "../src/route-registry.js";
import { securityFlowOperationIds } from "../src/security-flow.js";
import { makeRoute } from "./helpers.js";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const permissionsDocument = await readFile(
  resolve(repositoryRoot, "docs/permissions.md"),
  "utf8",
);

type Outcomes = (typeof permissionMatrix)[number]["outcomes"];

const allowAll = Object.fromEntries(
  permissionIdentities.map((identity) => [identity, { kind: "allow" }]),
) as unknown as Outcomes;

describe("权限矩阵与文档一致性", () => {
  test("身份集合与 docs/permissions.md 精确一致", () => {
    expect([...parseIdentityTable(permissionsDocument)].sort()).toEqual(
      [...permissionIdentities].sort(),
    );
  });

  test("ADR-023 allowlist 与认证安全流程矩阵精确相等", () => {
    expect(
      [...parseSecurityFlowOperationIds(permissionsDocument)].sort(),
    ).toEqual([...securityFlowOperationIds].sort());
  });

  test("当前 Registry 与权限矩阵一一对应", () => {
    expect(
      validatePermissionMatrix({
        routes: routeRegistry,
        matrix: permissionMatrix,
        permissionsDocument,
      }),
    ).toEqual([]);
  });

  test("缺少权限矩阵条目的路由必须失败", () => {
    const findings = validatePermissionMatrix({
      routes: [makeRoute({ operationId: "unknownOperation" })],
      matrix: permissionMatrix,
      permissionsDocument,
    });
    expect(findings.map((finding) => finding.rule)).toContain(
      "permission-matrix",
    );
  });

  test("孤立的权限矩阵条目必须失败", () => {
    const findings = validatePermissionMatrix({
      routes: [],
      matrix: permissionMatrix,
      permissionsDocument,
    });
    expect(findings.map((finding) => finding.rule)).toContain(
      "permission-matrix",
    );
  });

  test("AUTHZ-001：需认证路由必须同时有允许与拒绝用例", () => {
    const route = makeRoute({ authPolicy: "session", operationId: "getThing" });
    const findings = validatePermissionMatrix({
      routes: [route],
      matrix: [{ operationId: "getThing", outcomes: allowAll }],
      permissionsDocument,
    });
    expect(findings.map((finding) => finding.message).join("\n")).toContain(
      "缺少拒绝用例",
    );
  });

  test("authPolicy 为 none 的路由不得登记拒绝结果", () => {
    const outcomes = {
      ...allowAll,
      匿名: { kind: "deny", status: 401 },
    } as unknown as Outcomes;
    const findings = validatePermissionMatrix({
      routes: [makeRoute()],
      matrix: [{ operationId: "getHealth", outcomes }],
      permissionsDocument,
    });
    expect(findings.map((finding) => finding.rule)).toContain(
      "permission-matrix",
    );
  });
});

describe("Controller 绑定", () => {
  const controllerSource = `
import { Controller, Get } from "@nestjs/common";

@Controller("health")
export class HealthController {
  @Get()
  check(): { status: string } {
    return { status: "ok" };
  }
}
`;

  test("解析 Nest 装饰器得到相对路径与方法", () => {
    const parsed = parseControllerSource(
      controllerSource,
      "health.controller.ts",
    );
    expect(parsed.failures).toEqual([]);
    expect(parsed.bindings).toEqual([
      {
        method: "GET",
        path: "/health",
        handler: "check",
        file: "health.controller.ts",
      },
    ]);
  });

  test("无法解析的装饰器参数必须失败", () => {
    const parsed = parseControllerSource(
      "@Controller(dynamicPrefix)\nexport class X {\n  @Get()\n  a() {}\n}\n",
      "x.controller.ts",
    );
    expect(parsed.failures.join("\n")).toContain("字符串字面量");
  });

  test("解析全局前缀", () => {
    expect(parseGlobalPrefix('app.setGlobalPrefix("api/v1");')).toBe(
      apiBasePath,
    );
  });

  test("真实 apps/api 扫描与 Registry 一致", async () => {
    const scan = await scanApiControllers(repositoryRoot);
    expect(scan.failures).toEqual([]);
    expect(scan.globalPrefix).toBe(apiBasePath);
    expect(
      scan.bindings.map((binding) => `${binding.method} ${binding.path}`),
    ).toEqual(["GET /api/v1/auth/csrf", "GET /api/v1/health"]);
    expect(validateControllerBindings(routeRegistry, scan)).toEqual([]);
  });

  test("Registry 与 Controller 任一侧缺失都必须失败", () => {
    const missingController = validateControllerBindings(
      [makeRoute({ path: "/absent", operationId: "getAbsent" })],
      { globalPrefix: apiBasePath, bindings: [], failures: [] },
    );
    expect(
      missingController.map((finding) => finding.message).join("\n"),
    ).toContain("没有对应 Controller");

    const missingRegistryEntry = validateControllerBindings([], {
      globalPrefix: apiBasePath,
      bindings: [
        {
          method: "GET",
          path: "/api/v1/health",
          handler: "check",
          file: "apps/api/src/health/health.controller.ts",
        },
      ],
      failures: [],
    });
    expect(
      missingRegistryEntry.map((finding) => finding.message).join("\n"),
    ).toContain("未登记到 Route Registry");
  });

  test("全局前缀漂移必须失败", () => {
    const findings = validateControllerBindings([], {
      globalPrefix: "/api/v2",
      bindings: [],
      failures: [],
    });
    expect(findings.map((finding) => finding.message).join("\n")).toContain(
      "全局前缀",
    );
  });
});
