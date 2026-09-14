import React, { useMemo, useState } from "react";
import type { FeatureItem, InpulseApiClient, ModuleItem } from "@generated/api";
import { useFeatures } from "@features/features/feature-query";
import { useModules } from "@features/modules/module-query";
import { useProjectDetail } from "@features/projects/project-query";
import { treePath, type TreeSelection } from "./tree-selection";

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
  readonly projectId: number;
  readonly selection: TreeSelection;
  readonly onNavigate: (path: string) => void;
  readonly client?: InpulseApiClient | undefined;
}

interface FeatureRowProps {
  readonly moduleId: number;
  readonly item: FeatureItem;
  readonly selection: TreeSelection;
  readonly onFeatureClick: (selection: TreeSelection) => void;
}

interface FeatureListProps {
  readonly projectId: number;
  readonly moduleId: number;
  readonly selection: TreeSelection;
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
    selection.kind === "feature" &&
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
  readonly selection: TreeSelection;
  readonly onModuleClick: (key: string, selection: TreeSelection) => void;
  readonly onFeatureClick: (selection: TreeSelection) => void;
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
  const key = `module:${item.id}`;
  const isSelected =
    selection.kind === "module" && selection.moduleId === item.id;
  const inPath = selection.kind === "feature" && selection.moduleId === item.id;
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
          onModuleClick(key, { kind: "module", moduleId: item.id })
        }
      >
        <FolderGlyph />
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
            onFeatureClick={onFeatureClick}
            client={client}
          />
        </div>
      ) : null}
    </div>
  );
};

/**
 * 侧栏系统目录：只渲染 系统 → 模块 → 功能 三层，点击节点跳转到既有的
 * 项目主页、功能目录与功能档案页面，内容区功能不在此重复实现。
 */
export const ProjectTree: React.FC<ProjectTreeProps> = ({
  projectId,
  selection,
  onNavigate,
  client,
}) => {
  const project = useProjectDetail({ client, projectId });
  const modules = useModules(projectId, client);
  const [extraExpanded, setExtraExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const chainKeys = useMemo(() => {
    const keys = new Set<string>(["project"]);
    if (selection.kind !== "project") {
      keys.add(`module:${selection.moduleId}`);
    }
    return keys;
  }, [selection]);
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
  const handleModuleClick = (key: string, next: TreeSelection) => {
    onNavigate(treePath(projectId, next));
    toggle(key);
  };
  const handleRootClick = () => {
    // 系统节点是项目主页的主入口，只导航并展开，不做折叠切换。
    onNavigate(treePath(projectId, { kind: "project" }));
    setCollapsed((prev) => {
      if (!prev.has("project")) {
        return prev;
      }
      const next = new Set(prev);
      next.delete("project");
      return next;
    });
  };
  const handleFeatureClick = (next: TreeSelection) => {
    onNavigate(treePath(projectId, next));
  };

  const rootExpanded = expandedKeys.has("project");
  const rootSelected = selection.kind === "project";
  const moduleItems = modules.query.data?.items ?? [];
  return (
    <div className="project-tree">
      <div className="tree-project">
        <button
          type="button"
          className={`tree-row project-node${rootSelected ? " selected" : ""}${
            rootExpanded ? " expanded" : ""
          }`}
          aria-expanded={rootExpanded}
          aria-current={rootSelected ? "true" : undefined}
          title={project.data?.name ?? "系统目录"}
          onClick={handleRootClick}
        >
          <FolderGlyph />
          <span className="tree-label">
            <strong>{project.data?.name ?? "系统目录"}</strong>
          </span>
        </button>
        {rootExpanded ? (
          <div className="tree-children">
            {modules.query.isPending ? (
              <p className="tree-hint">正在加载模块…</p>
            ) : modules.query.isError ? (
              <p className="tree-hint">模块加载失败</p>
            ) : moduleItems.length === 0 ? (
              <p className="tree-hint">暂无模块</p>
            ) : (
              moduleItems.map((item) => (
                <ModuleBranch
                  key={item.id}
                  projectId={projectId}
                  item={item}
                  expanded={expandedKeys.has(`module:${item.id}`)}
                  selection={selection}
                  onModuleClick={handleModuleClick}
                  onFeatureClick={handleFeatureClick}
                  client={client}
                />
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};
