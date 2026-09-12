import { ExternalLinksPanel } from "@features/external-links/ExternalLinksPanel";
import {
  fields,
  labels,
  mergeRecordDraft,
  type Field,
} from "./record-content.js";
export { mergeRecordDraft } from "./record-content.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { PublishRecordButton } from "@features/published-records/PublishRecordButton";
import {
  MY_RECORD_DRAFTS_QUERY_KEY,
  useMyRecordDraftsQuery,
  useRecordDraftsQuery,
} from "./record-drafts-query";
import "./record-drafts.css";
import { Alert, Button, Input, Modal, Spin } from "antd";
import { Controller, useForm } from "react-hook-form";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  ApiError,
  createApiClient,
  type InpulseApiClient,
  type RecordDraftContent,
  type MyRecordDraftItem,
  type RecordDraftItem,
  type TaskRecordDraftsResponse,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import { RecordMarkdown } from "@features/common/components/RecordMarkdown";

const empty: RecordDraftContent = {
  title: "",
  contextProblem: "",
  changeSolution: "",
  resultVerification: "",
  remainingIssues: "",
};
const content = (item: RecordDraftContent): RecordDraftContent => ({
  title: item.title,
  contextProblem: item.contextProblem,
  changeSolution: item.changeSolution,
  resultVerification: item.resultVerification,
  remainingIssues: item.remainingIssues,
});
function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 401) return "登录状态已失效，请重新登录。输入已保留。";
    if (error.status === 404)
      return "草稿或所属范围不存在，或你已无权访问。输入已保留。";
    if (error.status === 403) return "权限或安全校验未通过。输入已保留。";
    if (error.status === 409) return `${error.message}，输入已保留。`;
    if (error.status === 422)
      return "请检查三段必填内容、标题和所属范围。输入已保留。";
    if (error.status === 429) return "请求过于频繁，请稍后重试。输入已保留。";
  }
  return "草稿服务暂时不可用，输入已保留，可重试。";
}
type Merge = ReturnType<typeof mergeRecordDraft> & {
  latest: RecordDraftItem;
  choices: Partial<Record<Field, "mine" | "latest">>;
};
export function RecordDraftsView({
  client,
  createToken = 0,
  currentUserId,
  onCanCreateChange,
}: {
  client?: InpulseApiClient | undefined;
  /** 页头 CTA 的递增令牌：变化时打开对应模式的草稿弹窗（B-3a 单页）。 */
  createToken?: number;
  /**
   * 当前登录用户 id：决定是否请求并显示「我的草稿」条带（B-3b 起为全局
   * `listMyRecordDrafts`，跨项目显示并回填项目名称）；不传则不显示条带。
   */
  currentUserId?: number | undefined;
  /** 向调用方上报能否创建草稿，供页头 CTA 的禁用态使用。 */
  onCanCreateChange?: ((canCreate: boolean) => void) | undefined;
}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const cache = useQueryClient();
  const [params, setParams] = useSearchParams();
  const projectId = Number(params.get("projectId")) || 0;
  const recordId = Number(params.get("recordId")) || 0;
  const taskId = Number(params.get("taskId")) || 0;
  const sourceModuleId = Number(params.get("moduleId")) || 0;
  const [selection, setSelection] = useState<{
    item?: RecordDraftItem;
    source?: TaskRecordDraftsResponse["source"];
  } | null>(null);
  const [moduleId, setModuleId] = useState(Number(params.get("moduleId")) || 0);
  const [featureId, setFeatureId] = useState(
    Number(params.get("featureId")) || 0,
  );
  const [scopeType, setScopeType] = useState<"FEATURE" | "MODULE">(
    featureId ? "FEATURE" : "MODULE",
  );
  const [impacts, setImpacts] = useState<number[]>([]);
  const [merge, setMerge] = useState<Merge | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const saving = useRef(false);
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
    queryKey: ["modules", projectId],
    queryFn: ({ signal }) => api.listModules(projectId, { signal }),
    enabled: projectId > 0,
    retry: false,
  });
  const features = useQuery({
    queryKey: ["features", projectId, moduleId],
    queryFn: ({ signal }) => api.listFeatures(projectId, moduleId, { signal }),
    enabled: projectId > 0 && moduleId > 0,
    retry: false,
  });
  const allDrafts = useRecordDraftsQuery({
    client,
    projectId,
    enabled: !taskId,
  });
  const allDraftItems =
    allDrafts.data?.pages.flatMap((page) => [...page.items]) ?? [];
  const sourceQuery = useQuery({
    queryKey: ["task-record-drafts", projectId, sourceModuleId, taskId],
    queryFn: ({ signal }) =>
      api.getTaskRecordDrafts(projectId, sourceModuleId, taskId, { signal }),
    enabled: projectId > 0 && sourceModuleId > 0 && taskId > 0,
    retry: false,
  });
  const drafts = taskId > 0 ? (sourceQuery.data?.items ?? []) : allDraftItems;
  const listPending = taskId > 0 ? sourceQuery.isPending : allDrafts.isPending;
  const listError = taskId > 0 ? sourceQuery.error : allDrafts.error;
  const listFailed = taskId > 0 ? sourceQuery.isError : allDrafts.isError;
  const reloadList = () =>
    void (taskId > 0 ? sourceQuery.refetch() : allDrafts.refetch());
  const detail = useQuery({
    queryKey: ["record-draft", projectId, recordId],
    queryFn: ({ signal }) =>
      api.getRecordDraft(projectId, recordId, { signal }),
    enabled: projectId > 0 && recordId > 0,
    retry: false,
  });
  const writable =
    projects.data?.items.find((p) => p.id === projectId)?.status === "ACTIVE" &&
    (!taskId || sourceQuery.data?.source.lifecycleStatus === "ACTIVE");
  const canCreate = !!writable && (taskId === 0 || !!sourceQuery.data?.source);
  useEffect(() => {
    onCanCreateChange?.(canCreate);
  }, [canCreate, onCanCreateChange]);
  // B-3a：项目选择器上移到页面 toolbar 后，切换项目时在这里重置范围与弹窗状态。
  const lastProjectId = useRef(projectId);
  useEffect(() => {
    if (lastProjectId.current === projectId) return;
    lastProjectId.current = projectId;
    setSelection(null);
    setImpacts([]);
    setModuleId(Number(params.get("moduleId")) || 0);
    setFeatureId(Number(params.get("featureId")) || 0);
    setScopeType(Number(params.get("featureId")) ? "FEATURE" : "MODULE");
  }, [projectId, params]);
  const mutation = useMutation({
    retry: false,
    mutationFn: async (edit: RecordDraftContent) => {
      const normalized = Object.fromEntries(
        fields.map((field) => [field, edit[field].trim()]),
      ) as RecordDraftContent;
      const body = selection?.source
        ? {
            ...normalized,
            title:
              normalized.title === selection.source.title
                ? null
                : normalized.title,
          }
        : selection?.item
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
        projectId,
        moduleId,
        selection?.item?.id,
        selection?.item?.rowVersion,
        selection?.source?.taskId,
        selection?.source?.rowVersion,
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
          ...(selection?.item
            ? { "If-Match": `"${selection.item.rowVersion}"` }
            : selection?.source
              ? { "If-Match": `"${selection.source.rowVersion}"` }
              : {}),
        },
      };
      if (selection?.item && selection.item.taskId !== null)
        return api.updateTaskRecordDraft(
          projectId,
          selection.item.moduleId,
          selection.item.taskId,
          selection.item.id,
          normalized,
          init,
        );
      if (selection?.source)
        return api.createTaskRecordDraft(
          projectId,
          selection.source.moduleId,
          selection.source.taskId,
          body as Parameters<InpulseApiClient["createTaskRecordDraft"]>[3],
          init,
        );
      if (selection?.item)
        return api.updateIndependentRecordDraft(
          projectId,
          selection.item.id,
          normalized,
          init,
        );
      return api.createIndependentRecordDraft(
        projectId,
        moduleId,
        body as Parameters<InpulseApiClient["createIndependentRecordDraft"]>[2],
        init,
      );
    },
    onSuccess: async (result) => {
      retry.current = null;
      setSelection(null);
      setParams({
        projectId: String(projectId),
        recordId: String(result.id),
        ...(taskId
          ? { taskId: String(taskId), moduleId: String(sourceModuleId) }
          : {}),
      });
      cache.setQueryData(["record-draft", projectId, result.id], result);
      await cache.invalidateQueries({ queryKey: ["record-drafts", projectId] });
      await cache.invalidateQueries({ queryKey: MY_RECORD_DRAFTS_QUERY_KEY });
      await cache.invalidateQueries({
        queryKey: ["task-record-drafts", projectId],
      });
    },
  });
  const conflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;
  const open = (item?: RecordDraftItem) => {
    const source = taskId ? sourceQuery.data?.source : undefined;
    if (!item && taskId && !source) return;
    setSelection(item ? { item } : source ? { source } : {});
    reset(
      item ? content(item) : source ? { ...empty, title: source.title } : empty,
    );
    setMerge(null);
    setReloadError(null);
    mutation.reset();
    if (item) {
      setModuleId(item.moduleId);
      setFeatureId(item.featureId ?? 0);
      setScopeType(item.scopeType);
      setImpacts([...item.impactFeatureIds]);
    } else setImpacts([]);
  };
  // B-3a：页头 CTA（记录一次迭代 / 新建来源草稿）通过递增令牌打开同一个弹窗。
  const lastCreateToken = useRef(createToken);
  useEffect(() => {
    if (lastCreateToken.current === createToken) return;
    lastCreateToken.current = createToken;
    if (!canCreate) return;
    const source = taskId ? sourceQuery.data?.source : undefined;
    if (taskId && !source) return;
    setSelection(source ? { source } : {});
    reset(source ? { ...empty, title: source.title } : empty);
    setMerge(null);
    setReloadError(null);
    mutation.reset();
    setImpacts([]);
  }, [createToken, canCreate, taskId, sourceQuery.data, reset, mutation]);
  const reload = async () => {
    if (!selection?.item && !selection?.source) return;
    if (
      mutation.error instanceof ApiError &&
      mutation.error.code === "RECORD_PARENT_ARCHIVED"
    ) {
      setReloadError("所属范围已归档，草稿只读，输入已保留。");
      return;
    }
    setReloading(true);
    try {
      if (selection.source) {
        const latest = await api.getTaskRecordDrafts(
          projectId,
          selection.source.moduleId,
          selection.source.taskId,
        );
        setSelection({ source: latest.source });
        cache.setQueryData(
          ["task-record-drafts", projectId, sourceModuleId, taskId],
          latest,
        );
        mutation.reset();
        setReloadError(null);
        return;
      }
      if (!selection.item) return;
      const latest = await api.getRecordDraft(projectId, selection.item.id);
      const merged = mergeRecordDraft(
        content(selection.item),
        getValues(),
        content(latest),
      );
      if (merged.conflicts.length) setMerge({ ...merged, latest, choices: {} });
      else {
        setSelection({ item: latest });
        reset(merged.values);
        mutation.reset();
        setReloadError(null);
      }
    } catch (error) {
      setReloadError(errorMessage(error));
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
        values[field] = merge.latest[field];
    reset(values);
    setSelection({ item: merge.latest });
    setMerge(null);
    mutation.reset();
    setReloadError(null);
  };
  const save = handleSubmit(async (edit) => {
    if (
      saving.current ||
      !selection ||
      conflict ||
      merge ||
      reloading ||
      reloadError ||
      !writable
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
  const myDrafts = useMyRecordDraftsQuery({
    client,
    enabled: currentUserId !== undefined,
  });
  const myDraftItems =
    myDrafts.data?.pages.flatMap((page) => [...page.items]) ?? [];
  /**
   * 条带跨项目：同项目草稿直接打开弹窗；其他项目先把 URL 切到该项目的记录页
   * （带 recordId），由既有的草稿详情面板加载，避免用错项目的写入路径。
   */
  const openMyDraft = (item: MyRecordDraftItem) => {
    if (item.draft.projectId === projectId) {
      open(item.draft);
      return;
    }
    setSelection(null);
    setParams({
      projectId: String(item.draft.projectId),
      recordId: String(item.draft.id),
      ...(item.draft.taskId === null
        ? {}
        : {
            taskId: String(item.draft.taskId),
            moduleId: String(item.draft.moduleId),
          }),
    });
  };
  return (
    <section className="record-drafts-page" aria-label="迭代记录草稿">
      {projects.isError && (
        <Alert
          type="error"
          title={errorMessage(projects.error)}
          action={
            <Button onClick={() => void projects.refetch()}>重试项目</Button>
          }
        />
      )}
      {currentUserId !== undefined && myDrafts.isError && (
        <p className="draft-strip-error">
          我的草稿暂时无法加载，刷新页面或稍后重试。
        </p>
      )}
      {myDraftItems.length > 0 && (
        <section className="draft-strip" aria-label="我的草稿">
          <CalmSectionTitle
            title="我的草稿"
            hint={`${myDraftItems.length} 条，尚未进入功能历史`}
          />
          {myDraftItems.map((item) => (
            <button
              type="button"
              className="draft-record"
              key={item.draft.id}
              aria-label={item.draft.title}
              onClick={() => openMyDraft(item)}
            >
              <CalmBadge>草稿</CalmBadge>
              <strong>{item.draft.title}</strong>
              <small className="draft-record-project">
                {item.projectName} / {item.moduleName}
                {item.featureName === null ? "" : ` / ${item.featureName}`}
              </small>
              <span>
                <InpulseIcon name="pencil" size={13} />
                继续编辑 →
              </span>
            </button>
          ))}
        </section>
      )}
      {projectId > 0 && (
        <>
          {taskId > 0 && sourceQuery.data && (
            <section aria-label="来源任务">
              <h2>{sourceQuery.data.source.title}</h2>
              <p>
                选择已有草稿继续编辑，或新建另一条草稿。保存草稿不会改变任务状态。
              </p>
              <a
                href={`/projects/${projectId}/modules/${sourceModuleId}${sourceQuery.data.source.featureId === null ? "/tasks" : `/features/${sourceQuery.data.source.featureId}`}?taskId=${taskId}`}
              >
                返回来源任务
              </a>
              {" · "}
              <a href={`/records?projectId=${projectId}`}>项目全部草稿</a>
            </section>
          )}
          <CalmSectionTitle
            title={taskId > 0 ? "来源草稿" : "项目草稿"}
            hint="先把变化写清楚，保存后可与项目成员继续补充。"
          >
            <CalmBadge tone="amber">草稿</CalmBadge>
          </CalmSectionTitle>
          <div className="draft-toolbar">
            <Button
              className="primary-button"
              disabled={!writable}
              onClick={() => open()}
            >
              {taskId ? "新建来源草稿" : "新建独立草稿"}
            </Button>
          </div>
          {listPending ? (
            <Spin />
          ) : listFailed ? (
            <Alert
              type="error"
              title={errorMessage(listError)}
              action={<Button onClick={reloadList}>重试草稿列表</Button>}
            />
          ) : !drafts.length ? (
            <CalmEmptyState
              icon="gitBranch"
              title="暂无草稿"
              description={
                taskId
                  ? "此任务还没有草稿，可以显式新建。"
                  : "为当前项目记录一项变化。"
              }
            />
          ) : (
            <div className="calm-task-grid">
              {drafts.map((item) => (
                <article className="calm-task-card" key={item.id}>
                  <CalmBadge tone="amber">草稿</CalmBadge>
                  <h3>{item.title}</h3>
                  <p>
                    模块 #{item.moduleId}
                    {item.featureId
                      ? ` / 功能 #${item.featureId}`
                      : " / 模块范围"}
                  </p>
                  <p>
                    记录作者 #{item.authorId} · 更新{" "}
                    {new Date(item.updatedAt).toLocaleString("zh-CN")}
                  </p>
                  <Button
                    onClick={() =>
                      setParams({
                        projectId: String(projectId),
                        recordId: String(item.id),
                        ...(taskId
                          ? {
                              taskId: String(taskId),
                              moduleId: String(sourceModuleId),
                            }
                          : {}),
                      })
                    }
                  >
                    查看草稿
                  </Button>
                </article>
              ))}
            </div>
          )}
          {taskId === 0 && allDrafts.hasNextPage && (
            <div className="record-load-more">
              <Button
                disabled={allDrafts.isFetchingNextPage}
                onClick={() => void allDrafts.fetchNextPage()}
              >
                {allDrafts.isFetchingNextPage ? "正在加载…" : "加载更多"}
              </Button>
            </div>
          )}
          {recordId > 0 &&
            (detail.isPending ? (
              <Spin />
            ) : detail.isError ? (
              <Alert type="error" title={errorMessage(detail.error)} />
            ) : (
              detail.data && (
                <section className="draft-detail" aria-label="草稿详情">
                  <h2>{detail.data.title}</h2>
                  <ExternalLinksPanel
                    key={detail.data.id}
                    targetType="CHANGE_RECORD"
                    targetId={detail.data.id}
                    client={api}
                  />
                  {detail.data.taskId !== null && (
                    <a
                      href={`/records?projectId=${projectId}&moduleId=${detail.data.moduleId}&taskId=${detail.data.taskId}`}
                    >
                      查看此任务的全部草稿
                    </a>
                  )}
                  <p>
                    草稿 · 处理人 #{detail.data.handlerId} · 记录作者 #
                    {detail.data.authorId}
                  </p>
                  <p>
                    项目 #{detail.data.projectId} / 模块 #{detail.data.moduleId}
                    {detail.data.featureId
                      ? ` / 功能 #${detail.data.featureId}`
                      : ` / 影响功能：${detail.data.impactFeatureIds.join("、") || "未选择"}`}
                  </p>
                  {fields
                    .filter((field) => field !== "title")
                    .map((field) => (
                      <section key={field}>
                        <h3>{labels[field]}</h3>
                        <RecordMarkdown
                          content={detail.data[field] || "暂无已知遗留问题"}
                        />
                      </section>
                    ))}
                  <Button
                    disabled={!writable}
                    onClick={() => open(detail.data)}
                  >
                    继续编辑
                  </Button>
                  <p>草稿尚未发布，不计入正式迭代统计。</p>
                  <PublishRecordButton
                    item={detail.data}
                    api={api}
                    writable={!!writable}
                  />
                </section>
              )
            ))}
        </>
      )}
      <Modal
        open={selection !== null}
        title={
          selection?.item
            ? "编辑草稿"
            : selection?.source
              ? "新建来源草稿"
              : "新建独立草稿"
        }
        className="catalog-modal"
        footer={null}
        onCancel={() => {
          if (!saving.current && !reloading) setSelection(null);
        }}
        mask={{ closable: !mutation.isPending && !reloading }}
      >
        <form
          className="catalog-form calm-form"
          onSubmit={(event) => void save(event)}
        >
          <div className="dialog-form">
            {mutation.isError && (
              <Alert type="error" title={errorMessage(mutation.error)} />
            )}
            {reloadError && <Alert type="warning" title={reloadError} />}
            {conflict && (selection?.item || selection?.source) && (
              <Button loading={reloading} onClick={() => void reload()}>
                {selection?.source ? "加载最新来源任务" : "加载最新草稿并合并"}
              </Button>
            )}
            {merge && (
              <section aria-label="草稿冲突">
                <p>以下字段双方都有修改，请逐项选择。</p>
                {merge.conflicts.map((field) => (
                  <label key={field}>
                    {labels[field]}冲突
                    <select
                      value={merge.choices[field] ?? ""}
                      onChange={(e) =>
                        setMerge({
                          ...merge,
                          choices: {
                            ...merge.choices,
                            [field]: e.target.value as "mine" | "latest",
                          },
                        })
                      }
                    >
                      <option value="">请选择</option>
                      <option value="mine">保留我的输入</option>
                      <option value="latest">采用最新内容</option>
                    </select>
                    <div className="record-field">
                      <span className="record-field-label">最新内容</span>
                      <RecordMarkdown
                        content={merge.latest[field] || "（空）"}
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
            {selection?.source && (
              <p>
                来源：{selection.source.title} · 处理人 #
                {selection.source.assigneeId}
                。归属和影响功能按保存时的来源快照记录。
              </p>
            )}
            {!selection?.item && !selection?.source && (
              <>
                <label>
                  所属模块
                  <select
                    required
                    value={moduleId || ""}
                    onChange={(e) => {
                      setModuleId(Number(e.target.value));
                      setFeatureId(0);
                      setImpacts([]);
                    }}
                  >
                    <option value="">请选择模块</option>
                    {modules.data?.items.map((m) => (
                      <option
                        key={m.id}
                        value={m.id}
                        disabled={m.status !== "ACTIVE"}
                      >
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  记录范围
                  <select
                    value={scopeType}
                    onChange={(e) =>
                      setScopeType(e.target.value as typeof scopeType)
                    }
                  >
                    <option value="MODULE">模块</option>
                    <option value="FEATURE">功能</option>
                  </select>
                </label>
                {scopeType === "FEATURE" ? (
                  <label>
                    所属功能
                    <select
                      required
                      value={featureId || ""}
                      onChange={(e) => setFeatureId(Number(e.target.value))}
                    >
                      <option value="">请选择功能</option>
                      {features.data?.items.map((f) => (
                        <option
                          key={f.id}
                          value={f.id}
                          disabled={f.status !== "ACTIVE"}
                        >
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <fieldset>
                    <legend>影响功能（选填）</legend>
                    {features.data?.items.map((f) => (
                      <label key={f.id}>
                        <input
                          type="checkbox"
                          checked={impacts.includes(f.id)}
                          disabled={f.status !== "ACTIVE"}
                          onChange={(e) =>
                            setImpacts(
                              e.target.checked
                                ? [...impacts, f.id]
                                : impacts.filter((id) => id !== f.id),
                            )
                          }
                        />
                        {f.name}
                      </label>
                    ))}
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
            {fields.map((field) => (
              <label key={field}>
                {labels[field]}
                <Controller
                  name={field}
                  control={control}
                  rules={{
                    validate: (value) =>
                      field === "remainingIssues" ||
                      value.trim().length > 0 ||
                      "请填写此项",
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
            <p>保存为草稿，可继续编辑；不会完成任务或发布记录。</p>
          </div>
          <div className="calm-action-footer">
            <Button
              htmlType="submit"
              className="primary-button"
              loading={mutation.isPending}
              disabled={
                !writable ||
                conflict ||
                !!merge ||
                reloading ||
                !!reloadError ||
                (!selection?.item &&
                  !selection?.source &&
                  (!moduleId || (scopeType === "FEATURE" && !featureId)))
              }
            >
              保存草稿
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
