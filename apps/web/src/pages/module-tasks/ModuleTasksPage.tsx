import React from "react";
import { Alert, Button, Spin } from "antd";
import { useParams } from "react-router-dom";
import { useModules } from "@features/modules/module-query";
import { TasksPanel } from "@features/tasks/TasksPanel";

export default function ModuleTasksPage() {
  const params = useParams();
  const projectId = Number(params["projectId"]);
  const moduleId = Number(params["moduleId"]);
  const { query } = useModules(projectId);
  if (
    ![projectId, moduleId].every(
      (id) => Number.isInteger(id) && id > 0 && id <= 2147483647,
    )
  )
    return <Alert type="error" title="模块地址无效" />;
  if (query.isPending) return <Spin />;
  if (query.isError)
    return (
      <Alert
        type="error"
        title="模块不存在或无法访问"
        action={<Button onClick={() => void query.refetch()}>重试</Button>}
      />
    );
  const module = query.data?.items.find((item) => item.id === moduleId);
  if (!module) return <Alert type="error" title="模块不存在或无法访问" />;
  return (
    <>
      <h1>{module.name} · 模块任务</h1>
      <TasksPanel
        key={`${projectId}:${moduleId}`}
        projectId={projectId}
        moduleId={moduleId}
        featureId={null}
        writable={module.status === "ACTIVE"}
      />
    </>
  );
}
