import React, { createContext, useContext, useMemo, useState } from "react";

import type { ProjectTier } from "./resource-lifecycle";

/**
 * 项目列表的「未完成 / 维护中」两档是**全站共享**的浏览状态（2026-10-09 用户指示）：
 * 项目列表页的滑块负责切换，侧栏项目树读同一档位跟着收窄——列表里看哪一档，
 * 侧栏就列哪一档，两处不会各说各话。
 *
 * 状态挂在 `AppLayout` 的 Provider 上，而不是各页面自己的 `useState`：
 * 页面组件随路由卸载，分档若只存活在页面里，从「维护中」档点进项目后侧栏
 * 会立刻变回未完成档，正在看的那个项目反而从树上消失。
 */
interface ProjectTierValue {
  readonly tier: ProjectTier;
  readonly selectTier: (tier: ProjectTier) => void;
}

const ProjectTierContext = createContext<ProjectTierValue | null>(null);

export const ProjectTierProvider: React.FC<{
  readonly children: React.ReactNode;
}> = ({ children }) => {
  const [tier, setTier] = useState<ProjectTier>("open");
  const value = useMemo<ProjectTierValue>(
    () => ({ tier, selectTier: setTier }),
    [tier],
  );
  return (
    <ProjectTierContext.Provider value={value}>
      {children}
    </ProjectTierContext.Provider>
  );
};

/**
 * 读取共享分档。没有 Provider 时降级为组件内部状态（默认「未完成」）：
 * 侧栏与项目列表各自独立挂载（单元测试、局部渲染）时也能工作，不抛错；
 * 正式应用里两者都在 `AppLayout` 的 Provider 之内，因此共用一份状态。
 */
export function useProjectTier(): ProjectTierValue {
  const shared = useContext(ProjectTierContext);
  const [fallbackTier, setFallbackTier] = useState<ProjectTier>("open");
  return shared ?? { tier: fallbackTier, selectTier: setFallbackTier };
}
