import {
  compareVersions,
  computeRouteFingerprint,
  validateVersionFormat,
  type ContractFingerprints,
} from "./fingerprints.js";
import {
  buildSchemaComponents,
  collectLeafPaths,
  schemaRef,
  type SchemaComponents,
} from "./json-schema.js";
import { statusDescriptions } from "./openapi.js";
import { pathParametersOf } from "./client.js";
import {
  canonicalLockOrder,
  unsafeHttpMethods,
  type LockTarget,
  type RouteDefinition,
} from "./route-registry.js";
import { schemaRegistry, type SchemaName } from "./schema-registry.js";
import { securityFlowOperationIds } from "./security-flow.js";

export interface Finding {
  readonly rule: string;
  readonly operationId: string;
  readonly message: string;
}

const requiredRouteKeys = [
  "method",
  "path",
  "operationId",
  "summary",
  "request",
  "responses",
  "authPolicy",
  "csrfPolicy",
  "idempotencyPolicy",
  "idempotencyExceptionAdr",
  "idempotencyContractVersion",
  "idempotencyFingerprintVersion",
  "behaviorHeaders",
  "idempotencyReplayPolicy",
  "replayAuthorizationPolicy",
  "securityFlowPolicy",
  "versionPolicy",
  "concurrencyPolicy",
  "auditAction",
] as const;

const requiredRequestKeys = ["path", "query", "headers", "body"] as const;

const operationIdPattern = /^[a-z][A-Za-z0-9]*$/;
const pathPattern = /^\/[A-Za-z0-9\-_{}/]*$/;
const allowedStatuses = new Set(Object.keys(statusDescriptions));
const successStatusPattern = /^2[0-9]{2}$/;

export function registrySensitivePaths(): Readonly<
  Record<string, readonly string[]>
> {
  const result: Record<string, readonly string[]> = {};
  for (const [name, entry] of Object.entries(schemaRegistry)) {
    result[name] = entry.sensitiveFieldPaths;
  }
  return result;
}

function isSubsequence(
  declared: readonly LockTarget[],
  canonical: readonly LockTarget[],
): boolean {
  let cursor = 0;
  for (const target of declared) {
    const index = canonical.indexOf(target, cursor);
    if (index < 0) {
      return false;
    }
    cursor = index + 1;
  }
  return true;
}

function jsonBindingSchema(
  contentTypes: readonly { contentType: string; schemaRef: SchemaName }[],
): SchemaName | undefined {
  return contentTypes.find((entry) => entry.contentType === "application/json")
    ?.schemaRef;
}

