import { GlobalTaskCreateModal } from "./GlobalTaskCreateModal";
import { taskDetailPath, type TaskLocation } from "./task-links";
import { TaskOriginFacts } from "./task-origin";
import { ExternalLinksPanel } from "@features/external-links/ExternalLinksPanel";
import { MergeIntoMainTaskModal } from "@features/task-groups/MergeIntoMainTaskModal";
import { TaskGroupDetailModal } from "@features/task-groups/TaskGroupDetailModal";
import { createTaskGroupServerAdapter } from "@features/task-groups/task-groups-server";
import {
  RecordDetailModal,
  type RecordDetailTarget,
} from "@features/published-records/RecordDetailModal";
import {
  RecordDraftEditorModal,
  type RecordDraftEditorTarget,
} from "@features/record-drafts/RecordDraftEditorModal";
import { useNavigate } from "react-router-dom";
import { LeftoverTaskSource } from "./LeftoverTaskSource";
import React, { useMemo, useRef, useState } from "react";
import { TaskStatusPanel } from "./TaskStatusPanel";
import { useTaskMarks, type TaskMark } from "./task-marks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Spin } from "antd";
import { AppModal as Modal } from "@features/common/components/AppModal";
import { Controller, useForm } from "react-hook-form";
import {
  ApiError,
  type InpulseApiClient,
  type ReadableRecord,
  type TaskStatusRequest,
} from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  CalmBadge,
  CalmEmptyState,
  CalmSegmented,
  CalmTabs,
} from "@features/common/components/Calm";
import {
  CalmSelect,
  type CalmSelectOption,
} from "@features/common/components/CalmSelect";
import { priorityDotColor } from "@features/common/priority-select-option";
import { taskToneClassName } from "@features/common/task-tone";
import {
  isFirstLoad,
  mergeTask,
  taskEdit,
  taskError,
  useTasks,
  type TaskScope,
  type TaskField,
  type TaskViewItem,
  type TaskDraft,
} from "./task-query";
import { createIdempotencyKey } from "@shared/api/idempotency-key";
import { isCardClick } from "@features/common/card-click";
import { useUserDirectoryQuery } from "@features/users/user-directory-query";
import {
  canManageProjectResources,
  useProjectDetail,
} from "@features/projects/project-query";

const labels: Record<TaskField, string> = {
  title: "任务标题",
  description: "任务说明",
  priority: "优先级",
  assigneeIds: "负责人",
  dueAt: "截止时间",
  impactFeatureIds: "影响功能",
};
const priorityLabels = {
  NORMAL: "普通",
  HIGH: "高",
  URGENT: "紧急",
};
const statusLabels = { TODO: "未完成", DONE: "已完成", CANCELED: "已取消" };
/* 优先级徽章色调与 task-tone.ts 的 taskPriorityBadgeTone 同源：紧急红 / 高金（amber）/
   普通淡蓝（2026-09-23 九次配色定案，与「进行中」同一套蓝）。 */
const priorityTone = {
  NORMAL: "blue",
  HIGH: "amber",
  URGENT: "red",
} as const;
const statusTone = {
  TODO: "blue",
  DONE: "green",
  CANCELED: "gray",
} as const;
const statusFilterOptions: readonly CalmSelectOption[] = [
  { value: "TODO", label: "未完成", dotColor: "#1467d8" },
  { value: "DONE", label: "已完成", dotColor: "#4a9278" },
  { value: "CANCELED", label: "已取消", dotColor: "#a0adb9" },
  { value: "ALL", label: "全部状态" },
];
const empty: TaskDraft = {
  title: "",
  description: "",
  priority: "NORMAL",
  assigneeIds: [],
  dueAt: null,
};
type Merge = ReturnType<typeof mergeTask> & {
  latest: TaskViewItem;
  choices: Partial<Record<TaskField, "draft" | "latest">>;
};
/**
 * C-1 关系徽章：groupRole 为 null 表示未加入 ACTIVE 聚合组（未入组），
 * 徽章与「查看主任务」入口一并隐藏；数据来自页面级一次批量 R-5 调用。
 */
function relationBadge(mark: TaskMark | undefined): {
  readonly label: "主任务" | "分支任务";
  readonly tone: "violet" | "cyan";
  readonly title: string;
} | null {
  if (mark?.groupRole === "MAIN")
    return { label: "主任务", tone: "violet", title: "聚合组统一入口" };
  if (mark?.groupRole === "SOURCE")
    return {
      label: "分支任务",
      tone: "cyan",
      title: "分支任务，保留原始状态与历史",
    };
  return null;
}
/**
 * 裁决修订 D-2：由遗留问题转换而来的任务在卡片、列表与详情统一显示「遗留问题」
 * 徽章；数据来自 R-5 批量标记（hasLeftoverSource），读取失败时按缺席隐藏。
 */
const LEFTOVER_SOURCE_BADGE = {
  label: "遗留问题",
  tone: "leftover",
  title: "由遗留问题转换而来的跟进任务",
} as const;
const formatDate = (value: string | null) =>
  value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "未设置";
const formatDay = (value: string | null) =>
  value ? new Date(value).toLocaleDateString("zh-CN") : "日期不可用";
const dueLabel = (value: string | null) =>
  value ? "截止 " + formatDate(value) : "未设置截止";
/**
 * 任务详情的迭代记录列表只给摘要：整行可点开记录详情弹窗（与聚合组记录列表
 * 同一实现），正文不在列表里预加载。
 */
function recordDetailTarget(record: ReadableRecord): RecordDetailTarget {
  return {
    recordId: record.id,
    code: record.code,
    title: record.title,
    recordStatus: record.status,
    publishedAt: record.publishedAt,
  };
}
type DetailTab = "info" | "records" | "branches";
/**
 * C-3：任务详情弹窗动作行的截止徽章（设计师稿 dueInfo）：按本地日历日计算
 * 与今天的差值，色调映射 calm-due 的 due-* 色板；已完成/已取消不提示逾期。
 * 2026-09-22 起只驱动日期徽章 / 截止列的文字色，不再决定卡片底色。
 */
function dueInfo(
  value: string | null,
  workStatus: TaskViewItem["workStatus"],
): {
  label: string;
  tone: "gray" | "red" | "amber" | "blue";
} {
  if (value === null) return { label: "未设置截止", tone: "gray" };
  if (workStatus === "DONE") return { label: "已完成", tone: "gray" };
  if (workStatus === "CANCELED") return { label: "已取消", tone: "gray" };
  const startOfDay = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round(
    (startOfDay(new Date(value)) - startOfDay(new Date())) / 86_400_000,
  );
  if (days < 0)
    return { label: "已逾期 " + Math.abs(days) + "天", tone: "red" };
  if (days === 0) return { label: "今天截止", tone: "amber" };
  if (days === 1) return { label: "明天截止", tone: "amber" };
  if (days <= 7) return { label: days + " 天后截止", tone: "blue" };
  return { label: "截止 " + formatDate(value), tone: "gray" };
}
/**
 * 任务表格的截止色调：与详情徽章同一套判定——逾期实心深红签、马上到期浅红签，
 * 未设置 / 已完成 / 已取消 / 更远日期不上色（原先这里对每一行都写死了 due-overdue）。
 */
