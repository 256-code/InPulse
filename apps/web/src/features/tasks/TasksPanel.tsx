import React, { useRef, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Modal,
  Radio,
  Space,
  Spin,
  Table,
  Tag,
} from "antd";
import { Controller, useForm } from "react-hook-form";
import { ApiError, type InpulseApiClient } from "@generated/api";
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

export function TasksPanel({
  projectId,
  moduleId,
  featureId,
  writable,
  client,
}: TaskScope & { writable: boolean; client?: InpulseApiClient | undefined }) {
  const scope = { projectId, moduleId, featureId };
  const { api, query, members, mutation, features } = useTasks(scope, client);
  const [view, setView] = useState("cards");
  const [selectedId, setSelectedId] = useState<number | null>(
    () =>
      Number(new URLSearchParams(window.location.search).get("taskId")) || null,
  );
  const [selection, setSelection] = useState<{ item?: TaskViewItem } | null>(
    null,
  );
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
  } = useForm<TaskDraft>({ defaultValues: empty });
  const current = query.data?.items.find((item) => item.id === selectedId);
  const memberName = (id: number) =>
    members.data?.items.find((m) => m.id === id)?.name ??
    `用户 #${id}（历史负责人）`;
  const open = (item?: TaskViewItem) => {
    setSelectedId(null);
    generation.current++;
    setSelection(item ? { item: { ...item } } : {});
    reset(item ? taskEdit(item) : empty);
    mutation.reset();
    setMerge(null);
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
      // Probe parent writability from the latest feature; task writes still recheck every ancestor server-side.
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
    <section aria-label={featureId === null ? "模块任务" : "功能任务"}>
      <Space wrap>
        <h2>{featureId === null ? "模块任务" : "功能任务"}</h2>
        <Button disabled={!writable} onClick={() => open()}>
          新建任务
        </Button>
        <Radio.Group
          value={view}
          onChange={(event) => setView(event.target.value)}
          options={[
            { label: "卡片", value: "cards" },
            { label: "列表", value: "list" },
          ]}
        />
      </Space>
      {!writable && <Alert type="info" title="功能已归档，任务历史只读。" />}
      {query.data && <p>任务数：{query.data.items.length}（按唯一任务计）</p>}
      {success && <Alert type="success" title="任务已保存" />}
      {query.isPending ? (
        <Spin />
      ) : query.isError ? (
        <Alert
          type="error"
          title={taskError(query.error)}
          action={
            <Button onClick={() => void query.refetch()}>重试任务列表</Button>
          }
        />
      ) : !query.data?.items.length ? (
        <Empty description="暂无任务" />
      ) : view === "list" ? (
        <Table
          rowKey="id"
          pagination={false}
          dataSource={query.data.items}
          columns={[
            {
              title: "范围",
              render: (_, item: TaskViewItem) =>
                item.scopeType === "MODULE" ? "模块级任务" : "功能级任务",
            },
            { title: "编号", dataIndex: "code" },
            {
              title: "标题",
              render: (_, item: TaskViewItem) => (
                <Button type="link" onClick={() => setSelectedId(item.id)}>
                  {item.title}
                </Button>
              ),
            },
            {
              title: "负责人",
              render: (_, item: TaskViewItem) => memberName(item.assigneeId),
            },
            {
              title: "优先级",
              render: (_, item: TaskViewItem) => priorityLabels[item.priority],
            },
            {
              title: "状态",
              render: (_, item: TaskViewItem) => statusLabels[item.workStatus],
            },
          ]}
        />
      ) : (
        <Space orientation="vertical" style={{ width: "100%" }}>
          {query.data.items.map((item) => (
            <Card
              key={item.id}
              title={item.title}
              extra={
                <Button onClick={() => setSelectedId(item.id)}>任务详情</Button>
              }
            >
              <Tag>{item.code}</Tag>
              {item.scopeType === "MODULE" && (
                <Tag color="blue">
                  模块级任务{featureId === null ? "" : " · 引用"}
                </Tag>
              )}
              <Tag>{statusLabels[item.workStatus]}</Tag>
              <Tag>{priorityLabels[item.priority]}</Tag>
              <p>负责人：{memberName(item.assigneeId)}</p>
              <p>
                截止时间：
                {item.dueAt ? new Date(item.dueAt).toLocaleString() : "未设置"}
              </p>
            </Card>
          ))}
        </Space>
      )}
      {selectedId !== null && (
        <Drawer
          open
          onClose={() => setSelectedId(null)}
          title="任务详情"
          size="large"
        >
          {query.isPending ? (
            <Spin />
          ) : query.isError ? (
            <Alert
              type="error"
              title={taskError(query.error)}
              action={
                <Button onClick={() => void query.refetch()}>
                  重试任务详情
                </Button>
              }
            />
          ) : !current ? (
            <Alert type="warning" title="任务不存在或无法访问。" />
          ) : (
            <>
              <h2>{current.title}</h2>
              <p>
                {current.code} · {statusLabels[current.workStatus]} ·{" "}
                {priorityLabels[current.priority]}
              </p>
              <p>
                项目 #{current.projectId} / 模块 #{current.moduleId}
                {current.featureId === null
                  ? " / 模块级任务"
                  : ` / 功能 #${current.featureId}`}
              </p>
              <p>
                负责人：{memberName(current.assigneeId)} · 创建人 #
                {current.creatorId}
              </p>
              <p>
                截止时间：
                {current.dueAt
                  ? new Date(current.dueAt).toLocaleString()
                  : "未设置"}
              </p>
              <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                {current.description || "暂无任务说明"}
              </p>
              {current.scopeType === "MODULE" && (
                <>
                  <p>
                    影响功能：
                    {current.impactFeatureIds
                      .map(
                        (id) =>
                          features.data?.items.find((f) => f.id === id)?.name ??
                          `功能 #${id}`,
                      )
                      .join("、") || "未选择"}
                  </p>
                  <a
                    href={`/projects/${projectId}/modules/${moduleId}/tasks?taskId=${current.id}`}
                  >
                    打开模块任务
                  </a>
                </>
              )}
              <Button
                disabled={
                  !writable ||
                  current.lifecycleStatus !== "ACTIVE" ||
                  (featureId !== null && current.scopeType === "MODULE")
                }
                onClick={() => open(current)}
              >
                编辑任务
              </Button>
            </>
          )}
        </Drawer>
      )}
      <Modal
        open={selection !== null}
        title={selection?.item ? "编辑任务" : "新建任务"}
        onCancel={close}
        footer={null}
        mask={{ closable: !mutation.isPending && !reloading }}
      >
        <form onSubmit={(event) => void save(event)}>
          {mutation.isError && (
            <Alert type="error" title={taskError(mutation.error)} />
          )}
          {reloadError && <Alert type="error" title={reloadError} />}
          {conflict && selection?.item && (
            <Button loading={reloading} onClick={() => void reload()}>
              加载最新版本后继续编辑
            </Button>
          )}
          {merge && (
            <div>
              {merge.conflicts.map((field) => (
                <div key={field}>
                  <p>{labels[field]}存在冲突</p>
                  <p>我的输入：{String(merge.values[field] ?? "未设置")}</p>
                  <p>
                    最新值：{String(taskEdit(merge.latest)[field] ?? "未设置")}
                  </p>
                  <Button
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
              ))}
              <Button
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
              <p>
                同一工作只保留一份任务；如果负责人、状态、验收、上线或回滚不同，建议拆分任务。
              </p>
              {features.isPending ? (
                <p>正在加载影响功能…</p>
              ) : features.isError ? (
                <Alert
                  type="error"
                  title={taskError(features.error)}
                  action={
                    <Button onClick={() => void features.refetch()}>
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
                      disabled={mutation.isPending || reloading || !!merge}
                    >
                      <legend>影响功能（可多选，可为空）</legend>
                      {features.data?.items.map((f) => (
                        <label key={f.id} style={{ display: "block" }}>
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
            disabled={mutation.isPending || reloading || !!merge}
            style={{ border: 0, padding: 0 }}
          >
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
            <label htmlFor="task-description">任务说明</label>
            <Controller
              name="description"
              control={control}
              rules={{ maxLength: { value: 50000, message: "最多50000字" } }}
              render={({ field }) => (
                <Input.TextArea {...field} id="task-description" rows={4} />
              )}
            />
            {errors.description && (
              <p role="alert">{errors.description.message}</p>
            )}
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
                  <Button onClick={() => void members.refetch()}>
                    重试项目成员
                  </Button>
                }
              />
            )}
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
                            new Date(field.value).getTimezoneOffset() * 60000,
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
          </fieldset>
          <Space>
            <Button onClick={close} disabled={mutation.isPending || reloading}>
              取消
            </Button>
            <Button
              type="primary"
              htmlType="submit"
              loading={mutation.isPending}
              disabled={
                !writable || reloading || !!merge || conflict || !!reloadError
              }
            >
              保存
            </Button>
          </Space>
        </form>
      </Modal>
    </section>
  );
}
