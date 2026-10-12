import type { TransactionContext } from "../../database/transaction-context.js";

export interface FeatureReadResource {
  readonly featureId: number;
  readonly projectId: number;
  readonly moduleId: number;
  readonly name: string;
  readonly createdBy: number;
}

export interface FeatureNameLookupInput {
  /** 服务端授权范围与目标功能 ID；任一数组为空时短路返回空集。 */
  readonly projectIds: readonly number[];
  readonly featureIds: readonly number[];
}

export interface FeatureNameItem {
  readonly featureId: number;
  readonly projectId: number;
  readonly moduleId: number;
  readonly name: string;
}

export interface FeatureCountInput {
  readonly projectId: number;
  /** 省略 = 项目内全部模块。 */
  readonly moduleId?: number;
}

export interface FeatureNameMatchItem {
  readonly featureId: number;
  readonly projectId: number;
  readonly moduleId: number;
  readonly name: string;
  readonly code: string;
  readonly currentBehavior: string;
  readonly acceptanceCriteria: string;
  readonly tags: readonly string[];
  /** 已软删除（deleted_at 非空）的同名功能；V1 跳过复用并新建。 */
  readonly deleted: boolean;
}

/** Caller authorizes project access. */
export abstract class FeatureReadPort {
  abstract find(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    featureId: number,
  ): Promise<FeatureReadResource | undefined>;

  /**
   * 批量名称查询（R-3 我的任务）。SQL 同时带 project_id 与 id 条件，跨项目串联
   * 不会返回结果；只读、不取锁，不校验项目授权。
   */
  abstract listNames(
    tx: TransactionContext,
    input: FeatureNameLookupInput,
  ): Promise<readonly FeatureNameItem[]>;

  /**
   * 项目（可选模块）内功能计数（F-29「活跃功能数」）。只读、不取锁，且不校验
   * 项目授权。SQL 同时带 project_id 与 module_id，防止跨项目串联，并完整命中
   * features_module_id_idx（ADR-045 去掉常量列 status 后的三列索引）。
   */
  /**
   * 按规范化名称（lower(btrim(name))）查找模块内同名功能，包含已软删除行。
   * 只读、不取锁，不校验项目授权。
   */
  abstract matchByName(
    tx: TransactionContext,
    projectId: number,
    moduleId: number,
    normalizedName: string,
  ): Promise<readonly FeatureNameMatchItem[]>;

  abstract count(
    tx: TransactionContext,
    input: FeatureCountInput,
  ): Promise<number>;
}
