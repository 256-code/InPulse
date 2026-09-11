import { ExternalLinksPanel } from "@features/external-links/ExternalLinksPanel";
import { SimilarFeatures } from "./SimilarFeatures";
import { TasksPanel } from "../tasks/TasksPanel";
import React, { useRef, useState } from "react";
import { Alert, Button, Input, Modal, Spin } from "antd";
import { Controller, useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import {
  ApiError,
  type InpulseApiClient,
  type FeatureItem,
} from "@generated/api";
import { AdminReauthenticateModal } from "@features/auth/AdminReauthenticateModal";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { CalmBadge, CalmEmptyState } from "@features/common/components/Calm";
import { ProjectContextNav } from "@features/common/components/ProjectContextNav";
import { useModules } from "@features/modules/module-query";
import {
  featureErrorMessage,
  useFeatures,
  type FeatureChange,
} from "./feature-query";

type Values = {
  name: string;
  currentBehavior: string;
  reason: string;
  tags: string;
};
const editableFields = ["name", "currentBehavior", "tags"] as const;
type EditableField = (typeof editableFields)[number];
const fieldLabels = {
  name: "功能名称",
  currentBehavior: "当前功能说明",
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
  const navigate = useNavigate();
  const [selection, setSelection] = useState<{
    action: FeatureChange["action"];
    item?: FeatureItem;
  } | null>(null);
  const [reauthOpen, setReauthOpen] = useState(false);
  const [success, setSuccess] = useState(false);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [merge, setMerge] = useState<Merge | null>(null);
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
    defaultValues: { name: "", currentBehavior: "", reason: "", tags: "" },
  });
  const open = (action: FeatureChange["action"], item?: FeatureItem) => {
    editGeneration.current += 1;
    setMerge(null);
    setSelection({ action, ...(item ? { item } : {}) });
    reset({
      name: item?.name ?? "",
      currentBehavior: item?.currentBehavior ?? "",
      reason: "",
      tags: item?.tags.join("\n") ?? "",
    });
    mutation.reset();
    setReloadError(null);
    setSuccess(false);
  };
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
      ? "新建功能"
      : selection?.action === "update"
        ? "编辑功能"
        : selection?.action === "archive"
          ? "归档功能"
          : "恢复功能";
  const activeItem = featureId
    ? query.data?.items.find((item) => item.id === featureId)
    : undefined;
  return (
    <>
      <div className="features-page">
        {!featureId && (
          <ProjectContextNav
            modules={moduleQuery.query.data?.items ?? []}
            active={moduleId}
            onSelectOverview={() =>
              navigate("/projects/" + projectId + "/overview")
            }
            onSelectModule={(nextModuleId) =>
              navigate(
                "/projects/" +
                  projectId +
                  "/modules/" +
                  nextModuleId +
                  "/features",
              )
            }
          />
        )}
        <div className="feature-breadcrumbs">
          <Button
            className="back-button"
            href={"/projects/" + projectId + "/modules"}
          >
            <InpulseIcon name="arrowLeft" size={15} />
            返回模块列表
          </Button>
          {featureId && (
            <Button
              className="back-button"
              href={
                "/projects/" + projectId + "/modules/" + moduleId + "/features"
              }
            >
              返回功能列表
            </Button>
          )}
        </div>
        {!featureId ? (
          <>
            <div className="page-header">
              <div>
                <span className="eyebrow">
                  项目 {projectId} / 模块 {moduleId}
                </span>
                <h1>功能档案</h1>
                <p>维护长期功能档案，说明修改会保留审计历史。</p>
              </div>
              <div className="catalog-actions">
                {query.isSuccess && !query.data?.items.length ? null : (
                  <Button
                    className="primary-button"
                    disabled={!query.data || query.isError}
                    onClick={() => open("create")}
                  >
                    <InpulseIcon name="plus" size={15} />
                    新建功能
                  </Button>
                )}
              </div>
            </div>
            <p className="permission-hint">
              <InpulseIcon name="alert" size={14} />
              任务与迭代记录将在对应能力交付后开放；当前先沉淀功能名称、说明与标签。
            </p>
            {success && <Alert type="success" showIcon title="功能操作成功" />}
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
                  onClick={() => open("create")}
                >
                  <InpulseIcon name="plus" size={15} />
                  新建功能
                </Button>
              </CalmEmptyState>
            ) : (
              <div className="cards-grid calm-feature-grid feature-grid">
                {query.data.items.map((item) => (
                  <article
                    key={item.id}
                    className={
                      "calm-feature-card" +
                      (item.status === "ARCHIVED" ? " card-archived" : "")
                    }
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
                        {item.status === "ACTIVE" ? "正常" : "已归档"}
                      </CalmBadge>
                      {item.tags.slice(0, 3).map((tag) => (
                        <CalmBadge key={tag} tone="gray">
                          {tag}
                        </CalmBadge>
                      ))}
                    </div>
                    <p>{item.currentBehavior || "暂无功能说明"}</p>
                    <div className="card-footer">
                      <span>
                        <InpulseIcon name="gitBranch" size={14} />
                        功能档案
                      </span>
                      <Button
                        className="text-button"
                        href={
                          "/projects/" +
                          projectId +
                          "/modules/" +
                          moduleId +
                          "/features/" +
                          item.id
                        }
                      >
                        查看详情
                        <InpulseIcon name="chevronRight" size={14} />
                      </Button>
                    </div>
                    <div className="catalog-edit-link">
                      {item.status === "ACTIVE" && (
                        <Button
                          className="text-button"
                          onClick={() => open("update", item)}
                        >
                          编辑
                        </Button>
                      )}
                      {isAdmin && (
                        <Button
                          className="text-button"
                          onClick={() =>
                            open(
                              item.status === "ACTIVE" ? "archive" : "restore",
                              item,
                            )
                          }
                        >
                          {item.status === "ACTIVE" ? "归档" : "恢复"}
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
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
          <div className="feature-workspace">
            <nav className="feature-switcher" aria-label="模块内功能">
              <Button
                className="back-button"
                href={
                  "/projects/" +
                  projectId +
                  "/modules/" +
                  moduleId +
                  "/features"
                }
              >
                <InpulseIcon name="arrowLeft" size={14} />
                功能目录
              </Button>
              {query.data?.items.map((item) => (
                <Button
                  key={item.id}
                  className={
                    "feature-switcher-item" +
                    (item.id === featureId ? " active" : "")
                  }
                  href={
                    "/projects/" +
                    projectId +
                    "/modules/" +
                    moduleId +
                    "/features/" +
                    item.id
                  }
                >
                  <InpulseIcon name="code" size={15} />
                  {item.name}
                </Button>
              ))}
            </nav>
            <div className="feature-document">
              <header className="feature-modal-header">
                <div>
                  <span className="detail-label">
                    项目 {projectId} / 模块 {moduleId}
                  </span>
                  <h2>{activeItem.name}</h2>
                  <p>
                    {activeItem.currentBehavior || "尚未补充当前功能说明。"}
                  </p>
                  <div className="task-modal-badges">
                    <span className="task-id">{activeItem.code}</span>
                    <CalmBadge
                      tone={activeItem.status === "ACTIVE" ? "blue" : "amber"}
                    >
                      {activeItem.status === "ACTIVE" ? "正常" : "已归档"}
                    </CalmBadge>
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
                  {isAdmin && (
                    <Button
                      className="secondary-button"
                      onClick={() =>
                        open(
                          activeItem.status === "ACTIVE"
                            ? "archive"
                            : "restore",
                          activeItem,
                        )
                      }
                    >
                      {activeItem.status === "ACTIVE" ? "归档功能" : "恢复功能"}
                    </Button>
                  )}
                </div>
              </header>
              <div className="feature-modal-content">
                <div className="feature-overview-grid">
                  <div className="feature-reading">
                    <section>
                      <h3>当前功能说明</h3>
                      <p>{activeItem.currentBehavior || "暂无功能说明"}</p>
                    </section>
                    <section>
                      <h3>标签</h3>
                      {activeItem.tags.length ? (
                        <div className="tag-row">
                          {activeItem.tags.map((tag) => (
                            <CalmBadge key={tag}>{tag}</CalmBadge>
                          ))}
                        </div>
                      ) : (
                        <p>暂无标签，可在编辑功能时补充。</p>
                      )}
                    </section>
                    {activeItem.status === "ARCHIVED" && (
                      <section>
                        <h3>归档状态</h3>
                        <p>
                          归档历史仍可查看；恢复前不能在此功能新增下级内容。
                        </p>
                      </section>
                    )}
                    <section className="feature-task-section">
                      <TasksPanel
                        projectId={projectId}
                        moduleId={moduleId}
                        featureId={activeItem.id}
                        writable={activeItem.status === "ACTIVE"}
                        client={client}
                      />
                    </section>
                  </div>
                  <aside className="feature-facts">
                    <h3>功能档案</h3>
                    <dl>
                      <dt>编号</dt>
                      <dd>{activeItem.code}</dd>
                      <dt>所属项目</dt>
                      <dd>#{activeItem.projectId}</dd>
                      <dt>所属模块</dt>
                      <dd>#{activeItem.moduleId}</dd>
                      <dt>创建人</dt>
                      <dd>#{activeItem.createdBy}</dd>
                      <dt>数据版本</dt>
                      <dd>v{activeItem.rowVersion}</dd>
                      <dt>状态</dt>
                      <dd>
                        {activeItem.status === "ACTIVE" ? "正常" : "已归档"}
                      </dd>
                    </dl>
                  </aside>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      <Modal
        open={selection !== null}
        className="catalog-modal feature-editor-modal"
        title={modalTitle}
        onCancel={close}
        footer={null}
        mask={{ closable: !mutation.isPending }}
      >
        <div className="drawer-header">
          <span className="detail-label">功能</span>
          <h2>{modalTitle}</h2>
          <p>
            {selection?.action === "archive"
              ? "归档后功能及下级内容不可写，历史将保留。"
              : selection?.action === "restore"
                ? "恢复功能本身的可写状态，不改变下级资源各自的归档状态。"
                : "只维护长期档案；任务与迭代记录由对应能力独立管理。"}
          </p>
        </div>
        <form
          className="catalog-form calm-form"
          onSubmit={(event) => void save(event)}
        >
          <div className="dialog-form">
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
                <Button
                  className="secondary-button"
                  onClick={() => setReauthOpen(true)}
                  disabled={mutation.isPending || reloading || conflict}
                >
                  管理员安全验证
                </Button>
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
      <AdminReauthenticateModal
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onSuccess={() => {
          setReauthOpen(false);
          mutation.reset();
        }}
      />
    </>
  );
}
