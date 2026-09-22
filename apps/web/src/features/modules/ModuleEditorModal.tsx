import React, { useEffect, useRef, useState } from "react";
import { Alert, Button, Input } from "antd";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { Controller, useForm } from "react-hook-form";
import {
  ApiError,
  type InpulseApiClient,
  type ModuleItem,
} from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
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

/** 一次模块编辑请求；`null` 表示弹层关闭。 */
export type ModuleEditorRequest = {
  readonly action: ModuleChange["action"];
  readonly item?: ModuleItem;
};

/**
 * 模块编辑器弹层：新增、编辑、归档、恢复四种动作共用同一份表单与冲突处理。
 * 模块列表页（模块卡「编辑模块」/「归档」）与模块详情页头部（设计师稿
 * catalog.tsx L55-60 的「编辑模块」「归档模块」）都复用本组件，避免两处实现
 * 出现漂移；动作选择由宿主页面通过 `request` 驱动。
 */
export function ModuleEditorModal({
  projectId,
  client,
  projectName,
  request,
  onClose,
  onSaved,
  canArchive = false,
  onLifecycleRequest,
}: {
  projectId: number;
  client?: InpulseApiClient | undefined;
  projectName: string | null;
  request: ModuleEditorRequest | null;
  onClose: () => void;
  onSaved?: (() => void) | undefined;
  /**
   * ADR-039：当前用户是否可以归档/恢复本模块，即系统管理员或本项目
   * 任意活跃成员。默认 false，由宿主按项目角色传入。
   */
  canArchive?: boolean | undefined;
  /** 宿主把弹层切到归档/恢复动作；未提供时底部不渲染生命周期入口。 */
  onLifecycleRequest?:
    ((action: "archive" | "restore", item: ModuleItem) => void) | undefined;
}) {
  const { query, mutation } = useModules(projectId, client);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [merge, setMerge] = useState<Merge | null>(null);
  // 正在编辑的模块快照：合并冲突或重新拉取最新版本后，`If-Match` 必须用最新
  // 行版本，所以基准项要能被更新，不能一直用打开弹层那一刻的旧快照。
  const [baseItem, setBaseItem] = useState<ModuleItem | undefined>(
    request?.item,
  );
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
  const selection: {
    action: ModuleChange["action"];
    item?: ModuleItem;
  } | null =
    request === null
      ? null
      : { action: request.action, ...(baseItem ? { item: baseItem } : {}) };

  // 每次动作切换（含同一模块的编辑 → 归档）都要回到干净状态：
  // 重排编辑代数以丢弃过期的 reload 结果，并清空上一次的冲突与错误。
  const requestKey =
    request === null
      ? null
      : request.action + ":" + (request.item ? request.item.id : "new");
  useEffect(() => {
    if (request === null) return;
    editGeneration.current += 1;
    setMerge(null);
    setBaseItem(request.item);
    setReloadError(null);
    setReloading(false);
    mutation.reset();
    reset({
      name: request.item?.name ?? "",
      description: request.item?.description ?? "",
      reason: "",
    });
    // 依赖只取 requestKey：mutation 与 reset 是 react-query / react-hook-form
    // 的稳定引用，按下标展开不会带来额外的重跑。
  }, [requestKey]);

  const close = () => {
    if (submitting.current) return;
    editGeneration.current += 1;
    setMerge(null);
    onClose();
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
      onClose();
      onSaved?.();
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
        setBaseItem(item);
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
    setBaseItem(merge.latest);
    setMerge(null);
    mutation.reset();
  };
  const lifecycle =
    selection?.action === "archive" || selection?.action === "restore";
  // ADR-033：编辑既有模块时，若当前用户可管理本项目资源，弹层底部直接给出
  // 归档/恢复入口，与列表页、模块详情页头部复用同一套动作与服务端门禁。
  const archiveTarget =
    canArchive && selection?.action === "update" && selection.item
      ? selection.item
      : null;
  const conflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;
  const modalTitle =
    selection?.action === "create"
      ? "新增模块"
      : selection?.action === "update"
        ? "编辑模块"
        : selection?.action === "archive"
          ? "归档模块"
          : "恢复模块";
  return (
    <>
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
                ? "归档后模块及下级内容不可写，历史将保留。"
                : selection?.action === "restore"
                  ? "恢复模块本身的可写状态，不改变下级资源各自的归档状态。"
                  : "名称与说明会保留完整的版本与审计历史。"}
            </p>
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
            {archiveTarget && (
              <Button
                className="secondary-button footer-leading"
                disabled={mutation.isPending || reloading || !!merge}
                onClick={() =>
                  onLifecycleRequest?.(
                    archiveTarget.status === "ARCHIVED" ? "restore" : "archive",
                    archiveTarget,
                  )
                }
              >
                {archiveTarget.status === "ARCHIVED" ? "恢复模块" : "归档模块"}
              </Button>
            )}
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
    </>
  );
}
