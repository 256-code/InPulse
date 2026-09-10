import type {
  MyTaskDisplay,
  MyTaskFilters,
  MyTaskLevel,
  MyTaskPriority,
  MyTaskRecordFilter,
  MyTaskRelation,
  MyTaskScope,
  MyTaskStatusFilter,
} from "./my-tasks-types";

/**
 * 任务中心 URL 状态（F-30：筛选状态由 URL 承载，页面不保留内部副本）。
 *
 * 参数约定：scope=mine|created|project|all、project=<项目 id>、
 * status=open|done|all、priority、level、relation、record=yes|no、
 * github=yes|no、canceled=1、q=<关键词>、view=cards|list、more=1。
 * 与默认值相同的项不写入 URL；非法值一律回退默认值。
 */

export const MY_TASKS_MORE_PARAM = "more";

export const DEFAULT_MY_TASK_FILTERS: MyTaskFilters = {
  scope: "mine",
  projectId: null,
  status: "open",
  priority: null,
  level: null,
  relation: null,
  hasRecord: null,
  hasGithub: null,
  includeCanceled: false,
  query: "",
  display: "cards",
};

const scopeValues: readonly MyTaskScope[] = [
  "mine",
  "created",
  "project",
  "all",
];
const statusValues: readonly MyTaskStatusFilter[] = ["open", "done", "all"];
const priorityValues: readonly MyTaskPriority[] = [
  "LOW",
  "NORMAL",
  "HIGH",
  "URGENT",
];
const levelValues: readonly MyTaskLevel[] = ["FEATURE", "MODULE"];
const relationValues: readonly MyTaskRelation[] = [
  "STANDALONE",
  "MAIN",
  "SOURCE",
];
const yesNoValues: readonly MyTaskRecordFilter[] = ["yes", "no"];
const displayValues: readonly MyTaskDisplay[] = ["cards", "list"];

function pick<T extends string>(
  values: readonly T[],
  raw: string | null,
): T | null {
  if (raw === null) return null;
  return values.find((value) => value === raw) ?? null;
}

function readPositiveId(raw: string | null): number | null {
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 2147483647)
    return null;
  return parsed;
}

export interface ReadMyTaskFiltersOptions {
  readonly isAdmin?: boolean;
}

export function readMyTaskFilters(
  params: URLSearchParams,
  options: ReadMyTaskFiltersOptions = {},
): MyTaskFilters {
  const scope =
    pick(scopeValues, params.get("scope")) ?? DEFAULT_MY_TASK_FILTERS.scope;
  return {
    scope: scope === "all" && options.isAdmin !== true ? "mine" : scope,
    projectId: readPositiveId(params.get("project")),
    status:
      pick(statusValues, params.get("status")) ??
      DEFAULT_MY_TASK_FILTERS.status,
    priority: pick(priorityValues, params.get("priority")),
    level: pick(levelValues, params.get("level")),
    relation: pick(relationValues, params.get("relation")),
    hasRecord: pick(yesNoValues, params.get("record")),
    hasGithub: pick(yesNoValues, params.get("github")),
    includeCanceled: params.get("canceled") === "1",
    query: params.get("q") ?? "",
    display:
      pick(displayValues, params.get("view")) ??
      DEFAULT_MY_TASK_FILTERS.display,
  };
}

export interface WriteMyTaskFiltersOptions {
  readonly advancedOpen?: boolean;
}

export function writeMyTaskFilters(
  filters: MyTaskFilters,
  options: WriteMyTaskFiltersOptions = {},
): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.scope !== DEFAULT_MY_TASK_FILTERS.scope)
    params.set("scope", filters.scope);
  if (filters.scope === "project" && filters.projectId !== null)
    params.set("project", String(filters.projectId));
  if (filters.status !== DEFAULT_MY_TASK_FILTERS.status)
    params.set("status", filters.status);
  if (filters.priority !== null) params.set("priority", filters.priority);
  if (filters.level !== null) params.set("level", filters.level);
  if (filters.relation !== null) params.set("relation", filters.relation);
  if (filters.hasRecord !== null) params.set("record", filters.hasRecord);
  if (filters.hasGithub !== null) params.set("github", filters.hasGithub);
  if (filters.includeCanceled) params.set("canceled", "1");
  const term = filters.query.trim();
  if (term.length > 0) params.set("q", term);
  if (filters.display !== DEFAULT_MY_TASK_FILTERS.display)
    params.set("view", filters.display);
  if (options.advancedOpen === true) params.set(MY_TASKS_MORE_PARAM, "1");
  return params;
}

export function readMyTaskAdvancedOpen(params: URLSearchParams): boolean {
  return params.get(MY_TASKS_MORE_PARAM) === "1";
}

/** 高级筛选角标计数；口径与设计师稿「更多筛选」一致。 */
export function countActiveMyTaskFilters(filters: MyTaskFilters): number {
  return [
    filters.query.trim().length > 0,
    filters.status !== DEFAULT_MY_TASK_FILTERS.status,
    filters.priority !== null,
    filters.level !== null,
    filters.relation !== null,
    filters.hasRecord !== null,
    filters.hasGithub !== null,
    filters.includeCanceled,
  ].filter(Boolean).length;
}
