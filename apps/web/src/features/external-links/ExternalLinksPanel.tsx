import "./external-links.css";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Checkbox, Input, Spin, Tag } from "antd";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type InpulseApiClient,
  type ExternalLinkItem,
  type ExternalLinkList,
  type ExternalLinkTargetPath,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";
type TargetType = ExternalLinkTargetPath["targetType"];
/** 设计师稿 github-links 的徽章文案：先看 Release 标记，再看链接类型。 */
export function externalLinkKindLabel(item: ExternalLinkItem): string {
  return item.releaseTag
    ? "Release"
    : item.kind === "PULL_REQUEST"
      ? "PR"
      : item.kind === "ISSUE"
        ? "Issue"
        : item.kind === "COMMIT"
          ? "Commit"
          : "链接";
}
export function ExternalLinksPanel({
  targetType,
  targetId,
  client,
  variant = "button",
  triggerClassName,
}: {
  targetType: TargetType;
  targetId: number;
  client?: InpulseApiClient | undefined;
  /** `inline` 按设计师稿在页面内直接展示列表与新增表单；`button` 保持弹层形态。 */
  variant?: "button" | "inline";
  /** `button` 形态下触发按钮的样式类，用于融入所在页面的动作区。 */
  triggerClassName?: string | undefined;
}) {
  const api = useMemo(() => client ?? createApiClient(), [client]),
    cache = useQueryClient();
  const [open, setOpen] = useState(false),
    [data, setData] = useState<ExternalLinkList | null>(null),
    [busy, setBusy] = useState(false),
    [url, setUrl] = useState(""),
    [error, setError] = useState<unknown>(null),
    [needsRefresh, setNeedsRefresh] = useState(false),
    [removeId, setRemoveId] = useState<number | null>(null),
    [adding, setAdding] = useState(false);
  const [isRootRepository, setIsRootRepository] = useState(false);
  const saving = useRef(false),
    retry = useRef<{ signature: string; key: string } | null>(null);
  async function load() {
    setBusy(true);
    try {
      const latest = await api.listExternalLinks(targetType, targetId);
      setData(latest);
      setNeedsRefresh(false);
      setError(null);
      retry.current = null;
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && [401, 403, 404].includes(e.status))
        setData(null);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (
      saving.current ||
      busy ||
      needsRefresh ||
      !data?.writable ||
      (!removeId && !url.trim())
    )
      return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const signature = JSON.stringify([
        targetType,
        targetId,
        data.rowVersion,
        removeId,
        url.trim(),
        isRootRepository,
      ]);
      if (retry.current?.signature !== signature)
        retry.current = {
          signature,
          key: createIdempotencyKey("external-link"),
        };
      const csrf = await api.issueCsrfToken(),
        init = {
          headers: {
            "x-csrf-token": csrf.csrfToken,
            "If-Match": `"${data.rowVersion}"`,
            "Idempotency-Key": retry.current.key,
          },
        };
      if (removeId)
        await api.removeExternalLink(targetType, targetId, removeId, init);
      else
        await api.addExternalLink(
          targetType,
          targetId,
          {
            url: url.trim(),
            ...(targetType === "PROJECT" ? { isRootRepository } : {}),
          },
          init,
        );
      retry.current = null;
      setUrl("");
      setIsRootRepository(false);
      setRemoveId(null);
      setAdding(false);
      // The mutation has succeeded. Prevent stale resubmission even if the subsequent reload fails.
      setNeedsRefresh(true);
      for (const key of [
        "projects",
        "project-repository",
        "features",
        "tasks",
        "record-drafts",
        "record-draft",
        "published-records",
        "published-record",
        "task-record-drafts",
        "search",
        "activity",
        "activity-center",
      ])
        void cache.invalidateQueries({ queryKey: [key] });
      await load();
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status === 409) setNeedsRefresh(true);
      if (e instanceof ApiError && [401, 403, 404].includes(e.status))
        setData(null);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  const message =
    error instanceof ApiError
      ? error.status === 401
        ? "登录已失效，请重新登录。"
        : error.status === 403
          ? "当前操作未获授权，请刷新后重试。"
          : error.status === 404
            ? "目标不存在或当前无法访问。"
            : error.status === 409
              ? error.code === "EXTERNAL_LINK_ALREADY_ASSOCIATED"
                ? isRootRepository
                  ? "该链接及根仓库设置已存在。"
                  : "该链接已关联，请勿重复添加。"
                : "目标状态或版本已变化，请加载最新关联后重新确认。"
              : error.status === 422
                ? error.code === "SEARCH_TEXT_CAPACITY_EXCEEDED"
                  ? "正文与链接总量超过搜索容量，请精简正文或解除不需要的链接。"
                  : "链接无效：只接受 github.com 的 HTTPS 链接，请检查输入。"
                : error.status === 429
                  ? "操作频繁，请稍后重试。"
                  : "暂时无法操作，输入已保留，可重试。"
      : "暂时无法操作，输入已保留，可重试。";
  const inline = variant === "inline";
  useEffect(() => {
    if (inline) void load();
    // 目标或形态变化时重新加载，等价于弹层形态的「打开即加载」。
  }, [inline, targetType, targetId]);
  const addForm = removeId ? (
    <div className="calm-action-footer">
      <p>确认解除此链接的当前关联？</p>
      <Button disabled={busy} onClick={() => setRemoveId(null)}>
        取消解除
      </Button>
      <Button
        danger
        disabled={busy || needsRefresh}
        onClick={() => void save()}
      >
        确认解除关联
      </Button>
    </div>
  ) : (
    <>
      <label htmlFor={`external-link-url-${targetType}-${targetId}`}>
        GitHub URL
      </label>
      <Input
        id={`external-link-url-${targetType}-${targetId}`}
        value={url}
        maxLength={2048}
        disabled={busy}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://github.com/owner/repository/pull/123"
      />
      {targetType === "PROJECT" && (
        <Checkbox
          checked={isRootRepository}
          disabled={busy}
          onChange={(e) => setIsRootRepository(e.target.checked)}
        >
          设为项目根仓库（可填写已有链接以切换）
        </Checkbox>
      )}
      {url.trim() && (
        <p role="status">
          {previewLabel(url)
            ? "识别为：" + previewLabel(url)
            : "请输入有效的 GitHub HTTPS URL"}
        </p>
      )}
      <Button
        type="primary"
        disabled={busy || needsRefresh || !url.trim()}
        onClick={() => void save()}
      >
        确认添加
      </Button>
    </>
  );
  /** 内联形态的操作区：解除确认优先于新增表单，与设计师稿的展开式一致。 */
  const inlineActions =
    removeId !== null || adding ? (
      <div className="github-add">{addForm}</div>
    ) : (
      <button
        type="button"
        className="text-button"
        disabled={busy || needsRefresh}
        onClick={() => setAdding(true)}
      >
        <InpulseIcon name="plus" size={14} />
        添加 GitHub 链接
      </button>
    );
  if (inline)
    return (
      <div className="github-block">
        {!data && busy && <Spin />}
        {error !== null && <Alert type="error" title={message} />}
        {!data && !busy && (
          <Button disabled={busy} onClick={() => void load()}>
            加载最新关联
          </Button>
        )}
        {data &&
          (data.items.length === 0 ? (
            <p className="muted">
              尚未关联 GitHub。系统只保存 HTTPS
              链接，不抓取远程内容，也不会自动改变任务状态。
            </p>
          ) : (
            <ul className="github-list">
              {data.items.map((item) => (
                <li key={item.id}>
                  <Tag>
                    {item.isRootRepository
                      ? "项目根仓库"
                      : externalLinkKindLabel(item)}
                  </Tag>
                  <a
                    href={item.normalizedUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {item.label}
                    <InpulseIcon name="externalLink" size={13} />
                  </a>
                  {item.externalNumber ? (
                    <code>{item.externalNumber}</code>
                  ) : null}
                  {data.writable && (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={"解除 " + item.label}
                      disabled={busy || needsRefresh}
                      onClick={() => setRemoveId(item.id)}
                    >
                      <InpulseIcon name="x" size={15} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ))}
        {data?.writable && inlineActions}
      </div>
    );
  return (
    <>
      <Button
        {...(triggerClassName === undefined
          ? {}
          : { className: triggerClassName })}
        onClick={() => {
          setOpen(true);
          if (!data && !needsRefresh) void load();
        }}
      >
        GitHub 链接
      </Button>
      <Modal
        className="catalog-modal"
        eyebrow="保存代码证据，可关联多个链接"
        title="GitHub 链接"
        open={open}
        body
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        closable={!busy}
        mask={{ closable: !busy }}
        footer={
          <Button disabled={busy} onClick={() => setOpen(false)}>
            关闭关联
          </Button>
        }
      >
        <p>保存代码证据，可关联多个链接。</p>
        {busy && <Spin />}
        {error !== null && <Alert type="error" title={message} />}
        {(needsRefresh || (!data && !busy)) && (
          <Button disabled={busy} onClick={() => void load()}>
            加载最新关联
          </Button>
        )}
        {data && (
          <>
            <p>
              当前版本 {data.rowVersion}
              {!data.writable ? " · 只读" : ""}
            </p>
            {data.items.length === 0 ? (
              <p>暂无 GitHub 链接</p>
            ) : (
              <ul className="external-links-list">
                {data.items.map((item) => (
                  <li key={item.id}>
                    <Tag>
                      {item.isRootRepository
                        ? "项目根仓库"
                        : externalLinkKindLabel(item)}
                    </Tag>{" "}
                    <a
                      href={item.normalizedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {item.label}
                    </a>
                    <p>{item.normalizedUrl}</p>
                    {data.writable && (
                      <Button
                        disabled={busy || needsRefresh}
                        onClick={() => setRemoveId(item.id)}
                        aria-label={"解除 " + item.label}
                      >
                        解除关联
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {data.writable &&
              (removeId ? (
                <>
                  <p>确认解除此链接的当前关联？</p>
                  <Button disabled={busy} onClick={() => setRemoveId(null)}>
                    取消解除
                  </Button>
                  <Button
                    danger
                    disabled={busy || needsRefresh}
                    onClick={() => void save()}
                  >
                    确认解除关联
                  </Button>
                </>
              ) : (
                <>
                  <label
                    htmlFor={`external-link-url-${targetType}-${targetId}`}
                  >
                    GitHub URL
                  </label>
                  <Input
                    id={`external-link-url-${targetType}-${targetId}`}
                    value={url}
                    maxLength={2048}
                    disabled={busy}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://github.com/owner/repository/pull/123"
                  />
                  {targetType === "PROJECT" && (
                    <Checkbox
                      checked={isRootRepository}
                      disabled={busy}
                      onChange={(e) => setIsRootRepository(e.target.checked)}
                    >
                      设为项目根仓库（可填写已有链接以切换）
                    </Checkbox>
                  )}
                  {url.trim() && (
                    <p role="status">
                      {previewLabel(url)
                        ? "识别为：" + previewLabel(url)
                        : "请输入有效的 GitHub HTTPS URL"}
                    </p>
                  )}
                  <Button
                    type="primary"
                    disabled={busy || needsRefresh || !url.trim()}
                    onClick={() => void save()}
                  >
                    确认添加
                  </Button>
                </>
              ))}
          </>
        )}
      </Modal>
    </>
  );
}
function previewLabel(raw: string): string | null {
  try {
    const parsed = new URL(raw.trim());
    if (
      parsed.protocol !== "https:" ||
      parsed.hostname !== "github.com" ||
      parsed.username ||
      parsed.password ||
      parsed.port
    )
      return null;
    const parts = parsed.pathname
        .split("/")
        .filter(Boolean)
        .map(decodeURIComponent),
      reference = parts[3];
    if (parts[2] === "issues" && reference && /^[1-9][0-9]*$/.test(reference))
      return "Issue #" + reference;
    if (parts[2] === "pull" && reference && /^[1-9][0-9]*$/.test(reference))
      return "PR #" + reference;
    if (
      parts[2] === "commit" &&
      reference &&
      /^[a-f0-9]{7,64}$/i.test(reference)
    )
      return "Commit " + reference.toLowerCase().slice(0, 12);
    if (parts[2] === "releases" && parts[3] === "tag" && parts[4])
      return "Release " + parts.slice(4).join("/");
    return parts.length >= 2 ? parts[0] + "/" + parts[1] : "GitHub";
  } catch {
    return null;
  }
}
