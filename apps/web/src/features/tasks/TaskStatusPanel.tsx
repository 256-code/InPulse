import React, { useRef, useState } from "react";
import { Alert, Button, Input, Modal, Spin } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  type InpulseApiClient,
  type TaskStatusRequest,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";
import { taskError, type TaskViewItem } from "./task-query";

const labels = {
  COMPLETE: "完成任务",
  REOPEN: "重新打开",
  CANCEL: "取消任务",
  RESTORE: "恢复任务",
};
const statuses = { TODO: "未完成", DONE: "已完成", CANCELED: "已取消" };
const requiredStatus = {
  COMPLETE: "TODO",
  REOPEN: "DONE",
  CANCEL: "TODO",
  RESTORE: "CANCELED",
};
const reasons = [
  "测试验证",
  "技术调研",
  "文档补充",
  "环境配置",
  "沟通协调",
  "其他",
] as const;
const time = (value: string) =>
  new Date(value).toLocaleString("zh-CN", { hour12: false });

export function TaskStatusPanel({
  item,
  api,
  writable,
}: {
  item: TaskViewItem;
  api: InpulseApiClient;
  writable: boolean;
}) {
  const cache = useQueryClient();
  const [action, setAction] = useState<TaskStatusRequest["action"] | null>(
    null,
  );
  const [base, setBase] = useState(item);
  const [actualChange, setActualChange] = useState<"" | "yes" | "no">("");
  const [reason, setReason] = useState<(typeof reasons)[number]>("测试验证");
  const [note, setNote] = useState("");
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const saving = useRef(false);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const history = useQuery({
    queryKey: ["task-history", item.projectId, item.id, item.rowVersion],
    queryFn: ({ signal }) =>
      item.featureId === null
        ? api.getModuleTaskStatusHistory(
            item.projectId,
            item.moduleId,
            item.id,
            { signal },
          )
        : api.getTaskStatusHistory(
            item.projectId,
            item.moduleId,
            item.featureId,
            item.id,
            { signal },
          ),
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async (command: TaskStatusRequest) => {
      const signature = JSON.stringify([base.id, base.rowVersion, command]);
      if (retry.current?.signature !== signature)
        retry.current = { signature, key: createIdempotencyKey("task-status") };
      const csrf = await api.issueCsrfToken();
      const init = {
        headers: {
          "x-csrf-token": csrf.csrfToken,
          "Idempotency-Key": retry.current.key,
          "If-Match": `"${base.rowVersion}"`,
        },
      };
      return base.featureId === null
        ? api.transitionModuleTask(
            base.projectId,
            base.moduleId,
            base.id,
            command,
            init,
          )
        : api.transitionTask(
            base.projectId,
            base.moduleId,
            base.featureId,
            base.id,
            command,
            init,
          );
    },
    retry: false,
    onSuccess: async () => {
      retry.current = null;
      setAction(null);
      await Promise.all(
        ["tasks", "task-history", "activity", "search", "notifications"].map(
          (key) => cache.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });
  const conflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;
  const open = (next: TaskStatusRequest["action"]) => {
    setAction(next);
    setBase(item);
    setActualChange("");
    setNote("");
    setReason("测试验证");
    setReloadError(null);
    mutation.reset();
  };
  const reload = async () => {
    setReloading(true);
    try {
      const latest =
        base.featureId === null
          ? await api.getModuleTask(base.projectId, base.moduleId, base.id)
          : await api.getTask(
              base.projectId,
              base.moduleId,
              base.featureId,
              base.id,
            );
      setBase(latest);
      if (
        mutation.error instanceof ApiError &&
        mutation.error.code === "TASK_PARENT_ARCHIVED"
      )
        setReloadError("所属项目、模块或功能已归档，输入已保留，当前只读。");
      else {
        setReloadError(null);
        mutation.reset();
      }
    } catch (error) {
      setReloadError(taskError(error));
    } finally {
      setReloading(false);
    }
  };
  const invalidState =
    action !== null &&
    (base.lifecycleStatus !== "ACTIVE" ||
      requiredStatus[action] !== base.workStatus);
  const disabled =
    !writable ||
    mutation.isPending ||
    reloading ||
    conflict ||
    !!reloadError ||
    invalidState ||
    (action === "COMPLETE" && actualChange !== "no");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!action || disabled || saving.current) return;
    saving.current = true;
    try {
      await mutation.mutateAsync(
        action === "COMPLETE"
          ? {
              action,
              mode: "WITHOUT_RECORD",
              completionReason: reason,
              note: note.trim(),
            }
          : { action, reason: note.trim() || null },
      );
    } catch {
      /* Preserve the user's input and retry key. */
    } finally {
      saving.current = false;
    }
  };
  return (
    <section aria-label="任务状态与历史">
      <div className="calm-action-footer">
        {(item.workStatus === "TODO"
          ? (["COMPLETE", "CANCEL"] as const)
          : item.workStatus === "DONE"
            ? (["REOPEN"] as const)
            : (["RESTORE"] as const)
        ).map((next) => (
          <Button
            key={next}
            className="secondary-button"
            disabled={!writable || item.lifecycleStatus !== "ACTIVE"}
            onClick={() => open(next)}
          >
            {labels[next]}
          </Button>
        ))}
      </div>
      <h3>状态历史</h3>
      {history.isPending ? (
        <Spin />
      ) : history.isError ? (
        <Alert
          type="error"
          title={taskError(history.error)}
          action={
            <Button onClick={() => void history.refetch()}>重试状态历史</Button>
          }
        />
      ) : (
        <ol className="task-status-history">
          {history.data.items.map((entry) => (
            <li key={entry.id}>
              <strong>
                {entry.fromWorkStatus === null
                  ? "创建"
                  : statuses[entry.fromWorkStatus]}{" "}
                → {statuses[entry.toWorkStatus]}
              </strong>
              <p>
                {time(entry.changedAt)} · 操作人 #{entry.changedBy}
              </p>
              {entry.completedAtSnapshot && (
                <p>完成时间快照：{time(entry.completedAtSnapshot)}</p>
              )}
              {entry.completionNoteSnapshot && (
                <p>完成说明：{entry.completionNoteSnapshot}</p>
              )}
              {entry.reason && <p>原因：{entry.reason}</p>}
            </li>
          ))}
        </ol>
      )}
      <Modal
        open={action !== null}
        title={action ? labels[action] : "任务状态"}
        className="catalog-modal"
        footer={null}
        onCancel={() => {
          if (!saving.current && !reloading) setAction(null);
        }}
        mask={{ closable: !mutation.isPending && !reloading }}
      >
        <form
          className="catalog-form calm-form"
          onSubmit={(event) => void submit(event)}
        >
          {mutation.isError && (
            <Alert type="error" title={taskError(mutation.error)} />
          )}
          {reloadError && <Alert type="warning" title={reloadError} />}
          {conflict && (
            <Button loading={reloading} onClick={() => void reload()}>
              加载最新任务状态
            </Button>
          )}
          {invalidState && (
            <Alert
              type="warning"
              title={`最新状态为${statuses[base.workStatus]}，无法继续此操作。说明已保留。`}
            />
          )}
          {action === "COMPLETE" && (
            <>
              <label>
                是否产生实际功能变化
                <select
                  value={actualChange}
                  onChange={(e) =>
                    setActualChange(e.target.value as typeof actualChange)
                  }
                >
                  <option value="">请选择</option>
                  <option value="yes">是，需要迭代记录</option>
                  <option value="no">否，仅完成任务</option>
                </select>
              </label>
              {actualChange === "yes" && (
                <Alert
                  type="info"
                  title="产生功能变化的任务需要发布迭代记录后一起完成，此功能尚未开放。任务将保持未完成。"
                />
              )}
              {actualChange === "no" && (
                <label>
                  完成原因
                  <select
                    value={reason}
                    onChange={(e) => setReason(e.target.value as typeof reason)}
                  >
                    {reasons.map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
          <label>
            {action === "COMPLETE" ? "完成补充说明" : "操作原因（选填）"}
            <Input.TextArea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={action === "COMPLETE" ? 9800 : 10000}
              rows={3}
            />
          </label>
          <div className="calm-action-footer">
            <Button
              htmlType="submit"
              className="primary-button"
              loading={mutation.isPending}
              disabled={disabled}
            >
              确认{action ? labels[action] : "操作"}
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
