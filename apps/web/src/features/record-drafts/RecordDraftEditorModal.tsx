import React, { useEffect, useRef, useState } from "react";
import { Alert, Button, Input } from "antd";
import { Controller, useForm } from "react-hook-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { CalmSelect } from "@features/common/components/CalmSelect";
import { projectSelectOption } from "@features/common/project-select-option";
import { LeftoverEntriesField } from "@features/common/components/LeftoverEntriesField";
import { RecordMarkdown } from "@features/common/components/RecordMarkdown";
import { createIdempotencyKey } from "@shared/api/idempotency-key";
import {
  ApiError,
  type InpulseApiClient,
  type RecordDraftContent,
  type RecordDraftItem,
  type TaskRecordDraftsResponse,
} from "@generated/api";
import {
  fieldText,
  fields,
  labels,
  mergeRecordDraft,
  type Field,
} from "./record-content";
import { MY_RECORD_DRAFTS_QUERY_KEY } from "./record-drafts-query";
import { recordDraftErrorMessage } from "./record-draft-errors";
import "./record-drafts.css";

/**
 * 弹窗要处理的目标：编辑已有草稿 / 从任务创建来源草稿 / 新建迭代记录。
 * 每次传入新对象都视为一次「打开」，弹窗据此重置表单与冲突状态。
 */
export type RecordDraftEditorTarget =
  | { readonly kind: "item"; readonly item: RecordDraftItem }
  | {
      readonly kind: "source";
      readonly source: TaskRecordDraftsResponse["source"];
    }
  | { readonly kind: "independent" };

const empty: RecordDraftContent = {
  title: "",
  contextProblem: "",
  changeSolution: "",
  resultVerification: "",
  remainingIssues: [],
};
const content = (item: RecordDraftContent): RecordDraftContent => ({
  title: item.title,
  contextProblem: item.contextProblem,
  changeSolution: item.changeSolution,
  resultVerification: item.resultVerification,
  remainingIssues: item.remainingIssues,
});
type Merge = ReturnType<typeof mergeRecordDraft> & {
  latest: RecordDraftItem;
  choices: Partial<Record<Field, "mine" | "latest">>;
};

/**
 * 迭代记录草稿的创建/编辑弹窗（B-3a 起为记录页页头 CTA 与草稿卡片共用；
 * 任务详情弹窗的「记录一次迭代」也复用它，不再跳转记录页）。
 * 保存只写草稿，不完成任务也不发布记录；发布仍由草稿详情的 PublishRecordButton 完成。
 */
