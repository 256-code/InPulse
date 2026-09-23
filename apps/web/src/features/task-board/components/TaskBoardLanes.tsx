import React from "react";

import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { taskToneClassName } from "@features/common/task-tone";

import {
  avatarTextOf,
  avatarToneOf,
  cardMarkOf,
  dueLabelOf,
  laneProgressOf,
  laneToneOf,
  LEFTOVER_SOURCE_BADGE,
} from "../task-board-format";
import type { TaskBoardCard, TaskBoardModule } from "../task-board-types";

/**
 * 看板视图：按模块分泳道，泳道头含模块名、功能与任务计数、逾期角标、
 * 完成进度与负责人头像组；泳道内任务卡按服务端排序（与任务中心共用
 * apps/api/src/modules/tasks/task-list-order.ts 的同一套排序键）。点击卡片就地打开
 * 任务详情（TaskDetailOverlay）。
 *
 * 泳道头统计恒为全量口径，不随筛选跳变；被筛空的泳道整体隐藏。
 */
export interface TaskBoardLanesProps {
  readonly modules: readonly TaskBoardModule[];
  readonly collapsedIds: ReadonlySet<number>;
  readonly leftoverIds: ReadonlySet<number>;
  readonly onToggleLane: (moduleId: number) => void;
  readonly onOpenTask: (card: TaskBoardCard) => void;
}

/**
 * 卡片配色与列表行、任务中心同源：优先级决定底色，已完成 / 已取消覆盖状态色，
 * 遗留问题来源覆盖锈红。已逾期 / 今天到期不参与配色（2026-09-22 产品口径
 * 「逾期的不搞特殊了，原本的优先级是什么就呈现什么颜色」）：看板只在日期文案上
 * 用 .tb-date--overdue / .tb-date--today 提示，且只读服务端 dueState，
 * 不在前端按本地时钟重算。
 */
function cardClassNameOf(card: TaskBoardCard, leftoverSource: boolean): string {
  return (
    "tb-card " +
    taskToneClassName(card.priority, card.workStatus, leftoverSource)
  );
}

const TaskBoardCardItem: React.FC<{
  readonly card: TaskBoardCard;
  readonly leftoverSource: boolean;
  readonly onOpen: (card: TaskBoardCard) => void;
}> = ({ card, leftoverSource, onOpen }) => {
  const mark = cardMarkOf(card);
  const due = dueLabelOf(card);
  // ADR-040：负责人是平权集合，卡片要列出全部人（与任务中心、功能档案同一口径），
  // 头像取首位、姓名用「、」连接，空间不足时由 .tb-meta-name 省略并以 title 兑底全名单。
  const lead = card.assignees[0];
  const assigneeNames = card.assignees
    .map((assignee) => assignee.name)
    .join("、");
  return (
    <li>
      <button
        type="button"
        className={cardClassNameOf(card, leftoverSource)}
        onClick={() => onOpen(card)}
        aria-label={"打开任务 " + card.code + " " + card.title}
      >
        <span className="tb-card-top">
          <span className="tb-code">{card.code}</span>
          <span className="tb-card-flags">
            {leftoverSource ? (
              <span
                className={LEFTOVER_SOURCE_BADGE.className}
                title={LEFTOVER_SOURCE_BADGE.title}
              >
                {LEFTOVER_SOURCE_BADGE.label}
              </span>
            ) : null}
            {mark.kind === "done" ? (
              <span
                className="tb-check"
                title={mark.label}
                aria-label={mark.label}
              >
                ✓
              </span>
            ) : (
              <span className={"badge badge-" + mark.tone}>{mark.label}</span>
            )}
          </span>
        </span>
        <span className="tb-card-title">{card.title}</span>
        <span className="tb-card-meta">
          <span className="tb-meta-feature">
            {card.featureName ?? "模块级任务"}
          </span>
          {lead === undefined ? null : (
            <>
              <span className="tb-dot-sep">·</span>
              <span className={"tb-ava " + avatarToneOf(lead.userId)}>
                {avatarTextOf(lead.name)}
              </span>
              <span className="tb-meta-name" title={"负责人：" + assigneeNames}>
                {assigneeNames}
              </span>
            </>
          )}
          <span className={"tb-date tb-date--" + due.tone}>{due.text}</span>
        </span>
      </button>
    </li>
  );
};

const TaskBoardLane: React.FC<{
  readonly lane: TaskBoardModule;
  readonly collapsed: boolean;
  readonly leftoverIds: ReadonlySet<number>;
  readonly onToggle: () => void;
  readonly onOpenTask: (card: TaskBoardCard) => void;
}> = ({ lane, collapsed, leftoverIds, onToggle, onOpenTask }) => {
  const progress = laneProgressOf(lane);
  return (
    <article
      className={"tb-lane" + (collapsed ? " tb-lane--collapsed" : "")}
      aria-label={"模块 " + lane.name}
    >
      {" "}
      <header className="tb-lane-head" onClick={onToggle}>
        {/* 箭头按钮保留键盘焦点与可访问名；点击事件冒泡到整行头部统一切换。 */}
        <button
          type="button"
          className="tb-lane-toggle"
          aria-expanded={!collapsed}
          aria-label={(collapsed ? "展开模块 " : "折叠模块 ") + lane.name}
        >
          <InpulseIcon name="chevron" size={14} />
        </button>
        <span className={"tb-lane-icon " + laneToneOf(lane.moduleId)}>
          <InpulseIcon name="boxes" size={14} />
        </span>
        <div className="tb-lane-title">
          <h2>{lane.name}</h2>
          <p>
            {lane.featureCount} 个功能 · {lane.stats.total} 个任务 · 进行中{" "}
            {lane.stats.open}
          </p>
        </div>
        {lane.stats.overdue > 0 ? (
          <span className="tb-emergency">逾期 {lane.stats.overdue}</span>
        ) : null}
        <div className="tb-lane-spacer" />
        <div className="tb-lane-progress">
          <div className="tb-bar">
            <i
              className={progress.percent < 60 ? "low" : ""}
              style={{ width: progress.percent + "%" }}
            />
          </div>
          <b>
            {progress.done}/{progress.denominator}
          </b>
          <span>{progress.percent}%</span>
        </div>
        <div className="tb-lane-people">
          {lane.assignees.map((user) => (
            <span
              key={user.userId}
              className={"tb-avatar " + avatarToneOf(user.userId)}
              title={user.name}
            >
              {avatarTextOf(user.name)}
            </span>
          ))}
        </div>
      </header>
      {collapsed ? null : (
        <ul className="tb-lane-cards">
          {lane.tasks.map((card) => (
            <TaskBoardCardItem
              key={card.taskId}
              card={card}
              leftoverSource={leftoverIds.has(card.taskId)}
              onOpen={onOpenTask}
            />
          ))}
        </ul>
      )}
    </article>
  );
};

export const TaskBoardLanes: React.FC<TaskBoardLanesProps> = ({
  modules,
  collapsedIds,
  leftoverIds,
  onToggleLane,
  onOpenTask,
}) => {
  return (
    <div className="tb-board">
      {modules.map((lane) => (
        <TaskBoardLane
          key={lane.moduleId}
          lane={lane}
          collapsed={collapsedIds.has(lane.moduleId)}
          leftoverIds={leftoverIds}
          onToggle={() => onToggleLane(lane.moduleId)}
          onOpenTask={onOpenTask}
        />
      ))}
    </div>
  );
};
