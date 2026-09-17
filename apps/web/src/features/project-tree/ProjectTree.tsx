import React, { useEffect, useMemo, useState } from "react";
import type {
  FeatureItem,
  InpulseApiClient,
  ModuleItem,
  ProjectItem,
} from "@generated/api";
import { InpulseIcon } from "@features/common/components/InpulseIcon";
import { useFeatures } from "@features/features/feature-query";
import { useModules } from "@features/modules/module-query";
import { useProjects } from "@features/projects/project-query";
import { treePath, type TreeScope, type TreeSelection } from "./tree-selection";

const FOLDER_CLOSED_PATH =
  "M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 2H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z";

const FolderGlyph: React.FC = () => (
  <span className="tree-folder" aria-hidden="true">
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={FOLDER_CLOSED_PATH} />
    </svg>
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={FOLDER_CLOSED_PATH} />
      <path d="M2 10h20" />
    </svg>
  </span>
);

export interface ProjectTreeProps {
  readonly activeScope: TreeScope | null;
  readonly onNavigate: (path: string) => void;
  readonly client?: InpulseApiClient | undefined;
}

interface FeatureRowProps {
  readonly moduleId: number;
  readonly item: FeatureItem;
  readonly selection: TreeSelection | null;
  readonly onFeatureClick: (selection: TreeSelection) => void;
}

interface FeatureListProps {
  readonly projectId: number;
  readonly moduleId: number;
  readonly selection: TreeSelection | null;
  readonly onFeatureClick: (selection: TreeSelection) => void;
  readonly client?: InpulseApiClient | undefined;
}
const FeatureRow: React.FC<FeatureRowProps> = ({
  moduleId,
  item,
  selection,
  onFeatureClick,
}) => {
  const isSelected =
    selection?.kind === "feature" &&
    selection.moduleId === moduleId &&
    selection.featureId === item.id;
  return (
    <button
      type="button"
      className={`tree-row feature-node${isSelected ? " selected" : ""}`}
      aria-current={isSelected ? "true" : undefined}
      title={item.name}
      onClick={() =>
        onFeatureClick({ kind: "feature", moduleId, featureId: item.id })
      }
    >
      <InpulseIcon name="code" size={16} className="tree-icon" />
      <span className="tree-label">
        <strong>{item.name}</strong>
      </span>
    </button>
  );
};

const FeatureList: React.FC<FeatureListProps> = ({
  projectId,
  moduleId,
  selection,
  onFeatureClick,
  client,
}) => {
  const features = useFeatures(projectId, moduleId, undefined, client);
  if (features.query.isPending) {
    return <p className="tree-hint">正在加载功能…</p>;
  }
  if (features.query.isError) {
    return <p className="tree-hint">功能加载失败</p>;
  }
  const items = features.query.data?.items ?? [];
  if (items.length === 0) {
    return <p className="tree-hint">暂无功能</p>;
  }
  return (
    <>
      {items.map((item) => (
        <FeatureRow
          key={item.id}
          item={item}
          moduleId={moduleId}
          selection={selection}
          onFeatureClick={onFeatureClick}
        />
      ))}
    </>
  );
};

interface ModuleBranchProps {
  readonly projectId: number;
  readonly item: ModuleItem;
  readonly expanded: boolean;
  readonly selection: TreeSelection | null;
  readonly onModuleClick: (
    key: string,
    projectId: number,
    selection: TreeSelection,
  ) => void;
  readonly onFeatureClick: (
    projectId: number,
    selection: TreeSelection,
  ) => void;
  readonly client?: InpulseApiClient | undefined;
}

const ModuleBranch: React.FC<ModuleBranchProps> = ({
  projectId,
  item,
  expanded,
  selection,
  onModuleClick,
  onFeatureClick,
  client,
}) => {
  const key = `project:${projectId}:module:${item.id}`;
  const isSelected =
    selection?.kind === "module" && selection.moduleId === item.id;
  const inPath =
    selection?.kind === "feature" && selection.moduleId === item.id;
  return (
    <div className="tree-project">
      <button
        type="button"
        className={`tree-row module-node${isSelected ? " selected" : ""}${
          inPath ? " in-path" : ""
        }${expanded ? " expanded" : ""}`}
        aria-expanded={expanded}
        aria-current={isSelected ? "true" : undefined}
        title={item.name}
        onClick={() =>
          onModuleClick(key, projectId, { kind: "module", moduleId: item.id })
        }
      >
        <InpulseIcon name="boxes" size={16} className="tree-icon" />
        <span className="tree-label">
          <strong>{item.name}</strong>
        </span>
      </button>
      {expanded ? (
        <div className="tree-children">
          <FeatureList
            projectId={projectId}
            moduleId={item.id}
            selection={selection}
            onFeatureClick={(next) => onFeatureClick(projectId, next)}
            client={client}
          />
        </div>
      ) : null}
    </div>
  );
};

/**
 * 侧栏系统目录：项目与功能导航展开后先罗列所有项目，点击项目再罗列模块、
 * 点击模块再罗列功能；点击节点跳转到既有的项目主页、功能目录与功能档案
 * 页面，内容区功能不在此重复实现。当前路由所在链路自动展开，且展开状态在
 * 跳转到其它层级或页面后保持不变，避免回到项目概况时子级被收起。
 */
interface ModuleListProps {
  readonly projectId: number;
  readonly selection: TreeSelection | null;
  readonly expandedKeys: ReadonlySet<string>;
  readonly onModuleClick: (
    key: string,
    projectId: number,
    selection: TreeSelection,
  ) => void;
  readonly onFeatureClick: (
    projectId: number,
    selection: TreeSelection,
  ) => void;
  readonly client?: InpulseApiClient | undefined;
}

