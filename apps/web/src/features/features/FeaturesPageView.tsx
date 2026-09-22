import { ExternalLinksPanel } from "@features/external-links/ExternalLinksPanel";
import { SimilarFeatures } from "./SimilarFeatures";
import { TasksPanel } from "../tasks/TasksPanel";
import React, { lazy, Suspense, useRef, useState } from "react";
import { Alert, Button, Input, Spin } from "antd";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  type InpulseApiClient,
  type FeatureItem,
} from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { isCardClick } from "@features/common/card-click";
import { resourceLifecycleLabel } from "@features/common/resource-lifecycle";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSegmented,
  CalmTabs,
} from "@features/common/components/Calm";
import { useModules } from "@features/modules/module-query";
import {
  ModuleEditorModal,
  type ModuleEditorRequest,
} from "@features/modules/ModuleEditorModal";
import {
  canManageProjectResources,
  useProjectDetail,
} from "@features/projects/project-query";
import { useTasks } from "@features/tasks/task-query";
import type { TaskLocation } from "@features/tasks/task-links";
import {
  featureErrorMessage,
  useFeatures,
  type FeatureChange,
} from "./feature-query";

/**
 * 聚合组详情里的成员任务就地打开任务详情（与任务中心同一实现：状态推进、编辑、
 * 迭代记录、合并与外部链接等写入口全在同一处）。按需加载，功能档案的初始包
 * 不引入任务详情的完整实现。
 */
const TaskDetailOverlay = lazy(
  () => import("@features/tasks/TaskDetailOverlay"),
);

type Values = {
  name: string;
  currentBehavior: string;
  acceptanceCriteria: string;
  reason: string;
  tags: string;
};
const editableFields = [
  "name",
  "currentBehavior",
  "acceptanceCriteria",
  "tags",
] as const;
type EditableField = (typeof editableFields)[number];
const fieldLabels = {
  name: "功能名称",
  currentBehavior: "当前功能说明",
  acceptanceCriteria: "验收标准",
  tags: "标签",
};
type Merge = {
  base: FeatureItem;
  draft: Values;
  latest: FeatureItem;
  values: Values;
  conflicts: EditableField[];
  choices: Partial<Record<EditableField, "draft" | "latest">>;
};
const fieldValue = (item: FeatureItem, field: EditableField): string =>
  field === "tags" ? item.tags.join("\n") : item[field];
