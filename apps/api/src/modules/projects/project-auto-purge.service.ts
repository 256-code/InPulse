import { randomUUID } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";

import { AuditWritePort } from "../../audit/audit.port.js";
import type { TransactionContext } from "../../database/transaction-context.js";
import { PostgresUnitOfWork } from "../../database/unit-of-work.js";
import { ProjectsWritePort } from "./projects-write.port.js";

/**
 * ADR-055：软删除项目的保留期（天）。从 `deleted_at` 起算，而还原会清空它、
 * 重新删除会写入新的删除时间，因此保留期始终按「最后一次删除」计算。
 */
export const PROJECT_AUTO_PURGE_DEFAULT_RETENTION_DAYS = 30;

/** 单次运行最多处理的候选项目数；剩余候选等下一轮调度继续处理。 */
export const PROJECT_AUTO_PURGE_DEFAULT_BATCH_SIZE = 20;

/** 审计正文里的触发来源：自动彻底删除（手工彻底删除没有该字段）。 */
export const PROJECT_AUTO_PURGE_TRIGGER = "AUTO_RETENTION";

export interface ProjectAutoPurgeOptions {
  readonly retentionDays: number;
  readonly batchSize: number;
}

export interface ProjectAutoPurgeResult {
  readonly candidates: number;
  /** 本轮物理删除的项目 ID（按候选顺序）。 */
  readonly purgedProjectIds: readonly number[];
  /** 锁内复核发现已还原、已删除或删除时间被刷新而跳过的项目 ID。 */
  readonly skippedProjectIds: readonly number[];
  /** 单个项目删除失败（已回滚并记录日志）的 ID，等下一轮重试。 */
  readonly failedProjectIds: readonly number[];
}

export function projectAutoPurgeOptionsFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): ProjectAutoPurgeOptions {
  return {
    retentionDays: positiveIntegerFromEnv(
      env,
      "PROJECT_AUTO_PURGE_RETENTION_DAYS",
      PROJECT_AUTO_PURGE_DEFAULT_RETENTION_DAYS,
    ),
    batchSize: positiveIntegerFromEnv(
      env,
      "PROJECT_AUTO_PURGE_BATCH_SIZE",
      PROJECT_AUTO_PURGE_DEFAULT_BATCH_SIZE,
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
 * ADR-055 自动彻底删除：软删除超过保留期的项目，由后台按 `app.purge_project`
 * 窄口物理删除，SYSTEM 审计链留一条 `project.purge`（`trigger = AUTO_RETENTION`）。
 *
 * 与手工彻底删除共用同一条数据库路径与写前复核：候选列表只做只读筛选，
 * 每个候选在独立事务内加锁并复核保留期，再做删除与审计，任一步失败整体回滚
 * 且不阻塞其它候选。逐项目独立事务也保证一名失败不会拖累整批。
 */
@Injectable()
export class ProjectAutoPurgeService {
  private readonly logger = new Logger(ProjectAutoPurgeService.name);

  constructor(
    private readonly unitOfWork: PostgresUnitOfWork,
    private readonly projects: ProjectsWritePort,
    private readonly audit: AuditWritePort,
  ) {}

  async run(
    options: ProjectAutoPurgeOptions = projectAutoPurgeOptionsFromEnv(),
  ): Promise<ProjectAutoPurgeResult> {
    const candidates = await this.unitOfWork.run((tx) =>
      this.projects.listAutoPurgeCandidates(tx, {
        retentionDays: options.retentionDays,
        limit: options.batchSize,
      }),
    );

    const purgedProjectIds: number[] = [];
    const skippedProjectIds: number[] = [];
    const failedProjectIds: number[] = [];
    for (const candidate of candidates) {
      try {
        // 单个项目一个事务：锁内复核保留期 -> 物理删除 -> SYSTEM 链留痕。
        const purged = await this.unitOfWork.run((tx) =>
          this.purgeExpiredProject(tx, candidate.projectId, options),
        );
        if (purged) {
          purgedProjectIds.push(candidate.projectId);
        } else {
          skippedProjectIds.push(candidate.projectId);
        }
      } catch (error: unknown) {
        failedProjectIds.push(candidate.projectId);
        this.logger.error(
          `自动彻底删除项目 ${candidate.projectId} 失败：${
            error instanceof Error
              ? (error.stack ?? error.message)
              : String(error)
          }`,
        );
      }
    }

    return {
      candidates: candidates.length,
      purgedProjectIds,
      skippedProjectIds,
      failedProjectIds,
    };
  }

  private async purgeExpiredProject(
    tx: TransactionContext,
    projectId: number,
    options: ProjectAutoPurgeOptions,
  ): Promise<boolean> {
    const current = await this.projects.findExpiredDeletedProjectForChange(tx, {
      projectId,
      retentionDays: options.retentionDays,
    });
    // 已还原、已被并发彻底删除，或还原后重新删除导致删除时间被刷新。
    if (current === undefined) return false;

    const counts = await this.projects.purgeProject(tx, { projectId });
    await this.audit.append(tx, {
      // 项目链已随项目一起删除，本操作只能记在 SYSTEM 链上。
      projectId: null,
      actorType: "SYSTEM",
      actorId: null,
      action: "project.purge",
      targetType: "PROJECT",
      targetId: String(projectId),
      eventPayload: {
        code: current.code,
        name: current.name,
        deletedAt: current.deletedAt,
        deletedBy: { id: current.deletedById, name: current.deletedByName },
        actorRole: "SYSTEM",
        trigger: PROJECT_AUTO_PURGE_TRIGGER,
        retentionDays: options.retentionDays,
        records: counts,
      },
      requestId: randomUUID(),
      occurredAt: new Date(),
    });
    return true;
  }
}
