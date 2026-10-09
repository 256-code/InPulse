import { Injectable } from "@nestjs/common";
import {
  moduleItemSchema,
  type ModuleEditRequest,
  type ModuleItem,
} from "@inpulse/api-contract";
import type { TransactionContext } from "../../database/transaction-context.js";
import {
  lifecycleRankExpression,
  moduleStatColumns,
} from "../../stats/card-stat-columns.js";

type Row = Omit<ModuleItem, "createdAt" | "updatedAt" | "stats"> & {
  createdAt: string | Date;
  updatedAt: string | Date;
  activeFeatureCount: number;
  openTaskCount: number;
  completedTaskCount: number;
};
const dto = (row: Row): ModuleItem => {
  const { activeFeatureCount, openTaskCount, completedTaskCount, ...rest } =
    row;
  return moduleItemSchema.parse({
    ...rest,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    stats: { activeFeatureCount, openTaskCount, completedTaskCount },
  });
};

/** ADR-059：删除模块命令读取的原始行，含行版本，不解析为 `ModuleItem`。 */
export interface ModuleDeletionRow {
  readonly id: number;
  readonly projectId: number;
  readonly code: string;
  readonly name: string;
  readonly kind: ModuleItem["kind"];
  readonly rowVersion: number;
}

/** ADR-059：软删除成功后返回的行快照，供响应与审计使用。 */
export interface ModuleSoftDeletedRow extends ModuleDeletionRow {
  readonly deletedAt: Date;
}

@Injectable()
export class ModuleManagementRepository {
  async list(tx: TransactionContext, projectId: number): Promise<ModuleItem[]> {
    const rows = await tx.sql<
      Row[]
    >`SELECT m.id, m.code, m.project_id AS "projectId", m.name, m.description, m.kind, m.sort_order AS "sortOrder", m.row_version AS "rowVersion", m.created_at AS "createdAt", m.updated_at AS "updatedAt", ${moduleStatColumns(tx.sql, "m")} FROM app.modules m WHERE m.project_id = ${projectId} AND m.deleted_at IS NULL ORDER BY ${lifecycleRankExpression(tx.sql, "module", "m")}, m.created_at DESC, m.id DESC`;
    return rows.map(dto);
  }

  async find(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    lock = false,
  ): Promise<ModuleItem | undefined> {
    const rows = await tx.sql<
      Row[]
    >`SELECT m.id, m.code, m.project_id AS "projectId", m.name, m.description, m.kind, m.sort_order AS "sortOrder", m.row_version AS "rowVersion", m.created_at AS "createdAt", m.updated_at AS "updatedAt", ${moduleStatColumns(tx.sql, "m")} FROM app.modules m WHERE m.project_id = ${projectId} AND m.id = ${moduleId} AND m.deleted_at IS NULL ${lock ? tx.sql`FOR UPDATE` : tx.sql``}`;
    return rows[0] === undefined ? undefined : dto(rows[0]);
  }

  async create(
    tx: TransactionContext,
    projectId: number,
    actorId: number,
    input: ModuleEditRequest,
  ): Promise<ModuleItem> {
    const rows = await tx.sql<
      { id: number }[]
    >`INSERT INTO app.modules (project_id, name, description, kind, created_by) VALUES (${projectId}, ${input.name}, ${input.description}, 'NORMAL', ${actorId}) RETURNING id`;
    return (await this.find(tx, projectId, rows[0]!.id))!;
  }

  /** ADR-044：模块只有名称与描述可改，已无生命周期状态可写。 */
  async update(
    tx: TransactionContext,
    current: ModuleItem,
    next: { name: string; description: string },
  ): Promise<ModuleItem | undefined> {
    const rows = await tx.sql<
      { id: number }[]
    >`UPDATE app.modules SET name = ${next.name}, description = ${next.description}, updated_at = now(), row_version = row_version + 1 WHERE id = ${current.id} AND project_id = ${current.projectId} AND row_version = ${current.rowVersion} RETURNING id`;
    return rows.length
      ? this.find(tx, current.projectId, current.id)
      : undefined;
  }

  /**
   * ADR-059：删除命令的原始行读取，`lock` 时对模块行取排他锁，阻止与子级写命令
   * 的写前 `FOR SHARE` 检查并行；已软删除的模块视为不存在。
   */
  async findForDeletion(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    lock = false,
  ): Promise<ModuleDeletionRow | undefined> {
    const rows = await tx.sql<
      ModuleDeletionRow[]
    >`SELECT id, project_id AS "projectId", code, name, kind, row_version AS "rowVersion" FROM app.modules WHERE project_id = ${projectId} AND id = ${moduleId} AND deleted_at IS NULL ${lock ? tx.sql`FOR UPDATE` : tx.sql``}`;
    return rows[0];
  }

  /**
   * ADR-059：模块软删除。`modules_row_version` 触发器要求任何 UPDATE 把行版本恰好
   * 加一，因此这里与其它写命令一致地`row_version + 1`；条件带 `deleted_at IS NULL`
   * 与预期行版本，并发重复删除只有一个命中。
   */
  async softDelete(
    tx: TransactionContext,
    current: ModuleDeletionRow,
    actorId: number,
  ): Promise<ModuleSoftDeletedRow | undefined> {
    const rows = await tx.sql<
      ModuleSoftDeletedRow[]
    >`UPDATE app.modules SET deleted_at = clock_timestamp(), deleted_by = ${actorId}, row_version = row_version + 1, updated_at = GREATEST(clock_timestamp(), updated_at) WHERE id = ${current.id} AND project_id = ${current.projectId} AND row_version = ${current.rowVersion} AND deleted_at IS NULL RETURNING id, project_id AS "projectId", code, name, kind, row_version AS "rowVersion", deleted_at AS "deletedAt"`;
    return rows[0];
  }
}
