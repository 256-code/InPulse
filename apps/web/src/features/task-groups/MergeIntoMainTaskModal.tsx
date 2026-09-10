import React, { useEffect, useRef, useState } from "react";
import { Alert, Button, Input, Modal, Spin } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  type InpulseApiClient,
  type SearchItem,
} from "@generated/api";
import { createIdempotencyKey } from "@shared/api/idempotency-key";

/**
 * F-23 合并到主任务（前端弹窗）。主任务候选来自全局搜索的 TASK 结果
 * （F-26 契约：SEARCH_QUERY_MIN_LENGTH = 2），客户端只做同项目过滤与自身排除；
 * 跨项目、已在组内、状态冲突等业务规则由服务端合并命令校验（409/422）。
 * 提交按 Route Registry 携带 CSRF 与 Idempotency-Key；成功后回传 groupId
 * 供调用方提供「查看聚合组」入口（合并响应 TaskGroupItem.id）。
 */

export interface MergeIntoMainTaskModalProps {
  readonly open: boolean;
  readonly task: {
    readonly id: number;
    readonly code: string;
    readonly title: string;
    readonly projectId: number;
  };
  readonly api: InpulseApiClient;
  readonly onClose: () => void;
  readonly onMerged: (groupId: number) => void;
}

const SEARCH_MIN_LENGTH = 2;

