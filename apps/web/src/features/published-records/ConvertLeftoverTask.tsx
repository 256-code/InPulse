import React, { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Spin } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  type InpulseApiClient,
  type PublishedRecord,
  type LeftoverTaskPreview,
  type LeftoverTaskRequest,
  type LeftoverTaskResponse,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";
import { taskDetailPath } from "@features/tasks/task-links";
/** Match the task form's browser-local input and UTC API value, guarding invalid dates. */
export function parseFollowupDueAt(value: string): string | null | undefined {
  if (value === "") return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!parts) return undefined;
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.getFullYear() !== Number(parts[1]) ||
    date.getMonth() + 1 !== Number(parts[2]) ||
    date.getDate() !== Number(parts[3]) ||
    date.getHours() !== Number(parts[4]) ||
    date.getMinutes() !== Number(parts[5])
  )
    return undefined;
  return date.toISOString();
}
function message(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 409)
      return "记录、遗留项或影响功能已变化，请刷新预览并确认后重试。";
    if (error.status === 401) return "登录已失效，请重新登录。";
    if (error.status === 404) return "记录或任务不存在，或当前无法访问。";
    if (error.status === 403) return "请求未通过安全校验，请刷新后重试。";
    if (error.status === 422) return "请检查任务信息及负责人当前成员资格。";
    if (error.status === 429) return "操作过于频繁，请稍后使用相同请求重试。";
  }
  return "暂时无法转换，输入已保留，请重试。";
}
function Preview({ value }: { value: LeftoverTaskPreview }) {
  return (
    <section aria-label="遗留转换预览">
      <p>
        记录 v{value.recordVersion} · 稳定遗留项 #{value.leftoverItemId}
      </p>
      <p className="draft-content">{value.content || "当前版本没有遗留问题"}</p>
      <p>
        将继承的影响功能：
        {value.inheritedImpacts.map((f) => f.name).join("、") || "无"}
      </p>
      {value.excludedImpacts.length > 0 && (
        <p>
          历史归档影响不加入新任务：
          {value.excludedImpacts.map((f) => f.name).join("、")}
          。原记录历史保留。
        </p>
      )}
      {value.linkedTask && (
        <a href={taskDetailPath(value.linkedTask)}>查看已有跟进任务</a>
      )}
    </section>
  );
}
/**
 * 遗留转换的目标记录：只依赖转换所需字段，供已发布记录页与遗留问题页共用，
 * 不再要求调用方传入完整 PublishedRecord（也避免跨页面复制记录实体）。
 */
export interface LeftoverConvertTarget {
  readonly projectId: number;
  readonly moduleId: number;
  readonly featureId: number | null;
  readonly recordId: number;
  readonly recordTitle: string;
}

export interface LeftoverTaskConvertModalProps {
  readonly target: LeftoverConvertTarget;
  readonly api: InpulseApiClient;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onConverted: (result: LeftoverTaskResponse) => void;
}

/**
 * 转换弹窗：预览、归属范围与冲突处理完全沿用原实现；打开时重新加载预览并
 * 重置输入。所有写请求仍携带 CSRF、If-Match 与幂等键。
 */
