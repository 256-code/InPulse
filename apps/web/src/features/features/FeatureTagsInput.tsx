import React, { useEffect, useRef, useState } from "react";

import { InpulseIcon } from "@features/common/components/InpulseIcon";

/** 与 `FeatureEditRequest` 的 `tags.max(50)` 对齐；超出时控件直接拒绝，不再等到 422。 */
export const FEATURE_TAG_LIMIT = 50;

const splitTags = (value: string): string[] =>
  value
    .split("\n")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);

/**
 * 功能标签的胶囊输入（2026-10-12 按产品给出的形态改造）：
 * 已有标签是深色胶囊、内置移除按钮；虚线的「＋ 新标签」展开行内输入，
 * 回车或失焦提交、Esc 取消。表单值仍是换行分隔的字符串，冲突合并与
 * 幂等摘要比较无需感知控件形态。
 */
export const FeatureTagsInput: React.FC<{
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly inputId: string;
  readonly disabled?: boolean;
}> = ({ value, onChange, inputId, disabled = false }) => {
  const tags = splitTags(value);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [limitReached, setLimitReached] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreAddFocus = useRef(false);

  useEffect(() => {
    if (adding) {
      inputRef.current?.focus();
      return;
    }
    if (restoreAddFocus.current) {
      restoreAddFocus.current = false;
      addButtonRef.current?.focus();
    }
  }, [adding]);

  const resetDraft = () => {
    setDraft("");
    setLimitReached(false);
  };

  /** 提交当前草稿；返回 true 表示草稿已收尾、可以关闭输入。 */
  const commit = (): boolean => {
    const tag = draft.trim();
    if (tag.length === 0 || tags.includes(tag)) {
      resetDraft();
      return true;
    }
    if (tags.length >= FEATURE_TAG_LIMIT) {
      setLimitReached(true);
      return false;
    }
    onChange([...tags, tag].join("\n"));
    resetDraft();
    return true;
  };

  const close = () => {
    resetDraft();
    restoreAddFocus.current = true;
    setAdding(false);
  };

  return (
    <div className="feature-tags">
      <div className="feature-tag-row">
        {tags.map((tag) => (
          <span className="feature-tag-pill" key={tag}>
            {tag}
            <button
              type="button"
              className="feature-tag-remove"
              aria-label={`移除标签 ${tag}`}
              disabled={disabled}
              onClick={() =>
                onChange(tags.filter((current) => current !== tag).join("\n"))
              }
            >
              <InpulseIcon name="x" size={11} />
            </button>
          </span>
        ))}
        {adding ? (
          <input
            id={inputId}
            ref={inputRef}
            className="feature-tag-entry"
            value={draft}
            placeholder="输入后按回车"
            disabled={disabled}
            onChange={(event) => {
              setDraft(event.target.value);
              setLimitReached(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commit();
              } else if (event.key === "Escape") {
                event.preventDefault();
                close();
              }
            }}
            onBlur={() => {
              if (commit()) close();
            }}
          />
        ) : (
          <button
            type="button"
            ref={addButtonRef}
            className="feature-tag-add"
            disabled={disabled}
            onClick={() => setAdding(true)}
          >
            <InpulseIcon name="plus" size={13} />
            新标签
          </button>
        )}
      </div>
      {limitReached && (
        <p className="feature-tag-limit" role="alert">
          标签最多 {FEATURE_TAG_LIMIT} 个。
        </p>
      )}
    </div>
  );
};
