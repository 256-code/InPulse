import { Inject, Injectable } from "@nestjs/common";

import type { DatabaseClient } from "@inpulse/database/client";

import { DATABASE_CLIENT } from "../database/database.constants.js";

/** 就绪探针未能达到可用状态（数据库不可连或迁移版本缺失）。 */
export class HealthReadinessError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "HealthReadinessError";
    this.cause = cause;
  }
}

interface SchemaMigrationRow {
  readonly count: number;
}

/**
 * 技术设计 §11.3：
 * - `/health/live` 只确认进程事件循环正常，不访问数据库；
 * - `/health/ready` 验证数据库可连接且迁移版本存在，未就绪应返回 503。
 *
 * 数据库访问统一放在 Service 层，Controller 只依赖 `HealthService`，避免在
 * Controller 直接触碰数据库层（AGENTS.md 第 3 节）。健康探针使用只读 SQL，
 * 不进入业务事务。
 */
@Injectable()
export class HealthService {
  constructor(
    @Inject(DATABASE_CLIENT) private readonly client: DatabaseClient,
  ) {}

  async checkReadiness(): Promise<void> {
    await this.client.sql`SELECT 1`;

    const rows = (await this.client.sql`
      SELECT count(*)::integer AS count
        FROM app.schema_migrations
    `) as unknown as readonly SchemaMigrationRow[];

    if ((rows[0]?.count ?? 0) < 1) {
      throw new HealthReadinessError(
        "migration version not present",
        undefined,
      );
    }
  }
}
