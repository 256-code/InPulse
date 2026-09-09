import React, { useMemo, useState } from "react";
import type { InpulseApiClient } from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import {
  describeSearchError,
  isValidSearchQuery,
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
  useSearchInfiniteQuery,
} from "@features/search/search-query";

export interface ActivityIndexPageViewProps {
  readonly client?: InpulseApiClient;
  readonly onOpenProject: (projectId: number) => void;
}

export const ActivityIndexPageView: React.FC<ActivityIndexPageViewProps> = ({
  client,
  onOpenProject,
}) => {
  const [query, setQuery] = useState("");
  const normalizedQuery = query.trim();
  const queryIsValid = isValidSearchQuery(normalizedQuery);
  const search = useSearchInfiniteQuery({
    query: normalizedQuery,
    ...(client ? { client } : {}),
    limit: 20,
  });
  const projects = useMemo(
    () =>
      (search.data?.pages.flatMap((page) => [...page.items]) ?? []).filter(
        (item) => item.entityType === "PROJECT",
      ),
    [search.data],
  );

  let content: React.ReactNode;
  if (normalizedQuery.length === 0) {
    content = (
      <div className="calm-empty activity-empty">
        <InpulseIcon name="activity" size={24} />
        <strong>先找到你要查看的项目</strong>
        <p>输入项目名称、完整项目编码或编号，选择一个可访问项目查看动态。</p>
      </div>
    );
  } else if (!queryIsValid) {
    content = (
      <div className="calm-empty activity-empty">
        <InpulseIcon name="search" size={24} />
        <strong>搜索词长度不满足要求</strong>
        <p>
          请输入 {SEARCH_MIN_LENGTH}～{SEARCH_MAX_LENGTH} 个字符。
        </p>
      </div>
    );
  } else if (search.isPending) {
    content = (
      <div className="activity-state">
        <span className="activity-spinner" />
        正在查找项目...
      </div>
    );
  } else if (search.isError) {
    content = (
      <div className="activity-state activity-state-error">
        {describeSearchError(search.error)}
      </div>
    );
  } else if (projects.length === 0) {
    content = (
      <div className="calm-empty activity-empty">
        <InpulseIcon name="search" size={24} />
        <strong>没有找到可访问的项目</strong>
        <p>搜索只返回你当前可以访问的项目。</p>
      </div>
    );
  } else {
    content = (
      <div className="activity-project-list">
        {projects.map((project) => (
          <button
            type="button"
            key={`${project.entityType}:${project.entityId}`}
            className="activity-project-result"
            data-testid={`activity-project-${project.entityId}`}
            onClick={() => onOpenProject(project.entityId)}
          >
            <span className="activity-project-icon">
              <InpulseIcon name="folder" size={17} />
            </span>
            <span>
              <strong>{project.title}</strong>
              <small>{project.summary}</small>
            </span>
            <InpulseIcon name="chevron" size={16} />
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="activity-page">
      <div className="page-header activity-page-header">
        <div>
          <span className="eyebrow">动态与审计 · F-27</span>
          <h1>项目动态</h1>
          <p>先通过服务端搜索选择你可访问的项目，再进入该项目的时间线。</p>
        </div>
      </div>
      <div className="toolbar task-toolbar activity-toolbar">
        <div className="task-search activity-project-search">
          <InpulseIcon name="search" size={16} />
          <input
            value={query}
            maxLength={SEARCH_MAX_LENGTH}
            placeholder="搜索项目名称、编码或编号"
            aria-label="搜索项目"
            onChange={(event) => setQuery(event.currentTarget.value)}
          />
        </div>
      </div>
      {content}
      <section className="activity-rules">
        <div className="calm-section-title">
          <div>
            <h3>入口说明</h3>
            <small>服务端授权结果不是客户端筛选</small>
          </div>
        </div>
        <ul className="rule-list">
          <li>
            <strong>选择</strong>
            只展示当前账号可作为成员访问的项目。
          </li>
          <li>
            <strong>读取</strong>
            进入项目后由项目动态接口按实时成员关系再次验证权限。
          </li>
          <li>
            <strong>范围</strong>
            全部项目聚合接口尚未接入，本页不伪造项目列表。
          </li>
        </ul>
      </section>
    </div>
  );
};