export function LeftoverTaskConvertModal({
  target,
  api,
  open,
  onClose,
  onConverted,
}: LeftoverTaskConvertModalProps) {
  const cache = useQueryClient(),
    saving = useRef(false),
    retry = useRef<{ signature: string; key: string } | null>(null);
  const [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<LeftoverTaskPreview | null>(null),
    [latest, setLatest] = useState<LeftoverTaskPreview | null>(null),
    [error, setError] = useState<unknown>(null),
    [title, setTitle] = useState(""),
    [assigneeId, setAssignee] = useState(0),
    [dueInput, setDueInput] = useState(""),
    [dueBadInput, setDueBadInput] = useState(false),
    [priority, setPriority] =
      useState<LeftoverTaskRequest["priority"]>("NORMAL");
  const members = useQuery({
    queryKey: [
      "leftover-assignees",
      target.projectId,
      target.moduleId,
      target.featureId,
    ],
    queryFn: () =>
      target.featureId === null
        ? api.listModuleTaskAssignees(target.projectId, target.moduleId)
        : api.listTaskAssignees(
            target.projectId,
            target.moduleId,
            target.featureId,
          ),
    enabled: open,
    retry: false,
  });
  const [conflict, setConflict] = useState(false);
  const dueAt = parseFollowupDueAt(dueInput);
  const dueInvalid = dueBadInput || dueAt === undefined;
  async function load(initial: boolean) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const next = await api.previewLeftoverTask(
        target.projectId,
        target.recordId,
      );
      if (initial) {
        setPreview(next);
        setError(null);
      } else setLatest(next);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      saving.current = false;
    }
  }
  const scopeLabel = target.featureId === null ? "模块" : "功能";
  /**
   * 打开弹窗时重置输入并重新读取预览；关闭时保留输入，与转换前的行为一致。
   * 调用方在转换成功后关闭或卸载弹窗，由 onConverted 决定后续展示。
   */
  useEffect(() => {
    if (!open) return;
    setConflict(false);
    setPreview(null);
    setLatest(null);
    setError(null);
    setTitle((target.recordTitle + " · 遗留跟进").slice(0, 500));
    setAssignee(0);
    setDueInput("");
    setDueBadInput(false);
    setPriority("NORMAL");
    retry.current = null;
    void load(true);
  }, [open, target.recordId]);
  async function submit() {
    if (
      saving.current ||
      !preview ||
      preview.status !== "ACTIVE" ||
      !preview.content ||
      !title.trim() ||
      !assigneeId ||
      latest ||
      dueBadInput ||
      dueAt === undefined ||
      conflict
    )
      return;
    const body: LeftoverTaskRequest = {
        leftoverItemId: preview.leftoverItemId,
        recordVersion: preview.recordVersion,
        expectedRowVersion: preview.rowVersion,
        leftoverExpectedRowVersion: preview.leftoverRowVersion,
        expectedImpactFeatureIds: preview.inheritedImpacts.map((f) => f.id),
        title: title.trim(),
        assigneeId,
        priority,
        dueAt,
      },
      signature = JSON.stringify(body);
    if (retry.current?.signature !== signature)
      retry.current = { signature, key: createIdempotencyKey("leftover-task") };
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const csrf = await api.issueCsrfToken(),
        created = await api.convertLeftoverToTask(
          target.projectId,
          target.recordId,
          body,
          {
            headers: {
              "x-csrf-token": csrf.csrfToken,
              "If-Match": `"${body.expectedRowVersion}"`,
              "Idempotency-Key": retry.current.key,
            },
          },
        );
      onConverted(created);
      for (const key of [
        "leftover-items",
        "published-record",
        "published-records",
        "record-versions",
        "tasks",
        "task-history",
        "activity",
        "search",
        "notifications",
        "notifications-unread-count",
      ])
        void cache.invalidateQueries({ queryKey: [key] });
    } catch (e) {
      setError(e);
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      open={open}
      title="遗留问题转为新任务"
      footer={null}
      onCancel={() => {
        if (!saving.current) onClose();
      }}
      mask={{ closable: !busy }}
      closable={!busy}
    >
      <div className="catalog-form calm-form">
        {error !== null && <Alert type="error" title={message(error)} />}
        {busy && !preview && <Spin />}
        {preview && <Preview value={preview} />}
        {latest && (
          <section aria-label="最新转换预览">
            <h3>请确认最新遗留内容与影响功能</h3>
            <Preview value={latest} />
            <Button
              disabled={busy}
              onClick={() => {
                setPreview(latest);
                setLatest(null);
                setError(null);
                setConflict(false);
                retry.current = null;
              }}
            >
              确认使用最新预览
            </Button>
          </section>
        )}
        {conflict && !latest && (
          <Button disabled={busy} onClick={() => void load(false)}>
            刷新转换预览
          </Button>
        )}
        {!preview && !busy && error !== null && (
          <Button onClick={() => void load(true)}>重试加载预览</Button>
        )}
        <label htmlFor="leftover-task-title">跟进任务标题</label>
        <Input
          id="leftover-task-title"
          value={title}
          maxLength={500}
          disabled={busy}
          onChange={(e) => setTitle(e.target.value)}
        />
        <label htmlFor="leftover-task-assignee">跟进任务负责人</label>
        <select
          id="leftover-task-assignee"
          value={assigneeId}
          disabled={busy}
          onChange={(e) => setAssignee(Number(e.target.value))}
        >
          <option value={0}>请选择负责人</option>
          {members.data?.items.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        {members.isError && (
          <Alert
            type="error"
            title="成员列表加载失败"
            action={
              <Button onClick={() => void members.refetch()}>
                重试成员列表
              </Button>
            }
          />
        )}
        <label htmlFor="leftover-task-priority">跟进任务优先级</label>
        <select
          id="leftover-task-priority"
          value={priority}
          disabled={busy}
          onChange={(e) =>
            setPriority(e.target.value as LeftoverTaskRequest["priority"])
          }
        >
          <option value="LOW">低</option>
          <option value="NORMAL">普通</option>
          <option value="HIGH">高</option>
          <option value="URGENT">紧急</option>
        </select>
        <label htmlFor="leftover-task-due">跟进任务截止时间（选填）</label>
        <input
          id="leftover-task-due"
          type="datetime-local"
          value={dueInput}
          disabled={busy}
          aria-invalid={dueInvalid}
          aria-describedby={dueInvalid ? "leftover-task-due-error" : undefined}
          onChange={(event) => {
            setDueInput(event.target.value);
            setDueBadInput(event.target.validity.badInput);
          }}
        />
        {dueInvalid && (
          <p id="leftover-task-due-error" role="alert">
            请输入有效的截止时间，或清空以不设置。
          </p>
        )}
        <p>
          新任务保持原记录的{scopeLabel}
          范围，初始为待办，说明自动保存本次遗留原文与来源版本。
        </p>
        <Button
          type="primary"
          loading={busy}
          disabled={
            !preview ||
            !preview.content ||
            preview.status !== "ACTIVE" ||
            !title.trim() ||
            !assigneeId ||
            dueInvalid ||
            !!latest ||
            conflict ||
            members.isError
          }
          onClick={() => void submit()}
        >
          创建跟进任务
        </Button>
      </div>
    </Modal>
  );
}

