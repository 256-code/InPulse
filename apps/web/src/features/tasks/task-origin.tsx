import { useFeatures } from "@features/features/feature-query";
import { useModules } from "@features/modules/module-query";
import { useProjectDetail } from "@features/projects/project-query";
import type { InpulseApiClient } from "@generated/api";

export interface TaskOriginInput {
  readonly projectId: number;
  readonly moduleId: number;
  readonly featureId: number | null;
  readonly client?: InpulseApiClient | undefined;
}

/**
 * 任务归属名称解析：任务中心、任务状态弹层等位置看不到项目结构，必须显示
 * 项目 / 模块 / 功能的名称而不是编号。名称走既有只读契约（getProject /
 * listModules / listFeatures），query key 与页面共用，不产生额外请求；
 * 数据未到时回退编号，模块级任务（`featureId` 为 null）没有功能名。
 */
function useTaskOrigin({
  projectId,
  moduleId,
  featureId,
  client,
}: TaskOriginInput) {
  const project = useProjectDetail({ client, projectId });
  const modules = useModules(projectId, client);
  const features = useFeatures(projectId, moduleId, undefined, client);
  return {
    projectName: project.data?.project.name ?? `项目 #${projectId}`,
    moduleName:
      modules.query.data?.items.find((item) => item.id === moduleId)?.name ??
      `模块 #${moduleId}`,
    featureName:
      featureId === null
        ? null
        : (features.query.data?.items.find((item) => item.id === featureId)
            ?.name ?? `功能 #${featureId}`),
  };
}

/** 弹层头部的归属面包屑：单行省略，名称过长时不挤压标题与关闭按钮。 */
export function TaskOriginCrumb(input: TaskOriginInput) {
  const { projectName, moduleName, featureName } = useTaskOrigin(input);
  const text = `${projectName} / ${moduleName} / ${featureName ?? "模块级任务"}`;
  return (
    <span className="task-origin-crumb" title={text}>
      {text}
    </span>
  );
}

/** 任务详情事实栏的归属行：项目 / 模块 / 功能。 */
export function TaskOriginFacts(input: TaskOriginInput) {
  const { projectName, moduleName, featureName } = useTaskOrigin(input);
  return (
    <>
      <dt>项目</dt>
      <dd>{projectName}</dd>
      <dt>模块</dt>
      <dd>{moduleName}</dd>
      <dt>功能</dt>
      <dd>{featureName ?? "模块级任务（不属于具体功能）"}</dd>
    </>
  );
}
