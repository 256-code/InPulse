import React from "react";

/**
 * 项目内导航（设计师稿 `latest-version/views/catalog.tsx` 的 `.project-context-nav`）。
 *
 * 受控展示组件：不取数、不跳转，只把「项目概览 + 当前项目的模块列表」渲染成
 * 一行导航按钮。设计师稿在模块级（catalog.tsx L41）与项目级（L212）各渲染一次，
 * 因此组件本身不区分层级，由 `active` 决定高亮项。
 */
export interface ProjectContextNavModule {
  readonly id: number;
  readonly name: string;
}

/** `"overview"` 表示当前在项目概览；数字表示当前在该模块；`null` 表示两者都不是。 */
export type ProjectContextNavActive = number | "overview" | null;

export const ProjectContextNav: React.FC<{
  readonly modules: readonly ProjectContextNavModule[];
  readonly active: ProjectContextNavActive;
  readonly onSelectOverview: () => void;
  readonly onSelectModule: (moduleId: number) => void;
  readonly label?: string;
}> = ({
  modules,
  active,
  onSelectOverview,
  onSelectModule,
  label = "项目内导航",
}) => (
  <nav className="project-context-nav" aria-label={label}>
    <button
      type="button"
      className={active === "overview" ? "active" : undefined}
      aria-current={active === "overview" ? "page" : undefined}
      onClick={onSelectOverview}
    >
      项目概览
    </button>
    {modules.map((item) => {
      const isActive = active === item.id;
      return (
        <button
          key={item.id}
          type="button"
          className={isActive ? "active" : undefined}
          aria-current={isActive ? "page" : undefined}
          onClick={() => onSelectModule(item.id)}
        >
          {item.name}
        </button>
      );
    })}
  </nav>
);