/**
 * 已发布记录页的触发按钮：保持原有「已转换显示链接、否则显示按钮」的行为，
 * 逻辑全部复用转换弹窗。
 */
export function ConvertLeftoverTask({
  item,
  api,
  writable,
}: {
  item: PublishedRecord;
  api: InpulseApiClient;
  writable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<LeftoverTaskResponse | null>(null);
  const linked =
    result ??
    (item.leftoverItem?.linkedTaskId
      ? {
          projectId: item.projectId,
          moduleId: item.moduleId,
          featureId: item.featureId,
          taskId: item.leftoverItem.linkedTaskId,
        }
      : null);
  return (
    <>
      {linked ? (
        <a href={taskDetailPath(linked)}>查看跟进任务</a>
      ) : (
        item.leftoverItem?.status === "ACTIVE" &&
        item.leftovers.some((l) => l.id === item.leftoverItem?.id) && (
          <Button disabled={!writable} onClick={() => setOpen(true)}>
            转为新任务
          </Button>
        )
      )}
      <LeftoverTaskConvertModal
        target={{
          projectId: item.projectId,
          moduleId: item.moduleId,
          featureId: item.featureId,
          recordId: item.id,
          recordTitle: item.title,
        }}
        api={api}
        open={open}
        onClose={() => setOpen(false)}
        onConverted={(created) => {
          setResult(created);
          setOpen(false);
        }}
      />
    </>
  );
}
