import React, { useMemo } from "react";
import { createBrowserRouter, RouterProvider, type RouteObject } from "react-router-dom";
import { Spin } from "antd";
import type { AppRouteModule } from "@shared/routing/route-descriptor";
import { buildRouteObjects } from "@shared/routing/route-registry";
import { AppLayout } from "../layout/AppLayout";
import { RequireAuth, RequireAdmin } from "../auth/auth-guard";

export function loadPageRoutes(): AppRouteModule[] {
  // 静态自动聚合 pages 目录下所有领域 route.ts 导出
  const modules = import.meta.glob<{ default?: AppRouteModule; route?: AppRouteModule }>(
    "../../pages/**/route.ts",
    { eager: true }
  );

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
  pageRoutes: readonly AppRouteModule[] = loadPageRoutes()
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
    }
  });

  const rootRoute: RouteObject = {
    path: "/",
    element: <AppLayout />,
    children: childRoutes
  };

  return createBrowserRouter([rootRoute]);
}

export const AppRouter: React.FC = () => {
  const router = useMemo(() => createInPulseRouter(), []);
  return <RouterProvider router={router} />;
};