export function MergeIntoMainTaskModal({
  open,
  task,
  api,
  onClose,
  onMerged,
}: MergeIntoMainTaskModalProps) {
  const cache = useQueryClient();
  const [keyword, setKeyword] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [mainTask, setMainTask] = useState<SearchItem | null>(null);
  const [sourceKind, setSourceKind] = useState<"ACTIVE" | "HISTORICAL">(
    "ACTIVE",
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    const value = keyword.trim();
    if (value.length < SEARCH_MIN_LENGTH) {
      setSearchTerm("");
      return;
    }
    const timer = window.setTimeout(() => setSearchTerm(value), 350);
    return () => window.clearTimeout(timer);
  }, [keyword]);

  useEffect(() => {
    if (!open) return;
    setKeyword("");
    setSearchTerm("");
    setMainTask(null);
    setSourceKind("ACTIVE");
    setNote("");
    setError(null);
    setFormError(null);
    setNeedsRefresh(false);
    retry.current = null;
  }, [open]);

  const searchQuery = useQuery({
    queryKey: ["task-merge-candidates", searchTerm],
    queryFn: () => api.getSearch({ q: searchTerm, limit: 20 }),
    enabled: open && searchTerm.length >= SEARCH_MIN_LENGTH,
    retry: false,
  });

  const candidates =
    searchQuery.data?.items.filter(
      (item) =>
        item.entityType === "TASK" &&
        item.projectId === task.projectId &&
        item.entityId !== task.id,
    ) ?? [];

  async function rescan() {
    setBusy(true);
    try {
      setMainTask(null);
      setNeedsRefresh(false);
      setError(null);
      retry.current = null;
      await searchQuery.refetch();
    } finally {
      setBusy(false);
    }
  }

  async function submit() {
    if (saving.current || needsRefresh) return;
    if (mainTask === null) {
      setFormError("请先搜索并选择主任务。");
      return;
    }
    saving.current = true;
    setBusy(true);
    setError(null);
    setFormError(null);
    try {
      const trimmed = note.trim();
      const body = {
        sourceTaskId: task.id,
        mainTaskId: mainTask.entityId,
        sourceKind,
        mergeNote: trimmed.length === 0 ? null : trimmed,
      };
      const signature = JSON.stringify([task.projectId, body]);
      if (retry.current?.signature !== signature)
        retry.current = {
          signature,
          key: createIdempotencyKey("task-group-merge"),
        };
      const csrf = await api.issueCsrfToken();
      const result = await api.mergeTaskGroup(body, {
        headers: {
          "x-csrf-token": csrf.csrfToken,
          "Idempotency-Key": retry.current.key,
        },
      });
      await Promise.all([
        cache.invalidateQueries({ queryKey: ["tasks"] }),
        cache.invalidateQueries({ queryKey: ["my-tasks"] }),
        cache.invalidateQueries({ queryKey: ["task-group"] }),
        cache.invalidateQueries({ queryKey: ["task-group-records"] }),
      ]);
      retry.current = null;
      onMerged(result.id);
    } catch (submitError) {
      setError(submitError);
      if (submitError instanceof ApiError && submitError.status === 409)
        setNeedsRefresh(true);
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }

  const errorText =
    error instanceof ApiError
      ? error.status === 401
        ? "登录已失效，请重新登录。"
        : error.status === 403
          ? "当前账号没有执行合并的权限。"
          : error.status === 404
            ? "任务不存在，或当前无法访问（跨项目任务不能直接合并）。"
            : error.status === 409
              ? "来源任务已属于其他聚合组，或任务状态已变化。请重新选择主任务后再试。"
              : error.status === 422
                ? "请求未被接受：不能把任务合并到自己，或字段不合法。"
                : error.status === 429
                  ? "操作频繁，请稍后重试。"
                  : "暂时无法合并，输入已保留，可重试。"
      : "暂时无法合并，输入已保留，可重试。";

  const searchFailed = searchQuery.isError;

  return (
    <Modal
      title="合并到主任务"
      open={open}
      onCancel={() => {
        if (!busy) onClose();
      }}
      closable={!busy}
      maskClosable={!busy}
      width={560}
      footer={
        <>
          <Button disabled={busy} onClick={onClose}>
            取消
          </Button>
          <Button
            type="primary"
            loading={busy}
            disabled={needsRefresh}
            onClick={() => void submit()}
          >
            确认合并
          </Button>
        </>
      }
    >
      <p>
        当前任务：{task.code} {task.title}。合并后当前任务作为来源分支保留，
        不删除、不覆盖任何历史。
      </p>
      <label htmlFor="merge-main-search">
        主任务（搜索任务编号或标题，至少 {SEARCH_MIN_LENGTH} 个字符）
      </label>
      <Input
        id="merge-main-search"
        value={keyword}
        disabled={busy}
        placeholder="例如：T-101 或 修复重复退款"
        onChange={(event) => {
          setKeyword(event.target.value);
          setFormError(null);
        }}
      />
      {searchTerm.length >= SEARCH_MIN_LENGTH ? (
        searchQuery.isPending ? (
          <div className="merge-search-state">
            <Spin size="small" />
            <span>正在搜索任务</span>
          </div>
        ) : searchFailed ? (
          <Alert
            type="error"
            title="搜索暂时不可用，请稍后重试。"
            action={
              <Button
                disabled={busy}
                onClick={() => void searchQuery.refetch()}
              >
                重试搜索
              </Button>
            }
          />
        ) : candidates.length === 0 ? (
          <p className="merge-search-state">当前项目内没有匹配的任务。</p>
        ) : (
          <ul className="merge-candidate-list" aria-label="主任务候选">
            {candidates.map((item) => (
              <li key={item.entityId}>
                <button
                  type="button"
                  aria-pressed={mainTask?.entityId === item.entityId}
                  className={
                    mainTask?.entityId === item.entityId ? "selected" : ""
                  }
                  disabled={busy}
                  onClick={() => {
                    setMainTask(item);
                    setFormError(null);
                  }}
                >
                  <strong>{item.title}</strong>
                  <span>{item.summary === "" ? "任务" : item.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        )
      ) : (
        <p className="merge-search-state">
          输入任务编号或标题，从当前项目中选择主任务。
        </p>
      )}
      {mainTask !== null ? (
        <p className="merge-selected">已选择主任务：{mainTask.title}</p>
      ) : null}
      <fieldset className="merge-branch-choice">
        <legend>合并后处理方式</legend>
        <label>
          <input
            type="radio"
            name="merge-source-kind"
            checked={sourceKind === "ACTIVE"}
            disabled={busy}
            onChange={() => setSourceKind("ACTIVE")}
          />
          活动来源分支（合并后仍继续推进）
        </label>
        <label>
          <input
            type="radio"
            name="merge-source-kind"
            checked={sourceKind === "HISTORICAL"}
            disabled={busy}
            onChange={() => setSourceKind("HISTORICAL")}
          />
          历史来源分支（仅保留历史，不再推进）
        </label>
      </fieldset>
      <label htmlFor="merge-note">合并说明（选填）</label>
      <Input.TextArea
        id="merge-note"
        value={note}
        maxLength={5000}
        disabled={busy}
        placeholder="例如：两个任务均处理退款重复回调问题。"
        onChange={(event) => setNote(event.target.value)}
      />
      <p className="permission-hint">
        两条任务的迭代记录不会被删除或覆盖；合并不改变任务的项目、模块、功能归属
        与工作状态；跨项目任务不能直接合并。
      </p>
      {formError !== null ? <Alert type="warning" title={formError} /> : null}
      {(error !== null || needsRefresh) && (
        <Alert
          type="error"
          title={
            error === null && needsRefresh
              ? "来源任务已属于其他聚合组，或任务状态已变化。请重新选择主任务后再试。"
              : errorText
          }
          action={
            needsRefresh ? (
              <Button disabled={busy} onClick={() => void rescan()}>
                重新搜索
              </Button>
            ) : undefined
          }
        />
      )}
    </Modal>
  );
}
