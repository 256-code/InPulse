import React, { Suspense, lazy, useState } from "react";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { SearchParamsScope } from "@features/common/search-params-scope";
import { useAuth } from "@features/auth/auth-context";
import {
  canManageProjectResources,
  useProjectDetail,
} from "@features/projects/project-query";
import type { InpulseApiClient } from "@generated/api";
import type { TaskLocation } from "@features/tasks/task-links";

/**
 * 项目主页的三个就地弹窗：成员与设置、迭代记录、遗留问题。
 * 项目主页不再整页跳转到 `/members`、`/records`、`/issues`，
 * 三个工作区视图按需加载后装进 AppModal，页面上下文（模块列表、筛选状态）不丢。
 *
 * 三个视图都自带 `useSearchParams` 状态（项目筛选、草稿详情、记录展开等），
 * 弹窗内用 `MemoryRouter` 给它们一份独立的初始地址，交互不污染浏览器地址栏；
 * 关闭弹窗即丢弃这份局部地址，重新打开回到该项目的默认视图。
 */
// 成员/记录视图只有命名导出：lazy 需要 default，用 then 映射一次。
const ProjectMembersPageView = lazy(() =>
  import("@features/projects/ProjectMembersPageView").then((m) => ({
    default: m.ProjectMembersPageView,
  })),
);
const ActiveProjectMembers = lazy(() =>
  import("@features/projects/ActiveProjectMembers").then((m) => ({
    default: m.ActiveProjectMembers,
  })),
);
const RecordsWorkspace = lazy(() =>
  import("@features/records/RecordsWorkspace").then((m) => ({
    default: m.RecordsWorkspace,
  })),
);
const IssuesPageView = lazy(() => import("@features/issues/IssuesPageView"));
const TaskDetailOverlay = lazy(
  () => import("@features/tasks/TaskDetailOverlay"),
);

export type ProjectWorkspaceModalKind = "members" | "records" | "issues";

export interface ProjectWorkspaceModalsProps {
  readonly projectId: number;
  readonly client?: InpulseApiClient | undefined;
  /** 当前打开的弹窗；null 表示全部关闭。 */
  readonly open: ProjectWorkspaceModalKind | null;
  readonly onClose: () => void;
}

const MODAL_META: Record<
  ProjectWorkspaceModalKind,
  {
    readonly label: string;
    /** 弹窗内视图的初始搜索参数（作用域本地状态，不进地址栏）。 */
    readonly initialSearch: (projectId: number) => string;
  }
> = {
  members: {
    label: "成员与设置",
    initialSearch: () => "",
  },
  records: {
    label: "迭代记录",
    initialSearch: (projectId) => "view=published&projectId=" + projectId,
  },
  issues: {
    label: "遗留问题",
    initialSearch: (projectId) => "projectId=" + projectId,
  },
};

export const ProjectWorkspaceModals: React.FC<ProjectWorkspaceModalsProps> = ({
  projectId,
  client,
  open,
  onClose,
}) => {
  const { user } = useAuth();
  const detail = useProjectDetail({ projectId, client });
  const isSystemAdmin = user?.isAdmin === true;
  const canManage =
    isSystemAdmin ||
    canManageProjectResources(false, detail.data?.currentUserRole ?? null);
  /** 遗留问题弹窗里点来源/跟进任务：再叠一层任务详情弹窗。 */
  const [taskTarget, setTaskTarget] = useState<TaskLocation | null>(null);

  if (open === null) return null;
  const meta = MODAL_META[open];
  const projectName = detail.data?.project?.name ?? null;
  return (
    <>
      <Modal
        open
        size="xl"
        label={meta.label}
        eyebrow={projectName === null ? "项目" : projectName}
        title={meta.label}
        closeLabel={"关闭" + meta.label}
        onCancel={onClose}
        className="project-workspace-modal"
      >
        <div className="project-workspace-modal-body">
          <Suspense fallback={null}>
            <SearchParamsScope initial={meta.initialSearch(projectId)}>
              {open === "members" ? (
                canManage ? (
                  <ProjectMembersPageView
                    projectId={projectId}
                    {...(client ? { client } : {})}
                    isSystemAdmin={isSystemAdmin}
                    embedded
                  />
                ) : (
                  <ActiveProjectMembers
                    projectId={projectId}
                    projectDetail={detail.data?.project ?? null}
                    {...(client ? { client } : {})}
                  />
                )
              ) : open === "records" ? (
                <RecordsWorkspace {...(client ? { client } : {})} embedded />
              ) : (
                <IssuesPageView
                  {...(client ? { client } : {})}
                  onOpenTask={setTaskTarget}
                  embedded
                />
              )}
            </SearchParamsScope>
          </Suspense>
        </div>
      </Modal>
      <Suspense fallback={null}>
        {taskTarget === null ? null : (
          <TaskDetailOverlay
            target={taskTarget}
            {...(client ? { client } : {})}
            isAdmin={isSystemAdmin}
            onClose={() => setTaskTarget(null)}
            onOpenTask={setTaskTarget}
          />
        )}
      </Suspense>
    </>
  );
};
