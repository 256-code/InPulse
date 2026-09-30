import type { SearchItem } from "@generated/api";
import { taskDetailPath } from "@features/tasks/task-links";

/**
 * 全局搜索结果的落地页（搜索结果页与命令面板共用同一条映射，改一处必须改两处）。
 *
 * 上级归属只认服务端下发的 projectId / moduleId / featureId / recordId
 * （见 SearchItem 契约注释：客户端不得自行推导），因此这里只做拼路径。
 * 返回 null 表示该结果没有可打开的页面，调用方据此不提供点击入口：
 *   * EXTERNAL_LINK（GitHub 关联）只作为所属对象页面上的一段信息存在，
 *     归属可能是任务 / 功能 / 记录 / 项目，没有自己的页面；
 *   * TASK_GROUP 只有任务中心里的聚合组弹层，没有独立页面；
 *   * 模块级任务、以及历史投影行可能缺少上级归属，一律按无页面处理，
 *     避免拼出指向错误对象的链接。
 */
export function searchResultPath(item: SearchItem): string | null {
  const projectPath = `/projects/${String(item.projectId)}/modules`;
  switch (item.entityType) {
    case "PROJECT":
      return projectPath;
    case "MODULE":
      return `${projectPath}/${String(item.entityId)}/tasks`;
    case "FEATURE":
      return item.moduleId === null
        ? null
        : `${projectPath}/${String(item.moduleId)}/features/${String(item.entityId)}`;
    case "TASK":
      return item.moduleId === null
        ? null
        : taskDetailPath({
            projectId: item.projectId,
            moduleId: item.moduleId,
            featureId: item.featureId,
            taskId: item.entityId,
          });
    case "CHANGE_RECORD":
      return recordPath(item.projectId, item.entityId);
    case "LEFTOVER":
      return item.recordId === null
        ? null
        : recordPath(item.projectId, item.recordId);
    case "EXTERNAL_LINK":
    case "TASK_GROUP":
      return null;
  }
}

/** 已发布记录的深链口径与 RecordsWorkspace 读取 `publishedId` 一致。 */
function recordPath(projectId: number, recordId: number): string {
  return `/records?view=published&projectId=${String(projectId)}&publishedId=${String(recordId)}`;
}
