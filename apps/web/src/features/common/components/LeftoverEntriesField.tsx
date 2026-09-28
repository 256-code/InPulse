import { Button, Input } from "antd";
import type { LeftoverEntry } from "@features/record-drafts/record-content";
import "./leftover-entries.css";

/**
 * 遗留问题多条编辑：草稿、任务完成与正式修订三处共用。
 * 标题行右侧是「添加遗留问题」；没有条目时直接渲染一个空文本域（不再显示空态文案），
 * 首次输入即落成第一条；已转任务（CONVERTED）的条目锁定不可移除，保证任务链接与记录始终对得上。
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
  // 空态用一个占位文本域兜底：首次输入即成为真实的第一条，所以它不带「移除」。
  const placeholder = value.length === 0;
  const entries: readonly LeftoverEntry[] = placeholder
    ? [{ content: "" }]
    : value;
  return (
    <div className="leftover-field">
      <div className="leftover-field-head">
        <span className="leftover-field-label">{label}</span>
        <Button
          htmlType="button"
          aria-label="添加遗留问题"
          size="small"
          disabled={disabled || value.length >= 50}
          onClick={() => onChange([...value, { content: "" }])}
        >
          添加遗留问题
        </Button>
      </div>
      <div className="leftover-entries">
        {entries.map((entry, index) => (
          <div className="leftover-entry" key={entry.id ?? `new-${index}`}>
            <Input.TextArea
              aria-label={`${label} ${index + 1}`}
              rows={3}
              maxLength={10000}
              disabled={disabled}
              value={entry.content}
              onChange={(event) =>
                placeholder
                  ? onChange([{ content: event.target.value }])
                  : replace(index, event.target.value)
              }
            />
            {!placeholder &&
              (locked(entry) ? (
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
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}
