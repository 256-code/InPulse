import React, { useRef, useState } from "react";
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
const taskPath = (task: {
  projectId: number;
  moduleId: number;
  featureId: number | null;
  taskId: number;
}) =>
  `/projects/${task.projectId}/modules/${task.moduleId}${task.featureId === null ? "/tasks" : `/features/${task.featureId}`}?taskId=${task.taskId}`;
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
        <a href={taskPath(value.linkedTask)}>查看已有跟进任务</a>
      )}
    </section>
  );
}
export function ConvertLeftoverTask({
  item,
  api,
  writable,
}: {
  item: PublishedRecord;
  api: InpulseApiClient;
  writable: boolean;
}) {
  const cache = useQueryClient(),
    saving = useRef(false),
    retry = useRef<{ signature: string; key: string } | null>(null);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<LeftoverTaskPreview | null>(null),
    [latest, setLatest] = useState<LeftoverTaskPreview | null>(null),
    [error, setError] = useState<unknown>(null),
    [title, setTitle] = useState(""),
    [assigneeId, setAssignee] = useState(0),
    [priority, setPriority] =
      useState<LeftoverTaskRequest["priority"]>("NORMAL"),
    [result, setResult] = useState<LeftoverTaskResponse | null>(null);
  const members = useQuery({
    queryKey: [
      "leftover-assignees",
      item.projectId,
      item.moduleId,
      item.featureId,
    ],
    queryFn: () =>
      item.featureId === null
        ? api.listModuleTaskAssignees(item.projectId, item.moduleId)
        : api.listTaskAssignees(item.projectId, item.moduleId, item.featureId),
    enabled: open,
    retry: false,
  });
  const [conflict, setConflict] = useState(false);
  async function load(initial: boolean) {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    try {
      const next = await api.previewLeftoverTask(item.projectId, item.id);
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
  function start() {
    setConflict(false);
    setOpen(true);
    setPreview(null);
    setLatest(null);
    setError(null);
    setTitle((item.title + " · 遗留跟进").slice(0, 500));
    setAssignee(0);
    setPriority("NORMAL");
    retry.current = null;
    void load(true);
  }
  async function submit() {
    if (
      saving.current ||
      !preview ||
      preview.status !== "ACTIVE" ||
      !preview.content ||
      !title.trim() ||
      !assigneeId ||
      latest ||
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
        dueAt: null,
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
          item.projectId,
          item.id,
          body,
          {
            headers: {
              "x-csrf-token": csrf.csrfToken,
              "If-Match": `"${body.expectedRowVersion}"`,
              "Idempotency-Key": retry.current.key,
            },
          },
        );
      setResult(created);
      setOpen(false);
      for (const key of [
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
        <a href={taskPath(linked)}>查看跟进任务</a>
      ) : (
        item.leftoverItem?.status === "ACTIVE" &&
        item.leftovers.some((l) => l.id === item.leftoverItem?.id) && (
          <Button disabled={!writable} onClick={start}>
            转为新任务
          </Button>
        )
      )}
      <Modal
        open={open}
        title="遗留问题转为新任务"
        footer={null}
        onCancel={() => {
          if (!saving.current) setOpen(false);
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
          <p>
            新任务保持原记录的{item.scopeType === "MODULE" ? "模块" : "功能"}
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
    </>
  );
}