function dueToneClass(
  value: string | null,
  workStatus: TaskViewItem["workStatus"],
): string | undefined {
  const tone = dueInfo(value, workStatus).tone;
  if (tone === "red") return "due-overdue";
  if (tone === "amber") return "due-soon";
  return undefined;
}
/** C-3：动作行左端的截止徽章。 */
function TaskDueBadge({ item }: { readonly item: TaskViewItem }) {
  const due = dueInfo(item.dueAt, item.workStatus);
  return (
    <span className={"calm-due due-" + due.tone}>
      <InpulseIcon name="clock" size={14} />
      {due.label}
    </span>
  );
}

function MergeIntoTargetModal({
  task,
  api,
  onClose,
  onMerged,
}: {
  task: TaskViewItem;
  api: InpulseApiClient;
  onClose: () => void;
  onMerged: (groupId: number) => void;
}) {
  return (
    <MergeIntoMainTaskModal
      open
      task={{
        id: task.id,
        code: task.code,
        title: task.title,
        projectId: task.projectId,
      }}
      api={api}
      onClose={onClose}
      onMerged={(groupId) => {
        onClose();
        onMerged(groupId);
      }}
    />
  );
}

/**
 * 任务详情的来源行与状态弹层的归属面包屑统一由 `./task-origin` 提供，
 * 两处都从只读契约解析项目 / 模块 / 功能名称，不显示编号。
 */
