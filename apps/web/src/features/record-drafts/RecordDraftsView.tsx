import { ExternalLinksPanel } from "@features/external-links/ExternalLinksPanel";
import {
  fieldText,
  fields,
  labels,
} from "./record-content.js";
export { mergeRecordDraft } from "./record-content.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { PublishRecordButton } from "@features/published-records/PublishRecordButton";
import { useMyRecordDraftsQuery, useRecordDraftsQuery } from "./record-drafts-query";
import {
  RecordDraftEditorModal,
  type RecordDraftEditorTarget,
} from "./RecordDraftEditorModal";
import { recordDraftErrorMessage } from "./record-draft-errors";
import "./record-drafts.css";
import { Alert, Button, Spin } from "antd";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  createApiClient,
  type InpulseApiClient,
  type MyRecordDraftItem,
} from "@generated/api";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import { RecordMarkdown } from "@features/common/components/RecordMarkdown";
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
  const [params, setParams] = useSearchParams();
  const projectId = Number(params.get("projectId")) || 0;
  const recordId = Number(params.get("recordId")) || 0;
  const taskId = Number(params.get("taskId")) || 0;
  const sourceModuleId = Number(params.get("moduleId")) || 0;
  /** 编辑/新建草稿的弹窗目标：与记录页页头 CTA、任务详情弹窗共用同一组件。 */
  const [editorTarget, setEditorTarget] =
    useState<RecordDraftEditorTarget | null>(null);
  /** 草稿列表区的展开状态：只影响展示，查询与分页不变。 */
  const [draftsOpen, setDraftsOpen] = useState(true);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: ({ signal }) => api.listProjects({ signal }),
    retry: false,
  });
  const allDrafts = useRecordDraftsQuery({
    client,
    projectId,
    enabled: !taskId,
    authorId: currentUserId,
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
  // ADR-035：项目四态下只有已归档只读；列表里还没有该项目时按只读处理。
  const pageProjectStatus = projects.data?.items.find(
    (p) => p.id === projectId,
  )?.status;
  /** 来源任务（URL 带 taskId 时）：弹窗目标、可写性与列表都以它为准。 */
  const source = taskId ? sourceQuery.data?.source : undefined;
  /** 来源任务已归档时草稿只读；目标项目状态由弹窗内部再叠加。 */
  const sourceWritable = !taskId || source?.lifecycleStatus === "ACTIVE";
  const writable =
    projectId > 0 &&
    pageProjectStatus !== undefined &&
    pageProjectStatus !== "ARCHIVED" &&
    sourceWritable;
  /** 全部项目视图下只要存在可写项目即可发起创建，具体项目在弹窗内选定。 */
  const anyWritableProject = (projects.data?.items ?? []).some(
    (p) => p.status === "ACTIVE",
  );
  const canCreate =
    projectId > 0
      ? !!writable && (taskId === 0 || !!sourceQuery.data?.source)
      : taskId === 0 && anyWritableProject;
  useEffect(() => {
    onCanCreateChange?.(canCreate);
  }, [canCreate, onCanCreateChange]);
  // B-3a：项目选择器上移到页面 toolbar 后，切换项目时关闭弹窗；
  // 弹窗内的范围选择与冲突状态由组件按新项目重新初始化。
  const lastProjectId = useRef(projectId);
  useEffect(() => {
    if (lastProjectId.current === projectId) return;
    lastProjectId.current = projectId;
    setEditorTarget(null);
  }, [projectId]);
  // B-3a：页头 CTA（记录一次迭代 / 新建来源草稿）通过递增令牌打开同一个弹窗。
  const lastCreateToken = useRef(createToken);
  useEffect(() => {
    if (lastCreateToken.current === createToken) return;
    lastCreateToken.current = createToken;
    if (!canCreate) return;
    if (taskId && !source) return;
    setEditorTarget(
      source ? { kind: "source", source } : { kind: "independent" },
    );
  }, [createToken, canCreate, taskId, source]);
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
      setEditorTarget({ kind: "item", item: item.draft });
      return;
    }
    setEditorTarget(null);
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
          title={recordDraftErrorMessage(projects.error)}
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
            <div className="draft-source-head">
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
            </div>
          )}
          <CalmSectionTitle
            title={taskId > 0 ? "来源草稿" : "项目草稿"}
            hint={
              taskId > 0
                ? "先把变化写清楚，保存后可与项目成员继续补充。"
                : "只显示你自己创建的草稿，保存后可与项目成员继续补充。"
            }
            collapsible={{
              expanded: draftsOpen,
              onToggle: () => setDraftsOpen((prev) => !prev),
              controls: "record-draft-list",
            }}
          >
            <CalmBadge tone="amber">草稿</CalmBadge>
            <Button
              className="primary-button"
              disabled={!writable}
              onClick={() =>
                setEditorTarget(
                  source ? { kind: "source", source } : { kind: "independent" },
                )
              }
            >
              {taskId ? "新建来源草稿" : "新建独立草稿"}
            </Button>
          </CalmSectionTitle>
          {draftsOpen && (
            <div id="record-draft-list">
              {listPending ? (
                <Spin />
              ) : listFailed ? (
                <Alert
                  type="error"
                  title={recordDraftErrorMessage(listError)}
                  action={<Button onClick={reloadList}>重试草稿列表</Button>}
                />
              ) : !drafts.length ? (
                <CalmEmptyState
                  icon="gitBranch"
                  title="暂无草稿"
                  description={
                    taskId
                      ? "此任务还没有草稿，可以显式新建。"
                      : "你还没有在该项目中创建草稿。"
                  }
                />
              ) : (
                <div className="calm-task-grid">
                  {drafts.map((item) => (
                    <article className="calm-task-card" key={item.id}>
                      <CalmBadge tone="amber">草稿</CalmBadge>
                      <h3>{item.title}</h3>
                      <p>
                        模块 {item.moduleName ?? "名称暂不可用"}
                        {item.featureId
                          ? ` / 功能 ${item.featureName ?? "名称暂不可用"}`
                          : " / 模块范围"}
                      </p>
                      <p>
                        记录作者 {item.authorName ?? "名称暂不可用"} · 更新{" "}
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
            </div>
          )}
          <Modal
            open={recordId > 0 && editorTarget === null}
            title="草稿详情"
            body
            size="lg"
            onCancel={() => {
              const next = new URLSearchParams(params);
              next.delete("recordId");
              setParams(next);
            }}
            footer={null}
          >
            {recordId > 0 &&
              (detail.isPending ? (
                <Spin />
              ) : detail.isError ? (
                <Alert type="error" title={recordDraftErrorMessage(detail.error)} />
              ) : (
                detail.data && (
                  <section className="draft-detail" aria-label="草稿详情">
                    <h2>{detail.data.title}</h2>
                    <div className="draft-detail-meta">
                      <p>
                        草稿 · 处理人{" "}
                        {detail.data.handlerName ?? "名称暂不可用"} · 记录作者{" "}
                        {detail.data.authorName ?? "名称暂不可用"}
                      </p>
                      <p>
                        项目{" "}
                        {projects.data?.items.find(
                          (p) => p.id === detail.data.projectId,
                        )?.name ?? "名称暂不可用"}{" "}
                        / 模块 {detail.data.moduleName ?? "名称暂不可用"}
                        {detail.data.featureId
                          ? ` / 功能 ${detail.data.featureName ?? "名称暂不可用"}`
                          : ` / 影响功能：${detail.data.impactFeatureNames?.join("、") || "未选择"}`}
                      </p>
                    </div>
                    {fields
                      .filter((field) => field !== "title")
                      .map((field) => (
                        <section key={field}>
                          <h3>{labels[field]}</h3>
                          <RecordMarkdown
                            content={
                              fieldText(detail.data, field) ||
                              "暂无已知遗留问题"
                            }
                          />
                        </section>
                      ))}
                    <div className="draft-detail-links">
                      <ExternalLinksPanel
                        key={detail.data.id}
                        targetType="CHANGE_RECORD"
                        targetId={detail.data.id}
                        client={api}
                      />
                      {detail.data.taskId !== null && (
                        <a
                          className="secondary-button"
                          href={`/records?projectId=${projectId}&moduleId=${detail.data.moduleId}&taskId=${detail.data.taskId}`}
                        >
                          <InpulseIcon name="cornerDown" size={14} />
                          查看此任务的全部草稿
                        </a>
                      )}
                    </div>
                    <div className="draft-detail-actions">
                      <Button
                        disabled={!writable}
                        onClick={() =>
                          setEditorTarget({ kind: "item", item: detail.data })
                        }
                      >
                        继续编辑
                      </Button>
                      <PublishRecordButton
                        item={detail.data}
                        api={api}
                        writable={!!writable}
                      />
                    </div>
                    <p className="draft-detail-note">
                      草稿尚未发布，不计入正式迭代统计。
                    </p>
                  </section>
                )
              ))}
          </Modal>
        </>
      )}
      <RecordDraftEditorModal
        api={api}
        target={editorTarget}
        projectId={projectId}
        defaultModuleId={Number(params.get("moduleId")) || 0}
        defaultFeatureId={Number(params.get("featureId")) || 0}
        writable={sourceWritable}
        onClose={() => setEditorTarget(null)}
        onSaved={(draft) => {
          setEditorTarget(null);
          setParams({
            projectId: String(draft.projectId),
            recordId: String(draft.id),
            ...(taskId
              ? { taskId: String(taskId), moduleId: String(sourceModuleId) }
              : {}),
          });
        }}
      />
    </section>
  );
}
