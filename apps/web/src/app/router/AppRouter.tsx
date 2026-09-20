import React, { useMemo } from "react";
import {
  createBrowserRouter,
  Navigate,
  RouterProvider,
  useParams,
  type RouteObject,
} from "react-router-dom";
import { Spin } from "antd";
import type { AppRouteModule } from "@shared/routing/route-descriptor";
import { buildRouteObjects } from "@shared/routing/route-registry";
import { AppLayout } from "../layout/AppLayout";
import { RequireAuth, RequireAdmin } from "../auth/auth-guard";
import { RouteErrorPage } from "../errors/RouteErrorPage";

/** 项目概览已与「模块与功能」合并：旧地址不再单独渲染页面，整体重定向到项目主页。 */
const ProjectOverviewRedirect: React.FC = () => {
  const { projectId } = useParams();
  return <Navigate to={`/projects/${projectId ?? ""}/modules`} replace />;
};

export function loadPageRoutes(): AppRouteModule[] {
  // 静态自动聚合 pages 目录下所有领域 route.ts 导出
  const modules = import.meta.glob<{
    default?: AppRouteModule;
    route?: AppRouteModule;
  }>("../../pages/**/route.ts", { eager: true });

  const routeList: AppRouteModule[] = [];
  for (const path in modules) {
    const exported = modules[path];
    if (!exported) {
      continue;
    }
    const mod = exported.default ?? exported.route;
    if (mod) {
      routeList.push(mod);
    }
  }

  return routeList;
}

export function createInPulseRouter(
  pageRoutes: readonly AppRouteModule[] = loadPageRoutes(),
): ReturnType<typeof createBrowserRouter> {
  const childRoutes = buildRouteObjects(pageRoutes, {
    fallback: (
      <div style={{ display: "flex", justifyContent: "center", padding: 48 }}>
        <Spin size="large" description="正在加载页面..." />
      </div>
    ),
    authWrapper: (element, requiresAdmin) => {
      if (requiresAdmin) {
        return <RequireAdmin>{element}</RequireAdmin>;
      }
      return <RequireAuth>{element}</RequireAuth>;
    },
  });

  const rootRoute: RouteObject = {
    path: "/",
    element: <AppLayout />,
    // 兜底错误页：路由级异常与默认 404 都不再落到 React Router 的开发者页面。
    errorElement: <RouteErrorPage />,
    children: [
      // 「/」不再有独立首页：首页与任务中心内容重复，根路径直接落到任务中心。
      { index: true, element: <Navigate to="/tasks" replace /> },
      {
        path: "projects/:projectId/overview",
        element: <ProjectOverviewRedirect />,
      },
      ...childRoutes,
    ],
  };

  return createBrowserRouter([rootRoute]);
}

export const AppRouter: React.FC = () => {
  const router = useMemo(() => createInPulseRouter(), []);
  return <RouterProvider router={router} />;
};
