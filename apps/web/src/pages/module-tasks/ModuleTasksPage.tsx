import React from "react";
import { Alert, Button, Spin } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import { useModules } from "@features/modules/module-query";
import { useProjectDetail } from "@features/projects/project-query";
import { TasksPanel } from "@features/tasks/TasksPanel";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { CalmSectionTitle, CalmTabs } from "@features/common/components/Calm";

export default function ModuleTasksPage() {
  const navigate = useNavigate();
  const params = useParams();
  const projectId = Number(params["projectId"]);
  const moduleId = Number(params["moduleId"]);
  const { query } = useModules(projectId);
  const projectQuery = useProjectDetail({ projectId });
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
  const featuresHref =
    "/projects/" + projectId + "/modules/" + moduleId + "/features";
  return (
    <>
      <div className="page-header">
        <div>
          <Button
            className="back-button"
            onClick={() => navigate("/projects/" + projectId + "/modules")}
          >
            <InpulseIcon name="arrowLeft" size={15} />
            返回模块列表
          </Button>
          <span className="eyebrow">
            {`模块 / ${projectQuery.data?.name ?? "加载中"}`}
          </span>
          <h1>{module.name}</h1>
          <p>{module.description || "模块级任务与功能档案的公共工作区。"}</p>
        </div>
        <div className="catalog-actions">
          <Button className="secondary-button" href={featuresHref}>
            查看功能目录
          </Button>
        </div>
      </div>
      <details className="calm-disclosure module-information">
        <summary>
          模块资料 · {module.name} ·{" "}
          {module.status === "ARCHIVED" ? "已归档" : "正常"}
        </summary>
        <h4>职责与范围</h4>
        <p>{module.description || "尚未补充，可通过编辑模块完善。"}</p>
      </details>
      <CalmTabs
        className="calm-tabs module-work-tabs"
        label="模块工作区"
        activeKey="模块级任务"
        onChange={(key) => {
          if (key === "功能目录") navigate(featuresHref);
        }}
        items={[
          { key: "功能目录", label: "功能目录" },
          { key: "模块级任务", label: "模块级任务" },
        ]}
      />
      <CalmSectionTitle
        title="共同技术工作"
        hint="一份任务，可影响当前模块的多个功能"
      />
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
