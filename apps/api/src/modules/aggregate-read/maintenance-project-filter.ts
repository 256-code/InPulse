import type { ProjectQueryPort } from "../projects/project-query.port.js";

/**
 * 任务中心的维护中项目过滤（2026-09-30 产品口径）：项目进入维护中（MAINTENANCE）
 * 后不再产出任务卡片，未完成与已完成两档一致。R-3（我的任务）与 R-7（任务聚合组）
 * 各自在项目范围上先剔除维护中项目，统计、遗留问题入口与列表因此共用同一基准集合。
 *
 * 这是展示口径，不是权限收窄：维护中项目仍可写（ADR-043），项目内的任务、记录与
 * 任务看板都不受影响；未开始 / 进行中与已删除项目不在剔除范围内（软删项目由授权
 * 范围排除）。读取不到状态的 ID 原样保留，由下游端口按自身口径收敛，避免这里放大范围。
 */
export async function excludeMaintenanceProjects(
  projects: ProjectQueryPort,
  projectIds: readonly number[],
): Promise<readonly number[]> {
  if (projectIds.length === 0) {
    return projectIds;
  }
  const statuses = await projects.listStatuses(projectIds);
  const maintenanceProjectIds = new Set(
    statuses
      .filter((item) => item.status === "MAINTENANCE")
      .map((item) => item.projectId),
  );
  if (maintenanceProjectIds.size === 0) {
    return projectIds;
  }
  return projectIds.filter(
    (projectId) => !maintenanceProjectIds.has(projectId),
  );
}
