/**
 * 任务详情深链（跨页面共用）：模块级任务回到模块任务页，功能级任务回到功能页，
 * 两者都由 ?taskId= 打开任务抽屉（TasksPanel 从 URL 读取）。
 */
export interface TaskLocation {
  readonly projectId: number;
  readonly moduleId: number;
  readonly featureId: number | null;
  readonly taskId: number;
}

export function taskDetailPath(task: TaskLocation): string {
  const scope =
    task.featureId === null ? "/tasks" : "/features/" + String(task.featureId);
  return (
    "/projects/" +
    String(task.projectId) +
    "/modules/" +
    String(task.moduleId) +
    scope +
    "?taskId=" +
    String(task.taskId)
  );
}
