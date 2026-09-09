import React, { useRef, useState } from "react";
import { Alert, Button, Drawer, Input, Modal, Spin } from "antd";
import { Controller, useForm } from "react-hook-form";
import {
  ApiError,
  type InpulseApiClient,
  type TaskEditRequest,
  type TaskItem,
} from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSegmented,
} from "@features/common/components/Calm";
import {
  mergeTask,
  taskEdit,
  taskError,
  useTasks,
  type TaskScope,
  type TaskField,
} from "./task-query";

const labels: Record<TaskField, string> = {
  title: "任务标题",
  description: "任务说明",
  priority: "优先级",
  assigneeId: "负责人",
  dueAt: "截止时间",
};
const priorityLabels = {
  LOW: "低",
  NORMAL: "普通",
  HIGH: "高",
  URGENT: "紧急",
};
const statusLabels = { TODO: "未完成", DONE: "已完成", CANCELED: "已取消" };
const priorityTone = {
  LOW: "gray",
  NORMAL: "blue",
  HIGH: "amber",
  URGENT: "red",
} as const;
const statusTone = {
  TODO: "blue",
  DONE: "green",
  CANCELED: "gray",
} as const;
const empty: TaskEditRequest = {
  title: "",
  description: "",
  priority: "NORMAL",
  assigneeId: 0,
  dueAt: null,
};
type Merge = ReturnType<typeof mergeTask> & {
  latest: TaskItem;
  choices: Partial<Record<TaskField, "draft" | "latest">>;
};
const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未设置";
const dueLabel = (value: string | null) =>
  value ? "截止 " + formatDate(value) : "未设置截止";

