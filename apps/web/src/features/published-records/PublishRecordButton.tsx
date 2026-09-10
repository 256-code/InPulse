import React, { useRef, useState } from "react";
import { Alert, Button, Modal } from "antd";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  type InpulseApiClient,
  type RecordDraftItem,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";
export function PublishRecordButton({
  item,
  api,
  writable,
}: {
  item: RecordDraftItem;
  api: InpulseApiClient;
  writable: boolean;
}) {
  const cache = useQueryClient(),
    navigate = useNavigate();
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null),
    saving = useRef(false);
  const target = `/records?view=published&projectId=${item.projectId}&publishedId=${item.id}`;
  async function publish() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const signature = `${item.id}:${item.rowVersion}`;
      if (retry.current?.signature !== signature)
        retry.current = {
          signature,
          key: createIdempotencyKey("record-publish"),
        };
      const csrf = await api.issueCsrfToken();
      const value = await api.publishChangeRecord(
        item.projectId,
        item.id,
        {},
        {
          headers: {
            "x-csrf-token": csrf.csrfToken,
            "If-Match": `"${item.rowVersion}"`,
            "Idempotency-Key": retry.current.key,
          },
        },
      );
      cache.setQueryData(["published-record", item.projectId, item.id], value);
      await cache.invalidateQueries({
        queryKey: ["record-drafts", item.projectId],
      });
      await cache.invalidateQueries({
        queryKey: ["task-record-drafts", item.projectId],
      });
      await cache.invalidateQueries({
        queryKey: ["published-records", item.projectId],
      });
      setOpen(false);
      navigate(target);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      saving.current = false;
    }
  }
  async function reload() {
    setBusy(true);
    try {
      const latest = await api.getRecordDraft(item.projectId, item.id);
      cache.setQueryData(["record-draft", item.projectId, item.id], latest);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        disabled={!writable}
        onClick={() => {
          setOpen(true);
          setError(null);
        }}
      >
        发布记录
      </Button>
      <Modal
        open={open}
        title="发布迭代记录"
        footer={null}
        onCancel={() => {
          if (!busy) setOpen(false);
        }}
        mask={{ closable: !busy }}
      >
        <p>
          发布“{item.title}”并生成正式编号与 v1。之后的内容修订会保留为新版本。
        </p>
        <p>
          发布时遗留问题最多10000字符，完整正文需满足发布容量；超限会保留草稿并提示调整。有关联任务时，该任务须已完成。
        </p>
        {!!error && (
          <Alert
            type="error"
            title={
              error instanceof ApiError
                ? error.message
                : "服务暂时不可用，草稿已保留，可重试。"
            }
          />
        )}
        {error instanceof ApiError &&
        error.code === "RECORD_ALREADY_PUBLISHED" ? (
          <a href={target}>打开已发布记录</a>
        ) : (
          error instanceof ApiError &&
          error.code === "RECORD_VERSION_CONFLICT" && (
            <Button disabled={busy} onClick={() => void reload()}>
              加载最新草稿
            </Button>
          )
        )}
        <div className="calm-action-footer">
          <Button
            type="primary"
            loading={busy}
            disabled={
              !writable || (error instanceof ApiError && error.status === 409)
            }
            onClick={() => void publish()}
          >
            确认发布
          </Button>
        </div>
      </Modal>
    </>
  );
}
