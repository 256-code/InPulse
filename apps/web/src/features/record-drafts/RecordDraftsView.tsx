import { ExternalLinksPanel } from "@features/external-links/ExternalLinksPanel";
import { fieldText, fields, labels } from "./record-content.js";
export { mergeRecordDraft } from "./record-content.js";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { PublishRecordButton } from "@features/published-records/PublishRecordButton";
import {
  useMyRecordDraftsQuery,
  useRecordDraftsQuery,
} from "./record-drafts-query";
import {
  RecordDraftEditorModal,
  type RecordDraftEditorTarget,
} from "./RecordDraftEditorModal";
import { recordDraftErrorMessage } from "./record-draft-errors";
import "./record-drafts.css";
import { Alert, Button, Spin } from "antd";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { useQuery } from "@tanstack/react-query";
import {
  createApiClient,
  type InpulseApiClient,
  type RecordDraftItem,
} from "@generated/api";
import { useScopedSearchParams } from "@features/common/search-params-scope";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSectionTitle,
} from "@features/common/components/Calm";
import { RecordMarkdown } from "@features/common/components/RecordMarkdown";
/** 卡片时间用 9/21 11:35 这种短格式，1/3 宽的卡片才放得下。 */
function formatDraftTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getMonth() + 1 + "/" + date.getDate(),
    pad(date.getHours()) + ":" + pad(date.getMinutes()),
  ].join(" ");
}

/**
 * 归一后的草稿卡片。名称回填只由服务端跨项目列表（全部项目视图）提供；项目内视图
 * 与来源任务视图沿用草稿自身携带的 moduleName / featureName。
 */
interface DraftCardItem {
  readonly draft: RecordDraftItem;
  readonly projectName: string | null;
  readonly moduleName: string | null;
  readonly featureName: string | null;
  readonly authorName: string | null;
}

function toDraftCard(
  draft: RecordDraftItem,
  names?: {
    readonly projectName: string;
    readonly moduleName: string;
    readonly featureName: string | null;
  },
  authorFallback?: string | undefined,
): DraftCardItem {
  return {
    draft,
    projectName: names?.projectName ?? null,
    moduleName: names?.moduleName ?? draft.moduleName ?? null,
    featureName: names?.featureName ?? draft.featureName ?? null,
    // 全部项目视图的草稿恒为当前用户创建，服务端不回填作者名时用登录用户名兜底。
    authorName: draft.authorName ?? authorFallback ?? null,
  };
}

