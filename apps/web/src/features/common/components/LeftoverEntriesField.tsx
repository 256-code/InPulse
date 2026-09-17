import { Button, Input } from "antd";
import type { LeftoverEntry } from "@features/record-drafts/record-content";
import "./leftover-entries.css";

/**
 * 遗留问题多条编辑：草稿、任务完成与正式修订三处共用。
 * 已转任务（CONVERTED）的条目锁定不可移除，保证任务链接与记录始终对得上。
 */
export function LeftoverEntriesField({
  value,
  onChange,
  disabled = false,
  lockedIds = [],
  label = "遗留问题",
}: {
  readonly value: readonly LeftoverEntry[];
  readonly onChange: (entries: LeftoverEntry[]) => void;
  readonly disabled?: boolean | undefined;
  readonly lockedIds?: readonly number[] | undefined;
  readonly label?: string | undefined;
}) {
  const replace = (index: number, content: string) =>
    onChange(
      value.map((entry, position) =>
        position === index ? { ...entry, content } : entry,
      ),
    );
  const remove = (index: number) =>
    onChange(value.filter((_, position) => position !== index));
  const locked = (entry: LeftoverEntry) =>
    entry.id !== undefined && lockedIds.includes(entry.id);
  return (
    <div className="leftover-entries">
      {value.map((entry, index) => (
        <div className="leftover-entry" key={entry.id ?? `new-${index}`}>
          <Input.TextArea
            aria-label={`${label} ${index + 1}`}
            rows={3}
            maxLength={10000}
            disabled={disabled}
            value={entry.content}
            onChange={(event) => replace(index, event.target.value)}
          />
          {locked(entry) ? (
            <span className="leftover-entry-lock">已转任务，保留关联</span>
          ) : (
            <Button
              htmlType="button"
              aria-label="移除"
              size="small"
              disabled={disabled}
              onClick={() => remove(index)}
            >
              移除
            </Button>
          )}
        </div>
      ))}
      {value.length === 0 && (
        <span className="leftover-entry-empty">暂无遗留问题。</span>
      )}
      <div className="leftover-entry-actions">
        <Button
          htmlType="button"
          aria-label="添加遗留问题"
          size="small"
          disabled={disabled || value.length >= 50}
          onClick={() => onChange([...value, { content: "" }])}
        >
          添加遗留问题
        </Button>
        <span>最多 50 条，每条最多 10000 字符。</span>
      </div>
    </div>
  );
}