export function RecordDraftEditorModal({
  api,
  target,
  projectId,
  defaultModuleId = 0,
  defaultFeatureId = 0,
  writable,
  onClose,
  onSaved,
}: {
  api: InpulseApiClient;
  /** 非 null 即打开；每次传入新对象视为一次打开并初始化表单。 */
  target: RecordDraftEditorTarget | null;
  /** 页面锁定的项目；0 表示独立草稿在弹窗内选择目标项目。 */
  projectId: number;
  /** 打开独立草稿时的预选模块与功能（来自 URL 上下文）。 */
  defaultModuleId?: number | undefined;
  defaultFeatureId?: number | undefined;
  /** 调用方附加的可写条件（如来源任务已归档）；弹窗内部再叠加目标项目状态。 */
  writable: boolean;
  onClose: () => void;
  /** 保存成功回调：调用方决定关闭、刷新或导航；缓存失效已由弹窗完成。 */
  onSaved: (draft: RecordDraftItem) => void;
}) {
  const cache = useQueryClient();
  // 409 后重新加载会拿到更新的来源或草稿版本：用内部覆盖保存最新目标，
  // 不要求调用方改写自己持有的 target。
  const [override, setOverride] = useState<RecordDraftEditorTarget | null>(
    null,
  );
  const editor = override ?? target;
  const item = editor?.kind === "item" ? editor.item : undefined;
  const source = editor?.kind === "source" ? editor.source : undefined;
  const independent = editor?.kind === "independent";
  const [moduleId, setModuleId] = useState(defaultModuleId);
  const [featureId, setFeatureId] = useState(defaultFeatureId);
  const [scopeType, setScopeType] = useState<"FEATURE" | "MODULE">(
    defaultFeatureId ? "FEATURE" : "MODULE",
  );
  const [impacts, setImpacts] = useState<number[]>([]);
  /**
   * 「全部项目」视图（projectId 为 0）下，在弹窗里选择的目标项目；
   * 页面已锁定项目时以页面为准，该状态不参与。
   */
  const [createProjectId, setCreateProjectId] = useState(0);
  const [merge, setMerge] = useState<Merge | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  /** 创建草稿的目标项目：草稿按项目创建，服务端不接受「全部项目」。 */
  const formProjectId = projectId > 0 ? projectId : createProjectId;
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const saving = useRef(false);
  const lastTarget = useRef<RecordDraftEditorTarget | null>(null);
  const {
    control,
    handleSubmit,
    reset,
    getValues,
    formState: { errors },
  } = useForm<RecordDraftContent>({ defaultValues: empty });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: ({ signal }) => api.listProjects({ signal }),
    retry: false,
  });
  const modules = useQuery({
    queryKey: ["modules", formProjectId],
    queryFn: ({ signal }) => api.listModules(formProjectId, { signal }),
    enabled: formProjectId > 0,
    retry: false,
  });
  const features = useQuery({
    queryKey: ["features", formProjectId, moduleId],
    queryFn: ({ signal }) =>
      api.listFeatures(formProjectId, moduleId, { signal }),
    enabled: formProjectId > 0 && moduleId > 0,
    retry: false,
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: async (edit: RecordDraftContent) => {
      const normalized: RecordDraftContent = {
        title: edit.title.trim(),
        contextProblem: edit.contextProblem.trim(),
        changeSolution: edit.changeSolution.trim(),
        resultVerification: edit.resultVerification.trim(),
        remainingIssues: edit.remainingIssues.map((entry) => ({
          content: entry.content.trim(),
        })),
      };
      const body = source
        ? {
            ...normalized,
            title: normalized.title === source.title ? null : normalized.title,
          }
        : item
          ? normalized
          : {
              ...normalized,
              ...(scopeType === "FEATURE"
                ? { scopeType, featureId }
                : {
                    scopeType,
                    impactFeatureIds: [...impacts].sort((a, b) => a - b),
                  }),
            };
      const signature = JSON.stringify([
        formProjectId,
        moduleId,
        item?.id,
        item?.rowVersion,
        source?.taskId,
        source?.rowVersion,
        body,
      ]);
      if (retry.current?.signature !== signature)
        retry.current = {
          signature,
          key: createIdempotencyKey("record-draft"),
        };
      const csrf = await api.issueCsrfToken();
      const init = {
        headers: {
          "x-csrf-token": csrf.csrfToken,
          "Idempotency-Key": retry.current.key,
          ...(item
            ? { "If-Match": `"${item.rowVersion}"` }
            : source
              ? { "If-Match": `"${source.rowVersion}"` }
              : {}),
        },
      };
      if (item && item.taskId !== null)
        return api.updateTaskRecordDraft(
          projectId,
          item.moduleId,
          item.taskId,
          item.id,
          normalized,
          init,
        );
      if (source)
        return api.createTaskRecordDraft(
          projectId,
          source.moduleId,
          source.taskId,
          body as Parameters<InpulseApiClient["createTaskRecordDraft"]>[3],
          init,
        );
      if (item)
        return api.updateIndependentRecordDraft(
          projectId,
          item.id,
          normalized,
          init,
        );
      return api.createIndependentRecordDraft(
        formProjectId,
        moduleId,
        body as Parameters<InpulseApiClient["createIndependentRecordDraft"]>[2],
        init,
      );
    },
    onSuccess: async (result) => {
      retry.current = null;
      onSaved(result);
      cache.setQueryData(["record-draft", formProjectId, result.id], result);
      await cache.invalidateQueries({
        queryKey: ["record-draft", formProjectId, result.id],
      });
      await cache.invalidateQueries({
        queryKey: ["record-drafts", formProjectId],
      });
      await cache.invalidateQueries({ queryKey: MY_RECORD_DRAFTS_QUERY_KEY });
      await cache.invalidateQueries({
        queryKey: ["task-record-drafts", projectId],
      });
    },
  });
  // 每次传入新 target 视为一次打开：同步表单与范围选择器，清空冲突与错误态。
  useEffect(() => {
    if (target === null) {
      lastTarget.current = null;
      return;
    }
    if (lastTarget.current === target) return;
    lastTarget.current = target;
    setOverride(null);
    setMerge(null);
    setReloadError(null);
    mutation.reset();
    if (target.kind === "item") {
      reset(content(target.item));
      setModuleId(target.item.moduleId);
      setFeatureId(target.item.featureId ?? 0);
      setScopeType(target.item.scopeType);
      setImpacts([...target.item.impactFeatureIds]);
      return;
    }
    if (target.kind === "source") {
      reset({ ...empty, title: target.source.title });
      setImpacts([]);
      return;
    }
    reset(empty);
    setModuleId(defaultModuleId);
    setFeatureId(defaultFeatureId);
    setScopeType(defaultFeatureId ? "FEATURE" : "MODULE");
    setImpacts([]);
  }, [target, reset, mutation, defaultModuleId, defaultFeatureId]);
  // ADR-035：项目四态下只有已归档只读；目标项目状态未知时不可写。
  const formProjectStatus = projects.data?.items.find(
    (p) => p.id === formProjectId,
  )?.status;
  const canWrite =
    writable &&
    formProjectId > 0 &&
    formProjectStatus !== undefined &&
    formProjectStatus !== "ARCHIVED";
  const conflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;
  const reload = async () => {
    if (!editor) return;
    if (
      mutation.error instanceof ApiError &&
      mutation.error.code === "RECORD_PARENT_ARCHIVED"
    ) {
      setReloadError("所属范围已归档，草稿只读，输入已保留。");
      return;
    }
    setReloading(true);
    try {
      if (source) {
        const latest = await api.getTaskRecordDrafts(
          projectId,
          source.moduleId,
          source.taskId,
        );
        setOverride({ kind: "source", source: latest.source });
        cache.setQueryData(
          [
            "task-record-drafts",
            projectId,
            latest.source.moduleId,
            latest.source.taskId,
          ],
          latest,
        );
        mutation.reset();
        setReloadError(null);
        return;
      }
      if (!item) return;
      const latest = await api.getRecordDraft(projectId, item.id);
      const merged = mergeRecordDraft(
        content(item),
        getValues(),
        content(latest),
      );
      if (merged.conflicts.length) setMerge({ ...merged, latest, choices: {} });
      else {
        setOverride({ kind: "item", item: latest });
        reset(merged.values);
        mutation.reset();
        setReloadError(null);
      }
    } catch (error) {
      setReloadError(recordDraftErrorMessage(error));
    } finally {
      setReloading(false);
    }
  };
  const applyMerge = () => {
    if (!merge || merge.conflicts.some((field) => !merge.choices[field]))
      return;
    const values = { ...merge.values };
    for (const field of merge.conflicts)
      if (merge.choices[field] === "latest")
        (values as Record<Field, unknown>)[field] = merge.latest[field];
    reset(values);
    setOverride({ kind: "item", item: merge.latest });
    setMerge(null);
    mutation.reset();
    setReloadError(null);
  };
  const save = handleSubmit(async (edit) => {
    if (
      saving.current ||
      !editor ||
      conflict ||
      merge ||
      reloading ||
      reloadError ||
      !canWrite
    )
      return;
    saving.current = true;
    try {
      await mutation.mutateAsync(edit);
    } catch {
      /* Preserve input and key. */
    } finally {
      saving.current = false;
    }
  });
  return (
    <Modal
      open={target !== null}
      eyebrow={
        item
          ? "草稿 · " + item.title
          : source
            ? "来源任务 · " + source.title
            : "项目与功能 / 迭代记录"
      }
      title={item ? "编辑草稿" : source ? "新建来源草稿" : "新建迭代记录"}
      className="catalog-modal"
      size="lg"
      onCancel={() => {
        if (!saving.current && !reloading) onClose();
      }}
      mask={{ closable: !mutation.isPending && !reloading }}
    >
      <form
        className="catalog-form calm-form"
        onSubmit={(event) => void save(event)}
      >
        <div className="dialog-form">
          {mutation.isError && (
            <Alert
              type="error"
              title={recordDraftErrorMessage(mutation.error)}
            />
          )}
          {reloadError && <Alert type="warning" title={reloadError} />}
          {conflict && (item || source) && (
            <Button loading={reloading} onClick={() => void reload()}>
              {source ? "加载最新来源任务" : "加载最新草稿并合并"}
            </Button>
          )}
          {merge && (
            <section aria-label="草稿冲突">
              <p>以下字段双方都有修改，请逐项选择。</p>
              {merge.conflicts.map((field) => (
                <label key={field}>
                  {labels[field]}冲突
                  <CalmSelect
                    ariaLabel={labels[field] + "冲突"}
                    value={merge.choices[field] ?? ""}
                    appearance="menu"
                    onChange={(next) =>
                      setMerge({
                        ...merge,
                        choices: {
                          ...merge.choices,
                          [field]: next as "mine" | "latest",
                        },
                      })
                    }
                    options={[
                      { value: "", label: "请选择" },
                      { value: "mine", label: "保留我的输入" },
                      { value: "latest", label: "采用最新内容" },
                    ]}
                  />
                  <div className="record-field">
                    <span className="record-field-label">最新内容</span>
                    <RecordMarkdown
                      content={fieldText(merge.latest, field) || "（空）"}
                    />
                  </div>
                </label>
              ))}
              <Button
                onClick={applyMerge}
                disabled={merge.conflicts.some(
                  (field) => !merge.choices[field],
                )}
              >
                应用合并
              </Button>
            </section>
          )}
          {source && (
            <p>
              来源：{source.title} · 处理人{" "}
              {source.assigneeName ?? "名称暂不可用"}
              。归属和影响功能按保存时的来源快照记录。
            </p>
          )}
          {independent && (
            <>
              {projectId === 0 && (
                <label>
                  所属项目
                  <CalmSelect
                    ariaLabel="所属项目"
                    value={createProjectId || ""}
                    appearance="rich"
                    onChange={(next) => {
                      setCreateProjectId(Number(next));
                      setModuleId(0);
                      setFeatureId(0);
                      setImpacts([]);
                    }}
                    options={[
                      { value: "", label: "请选择项目" },
                      ...(projects.data?.items ?? []).map((p) => ({
                        ...projectSelectOption(p),
                        disabled: p.status !== "ACTIVE",
                      })),
                    ]}
                  />
                </label>
              )}
              <label>
                所属模块
                <CalmSelect
                  ariaLabel="所属模块"
                  value={moduleId || ""}
                  appearance="menu"
                  onChange={(next) => {
                    setModuleId(Number(next));
                    setFeatureId(0);
                    setImpacts([]);
                  }}
                  options={[
                    {
                      value: "",
                      label: formProjectId > 0 ? "请选择模块" : "请先选择项目",
                    },
                    ...(modules.data?.items ?? []).map((m) => ({
                      value: m.id,
                      label: m.name,
                      disabled: m.status !== "ACTIVE",
                    })),
                  ]}
                />
              </label>
              <label>
                记录范围
                <CalmSelect
                  ariaLabel="记录范围"
                  value={scopeType}
                  appearance="notion"
                  onChange={(next) => setScopeType(next as typeof scopeType)}
                  options={[
                    { value: "MODULE", label: "模块", emoji: "\u{1F9E9}" },
                    { value: "FEATURE", label: "功能", emoji: "\u{1F3AF}" },
                  ]}
                />
              </label>
              {scopeType === "FEATURE" ? (
                <label>
                  所属功能
                  <CalmSelect
                    ariaLabel="所属功能"
                    value={featureId || ""}
                    appearance="menu"
                    onChange={(next) => setFeatureId(Number(next))}
                    options={[
                      { value: "", label: "请选择功能" },
                      ...(features.data?.items ?? []).map((f) => ({
                        value: f.id,
                        label: f.name,
                        disabled: f.status !== "ACTIVE",
                      })),
                    ]}
                  />
                </label>
              ) : (
                <fieldset>
                  <legend>影响功能（选填）</legend>
                  <CalmSelect
                    ariaLabel="影响功能"
                    multiple
                    searchable
                    appearance="rich"
                    width="100%"
                    value={impacts}
                    placeholder="输入功能名称搜索，可多选"
                    onChange={(next) => setImpacts(next.map(Number))}
                    options={(features.data?.items ?? []).map((f) => ({
                      value: f.id,
                      label: f.name,
                      disabled: f.status !== "ACTIVE",
                    }))}
                  />
                </fieldset>
              )}
              {(modules.isError || features.isError) && (
                <Alert
                  type="error"
                  title="所属范围加载失败，请重新选择或刷新。"
                />
              )}
            </>
          )}
          {fields
            .filter((field) => field !== "remainingIssues")
            .map((field) => (
              <label key={field}>
                {labels[field]}
                <Controller
                  name={field}
                  control={control}
                  rules={{
                    validate: (value) =>
                      value.trim().length > 0 || "请填写此项",
                    maxLength: field === "title" ? 500 : 50000,
                  }}
                  render={({ field: input }) =>
                    field === "title" ? (
                      <Input
                        {...input}
                        aria-label={labels[field]}
                        maxLength={500}
                      />
                    ) : (
                      <Input.TextArea
                        {...input}
                        aria-label={labels[field]}
                        rows={4}
                        maxLength={50000}
                      />
                    )
                  }
                />
                {errors[field] && (
                  <span role="alert">
                    {errors[field]?.message || "内容过长"}
                  </span>
                )}
              </label>
            ))}
          <label>
            {labels.remainingIssues}
            <Controller
              name="remainingIssues"
              control={control}
              rules={{
                validate: (entries) =>
                  entries.every((entry) => entry.content.trim().length > 0) ||
                  "每条遗留问题都不能为空，可移除不需要的条目",
              }}
              render={({ field: input }) => (
                <LeftoverEntriesField
                  value={input.value}
                  onChange={input.onChange}
                  label={labels.remainingIssues}
                />
              )}
            />
            {errors.remainingIssues && (
              <span role="alert">
                {errors.remainingIssues?.message || "内容过长"}
              </span>
            )}
          </label>
          <p>保存为草稿，可继续编辑；不会完成任务或发布记录。</p>
        </div>
        <div className="calm-action-footer">
          <Button
            htmlType="submit"
            className="primary-button"
            loading={mutation.isPending}
            disabled={
              !canWrite ||
              conflict ||
              !!merge ||
              reloading ||
              !!reloadError ||
              (!item &&
                !source &&
                (!formProjectId ||
                  !moduleId ||
                  (scopeType === "FEATURE" && !featureId)))
            }
          >
            保存草稿
          </Button>
        </div>
      </form>
    </Modal>
  );
}
