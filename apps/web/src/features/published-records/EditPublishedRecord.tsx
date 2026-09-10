import React, { useRef, useState } from "react";
import { Alert, Button, Input, Modal } from "antd";
import { Controller, useForm, useWatch } from "react-hook-form";
import { useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  type InpulseApiClient,
  type PublishedRecord,
  type RecordDraftContent,
} from "@generated/api";
import {
  fields,
  labels,
  mergeRecordDraft,
  recordContent,
  type Field,
} from "@features/record-drafts/record-content";
import { createIdempotencyKey } from "@shared/api/idempotency-key";
type Merge = ReturnType<typeof mergeRecordDraft> & {
  latest: PublishedRecord;
  choices: Partial<Record<Field, "mine" | "latest">>;
};
export function EditPublishedRecord({
  item,
  api,
  writable,
}: {
  item: PublishedRecord;
  api: InpulseApiClient;
  writable: boolean;
}) {
  const cache = useQueryClient();
  const [baseline, setBaseline] = useState<PublishedRecord | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [confirmed, setConfirmed] = useState(false),
    [merge, setMerge] = useState<Merge | null>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null),
    saving = useRef(false);
  const {
    control,
    handleSubmit,
    reset,
    getValues,
    formState: { errors },
  } = useForm<RecordDraftContent>({ defaultValues: recordContent(item) });
  const remaining = useWatch({ control, name: "remainingIssues" });
  const needsConfirmation =
    baseline?.leftoverItem?.status === "ACTIVE" && !remaining.trim();
  const conflict = error instanceof ApiError && error.status === 409;
  function open() {
    setBaseline(item);
    reset(recordContent(item));
    setConfirmed(false);
    setMerge(null);
    setError(null);
  }
  async function reload() {
    if (!baseline) return;
    setBusy(true);
    try {
      const latest = await api.getChangeRecord(item.projectId, item.id);
      if (latest.status !== "PUBLISHED")
        throw new ApiError(409, {
          code: "RECORD_STATE_CONFLICT",
          message: "记录已作废，请关闭编辑并刷新",
          details: {},
          requestId: "",
        });
      const result = mergeRecordDraft(
        recordContent(baseline),
        getValues(),
        recordContent(latest),
      );
      setConfirmed(false);
      if (result.conflicts.length) setMerge({ ...result, latest, choices: {} });
      else {
        setBaseline(latest);
        reset(result.values);
        setError(null);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function apply() {
    if (!merge || merge.conflicts.some((f) => !merge.choices[f])) return;
    const values = { ...merge.values };
    for (const field of merge.conflicts)
      if (merge.choices[field] === "latest")
        values[field] = merge.latest[field];
    setBaseline(merge.latest);
    reset(values);
    setMerge(null);
    setError(null);
  }
  const save = handleSubmit(async (values) => {
    if (
      !baseline ||
      saving.current ||
      conflict ||
      merge ||
      !writable ||
      (needsConfirmation && !confirmed)
    )
      return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const body = {
        ...(Object.fromEntries(
          fields.map((f) => [f, values[f].trim()]),
        ) as RecordDraftContent),
        confirmLeftoverResolved: confirmed,
      };
      const signature = JSON.stringify([
        baseline.id,
        baseline.rowVersion,
        baseline.currentVersion,
        body,
      ]);
      if (retry.current?.signature !== signature)
        retry.current = {
          signature,
          key: createIdempotencyKey("record-version"),
        };
      const csrf = await api.issueCsrfToken();
      const result = await api.createChangeRecordVersion(
        item.projectId,
        item.id,
        body,
        {
          headers: {
            "x-csrf-token": csrf.csrfToken,
            "If-Match": `"${baseline.rowVersion}"`,
            "X-Record-Version": String(baseline.currentVersion),
            "Idempotency-Key": retry.current.key,
          },
        },
      );
      cache.setQueryData(["published-record", item.projectId, item.id], result);
      await cache.invalidateQueries({
        queryKey: ["record-versions", item.projectId, item.id],
      });
      await cache.invalidateQueries({
        queryKey: ["published-records", item.projectId],
      });
      setBaseline(null);
      retry.current = null;
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      saving.current = false;
    }
  });
  return (
    <>
      <Button disabled={!writable} onClick={open}>
        修订内容
      </Button>
      <Modal
        open={baseline !== null}
        title="修订迭代记录"
        className="catalog-modal"
        footer={null}
        onCancel={() => {
          if (!busy) setBaseline(null);
        }}
        mask={{ closable: !busy }}
      >
        <form className="catalog-form calm-form" onSubmit={(e) => void save(e)}>
          <p>
            保存为 v{(baseline?.currentVersion ?? item.currentVersion) + 1}
            ，旧版本保持不变。新的独立功能变化请新建记录。
          </p>
          {!!error && (
            <Alert
              type="error"
              title={
                error instanceof ApiError
                  ? `${error.message} 输入已保留。`
                  : "服务暂时不可用，输入已保留，可重试。"
              }
            />
          )}
          {conflict &&
            error instanceof ApiError &&
            error.code === "RECORD_VERSION_CONFLICT" && (
              <Button disabled={busy} onClick={() => void reload()}>
                加载最新版本并合并
              </Button>
            )}
          {merge && (
            <section aria-label="版本冲突">
              <p>双方都修改了以下内容，请逐项选择。</p>
              {merge.conflicts.map((field) => (
                <label key={field}>
                  {labels[field]}冲突
                  <select
                    value={merge.choices[field] ?? ""}
                    onChange={(e) =>
                      setMerge({
                        ...merge,
                        choices: {
                          ...merge.choices,
                          [field]: e.target.value as "mine" | "latest",
                        },
                      })
                    }
                  >
                    <option value="">请选择</option>
                    <option value="mine">保留我的输入</option>
                    <option value="latest">采用最新内容</option>
                  </select>
                  <p className="draft-content">
                    最新内容：{merge.latest[field]}
                  </p>
                </label>
              ))}
              <Button
                disabled={merge.conflicts.some((f) => !merge.choices[f])}
                onClick={apply}
              >
                应用合并
              </Button>
            </section>
          )}
          {fields.map((field) => (
            <label key={field}>
              {labels[field]}
              <Controller
                name={field}
                control={control}
                rules={{
                  validate: (v) =>
                    field === "remainingIssues" ||
                    v.trim().length > 0 ||
                    "请填写此项",
                  maxLength:
                    field === "title"
                      ? 500
                      : field === "remainingIssues"
                        ? 10000
                        : 50000,
                }}
                render={({ field: input }) =>
                  field === "title" ? (
                    <Input
                      {...input}
                      aria-label={labels[field]}
                      maxLength={500}
                    />
                  ) : (
                    <Input.TextArea
                      {...input}
                      aria-label={labels[field]}
                      rows={4}
                      maxLength={field === "remainingIssues" ? 10000 : 50000}
                    />
                  )
                }
              />
              {errors[field] && (
                <span role="alert">
                  {errors[field]?.message || "内容超过长度限制"}
                </span>
              )}
            </label>
          ))}
          {needsConfirmation && (
            <label>
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              确认遗留问题已解决，清空本版本内容
            </label>
          )}
          {baseline?.leftoverItem?.status === "CONVERTED" && (
            <p>
              此遗留项已转为跟进任务，修订或清空文字仍保留原任务关联。新的独立问题请新建记录。
            </p>
          )}
          <p>
            遗留问题最多10000字符。超出完整正文的发布容量时会保留输入并提示调整。
          </p>
          <div className="calm-action-footer">
            <Button
              htmlType="submit"
              type="primary"
              loading={busy}
              disabled={
                !writable ||
                conflict ||
                !!merge ||
                (needsConfirmation && !confirmed)
              }
            >
              保存新版本
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