export function TasksPanel({
  projectId,
  moduleId,
  featureId,
  writable,
  client,
  isAdmin = false,
  mode = "panel",
  initialTaskId,
  onDetailClose,
  onOpenTask,
}: TaskScope & {
  writable: boolean;
  client?: InpulseApiClient | undefined;
  /** ADR-034：任务归档/恢复入口只对系统管理员或项目内管理角色开放。 */
  isAdmin?: boolean | undefined;
  /**
   * `detail`：只渲染任务详情弹窗及其子弹窗，不渲染面板头部、任务列表与新建入口，
   * 供任务中心等跨项目页在当前页面就地打开完整任务详情（含写操作）；
   * 缺省 `panel` 保持功能档案与模块任务页的完整面板。
   */
  mode?: "panel" | "detail";
  /** `detail` 模式初始选中的任务；缺省回退 URL 的 `?taskId=`（功能档案深链）。 */
  initialTaskId?: number | null;
  /** 详情弹窗关闭后的回调；`detail` 模式由宿主卸载本组件，回到触发页面。 */
  onDetailClose?: () => void;
  /**
   * 聚合组详情里点击成员任务标题时就地打开任务详情：由宿主页面提供（与任务中心
   * 同一实现），缺省时成员标题按纯文本渲染。成员任务可能属于其他功能或模块，
   * 因此不能复用本面板自己那份按范围读取的详情弹窗。
   */
  onOpenTask?: ((location: TaskLocation) => void) | undefined;
}) {
  const scope = { projectId, moduleId, featureId };
  const { api, query, members, mutation, features } = useTasks(scope, client);
  const [view, setView] = useState<"cards" | "list">("cards");
  // 2026-09-18 人工确认：面板进入时默认显示全部状态，未完成 → 已完成 → 已取消
  // 的分组顺序由服务端排序给出，这里不再默认收敛到待办。
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedId, setSelectedId] = useState<number | null>(
    () =>
      initialTaskId ??
      (Number(new URLSearchParams(window.location.search).get("taskId")) ||
        null),
  );
  // C-3：详情弹窗的标签页与状态操作。statusToken 每次打开动作弹窗递增，
  // 父级据此更换 key，让输入、冲突与幂等重试键随重新挂载清空。
  const [tab, setTab] = useState<DetailTab>("info");
  const [statusAction, setStatusAction] = useState<
    TaskStatusRequest["action"] | null
  >(null);
  const [statusToken, setStatusToken] = useState(0);
  const [selection, setSelection] = useState<{ item?: TaskViewItem } | null>(
    null,
  );
  const [merge, setMerge] = useState<Merge | null>(null);
  const [mergeInto, setMergeInto] = useState(false);
  /** 当前就地打开的聚合组详情（null 表示弹层关闭）；聚合组入口不再整页跳转。 */
  const [openGroupId, setOpenGroupId] = useState<number | null>(null);
  // ADR-034：归档/恢复是编辑弹窗底部的独立确认流程，与编辑表单状态互不影响。
  const [lifecycle, setLifecycle] = useState<{
    action: "archive" | "restore";
    item: TaskViewItem;
  } | null>(null);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [lifecycleError, setLifecycleError] = useState<string | null>(null);
  const [reloadError, setReloadError] = useState<string | null>(null);
  const [reloading, setReloading] = useState(false);
  const [success, setSuccess] = useState(false);
  /** 当前打开的迭代记录详情（null 表示弹层关闭）。 */
  const [openRecordId, setOpenRecordId] = useState<number | null>(null);
  /** 迭代记录草稿弹窗目标：与记录页共用同一个弹窗组件，写草稿不再离开当前页面。 */
  const [draftTarget, setDraftTarget] =
    useState<RecordDraftEditorTarget | null>(null);
  const generation = useRef(0);
  const saving = useRef(false);
  const {
    control,
    handleSubmit,
    reset,
    getValues,
    formState: { errors },
  } = useForm<TaskDraft>({ defaultValues: empty });
  const navigate = useNavigate();
  const [customCreateOpen, setCustomCreateOpen] = useState(false);
  // 聚合组详情与任务中心共用同一弹窗实现；本面板只负责把当前选中组传给它。
  const groupAdapter = useMemo(() => createTaskGroupServerAdapter(api), [api]);
  const current = query.data?.items.find((item) => item.id === selectedId);
  // 页面级一次批量（R-5）：任务集合变化时整批重读，不按任务逐个请求。
  const marks = useTaskMarks(
    api,
    query.data?.items.map((item) => item.id) ?? [],
  );
  const currentMark = current ? marks.get(current.id) : undefined;
  const currentBadge = relationBadge(currentMark);
  // 主任务自身就是统一入口，只有分支任务显示「查看主任务」；
  // groupRole 为 null（未入组）时不显示任何导航入口（C-1）。
  const currentGroupId =
    currentMark?.groupRole === "SOURCE" ? currentMark.groupId : null;
  const currentRecordCount = currentMark?.publishedRecordCount ?? 0;
  // 迭代记录标签页按设计师稿直接列出本任务的已发布记录与草稿：两者都是既有
  // 只读契约（listChangeRecords / getTaskRecordDrafts），客户端按 taskId 过滤，不新增路由。
  const detailTaskId = current?.id ?? 0;
  const detailModuleId = current?.moduleId ?? 0;
  const taskRecords = useQuery({
    queryKey: ["task-published-records", projectId, detailTaskId],
    queryFn: ({ signal }) =>
      api.listChangeRecords(projectId, { limit: 100 }, { signal }),
    enabled: detailTaskId > 0,
    retry: false,
  });
  const taskDrafts = useQuery({
    queryKey: ["task-record-drafts", projectId, detailModuleId, detailTaskId],
    queryFn: ({ signal }) =>
      api.getTaskRecordDrafts(projectId, detailModuleId, detailTaskId, {
        signal,
      }),
    enabled: detailTaskId > 0,
    retry: false,
  });
  const taskPublished = (taskRecords.data?.items ?? []).filter(
    (record) => record.taskId === detailTaskId,
  );
  // 列表刷新后按编号重新定位：弹窗不会因查询返回新对象而闪退。
  const openRecord =
    openRecordId === null
      ? null
      : (taskPublished.find((record) => record.id === openRecordId) ?? null);
  const taskDraftItems = taskDrafts.data?.items ?? [];
  // 详情头部展示名称而非裸 ID：项目/模块名称为既有只读契约。
  const projectDetail = useProjectDetail({ client, projectId });
  // C-1/C-3：R-5 的 groupId 与 groupRole 同生共死；这里给「合并与分支」标签页
  // 与标签文案一份显式的关系视图模型（未入组为 null）。
  const currentRelation =
    currentMark &&
    currentMark.groupRole !== null &&
    currentMark.groupId !== null
      ? { groupId: currentMark.groupId, role: currentMark.groupRole }
      : null;
  const taskWritable =
    writable &&
    current?.lifecycleStatus === "ACTIVE" &&
    !(featureId !== null && current.scopeType === "MODULE");
  const visibleItems =
    query.data?.items.filter(
      (item) => statusFilter === "ALL" || item.workStatus === statusFilter,
    ) ?? [];
  const memberName = (id: number) =>
    members.data?.items.find((m) => m.id === id)?.name ??
    "用户 #" + id + "（历史负责人）";
  /** 多负责人平权（ADR-040）：逐人解析后顺次展示。 */
  const memberNames = (ids: readonly number[]) =>
    ids.length === 0 ? "未指派" : ids.map(memberName).join("、");
  /** 负责人候选项：活跃成员 + 当前任务的历史负责人（已不在成员列表时标注可保留）。 */
  const assigneeOptions = useMemo(() => {
    const items = members.data?.items ?? [];
    const list: CalmSelectOption[] = items.map((member) => ({
      value: member.id,
      label: member.name,
      avatarUrl: member.avatarUrl ?? null,
    }));
    for (const currentId of selection?.item?.assigneeIds ?? [])
      if (!list.some((option) => option.value === currentId))
        list.unshift({
          value: currentId,
          label: memberName(currentId),
          description: "可保留",
        });
    return list;
  }, [members.data, selection]);
  // 创建人与状态历史操作人未必在任务指派人候选中：用项目活跃成员名单解析姓名，
  // 仍解析不到（已移出项目或停用）时回退中性编号，不冒充负责人语义。
  const projectMembers = useQuery({
    queryKey: ["project-active-members", projectId],
    queryFn: ({ signal }) =>
      api.listActiveProjectMembers(projectId, { signal }),
    retry: false,
  });
  // 创建人/操作人可能不是本项目成员（如系统管理员跨项目操作）：项目活跃成员与
  // 指派人候选都解析不到时，用全站用户目录兜底姓名，仍解析不到才回退中性编号。
  const userDirectory = useUserDirectoryQuery({ client });
  const personName = (id: number) =>
    projectMembers.data?.items.find((m) => m.id === id)?.name ??
    members.data?.items.find((m) => m.id === id)?.name ??
    userDirectory.data?.find((u) => u.id === id)?.name ??
    "用户 #" + id;
  // ADR-033/ADR-034：项目内管理角色或系统管理员才看到归档/恢复入口。
  const canArchiveTasks = canManageProjectResources(
    isAdmin,
    projectDetail.data?.currentUserRole ?? null,
  );
  // ADR-045：父级不再有归档只读态，只读只可能来自任务自身或调用方传入的只读范围。
  const editReadOnly =
    selection?.item !== undefined &&
    (!writable || selection.item.lifecycleStatus !== "ACTIVE");
  const canOpenLifecycleDialog =
    canArchiveTasks &&
    current !== undefined &&
    (current.lifecycleStatus === "ACTIVE" ||
      current.lifecycleStatus === "ARCHIVED");
  const lifecycleCache = useQueryClient();
  const lifecycleMutation = useMutation({
    retry: false,
    mutationFn: async (input: {
      item: TaskViewItem;
      action: "archive" | "restore";
      reason: string;
    }) => {
      const csrf = await api.issueCsrfToken();
      const init = {
        headers: {
          "x-csrf-token": csrf.csrfToken,
          "Idempotency-Key": createIdempotencyKey("task-lifecycle"),
          "If-Match": '"' + input.item.rowVersion + '"',
        },
      };
      const body = { reason: input.reason };
      if (input.item.scopeType === "MODULE")
        return input.action === "archive"
          ? api.archiveModuleTask(
              projectId,
              moduleId,
              input.item.id,
              body,
              init,
            )
          : api.restoreModuleTask(
              projectId,
              moduleId,
              input.item.id,
              body,
              init,
            );
      return input.action === "archive"
        ? api.archiveTask(
            projectId,
            moduleId,
            input.item.featureId,
            input.item.id,
            body,
            init,
          )
        : api.restoreTask(
            projectId,
            moduleId,
            input.item.featureId,
            input.item.id,
            body,
            init,
          );
    },
    onSuccess: async () => {
      await Promise.all(
        [
          "tasks",
          "modules",
          "activity",
          "search",
          "notifications",
          "my-tasks",
          "my-task-groups",
          "task-marks",
          // 归档/恢复会改变聚合组详情里的分支状态与归档徽标（2026-09-22 修）。
          "task-group",
          "task-group-records",
        ].map((key) => lifecycleCache.invalidateQueries({ queryKey: [key] })),
      );
    },
  });
  const openDetail = (id: number) => {
    setSelectedId(id);
    setTab("info");
    setStatusAction(null);
  };
  const closeDetail = () => {
    setSelectedId(null);
    setTab("info");
    setStatusAction(null);
    setOpenRecordId(null);
    onDetailClose?.();
  };
  /**
   * C-3：状态操作入口。每次点击递增 token，任务状态弹窗重新挂载，
   * 上一次的输入、冲突提示与幂等重试键都不会沿用。
   */
  const openStatus = (next: TaskStatusRequest["action"]) => {
    setStatusToken((value) => value + 1);
    setStatusAction(next);
  };
  const open = (item?: TaskViewItem) => {
    setSelectedId(null);
    setTab("info");
    setStatusAction(null);
    setOpenRecordId(null);
    generation.current++;
    setSelection(item ? { item: { ...item } } : {});
    reset(item ? taskEdit(item) : empty);
    mutation.reset();
    setMerge(null);
    setMergeInto(false);
    setReloadError(null);
    setSuccess(false);
    void members.refetch();
    if (featureId === null) void features.refetch();
  };
  const conflict =
    mutation.error instanceof ApiError && mutation.error.status === 409;
  const close = () => {
    if (saving.current || reloading) return;
    generation.current++;
    // detail 模式没有面板可回退：关闭编辑弹窗后重新打开任务详情弹窗。
    const returnId = mode === "detail" ? (selection?.item?.id ?? null) : null;
    setSelection(null);
    setMerge(null);
    if (returnId !== null) openDetail(returnId);
  };
  const save = handleSubmit(async (edit) => {
    if (
      !selection ||
      saving.current ||
      reloading ||
      merge ||
      conflict ||
      reloadError ||
      !writable
    )
      return;
    saving.current = true;
    try {
      const result = await mutation.mutateAsync({ ...selection, edit });
      openDetail(result.id);
      setSelection(null);
      setSuccess(true);
    } catch {
      /* Keep input and retry key. */
    } finally {
      saving.current = false;
    }
  });
  const reload = async () => {
    if (!selection?.item) return;
    const stamp = generation.current;
    const base = selection.item;
    const draft = getValues();
    setReloading(true);
    try {
      const latest =
        featureId === null
          ? await api.getModuleTask(projectId, moduleId, base.id)
          : await api.getTask(projectId, moduleId, featureId, base.id);
      if (stamp !== generation.current) return;
      if (stamp !== generation.current) return;
      if (latest.lifecycleStatus !== "ACTIVE") {
        setReloadError("任务已归档，草稿已保留，当前不能保存。");
        return;
      }
      const result = mergeTask(taskEdit(base), draft, taskEdit(latest));
      if (result.conflicts.length) setMerge({ ...result, latest, choices: {} });
      else {
        reset(result.values);
        setSelection({ item: latest });
        mutation.reset();
        setReloadError(null);
      }
    } catch (error) {
      if (stamp === generation.current) setReloadError(taskError(error));
    } finally {
      if (stamp === generation.current) setReloading(false);
    }
  };
  const applyMerge = () => {
    if (!merge || merge.conflicts.some((field) => !merge.choices[field]))
      return;
    const values = { ...merge.values };
    for (const field of merge.conflicts)
      if (merge.choices[field] === "latest")
        Object.assign(values, { [field]: taskEdit(merge.latest)[field] });
    reset(values);
    setSelection({ item: merge.latest });
    setMerge(null);
    mutation.reset();
    setReloadError(null);
  };
  const openLifecycle = (action: "archive" | "restore", item: TaskViewItem) => {
    lifecycleMutation.reset();
    setLifecycleError(null);
    setLifecycleReason("");
    setLifecycle({ action, item });
  };
  const closeLifecycle = () => {
    if (lifecycleMutation.isPending) return;
    lifecycleMutation.reset();
    setLifecycleError(null);
    setLifecycleReason("");
    setLifecycle(null);
  };
  const submitLifecycle = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!lifecycle || lifecycleMutation.isPending) return;
    const reason = lifecycleReason.trim();
    if (reason.length === 0) {
      setLifecycleError("请填写操作原因。");
      return;
    }
    setLifecycleError(null);
    try {
      await lifecycleMutation.mutateAsync({ ...lifecycle, reason });
      setLifecycle(null);
      setLifecycleReason("");
      setSuccess(true);
    } catch {
      /* 失败时保留原因输入，便于按最新版本重试。 */
    }
  };
  return (
    <section
      aria-label={featureId === null ? "模块任务" : "功能任务"}
      className="tasks-panel"
    >
      {mode === "detail" ? null : (
        <>
          {featureId === null && customCreateOpen && (
            <GlobalTaskCreateModal
              open
              onClose={() => setCustomCreateOpen(false)}
              client={client}
              preset={{ projectId, moduleId }}
              onCreatedLocation={(task) => navigate(taskDetailPath(task))}
            />
          )}
          <div className="calm-section-title">
            <div className="task-panel-heading">
              <h3>{featureId === null ? "模块任务" : "功能任务"}</h3>
              {/* 计数与筛选合并进标题行：不再单起一行「任务数：…」与筛选行。 */}
              {query.data && (
                <CalmBadge
                  tone="gray"
                  title="按唯一任务计：同一任务关联多个功能时只计一次"
                >
                  {query.data.items.length} 个任务
                </CalmBadge>
              )}
            </div>
            <div className="feature-view-controls">
              {/* 功能级面板的新建任务固定归属当前功能，不需要自定义归属；
                  只有模块级面板才需要选择归属到某个功能还是留在模块下。 */}
              {featureId === null && (
                <Button
                  disabled={!writable}
                  onClick={() => setCustomCreateOpen(true)}
                >
                  自定义归属新建任务
                </Button>
              )}
              {query.data && (
                <CalmSelect
                  className="task-status-filter"
                  value={statusFilter}
                  onChange={(next) => setStatusFilter(String(next))}
                  options={statusFilterOptions}
                  appearance="menu"
                  ariaLabel="任务状态筛选"
                />
              )}
              <CalmSegmented
                label="展示方式"
                value={view}
                options={[
                  { value: "cards", label: "卡片" },
                  { value: "list", label: "列表" },
                ]}
                onChange={setView}
              />
              {query.isSuccess && !query.data?.items.length ? null : (
                <Button
                  className="primary-button"
                  disabled={!writable}
                  onClick={() => open()}
                >
                  <InpulseIcon name="plus" size={15} />
                  新建任务
                </Button>
              )}
            </div>
          </div>
          {!writable && (
            <p className="permission-hint">
              <InpulseIcon name="alert" size={14} />
              当前范围只读，不能新建或修改任务。
            </p>
          )}
          {success && <Alert type="success" title="任务已保存" />}
          {query.isPending ? (
            <div className="calm-state">
              <Spin />
              <span>正在加载任务</span>
            </div>
          ) : query.isError ? (
            <Alert
              type="error"
              title={taskError(query.error)}
              action={
                <Button
                  className="secondary-button"
                  onClick={() => void query.refetch()}
                >
                  重试任务列表
                </Button>
              }
            />
          ) : !query.data?.items.length ? (
            <CalmEmptyState
              icon="zap"
              title="暂无任务"
              description={
                featureId === null
                  ? "为当前模块创建一项可影响一个或多个功能的执行工作。"
                  : "为当前功能创建一项具体执行工作。"
              }
            >
              <Button
                className="primary-button"
                disabled={!writable}
                onClick={() => open()}
              >
                <InpulseIcon name="plus" size={15} />
                新建任务
              </Button>
            </CalmEmptyState>
          ) : !visibleItems.length ? (
            <CalmEmptyState
              icon="zap"
              title="当前状态暂无任务"
              description="可切换状态筛选查看历史任务。"
            />
          ) : view === "list" ? (
            <div className="feature-list-scroll">
              <table className="feature-list-table">
                <caption className="sr-only">任务列表</caption>
                <thead>
                  <tr>
                    <th scope="col">范围</th>
                    <th scope="col">编号</th>
                    <th scope="col">任务</th>
                    <th scope="col">负责人</th>
                    <th scope="col">优先级</th>
                    <th scope="col">截止</th>
                    <th scope="col">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleItems.map((item) => {
                    const badge = relationBadge(marks.get(item.id));
                    const leftoverSource =
                      marks.get(item.id)?.hasLeftoverSource === true;
                    const subtitle = [
                      badge === null ? null : badge.label,
                      leftoverSource ? LEFTOVER_SOURCE_BADGE.label : null,
                    ]
                      .filter((part) => part !== null)
                      .join(" · ");
                    // 标题本身就是入口，副标题只留归属提示，不再重复详情入口文案。
                    return (
                      <tr
                        key={item.id}
                        className={taskToneClassName(
                          item.priority,
                          item.workStatus,
                        )}
                      >
                        <td>
                          {item.scopeType === "MODULE" ? (
                            <span className="task-scope">模块级任务</span>
                          ) : (
                            <span className="task-scope">功能级任务</span>
                          )}
                        </td>
                        <td>
                          <span className="task-id">{item.code}</span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="feature-list-open"
                            aria-label={item.title}
                            onClick={() => openDetail(item.id)}
                          >
                            <strong>{item.title}</strong>
                            {subtitle === "" ? null : <span>{subtitle}</span>}
                          </button>
                        </td>
                        <td>{memberNames(item.assigneeIds)}</td>
                        <td>
                          <CalmBadge tone={priorityTone[item.priority]}>
                            {priorityLabels[item.priority]}
                          </CalmBadge>
                        </td>
                        <td
                          className={dueToneClass(item.dueAt, item.workStatus)}
                        >
                          {dueLabel(item.dueAt)}
                        </td>
                        <td>
                          <CalmBadge tone={statusTone[item.workStatus]}>
                            {statusLabels[item.workStatus]}
                          </CalmBadge>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="calm-task-grid">
              {visibleItems.map((item) => {
                const badge = relationBadge(marks.get(item.id));
                const recordCount =
                  marks.get(item.id)?.publishedRecordCount ?? 0;
                const leftoverSource =
                  marks.get(item.id)?.hasLeftoverSource === true;
                return (
                  <article
                    className={
                      "calm-task-card " +
                      taskToneClassName(item.priority, item.workStatus)
                    }
                    key={item.id}
                    tabIndex={0}
                    /* 整卡即详情入口：卡片本身带可读名称，键盘 Tab 到卡片时
                       屏幕阅读器能读出「查看任务详情：<标题>」，同时给测试一个
                       稳定的定位入口（不再渲染重复的「任务详情」按钮）。 */
                    aria-label={"查看任务详情：" + item.title}
                    onClick={(event) => {
                      if (!isCardClick(event)) return;
                      openDetail(item.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter" && event.key !== " ") return;
                      if (event.target !== event.currentTarget) return;
                      event.preventDefault();
                      openDetail(item.id);
                    }}
                  >
                    {/* 与任务中心卡片同款：编号与「未完成」都不占徽章位；
                        标签落到分隔线以下的左下角，负责人移到横线上方右侧。 */}
                    <h3>{item.title}</h3>
                    {/* 卡片正文是任务介绍；归属由页面语境与「模块级」徽标表达，
                        不再重复一遍功能名。 */}
                    <p
                      className={
                        "task-card-desc" +
                        (item.description === "" ? " is-placeholder" : "")
                      }
                      title={
                        item.description === ""
                          ? "暂无任务描述"
                          : item.description
                      }
                    >
                      {item.description === ""
                        ? "暂无任务描述"
                        : item.description}
                    </p>
                    <div className="calm-card-assignee">
                      <span title={"负责人：" + memberNames(item.assigneeIds)}>
                        <InpulseIcon name="users" size={14} />
                        {memberNames(item.assigneeIds)}
                      </span>
                    </div>
                    <div className="calm-card-bottom">
                      <span className="task-card-badges">
                        <CalmBadge
                          tone={priorityTone[item.priority]}
                          title={"优先级：" + priorityLabels[item.priority]}
                        >
                          {priorityLabels[item.priority]}
                        </CalmBadge>
                        {item.scopeType === "MODULE" && (
                          <CalmBadge tone="violet">模块级</CalmBadge>
                        )}
                        {badge !== null && (
                          <CalmBadge tone={badge.tone} title={badge.title}>
                            {badge.label}
                          </CalmBadge>
                        )}
                        {leftoverSource && (
                          <CalmBadge
                            tone={LEFTOVER_SOURCE_BADGE.tone}
                            title={LEFTOVER_SOURCE_BADGE.title}
                          >
                            {LEFTOVER_SOURCE_BADGE.label}
                          </CalmBadge>
                        )}
                        {item.workStatus === "TODO" ? null : (
                          <CalmBadge tone={statusTone[item.workStatus]}>
                            {statusLabels[item.workStatus]}
                          </CalmBadge>
                        )}
                      </span>
                      <span
                        className={dueToneClass(item.dueAt, item.workStatus)}
                        title={"截止：" + formatDate(item.dueAt)}
                      >
                        <InpulseIcon name="clock" size={14} />
                        {dueLabel(item.dueAt)}
                      </span>
                    </div>
                    <div className="task-card-footer">
                      <span className="task-card-counts">
                        <span title={"更新 " + formatDate(item.updatedAt)}>
                          <InpulseIcon name="calendar" size={13} />
                          更新 {formatDay(item.updatedAt)}
                        </span>
                        {recordCount > 0 && (
                          <span title={recordCount + " 条已发布迭代记录"}>
                            <InpulseIcon name="gitBranch" size={13} />
                            记录 {recordCount} 条
                          </span>
                        )}
                      </span>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </>
      )}
      {selectedId !== null && (
        <Modal
          open
          size="xl"
          label="任务详情"
          onCancel={closeDetail}
          className="task-modal"
        >
          {query.isPending ? (
            <div className="calm-state">
              <Spin />
              <span>正在加载任务详情</span>
            </div>
          ) : query.isError ? (
            <Alert
              type="error"
              title={taskError(query.error)}
              action={
                <Button
                  className="secondary-button"
                  onClick={() => void query.refetch()}
                >
                  重试任务详情
                </Button>
              }
            />
          ) : !current ? (
            <Alert type="warning" title="任务不存在或无法访问。" />
          ) : (
            <>
              <div className="drawer-header task-modal-header">
                <div>
                  <h2>{current.title}</h2>
                  <div className="task-modal-badges">
                    <span className="task-id">{current.code}</span>
                    <CalmBadge tone={statusTone[current.workStatus]}>
                      {statusLabels[current.workStatus]}
                    </CalmBadge>
                    <CalmBadge tone={priorityTone[current.priority]}>
                      {priorityLabels[current.priority]}
                    </CalmBadge>
                    {currentBadge !== null && (
                      <CalmBadge
                        tone={currentBadge.tone}
                        title={currentBadge.title}
                      >
                        {currentBadge.label}
                      </CalmBadge>
                    )}
                    {currentMark?.hasLeftoverSource === true && (
                      <CalmBadge
                        tone={LEFTOVER_SOURCE_BADGE.tone}
                        title={LEFTOVER_SOURCE_BADGE.title}
                      >
                        {LEFTOVER_SOURCE_BADGE.label}
                      </CalmBadge>
                    )}
                  </div>
                  <div className="task-modal-header-links">
                    <ExternalLinksPanel
                      key={current.id}
                      targetType="TASK"
                      targetId={current.id}
                      client={api}
                    />
                    {/* 任务中心等跨项目页打开详情时页面里看不到项目结构：
                        这里给一条回项目侧任务位置的入口（功能档案或模块任务页，
                        落地后由 ?taskId= 打开同一个任务的详情）。 */}
                    {mode === "detail" && (
                      <Button
                        title="跳转到该项目中此任务所在的功能档案 / 模块任务页"
                        onClick={() => {
                          const location = {
                            projectId: current.projectId,
                            moduleId: current.moduleId,
                            featureId: current.featureId,
                            taskId: current.id,
                          };
                          closeDetail();
                          navigate(taskDetailPath(location));
                        }}
                      >
                        <InpulseIcon name="folder" size={14} />
                        在项目中打开
                      </Button>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="关闭任务详情"
                  onClick={closeDetail}
                >
                  <InpulseIcon name="x" size={19} />
                </button>
              </div>
              <div className="calm-task-actions">
                <TaskDueBadge item={current} />
                {current.workStatus === "TODO" && (
                  <>
                    <Button
                      className="primary-button"
                      disabled={!taskWritable}
                      onClick={() => openStatus("COMPLETE")}
                    >
                      <InpulseIcon name="check" size={15} />
                      完成任务
                    </Button>
                    <Button
                      className="secondary-button"
                      disabled={!taskWritable}
                      onClick={() => openStatus("CANCEL")}
                    >
                      <InpulseIcon name="x" size={15} />
                      取消任务
                    </Button>
                    <Button
                      className="secondary-button"
                      disabled={!taskWritable}
                      onClick={() => setMergeInto(true)}
                    >
                      <InpulseIcon name="gitMerge" size={15} />
                      合并到主任务
                    </Button>
                  </>
                )}
                {current.workStatus === "DONE" && (
                  <Button
                    className="primary-button"
                    disabled={!taskWritable}
                    onClick={() => openStatus("REOPEN")}
                  >
                    <InpulseIcon name="rotateCcw" size={15} />
                    重新打开
                  </Button>
                )}
                {current.workStatus === "CANCELED" && (
                  <Button
                    className="primary-button"
                    disabled={!taskWritable}
                    onClick={() => openStatus("RESTORE")}
                  >
                    <InpulseIcon name="rotateCcw" size={15} />
                    恢复任务
                  </Button>
                )}
                <Button
                  className="secondary-button"
                  disabled={!taskWritable && !canOpenLifecycleDialog}
                  onClick={() => open(current)}
                >
                  <InpulseIcon name="pencil" size={14} />
                  编辑任务
                </Button>
              </div>
              <CalmTabs
                label="任务内容"
                activeKey={tab}
                onChange={setTab}
                items={[
                  { key: "info", label: "任务信息" },
                  {
                    key: "records",
                    label:
                      currentRecordCount > 0
                        ? "迭代记录 " + currentRecordCount
                        : "迭代记录",
                  },
                  {
                    key: "branches",
                    label: currentRelation
                      ? "合并与分支 · #" + currentRelation.groupId
                      : "合并与分支",
                  },
                ]}
              />
              <div className="task-modal-grid">
                <div className="task-modal-main">
                  {tab === "info" && (
                    <>
                      <section className="calm-description">
                        <h3>任务描述</h3>
                        <p>{current.description || "暂无任务说明"}</p>
                      </section>
                      <div className="task-modal-links">
                        {current.scopeType === "MODULE" && (
                          <a
                            href={
                              "/projects/" +
                              projectId +
                              "/modules/" +
                              moduleId +
                              "/tasks?taskId=" +
                              current.id
                            }
                          >
                            打开模块任务
                          </a>
                        )}
                        <a
                          href={`/records?projectId=${projectId}&moduleId=${moduleId}&taskId=${current.id}`}
                        >
                          迭代记录草稿
                        </a>
                        {currentRecordCount > 0 && (
                          <span
                            className="task-record-count"
                            title={currentRecordCount + " 条已发布迭代记录"}
                          >
                            <InpulseIcon name="gitBranch" size={13} />
                            迭代记录 {currentRecordCount} 条
                          </span>
                        )}
                        {currentGroupId !== null && (
                          <button
                            type="button"
                            className="text-button"
                            onClick={() => setOpenGroupId(currentGroupId)}
                          >
                            <InpulseIcon name="gitBranch" size={14} />
                            查看主任务
                            <InpulseIcon name="chevronRight" size={13} />
                          </button>
                        )}
                      </div>
                    </>
                  )}
                  {tab === "records" && (
                    <>
                      <div className="calm-section-title">
                        <div>
                          <h3>本任务迭代记录</h3>
                          <small>
                            {currentRecordCount > 0
                              ? "已发布 " +
                                currentRecordCount +
                                " 条，多个版本不重复计数"
                              : "一个任务可以没有记录，也可以产生多条记录"}
                          </small>
                        </div>
                        <Button
                          className="primary-button"
                          disabled={!taskWritable || !taskDrafts.data?.source}
                          onClick={() => {
                            const source = taskDrafts.data?.source;
                            if (!source) return;
                            setDraftTarget({ kind: "source", source });
                          }}
                        >
                          <InpulseIcon name="zap" size={15} />
                          记录一次迭代
                        </Button>
                      </div>
                      {taskRecords.isPending || taskDrafts.isPending ? (
                        <div className="calm-state">
                          <Spin />
                          <span>正在加载迭代记录</span>
                        </div>
                      ) : taskRecords.isError || taskDrafts.isError ? (
                        <Alert
                          type="error"
                          title="迭代记录加载失败，请重试。"
                          action={
                            <Button
                              onClick={() => {
                                void taskRecords.refetch();
                                void taskDrafts.refetch();
                              }}
                            >
                              重试
                            </Button>
                          }
                        />
                      ) : taskPublished.length === 0 &&
                        taskDraftItems.length === 0 ? (
                        <div className="calm-empty">
                          <InpulseIcon name="gitBranch" size={25} />
                          <strong>该任务还没有迭代记录</strong>
                          <p>
                            完成任务时可以直接记录，也可以先在迭代记录草稿中保存内容。
                          </p>
                        </div>
                      ) : (
                        <ul className="task-record-list">
                          {taskPublished.map((record) => (
                            <li key={"published-" + record.id}>
                              {/* 整行摘要可点开详情弹窗；关联链接与徽章留在按钮外，
                                  避免交互元素嵌套。 */}
                              <button
                                type="button"
                                className="task-record-open"
                                data-testid={"task-record-open-" + record.id}
                                aria-haspopup="dialog"
                                onClick={() => setOpenRecordId(record.id)}
                              >
                                <span className="task-record-open-text">
                                  <strong>{record.title}</strong>
                                  <small>
                                    {record.code +
                                      " · " +
                                      formatDay(record.publishedAt) +
                                      " · " +
                                      (record.handlerName ??
                                        personName(record.handlerId))}
                                  </small>
                                </span>
                                <InpulseIcon
                                  name="chevronRight"
                                  size={14}
                                  className="task-record-open-chevron"
                                />
                              </button>
                              <CalmBadge
                                tone={
                                  record.status === "VOID" ? "gray" : "green"
                                }
                              >
                                {record.status === "VOID" ? "已作废" : "已发布"}
                              </CalmBadge>
                            </li>
                          ))}
                          {taskDraftItems.map((draft) => (
                            <li key={"draft-" + draft.id}>
                              <a
                                href={
                                  "/records?projectId=" +
                                  projectId +
                                  "&moduleId=" +
                                  draft.moduleId +
                                  "&taskId=" +
                                  detailTaskId +
                                  "&recordId=" +
                                  draft.id
                                }
                              >
                                <strong>{draft.title || "未命名草稿"}</strong>
                                <small>
                                  {"草稿 · 更新于 " +
                                    formatDay(draft.updatedAt) +
                                    " · 处理人 " +
                                    (draft.handlerName ??
                                      personName(draft.handlerId))}
                                </small>
                              </a>
                              <CalmBadge tone="amber">草稿</CalmBadge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                  {tab === "branches" && (
                    <section className="merge-panel">
                      {currentRelation === null ? (
                        <div className="calm-empty">
                          <InpulseIcon name="gitMerge" size={25} />
                          <strong>当前是独立任务</strong>
                          <p>
                            发现重复任务时可以合并到主任务，合并后形成主分支与分支任务，历史全部保留。
                          </p>
                        </div>
                      ) : (
                        <>
                          <div className="calm-section-title">
                            <div>
                              <h3>
                                {currentRelation.role === "MAIN"
                                  ? "主任务"
                                  : "分支任务"}{" "}
                                · 聚合组 #{currentRelation.groupId}
                              </h3>
                              <small>
                                {currentRelation.role === "MAIN"
                                  ? "本任务是聚合组的统一入口，分支任务保留各自的状态与历史。"
                                  : "本任务是分支任务，原始状态、负责人、迭代记录与外部链接全部保留。"}
                              </small>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              setOpenGroupId(currentRelation.groupId)
                            }
                          >
                            <InpulseIcon name="gitBranch" size={14} />
                            {currentRelation.role === "MAIN"
                              ? "打开聚合组"
                              : "查看主任务"}
                            <InpulseIcon name="chevronRight" size={13} />
                          </button>
                        </>
                      )}
                    </section>
                  )}
                </div>
                <aside className="task-modal-facts">
                  <dl className="calm-meta">
                    <TaskOriginFacts
                      projectId={current.projectId}
                      moduleId={current.moduleId}
                      featureId={current.featureId}
                      client={client}
                    />
                    <dt>负责人</dt>
                    <dd>{memberNames(current.assigneeIds)}</dd>
                    <dt>创建人</dt>
                    <dd>{personName(current.creatorId)}</dd>
                    <dt>截止时间</dt>
                    <dd>{formatDate(current.dueAt)}</dd>
                    <dt>创建时间</dt>
                    <dd>{formatDate(current.createdAt)}</dd>
                    <dt>更新时间</dt>
                    <dd>{formatDate(current.updatedAt)}</dd>
                    <dt>数据版本</dt>
                    <dd>v{current.rowVersion}</dd>
                    {current.scopeType === "MODULE" && (
                      <>
                        <dt>影响功能</dt>
                        <dd>
                          影响功能：
                          {current.impactFeatureIds
                            .map(
                              (id) =>
                                features.data?.items.find((f) => f.id === id)
                                  ?.name ?? "功能 #" + id,
                            )
                            .join("、") || "未选择"}
                        </dd>
                      </>
                    )}
                  </dl>
                </aside>
              </div>
              <div className="task-modal-bottom">
                <LeftoverTaskSource api={api} taskId={current.id} />
                <TaskStatusPanel
                  key={statusToken}
                  item={current}
                  api={api}
                  writable={taskWritable}
                  action={statusAction}
                  onClose={() => setStatusAction(null)}
                  nameOf={personName}
                />
              </div>
              {mergeInto && (
                <MergeIntoTargetModal
                  task={current}
                  api={api}
                  onClose={() => setMergeInto(false)}
                  onMerged={(groupId) => setOpenGroupId(groupId)}
                />
              )}
            </>
          )}
        </Modal>
      )}
      <TaskGroupDetailModal
        groupId={openGroupId}
        adapter={groupAdapter}
        api={api}
        onClose={() => setOpenGroupId(null)}
        onOpenTask={onOpenTask}
        onChanged={() => {
          // 解除合并会改变任务在聚合组里的关系标记，整批重读 R-5 标记。
          void lifecycleCache.invalidateQueries({ queryKey: ["task-marks"] });
        }}
      />
      {openRecord === null ? null : (
        <RecordDetailModal
          projectId={projectId}
          record={recordDetailTarget(openRecord)}
          api={api}
          onClose={() => setOpenRecordId(null)}
          onChanged={() => {
            // 修订、作废与遗留项操作会改变列表里的编号状态与正文。
            void taskRecords.refetch();
          }}
        />
      )}
      {draftTarget === null ? null : (
        <RecordDraftEditorModal
          api={api}
          target={draftTarget}
          projectId={projectId}
          writable={taskWritable}
          onClose={() => setDraftTarget(null)}
          // 保存成功后弹窗内部会失效草稿查询，列表在下一次渲染时出现新草稿。
          onSaved={() => setDraftTarget(null)}
        />
      )}
      <Modal
        open={selection !== null}
        eyebrow={
          selection?.item
            ? selection.item.code + " · 编辑后 rowVersion 递增并写入审计"
            : "任务负责一次具体执行工作"
        }
        title={selection?.item ? "编辑任务" : "新建任务"}
        size="lg"
        className="catalog-modal"
        onCancel={close}
        mask={{ closable: !mutation.isPending && !reloading }}
      >
        <form
          className="catalog-form calm-form"
          onSubmit={(event) => void save(event)}
        >
          <div className="dialog-form">
            {editReadOnly && (
              <Alert
                type="info"
                title="任务已归档，表单只读；可用下方按钮恢复。"
              />
            )}
            {mutation.isError && (
              <Alert type="error" title={taskError(mutation.error)} />
            )}
            {reloadError && <Alert type="error" title={reloadError} />}
            {conflict && selection?.item && (
              <Button
                className="secondary-button"
                loading={reloading}
                onClick={() => void reload()}
              >
                加载最新版本后继续编辑
              </Button>
            )}
            {merge && (
              <div className="merge-panel">
                <div className="calm-section-title">
                  <div>
                    <h3>解决编辑冲突</h3>
                    <small>选择保留哪一版，应用后再提交最新版本。</small>
                  </div>
                </div>
                {merge.conflicts.map((field) => (
                  <div className="merge-choice" key={field}>
                    <p>{labels[field]}存在冲突</p>
                    <p>我的输入：{String(merge.values[field] ?? "未设置")}</p>
                    <p>
                      最新值：
                      {String(taskEdit(merge.latest)[field] ?? "未设置")}
                    </p>
                    <div className="catalog-actions">
                      <Button
                        className="secondary-button"
                        onClick={() =>
                          setMerge({
                            ...merge,
                            choices: { ...merge.choices, [field]: "draft" },
                          })
                        }
                      >
                        保留我的{labels[field]}
                      </Button>
                      <Button
                        className="secondary-button"
                        onClick={() =>
                          setMerge({
                            ...merge,
                            choices: { ...merge.choices, [field]: "latest" },
                          })
                        }
                      >
                        采用最新{labels[field]}
                      </Button>
                      <span>{merge.choices[field] ? "已选择" : "请选择"}</span>
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
              </div>
            )}
            {featureId === null && (
              <>
                <div className="calm-field form-hint">
                  <p>
                    同一工作只保留一份任务；如果负责人、状态、验收、上线或回滚不同，建议拆分任务。
                  </p>
                </div>
                {features.isPending ? (
                  <p>正在加载影响功能…</p>
                ) : features.isError ? (
                  <Alert
                    type="error"
                    title={taskError(features.error)}
                    action={
                      <Button
                        className="secondary-button"
                        onClick={() => void features.refetch()}
                      >
                        重试影响功能
                      </Button>
                    }
                  />
                ) : (
                  <Controller
                    name="impactFeatureIds"
                    control={control}
                    render={({ field }) => (
                      <fieldset
                        className="calm-field task-impact-features"
                        disabled={mutation.isPending || reloading || !!merge}
                      >
                        <legend>影响功能（可多选，可为空）</legend>
                        {features.data?.items.map((f) => (
                          <label key={f.id}>
                            <input
                              type="checkbox"
                              checked={(field.value ?? []).includes(f.id)}
                              onChange={(event) =>
                                field.onChange(
                                  event.target.checked
                                    ? [
                                        ...new Set([
                                          ...(field.value ?? []),
                                          f.id,
                                        ]),
                                      ].sort((a, b) => a - b)
                                    : (field.value ?? []).filter(
                                        (id) => id !== f.id,
                                      ),
                                )
                              }
                            />
                            {f.name}
                          </label>
                        ))}
                      </fieldset>
                    )}
                  />
                )}
              </>
            )}
            <fieldset
              className="task-form-fields"
              disabled={mutation.isPending || reloading || !!merge}
            >
              <div className="calm-field">
                <label htmlFor="task-title">任务标题</label>
                <Controller
                  name="title"
                  control={control}
                  rules={{
                    validate: (value) =>
                      value.trim().length > 0 || "请输入任务标题",
                    maxLength: { value: 500, message: "最多500字" },
                  }}
                  render={({ field }) => <Input {...field} id="task-title" />}
                />
                {errors.title && <p role="alert">{errors.title.message}</p>}
              </div>
              <div className="calm-field">
                <label htmlFor="task-description">任务说明</label>
                <Controller
                  name="description"
                  control={control}
                  rules={{
                    maxLength: {
                      value: 50000,
                      message: "说明最多 50000 字",
                    },
                  }}
                  render={({ field }) => (
                    <Input.TextArea {...field} id="task-description" rows={4} />
                  )}
                />
                {errors.description && (
                  <p role="alert">{errors.description.message}</p>
                )}
              </div>
              <div className="calm-field">
                <label htmlFor="task-priority">优先级</label>
                <Controller
                  name="priority"
                  control={control}
                  render={({ field }) => (
                    <CalmSelect
                      id="task-priority"
                      ariaLabel="优先级"
                      value={field.value}
                      appearance="menu"
                      onChange={(next) => field.onChange(next)}
                      onBlur={field.onBlur}
                      options={Object.entries(priorityLabels).map(
                        ([value, label]) => ({
                          value,
                          label,
                          dotColor: priorityDotColor(value),
                        }),
                      )}
                    />
                  )}
                />
              </div>
              <div className="calm-field">
                <label htmlFor="task-assignee">负责人</label>
                <Controller
                  name="assigneeIds"
                  control={control}
                  rules={{
                    validate: (value) =>
                      value.length > 0 || "请至少选择一名负责人",
                  }}
                  render={({ field }) => (
                    <CalmSelect
                      id="task-assignee"
                      value={field.value}
                      onChange={(next) => field.onChange(next.map(Number))}
                      options={assigneeOptions}
                      appearance="member"
                      multiple
                      maxTagCount={2}
                      placeholder="请选择项目成员（可多选）"
                      ariaLabel="负责人"
                    />
                  )}
                />
                {errors.assigneeIds && (
                  <p role="alert">{errors.assigneeIds.message}</p>
                )}
                {isFirstLoad(members) && <p>正在加载项目成员…</p>}
                {members.isError && (
                  <Alert
                    type="error"
                    title={taskError(members.error)}
                    action={
                      <Button
                        className="secondary-button"
                        onClick={() => void members.refetch()}
                      >
                        重试项目成员
                      </Button>
                    }
                  />
                )}
              </div>
              <div className="calm-field">
                <label htmlFor="task-due">截止时间</label>
                <Controller
                  name="dueAt"
                  control={control}
                  render={({ field }) => (
                    <input
                      id="task-due"
                      type="datetime-local"
                      value={
                        field.value
                          ? new Date(
                              new Date(field.value).getTime() -
                                new Date(field.value).getTimezoneOffset() *
                                  60000,
                            )
                              .toISOString()
                              .slice(0, 16)
                          : ""
                      }
                      onBlur={field.onBlur}
                      ref={field.ref}
                      onChange={(event) =>
                        field.onChange(
                          event.target.value
                            ? new Date(event.target.value).toISOString()
                            : null,
                        )
                      }
                    />
                  )}
                />
              </div>
            </fieldset>
          </div>
          <div className="calm-action-footer">
            {/* ADR-034：任务归档/恢复入口与模块、功能一致放在编辑弹窗底部；
                普通成员看不到，系统管理员或项目内管理角色可直接切到归档流程。 */}
            {selection?.item &&
            canArchiveTasks &&
            (selection.item.lifecycleStatus === "ACTIVE" ||
              selection.item.lifecycleStatus === "ARCHIVED") ? (
              <Button
                className="secondary-button footer-leading"
                data-testid="task-modal-lifecycle"
                disabled={mutation.isPending || reloading || !!merge}
                onClick={() =>
                  openLifecycle(
                    selection.item!.lifecycleStatus === "ARCHIVED"
                      ? "restore"
                      : "archive",
                    selection.item!,
                  )
                }
              >
                {selection.item.lifecycleStatus === "ARCHIVED"
                  ? "恢复"
                  : "归档"}
              </Button>
            ) : null}
            <Button
              className="secondary-button"
              onClick={close}
              disabled={mutation.isPending || reloading}
            >
              取消
            </Button>
            <Button
              className="primary-button"
              htmlType="submit"
              loading={mutation.isPending}
              disabled={
                !writable || reloading || !!merge || conflict || !!reloadError
              }
            >
              保存
            </Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={lifecycle !== null}
        eyebrow={
          lifecycle === null
            ? "任务生命周期"
            : lifecycle.item.code +
              (lifecycle.action === "archive"
                ? " · 归档只切换生命周期状态"
                : " · 恢复后任务重新回到活跃列表")
        }
        title={lifecycle?.action === "restore" ? "恢复任务" : "归档任务"}
        // 归档是不可逆感知的破坏性动作，恢复则是挽回：两者用不同语义色顶条区分。
        tone={lifecycle?.action === "restore" ? "success" : "danger"}
        icon={lifecycle?.action === "restore" ? "rotateCcw" : "alert"}
        className="catalog-modal"
        onCancel={closeLifecycle}
        mask={{ closable: !lifecycleMutation.isPending }}
      >
        <form
          className="catalog-form calm-form"
          onSubmit={(event) => void submitLifecycle(event)}
        >
          <div className="dialog-form">
            {lifecycleMutation.isError && (
              <Alert type="error" title={taskError(lifecycleMutation.error)} />
            )}
            {lifecycleError && <Alert type="error" title={lifecycleError} />}
            <div className="calm-field">
              <label htmlFor="task-lifecycle-reason">操作原因</label>
              <Input.TextArea
                id="task-lifecycle-reason"
                rows={3}
                maxLength={2000}
                value={lifecycleReason}
                disabled={lifecycleMutation.isPending}
                onChange={(event) => setLifecycleReason(event.target.value)}
              />
            </div>
            <p className="calm-hint">
              {lifecycle?.action === "restore"
                ? "恢复只让任务重新可写；所属模块或功能已归档时，先恢复上一级再恢复任务。"
                : "归档不改变工作状态、完成记录与状态历史；模块归档要求该模块下的全部任务都已归档。"}
            </p>
          </div>
          <div className="calm-action-footer">
            <Button
              className="secondary-button"
              onClick={closeLifecycle}
              disabled={lifecycleMutation.isPending}
            >
              取消
            </Button>
            <Button
              className="primary-button"
              htmlType="submit"
              loading={lifecycleMutation.isPending}
            >
              确认
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
