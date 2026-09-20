import React, { lazy, Suspense, useState } from "react";
import { Alert, Button, Spin } from "antd";
import { useNavigate, useParams } from "react-router-dom";
import { useModules } from "@features/modules/module-query";
import { useAuth } from "@features/auth/auth-context";
import { TasksPanel } from "@features/tasks/TasksPanel";
import type { TaskLocation } from "@features/tasks/task-links";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { CalmSectionTitle, CalmTabs } from "@features/common/components/Calm";
import { resourceLifecycleLabel } from "@features/common/resource-lifecycle";

/**
 * 聚合组详情里的成员任务就地打开任务详情（与任务中心同一实现：状态推进、编辑、
 * 迭代记录、合并与外部链接等写入口全在同一处）。按需加载，模块任务页的初始包
 * 不引入任务详情的完整实现。
 */
const TaskDetailOverlay = lazy(
  () => import("@features/tasks/TaskDetailOverlay"),
);

export default function ModuleTasksPage() {
  const navigate = useNavigate();
  const params = useParams();
  const projectId = Number(params["projectId"]);
  const moduleId = Number(params["moduleId"]);
  const { query } = useModules(projectId);
  const { user } = useAuth();
  /** 聚合组弹窗里点击成员任务标题后要就地打开的任务（null 表示弹层关闭）。 */
  const [taskTarget, setTaskTarget] = useState<TaskLocation | null>(null);
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
          {resourceLifecycleLabel(
            module.status,
            module.stats.completedTaskCount,
          )}
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
        isAdmin={user?.isAdmin === true}
        onOpenTask={setTaskTarget}
      />
      <Suspense fallback={null}>
        {taskTarget === null ? null : (
          <TaskDetailOverlay
            target={taskTarget}
            isAdmin={user?.isAdmin === true}
            onClose={() => setTaskTarget(null)}
            onOpenTask={setTaskTarget}
          />
        )}
      </Suspense>
    </>
  );
}