export function TasksPanel({
  projectId,
  moduleId,
  featureId,
  writable,
  client,
}: TaskScope & { writable: boolean; client?: InpulseApiClient | undefined }) {
  const scope = { projectId, moduleId, featureId };
  const { api, query, members, mutation } = useTasks(scope, client);
  const [view, setView] = useState<"cards" | "list">("cards");
  const [selectedId, setSelectedId] = useState<number | null>(
    () =>
      Number(new URLSearchParams(window.location.search).get("taskId")) || null,
  );
  const [selection, setSelection] = useState<{ item?: TaskItem } | null>(null);
  const [merge, setMerge] = useState<Merge | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [success, setSuccess] = useState(false);
  const generation = useRef(0);
  const saving = useRef(false);
  const {
    control,
    handleSubmit,
    reset,
    getValues,
    formState: { errors },
  } = useForm<TaskEditRequest>({ defaultValues: empty });
  const current = query.data?.items.find((item) => item.id === selectedId);
  const memberName = (id: number) =>
    members.data?.items.find((m) => m.id === id)?.name ??
    "用户 #" + id + "（历史负责人）";
  const open = (item?: TaskItem) => {
    setSelectedId(null);
    generation.current++;
    setSelection(item ? { item: { ...item } } : {});
    reset(item ? taskEdit(item) : empty);
    mutation.reset();
    setMerge(null);
    setReloadError(null);
    setSuccess(false);
    void members.refetch();
  };
  const conflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;
  const close = () => {
    if (saving.current || reloading) return;
    generation.current++;
    setSelection(null);
    setMerge(null);
  };
  const save = handleSubmit(async (edit) => {
    if (
      !selection ||
      saving.current ||
      reloading ||
      merge ||
      conflict ||
      reloadError ||
      !writable
    )
      return;
    saving.current = true;
    try {
      const result = await mutation.mutateAsync({ ...selection, edit });
      setSelectedId(result.id);
      setSelection(null);
      setSuccess(true);
    } catch {
      /* Keep input and retry key. */
    } finally {
      saving.current = false;
    }
  });
  const reload = async () => {
    if (!selection?.item) return;
    if (
      mutation.error instanceof ApiError &&
      mutation.error.code === "TASK_PARENT_ARCHIVED"
    ) {
      setReloadError("项目、模块或功能已归档，草稿已保留，当前不能保存。");
      return;
    }
    const stamp = generation.current;
    const base = selection.item;
    const draft = getValues();
    setReloading(true);
    try {
      const latest = await api.getTask(projectId, moduleId, featureId, base.id);
      if (stamp !== generation.current) return;
      const parent = await api.getFeature(projectId, moduleId, featureId);
      if (stamp !== generation.current) return;
      if (parent.status !== "ACTIVE") {
        setReloadError("项目、模块或功能已归档，草稿已保留，当前不能保存。");
        return;
      }
      const result = mergeTask(taskEdit(base), draft, taskEdit(latest));
      if (result.conflicts.length) setMerge({ ...result, latest, choices: {} });
      else {
        reset(result.values);
        setSelection({ item: latest });
        mutation.reset();
        setReloadError(null);
      }
    } catch (error) {
      if (stamp === generation.current) setReloadError(taskError(error));
    } finally {
      if (stamp === generation.current) setReloading(false);
    }
  };
  const applyMerge = () => {
    if (!merge || merge.conflicts.some((field) => !merge.choices[field]))
      return;
    const values = { ...merge.values };
    for (const field of merge.conflicts)
      if (merge.choices[field] === "latest")
        Object.assign(values, { [field]: merge.latest[field] });
    reset(values);
    setSelection({ item: merge.latest });
    setMerge(null);
    mutation.reset();
    setReloadError(null);
  };
  return (
    <section aria-label="功能任务" className="tasks-panel">
      <div className="calm-section-title">
        <div>
          <h3>功能任务</h3>
          <small>任务保存在功能下，编号、版本与负责人以服务端为准。</small>
        </div>
        <div className="feature-view-controls">
          <CalmSegmented
            label="展示方式"
            value={view}
            options={[
              { value: "cards", label: "卡片" },
              { value: "list", label: "列表" },
            ]}
            onChange={setView}
          />
          {query.isSuccess && !query.data?.items.length ? null : (
            <Button
              className="primary-button"
              disabled={!writable}
              onClick={() => open()}
            >
              <InpulseIcon name="plus" size={15} />
              新建任务
            </Button>
          )}
        </div>
      </div>
      {!writable && (
        <p className="permission-hint">
          <InpulseIcon name="alert" size={14} />
          功能已归档，任务历史只读，不能新建或修改。
        </p>
      )}
      {success && <Alert type="success" title="任务已保存" />}
      {query.isPending ? (
        <div className="calm-state">
          <Spin />
          <span>正在加载任务</span>
        </div>
      ) : query.isError ? (
        <Alert
          type="error"
          title={taskError(query.error)}
          action={
            <Button
              className="secondary-button"
              onClick={() => void query.refetch()}
            >
              重试任务列表
            </Button>
          }
        />
      ) : !query.data?.items.length ? (
        <CalmEmptyState
          icon="zap"
          title="暂无任务"
          description="为当前功能创建一项具体执行工作。"
        >
          <Button
            className="primary-button"
            disabled={!writable}
            onClick={() => open()}
          >
            <InpulseIcon name="plus" size={15} />
            新建任务
          </Button>
        </CalmEmptyState>
      ) : view === "list" ? (
        <div className="feature-list-scroll">
          <table className="feature-list-table">
            <caption className="sr-only">任务列表</caption>
            <thead>
              <tr>
                <th scope="col">编号</th>
                <th scope="col">任务</th>
                <th scope="col">负责人</th>
                <th scope="col">优先级</th>
                <th scope="col">截止</th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              {query.data.items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="task-id">{item.code}</span>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="feature-list-open"
                      onClick={() => setSelectedId(item.id)}
                    >
                      <strong>{item.title}</strong>
                      <span>查看任务详情</span>
                    </button>
                  </td>
                  <td>{memberName(item.assigneeId)}</td>
                  <td>
                    <CalmBadge tone={priorityTone[item.priority]}>
                      {priorityLabels[item.priority]}
                    </CalmBadge>
                  </td>
                  <td className="due-overdue">{dueLabel(item.dueAt)}</td>
                  <td>
                    <CalmBadge tone={statusTone[item.workStatus]}>
                      {statusLabels[item.workStatus]}
                    </CalmBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="calm-task-grid">
          {query.data.items.map((item) => (
            <article className="calm-task-card" key={item.id}>
              <div className="calm-card-top">
                <span className="task-id">{item.code}</span>
                <span className="task-card-badges">
                  <CalmBadge tone={statusTone[item.workStatus]}>
                    {statusLabels[item.workStatus]}
                  </CalmBadge>
                  <CalmBadge tone={priorityTone[item.priority]}>
                    {priorityLabels[item.priority]}
                  </CalmBadge>
                </span>
              </div>
              <h3>{item.title}</h3>
              <p className="task-belonging">功能 #{item.featureId}</p>
              <div className="calm-card-bottom">
                <span title={"负责人：" + memberName(item.assigneeId)}>
                  <InpulseIcon name="users" size={14} />
                  {memberName(item.assigneeId)}
                </span>
                <span title={"截止：" + formatDate(item.dueAt)}>
                  <InpulseIcon name="clock" size={14} />
                  {dueLabel(item.dueAt)}
                </span>
              </div>
              <div className="task-card-footer">
                <span className="task-card-counts">
                  <span>
                    <InpulseIcon name="calendar" size={13} />
                    更新 {formatDate(item.updatedAt)}
                  </span>
                </span>
                <button
                  type="button"
                  className="text-button"
                  aria-label="任务详情"
                  onClick={() => setSelectedId(item.id)}
                >
                  任务详情
                  <InpulseIcon name="chevronRight" size={13} />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
      {selectedId !== null && (
        <Drawer
          open
          onClose={() => setSelectedId(null)}
          className="catalog-modal task-detail-drawer"
          title="任务详情"
          size="large"
        >
          {query.isPending ? (
            <div className="calm-state">
              <Spin />
              <span>正在加载任务详情</span>
            </div>
          ) : query.isError ? (
            <Alert
              type="error"
              title={taskError(query.error)}
              action={
                <Button
                  className="secondary-button"
                  onClick={() => void query.refetch()}
                >
                  重试任务详情
                </Button>
              }
            />
          ) : !current ? (
            <Alert type="warning" title="任务不存在或无法访问。" />
          ) : (
            <>
              <div className="task-modal-header">
                <div>
                  <span className="detail-label">
                    项目 #{current.projectId} / 模块 #{current.moduleId} / 功能
                    #{current.featureId}
                  </span>
                  <h2>{current.title}</h2>
                  <div className="task-modal-badges">
                    <span className="task-id">{current.code}</span>
                    <CalmBadge tone={statusTone[current.workStatus]}>
                      {statusLabels[current.workStatus]}
                    </CalmBadge>
                    <CalmBadge tone={priorityTone[current.priority]}>
                      {priorityLabels[current.priority]}
                    </CalmBadge>
                  </div>
                </div>
              </div>
              <div className="task-modal-grid">
                <div className="task-modal-main">
                  <section className="calm-description">
                    <h3>任务描述</h3>
                    <p>{current.description || "暂无任务说明"}</p>
                  </section>
                </div>
                <aside className="task-modal-facts">
                  <dl className="calm-meta">
                    <dt>负责人</dt>
                    <dd>{memberName(current.assigneeId)}</dd>
                    <dt>创建人</dt>
                    <dd>#{current.creatorId}</dd>
                    <dt>截止时间</dt>
                    <dd>{formatDate(current.dueAt)}</dd>
                    <dt>创建时间</dt>
                    <dd>{formatDate(current.createdAt)}</dd>
                    <dt>更新时间</dt>
                    <dd>{formatDate(current.updatedAt)}</dd>
                    <dt>数据版本</dt>
                    <dd>v{current.rowVersion}</dd>
                  </dl>
                </aside>
              </div>
              <div className="calm-action-footer">
                <Button
                  className="primary-button"
                  disabled={!writable || current.lifecycleStatus !== "ACTIVE"}
                  onClick={() => open(current)}
                >
                  <InpulseIcon name="pencil" size={14} />
                  编辑任务
                </Button>
              </div>
            </>
          )}
        </Drawer>
      )}
      <Modal
        open={selection !== null}
        title={selection?.item ? "编辑任务" : "新建任务"}
        className="catalog-modal task-edit-modal"
        onCancel={close}
        footer={null}
        mask={{ closable: !mutation.isPending && !reloading }}
      >
        <form
          className="catalog-form calm-form"
          onSubmit={(event) => void save(event)}
        >
          <div className="dialog-form">
            {mutation.isError && (
              <Alert type="error" title={taskError(mutation.error)} />
            )}
            {reloadError && <Alert type="error" title={reloadError} />}
            {conflict && selection?.item && (
              <Button
                className="secondary-button"
                loading={reloading}
                onClick={() => void reload()}
              >
                加载最新版本后继续编辑
              </Button>
            )}
            {merge && (
              <div className="merge-panel">
                <div className="calm-section-title">
                  <div>
                    <h3>解决编辑冲突</h3>
                    <small>选择保留哪一版，应用后再提交最新版本。</small>
                  </div>
                </div>
                {merge.conflicts.map((field) => (
                  <div className="merge-choice" key={field}>
                    <p>{labels[field]}存在冲突</p>
                    <p>我的输入：{String(merge.values[field] ?? "未设置")}</p>
                    <p>最新值：{String(merge.latest[field] ?? "未设置")}</p>
                    <div className="catalog-actions">
                      <Button
                        className="secondary-button"
                        onClick={() =>
                          setMerge({
                            ...merge,
                            choices: { ...merge.choices, [field]: "draft" },
                          })
                        }
                      >
                        保留我的{labels[field]}
                      </Button>
                      <Button
                        className="secondary-button"
                        onClick={() =>
                          setMerge({
                            ...merge,
                            choices: { ...merge.choices, [field]: "latest" },
                          })
                        }
                      >
                        采用最新{labels[field]}
                      </Button>
                      <span>{merge.choices[field] ? "已选择" : "请选择"}</span>
                    </div>
                  </div>
                ))}
                <Button
                  className="primary-button"
                  disabled={merge.conflicts.some(
                    (field) => !merge.choices[field],
                  )}
                  onClick={applyMerge}
                >
                  应用合并结果
                </Button>
              </div>
            )}
            <fieldset
              className="task-form-fields"
              disabled={mutation.isPending || reloading || !!merge}
            >
              <div className="calm-field">
                <label htmlFor="task-title">任务标题</label>
                <Controller
                  name="title"
                  control={control}
                  rules={{
                    validate: (value) =>
                      value.trim().length > 0 || "请输入任务标题",
                    maxLength: { value: 500, message: "最多500字" },
                  }}
                  render={({ field }) => <Input {...field} id="task-title" />}
                />
                {errors.title && <p role="alert">{errors.title.message}</p>}
              </div>
              <div className="calm-field">
                <label htmlFor="task-description">任务说明</label>
                <Controller
                  name="description"
                  control={control}
                  rules={{
                    maxLength: {
                      value: 20000,
                      message: "说明最多 20000 字",
                    },
                  }}
                  render={({ field }) => (
                    <Input.TextArea {...field} id="task-description" rows={4} />
                  )}
                />
                {errors.description && (
                  <p role="alert">{errors.description.message}</p>
                )}
              </div>
              <div className="calm-field">
                <label htmlFor="task-priority">优先级</label>
                <Controller
                  name="priority"
                  control={control}
                  render={({ field }) => (
                    <select {...field} id="task-priority">
                      {Object.entries(priorityLabels).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  )}
                />
              </div>
              <div className="calm-field">
                <label htmlFor="task-assignee">负责人</label>
                <Controller
                  name="assigneeId"
                  control={control}
                  rules={{ validate: (value) => value > 0 || "请选择负责人" }}
                  render={({ field }) => (
                    <select
                      id="task-assignee"
                      value={field.value}
                      onChange={(event) =>
                        field.onChange(Number(event.target.value))
                      }
                      onBlur={field.onBlur}
                      ref={field.ref}
                    >
                      <option value={0}>请选择项目成员</option>
                      {selection?.item &&
                        !members.data?.items.some(
                          (m) => m.id === selection.item!.assigneeId,
                        ) && (
                          <option value={selection.item.assigneeId}>
                            {memberName(selection.item.assigneeId)}，可保留
                          </option>
                        )}
                      {members.data?.items.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  )}
                />
                {errors.assigneeId && (
                  <p role="alert">{errors.assigneeId.message}</p>
                )}
                {members.isPending && <p>正在加载项目成员…</p>}
                {members.isError && (
                  <Alert
                    type="error"
                    title={taskError(members.error)}
                    action={
                      <Button
                        className="secondary-button"
                        onClick={() => void members.refetch()}
                      >
                        重试项目成员
                      </Button>
                    }
                  />
                )}
              </div>
              <div className="calm-field">
                <label htmlFor="task-due">截止时间</label>
                <Controller
                  name="dueAt"
                  control={control}
                  render={({ field }) => (
                    <input
                      id="task-due"
                      type="datetime-local"
                      value={
                        field.value
                          ? new Date(
                              new Date(field.value).getTime() -
                                new Date(field.value).getTimezoneOffset() *
                                  60000,
                            )
                              .toISOString()
                              .slice(0, 16)
                          : ""
                      }
                      onBlur={field.onBlur}
                      ref={field.ref}
                      onChange={(event) =>
                        field.onChange(
                          event.target.value
                            ? new Date(event.target.value).toISOString()
                            : null,
                        )
                      }
                    />
                  )}
                />
              </div>
            </fieldset>
          </div>
          <div className="calm-action-footer">
            <Button
              className="secondary-button"
              onClick={close}
              disabled={mutation.isPending || reloading}
            >
              取消
            </Button>
            <Button
              className="primary-button"
              htmlType="submit"
              loading={mutation.isPending}
              disabled={
                !writable || reloading || !!merge || conflict || !!reloadError
              }
            >
              保存
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
