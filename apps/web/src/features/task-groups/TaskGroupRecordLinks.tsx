import React, { useState } from "react";
import type { TaskGroupRecordLink } from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";

/** 链接类型中文名：记录行与作废回退共用同一套文案。 */
function linkKindLabel(kind: TaskGroupRecordLink["kind"]): string {
  if (kind === "PULL_REQUEST") return "Pull Request";
  if (kind === "ISSUE") return "Issue";
  if (kind === "COMMIT") return "Commit";
  return "链接";
}

/** 链接定位摘要：类型 + 仓库（含外部编号）+ 短 SHA。 */
function linkLabel(link: TaskGroupRecordLink): string {
  const repository =
    link.repository === null
      ? ""
      : " · " +
        link.repository +
        (link.externalNumber === null ? "" : " #" + link.externalNumber);
  const sha =
    link.externalSha === null ? "" : " · " + link.externalSha.slice(0, 7);
  return linkKindLabel(link.kind) + repository + sha;
}

export interface TaskGroupRecordLinksProps {
  readonly recordId: number;
  readonly links: readonly TaskGroupRecordLink[];
  /**
   * 作废记录的正文对成员不可读，链接快照是弹窗里唯一可读内容，故默认展开；
   * 记录行内保持收起，避免长列表把记录本身淹没。
   */
  readonly defaultExpanded?: boolean;
}

/**
 * 记录卡片内的外部关联（PR / Issue / Commit）：默认收起，展开状态属于展示层，
 * 不进入 URL 与查询键。
 */
export const TaskGroupRecordLinks: React.FC<TaskGroupRecordLinksProps> = ({
  recordId,
  links,
  defaultExpanded = false,
}) => {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const listId = "task-group-record-links-" + recordId;
  return (
    <div className="task-group-record-links-block">
      <button
        type="button"
        className="task-group-record-links-toggle"
        data-testid={"task-group-record-links-toggle-" + recordId}
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
      >
        <InpulseIcon
          name="chevron"
          size={13}
          {...(expanded ? { className: "expanded" } : {})}
        />
        {"关联记录 " + links.length}
      </button>
      {expanded ? (
        <ul className="task-group-record-links" id={listId}>
          {links.map((link) => (
            <li key={link.linkId}>
              <a href={link.displayUrl} target="_blank" rel="noreferrer">
                <InpulseIcon name="externalLink" size={13} />
                {linkLabel(link)}
              </a>
              <small data-testid={"task-group-link-snapshot-" + link.linkId}>
                {"快照：" +
                  (link.titleSnapshot ?? link.displayUrl) +
                  (link.stateSnapshot === null
                    ? ""
                    : " · " + link.stateSnapshot)}
              </small>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
};

export default TaskGroupRecordLinks;
