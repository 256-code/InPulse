import React, { useRef, useState } from "react";
import { Alert, Button, Input } from "antd";
import {
  ApiError,
  type InpulseApiClient,
  type PublishedRecord,
} from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { createIdempotencyKey } from "@shared/api/idempotency-key";

/**
 * 详情页快捷追加遗留问题：不再改写整段正文，服务端仍会形成一次记录版本，
 * 因此同样携带 CSRF、If-Match、X-Record-Version 与幂等键。
 */
export function AppendLeftoverForm({
  item,
  api,
  writable,
  onAdded,
}: {
  readonly item: PublishedRecord;
  readonly api: InpulseApiClient;
  readonly writable: boolean;
  readonly onAdded: () => void;
}) {
  const [open, setOpen] = useState(false),
    [content, setContent] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null),
    saving = useRef(false);
  const trimmed = content.trim();
  const ready = trimmed.length > 0 && content.length <= 10000;
  const conflict = error instanceof ApiError && error.status === 409;
  async function submit() {
    if (!writable || !ready || busy || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const body = { content: trimmed },
        signature = JSON.stringify([
          item.id,
          item.rowVersion,
          item.currentVersion,
          body,
        ]);
      if (retry.current?.signature !== signature)
        retry.current = {
          signature,
          key: createIdempotencyKey("record-leftover"),
        };
      const csrf = await api.issueCsrfToken();
      await api.addChangeRecordLeftover(item.projectId, item.id, body, {
        headers: {
          "x-csrf-token": csrf.csrfToken,
          "If-Match": `"${item.rowVersion}"`,
          "X-Record-Version": String(item.currentVersion),
          "Idempotency-Key": retry.current.key,
        },
      });
      retry.current = null;
      setContent("");
      setOpen(false);
      onAdded();
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status === 409) onAdded();
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function close() {
    setOpen(false);
    setError(null);
  }
  return (
    <div className="leftover-append">
      {open ? (
        <div className="leftover-append-panel">
          <div className="leftover-append-head">
            <strong>追加遗留问题</strong>
            <button
              type="button"
              className="leftover-append-close"
              aria-label="取消追加遗留问题"
              disabled={busy}
              onClick={close}
            >
              ×
            </button>
          </div>
          <Input.TextArea
            aria-label="追加遗留问题内容"
            rows={3}
            maxLength={10000}
            disabled={busy}
            placeholder="写清问题现象与影响范围，保存后成为新版本的一条遗留问题。"
            value={content}
            onChange={(event) => setContent(event.target.value)}
          />
          {!!error && (
            <Alert
              type="error"
              title={
                error instanceof ApiError
                  ? `${error.message} 输入已保留。`
                  : "暂时无法追加，输入已保留，可重试。"
              }
              action={
                conflict ? (
                  <Button size="small" disabled={busy} onClick={onAdded}>
                    刷新最新版本
                  </Button>
                ) : undefined
              }
            />
          )}
          <div className="leftover-append-foot">
            <span>
              {content.length}/10000 ·
              追加会生成新版本，并按修订规则通知相关人。
            </span>
            <div className="leftover-append-actions">
              <Button size="small" disabled={busy} onClick={close}>
                取消
              </Button>
              <Button
                type="primary"
                size="small"
                loading={busy}
                disabled={!writable || !ready}
                onClick={() => void submit()}
              >
                保存为新版本
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="leftover-append-trigger"
          disabled={!writable}
          onClick={() => setOpen(true)}
        >
          <InpulseIcon name="plus" size={14} />
          追加遗留问题
        </button>
      )}
    </div>
  );
}
