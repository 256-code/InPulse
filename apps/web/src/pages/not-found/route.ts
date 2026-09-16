import { lazy } from "react";
import type { AppRouteModule } from "@shared/routing/route-descriptor";

const NotFoundPage = lazy(() => import("./NotFoundPage"));

/**
 * 未匹配路径兜底。必须注册在根路由的 children 中，才能保留 AppLayout 外壳；
 * `requiresAuth` 让匿名访问与其它受保护页一致地重定向到登录页。
 */
export const notFoundRoute: AppRouteModule = {
  path: "*",
  element: NotFoundPage,
  requiresAuth: true,
};

export default notFoundRoute;
