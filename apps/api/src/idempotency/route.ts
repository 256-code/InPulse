import type { RouteDefinition } from "@inpulse/api-contract";
import { routeRegistry } from "@inpulse/api-contract";

export type IdempotencyRouteResolver = (
  operationId: string,
) => RouteDefinition | undefined;

export type IdempotencyRequiredRoute = RouteDefinition & {
  readonly idempotencyContractVersion: string;
  readonly idempotencyFingerprintVersion: string;
  readonly idempotencyReplayPolicy: Exclude<
    RouteDefinition["idempotencyReplayPolicy"],
    "none"
  >;
  readonly replayAuthorizationPolicy: Exclude<
    RouteDefinition["replayAuthorizationPolicy"],
    "none"
  >;
};

/** 幂等操作只能引用 Route Registry 中真实登记的稳定 operationId。 */
export const resolveRegisteredRoute: IdempotencyRouteResolver = (operationId) =>
  routeRegistry.find((route) => route.operationId === operationId);

/**
 * 幂等 HTTP 入口 fail-closed：未登记、非 `idempotencyRequired` 或缺少
 * 契约/重放/授权策略的路由不得进入通用幂等执行器。
 */
export function assertIdempotencyRequired(
  route: RouteDefinition,
): asserts route is IdempotencyRequiredRoute {
  if (route.idempotencyPolicy !== "idempotencyRequired") {
    throw new Error(
      `route ${route.operationId} must be registered as idempotencyRequired`,
    );
  }
  if (
    route.idempotencyContractVersion === "none" ||
    route.idempotencyFingerprintVersion === "none"
  ) {
    throw new Error(
      `route ${route.operationId} must declare idempotency contract and fingerprint versions`,
    );
  }
  if (route.idempotencyReplayPolicy === "none") {
    throw new Error(
      `route ${route.operationId} must declare an idempotency replay policy`,
    );
  }
  if (route.replayAuthorizationPolicy === "none") {
    throw new Error(
      `route ${route.operationId} must declare a replay authorization policy`,
    );
  }
}
