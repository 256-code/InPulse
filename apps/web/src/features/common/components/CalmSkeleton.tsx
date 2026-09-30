import React from "react";

import "./calm-skeleton.css";

/**
 * 内容骨架屏（2026-09-30「质感改造 · 第一批」）。
 *
 * 替换原先的「转圈 + 正在加载…」等待态：等待期间先把内容的**形状**画出来，
 * 数据回来时只是把骨架换成真内容，页面高度不跳、观感不塌。
 *
 * 三条口径（改动前请先读）：
 * 1. **只在首屏没有数据时用骨架**（TanStack Query 的 `isPending`）。已经有数据、
 *    只是后台刷新（`isFetching`）时必须继续显示旧数据——否则每次切筛选都闪一次骨架，
 *    比原来更糟。调用点因此直接沿用各页面已有的 `isPending` 分支，不新增判断。
 * 2. **容器尺寸沿用被替换的 `.calm-state`**（1px 边框 + 10px 圆角 + 白底 +
 *    `min-height: 140px`，compact 为 82px）。这样即使哪天骨架换成别的形态，页面高度也不变。
 * 3. **读屏文案不丢**：原等待态里的「正在加载项目列表」这类文案不是装饰，是读屏用户
 *    唯一的提示。换成骨架后由 `label` 承接，渲染成 `.sr-only` 并由 `role="status"`
 *    承载；骨架图形本身 `aria-hidden`，不参与朗读。
 */

export type CalmSkeletonVariant =
  /** 头像 + 两行 + 右侧徽章，用于任务 / 成员 / 通知这类列表。 */
  | "list"
  /** 多张并列小卡，用于项目、概览这类卡片网格。 */
  | "card"
  /** 表头 + 若干行，用于表格。 */
  | "table"
  /** 圆点 + 竖线，用于动态、状态历史这类时间线。 */
  | "timeline"
  /** 纯文本行，用于详情正文、弹窗里的段落。 */
  | "lines";

export interface CalmSkeletonProps {
  readonly variant?: CalmSkeletonVariant;
  readonly rows?: number;
  /** 弹窗、下拉等窄区域：内边距与最小高度都收一档。 */
  readonly compact?: boolean;
  /**
   * 底色语境：`surface` 是内容区的白卡（默认）；`sidebar` 用于深色侧栏里的项目树，
   * 去掉卡片描边、占位块改成半透明白，避免在深蓝底上出现一块白板。
   */
  readonly tone?: "surface" | "sidebar";
  /** 视觉隐藏的读屏文案；沿用被替换文案的原文。 */
  readonly label?: string;
  readonly className?: string;
}

const DEFAULT_ROWS = 3;

/** 行数向下取整并保证至少 1 行：调用方传 0 或负数时不至于渲染出空壳。 */
function rowIndexes(rows: number): readonly number[] {
  return Array.from(
    { length: Math.max(1, Math.trunc(rows)) },
    (_item, index) => index,
  );
}

const ListRow: React.FC<{ readonly index: number }> = ({ index }) => (
  <div className="calm-sk-row">
    <span
      className={"calm-sk calm-sk-avatar" + (index % 2 === 1 ? " alt" : "")}
    />
    <span className="calm-sk-lines">
      <span className="calm-sk calm-sk-title" />
      <span className="calm-sk calm-sk-text" />
    </span>
    <span className="calm-sk calm-sk-badge" />
  </div>
);

const CardBox: React.FC = () => (
  <div className="calm-sk-card">
    <span className="calm-sk calm-sk-title" />
    <span className="calm-sk calm-sk-text" />
    <span className="calm-sk calm-sk-text short" />
  </div>
);

const TableRow: React.FC = () => (
  <div className="calm-sk-tr">
    <span className="calm-sk calm-sk-td c1" />
    <span className="calm-sk calm-sk-td c2" />
    <span className="calm-sk calm-sk-td c3" />
    <span className="calm-sk calm-sk-td c4" />
  </div>
);

const TimelineItem: React.FC = () => (
  <div className="calm-sk-tl-item">
    <span className="calm-sk-rail">
      <span className="calm-sk calm-sk-dot" />
      <span className="calm-sk-rail-line" />
    </span>
    <span className="calm-sk-lines">
      <span className="calm-sk calm-sk-title" />
      <span className="calm-sk calm-sk-text" />
    </span>
  </div>
);

const Line: React.FC<{ readonly index: number }> = ({ index }) => (
  <span
    className={"calm-sk calm-sk-line" + (index % 3 === 1 ? " short" : "")}
  />
);

function body(variant: CalmSkeletonVariant, rows: number): React.ReactNode {
  const indexes = rowIndexes(rows);
  switch (variant) {
    case "card":
      return (
        <div className="calm-sk-cards">
          {indexes.slice(0, 3).map((index) => (
            <CardBox key={index} />
          ))}
        </div>
      );
    case "table":
      return (
        <div className="calm-sk-table">
          <div className="calm-sk-thead">
            <span className="calm-sk calm-sk-td c1" />
            <span className="calm-sk calm-sk-td c2" />
            <span className="calm-sk calm-sk-td c3" />
            <span className="calm-sk calm-sk-td c4" />
          </div>
          {indexes.map((index) => (
            <TableRow key={index} />
          ))}
        </div>
      );
    case "timeline":
      return (
        <div className="calm-sk-tl">
          {indexes.map((index) => (
            <TimelineItem key={index} />
          ))}
        </div>
      );
    case "lines":
      return (
        <div className="calm-sk-lines-block">
          {indexes.map((index) => (
            <Line key={index} index={index} />
          ))}
        </div>
      );
    case "list":
    default:
      return (
        <div className="calm-sk-list">
          {indexes.map((index) => (
            <ListRow key={index} index={index} />
          ))}
        </div>
      );
  }
}

export const CalmSkeleton: React.FC<CalmSkeletonProps> = ({
  variant = "list",
  rows = DEFAULT_ROWS,
  compact,
  tone = "surface",
  label,
  className,
}) => (
  <div
    className={[
      "calm-skeleton",
      compact === true ? "is-compact" : "",
      tone === "sidebar" ? "is-sidebar" : "",
      className ?? "",
    ]
      .filter((item) => item !== "")
      .join(" ")}
    role="status"
    data-testid="calm-skeleton"
  >
    {label === undefined ? null : <span className="sr-only">{label}</span>}
    <div className="calm-skeleton-body" aria-hidden="true">
      {body(variant, rows)}
    </div>
  </div>
);

export default CalmSkeleton;
