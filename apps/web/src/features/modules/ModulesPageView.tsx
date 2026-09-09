import React, { useRef, useState } from "react";
import { Alert, Button, Input, Modal, Spin } from "antd";
import { Controller, useForm } from "react-hook-form";
import {
  ApiError,
  type InpulseApiClient,
  type ModuleItem,
} from "@generated/api";
import { AdminReauthenticateModal } from "@features/auth/AdminReauthenticateModal";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { CalmBadge, CalmEmptyState } from "@features/common/components/Calm";
import {
  moduleErrorMessage,
  useModules,
  type ModuleChange,
} from "./module-query";

type Values = { name: string; description: string; reason: string };
const editableFields = ["name", "description"] as const;
type EditableField = (typeof editableFields)[number];
const fieldLabels = { name: "模块名称", description: "模块说明" };
type Merge = {
  base: ModuleItem;
  draft: Values;
  latest: ModuleItem;
  values: Values;
  conflicts: EditableField[];
  choices: Partial<Record<EditableField, "draft" | "latest">>;
};
export function ModulesPageView({
  projectId,
  isAdmin,
  client,
}: {
  projectId: number;
  isAdmin: boolean;
  client?: InpulseApiClient | undefined;
}) {
  const { query, mutation } = useModules(projectId, client);
  const [selection, setSelection] = useState<{
    action: ModuleChange["action"];
    item?: ModuleItem;
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
    formState: { errors },
  } = useForm<Values>({
    defaultValues: { name: "", description: "", reason: "" },
  });
  const open = (action: ModuleChange["action"], item?: ModuleItem) => {
    editGeneration.current += 1;
    setMerge(null);
    setSelection({ action, ...(item ? { item } : {}) });
    reset({
      name: item?.name ?? "",
      description: item?.description ?? "",
      reason: "",
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
        setReloadError(moduleErrorMessage(latest.error));
        return;
      }
      if (selection?.item) {
        const item = latest.data?.items.find(
          (value) => value.id === selection.item!.id,
        );
        if (!item) {
          setReloadError("模块已不可访问，请取消编辑。");
          return;
        }
        if (selection.action === "update") {
          if (item.status !== "ACTIVE") {
            setReloadError(
              "模块已归档，草稿已保留，请取消编辑并在恢复后重试。",
            );
            return;
          }
          const values = { ...draft };
          const conflicts: EditableField[] = [];
          for (const field of editableFields) {
            // Compare the name as the request schema normalizes it.
            const normalize = (value: string) =>
              field === "name" ? value.trim() : value;
            const original = normalize(selection.item[field]);
            const mine = normalize(draft[field]);
            const theirs = normalize(item[field]);
            if (mine === original) values[field] = item[field];
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
          : merge.latest[field];
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
      ? "新建模块"
      : selection?.action === "update"
        ? "编辑模块"
        : selection?.action === "archive"
          ? "归档模块"
          : "恢复模块";
  return (
    <>
      <div className="module-workspace-page">
        <div className="page-header">
          <div>
            <span className="eyebrow">项目 {projectId} / 模块</span>
            <h1>模块管理</h1>
            <p>
              维护模块名称、说明和归档状态。未分类模块可编辑，身份保持不变。
            </p>
          </div>
          <div className="catalog-actions">
            {query.isSuccess && !query.data?.items.length ? null : (
              <Button
                className="primary-button"
                disabled={!query.data || query.isError}
                onClick={() => open("create")}
              >
                <InpulseIcon name="plus" size={15} />
                新建模块
              </Button>
            )}
          </div>
        </div>
        <p className="permission-hint">
          <InpulseIcon name="alert" size={14} />
          功能档案可从模块卡片进入；模块级任务与记录将在对应能力交付后开放。
        </p>
        {success && <Alert type="success" showIcon title="模块操作成功" />}
        {query.isPending ? (
          <div className="calm-state">
            <Spin />
            <span>正在加载模块</span>
          </div>
        ) : query.isError ? (
          <Alert
            type="error"
            title={moduleErrorMessage(query.error)}
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
            icon="boxes"
            title="暂无模块"
            description="项目创建时会自动生成未分类模块，可继续拆分为具体业务模块。"
          >
            <Button className="primary-button" onClick={() => open("create")}>
              <InpulseIcon name="plus" size={15} />
              新建模块
            </Button>
          </CalmEmptyState>
        ) : (
          <div className="cards-grid calm-feature-grid module-grid">
            {query.data.items.map((item) => (
              <article
                key={item.id}
                className={
                  "calm-feature-card module-card" +
                  (item.status === "ARCHIVED" ? " card-archived" : "")
                }
              >
                <div className="calm-card-top">
                  <span className="feature-symbol">
                    <InpulseIcon name="boxes" size={21} />
                  </span>
                  <span className="task-id">模块 #{item.id}</span>
                </div>
                <h2>{item.name}</h2>
                <div className="task-card-badges">
                  {item.kind === "UNCLASSIFIED" && (
                    <CalmBadge tone="violet">未分类</CalmBadge>
                  )}
                  <CalmBadge tone={item.status === "ACTIVE" ? "blue" : "amber"}>
                    {item.status === "ACTIVE" ? "正常" : "已归档"}
                  </CalmBadge>
                </div>
                <p>{item.description || "暂无模块说明"}</p>
                <details className="calm-disclosure module-information">
                  <summary>模块资料</summary>
                  <p>
                    {item.kind === "UNCLASSIFIED"
                      ? "该模块由项目创建流程生成，允许修改名称与说明，不可删除或改变未分类身份。"
                      : "当前项目的第一层业务分类，后续功能与任务建立在该模块之下。"}
                  </p>
                  {item.status === "ARCHIVED" && (
                    <p>归档历史仍可查看；恢复前不能在此模块新增下级内容。</p>
                  )}
                </details>
                <div className="card-footer">
                  <span>
                    <InpulseIcon name="code" size={14} />
                    功能档案入口
                  </span>
                  <Button
                    className="text-button"
                    href={
                      "/projects/" +
                      projectId +
                      "/modules/" +
                      item.id +
                      "/features"
                    }
                  >
                    查看功能
                    <InpulseIcon name="chevronRight" size={14} />
                  </Button>
                </div>
                <div className="catalog-edit-link">
                  <Button
                    className="text-button"
                    href={
                      "/projects/" +
                      projectId +
                      "/modules/" +
                      item.id +
                      "/tasks"
                    }
                  >
                    模块任务
                  </Button>
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
      </div>
      <Modal
        open={selection !== null}
        className="catalog-modal module-editor-modal"
        title={modalTitle}
        onCancel={close}
        footer={null}
        mask={{ closable: !mutation.isPending }}
      >
        <div className="drawer-header">
          <span className="detail-label">模块</span>
          <h2>{modalTitle}</h2>
          <p>
            {selection?.action === "archive"
              ? "归档后模块及下级内容不可写，历史将保留。"
              : selection?.action === "restore"
                ? "恢复模块本身的可写状态，不改变下级资源各自的归档状态。"
                : "名称与说明会保留完整的版本与审计历史。"}
          </p>
        </div>
        <form
          className="catalog-form calm-form"
          onSubmit={(event) => void save(event)}
        >
          <div className="dialog-form">
            {lifecycle ? (
              <div className="calm-field">
                <label htmlFor="module-reason">操作原因</label>
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
                      id="module-reason"
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
                  <label htmlFor="module-name">模块名称</label>
                  <Controller
                    name="name"
                    control={control}
                    rules={{
                      validate: (v) => v.trim().length > 0 || "请填写模块名称",
                      maxLength: { value: 200, message: "名称最多 200 字" },
                    }}
                    render={({ field }) => (
                      <Input
                        {...field}
                        id="module-name"
                        disabled={mutation.isPending || reloading || !!merge}
                      />
                    )}
                  />
                  <p role="alert">{errors.name?.message}</p>
                </div>
                <div className="calm-field">
                  <label htmlFor="module-description">模块说明</label>
                  <Controller
                    name="description"
                    control={control}
                    rules={{
                      maxLength: { value: 20000, message: "说明最多 20000 字" },
                    }}
                    render={({ field }) => (
                      <Input.TextArea
                        {...field}
                        id="module-description"
                        rows={5}
                        disabled={mutation.isPending || reloading || !!merge}
                      />
                    )}
                  />
                  <p role="alert">{errors.description?.message}</p>
                </div>
              </>
            )}
            {mutation.isError && (
              <Alert type="error" title={moduleErrorMessage(mutation.error)} />
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
                      <dd>{merge.base[field] || "（空）"}</dd>
                      <dt>我的草稿</dt>
                      <dd>{merge.draft[field] || "（空）"}</dd>
                      <dt>服务端最新</dt>
                      <dd>{merge.latest[field] || "（空）"}</dd>
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
