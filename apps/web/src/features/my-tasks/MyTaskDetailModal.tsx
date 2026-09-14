import React from "react";
import { useNavigate } from "react-router-dom";
import type { InpulseApiClient } from "@generated/api";
import { AppModal } from "@features/common/components/AppModal";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  CalmBadge,
  type CalmBadgeTone,
} from "@features/common/components/Calm";
import { ExternalLinksPanel } from "@features/external-links/ExternalLinksPanel";
import { useUserDirectoryQuery } from "@features/users/user-directory-query";
import type { MyTaskListItem, MyTaskWorkStatus } from "./my-tasks-types";
import {
  formatDayIso,
  formatDateTimeIso,
  isBeforeTodayIso,
  isTodayIso,
} from "./my-tasks-time";

/**
 * F-32 任务详情弹层：任务中心的卡片与列表行点击后在本页打开，关闭后仍停留在任务中心。
 *
 * 设计师稿 `components/task-modal.tsx` 的弹层结构（`.task-modal-header` +
 * `.task-modal-badges` + `.calm-task-actions` + `.task-modal-grid`）在这里复刻，
 * 但只渲染 R-3 列表项真实提供的字段：变更类动作（完成 / 取消 / 合并 / 改派）
 * 仍由所属项目、模块或功能页的任务详情承担，弹层不复制写入口。
 */

const workStatusLabels: Record<MyTaskWorkStatus, string> = {
  TODO: "未完成",
  DONE: "已完成",
  CANCELED: "已取消",
};

const workStatusTone: Record<MyTaskWorkStatus, CalmBadgeTone> = {
  TODO: "blue",
  DONE: "green",
  CANCELED: "gray",
};

const priorityLabels = {
  LOW: "低",
  NORMAL: "普通",
  HIGH: "高",
  URGENT: "紧急",
} as const;

const priorityTone: Record<
  keyof typeof priorityLabels,
  "gray" | "blue" | "amber" | "red"
> = {
  LOW: "gray",
  NORMAL: "blue",
  HIGH: "amber",
  URGENT: "red",
};

const lifecycleLabels: Record<MyTaskListItem["lifecycleStatus"], string> = {
  ACTIVE: "正常",
  ARCHIVED: "已归档",
  INVALID: "已失效",
};

type DueTone = "red" | "amber" | "blue" | "gray";

function dueOf(item: MyTaskListItem): { label: string; tone: DueTone } {
  if (item.dueAt === null) return { label: "未设置截止", tone: "gray" };
  if (item.workStatus === "TODO" && isBeforeTodayIso(item.dueAt)) {
    return { label: "已逾期 " + formatDayIso(item.dueAt), tone: "red" };
  }
  if (isTodayIso(item.dueAt)) return { label: "今天截止", tone: "amber" };
  return { label: formatDayIso(item.dueAt), tone: "blue" };
}

function relationLabel(item: MyTaskListItem): string {
  if (item.groupRole === "MAIN") return "主任务";
  if (item.groupRole === "SOURCE") return "来源任务";
  return "独立任务";
}

export interface MyTaskDetailModalProps {
  readonly open: boolean;
  readonly task: MyTaskListItem | null;
  readonly onClose: () => void;
  /** 与任务中心共用同一个生成客户端；缺省时内联 GitHub 面板自行创建。 */
  readonly client?: InpulseApiClient | undefined;
  /**
   * 「在功能档案中查看」的导航。目录页路由由页面持有（与卡片点击前一致），
   * 弹层只负责把目标任务交回去，不自己拼路径。
   */
  readonly onOpenInCatalog?: (task: MyTaskListItem) => void;
}

export const MyTaskDetailModal: React.FC<MyTaskDetailModalProps> = (props) => {
  // 外层不调用任何 hook：任务中心在未选中任务时挂载它，此时不应要求 Router 上下文。
  if (props.task === null) return null;
  return <MyTaskDetailModalBody {...props} task={props.task} />;
};

const MyTaskDetailModalBody: React.FC<
  MyTaskDetailModalProps & { readonly task: MyTaskListItem }
