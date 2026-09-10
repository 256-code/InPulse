import "./external-links.css";
import React, { useMemo, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Spin, Tag } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  createApiClient,
  type InpulseApiClient,
  type ExternalLinkList,
  type ExternalLinkTargetPath,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";
type TargetType = ExternalLinkTargetPath["targetType"];
export function ExternalLinksPanel({
  targetType,
  targetId,
  client,
}: {
  targetType: TargetType;
  targetId: number;
  client?: InpulseApiClient | undefined;
}) {
  const api = useMemo(() => client ?? createApiClient(), [client]),
    cache = useQueryClient();
  const [open, setOpen] = useState(false),
    [data, setData] = useState<ExternalLinkList | null>(null),
    [busy, setBusy] = useState(false),
    [url, setUrl] = useState(""),
    [error, setError] = useState<unknown>(null),
    [needsRefresh, setNeedsRefresh] = useState(false),
    [removeId, setRemoveId] = useState<number | null>(null);
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
          { url: url.trim() },
          init,
        );
      retry.current = null;
      setUrl("");
      setRemoveId(null);
      // The mutation has succeeded. Prevent stale resubmission even if the subsequent reload fails.
      setNeedsRefresh(true);
      for (const key of [
        "projects",
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
                ? "该链接已关联，请勿重复添加。"
                : "目标状态或版本已变化，请加载最新关联后重新确认。"
              : error.status === 422
                ? error.code === "SEARCH_TEXT_CAPACITY_EXCEEDED"
                  ? "正文与链接总量超过搜索容量，请精简正文或解除不需要的链接。"
                  : "链接无效：只接受 github.com 的 HTTPS 链接，请检查输入。"
                : error.status === 429
                  ? "操作频繁，请稍后重试。"
                  : "暂时无法操作，输入已保留，可重试。"
      : "暂时无法操作，输入已保留，可重试。";
  return (
    <>
      <Button
        onClick={() => {
          setOpen(true);
          if (!data && !needsRefresh) void load();
        }}
      >
        GitHub 链接
      </Button>
      <Modal
        title="GitHub 链接"
        open={open}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        closable={!busy}
        maskClosable={!busy}
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
                      {item.releaseTag
                        ? "Release"
                        : item.kind === "PULL_REQUEST"
                          ? "PR"
                          : item.kind}
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
