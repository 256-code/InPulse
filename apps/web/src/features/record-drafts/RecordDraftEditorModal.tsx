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
  type PublishedRecord,
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
 * 弹窗要处理的目标：编辑已有草稿 / 从任务创建来源草稿 / 新建迭代记录（独立草稿）。
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
  /**
   * 保存成功回调：调用方决定关闭、刷新或导航；缓存失效已由弹窗完成。
   * published 非空表示这次保存顺带发布成了正式迭代记录。
   */
  onSaved: (
    draft: RecordDraftItem,
    published?: PublishedRecord | null | undefined,
  ) => void;
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
  const publishRetry = useRef<{ signature: string; key: string } | null>(null);
  const saving = useRef(false);
  /** 当前正在跑的动作：两个页脚按钮各自显示自己的 loading。 */
  const [pending, setPending] = useState<"save" | "publish" | null>(null);
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
    mutationFn: async (input: {
      readonly edit: RecordDraftContent;
      /** 保存后立即发布成正式迭代记录（页脚「新建迭代」/「保存并发布」）。 */
      readonly publish: boolean;
    }) => {
      const edit = input.edit;
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
      const saved: RecordDraftItem =
        item && item.taskId !== null
          ? await api.updateTaskRecordDraft(
              projectId,
              item.moduleId,
              item.taskId,
              item.id,
              normalized,
              init,
            )
          : source
            ? await api.createTaskRecordDraft(
                projectId,
                source.moduleId,
                source.taskId,
                body as Parameters<
                  InpulseApiClient["createTaskRecordDraft"]
                >[3],
                init,
              )
            : item
              ? await api.updateIndependentRecordDraft(
                  projectId,
                  item.id,
                  normalized,
                  init,
                )
              : await api.createIndependentRecordDraft(
                  formProjectId,
                  moduleId,
                  body as Parameters<
                    InpulseApiClient["createIndependentRecordDraft"]
                  >[2],
                  init,
                );
      if (!input.publish) return { draft: saved, published: null };
      const publishSignature = saved.id + ":" + saved.rowVersion;
      if (publishRetry.current?.signature !== publishSignature)
        publishRetry.current = {
          signature: publishSignature,
          key: createIdempotencyKey("record-publish"),
        };
      try {
        const publishCsrf = await api.issueCsrfToken();
        const published = await api.publishChangeRecord(
          saved.projectId,
          saved.id,
          {},
          {
            headers: {
              "x-csrf-token": publishCsrf.csrfToken,
              "If-Match": JSON.stringify(String(saved.rowVersion)),
              "Idempotency-Key": publishRetry.current.key,
            },
          },
        );
        publishRetry.current = null;
        return { draft: saved, published };
      } catch (error) {
        // 发布失败时草稿已经落库：把弹窗切到这条草稿的编辑态并刷新列表，
        // 重试「新建迭代」就是更新同一条，不会再建出重复草稿。
        setOverride({ kind: "item", item: saved });
        await cache.invalidateQueries({
          queryKey: ["record-drafts", saved.projectId],
        });
        await cache.invalidateQueries({ queryKey: MY_RECORD_DRAFTS_QUERY_KEY });
        await cache.invalidateQueries({
          queryKey: ["task-record-drafts", projectId],
        });
        throw error;
      }
    },
    onSuccess: async ({ draft, published }) => {
      retry.current = null;
      onSaved(draft, published);
      cache.setQueryData(["record-draft", formProjectId, draft.id], draft);
      if (published)
        cache.setQueryData(
          ["published-record", published.projectId, published.id],
          published,
        );
      await cache.invalidateQueries({
        queryKey: ["record-draft", formProjectId, draft.id],
      });
      await cache.invalidateQueries({
        queryKey: ["record-drafts", formProjectId],
      });
      await cache.invalidateQueries({ queryKey: MY_RECORD_DRAFTS_QUERY_KEY });
      await cache.invalidateQueries({
        queryKey: ["task-record-drafts", projectId],
      });
      // 刚发布的记录要立刻出现在时间线里，草稿箱则少一条。
      if (published)
        await cache.invalidateQueries({ queryKey: ["record-feed"] });
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
  const run = async (edit: RecordDraftContent, publish: boolean) => {
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
    setPending(publish ? "publish" : "save");
    try {
      await mutation.mutateAsync({ edit, publish });
    } catch {
      /* Preserve input and key. */
    } finally {
      setPending(null);
      saving.current = false;
    }
  };
  const save = handleSubmit((edit) => run(edit, false));
  const saveAndPublish = handleSubmit((edit) => run(edit, true));
  /**
   * 页脚主按钮：无来源任务的草稿可以直接发布成正式 v1。带来源任务时必须由任务完成
   * 流程（F-19）发布，服务端会因为任务不是 DONE 拒绝，所以这里不给这个入口。
   */
  const canPublish = !source && (item ? item.taskId === null : true);
  /** 两个页脚动作共用同一套禁用条件：不可写、有冲突或范围没选全都不能提交。 */
  const submitBlocked =
    mutation.isPending ||
    !canWrite ||
    conflict ||
    !!merge ||
    reloading ||
    !!reloadError ||
    (!item &&
      !source &&
      (!formProjectId || !moduleId || (scopeType === "FEATURE" && !featureId)));
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
                    placeholder="请选择项目"
                    onChange={(next) => {
                      setCreateProjectId(Number(next));
                      setModuleId(0);
                      setFeatureId(0);
                      setImpacts([]);
                    }}
                    options={(projects.data?.items ?? []).map((p) => ({
                      ...projectSelectOption(p),
                      disabled: p.status !== "ACTIVE",
                    }))}
                  />
                </label>
              )}
              <label>
                所属模块
                <CalmSelect
                  ariaLabel="所属模块"
                  value={moduleId || ""}
                  appearance="rich"
                  searchable
                  width="100%"
                  placeholder={
                    formProjectId > 0 ? "输入模块名称搜索" : "请先选择项目"
                  }
                  onChange={(next) => {
                    setModuleId(Number(next));
                    setFeatureId(0);
                    setImpacts([]);
                  }}
                  options={(modules.data?.items ?? []).map((m) => ({
                    value: m.id,
                    label: m.name,
                    disabled: m.status !== "ACTIVE",
                  }))}
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
                    appearance="rich"
                    searchable
                    width="100%"
                    placeholder="输入功能名称搜索"
                    onChange={(next) => setFeatureId(Number(next))}
                    options={(features.data?.items ?? []).map((f) => ({
                      value: f.id,
                      label: f.name,
                      disabled: f.status !== "ACTIVE",
                    }))}
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
          <p>
            {canPublish
              ? "保存草稿可继续编辑；" +
                (item ? "「保存并发布」" : "「新建迭代」") +
                "会立即生成正式编号与 v1，之后只能新增版本或作废。"
              : "保存为草稿，可继续编辑；不会完成任务或发布记录。"}
          </p>
        </div>
        <div className="calm-action-footer">
          <Button
            htmlType="submit"
            className={canPublish ? "soft-blue-button" : "primary-button"}
            loading={pending === "save"}
            disabled={submitBlocked}
          >
            保存草稿
          </Button>
          {canPublish && (
            <Button
              className="primary-button"
              loading={pending === "publish"}
              disabled={submitBlocked}
              onClick={() => void saveAndPublish()}
            >
              {item ? "保存并发布" : "新建迭代"}
            </Button>
          )}
        </div>
      </form>
    </Modal>
  );
}