const formatStamp = (value: string) => value.replace("T", " ").slice(0, 16);
export function FeaturesPageView({
  projectId,
  moduleId,
  featureId,
  isAdmin,
  client,
}: {
  projectId: number;
  moduleId: number;
  featureId?: number | undefined;
  isAdmin: boolean;
  client?: InpulseApiClient | undefined;
}) {
  const { query, mutation } = useFeatures(
    projectId,
    moduleId,
    featureId,
    client,
  );
  const moduleQuery = useModules(projectId, client);
  const moduleTasks = useTasks(
    { projectId, moduleId, featureId: null },
    client,
    { impactOptions: false },
  );
  const navigate = useNavigate();
  const [selection, setSelection] = useState<{
    action: FeatureChange["action"];
    item?: FeatureItem;
  } | null>(null);
  const [success, setSuccess] = useState(false);
  // 模块本体的编辑/归档/恢复与模块列表页共用同一个编辑器弹层。
  const [moduleRequest, setModuleRequest] =
    useState<ModuleEditorRequest | null>(null);
  const [moduleSuccess, setModuleSuccess] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [merge, setMerge] = useState<Merge | null>(null);
  const [display, setDisplay] = useState<"cards" | "list">("cards");
  const [search, setSearch] = useState("");
  /** 聚合组弹窗里点击成员任务标题后要就地打开的任务（null 表示弹层关闭）。 */
  const [taskTarget, setTaskTarget] = useState<TaskLocation | null>(null);
  const editGeneration = useRef(0);
  const submitting = useRef(false);
  const {
    control,
    handleSubmit,
    reset,
    getValues,
    watch,
    formState: { errors },
  } = useForm<Values>({
    defaultValues: {
      name: "",
      currentBehavior: "",
      acceptanceCriteria: "",
      reason: "",
      tags: "",
    },
  });
  const open = (action: FeatureChange["action"], item?: FeatureItem) => {
    editGeneration.current += 1;
    setMerge(null);
    setSelection({ action, ...(item ? { item } : {}) });
    reset({
      name: item?.name ?? "",
      currentBehavior: item?.currentBehavior ?? "",
      acceptanceCriteria: item?.acceptanceCriteria ?? "",
      reason: "",
      tags: item?.tags.join("\n") ?? "",
    });
    mutation.reset();
    setReloadError(null);
    setSuccess(false);
  };
  const onOpenFeature = (nextFeatureId: number) =>
    navigate(
      "/projects/" +
        projectId +
        "/modules/" +
        moduleId +
        "/features/" +
        nextFeatureId,
    );
  const save = handleSubmit(async (values) => {
    if (
      !selection ||
      submitting.current ||
      reloading ||
      merge ||
      conflict ||
      reloadError
    )
      return;
    submitting.current = true;
    try {
      await mutation.mutateAsync({ ...selection, ...values });
      setSelection(null);
      setSuccess(true);
      reset();
    } catch {
      /* Mutation retains the error and form remains mounted. */
    } finally {
      submitting.current = false;
    }
  });
  const reload = async () => {
    const generation = editGeneration.current;
    const draft = getValues();
    setReloading(true);
    try {
      const latest = await query.refetch();
      if (generation !== editGeneration.current) return;
      if (latest.error) {
        setReloadError(featureErrorMessage(latest.error));
        return;
      }
      if (selection?.item) {
        const item = latest.data?.items.find(
          (value) => value.id === selection.item!.id,
        );
        if (!item) {
          setReloadError("功能已不可访问，请取消编辑。");
          return;
        }
        if (selection.action === "update") {
          if (item.status !== "ACTIVE") {
            setReloadError(
              "功能已归档，草稿已保留，请取消编辑并在恢复后重试。",
            );
            return;
          }
          const values = { ...draft };
          const conflicts: EditableField[] = [];
          for (const field of editableFields) {
            // Compare the name as the request schema normalizes it.
            const normalize = (value: string) =>
              field === "name" ? value.trim() : value;
            const original = normalize(fieldValue(selection.item, field));
            const mine = normalize(draft[field]);
            const theirs = normalize(fieldValue(item, field));
            if (mine === original) values[field] = fieldValue(item, field);
            else if (theirs !== original && mine !== theirs)
              conflicts.push(field);
          }
          if (conflicts.length) {
            setMerge({
              base: selection.item,
              draft,
              latest: item,
              values,
              conflicts,
              choices: {},
            });
            setReloadError(null);
            return;
          }
          reset(values);
        }
        setSelection({ ...selection, item });
      }
      mutation.reset();
      setReloadError(null);
    } finally {
      setReloading(false);
    }
  };
  const applyMerge = () => {
    if (
      !merge ||
      !selection ||
      merge.conflicts.some((field) => !merge.choices[field])
    )
      return;
    const values = { ...merge.values };
    for (const field of merge.conflicts) {
      values[field] =
        merge.choices[field] === "draft"
          ? merge.draft[field]
          : fieldValue(merge.latest, field);
    }
    reset(values);
    setSelection({ ...selection, item: merge.latest });
    setMerge(null);
    mutation.reset();
  };
  const close = () => {
    if (submitting.current) return;
    editGeneration.current += 1;
    setSelection(null);
    setMerge(null);
  };
  const lifecycle =
    selection?.action === "archive" || selection?.action === "restore";
  const conflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;
  const modalTitle =
    selection?.action === "create"
      ? "新增功能"
      : selection?.action === "update"
        ? "编辑功能"
        : selection?.action === "archive"
          ? "归档功能"
          : "恢复功能";
  const activeItem = featureId
    ? query.data?.items.find((item) => item.id === featureId)
    : undefined;
  const currentModule = moduleQuery.query.data?.items.find(
    (item) => item.id === moduleId,
  );
  const projectQuery = useProjectDetail({ client, projectId });
  // ADR-034/ADR-039：模块与功能的归档/恢复对系统管理员或本项目任意活跃成员开放。
  const canArchiveResources = canManageProjectResources(
    isAdmin,
    projectQuery.data?.currentUserRole ?? null,
  );
  const projectName =
    projectQuery.data === undefined
      ? null
      : currentModule === undefined
        ? projectQuery.data.project.name
        : projectQuery.data.project.name + " / " + currentModule.name;
  const keyword = search.trim().toLocaleLowerCase();
  const visibleItems = (query.data?.items ?? []).filter(
    (item) =>
      keyword === "" ||
      item.name.toLocaleLowerCase().includes(keyword) ||
      item.code.toLocaleLowerCase().includes(keyword) ||
      item.currentBehavior.toLocaleLowerCase().includes(keyword),
  );
  return (
    <>
      <div className="features-page">
        {!featureId ? (
          <>
            <div className="page-header">
              <div>
                <div className="page-title-row">
                  <button
                    type="button"
                    className="title-back-button"
                    aria-label="返回模块列表"
                    title="返回模块列表"
                    onClick={() =>
                      navigate("/projects/" + projectId + "/modules")
                    }
                  >
                    <InpulseIcon name="chevronLeft" size={20} />
                  </button>
                  <h1>{currentModule ? currentModule.name : "功能档案"}</h1>
                </div>
                <p>
                  {currentModule?.description ||
                    "维护长期功能档案，说明修改会保留审计历史。"}
                </p>
              </div>
              <div className="catalog-actions">
                <Button
                  className="secondary-button"
                  disabled={!currentModule}
                  onClick={() =>
                    currentModule &&
                    setModuleRequest({ action: "update", item: currentModule })
                  }
                >
                  编辑模块
                </Button>
                {canArchiveResources && currentModule ? (
                  <Button
                    className="secondary-button"
                    onClick={() =>
                      setModuleRequest({
                        action:
                          currentModule.status === "ARCHIVED"
                            ? "restore"
                            : "archive",
                        item: currentModule,
                      })
                    }
                  >
                    {currentModule.status === "ARCHIVED"
                      ? "恢复模块"
                      : "归档模块"}
                  </Button>
                ) : null}
                {query.isSuccess && !query.data?.items.length ? null : (
                  <Button
                    className="primary-button"
                    disabled={
                      !query.data ||
                      query.isError ||
                      currentModule?.status === "ARCHIVED"
                    }
                    title={
                      currentModule?.status === "ARCHIVED"
                        ? "模块归档后不能新建功能或模块级任务"
                        : undefined
                    }
                    onClick={() => open("create")}
                  >
                    <InpulseIcon name="plus" size={15} />
                    新增功能
                  </Button>
                )}
              </div>
            </div>
            <details className="calm-disclosure module-information">
              <summary>
                {currentModule?.code ?? "模块资料"} ·{" "}
                {currentModule ? currentModule.name : "加载中"} ·{" "}
                {currentModule
                  ? resourceLifecycleLabel(
                      currentModule.status,
                      currentModule.stats.completedTaskCount,
                    )
                  : "进行中"}
              </summary>
              <h4>模块说明</h4>
              <p>
                {currentModule?.description || "尚未补充，可通过编辑模块完善。"}
              </p>
              <small>
                功能 {query.data?.items.length ?? 0} 个 · 模块级任务{" "}
                {moduleTasks.query.data?.items.length ?? 0} 项
              </small>
            </details>
            <CalmTabs
              className="calm-tabs module-work-tabs"
              label="模块工作区"
              activeKey="功能目录"
              onChange={(key) => {
                if (key === "模块级任务")
                  navigate(
                    "/projects/" +
                      projectId +
                      "/modules/" +
                      moduleId +
                      "/tasks",
                  );
              }}
              items={[
                {
                  key: "功能目录",
                  label: <>功能目录 {query.data?.items.length ?? 0}</>,
                },
                {
                  key: "模块级任务",
                  label: (
                    <>模块级任务 {moduleTasks.query.data?.items.length ?? 0}</>
                  ),
                },
              ]}
            />
            {success && <Alert type="success" showIcon title="功能操作成功" />}
            {moduleSuccess && (
              <Alert type="success" showIcon title="模块操作成功" />
            )}
            {query.isPending ? (
              <div className="calm-state">
                <Spin />
                <span>正在加载功能</span>
              </div>
            ) : query.isError ? (
              <Alert
                type="error"
                title={featureErrorMessage(query.error)}
                action={
                  <Button
                    className="secondary-button"
                    onClick={() => void query.refetch()}
                  >
                    重试
                  </Button>
                }
              />
            ) : !query.data?.items.length ? (
              <CalmEmptyState
                icon="code"
                title="暂无功能"
                description="为当前模块创建长期功能档案，后续任务与迭代将围绕它展开。"
              >
                <Button
                  className="primary-button"
                  disabled={currentModule?.status === "ARCHIVED"}
                  onClick={() => open("create")}
                >
                  <InpulseIcon name="plus" size={15} />
                  新增功能
                </Button>
              </CalmEmptyState>
            ) : (
              <>
                <div className="calm-feature-toolbar">
                  <h3>功能</h3>
                  <div className="feature-view-controls">
                    <CalmSegmented
                      label="功能展示方式"
                      value={display}
                      options={[
                        { value: "cards", label: "卡片" },
                        { value: "list", label: "列表" },
                      ]}
                      onChange={setDisplay}
                    />
                    <div className="task-search">
                      <InpulseIcon name="search" size={15} />
                      <input
                        aria-label="搜索当前模块的功能"
                        placeholder="搜索当前模块的功能"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                      />
                    </div>
                  </div>
                </div>
                {visibleItems.length === 0 ? (
                  <CalmEmptyState
                    icon="search"
                    title="没有匹配的功能"
                    description="调整关键词后重试，或清空搜索查看当前模块的全部功能。"
                  >
                    <Button
                      className="secondary-button"
                      onClick={() => setSearch("")}
                    >
                      清空搜索
                    </Button>
                  </CalmEmptyState>
                ) : display === "list" ? (
                  <div className="feature-list-scroll">
                    <table className="feature-list-table">
                      <thead>
                        <tr>
                          <th scope="col">功能</th>
                          <th scope="col">编号</th>
                          <th scope="col">状态</th>
                          <th scope="col">标签</th>
                          <th scope="col">最近更新</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleItems.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <Button
                                className="feature-list-open"
                                href={
                                  "/projects/" +
                                  projectId +
                                  "/modules/" +
                                  moduleId +
                                  "/features/" +
                                  item.id
                                }
                              >
                                <strong>{item.name}</strong>
                                <span>
                                  {item.currentBehavior || "暂无功能说明"}
                                </span>
                              </Button>
                            </td>
                            <td>
                              <InpulseIcon name="code" size={14} /> {item.code}
                            </td>
                            <td>
                              <CalmBadge
                                tone={
                                  item.status === "ACTIVE" ? "blue" : "amber"
                                }
                              >
                                {item.status === "ACTIVE" ? "进行中" : "已归档"}
                              </CalmBadge>
                            </td>
                            <td>
                              {item.tags.length ? item.tags.join("、") : "—"}
                            </td>
                            <td>{formatStamp(item.updatedAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="calm-feature-grid">
                    {visibleItems.map((item) => (
                      <article className="catalog-module-wrap" key={item.id}>
                        <div
                          className={
                            "calm-feature-card" +
                            (item.status === "ARCHIVED" ? " card-archived" : "")
                          }
                          onClick={(event) => {
                            if (!isCardClick(event)) return;
                            onOpenFeature(item.id);
                          }}
                          onKeyDown={(event) => {
                            if (event.key !== "Enter" && event.key !== " ")
                              return;
                            if (event.target !== event.currentTarget) return;
                            event.preventDefault();
                            onOpenFeature(item.id);
                          }}
                          tabIndex={0}
                        >
                          <div className="calm-card-top">
                            <span className="feature-symbol">
                              <InpulseIcon name="code" size={21} />
                            </span>
                            <span className="task-id">{item.code}</span>
                          </div>
                          <h2>{item.name}</h2>
                          <div className="task-card-badges">
                            <CalmBadge
                              tone={item.status === "ACTIVE" ? "blue" : "amber"}
                            >
                              {item.status === "ACTIVE" ? "进行中" : "已归档"}
                            </CalmBadge>
                            {item.tags.slice(0, 3).map((tag) => (
                              <CalmBadge key={tag} tone="violet">
                                {tag}
                              </CalmBadge>
                            ))}
                          </div>
                          <p>{item.currentBehavior || "暂无功能说明"}</p>
                          <div className="card-footer">
                            <span>
                              {item.stats.openTaskCount} 项待办 ·{" "}
                              {item.stats.recordCount} 条迭代
                            </span>
                          </div>
                        </div>
                        <span className="catalog-edit-link">
                          {item.status === "ACTIVE" && (
                            <Button
                              className="text-button"
                              onClick={() => open("update", item)}
                            >
                              编辑功能
                            </Button>
                          )}
                          {/* ADR-034：归档入口只在「编辑功能」弹窗底部提供，
                              卡片上仅保留已归档功能的恢复入口。 */}
                          {canArchiveResources &&
                            item.status === "ARCHIVED" && (
                              <Button
                                className="text-button"
                                data-testid={"feature-lifecycle-" + item.id}
                                onClick={() => open("restore", item)}
                              >
                                恢复功能
                              </Button>
                            )}
                        </span>
                      </article>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        ) : query.isPending ? (
          <div className="calm-state">
            <Spin />
            <span>正在加载功能详情</span>
          </div>
        ) : query.isError ? (
          <Alert
            type="error"
            title={featureErrorMessage(query.error)}
            action={
              <Button
                className="secondary-button"
                onClick={() => void query.refetch()}
              >
                重试
              </Button>
            }
          />
        ) : !activeItem ? (
          <CalmEmptyState
            icon="code"
            title="功能不存在或无法访问"
            description="该功能可能已从当前项目模块移除，或有权限限制。"
          />
        ) : (
          // 系统目录树（侧栏）承担模块内功能切换后，详情页不再渲染左栏
          // feature-switcher，返回入口由标题左侧的返回箭头提供。
          <div className="feature-document">
            <header className="feature-modal-header">
              <div>
                <div className="feature-title-row">
                  <button
                    type="button"
                    className="title-back-button"
                    aria-label="返回功能列表"
                    title="返回功能列表"
                    onClick={() =>
                      navigate(
                        "/projects/" +
                          projectId +
                          "/modules/" +
                          moduleId +
                          "/features",
                      )
                    }
                  >
                    <InpulseIcon name="chevronLeft" size={20} />
                  </button>
                  <h2>{activeItem.name}</h2>
                </div>
                <p>{activeItem.currentBehavior || "尚未补充当前功能说明。"}</p>
                <div className="task-modal-badges">
                  {/* 功能编号不在页头展示，保留右侧「功能档案」里的编号。 */}
                  <CalmBadge
                    tone={activeItem.status === "ACTIVE" ? "blue" : "amber"}
                  >
                    {activeItem.status === "ACTIVE" ? "进行中" : "已归档"}
                  </CalmBadge>
                  {/* 标签与状态并列成小徽章，放在状态和更新时间之间。 */}
                  {activeItem.tags.map((tag) => (
                    <CalmBadge key={tag} tone="violet">
                      {tag}
                    </CalmBadge>
                  ))}
                  <CalmBadge tone="gray">
                    更新 {formatStamp(activeItem.updatedAt)}
                  </CalmBadge>
                </div>
              </div>
              <div className="catalog-actions">
                <ExternalLinksPanel
                  key={activeItem.id}
                  targetType="FEATURE"
                  targetId={activeItem.id}
                  client={client}
                />
                {activeItem.status === "ACTIVE" && (
                  <Button
                    className="secondary-button"
                    onClick={() => open("update", activeItem)}
                  >
                    编辑功能
                  </Button>
                )}
                {canArchiveResources && activeItem.status === "ARCHIVED" && (
                  <Button
                    className="secondary-button"
                    data-testid={"feature-detail-lifecycle-" + activeItem.id}
                    onClick={() => open("restore", activeItem)}
                  >
                    恢复功能
                  </Button>
                )}
              </div>
            </header>
            <div className="feature-modal-content">
              <div className="feature-overview-grid">
                <div className="feature-reading">
                  {/* 「当前功能说明」只在标题下方给出，正文不再重复一遍。
                      标签改由标题行的小徽章展示（状态与更新时间之间）。 */}
                  <section className="feature-task-section">
                    <TasksPanel
                      projectId={projectId}
                      moduleId={moduleId}
                      featureId={activeItem.id}
                      writable={activeItem.status === "ACTIVE"}
                      client={client}
                      isAdmin={isAdmin}
                      onOpenTask={setTaskTarget}
                    />
                  </section>
                  {/* 验收标准放到最底下：先看功能与任务，最后才是验收口径。 */}
                  <section>
                    <h3>验收标准</h3>
                    <p style={{ whiteSpace: "pre-wrap" }}>
                      {activeItem.acceptanceCriteria || "尚未填写验收标准"}
                    </p>
                  </section>
                  {/* 归档状态排在验收标准之后：它是附加说明，不再插在功能任务之前。 */}
                  {activeItem.status === "ARCHIVED" && (
                    <section>
                      <h3>归档状态</h3>
                      <p>归档历史仍可查看；恢复前不能在此功能新增下级内容。</p>
                    </section>
                  )}
                </div>
                <aside className="feature-facts">
                  <h3>功能档案</h3>
                  <dl>
                    <dt>编号</dt>
                    <dd>{activeItem.code}</dd>
                    <dt>所属项目</dt>
                    <dd>{projectQuery.data?.project?.name ?? "加载中"}</dd>
                    <dt>所属模块</dt>
                    <dd>{currentModule?.name ?? "加载中"}</dd>
                    <dt>创建人</dt>
                    <dd>{activeItem.createdByName ?? "名称暂不可用"}</dd>
                    <dt>数据版本</dt>
                    <dd>v{activeItem.rowVersion}</dd>
                    <dt>状态</dt>
                    <dd>
                      {activeItem.status === "ACTIVE" ? "进行中" : "已归档"}
                    </dd>
                  </dl>
                </aside>
              </div>
            </div>
          </div>
        )}
      </div>
      <Modal
        open={selection !== null}
        className="catalog-modal"
        eyebrow={projectName}
        title={modalTitle}
        tone={
          selection?.action === "archive"
            ? "danger"
            : selection?.action === "restore"
              ? "success"
              : undefined
        }
        icon={
          selection?.action === "archive"
            ? "alert"
            : selection?.action === "restore"
              ? "rotateCcw"
              : undefined
        }
        onCancel={close}
        mask={{ closable: !mutation.isPending }}
      >
        <form
          className="catalog-form calm-form"
          onSubmit={(event) => void save(event)}
        >
          <div className="dialog-form">
            <p className="permission-hint">
              <InpulseIcon name="shield" size={14} />
              {selection?.action === "archive"
                ? "归档后功能及下级内容不可写，历史将保留。"
                : selection?.action === "restore"
                  ? "恢复功能本身的可写状态，不改变下级资源各自的归档状态。"
                  : "只维护长期档案；任务与迭代记录由对应能力独立管理。"}
            </p>
            {lifecycle ? (
              <div className="calm-field">
                <label htmlFor="feature-reason">操作原因</label>
                <Controller
                  name="reason"
                  control={control}
                  rules={{
                    validate: (v) => v.trim().length > 0 || "请填写操作原因",
                    maxLength: { value: 2000, message: "原因最多 2000 字" },
                  }}
                  render={({ field }) => (
                    <Input.TextArea
                      {...field}
                      id="feature-reason"
                      disabled={mutation.isPending || reloading || !!merge}
                      rows={3}
                    />
                  )}
                />
                <p role="alert">{errors.reason?.message}</p>
              </div>
            ) : (
              <>
                <div className="calm-field">
                  <label htmlFor="feature-name">功能名称</label>
                  <Controller
                    name="name"
                    control={control}
                    rules={{
                      validate: (v) => v.trim().length > 0 || "请填写功能名称",
                      maxLength: { value: 500, message: "名称最多 500 字" },
                    }}
                    render={({ field }) => (
                      <Input
                        {...field}
                        id="feature-name"
                        disabled={mutation.isPending || reloading || !!merge}
                      />
                    )}
                  />
                  <p role="alert">{errors.name?.message}</p>
                  {selection?.action === "create" && (
                    <SimilarFeatures
                      projectId={projectId}
                      moduleId={moduleId}
                      name={watch("name")}
                      client={client}
                    />
                  )}
                </div>
                <div className="calm-field">
                  <label htmlFor="feature-currentBehavior">当前功能说明</label>
                  <Controller
                    name="currentBehavior"
                    control={control}
                    rules={{
                      maxLength: {
                        value: 50000,
                        message: "说明最多 50000 字",
                      },
                    }}
                    render={({ field }) => (
                      <Input.TextArea
                        {...field}
                        id="feature-currentBehavior"
                        rows={5}
                        disabled={mutation.isPending || reloading || !!merge}
                      />
                    )}
                  />
                  <p role="alert">{errors.currentBehavior?.message}</p>
                </div>
                <div className="calm-field">
                  <label htmlFor="feature-acceptanceCriteria">
                    验收标准（选填）
                  </label>
                  <Controller
                    name="acceptanceCriteria"
                    control={control}
                    rules={{
                      maxLength: {
                        value: 50000,
                        message: "验收标准最多 50000 字",
                      },
                    }}
                    render={({ field }) => (
                      <Input.TextArea
                        {...field}
                        id="feature-acceptanceCriteria"
                        rows={5}
                        disabled={mutation.isPending || reloading || !!merge}
                      />
                    )}
                  />
                  <p role="alert">{errors.acceptanceCriteria?.message}</p>
                </div>
                <div className="calm-field">
                  <label htmlFor="feature-tags">
                    标签（每行一个，最多 50 个）
                  </label>
                  <Controller
                    name="tags"
                    control={control}
                    rules={{
                      validate: (value) =>
                        value.split("\n").filter((tag) => tag.trim()).length <=
                          50 || "标签最多 50 个",
                    }}
                    render={({ field }) => (
                      <Input.TextArea
                        {...field}
                        id="feature-tags"
                        rows={2}
                        disabled={mutation.isPending || reloading || !!merge}
                      />
                    )}
                  />
                  <p role="alert">{errors.tags?.message}</p>
                </div>
              </>
            )}
            {mutation.isError && (
              <Alert type="error" title={featureErrorMessage(mutation.error)} />
            )}
            {reloadError && <Alert type="error" title={reloadError} />}
            {merge && (
              <section className="merge-panel" aria-label="解决编辑冲突">
                <div className="calm-section-title">
                  <div>
                    <h3>解决编辑冲突</h3>
                    <small>选择保留哪一版，应用后再提交最新版本。</small>
                  </div>
                </div>
                {merge.conflicts.map((field) => (
                  <div className="merge-choice" key={field}>
                    <h3>{fieldLabels[field]}存在冲突</h3>
                    <dl
                      style={{
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                      }}
                    >
                      <dt>编辑前</dt>
                      <dd>{fieldValue(merge.base, field) || "（空）"}</dd>
                      <dt>我的草稿</dt>
                      <dd>{merge.draft[field] || "（空）"}</dd>
                      <dt>服务端最新</dt>
                      <dd>{fieldValue(merge.latest, field) || "（空）"}</dd>
                    </dl>
                    <div className="catalog-actions">
                      <Button
                        className="secondary-button"
                        aria-pressed={merge.choices[field] === "draft"}
                        onClick={() =>
                          setMerge({
                            ...merge,
                            choices: { ...merge.choices, [field]: "draft" },
                          })
                        }
                      >
                        保留我的{fieldLabels[field]}
                      </Button>
                      <Button
                        className="secondary-button"
                        aria-pressed={merge.choices[field] === "latest"}
                        onClick={() =>
                          setMerge({
                            ...merge,
                            choices: { ...merge.choices, [field]: "latest" },
                          })
                        }
                      >
                        采用最新{fieldLabels[field]}
                      </Button>
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
              </section>
            )}
            {conflict && !merge && (
              <Button
                className="secondary-button"
                loading={reloading}
                onClick={() => void reload()}
              >
                加载最新版本后继续编辑
              </Button>
            )}
          </div>
          <div className="calm-action-footer">
            {/* ADR-034/ADR-039：功能归档/恢复入口与模块弹窗一致放在编辑弹窗底部；
                非本项目成员看不到，活跃成员可直接切到归档流程。 */}
            {selection?.action === "update" &&
            selection.item &&
            canArchiveResources ? (
              <Button
                className="secondary-button footer-leading"
                data-testid="feature-modal-lifecycle"
                disabled={mutation.isPending || reloading || !!merge}
                onClick={() =>
                  open(
                    selection.item!.status === "ARCHIVED"
                      ? "restore"
                      : "archive",
                    selection.item!,
                  )
                }
              >
                {selection.item.status === "ARCHIVED" ? "恢复" : "归档"}
              </Button>
            ) : null}
            <Button
              className="secondary-button"
              onClick={close}
              disabled={mutation.isPending}
            >
              取消
            </Button>
            <Button
              className="primary-button"
              htmlType="submit"
              loading={mutation.isPending}
              disabled={reloading || conflict || !!reloadError || !!merge}
            >
              {lifecycle ? "确认" : "保存"}
            </Button>
          </div>
        </form>
      </Modal>
      <ModuleEditorModal
        projectId={projectId}
        client={client}
        projectName={projectQuery.data?.project?.name ?? null}
        request={moduleRequest}
        onClose={() => setModuleRequest(null)}
        onSaved={() => setModuleSuccess(true)}
        canArchive={canArchiveResources}
        onLifecycleRequest={(action, item) =>
          setModuleRequest({ action, item })
        }
      />
      <Suspense fallback={null}>
        {taskTarget === null ? null : (
          <TaskDetailOverlay
            target={taskTarget}
            client={client}
            isAdmin={isAdmin}
            onClose={() => setTaskTarget(null)}
            onOpenTask={setTaskTarget}
          />
        )}
      </Suspense>
    </>
  );
}