> = ({ open, task, onClose, client, onOpenInCatalog }) => {
  const navigate = useNavigate();
  const directory = useUserDirectoryQuery({ client, enabled: open });

  const due = dueOf(task);
  const creatorName =
    directory.data?.find((item) => item.id === task.creatorId)?.name ??
    "用户 #" + String(task.creatorId);
  const catalogName =
    task.featureName === null ? task.moduleName : task.featureName;

  return (
    <AppModal
      open={open}
      size="xl"
      label={"任务详情 " + task.code + " " + task.title}
      className="task-modal"
      onCancel={onClose}
    >
      <div className="drawer-header task-modal-header">
        <div>
          <span className="detail-label">
            {task.projectName} / {task.moduleName} /{" "}
            {task.featureName === null ? "模块级" : task.featureName}
          </span>
          <h2>{task.title}</h2>
          <div className="task-modal-badges">
            <span className="task-id">{task.code}</span>
            <CalmBadge tone={workStatusTone[task.workStatus]}>
              {workStatusLabels[task.workStatus]}
            </CalmBadge>
            {task.scopeType === "MODULE" ? (
              <CalmBadge tone="violet">模块级</CalmBadge>
            ) : null}
            <CalmBadge tone={priorityTone[task.priority]}>
              {priorityLabels[task.priority]}优先级
            </CalmBadge>
            <CalmBadge
              tone={
                task.groupRole === "MAIN"
                  ? "violet"
                  : task.groupRole === "SOURCE"
                    ? "cyan"
                    : "gray"
              }
            >
              {relationLabel(task)}
            </CalmBadge>
            {task.lifecycleStatus === "ACTIVE" ? null : (
              <CalmBadge tone="red">
                {lifecycleLabels[task.lifecycleStatus]}
              </CalmBadge>
            )}
          </div>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭任务详情"
          onClick={onClose}
        >
          <InpulseIcon name="x" size={19} />
        </button>
      </div>

      <div className="calm-task-actions">
        <span className={"calm-due due-" + due.tone}>
          <InpulseIcon name="clock" size={14} />
          {due.label}
        </span>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onOpenInCatalog?.(task)}
        >
          <InpulseIcon name="code" size={14} />
          在功能档案中查看
        </button>
        {task.groupRole === "SOURCE" && task.groupId !== null ? (
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              onClose();
              navigate("/task-groups/" + String(task.groupId));
            }}
          >
            <InpulseIcon name="gitBranch" size={14} />
            查看主任务
            <InpulseIcon name="chevronRight" size={13} />
          </button>
        ) : null}
      </div>

      <div className="task-modal-grid">
        <div className="task-modal-main">
          <section className="calm-description">
            <h3>任务归属</h3>
            <p>
              {task.projectName} · {task.moduleName}
              {task.featureName === null ? "" : " · " + task.featureName}
              {task.scopeType === "MODULE"
                ? "（模块级任务，可影响多个功能）"
                : "（功能级任务）"}
            </p>
          </section>
          <section className="calm-description">
            <h3>GitHub 关联</h3>
            <ExternalLinksPanel
              key={task.taskId}
              variant="inline"
              targetType="TASK"
              targetId={task.taskId}
              client={client}
            />
          </section>
        </div>

        <aside className="task-modal-facts">
          <dl className="calm-meta">
            <dt>负责人</dt>
            <dd>{task.assignee.name}</dd>
            <dt>创建人</dt>
            <dd>{creatorName}</dd>
            <dt>截止时间</dt>
            <dd>{task.dueAt === null ? "未设置" : formatDayIso(task.dueAt)}</dd>
            <dt>完成时间</dt>
            <dd>
              {task.completedAt === null
                ? "尚未完成"
                : formatDateTimeIso(task.completedAt)}
            </dd>
            <dt>迭代记录</dt>
            <dd>
              {task.publishedRecordCount > 0
                ? "已发布 " +
                  String(task.publishedRecordCount) +
                  " 条（多个版本不重复计数）"
                : "还没有已发布记录"}
            </dd>
            <dt>更新时间</dt>
            <dd>{formatDateTimeIso(task.updatedAt)}</dd>
          </dl>
        </aside>
      </div>

      <div className="calm-action-footer">
        <p className="permission-hint">
          任务在 {catalogName}{" "}
          中推进；任务中心只做跨项目查看与定位，不复制写入口。
        </p>
        <button type="button" className="secondary-button" onClick={onClose}>
          关闭
        </button>
      </div>
    </AppModal>
  );
};
