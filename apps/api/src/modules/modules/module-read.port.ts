import type { TransactionContext } from "../../database/transaction-context.js";

/** ADR-044：模块层面已下线归档，模块没有生命周期状态可暴露。 */
export interface ModuleReadResource {
  readonly moduleId: number;
  readonly projectId: number;
  readonly name: string;
}

export interface ModuleNameLookupInput {
  /** 服务端授权范围与目标模块 ID；任一数组为空时短路返回空集。 */
  readonly projectIds: readonly number[];
  readonly moduleIds: readonly number[];
}

export interface ModuleNameItem {
  readonly moduleId: number;
  readonly projectId: number;
  readonly name: string;
}

export interface ModuleCountInput {
  readonly projectId: number;
}

export interface ModuleNameMatchItem {
  readonly moduleId: number;
  readonly projectId: number;
  readonly name: string;
  readonly code: string;
  readonly description: string;
  /** 已软删除（deleted_at 非空）的同名模块；既不能复用也不能同名新建。 */
  readonly deleted: boolean;
}

/** Caller authorizes the project; this port never decides writability. */
export abstract class ModuleReadPort {
  abstract find(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
  ): Promise<ModuleReadResource | undefined>;

  /**
   * 批量名称查询（R-3 我的任务）。SQL 同时带 project_id 与 id 条件，跨项目串联
   * 不会返回结果；只读、不取锁，不校验项目授权。
   */
  abstract listNames(
    tx: TransactionContext,
    input: ModuleNameLookupInput,
  ): Promise<readonly ModuleNameItem[]>;

  /**
   * 项目内模块计数（F-29「活跃模块数」）。只读、不取锁，且不校验项目授权，
   * 调用方必须先完成授权（与 find 同一约定）。计数结果与项目自身状态无关（A 裁决 Q-05）。
   */
  /**
   * 按规范化名称（lower(btrim(name))）查找项目内同名模块，包含已软删除行：
   * 名称唯一索引不区分删除状态，调用方据此决定复用、冲突或新建（ADR-064）。
   * 只读、不取锁，不校验项目授权。
   */
  abstract matchByName(
    tx: TransactionContext,
    projectId: number,
    normalizedName: string,
  ): Promise<readonly ModuleNameMatchItem[]>;

  abstract count(
    tx: TransactionContext,
    input: ModuleCountInput,
  ): Promise<number>;
}