export function RecordDraftsView({
  client,
  createToken = 0,
  currentUserId,
  currentUserName,
  onCanCreateChange,
}: {
  client?: InpulseApiClient | undefined;
  /** 页头 CTA 的递增令牌：变化时打开对应模式的草稿弹窗（B-3a 单页）。 */
  createToken?: number;
  /** 当前登录用户 id：草稿列表只列自己创建的，未传则列出项目全部草稿。 */
  currentUserId?: number | undefined;
  /** 当前登录用户名：全部项目视图的草稿作者名兜底（服务端不回填作者名）。 */
  currentUserName?: string | undefined;
  /** 向调用方上报能否创建草稿，供页头 CTA 的禁用态使用。 */
  onCanCreateChange?: ((canCreate: boolean) => void) | undefined;
}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const [params, setParams] = useScopedSearchParams();
  const projectId = Number(params.get("projectId")) || 0;
  const recordId = Number(params.get("recordId")) || 0;
  const taskId = Number(params.get("taskId")) || 0;
  const sourceModuleId = Number(params.get("moduleId")) || 0;
  /** 编辑/新建草稿的弹窗目标：与记录页页头 CTA、任务详情弹窗共用同一组件。 */
  const [editorTarget, setEditorTarget] =
    useState<RecordDraftEditorTarget | null>(null);
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: ({ signal }) => api.listProjects({ signal }),
    retry: false,
  });
  /** 全部项目视图（URL 不带 projectId）：草稿跨项目汇总，卡片回填项目名。 */
  const isAllProjects = projectId === 0;
  const projectDrafts = useRecordDraftsQuery({
    client,
    projectId,
    enabled: !taskId && !isAllProjects,
    authorId: currentUserId,
  });
  const myDrafts = useMyRecordDraftsQuery({
    client,
    enabled: !taskId && isAllProjects,
  });
  const sourceQuery = useQuery({
    queryKey: ["task-record-drafts", projectId, sourceModuleId, taskId],
    queryFn: ({ signal }) =>
      api.getTaskRecordDrafts(projectId, sourceModuleId, taskId, { signal }),
    enabled: projectId > 0 && sourceModuleId > 0 && taskId > 0,
    retry: false,
  });
  /**
   * 三种来源（来源任务 / 项目草稿 / 全部项目下的我的草稿）归一成同一种卡片模型，
   * 卡片渲染与打开逻辑只认 draftCards。
   */
  const draftCards: readonly DraftCardItem[] =
    taskId > 0
      ? (sourceQuery.data?.items ?? []).map((item) => toDraftCard(item))
      : isAllProjects
        ? (myDrafts.data?.pages.flatMap((page) => [...page.items]) ?? []).map(
            (item) => toDraftCard(item.draft, item, currentUserName),
          )
        : (
            projectDrafts.data?.pages.flatMap((page) => [...page.items]) ?? []
          ).map((item) => toDraftCard(item));
  const listPending =
    taskId > 0
      ? sourceQuery.isPending
      : isAllProjects
        ? myDrafts.isPending
        : projectDrafts.isPending;
  const listError =
    taskId > 0
      ? sourceQuery.error
      : isAllProjects
        ? myDrafts.error
        : projectDrafts.error;
  const listFailed =
    taskId > 0
      ? sourceQuery.isError
      : isAllProjects
        ? myDrafts.isError
        : projectDrafts.isError;
  const reloadList = () =>
    void (taskId > 0
      ? sourceQuery.refetch()
      : isAllProjects
        ? myDrafts.refetch()
        : projectDrafts.refetch());
  /** 分页只存在于草稿列表：来源任务草稿是单页读取，没有下一页。 */
  const listHasMore =
    taskId > 0
      ? false
      : isAllProjects
        ? myDrafts.hasNextPage
        : projectDrafts.hasNextPage;
  const listFetchingMore =
    taskId > 0
      ? false
      : isAllProjects
        ? myDrafts.isFetchingNextPage
        : projectDrafts.isFetchingNextPage;
  const loadMore = () =>
    void (isAllProjects
      ? myDrafts.fetchNextPage()
      : projectDrafts.fetchNextPage());
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
  /**
   * 打开某条草稿：URL 带上 recordId，交给既有的草稿详情弹层加载；taskId 语境
   * 下同时带上 moduleId / taskId，写入路径才会落在来源任务上。
   */
  const openDraft = (item: DraftCardItem) => {
    // 全部项目视图下草稿可能不属于 URL 里的项目：先切到它自己的项目再打开详情。
    setParams({
      projectId: String(item.draft.projectId),
      recordId: String(item.draft.id),
      ...(taskId
        ? { taskId: String(taskId), moduleId: String(sourceModuleId) }
        : {}),
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
        title={
          taskId > 0 ? "来源草稿" : isAllProjects ? "我的草稿" : "项目草稿"
        }
        hint={
          taskId > 0
            ? "先把变化写清楚，保存后可与项目成员继续补充。"
            : isAllProjects
              ? "跨项目汇总你创建的草稿，打开即回到所属项目继续编辑。"
              : "只显示你自己创建的草稿，保存后可与项目成员继续补充。"
        }
      >
        {taskId > 0 ? (
          <Button
            className="primary-button"
            disabled={!writable}
            onClick={() =>
              setEditorTarget(
                source ? { kind: "source", source } : { kind: "independent" },
              )
            }
          >
            新建来源草稿
          </Button>
        ) : null}
      </CalmSectionTitle>
      <div id="record-draft-list">
        {listPending ? (
          <Spin />
        ) : listFailed ? (
          <Alert
            type="error"
            title={recordDraftErrorMessage(listError)}
            action={<Button onClick={reloadList}>重试草稿列表</Button>}
          />
        ) : !draftCards.length ? (
          <CalmEmptyState
            icon="gitBranch"
            title="暂无草稿"
            description={
              taskId
                ? "此任务还没有草稿，可以显式新建。"
                : isAllProjects
                  ? "你还没有在任何项目中创建过草稿。"
                  : "你还没有在该项目中创建草稿。"
            }
          />
        ) : (
          <div className="draft-card-grid">
            {draftCards.map((item) => (
              <button
                type="button"
                className="draft-card"
                key={item.draft.id}
                onClick={() => openDraft(item)}
              >
                <span className="draft-card-top">
                  <CalmBadge tone="amber">草稿</CalmBadge>
                  <span className="draft-card-action">继续编辑 →</span>
                </span>
                <strong className="draft-card-title">{item.draft.title}</strong>
                <span className="draft-card-meta">
                  <span className="draft-card-scope">
                    {item.projectName === null ? "" : item.projectName + " / "}
                    {item.moduleName ?? "名称暂不可用"}
                    {item.draft.featureId
                      ? " / " + (item.featureName ?? "名称暂不可用")
                      : ""}
                  </span>
                  <span className="draft-card-author">
                    <span className="draft-card-avatar" aria-hidden="true">
                      {(item.authorName ?? "?").slice(0, 1)}
                    </span>
                    {item.authorName ?? "名称暂不可用"}
                  </span>
                  <span className="draft-card-time">
                    更新 {formatDraftTime(item.draft.updatedAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        {listHasMore && (
          <div className="record-load-more">
            <Button disabled={listFetchingMore} onClick={loadMore}>
              {listFetchingMore ? "正在加载…" : "加载更多"}
            </Button>
          </div>
        )}
      </div>
      <Modal
        className="draft-detail-modal"
        open={recordId > 0 && editorTarget === null}
        label="草稿详情"
        eyebrow="草稿"
        title={detail.data === undefined ? undefined : detail.data.title}
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
                <div className="draft-detail-meta">
                  <p>
                    处理人 {detail.data.handlerName ?? "名称暂不可用"} ·
                    记录作者 {detail.data.authorName ?? "名称暂不可用"}
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
                          fieldText(detail.data, field) || "暂无已知遗留问题"
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
      <RecordDraftEditorModal
        api={api}
        target={editorTarget}
        projectId={projectId}
        defaultModuleId={Number(params.get("moduleId")) || 0}
        defaultFeatureId={Number(params.get("featureId")) || 0}
        writable={sourceWritable}
        onClose={() => setEditorTarget(null)}
        onSaved={(draft, published) => {
          setEditorTarget(null);
          // 「新建迭代」发布成功后直接落到正式记录，不再打开草稿详情。
          setParams(
            published
              ? {
                  projectId: String(published.projectId),
                  publishedId: String(published.id),
                  ...(taskId
                    ? {
                        taskId: String(taskId),
                        moduleId: String(sourceModuleId),
                      }
                    : {}),
                }
              : {
                  projectId: String(draft.projectId),
                  recordId: String(draft.id),
                  ...(taskId
                    ? {
                        taskId: String(taskId),
                        moduleId: String(sourceModuleId),
                      }
                    : {}),
                },
          );
        }}
      />
    </section>
  );
}
