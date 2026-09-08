import type { RouteDefinition } from "@inpulse/api-contract";

import type { IdempotencyExecutionResult } from "./runner.js";

export type IdempotencyResponsePolicyReason =
  | "status-not-cacheable"
  | "body-presence-mismatch"
  | "schema-mismatch"
  | "response-body-required"
  | "unsafe-body-field";

/** 业务返回不符合 Route Registry 重放白名单时，必须在同事务提交前拒绝。 */
export class IdempotencyResponsePolicyError extends Error {
  constructor(
    readonly reason: IdempotencyResponsePolicyReason,
    message: string,
  ) {
    super(message);
    this.name = "IdempotencyResponsePolicyError";
  }
}

/**
 * 校验业务执行结果是否符合该路由的 `idempotencyReplayPolicy`。
 * 状态码、响应 Schema、body/noBody 分支以及 body 叶子字段都必须与 Registry
 * 精确匹配；任何额外叶子字段（包括敏感字段）都不得进入幂等缓存。
 */
export function assertIdempotencyResponsePolicy(
  route: RouteDefinition,
  result: IdempotencyExecutionResult,
): void {
  const policy = route.idempotencyReplayPolicy;
  if (policy === "none") {
    throw new IdempotencyResponsePolicyError(
      "status-not-cacheable",
      `route ${route.operationId} has no replay policy`,
    );
  }

  const statusKey = String(result.responseStatus);
  const entry = policy.success[statusKey];
  const binding = route.responses[statusKey];
  if (entry === undefined || binding === undefined) {
    throw new IdempotencyResponsePolicyError(
      "status-not-cacheable",
      `route ${route.operationId} cannot cache HTTP ${statusKey}`,
    );
  }

  if ("noBody" in entry) {
    if (
      result.responseHasBody ||
      result.responseSchemaRef !== null ||
      result.responseBody !== null
    ) {
      throw new IdempotencyResponsePolicyError(
        "body-presence-mismatch",
        `route ${route.operationId} only allows a bodyless ${statusKey} response`,
      );
    }
    return;
  }

  if (!result.responseHasBody) {
    throw new IdempotencyResponsePolicyError(
      "body-presence-mismatch",
      `route ${route.operationId} requires a response body for ${statusKey}`,
    );
  }
  if (result.responseSchemaRef !== entry.body.responseSchemaRef) {
    throw new IdempotencyResponsePolicyError(
      "schema-mismatch",
      `route ${route.operationId} requires response schema ${entry.body.responseSchemaRef} for ${statusKey}`,
    );
  }
  if (result.responseBody === null) {
    throw new IdempotencyResponsePolicyError(
      "response-body-required",
      `route ${route.operationId} requires a response body for ${statusKey}`,
    );
  }

  const allowedLeaves = new Set(entry.body.safeBodyFieldPaths);
  for (const leaf of collectBodyLeafPaths(result.responseBody)) {
    if (!allowedLeaves.has(leaf)) {
      throw new IdempotencyResponsePolicyError(
        "unsafe-body-field",
        `route ${route.operationId} cannot cache body leaf "${leaf}"`,
      );
    }
  }
}

function collectBodyLeafPaths(value: unknown): Set<string> {
  const leaves = new Set<string>();

  const walk = (node: unknown, prefix: string): void => {
    if (Array.isArray(node)) {
      for (const item of node) {
        walk(item, `${prefix}[]`);
      }
      return;
    }
    if (typeof node === "object" && node !== null) {
      const entries = Object.entries(node as Readonly<Record<string, unknown>>);
      if (entries.length === 0) {
        return;
      }
      for (const [key, child] of entries) {
        walk(child, prefix.length === 0 ? key : `${prefix}.${key}`);
      }
      return;
    }
    leaves.add(prefix);
  };

  walk(value, "");
  return leaves;
}
