import { Inject, Injectable } from "@nestjs/common";
import type { RouteDefinition } from "@inpulse/api-contract";

import type { TransactionContext } from "../database/transaction-context.js";
import {
  IDEMPOTENCY_FINGERPRINT_KEYRING,
  IDEMPOTENCY_ROUTE_RESOLVER,
} from "./constants.js";
import {
  buildIdempotencyRequestDigest,
  getHeader,
  IDEMPOTENCY_KEY_HEADER,
  idempotencyKeyProblem,
  type IdempotencyHttpRequest,
} from "./http.js";
import {
  assertIdempotencyRequired,
  type IdempotencyRouteResolver,
} from "./route.js";
import {
  type ReplayAuthorizer,
  type IdempotencyExecutionResult,
  IdempotencyRunner,
} from "./runner.js";
import type { IdempotencyRecord } from "./store.js";

export interface HmacKeyProvider {
  readonly currentVersion: number;
  currentKey(): Buffer;
  keyFor(version: number): Buffer;
}

export interface IdempotencyHttpCommand {
  readonly operationId: string;
  readonly actorId: number;
  readonly request: IdempotencyHttpRequest;
  readonly execute: (
    tx: TransactionContext,
  ) => Promise<IdempotencyExecutionResult>;
  readonly replayAuthorizer?: ReplayAuthorizer;
}

export interface IdempotencyHttpResult {
  readonly responseStatus: number;
  readonly responseSchemaRef: string | null;
  readonly responseHasBody: boolean;
  readonly responseBody: unknown | null;
}

export type IdempotencyHttpErrorStatus = 400 | 409;

/** 幂等协议面向 HTTP 的稳定错误；重放授权失败由调用方认证错误继续传播。 */
export class IdempotencyHttpError extends Error {
  constructor(
    readonly status: IdempotencyHttpErrorStatus,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IdempotencyHttpError";
  }
}

/**
 * HTTP 幂等入口：先按 Route Registry 校验策略与 Idempotency-Key，再构造
 * 规范摘要并交给 IdempotencyRunner。业务命令与幂等记录共用同一个事务；
 * 重放前按 Route Registry 的授权策略重新验证当前认证与结果资源权限。
 */
@Injectable()
export class IdempotencyHttpService {
  constructor(
    private readonly runner: IdempotencyRunner,
    @Inject(IDEMPOTENCY_FINGERPRINT_KEYRING)
    private readonly keyProvider: HmacKeyProvider,
    @Inject(IDEMPOTENCY_ROUTE_RESOLVER)
    private readonly routeResolver: IdempotencyRouteResolver,
  ) {}

  async run(input: IdempotencyHttpCommand): Promise<IdempotencyHttpResult> {
    const route = this.routeResolver(input.operationId);
    if (route === undefined) {
      throw new Error(
        `idempotency route ${input.operationId} is not registered`,
      );
    }
    assertIdempotencyRequired(route);

    const keyProblem = idempotencyKeyProblem(input.request.headers);
    if (keyProblem === "missing") {
      throw new IdempotencyHttpError(
        400,
        "IDEMPOTENCY_KEY_REQUIRED",
        "请求必须携带 Idempotency-Key",
      );
    }
    if (keyProblem === "invalid") {
      throw new IdempotencyHttpError(
        400,
        "IDEMPOTENCY_KEY_INVALID",
        "Idempotency-Key 长度必须为 16～128 个字符",
      );
    }

    const idempotencyKey = getHeader(
      input.request.headers,
      IDEMPOTENCY_KEY_HEADER,
    );
    if (idempotencyKey === undefined) {
      throw new Error("idempotency key disappeared after validation");
    }

    const replayAuthorizer = this.resolveReplayAuthorizer(
      route.replayAuthorizationPolicy,
      input.replayAuthorizer,
    );
    const outcome = await this.runner.run({
      actorId: input.actorId,
      command: {
        operationId: route.operationId,
        idempotencyKey,
        idempotencyContractVersion: route.idempotencyContractVersion,
        requestHash: Buffer.from(
          buildIdempotencyRequestDigest(
            route,
            input.request,
            this.keyProvider.currentKey(),
          ),
          "hex",
        ),
        requestHashKeyVersion: this.keyProvider.currentVersion,
        resolveRequestHash: (keyVersion) =>
          Buffer.from(
            buildIdempotencyRequestDigest(
              route,
              input.request,
              this.keyProvider.keyFor(keyVersion),
            ),
            "hex",
          ),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        replayPolicyVersion: route.idempotencyReplayPolicy.version,
        replayAuthPolicyVersion: route.replayAuthorizationPolicy.version,
      },
      execute: input.execute,
      ...(replayAuthorizer === undefined ? {} : { replayAuthorizer }),
    });

    if (outcome.kind === "conflict") {
      throw idempotencyConflictError(outcome.reason);
    }
    return idempotencyResultFromRecord(outcome.record);
  }

  private resolveReplayAuthorizer(
    policy: RouteDefinition["replayAuthorizationPolicy"],
    supplied: ReplayAuthorizer | undefined,
  ): ReplayAuthorizer | undefined {
    if (policy === "none") {
      throw new Error("replayAuthorizationPolicy must not be none");
    }
    if ("actorOnly" in policy && policy.actorOnly) {
      return supplied ?? (async () => {});
    }
    if (supplied === undefined) {
      throw new Error(
        "resource replayAuthorizationPolicy requires a ReplayAuthorizer",
      );
    }
    return supplied;
  }
}

function idempotencyConflictError(
  reason: "hash" | "contract-version" | "key-version" | "in-progress",
): IdempotencyHttpError {
  if (reason === "in-progress") {
    return new IdempotencyHttpError(
      409,
      "IDEMPOTENCY_IN_PROGRESS",
      "相同幂等请求正在处理中",
    );
  }
  if (reason === "contract-version") {
    return new IdempotencyHttpError(
      409,
      "IDEMPOTENCY_CONTRACT_MISMATCH",
      "幂等契约版本已变化，请更换 Idempotency-Key",
    );
  }
  if (reason === "key-version") {
    return new IdempotencyHttpError(
      409,
      "IDEMPOTENCY_KEY_VERSION_MISMATCH",
      "幂等摘要密钥版本不一致",
    );
  }
  return new IdempotencyHttpError(
    409,
    "IDEMPOTENCY_REQUEST_MISMATCH",
    "相同 Idempotency-Key 对应不同请求内容",
  );
}

function idempotencyResultFromRecord(
  record: IdempotencyRecord,
): IdempotencyHttpResult {
  if (record.responseStatus === null || record.responseHasBody === null) {
    throw new Error("succeeded idempotency record has no response metadata");
  }
  return {
    responseStatus: record.responseStatus,
    responseSchemaRef: record.responseSchemaRef,
    responseHasBody: record.responseHasBody,
    responseBody: record.responseBody,
  };
}