export function validateRouteRegistry(
  routes: readonly RouteDefinition[],
  schemas: SchemaComponents = buildSchemaComponents(),
  fingerprints: ContractFingerprints = {},
  sensitive: Readonly<
    Record<string, readonly string[]>
  > = registrySensitivePaths(),
): Finding[] {
  const findings: Finding[] = [];
  const add = (route: RouteDefinition, rule: string, message: string): void => {
    findings.push({ rule, operationId: route.operationId, message });
  };

  const seenOperationIds = new Map<string, RouteDefinition>();
  const seenTargets = new Map<string, RouteDefinition>();

  for (const route of routes) {
    for (const key of requiredRouteKeys) {
      if (!Object.hasOwn(route, key) || route[key] === undefined) {
        add(route, "policy-completeness", `缺少显式登记的字段 "${key}"`);
      }
    }
    for (const key of requiredRequestKeys) {
      if (
        !Object.hasOwn(route.request, key) ||
        route.request[key] === undefined
      ) {
        add(
          route,
          "policy-completeness",
          `request 缺少显式登记的字段 "${key}"`,
        );
      }
    }

    if (!operationIdPattern.test(route.operationId)) {
      add(
        route,
        "operation-id",
        `operationId 必须是小驼峰：${route.operationId}`,
      );
    }
    const duplicateOperation = seenOperationIds.get(route.operationId);
    if (duplicateOperation) {
      add(route, "uniqueness", `operationId 重复：${route.operationId}`);
    }
    seenOperationIds.set(route.operationId, route);

    if (!pathPattern.test(route.path) || route.path.endsWith("/")) {
      add(
        route,
        "path",
        `path 非法：${route.path}（必须相对 ${"/api/v1"} 前缀）`,
      );
    }
    const target = `${route.method} ${route.path}`;
    if (seenTargets.has(target)) {
      add(route, "uniqueness", `method + path 重复：${target}`);
    }
    seenTargets.set(target, route);

    const statuses = Object.keys(route.responses);
    if (statuses.length === 0) {
      add(route, "responses", "必须至少登记一个响应状态");
    }
    for (const status of statuses) {
      if (!allowedStatuses.has(status)) {
        add(route, "responses", `状态码 ${status} 不在固定语义集合中`);
      }
      const binding = route.responses[status]!;
      const isNoBody = "noBody" in binding;
      if (status === "204" && !isNoBody) {
        add(route, "responses", "204 必须登记为 noBody");
      }
      if (status !== "204" && isNoBody) {
        add(route, "responses", `noBody 只允许用于 204，当前为 ${status}`);
      }
      if (!isNoBody) {
        if (binding.body.contentTypes.length === 0) {
          add(route, "responses", `${status} 声明了 body 但没有 Content-Type`);
        }
        if (
          Number(status) >= 400 &&
          jsonBindingSchema(binding.body.contentTypes) !== "ErrorResponse"
        ) {
          add(
            route,
            "response-schema",
            `${status} 必须绑定统一错误模型 ErrorResponse`,
          );
        }
      }
    }

    const pathParameters = pathParametersOf(route.path);
    if (pathParameters.length > 0 && route.request.path === "none") {
      add(
        route,
        "request-schema",
        `path 含参数 ${pathParameters.join(",")} 但未登记 request.path`,
      );
    }
    if (pathParameters.length === 0 && route.request.path !== "none") {
      add(route, "request-schema", "path 无参数却登记了 request.path");
    }
    if (pathParameters.length > 0 && route.request.path !== "none") {
      const node =
        schemas.components[
          schemaRef(schemas, route.request.path).split("/").pop()!
        ];
      const declared = Object.keys((node?.properties ?? {}) as object).sort();
      const expected = [...pathParameters].sort();
      if (declared.join(",") !== expected.join(",")) {
        add(
          route,
          "request-schema",
          `request.path 字段 [${declared.join(",")}] 必须与 path 参数 [${expected.join(",")}] 精确一致`,
        );
      }
    }

    const isUnsafe = unsafeHttpMethods.includes(route.method);
    if (isUnsafe) {
      if (route.idempotencyPolicy === "none") {
        add(
          route,
          "idempotency-default",
          `ADR-019：${route.method} 必须登记 idempotencyRequired 或 securityFlow`,
        );
      }
      if (route.csrfPolicy !== "required") {
        add(route, "csrf", `${route.method} 必须登记 csrfPolicy: required`);
      }
    } else if (route.idempotencyPolicy !== "none") {
      add(
        route,
        "idempotency-default",
        `ADR-019：${route.method} 只能登记 idempotencyPolicy: none`,
      );
    } else if (route.csrfPolicy !== "none") {
      add(route, "csrf", `${route.method} 必须登记 csrfPolicy: none`);
    }

    const isAllowlisted = (
      securityFlowOperationIds as readonly string[]
    ).includes(route.operationId);
    if (route.idempotencyPolicy === "securityFlow") {
      if (!isAllowlisted) {
        add(
          route,
          "security-flow",
          "ADR-023：只有 allowlist 中的 operationId 可以登记 securityFlow",
        );
      }
      if (route.idempotencyExceptionAdr !== "ADR-023") {
        add(
          route,
          "security-flow",
          "securityFlow 必须引用 idempotencyExceptionAdr: ADR-023",
        );
      }
      if (route.securityFlowPolicy === "none") {
        add(
          route,
          "security-flow",
          "securityFlow 必须登记单次消费机制与客户端恢复路径",
        );
      }
    } else {
      if (isAllowlisted) {
        add(
          route,
          "security-flow",
          "ADR-023：allowlist 中的 operationId 必须且只能登记 securityFlow",
        );
      }
      if (route.securityFlowPolicy !== "none") {
        add(
          route,
          "security-flow",
          "非 securityFlow 路由的 securityFlowPolicy 必须为 none",
        );
      }
      if (route.idempotencyExceptionAdr !== "none") {
        add(
          route,
          "idempotency-exception",
          "非例外路由不得登记 idempotencyExceptionAdr",
        );
      }
    }

    if (route.idempotencyPolicy !== "idempotencyRequired") {
      if (route.idempotencyReplayPolicy !== "none") {
        add(
          route,
          "replay-policy",
          "none/securityFlow 路由的 idempotencyReplayPolicy 必须为 none",
        );
      }
      if (route.replayAuthorizationPolicy !== "none") {
        add(
          route,
          "replay-policy",
          "none/securityFlow 路由的 replayAuthorizationPolicy 必须为 none",
        );
      }
      if (route.idempotencyContractVersion !== "none") {
        add(
          route,
          "replay-policy",
          "none/securityFlow 路由不得登记 idempotencyContractVersion",
        );
      }
      if (route.idempotencyFingerprintVersion !== "none") {
        add(
          route,
          "replay-policy",
          "none/securityFlow 路由不得登记 idempotencyFingerprintVersion",
        );
      }
      if (route.behaviorHeaders !== "none") {
        add(
          route,
          "replay-policy",
          "none/securityFlow 路由不得登记 behaviorHeaders",
        );
      }
    } else {
      validateIdempotencyRequired(route, schemas, fingerprints, sensitive, add);
    }

    if (
      route.concurrencyPolicy !== "none" &&
      route.concurrencyPolicy.lockOrder !== "none" &&
      !isSubsequence(route.concurrencyPolicy.lockOrder, canonicalLockOrder)
    ) {
      add(
        route,
        "lock-order",
        `lockOrder 必须是固定锁序 ${canonicalLockOrder.join(" -> ")} 的子序列`,
      );
    }

    if (
      route.versionPolicy !== "none" &&
      route.versionPolicy.ifMatch === "required" &&
      route.idempotencyPolicy === "idempotencyRequired" &&
      route.behaviorHeaders !== "none" &&
      !route.behaviorHeaders.includes("If-Match")
    ) {
      add(
        route,
        "fingerprint-headers",
        "ADR-019：使用 If-Match 的路由必须把它列入 behaviorHeaders",
      );
    }
  }

  return findings;
}

