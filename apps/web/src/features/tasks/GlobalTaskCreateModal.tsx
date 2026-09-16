import { taskDetailPath, type TaskLocation } from "./task-links";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button } from "antd";
import {
  ApiError,
  createApiClient,
  type InpulseApiClient,
  type TaskEditRequest,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { CalmSegmented } from "@features/common/components/Calm";
import { useProjects } from "@features/projects/project-query";
import { useModules } from "@features/modules/module-query";
import { useFeatures } from "@features/features/feature-query";
import { isFirstLoad, taskError } from "./task-query";

/** 任务范围与后端路由一一对应：功能级走功能任务，模块级走模块任务。 */
type TaskScope = "FEATURE" | "MODULE";
type Priority = TaskEditRequest["priority"];

const priorityLabels: Record<Priority, string> = {
  LOW: "低",
  NORMAL: "普通",
  HIGH: "高",
  URGENT: "紧急",
};
const scopeOptions: ReadonlyArray<{ value: TaskScope; label: string }> = [
  { value: "FEATURE", label: "功能级" },
  { value: "MODULE", label: "模块级" },
];

function localDateTime(value: string | null): string {
  if (!value) return "";
  const at = new Date(value);
  return new Date(at.getTime() - at.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function linksOf(text: string): string[] {
  return [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
  ];
}

export interface GlobalTaskCreateModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly client?: InpulseApiClient | undefined;
  /** 从项目/模块/功能页面打开时预置归属，避免用户重复选择。 */
  readonly preset?:
    | {
        readonly projectId?: number;
        readonly moduleId?: number;
        readonly featureId?: number;
      }
    | undefined;
  readonly onCreated?: (taskId: number) => void;
  readonly onCreatedLocation?: ((task: TaskLocation) => void) | undefined;
}

/**
 * 跨项目新建任务。归属由用户显式选择后再启用表单，
 * 因为指派人列表与影响功能选项都必须先确定真实归属才能读取。
 */
export function GlobalTaskCreateModal({
  open,
  onClose,
  client,
  preset,
  onCreated,
  onCreatedLocation,
}: GlobalTaskCreateModalProps) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const cache = useQueryClient();
  const retryKeys = useRef(new Map<string, string>());

  const [scope, setScope] = useState<TaskScope>(
    preset?.featureId ? "FEATURE" : preset?.moduleId ? "MODULE" : "FEATURE",
  );
  const [projectId, setProjectId] = useState<number>(preset?.projectId ?? 0);
  const [moduleId, setModuleId] = useState<number>(preset?.moduleId ?? 0);
  const [featureId, setFeatureId] = useState<number>(preset?.featureId ?? 0);
  const [createdLocation, setCreatedLocation] = useState<TaskLocation | null>(
    null,
  );
  const [newModule, setNewModule] = useState("");
  const [newFeature, setNewFeature] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState<Priority>("NORMAL");
  const [assigneeId, setAssigneeId] = useState<number>(0);
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [impactFeatureIds, setImpactFeatureIds] = useState<number[]>([]);
  const [linkText, setLinkText] = useState("");
  const [invalid, setInvalid] = useState<string | null>(null);
  const [failedLinks, setFailedLinks] = useState<string[]>([]);

  const presetProjectId = preset?.projectId ?? 0;
  const presetModuleId = preset?.moduleId ?? 0;
  const presetFeatureId = preset?.featureId ?? 0;

  useEffect(() => {
    if (!open) return;
    setCreatedLocation(null);
    setScope(
      presetFeatureId ? "FEATURE" : presetModuleId ? "MODULE" : "FEATURE",
    );
    setProjectId(presetProjectId);
    setModuleId(presetModuleId);
    setFeatureId(presetFeatureId);
    setNewModule("");
    setNewFeature("");
    setTitle("");
    setDescription("");
    setPriority("NORMAL");
    setAssigneeId(0);
    setDueAt(null);
    setImpactFeatureIds([]);
    setLinkText("");
    setInvalid(null);
    setFailedLinks([]);
    retryKeys.current.clear();
  }, [open, presetProjectId, presetModuleId, presetFeatureId]);

  const projects = useProjects({ client, enabled: open });
  const modules = useModules(open ? projectId : 0, client);
  const features = useFeatures(
    open ? projectId : 0,
    moduleId,
    undefined,
    client,
  );

  const targetReady =
    projectId > 0 &&
    (moduleId > 0 || (moduleId === -1 && newModule.trim().length > 0)) &&
    (scope === "MODULE" ||
      featureId > 0 ||
      (featureId === -1 && newFeature.trim().length > 0));

  const assignees = useQuery({
    queryKey: [
      "task-assignees",
      projectId,
      moduleId,
      scope === "MODULE" ? null : featureId,
    ],
    queryFn: ({ signal }) =>
      api.listActiveProjectMembers(projectId, { signal }),
    retry: false,
    enabled: open && projectId > 0,
  });

  const impactOptions = useQuery({
    queryKey: ["task-impact-options", projectId, moduleId],
    queryFn: ({ signal }) => api.listFeatures(projectId, moduleId, { signal }),
    retry: false,
    enabled: open && scope === "MODULE" && projectId > 0 && moduleId > 0,
  });

  function keyFor(signature: string): string {
    const existing = retryKeys.current.get(signature);
    if (existing) return existing;
    const created = createIdempotencyKey("task");
    retryKeys.current.set(signature, created);
    return created;
  }

  const mutation = useMutation({
    retry: false,
    mutationFn: async () => {
      const body: TaskEditRequest = {
        title: title.trim(),
        description,
        priority,
        assigneeId,
        dueAt,
      };
      const impacts = [...new Set(impactFeatureIds)].sort((a, b) => a - b);
      const init = {
        headers: {
          "x-csrf-token": (await api.issueCsrfToken()).csrfToken,
          "Idempotency-Key": keyFor(
            JSON.stringify([
              projectId,
              moduleId,
              featureId,
              scope,
              body,
              impacts,
              newModule,
              newFeature,
            ]),
          ),
        },
      };
      const createdScope =
        moduleId === -1 || (scope === "FEATURE" && featureId === -1)
          ? await api.createTaskWithScope(
              projectId,
              {
                module:
                  moduleId === -1
                    ? {
                        kind: "new",
                        input: { name: newModule.trim(), description: "" },
                      }
                    : { kind: "existing", id: moduleId },
                feature:
                  scope === "MODULE"
                    ? null
                    : featureId === -1
                      ? {
                          kind: "new",
                          input: {
                            name: newFeature.trim(),
                            currentBehavior: "",
                            acceptanceCriteria: "",
                            tags: [],
                          },
                        }
                      : { kind: "existing", id: featureId },
                task: body,
                impactFeatureIds: scope === "MODULE" ? impacts : [],
              },
              init,
            )
          : null;
      const task = createdScope
        ? { id: createdScope.taskId }
        : scope === "MODULE"
          ? await api.createModuleTask(
              projectId,
              moduleId,
              { ...body, impactFeatureIds: impacts },
              init,
            )
          : await api.createTask(projectId, moduleId, featureId, body, init);
      // 关联链接是创建后的独立写入：任务已落库时只报告未成功的链接，
      // 不用回滚任务，避免用户丢失已填写的表单。
      const rejected: string[] = [];
      for (const url of linksOf(linkText)) {
        try {
          const currentLinks = await api.listExternalLinks("TASK", task.id);
          await api.addExternalLink(
            "TASK",
            task.id,
            { url },
            {
              headers: {
                "x-csrf-token": init.headers["x-csrf-token"],
                "If-Match": `"${currentLinks.rowVersion}"`,
                "Idempotency-Key": keyFor(
                  JSON.stringify(["link", task.id, url]),
                ),
              },
            },
          );
        } catch {
          rejected.push(url);
        }
      }
      return {
        task,
        rejected,
        location: createdScope ?? {
          projectId,
          moduleId,
          featureId: scope === "MODULE" ? null : featureId,
          taskId: task.id,
        },
      };
    },
    onSuccess: async ({ task, rejected, location }) => {
      retryKeys.current.clear();
      setFailedLinks(rejected);
      setCreatedLocation(location);
      await Promise.all(
        [
          "tasks",
          "modules",
          "features",
          "activity",
          "search",
          "notifications",
          "my-tasks",
          "my-task-groups",
          "project-overview",
          "task-groups",
        ].map((key) => cache.invalidateQueries({ queryKey: [key] })),
      );
      // 任务已经落库，无论链接是否全部关联成功都要通知调用方；
      // 只有全部成功才自动关闭，否则保留弹窗让用户看到失败明细。
      onCreated?.(task.id);
      if (rejected.length === 0) {
        reset();
        onClose();
        onCreatedLocation?.(location);
      }
    },
  });

  function reset(): void {
    setCreatedLocation(null);
    setNewModule("");
    setNewFeature("");
    setTitle("");
    setDescription("");
    setPriority("NORMAL");
    setAssigneeId(0);
    setDueAt(null);
    setImpactFeatureIds([]);
    setLinkText("");
    setInvalid(null);
    setFailedLinks([]);
  }

  function close(): void {
    if (mutation.isPending) return;
    reset();
    onClose();
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (createdLocation || mutation.isPending) return;
    if (!targetReady) {
      setInvalid("请选择任务归属，或填写自定义模块、功能名称。");
      return;
    }
    if (title.trim().length === 0) {
      setInvalid("请输入任务标题。");
      return;
    }
    if (title.trim().length > 500) {
      setInvalid("任务标题最多 500 字。");
      return;
    }
    if (description.length > 50000) {
      setInvalid("任务说明最多 50000 字。");
      return;
    }
    if (assigneeId <= 0) {
      setInvalid("请选择项目活跃成员作为负责人。");
      return;
    }
    setInvalid(null);
    mutation.mutate();
  }

  const busy = mutation.isPending;
  const createError =
    mutation.isError && !(mutation.error instanceof ApiError)
      ? "任务服务暂时不可用，输入已保留，可重试。"
      : mutation.isError
        ? taskError(mutation.error)
        : null;

  return (
    <Modal
      open={open}
      className="catalog-modal"
      size="lg"
      eyebrow={
        projects.data?.items.find((p) => p.id === projectId)?.name ?? "任务中心"
      }
      title="新建任务"
      onCancel={close}
      mask={{ closable: !busy }}
      closable={!busy}
    >
      <form className="catalog-form calm-form" onSubmit={submit}>
        <div className="dialog-form">
          {createError && <Alert type="error" title={createError} />}
          {failedLinks.length > 0 && (
            <Alert
              type="warning"
              title={`任务已创建，但 ${failedLinks.length} 个 GitHub 链接未能关联：${failedLinks.join("、")}`}
            />
          )}
          {createdLocation && failedLinks.length > 0 && (
            <a href={taskDetailPath(createdLocation)}>
              查看已创建任务并管理 GitHub 链接
            </a>
          )}
          {invalid && <Alert type="warning" title={invalid} />}

          <fieldset
            className="task-form-fields"
            disabled={busy || createdLocation !== null}
          >
            <div className="calm-field">
              <label htmlFor="global-task-title">任务标题</label>
              <input
                id="global-task-title"
                value={title}
                maxLength={500}
                onChange={(event) => setTitle(event.target.value)}
              />
            </div>

            <div className="calm-field">
              <span
                className="field-label"
                title="功能级：推进一个具体功能；模块级：跨功能或模块整体工作。"
              >
                任务范围
              </span>
              <small>
                功能级关联具体功能；模块级用于跨功能或模块整体工作。
              </small>
              <CalmSegmented
                label="任务范围"
                options={scopeOptions}
                value={scope}
                onChange={(next) => {
                  setScope(next);
                  setAssigneeId(0);
                  if (next === "MODULE") setFeatureId(0);
                }}
              />
            </div>

            <div className="calm-field">
              <label htmlFor="global-task-project">所属项目</label>
              <select
                id="global-task-project"
                value={projectId}
                onChange={(event) => {
                  setProjectId(Number(event.target.value));
                  setModuleId(0);
                  setFeatureId(0);
                  setAssigneeId(0);
                  setImpactFeatureIds([]);
                }}
              >
                <option value={0}>请选择项目</option>
                {projects.data?.items.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              {projects.isError && (
                <p role="alert">项目列表加载失败，请稍后重试。</p>
              )}
            </div>

            <div className="calm-field">
              <label htmlFor="global-task-module">所属模块</label>
              <select
                id="global-task-module"
                value={moduleId}
                disabled={projectId === 0}
                onChange={(event) => {
                  setModuleId(Number(event.target.value));
                  setFeatureId(Number(event.target.value) === -1 ? -1 : 0);
                  setAssigneeId(0);
                  setImpactFeatureIds([]);
                }}
              >
                <option value={0}>
                  {projectId === 0 ? "请先选择项目" : "请选择模块"}
                </option>
                <option value={-1}>自定义 · 创建新模块</option>
                {modules.query.data?.items.map((module) => (
                  <option
                    key={module.id}
                    value={module.id}
                    disabled={module.status !== "ACTIVE"}
                  >
                    {module.name}
                  </option>
                ))}
              </select>
            </div>

            {moduleId === -1 && (
              <div className="calm-field">
                <label htmlFor="new-module-name">新模块名称</label>
                <input
                  id="new-module-name"
                  value={newModule}
                  maxLength={200}
                  onChange={(e) => setNewModule(e.target.value)}
                />
                <small>提交任务时一起创建。</small>
              </div>
            )}
            {modules.query.isError && (
              <p role="alert">模块加载失败，请重试。</p>
            )}
            {scope === "FEATURE" && (
              <div className="calm-field">
                <label htmlFor="global-task-feature">所属功能</label>
                <select
                  id="global-task-feature"
                  value={featureId}
                  disabled={moduleId === 0}
                  onChange={(event) => {
                    setFeatureId(Number(event.target.value));
                    setAssigneeId(0);
                  }}
                >
                  <option value={0}>
                    {moduleId === 0 ? "请先选择模块" : "请选择功能"}
                  </option>
                  <option value={-1}>自定义 · 创建新功能</option>
                  {features.query.data?.items.map((feature) => (
                    <option
                      key={feature.id}
                      value={feature.id}
                      disabled={feature.status !== "ACTIVE"}
                    >
                      {feature.name}
                      {feature.status === "ARCHIVED" ? "（已归档）" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {scope === "FEATURE" && featureId === -1 && (
              <div className="calm-field">
                <label htmlFor="new-feature-name">新功能名称</label>
                <input
                  id="new-feature-name"
                  value={newFeature}
                  maxLength={500}
                  onChange={(e) => setNewFeature(e.target.value)}
                />
                <small>
                  提交任务时一起创建，稍后可在功能档案补充说明与验收标准。
                </small>
              </div>
            )}
            <div className="calm-field">
              <label htmlFor="global-task-assignee">指派给</label>
              <select
                id="global-task-assignee"
                value={assigneeId}
                disabled={!targetReady}
                onChange={(event) => setAssigneeId(Number(event.target.value))}
              >
                <option value={0}>
                  {targetReady ? "请选择项目成员" : "请先选择任务归属"}
                </option>
                {assignees.data?.items.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
              {targetReady && isFirstLoad(assignees) && (
                <p>正在加载项目成员…</p>
              )}
              {assignees.isError && (
                <Alert
                  type="error"
                  title={taskError(assignees.error)}
                  action={
                    <Button
                      className="secondary-button"
                      onClick={() => void assignees.refetch()}
                    >
                      重试项目成员
                    </Button>
                  }
                />
              )}
            </div>

            <div className="form-row">
              <div className="calm-field">
                <label htmlFor="global-task-priority">优先级</label>
                <select
                  id="global-task-priority"
                  value={priority}
                  onChange={(event) =>
                    setPriority(event.target.value as Priority)
                  }
                >
                  {Object.entries(priorityLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="calm-field">
                <label htmlFor="global-task-due">截止时间</label>
                <input
                  id="global-task-due"
                  type="datetime-local"
                  value={localDateTime(dueAt)}
                  onChange={(event) =>
                    setDueAt(
                      event.target.value
                        ? new Date(event.target.value).toISOString()
                        : null,
                    )
                  }
                />
              </div>
            </div>

            <div className="calm-field">
              <label htmlFor="global-task-description">任务说明</label>
              <textarea
                id="global-task-description"
                rows={4}
                maxLength={50000}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            {scope === "MODULE" && (
              <fieldset className="calm-field task-impact-features">
                <legend>影响功能（可多选，可为空）</legend>
                {impactOptions.isError ? (
                  <Alert
                    type="error"
                    title={taskError(impactOptions.error)}
                    action={
                      <Button
                        className="secondary-button"
                        onClick={() => void impactOptions.refetch()}
                      >
                        重试影响功能
                      </Button>
                    }
                  />
                ) : (
                  impactOptions.data?.items.map((feature) => (
                    <label key={feature.id}>
                      <input
                        type="checkbox"
                        checked={impactFeatureIds.includes(feature.id)}
                        disabled={feature.status !== "ACTIVE"}
                        onChange={(event) =>
                          setImpactFeatureIds((current) =>
                            event.target.checked
                              ? [...new Set([...current, feature.id])].sort(
                                  (a, b) => a - b,
                                )
                              : current.filter((id) => id !== feature.id),
                          )
                        }
                      />
                      {feature.name}
                      {feature.status === "ARCHIVED" ? "（已归档）" : ""}
                    </label>
                  ))
                )}
              </fieldset>
            )}

            <div className="calm-field">
              <label htmlFor="global-task-links">GitHub 链接</label>
              <textarea
                id="global-task-links"
                rows={2}
                placeholder="每行一个链接，可选"
                value={linkText}
                onChange={(event) => setLinkText(event.target.value)}
              />
              <p>只接受 github.com 的 HTTPS 链接；受限域名会被拒绝。</p>
            </div>
          </fieldset>
        </div>
        <div className="calm-action-footer">
          <Button className="secondary-button" onClick={close} disabled={busy}>
            取消
          </Button>
          <Button
            className="primary-button"
            htmlType="submit"
            loading={busy}
            disabled={!targetReady || createdLocation !== null}
          >
            创建任务
          </Button>
        </div>
      </form>
    </Modal>
  );
}
