import React, { useRef, useState } from "react";
import { Alert, Button, Input, Spin } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { useRecordDraftsQuery } from "@features/record-drafts/record-drafts-query";
import {
  ApiError,
  type InpulseApiClient,
  type RecordDraftItem,
  type RecordDraftContent,
  type TaskCompletionRequest,
  type PublishedRecord,
} from "@generated/api";
import { fields, labels } from "@features/record-drafts/record-content";
import { createIdempotencyKey } from "@shared/api/idempotency-key";
import type { TaskViewItem } from "./task-query";
export function CompleteWithRecord({
  item,
  api,
  writable,
  onSuccess,
  onBusyChange,
}: {
  item: TaskViewItem;
  api: InpulseApiClient;
  writable: boolean;
  onSuccess: (record: PublishedRecord) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const cache = useQueryClient(),
    [base, setBase] = useState(item),
    [mode, setMode] = useState<"inline" | "draft">("inline"),
    [selected, setSelected] = useState<RecordDraftItem | null>(null),
    [latest, setLatest] = useState<RecordDraftItem | null>(null),
    [content, setContent] = useState<RecordDraftContent>({
      title: item.title,
      contextProblem: "",
      changeSolution: "",
      resultVerification: "",
      remainingIssues: "",
    }),
    [error, setError] = useState<unknown>(null),
    [busy, setBusyState] = useState(false);
  const setBusy = (value: boolean) => {
    setBusyState(value);
    onBusyChange?.(value);
  };
  const retry = useRef<{ signature: string; key: string } | null>(null),
    saving = useRef(false);
  const drafts = useRecordDraftsQuery({
    client: api,
    projectId: item.projectId,
    enabled: mode === "draft",
  });
  const draftItems =
    drafts.data?.pages.flatMap((page) => [...page.items]) ?? [];
  const choices = draftItems.filter(
    (record) =>
      record.moduleId === item.moduleId &&
      record.featureId === item.featureId &&
      (record.taskId === null || record.taskId === item.id),
  );
  const conflict = error instanceof ApiError && error.status === 409;
  const disabled =
    !writable ||
    busy ||
    conflict ||
    base.workStatus !== "TODO" ||
    base.lifecycleStatus !== "ACTIVE" ||
    (mode === "draft"
      ? !selected
      : fields.some(
          (field) =>
            (field !== "remainingIssues" && !content[field].trim()) ||
            content[field].length >
              (field === "title"
                ? 500
                : field === "remainingIssues"
                  ? 10000
                  : 50000),
        ));
  async function reload() {
    setBusy(true);
    try {
      const task =
        base.featureId === null
          ? await api.getModuleTask(base.projectId, base.moduleId, base.id)
          : await api.getTask(
              base.projectId,
              base.moduleId,
              base.featureId,
              base.id,
            );
      setBase(task);
      if (selected) {
        const record = await api.getRecordDraft(base.projectId, selected.id);
        setLatest(record);
      } else setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (disabled || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const body: TaskCompletionRequest =
        mode === "draft"
          ? {
              mode: "WITH_RECORD",
              expectedRowVersion: base.rowVersion,
              recordDraftId: selected!.id,
              recordExpectedRowVersion: selected!.rowVersion,
            }
          : {
              mode: "WITH_RECORD",
              expectedRowVersion: base.rowVersion,
              record: Object.fromEntries(
                fields.map((field) => [field, content[field].trim()]),
              ) as RecordDraftContent,
            };
      const signature = JSON.stringify([base.id, body]);
      if (retry.current?.signature !== signature)
        retry.current = {
          signature,
          key: createIdempotencyKey("task-completion"),
        };
      const csrf = await api.issueCsrfToken();
      const result = await api.completeTask(base.id, body, {
        headers: {
          "x-csrf-token": csrf.csrfToken,
          "If-Match": `"${base.rowVersion}"`,
          "Idempotency-Key": retry.current.key,
        },
      });
      if (result.record) {
        cache.setQueryData(
          ["published-record", base.projectId, result.record.id],
          result.record,
        );
        await Promise.all(
          [
            "tasks",
            "task-history",
            "record-drafts",
            "task-record-drafts",
            "published-records",
            "activity",
            "search",
            "notifications",
          ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
        );
        onSuccess(result.record);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      saving.current = false;
    }
  }
  return (
    <section aria-label="发布并完成">
      <p>任务完成与记录发布会一起保存；任何一步失败均保留原状态。</p>
      <a
        href={`/records?projectId=${base.projectId}&moduleId=${base.moduleId}&taskId=${base.id}`}
      >
        选择或新建草稿
      </a>
      <label>
        记录来源
        <select
          disabled={busy}
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as typeof mode);
            setError(null);
            setLatest(null);
          }}
        >
          <option value="inline">填写新记录</option>
          <option value="draft">选择已有草稿</option>
        </select>
      </label>
      {!!error && (
        <Alert
          type="error"
          title={
            error instanceof ApiError
              ? `${error.message} 输入和选择已保留。`
              : "服务暂时不可用，输入和选择已保留，可重试。"
          }
        />
      )}
      {conflict && (
        <Button disabled={busy} onClick={() => void reload()}>
          加载最新任务和草稿
        </Button>
      )}
      {base.workStatus !== "TODO" && (
        <Alert
          type="warning"
          title="任务已不再是待办状态，不能再次完成；输入已保留。"
        />
      )}
      {latest && (
        <section aria-label="最新草稿预览">
          <h4>
            最新草稿：{latest.title}（版本 {latest.rowVersion}）
          </h4>
          {fields
            .filter((field) => field !== "title")
            .map((field) => (
              <p className="draft-content" key={field}>
                {labels[field]}：{latest[field] || "（空）"}
              </p>
            ))}
          <Button
            disabled={busy}
            onClick={() => {
              setSelected(latest);
              setLatest(null);
              setError(null);
            }}
          >
            确认使用最新草稿
          </Button>
        </section>
      )}
      {mode === "inline" ? (
        fields.map((field) => (
          <label key={field}>
            {labels[field]}
            {field === "title" ? (
              <Input
                disabled={busy}
                aria-label={labels[field]}
                value={content[field]}
                maxLength={500}
                onChange={(e) =>
                  setContent({ ...content, [field]: e.target.value })
                }
              />
            ) : (
              <Input.TextArea
                disabled={busy}
                aria-label={labels[field]}
                rows={3}
                value={content[field]}
                maxLength={field === "remainingIssues" ? 10000 : 50000}
                onChange={(e) =>
                  setContent({ ...content, [field]: e.target.value })
                }
              />
            )}
          </label>
        ))
      ) : (
        <>
          {drafts.isPending ? (
            <Spin />
          ) : drafts.isError ? (
            <Alert
              type="error"
              title="暂时无法读取草稿"
              action={
                <Button onClick={() => void drafts.refetch()}>重试草稿</Button>
              }
            />
          ) : (
            <label>
              待发布草稿
              <select
                disabled={busy}
                value={selected?.id ?? ""}
                onChange={(e) => {
                  setSelected(
                    choices.find(
                      (record) => record.id === Number(e.target.value),
                    ) ?? null,
                  );
                  setLatest(null);
                }}
              >
                <option value="">请选择一条草稿</option>
                {choices.map((record) => (
                  <option key={record.id} value={record.id}>
                    {record.title} · 草稿 #{record.id} · 版本{" "}
                    {record.rowVersion}
                  </option>
                ))}
              </select>
              {drafts.hasNextPage && (
                <div className="record-load-more">
                  <Button
                    disabled={drafts.isFetchingNextPage}
                    onClick={() => void drafts.fetchNextPage()}
                  >
                    {drafts.isFetchingNextPage ? "正在加载…" : "加载更多"}
                  </Button>
                </div>
              )}
            </label>
          )}
          {selected && (
            <section aria-label="所选草稿内容">
              {fields.map((field) => (
                <p className="draft-content" key={field}>
                  {labels[field]}：{selected[field] || "（空）"}
                </p>
              ))}
              <a
                href={`/records?projectId=${base.projectId}&recordId=${selected.id}${selected.taskId === null ? "" : `&moduleId=${base.moduleId}&taskId=${base.id}`}`}
              >
                打开草稿继续编辑
              </a>
            </section>
          )}
        </>
      )}
      <p>遗留问题最多10000字符，完整正文超出发布容量时保留输入并提示调整。</p>
      <Button
        type="primary"
        loading={busy}
        disabled={disabled}
        onClick={() => void submit()}
      >
        发布并完成任务
      </Button>
    </section>
  );
}
