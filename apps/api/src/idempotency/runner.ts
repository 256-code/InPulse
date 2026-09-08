import type { UnitOfWork } from "../database/unit-of-work.js";
import type { TransactionContext } from "../database/transaction-context.js";
import {
  isReplayMatch,
  validateSuccessResponse,
  type IdempotencyRecord,
  type IdempotencyStore,
  type IdempotencySuccess,
} from "./store.js";

/** 协议步骤 2/3/4 需要的、与 HTTP 解耦的命令元数据。 */
export interface IdempotencyCommand {
  readonly operationId: string;
  readonly idempotencyKey: string;
  readonly idempotencyContractVersion: string;
  readonly requestHash: Buffer;
  readonly requestHashKeyVersion: number;
  readonly expiresAt: Date;
  readonly replayPolicyVersion: string;
  readonly replayAuthPolicyVersion: string;
  readonly resolveRequestHash?: (keyVersion: number) => Buffer;
}

/** 业务命令在同事务内执行后产出的、可安全重放的最小结果。 */
export interface IdempotencyExecutionResult {
  readonly responseStatus: number;
  readonly responseSchemaRef: string | null;
  readonly responseHasBody: boolean;
  readonly responseBody: unknown | null;
  readonly replayAuthContext: Record<string, unknown>;
}

/**
 * 冲突者重放前必须通过的重放授权校验。
 *
 * 实现方须重新验证当前认证、原操作权限、`replay_auth_context` 中每个结果资源的
 * 当前可读权限以及该路由要求的高风险重认证新鲜度；任一门禁失败应抛错，
 * 此时不得向客户端泄露已存状态码或响应体。
 */
export type ReplayAuthorizer = (record: IdempotencyRecord) => Promise<void>;

export type IdempotencyConflictReason =
  "hash" | "contract-version" | "key-version" | "in-progress";

export type IdempotencyOutcome =
  | { readonly kind: "executed"; readonly record: IdempotencyRecord }
  | { readonly kind: "replayed"; readonly record: IdempotencyRecord }
  | {
      readonly kind: "conflict";
      readonly reason: IdempotencyConflictReason;
    };

export interface RunIdempotencyCommand {
  readonly actorId: number;
  readonly command: IdempotencyCommand;
  readonly execute: (
    tx: TransactionContext,
  ) => Promise<IdempotencyExecutionResult>;
  readonly replayAuthorizer?: ReplayAuthorizer;
}

/**
 * 幂等协议引擎（技术设计 §4.3.1 的执行算法步骤 2～4）。
 *
 * 整个流程只创建一个 `UnitOfWork`，`insertPending`、业务命令与 `markSucceeded`
 * 全部显式接收同一 `TransactionContext`；业务命令抛错或保存失败时整行回滚，
 * 不留下永久 `PENDING` 占位。冲突者按摘要/契约版本/密钥版本判定是否可重放，
 * 可重放时在返回前调用 `replayAuthorizer` 完成重放授权重验。
 *
 * 鉴权/CSRF/请求摘要构造与路由策略解析不在本类职责内：调用方必须已通过
 * “先验证当前认证与原操作权限”，再把匹配的 `ReplayAuthorizer` 传入。
 */
export class IdempotencyRunner {
  constructor(
    private readonly unitOfWork: UnitOfWork,
    private readonly store: IdempotencyStore,
  ) {}

  run(input: RunIdempotencyCommand): Promise<IdempotencyOutcome> {
    return this.unitOfWork.run(async (tx) => {
      const inserted = await this.store.insertPending(tx, {
        actorId: input.actorId,
        operationId: input.command.operationId,
        idempotencyKey: input.command.idempotencyKey,
        idempotencyContractVersion: input.command.idempotencyContractVersion,
        requestHash: input.command.requestHash,
        requestHashKeyVersion: input.command.requestHashKeyVersion,
        expiresAt: input.command.expiresAt,
      });

      if (inserted !== undefined) {
        return this.executeAndPersist(tx, input);
      }

      return this.resolveConflict(tx, input);
    });
  }

  private async executeAndPersist(
    tx: TransactionContext,
    input: RunIdempotencyCommand,
  ): Promise<IdempotencyOutcome> {
    const result = await input.execute(tx);
    const success: IdempotencySuccess = {
      responseStatus: result.responseStatus,
      responseSchemaRef: result.responseSchemaRef,
      replayPolicyVersion: input.command.replayPolicyVersion,
      replayAuthPolicyVersion: input.command.replayAuthPolicyVersion,
      replayAuthContext: result.replayAuthContext,
      responseHasBody: result.responseHasBody,
      responseBody: result.responseBody,
    };
    validateSuccessResponse(success);

    const updated = await this.store.markSucceeded(
      tx,
      input.actorId,
      input.command.operationId,
      input.command.idempotencyKey,
      success,
    );
    if (updated === undefined) {
      throw new Error(
        "idempotency record was not in PENDING state when marking succeeded",
      );
    }
    return { kind: "executed", record: updated };
  }

  private async resolveConflict(
    tx: TransactionContext,
    input: RunIdempotencyCommand,
  ): Promise<IdempotencyOutcome> {
    const existing = await this.store.find(
      tx,
      input.actorId,
      input.command.operationId,
      input.command.idempotencyKey,
    );
    if (existing === undefined) {
      throw new Error(
        "idempotency record disappeared during conflict resolution",
      );
    }

    const requestHash =
      existing.requestHashKeyVersion === input.command.requestHashKeyVersion
        ? input.command.requestHash
        : input.command.resolveRequestHash?.(existing.requestHashKeyVersion);
    if (requestHash === undefined) {
      return { kind: "conflict", reason: "key-version" };
    }
    const match = isReplayMatch(existing, {
      requestHash,
      idempotencyContractVersion: input.command.idempotencyContractVersion,
      requestHashKeyVersion: existing.requestHashKeyVersion,
    });
    if (!match) {
      return {
        kind: "conflict",
        reason:
          existing.idempotencyContractVersion !==
          input.command.idempotencyContractVersion
            ? "contract-version"
            : "hash",
      };
    }

    if (existing.state === "PENDING") {
      return { kind: "conflict", reason: "in-progress" };
    }

    if (input.replayAuthorizer !== undefined) {
      await input.replayAuthorizer(existing);
    }
    return { kind: "replayed", record: existing };
  }
}