const ModuleList: React.FC<ModuleListProps> = ({
  projectId,
  selection,
  expandedKeys,
  onModuleClick,
  onFeatureClick,
  client,
}) => {
  const modules = useModules(projectId, client);
  if (modules.query.isPending) {
    return <p className="tree-hint">正在加载模块…</p>;
  }
  if (modules.query.isError) {
    return <p className="tree-hint">模块加载失败</p>;
  }
  const items = modules.query.data?.items ?? [];
  if (items.length === 0) {
    return <p className="tree-hint">暂无模块</p>;
  }
  return (
    <>
      {items.map((item) => (
        <ModuleBranch
          key={item.id}
          projectId={projectId}
          item={item}
          expanded={expandedKeys.has(`project:${projectId}:module:${item.id}`)}
          selection={selection}
          onModuleClick={onModuleClick}
          onFeatureClick={onFeatureClick}
          client={client}
        />
      ))}
    </>
  );
};

interface ProjectBranchProps {
  readonly item: ProjectItem;
  readonly expanded: boolean;
  readonly activeScope: TreeScope | null;
  readonly expandedKeys: ReadonlySet<string>;
  readonly onProjectClick: (projectId: number) => void;
  readonly onModuleClick: (
    key: string,
    projectId: number,
    selection: TreeSelection,
  ) => void;
  readonly onFeatureClick: (
    projectId: number,
    selection: TreeSelection,
  ) => void;
  readonly client?: InpulseApiClient | undefined;
}

const ProjectBranch: React.FC<ProjectBranchProps> = ({
  item,
  expanded,
  activeScope,
  expandedKeys,
  onProjectClick,
  onModuleClick,
  onFeatureClick,
  client,
}) => {
  const isActiveProject = activeScope?.projectId === item.id;
  const isSelected =
    isActiveProject && activeScope?.selection.kind === "project";
  return (
    <div className="tree-project">
      <button
        type="button"
        className={`tree-row project-node${isSelected ? " selected" : ""}${
          expanded ? " expanded" : ""
        }`}
        aria-expanded={expanded}
        aria-current={isSelected ? "true" : undefined}
        title={item.name}
        onClick={() => onProjectClick(item.id)}
      >
        <FolderGlyph />
        <span className="tree-label">
          <strong>{item.name}</strong>
        </span>
      </button>
      {expanded ? (
        <div className="tree-children">
          <ModuleList
            projectId={item.id}
            selection={isActiveProject ? activeScope.selection : null}
            expandedKeys={expandedKeys}
            onModuleClick={onModuleClick}
            onFeatureClick={onFeatureClick}
            client={client}
          />
        </div>
      ) : null}
    </div>
  );
};

export const ProjectTree: React.FC<ProjectTreeProps> = ({
  activeScope,
  onNavigate,
  client,
}) => {
  const projects = useProjects({ client });
  const [extraExpanded, setExtraExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const chainKeys = useMemo(() => {
    const keys = new Set<string>();
    if (activeScope === null) {
      return keys;
    }
    keys.add(`project:${activeScope.projectId}`);
    if (activeScope.selection.kind !== "project") {
      keys.add(
        `project:${activeScope.projectId}:module:${activeScope.selection.moduleId}`,
      );
    }
    return keys;
  }, [activeScope]);
  const expandedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const key of chainKeys) {
      if (!collapsed.has(key)) {
        keys.add(key);
      }
    }
    for (const key of extraExpanded) {
      if (!collapsed.has(key)) {
        keys.add(key);
      }
    }
    return keys;
  }, [chainKeys, collapsed, extraExpanded]);
  // 链路只负责自动展开、不负责收回：展开过的节点写入 extraExpanded 保留，
  // 用面包屑回到项目概况等上层页面时子级不自动收起，只有点击节点才开合。
  useEffect(() => {
    setExtraExpanded((prev) => {
      const next = new Set(prev);
      let changed = false;
      for (const key of chainKeys) {
        if (!next.has(key) && !collapsed.has(key)) {
          next.add(key);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [chainKeys, collapsed]);

  const toggle = (key: string) => {
    if (expandedKeys.has(key)) {
      setExtraExpanded((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setCollapsed((prev) => new Set(prev).add(key));
      return;
    }
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setExtraExpanded((prev) => new Set(prev).add(key));
  };
  const handleProjectClick = (projectId: number) => {
    // 与模块节点一致：点击导航到项目主页并开合切换，再次点击收回模块列表。
    onNavigate(treePath(projectId, { kind: "project" }));
    toggle(`project:${projectId}`);
  };
  const handleModuleClick = (
    key: string,
    projectId: number,
    next: TreeSelection,
  ) => {
    onNavigate(treePath(projectId, next));
    toggle(key);
  };
  const handleFeatureClick = (projectId: number, next: TreeSelection) => {
    onNavigate(treePath(projectId, next));
  };

  const items = projects.data?.items ?? [];
  return (
    <div className="project-tree">
      <div className="project-tree-scroll">
        {projects.isPending ? (
          <p className="tree-hint">正在加载项目…</p>
        ) : projects.isError ? (
          <p className="tree-hint">项目加载失败</p>
        ) : items.length === 0 ? (
          <p className="tree-hint">暂无项目</p>
        ) : (
          items.map((item) => (
            <ProjectBranch
              key={item.id}
              item={item}
              expanded={expandedKeys.has(`project:${item.id}`)}
              activeScope={activeScope}
              expandedKeys={expandedKeys}
              onProjectClick={handleProjectClick}
              onModuleClick={handleModuleClick}
              onFeatureClick={handleFeatureClick}
              client={client}
            />
          ))
        )}
      </div>
    </div>
  );
};
