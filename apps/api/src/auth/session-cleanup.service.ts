import { Injectable } from "@nestjs/common";

import { PostgresUnitOfWork } from "../database/unit-of-work.js";
import { PostgresSessionCleanupRepository } from "./session-cleanup.repository.js";

export interface SessionCleanupOptions {
  readonly batchSize: number;
  readonly maxBatches: number;
}

export interface SessionCleanupResult {
  readonly deletedUserSessions: number;
  readonly deletedSessionCsrfTokens: number;
  readonly deletedPreauthSessions: number;
  readonly batches: number;
}

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_BATCHES = 1000;

export function sessionCleanupOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SessionCleanupOptions {
  return {
    batchSize: positiveIntegerFromEnv(
      env,
      "SESSION_CLEANUP_BATCH_SIZE",
      DEFAULT_BATCH_SIZE,
    ),
    maxBatches: positiveIntegerFromEnv(
      env,
      "SESSION_CLEANUP_MAX_BATCHES",
      DEFAULT_MAX_BATCHES,
    ),
  };
}

function positiveIntegerFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
): number {
  const raw = env[name]?.trim();
  if (raw === undefined || raw === "") {
    return fallback;
  }
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error(`${name} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer`);
  }
  return value;
}

/**
 * Session 分批清理服务。
 *
 * 每次只开一个独立 `UnitOfWork` 并处理一个固定大小批次，
 * 避免长时间事务和无界删除；三类表都无数据时提前停止。
 */
@Injectable()
export class SessionCleanupService {
  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly repository: PostgresSessionCleanupRepository,
  ) {}

  async run(
    options: SessionCleanupOptions = sessionCleanupOptionsFromEnv(),
  ): Promise<SessionCleanupResult> {
    let deletedUserSessions = 0;
    let deletedSessionCsrfTokens = 0;
    let deletedPreauthSessions = 0;
    let batches = 0;

    for (let batchIndex = 0; batchIndex < options.maxBatches; batchIndex += 1) {
      const batch = await this.unitOfWork.run((tx) =>
        this.repository.cleanupBatch(tx, options.batchSize),
      );
      batches += 1;
      deletedUserSessions += batch.deletedUserSessions;
      deletedSessionCsrfTokens += batch.deletedSessionCsrfTokens;
      deletedPreauthSessions += batch.deletedPreauthSessions;
      if (
        batch.deletedUserSessions === 0 &&
        batch.deletedSessionCsrfTokens === 0 &&
        batch.deletedPreauthSessions === 0
      ) {
        break;
      }
    }

    return {
      deletedUserSessions,
      deletedSessionCsrfTokens,
      deletedPreauthSessions,
      batches,
    };
  }
}
