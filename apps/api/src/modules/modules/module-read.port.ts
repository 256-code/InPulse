import type { TransactionContext } from "../../database/transaction-context.js";

export interface ModuleReadResource {
  readonly moduleId: number;
  readonly projectId: number;
  readonly name: string;
  readonly status: "ACTIVE" | "ARCHIVED";
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
  /** 省略 = 不按状态过滤，归档行同样计入。 */
  readonly status?: "ACTIVE" | "ARCHIVED";
}

/** Caller authorizes the project; includes archived history and never decides writability. */
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
   * 调用方必须先完成授权（与 find 同一约定）。省略 status 时归档行同样计入，
   * 计数结果与项目自身是否归档无关（A 裁决 Q-05）。
   */
  abstract count(
    tx: TransactionContext,
    input: ModuleCountInput,
  ): Promise<number>;
}
