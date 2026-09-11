import { ExternalLinksPanel } from "@features/external-links/ExternalLinksPanel";
import { MergeIntoMainTaskModal } from "@features/task-groups/MergeIntoMainTaskModal";
import { useNavigate } from "react-router-dom";
import { LeftoverTaskSource } from "./LeftoverTaskSource";
import React, { useRef, useState } from "react";
import { TaskStatusPanel } from "./TaskStatusPanel";
import { useTaskMarks, type TaskMark } from "./task-marks";
import { Alert, Button, Input, Modal, Spin } from "antd";
import { Controller, useForm } from "react-hook-form";
import { ApiError, type InpulseApiClient } from "@generated/api";
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
  type TaskViewItem,
  type TaskDraft,
} from "./task-query";

const labels: Record<TaskField, string> = {
  title: "任务标题",
  description: "任务说明",
  priority: "优先级",
  assigneeId: "负责人",
  dueAt: "截止时间",
  impactFeatureIds: "影响功能",
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
const empty: TaskDraft = {
  title: "",
  description: "",
  priority: "NORMAL",
  assigneeId: 0,
  dueAt: null,
};
type Merge = ReturnType<typeof mergeTask> & {
  latest: TaskViewItem;
  choices: Partial<Record<TaskField, "draft" | "latest">>;
};
/**
 * C-1 关系徽章：groupRole 为 null 表示未加入 ACTIVE 聚合组（未入组），
 * 徽章与「查看主任务」入口一并隐藏；数据来自页面级一次批量 R-5 调用。
 */
function relationBadge(mark: TaskMark | undefined): {
  readonly label: "主任务" | "来源任务";
  readonly tone: "violet" | "cyan";
  readonly title: string;
} | null {
  if (mark?.groupRole === "MAIN")
    return { label: "主任务", tone: "violet", title: "聚合组统一入口" };
  if (mark?.groupRole === "SOURCE")
    return {
      label: "来源任务",
      tone: "cyan",
      title: "来源分支，保留原始状态与历史",
    };
  return null;
}
const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未设置";
const dueLabel = (value: string | null) =>
  value ? "截止 " + formatDate(value) : "未设置截止";

function MergeIntoTargetModal({
  task,
  api,
  onClose,
}: {
  task: TaskViewItem;
  api: InpulseApiClient;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  return (
    <MergeIntoMainTaskModal
      open
      task={{
        id: task.id,
        code: task.code,
        title: task.title,
        projectId: task.projectId,
      }}
      api={api}
      onClose={onClose}
      onMerged={(groupId) => {
        onClose();
        navigate("/task-groups/" + groupId);
      }}
    />
  );
}

export function TasksPanel({
  projectId,
  moduleId,
  featureId,
  writable,
  client,
}: TaskScope & { writable: boolean; client?: InpulseApiClient | undefined }) {
  const scope = { projectId, moduleId, featureId };
  const { api, query, members, mutation, features } = useTasks(scope, client);
  const [view, setView] = useState<"cards" | "list">("cards");
  const [statusFilter, setStatusFilter] = useState("TODO");
  const [selectedId, setSelectedId] = useState<number | null>(
    () =>
      Number(new URLSearchParams(window.location.search).get("taskId")) || null,
  );
  const [selection, setSelection] = useState<{ item?: TaskViewItem } | null>(
    null,
  );
  const [merge, setMerge] = useState<Merge | null>(null);
  const [mergeInto, setMergeInto] = useState(false);
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
  } = useForm<TaskDraft>({ defaultValues: empty });
  const navigate = useNavigate();
  const current = query.data?.items.find((item) => item.id === selectedId);
  // 页面级一次批量（R-5）：任务集合变化时整批重读，不按任务逐个请求。
  const marks = useTaskMarks(
    api,
    query.data?.items.map((item) => item.id) ?? [],
  );
  const currentMark = current ? marks.get(current.id) : undefined;
  const currentBadge = relationBadge(currentMark);
  // 主任务自身就是统一入口，只有来源分支显示「查看主任务」；
  // groupRole 为 null（未入组）时不显示任何导航入口（C-1）。
  const currentGroupId =
    currentMark?.groupRole === "SOURCE" ? currentMark.groupId : null;
  const currentRecordCount = currentMark?.publishedRecordCount ?? 0;
  const visibleItems =
    query.data?.items.filter(
      (item) => statusFilter === "ALL" || item.workStatus === statusFilter,
    ) ?? [];
  const memberName = (id: number) =>
    members.data?.items.find((m) => m.id === id)?.name ??
    "用户 #" + id + "（历史负责人）";
  const open = (item?: TaskViewItem) => {
    setSelectedId(null);
    generation.current++;
    setSelection(item ? { item: { ...item } } : {});
    reset(item ? taskEdit(item) : empty);
    mutation.reset();
    setMerge(null);
    setMergeInto(false);
    setReloadError(null);
    setSuccess(false);
    void members.refetch();
    if (featureId === null) void features.refetch();
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
      const latest =
        featureId === null
          ? await api.getModuleTask(projectId, moduleId, base.id)
          : await api.getTask(projectId, moduleId, featureId, base.id);
      if (stamp !== generation.current) return;
      const parent =
        featureId === null
          ? (await api.listModules(projectId)).items.find(
              (m) => m.id === moduleId,
            )
          : await api.getFeature(projectId, moduleId, featureId);
      if (stamp !== generation.current) return;
      if (latest.lifecycleStatus !== "ACTIVE" || parent?.status !== "ACTIVE") {
        setReloadError("任务或功能已归档，草稿已保留，当前不能保存。");
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
        Object.assign(values, { [field]: taskEdit(merge.latest)[field] });
    reset(values);
    setSelection({ item: merge.latest });
    setMerge(null);
    mutation.reset();
    setReloadError(null);
  };
  return (
    <section
      aria-label={featureId === null ? "模块任务" : "功能任务"}
      className="tasks-panel"
    >
      <div className="calm-section-title">
        <div>
          <h3>{featureId === null ? "模块任务" : "功能任务"}</h3>
          <small>
            {featureId === null
              ? "任务保存在模块下，可关联一个或多个功能；编号、版本与负责人以服务端为准。"
              : "任务保存在功能下，编号、版本与负责人以服务端为准。"}
          </small>
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
          {featureId === null
            ? "模块已归档，任务历史只读，不能新建或修改。"
            : "功能已归档，任务历史只读，不能新建或修改。"}
        </p>
      )}
      {query.data && (
        <p className="task-count">
          任务数：{query.data.items.length}（按唯一任务计）
        </p>
      )}
      {success && <Alert type="success" title="任务已保存" />}
      {query.data && (
        <div className="feature-view-controls">
          <label>
            任务状态筛选
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
            >
              <option value="TODO">未完成</option>
              <option value="DONE">已完成</option>
              <option value="CANCELED">已取消</option>
              <option value="ALL">全部状态</option>
            </select>
          </label>
        </div>
      )}
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
          description={
            featureId === null
              ? "为当前模块创建一项可影响一个或多个功能的执行工作。"
              : "为当前功能创建一项具体执行工作。"
          }
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
      ) : !visibleItems.length ? (
        <CalmEmptyState
          icon="zap"
          title="当前状态暂无任务"
          description="可切换状态筛选查看历史任务。"
        />
      ) : view === "list" ? (
        <div className="feature-list-scroll">
          <table className="feature-list-table">
            <caption className="sr-only">任务列表</caption>
            <thead>
              <tr>
                <th scope="col">范围</th>
                <th scope="col">编号</th>
                <th scope="col">任务</th>
                <th scope="col">负责人</th>
                <th scope="col">优先级</th>
                <th scope="col">截止</th>
                <th scope="col">状态</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => {
                const badge = relationBadge(marks.get(item.id));
                return (
                  <tr key={item.id}>
                    <td>
                      {item.scopeType === "MODULE" ? (
                        <span className="task-scope">模块级任务</span>
                      ) : (
                        <span className="task-scope">功能级任务</span>
                      )}
                    </td>
                    <td>
                      <span className="task-id">{item.code}</span>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="feature-list-open"
                        aria-label={item.title}
                        onClick={() => setSelectedId(item.id)}
                      >
                        <strong>{item.title}</strong>
                        <span>
                          {badge === null ? "" : badge.label + " · "}
                          查看任务详情
                        </span>
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
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="calm-task-grid">
          {visibleItems.map((item) => {
            const badge = relationBadge(marks.get(item.id));
            const recordCount = marks.get(item.id)?.publishedRecordCount ?? 0;
            return (
              <article className="calm-task-card" key={item.id}>
                <div className="calm-card-top">
                  <span className="task-id">{item.code}</span>
                  <span className="task-card-badges">
                    {badge !== null && (
                      <CalmBadge tone={badge.tone} title={badge.title}>
                        {badge.label}
                      </CalmBadge>
                    )}
                    <CalmBadge tone={statusTone[item.workStatus]}>
                      {statusLabels[item.workStatus]}
                    </CalmBadge>
                    <CalmBadge tone={priorityTone[item.priority]}>
                      {priorityLabels[item.priority]}
                    </CalmBadge>
                  </span>
                </div>
                <h3>{item.title}</h3>
                <p className="task-belonging">
                  {item.featureId === null
                    ? "模块级任务" + (featureId === null ? "" : " · 引用")
                    : "功能 #" + item.featureId}
                </p>
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
                    {recordCount > 0 && (
                      <span title={recordCount + " 条已发布迭代记录"}>
                        <InpulseIcon name="gitBranch" size={13} />
                        迭代记录 {recordCount} 条
                      </span>
                    )}
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
            );
          })}
        </div>
      )}
      {selectedId !== null && (
        <Modal
          open
          centered
          width={1000}
          onCancel={() => setSelectedId(null)}
          className="catalog-modal task-detail-modal"
          title="任务详情"
          footer={null}
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
                    项目 #{current.projectId} / 模块 #{current.moduleId} /
                    {current.featureId === null
                      ? " 模块级任务"
                      : " 功能 #" + current.featureId}
                  </span>
                  <h2>{current.title}</h2>
                  <ExternalLinksPanel
                    key={current.id}
                    targetType="TASK"
                    targetId={current.id}
                    client={api}
                  />
                  <div className="task-modal-badges">
                    <span className="task-id">{current.code}</span>
                    <CalmBadge tone={statusTone[current.workStatus]}>
                      {statusLabels[current.workStatus]}
                    </CalmBadge>
                    <CalmBadge tone={priorityTone[current.priority]}>
                      {priorityLabels[current.priority]}
                    </CalmBadge>
                    {currentBadge !== null && (
                      <CalmBadge
                        tone={currentBadge.tone}
                        title={currentBadge.title}
                      >
                        {currentBadge.label}
                      </CalmBadge>
                    )}
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
                    {current.scopeType === "MODULE" && (
                      <>
                        <dt>影响功能</dt>
                        <dd>
                          影响功能：
                          {current.impactFeatureIds
                            .map(
                              (id) =>
                                features.data?.items.find((f) => f.id === id)
                                  ?.name ?? "功能 #" + id,
                            )
                            .join("、") || "未选择"}
                        </dd>
                      </>
                    )}
                  </dl>
                </aside>
              </div>
              <div className="task-modal-links">
                {current.scopeType === "MODULE" && (
                  <a
                    href={
                      "/projects/" +
                      projectId +
                      "/modules/" +
                      moduleId +
                      "/tasks?taskId=" +
                      current.id
                    }
                  >
                    打开模块任务
                  </a>
                )}
                <a
                  href={`/records?projectId=${projectId}&moduleId=${moduleId}&taskId=${current.id}`}
                >
                  迭代记录草稿
                </a>
                {currentRecordCount > 0 && (
                  <span
                    className="task-record-count"
                    title={currentRecordCount + " 条已发布迭代记录"}
                  >
                    <InpulseIcon name="gitBranch" size={13} />
                    迭代记录 {currentRecordCount} 条
                  </span>
                )}
                {currentGroupId !== null && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => navigate("/task-groups/" + currentGroupId)}
                  >
                    <InpulseIcon name="gitBranch" size={14} />
                    查看主任务
                    <InpulseIcon name="chevronRight" size={13} />
                  </button>
                )}
              </div>
              <LeftoverTaskSource api={api} taskId={current.id} />
              <TaskStatusPanel
                key={current.id}
                item={current}
                api={api}
                writable={
                  writable &&
                  !(featureId !== null && current.scopeType === "MODULE")
                }
              />
              <div className="calm-action-footer">
                <Button
                  className="secondary-button"
                  disabled={
                    !writable ||
                    current.lifecycleStatus !== "ACTIVE" ||
                    (featureId !== null && current.scopeType === "MODULE")
                  }
                  onClick={() => setMergeInto(true)}
                >
                  <InpulseIcon name="gitMerge" size={14} />
                  合并到主任务
                </Button>
                <Button
                  className="primary-button"
                  disabled={
                    !writable ||
                    current.lifecycleStatus !== "ACTIVE" ||
                    (featureId !== null && current.scopeType === "MODULE")
                  }
                  onClick={() => open(current)}
                >
                  <InpulseIcon name="pencil" size={14} />
                  编辑任务
                </Button>
              </div>
              {mergeInto && (
                <MergeIntoTargetModal
                  task={current}
                  api={api}
                  onClose={() => setMergeInto(false)}
                />
              )}
            </>
          )}
        </Modal>
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
                    <p>
                      最新值：
                      {String(taskEdit(merge.latest)[field] ?? "未设置")}
                    </p>
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
            {featureId === null && (
              <>
                <div className="calm-field form-hint">
                  <p>
                    同一工作只保留一份任务；如果负责人、状态、验收、上线或回滚不同，建议拆分任务。
                  </p>
                </div>
                {features.isPending ? (
                  <p>正在加载影响功能…</p>
                ) : features.isError ? (
                  <Alert
                    type="error"
                    title={taskError(features.error)}
                    action={
                      <Button
                        className="secondary-button"
                        onClick={() => void features.refetch()}
                      >
                        重试影响功能
                      </Button>
                    }
                  />
                ) : (
                  <Controller
                    name="impactFeatureIds"
                    control={control}
                    render={({ field }) => (
                      <fieldset
                        className="calm-field task-impact-features"
                        disabled={mutation.isPending || reloading || !!merge}
                      >
                        <legend>影响功能（可多选，可为空）</legend>
                        {features.data?.items.map((f) => (
                          <label key={f.id}>
                            <input
                              type="checkbox"
                              checked={(field.value ?? []).includes(f.id)}
                              disabled={
                                f.status !== "ACTIVE" &&
                                !(
                                  selection?.item?.scopeType === "MODULE" &&
                                  selection.item.impactFeatureIds.includes(f.id)
                                )
                              }
                              onChange={(event) =>
                                field.onChange(
                                  event.target.checked
                                    ? [
                                        ...new Set([
                                          ...(field.value ?? []),
                                          f.id,
                                        ]),
                                      ].sort((a, b) => a - b)
                                    : (field.value ?? []).filter(
                                        (id) => id !== f.id,
                                      ),
                                )
                              }
                            />
                            {f.name}
                            {f.status === "ARCHIVED" ? "（已归档）" : ""}
                          </label>
                        ))}
                      </fieldset>
                    )}
                  />
                )}
              </>
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
                      value: 50000,
                      message: "说明最多 50000 字",
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