function validateIdempotencyRequired(
  route: RouteDefinition,
  schemas: SchemaComponents,
  fingerprints: ContractFingerprints,
  sensitive: Readonly<Record<string, readonly string[]>>,
  add: (route: RouteDefinition, rule: string, message: string) => void,
): void {
  const version = route.idempotencyContractVersion;
  if (version === "none" || !validateVersionFormat(version)) {
    add(
      route,
      "contract-version",
      "idempotencyRequired 必须登记 x.y.z 形式的 idempotencyContractVersion",
    );
    return;
  }
  if (route.idempotencyFingerprintVersion === "none") {
    add(
      route,
      "contract-version",
      "idempotencyRequired 必须登记 idempotencyFingerprintVersion",
    );
  }
  if (route.behaviorHeaders === "none") {
    add(
      route,
      "contract-version",
      "idempotencyRequired 必须显式登记 behaviorHeaders（可为空数组）",
    );
  }
  if (route.replayAuthorizationPolicy === "none") {
    add(
      route,
      "replay-authorization",
      "idempotencyRequired 必须登记 replayAuthorizationPolicy",
    );
  } else if (!validateVersionFormat(route.replayAuthorizationPolicy.version)) {
    add(
      route,
      "replay-authorization",
      "replayAuthorizationPolicy.version 必须是 x.y.z",
    );
  } else if (
    "resources" in route.replayAuthorizationPolicy &&
    !schemaRegistry[route.replayAuthorizationPolicy.resources.contextSchemaRef]
  ) {
    add(
      route,
      "replay-authorization",
      "resources.contextSchemaRef 必须存在于 Schema Registry",
    );
  }

  const replay = route.idempotencyReplayPolicy;
  if (replay === "none") {
    add(
      route,
      "replay-policy",
      "idempotencyRequired 必须登记 idempotencyReplayPolicy",
    );
    return;
  }
  if (!validateVersionFormat(replay.version)) {
    add(route, "replay-policy", "idempotencyReplayPolicy.version 必须是 x.y.z");
  }

  const declaredSuccess = Object.keys(route.responses).filter((status) =>
    successStatusPattern.test(status),
  );
  const replayStatuses = Object.keys(replay.success);
  if (declaredSuccess.length === 0) {
    add(
      route,
      "replay-policy",
      "idempotencyRequired 路由必须至少有一个 2xx 响应",
    );
  }
  for (const status of declaredSuccess) {
    if (!replayStatuses.includes(status)) {
      add(route, "replay-policy", `重放策略遗漏可缓存状态 ${status}`);
    }
  }
  for (const status of replayStatuses) {
    if (!declaredSuccess.includes(status)) {
      add(route, "replay-policy", `重放策略登记了未声明的状态 ${status}`);
    }
  }

  for (const status of declaredSuccess) {
    const entry = replay.success[status];
    const binding = route.responses[status]!;
    if (!entry) {
      continue;
    }
    if ("noBody" in binding) {
      if (!("noBody" in entry)) {
        add(
          route,
          "replay-policy",
          `${status} 是 noBody，重放策略必须使用 noBody 分支`,
        );
      }
      continue;
    }
    if ("noBody" in entry) {
      add(
        route,
        "replay-policy",
        `${status} 有响应体，重放策略必须使用 body 分支`,
      );
      continue;
    }
    const responseSchema = jsonBindingSchema(binding.body.contentTypes);
    if (!responseSchema) {
      add(
        route,
        "replay-policy",
        `${status} 缺少 application/json 响应 Schema`,
      );
      continue;
    }
    if (entry.body.responseSchemaRef !== responseSchema) {
      add(
        route,
        "replay-policy",
        `${status} 重放 Schema 必须与响应 Schema 精确一致（${responseSchema}）`,
      );
      continue;
    }
    const leaves = collectLeafPaths(
      schemaRef(schemas, responseSchema),
      schemas.components,
    );
    const sensitivePathsForSchema = new Set(sensitive[responseSchema] ?? []);
    const expected = leaves.filter(
      (leaf) => !sensitivePathsForSchema.has(leaf),
    );
    const declared = [...new Set(entry.body.safeBodyFieldPaths)].sort();
    const outOfSchema = declared.filter((leaf) => !leaves.includes(leaf));
    if (outOfSchema.length > 0) {
      add(
        route,
        "replay-fields",
        `safeBodyFieldPaths 越出 Schema 叶子字段：${outOfSchema.join(", ")}`,
      );
    }
    const leaked = declared.filter((leaf) => sensitivePathsForSchema.has(leaf));
    if (leaked.length > 0) {
      add(
        route,
        "replay-fields",
        `敏感字段禁止进入重放策略：${leaked.join(", ")}`,
      );
    }
    const missing = expected.filter((leaf) => !declared.includes(leaf));
    if (missing.length > 0) {
      add(
        route,
        "replay-fields",
        `safeBodyFieldPaths 未穷尽叶子字段：${missing.join(", ")}`,
      );
    }
  }

  const history = fingerprints[route.operationId] ?? [];
  if (history.length === 0) {
    add(
      route,
      "contract-fingerprint",
      "缺少已提交的契约 fingerprint，请先运行 pnpm contract:generate 并提交产物",
    );
    return;
  }
  const versions = history.map((entry) => entry.version);
  if (new Set(versions).size !== versions.length) {
    add(route, "contract-fingerprint", "幂等契约版本不得复用");
  }
  for (let index = 1; index < versions.length; index += 1) {
    if (compareVersions(versions[index - 1]!, versions[index]!) >= 0) {
      add(route, "contract-fingerprint", "幂等契约版本历史必须严格递增");
    }
  }
  const latest = history[history.length - 1]!;
  if (latest.version !== version) {
    add(
      route,
      "contract-fingerprint",
      `登记的契约版本 ${version} 不是历史中的最新版本 ${latest.version}`,
    );
  }
  const current = computeRouteFingerprint(route, schemas);
  if (latest.fingerprint !== current) {
    add(
      route,
      "contract-fingerprint",
      "请求/响应 Schema、行为头或重放策略已变化，必须升级 idempotencyContractVersion",
    );
  }
}
