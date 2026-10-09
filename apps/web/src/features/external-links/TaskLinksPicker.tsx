import React, { useEffect, useRef, useState } from "react";
import { Button, Checkbox, Input, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { CalmSkeleton } from "@features/common/components/CalmSkeleton";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import type { InpulseApiClient } from "@generated/api";
import { externalLinkKindLabel, previewLabel } from "./ExternalLinksPanel";

/**
 * 「把任务上已有的 GitHub 链接一起关联到即将产生的迭代记录」的小节。
 * 任务链接默认全部勾选，这里只记「取消勾选」的 id，清单晚到时新出现的链接
 * 因此同样默认参与；同一区块可再自己添加链接。最终清单由调用方决定何时写库。
 * `taskId` 为 0 表示没有来源任务（独立草稿）：只保留「自己添加」。
 */
export type TaskLinksSelection = {
  /** 要关联到迭代记录的完整清单（勾选的任务链接 ∪ 自己添加）。 */
  readonly urls: string[];
  /** 其中只在「自己添加」里出现的链接：调用方除记录外还要关联到来源任务。 */
  readonly addedUrls: string[];
};
/** 清单用换行拼串做比较，避免每次渲染都因数组引用变化重跑上报 effect。 */
const urlsOf = (signature: string) =>
  signature === "" ? [] : signature.split("\n");
export function TaskLinksPicker({
  api,
  taskId,
  disabled = false,
  hint,
  inputId,
  onSelectionChange,
  onPendingChange,
}: {
  api: InpulseApiClient;
  taskId: number;
  disabled?: boolean;
  hint: string;
  inputId: string;
  /** 选中清单变化时上报（任务链接勾选 ∪ 自己添加，去重后按稳定顺序）。 */
  onSelectionChange: (selection: TaskLinksSelection) => void;
  /** 有「自己添加或输入中还没落库」的内容时上报，供调用方做离开确认。 */
  onPendingChange?: ((pending: boolean) => void) | undefined;
}) {
  const [excludedLinks, setExcludedLinks] = useState<ReadonlySet<number>>(
      new Set(),
    ),
    [ownLinks, setOwnLinks] = useState<string[]>([]),
    [linkInput, setLinkInput] = useState(""),
    [linkError, setLinkError] = useState<string | null>(null),
    [expanded, setExpanded] = useState(false);
  const section = useRef<HTMLElement | null>(null),
    stagedCount = useRef(0);
  const canReadTaskLinks = taskId > 0;
  const taskLinks = useQuery({
    queryKey: ["task-external-links", taskId],
    queryFn: ({ signal }) => api.listExternalLinks("TASK", taskId, { signal }),
    enabled: canReadTaskLinks,
    retry: false,
  });
  const linkItems = canReadTaskLinks ? (taskLinks.data?.items ?? []) : [];
  const selectedCount = linkItems.filter(
    (link) => !excludedLinks.has(link.id),
  ).length;
  const selection = Array.from(
    new Set([
      ...linkItems
        .filter((link) => !excludedLinks.has(link.id))
        .map((link) => link.normalizedUrl),
      ...ownLinks,
    ]),
  );
  // 上报走「签名 + ref」：签名是纯字符串，避免每次渲染都因数组引用变化重跑 effect。
  const selectionSignature = selection.join("\n"),
    addedSignature = ownLinks.join("\n");
  const onSelection = useRef(onSelectionChange);
  onSelection.current = onSelectionChange;
  useEffect(() => {
    onSelection.current({
      urls: urlsOf(selectionSignature),
      addedUrls: urlsOf(addedSignature),
    });
  }, [selectionSignature, addedSignature]);
  const pending = ownLinks.length > 0 || linkInput.trim() !== "";
  const onPending = useRef(onPendingChange);
  onPending.current = onPendingChange;
  useEffect(() => {
    onPending.current?.(pending);
  }, [ownLinks.length, linkInput]);
  // 新增（或校验失败）后把新区块滚进视野：链接区在弹窗底部，不滚动会看不见结果。
  useEffect(() => {
    const grew = ownLinks.length > stagedCount.current;
    stagedCount.current = ownLinks.length;
    if (!grew && linkError === null) return;
    section.current?.scrollIntoView?.({ block: "end" });
  }, [ownLinks, linkError]);
  function toggleLink(linkId: number, checked: boolean) {
    const next = new Set(excludedLinks);
    if (checked) next.delete(linkId);
    else next.add(linkId);
    setExcludedLinks(next);
  }
  function addOwnLink() {
    const url = linkInput.trim();
    if (url === "") return;
    if (previewLabel(url) === null) {
      setLinkError("只接受 github.com 的 HTTPS 链接，请检查输入。");
      return;
    }
    if (selection.includes(url)) {
      setLinkError("这条链接已经在要关联的列表里。");
      return;
    }
    setOwnLinks([...ownLinks, url]);
    setLinkInput("");
    setLinkError(null);
  }
  return (
    <section
      ref={section}
      aria-label="GitHub 链接"
      className="completion-links"
    >
      <div className="completion-links-head">
        <h4 className="completion-links-title">GitHub 链接</h4>
        <span className="completion-links-hint">{hint}</span>
      </div>
      {canReadTaskLinks &&
        (taskLinks.isPending ? (
          <CalmSkeleton
            variant="lines"
            rows={1}
            compact
            label="正在加载任务链接"
          />
        ) : taskLinks.isError ? (
          <p className="completion-links-empty">
            任务上的链接读取失败，可在下方手动添加，或稍后在记录详情页补充。
          </p>
        ) : linkItems.length === 0 ? (
          <p className="completion-links-empty">
            该任务还没有 GitHub 链接，可在下方直接添加。
          </p>
        ) : (
          <>
            {/* 链接多时清单会把弹窗撑长，这里按「下拉框」收拢：触发器给计数，
                展开后才铺出可勾选行；默认全选的口径只记取消勾选的 id，因此晚到
                的链接照旧默认参与。 */}
            <button
              type="button"
              className="completion-links-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
            >
              <span className="completion-links-toggle-label">
                已选 {selectedCount} / {linkItems.length} 条任务链接
              </span>
              <InpulseIcon name="chevronDown" size={14} />
            </button>
            {expanded && (
              <ul className="completion-links-list">
                {linkItems.map((link) => (
                  <li key={link.id}>
                    <Checkbox
                      checked={!excludedLinks.has(link.id)}
                      disabled={disabled}
                      onChange={(event) =>
                        toggleLink(link.id, event.target.checked)
                      }
                    >
                      <Tag>{externalLinkKindLabel(link)}</Tag>
                      <span
                        className="completion-links-url"
                        title={link.normalizedUrl}
                      >
                        {link.normalizedUrl}
                      </span>
                    </Checkbox>
                  </li>
                ))}
              </ul>
            )}
          </>
        ))}
      <div className="completion-links-add">
        <Input
          id={inputId}
          aria-label="GitHub 链接地址"
          value={linkInput}
          maxLength={2048}
          disabled={disabled}
          placeholder="https://github.com/owner/repository/pull/123"
          onChange={(event) => {
            setLinkInput(event.target.value);
            if (linkError !== null) setLinkError(null);
          }}
          onPressEnter={(event) => {
            // 回车只暂存链接，不提交整个表单；只有框里没有待暂存内容时
            // 才把 Ctrl/Cmd + 回车让给表单级提交，避免刚输入的链接被丢掉。
            if ((event.ctrlKey || event.metaKey) && linkInput.trim() === "")
              return;
            event.preventDefault();
            addOwnLink();
          }}
        />
        <Button
          type="default"
          onClick={addOwnLink}
          disabled={disabled || linkInput.trim() === ""}
        >
          <InpulseIcon name="plus" size={14} />
          添加链接
        </Button>
      </div>
      {linkError !== null && (
        <span role="alert" className="completion-links-error">
          {linkError}
        </span>
      )}
      {ownLinks.length > 0 && (
        <ul className="completion-links-pending">
          {ownLinks.map((url) => (
            <li key={url}>
              <Tag>{previewLabel(url)}</Tag>
              <span className="completion-links-url" title={url}>
                {url}
              </span>
              <button
                type="button"
                className="text-button"
                aria-label={"移除 " + url}
                disabled={disabled}
                onClick={() => setOwnLinks(ownLinks.filter((e) => e !== url))}
              >
                移除
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
