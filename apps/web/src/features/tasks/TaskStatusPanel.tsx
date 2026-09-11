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
import { CompleteWithRecord } from "./CompleteWithRecord";

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

/**
 * C-3：任务状态操作弹窗（完成任务 / 重新打开 / 取消任务 / 恢复任务）与状态历史。
 * 与设计师稿 task-modal 一致，触发按钮由父级动作行渲染；本组件只保留弹窗、
 * 提交流程和「状态历史」区块。父级在每次打开时更换 key，输入、冲突状态与
 * 幂等重试键随重新挂载回到初始状态，取消后再次打开不会沿用上一次的内容。
 */
export function TaskStatusPanel({
  item,
  api,
  writable,
  action,
  onClose,
}: {
  item: TaskViewItem;
  api: InpulseApiClient;
  writable: boolean;
  action: TaskStatusRequest["action"] | null;
  onClose: () => void;
}) {
  const cache = useQueryClient();
  const [base, setBase] = useState(item);
  const [publishedId, setPublishedId] = useState<number | null>(null);
  const [recordBusy, setRecordBusy] = useState(false);
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
      if (command.action === "COMPLETE") {
        const { action: _action, ...input } = command;
        return (
          await api.completeTask(
            base.id,
            { ...input, expectedRowVersion: base.rowVersion },
            init,
          )
        ).task;
      }
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
      onClose();
      await Promise.all(
        ["tasks", "task-history", "activity", "search", "notifications"].map(
          (key) => cache.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });
  const conflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;
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
    <section className="task-status-section" aria-label="任务状态历史">
      {publishedId !== null && (
        <p className="task-status-published">
          <a
            href={`/records?view=published&projectId=${item.projectId}&publishedId=${publishedId}`}
          >
            查看已发布记录
          </a>
        </p>
      )}
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
          if (!saving.current && !reloading && !recordBusy) onClose();
        }}
        mask={{ closable: !mutation.isPending && !reloading && !recordBusy }}
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
                  disabled={recordBusy}
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
                <CompleteWithRecord
                  item={base}
                  api={api}
                  writable={writable}
                  onBusyChange={setRecordBusy}
                  onSuccess={(record) => {
                    setPublishedId(record.id);
                    onClose();
                  }}
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
          {actualChange !== "yes" && (
            <>
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
            </>
          )}
        </form>
      </Modal>
    </section>
  );
}
