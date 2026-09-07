import { createHash } from "node:crypto";

import {
  buildSchemaComponents,
  schemaRef,
  type SchemaComponents,
} from "./json-schema.js";
import type { RouteDefinition } from "./route-registry.js";

/**
 * ADR-019：幂等契约摘要覆盖大写 method、operationId、幂等契约版本、
 * 请求/响应 Schema ref、Content-Type、行为相关请求头、重放策略与重放授权策略。
 *
 * 这里是 CI 侧的“契约是否变化”探测器，输入全部是仓库内公开定义，
 * 因此使用普通 SHA-256；它不是运行时幂等 fingerprint，也不得被复用为
 * 密码或验证码等低熵输入的离线校验器（运行时必须使用带版本密钥的 HMAC-SHA-256）。
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
}

export function computeRouteFingerprint(
  route: RouteDefinition,
  schemas: SchemaComponents,
): string {
  const payload = canonicalize({
    method: route.method.toUpperCase(),
    operationId: route.operationId,
    idempotencyContractVersion: route.idempotencyContractVersion,
    idempotencyFingerprintVersion: route.idempotencyFingerprintVersion,
    behaviorHeaders: route.behaviorHeaders,
    request: {
      path: route.request.path,
      query: route.request.query,
      headers: route.request.headers,
      body: route.request.body,
    },
    responses: route.responses,
    schemaRefs: Object.keys(schemas.rootRefs)
      .sort()
      .map((name) => ({ name, ref: schemaRef(schemas, name) })),
    idempotencyReplayPolicy: route.idempotencyReplayPolicy,
    replayAuthorizationPolicy: route.replayAuthorizationPolicy,
  });
  return createHash("sha256")
    .update(JSON.stringify(payload), "utf8")
    .digest("hex");
}

export interface ContractFingerprintEntry {
  readonly version: string;
  readonly fingerprint: string;
}

export type ContractFingerprints = Readonly<
  Record<string, readonly ContractFingerprintEntry[]>
>;

/**
 * 历史条目只追加、不重写：同版本出现不同 fingerprint 时保留既有记录，
 * 由 validateContractFingerprints 报出“契约已变更但未升级版本”。
 */
export function mergeFingerprintHistory(
  existing: ContractFingerprints,
  routes: readonly RouteDefinition[],
  schemas: SchemaComponents = buildSchemaComponents(),
): ContractFingerprints {
  const merged: Record<string, readonly ContractFingerprintEntry[]> = {};
  const ordered = [...routes]
    .filter((route) => route.idempotencyPolicy === "idempotencyRequired")
    .sort((left, right) => left.operationId.localeCompare(right.operationId));

  for (const route of ordered) {
    const version = route.idempotencyContractVersion;
    if (version === "none") {
      continue;
    }
    const fingerprint = computeRouteFingerprint(route, schemas);
    const history = existing[route.operationId] ?? [];
    if (history.some((entry) => entry.version === version)) {
      merged[route.operationId] = history;
      continue;
    }
    merged[route.operationId] = [...history, { version, fingerprint }];
  }

  const result: Record<string, readonly ContractFingerprintEntry[]> = {};
  for (const key of Object.keys(merged).sort()) {
    result[key] = merged[key]!;
  }
  return result;
}

const versionPattern = /^\d+\.\d+\.\d+$/;

export function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference < 0 ? -1 : 1;
    }
  }
  return 0;
}

export function validateVersionFormat(version: string): boolean {
  return versionPattern.test(version);
}
